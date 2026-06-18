#!/usr/bin/env python
"""Resolve a product image URL per product, accuracy-first.

Confirmation channels (descend only while identity isn't confirmed; a row turns "verified"
only on a REAL confirmation — barcode/code on a page, in structured data, or in the image
filename — never on a plausible-looking guess):
  1. BARCODE/code image search -> source-preference ranking (official domain ≫ pet ≫ generic;
     off-domain penalised; product match measured from the TITLE only; distinctive tokens MUST
     overlap). Then confirm a candidate by:
       a. the GTIN appearing in the image FILENAME / URL (no scrape needed), or
       b. scraping the page and finding the GTIN in its structured data / raw HTML
          (JSON-LD gtin/mpn, meta, data-attrs) or visible text, or
       c. (article code + brand) on the page when no GTIN is printed.
     GTINs are matched across equivalent renderings (EAN-13 / UPC-12 / GTIN-14).
  2. EAN WEB search (not just images) — official-brand-scoped first, then general — to land on
     retailer/brand pages that actually print the code; confirm + take the page's og:image.
  3. NAME image search (broaden) + confirm again.
  4. NAME fallback -> unconfirmed but strong match = `likely`; else blank + flagged.
  5. VISION (opt-in `--vision`, Opus 4.8): judge the chosen image for single-product + uncropped
     (and, for an unconfirmed row, identity). A junk image (multi-pack marketing shot / crop) is
     swapped for a clean pooled alternate when one exists; an off-source swap is tagged and stays
     green only when vision is very sure (else demoted to `likely`). A clean image on a `likely`
     row that vision confirms IS the product is promoted to `verified-visual`.

Tiers: verified-official > verified-cross (2+ domains) > verified > verified-visual > likely > blank.
Anything not confidently matched is left blank + flagged. Resumable; hard credit cap.
Reads FIRECRAWL_API_KEY (and ANTHROPIC_API_KEY if --vision) from env (inject via `op run`).

Usage: python resolve-images.py <in_json> <out_json> [credit_cap] [threshold] [--vision] [--workers N]
"""
import base64
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from PIL import Image as _PILImage
except Exception:  # Pillow missing -> quality gate degrades to liveness-only (never blocks)
    _PILImage = None

IN = sys.argv[1]
OUT = sys.argv[2]
CREDIT_CAP = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].lstrip("-").isdigit() else 80000
THRESHOLD = float(sys.argv[4]) if len(sys.argv) > 4 and re.fullmatch(r"[0-9.]+", sys.argv[4]) else 0.55
VISION = "--vision" in sys.argv
DEBUG = "--debug" in sys.argv or os.environ.get("RI_DEBUG") == "1"
WORKERS = 1  # parallel product workers; >1 fans the I/O-bound per-product work across threads
if "--workers" in sys.argv:
    _wi = sys.argv.index("--workers")
    if _wi + 1 < len(sys.argv) and sys.argv[_wi + 1].isdigit():
        WORKERS = max(1, int(sys.argv[_wi + 1]))
MIN_BASE = 0.30  # distinctive product tokens must overlap at least this much
MIN_IMG_PX = 250    # short side below this is a thumbnail/icon, not a usable product photo
MAX_IMG_RATIO = 3.0  # wider/taller than this is a banner or sliver crop, not a full product
VISION_MODEL = "claude-sonnet-4-6"  # vision judgement (single-product/crop/identity) — right-sized vs Opus; strong enough for counting/crop, far cheaper
VISION_MIN_CONF = 0.8   # vision must be at least this sure the image matches before its quality verdict counts
VISION_STRICT_CONF = 0.85  # any GREEN minted by vision alone (verified-visual / off-source swap) needs this
MAX_QUALITY_ALTS = 2    # at most this many alternate images get a vision call when the primary fails
VISION_MAX_PX = 1024    # downscale the long edge before the vision call to bound image-token cost
VISION_CALL_CAP = 30000  # hard ceiling on vision calls per run (insurance against runaway Anthropic spend)
GROUND_MIN = 400        # below this many chars of page text, try one supplementary trusted-source fetch
PRODUCT_BUDGET = 150    # per-product wall-clock ceiling (s): past this, skip remaining stages/scrapes

KEY = os.environ.get("FIRECRAWL_API_KEY")
if not KEY:
    sys.exit("FIRECRAWL_API_KEY not set — run via `op run --env-file=.env.tpl -- python resolve-images.py ...`")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY")
if VISION and not ANTHROPIC_KEY:
    print("WARNING: --vision set but ANTHROPIC_API_KEY missing — vision step will be skipped.")

STOP = {"the", "for", "and", "with", "x1", "pcs", "pc", "ass", "cs", "of", "in", "a"}
BRAND_STOP = {"pet", "pets", "line", "co", "ltd", "the", "my", "and"}
PET_SIG = re.compile(
    r"pet|dog|cat|puppy|kitten|zoo|animal|aqua|fish|bird|parrot|reptile|rabbit|hamster|"
    r"rodent|vet|kennel|paw|collar|leash|groom|terrarium|aviary|litter|chew|aquarium",
    re.IGNORECASE,
)
# Clearly non-pet domains — a high token match here is almost always a wrong-category
# look-alike (surgical scissors, craft tools, costume jewelry, candy with a similar code).
OFF_DOMAIN = re.compile(
    r"surg|medical|pharma|dental|jewel|candy|craft|hardware|welding|tackle|cosmet|beauty",
    re.IGNORECASE,
)
# Image URLs that are clearly NOT the product: site logos, banners, placeholders, og-defaults,
# icons, sprites. Tuned to avoid false hits on real product photos — e.g. PrestaShop names its
# product images `..._large_default.jpg` / `_medium_default.jpg`, so we DON'T blanket-match
# "default"; only the explicit no-image/og-default/default-image forms.
NONPRODUCT_IMG = re.compile(
    r"(?:^|[/_-])logo(?:[/_.-]|$)|banner|placeholder|watermark|sprite|swatch|favicon|"
    r"no[-_]?image|og[-_]?default|default[-_]?(?:image|product|thumb)|image[-_]?default|"
    r"missing|/header|/footer|/icons?/|/flags?/",
    re.IGNORECASE,
)
# Official manufacturer domains for the dominant brands (brand keyword -> domain fragments).
# Used to rank a brand's own site first and to tag a barcode match `verified-official`.
OFFICIAL_DOMAINS = {
    "acana": ["acana.com"], "camon": ["camon.it"], "trixie": ["trixie.de", "trixie.com"],
    "royal": ["royalcanin"], "canin": ["royalcanin"], "hills": ["hillspet"],
    "brit": ["brit-petfood", "britcare"], "flamingo": ["karlie", "flamingopet"],
    "karlie": ["karlie"], "monge": ["monge.it", "monge.com"], "schesir": ["schesir"],
    "padovan": ["padovan"], "versele": ["versele-laga"], "laga": ["versele-laga"],
    "kong": ["kongcompany"], "ferplast": ["ferplast"], "imac": ["imac.it"],
    "savic": ["savic.be"], "duvo": ["duvoplus", "duvo-plus"], "beaphar": ["beaphar"],
    "zolux": ["zolux"], "rogz": ["rogz"], "julius": ["julius-k9", "juliusk9"],
}


def domain_of(url):
    m = re.search(r"https?://([^/]+)", url or "")
    return (m.group(1) if m else "").lower()


def official_domains_for(brand):
    bt = brand_toks(brand)
    bl = (brand or "").lower()
    doms = set()
    for key, frags in OFFICIAL_DOMAINS.items():
        if key in bt or key in bl:
            doms.update(frags)
    return doms


def toks(s):
    return {t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if t and t not in STOP and len(t) > 1}


def brand_toks(brand):
    return {t for t in toks(brand) if t not in BRAND_STOP and len(t) > 2}


def ean_valid(s):
    if not s or not s.isdigit() or len(s) not in (8, 12, 13, 14):
        return False
    digs = [int(c) for c in s]
    body = digs[:-1][::-1]
    tot = sum(v * (3 if i % 2 == 0 else 1) for i, v in enumerate(body))
    return (10 - tot % 10) % 10 == digs[-1]


def gtin_variants(ean):
    """Equivalent GTIN renderings of a valid code (same number, different width / UPC form),
    so a US UPC-12 or a 14-digit packaging GTIN printed on a page still matches our EAN-13."""
    if not ean:
        return set()
    out = {ean, ean.zfill(14)}
    if len(ean) == 13 and ean.startswith("0"):
        out.add(ean[1:])              # EAN-13 with a leading 0 == 12-digit UPC
    if len(ean) == 12:
        out.add("0" + ean)            # UPC-12 -> EAN-13
        out.add(("0" + ean).zfill(14))
    return {g for g in out if g.isdigit() and 8 <= len(g) <= 14}


def _gtin_pat(g, contiguous):
    # contiguous: digits back-to-back (HTML attrs, image filenames). non-contiguous: tolerate
    # single spaces/hyphens between digits (a barcode printed in visible text).
    body = re.escape(g) if contiguous else r"[\s\-]?".join(re.escape(c) for c in g)
    return r"(?<!\d)" + body + r"(?!\d)"


def gtin_in(text, variants, contiguous=True):
    """True if any GTIN variant appears in text on a digit boundary (never inside a longer run)."""
    t = text or ""
    return any(re.search(_gtin_pat(g, contiguous), t) for g in variants)


def is_product_image(url):
    """False for URLs that are obviously a logo/banner/placeholder rather than the product photo
    (the size gate catches thumbnails/banners; this catches a square high-res logo the gate misses)."""
    return bool(url) and not NONPRODUCT_IMG.search(url)


def reliable_gtin(s):
    """A globally-unique manufacturer barcode usable for verification: a valid EAN/UPC that is NOT
    a restricted / in-store prefix (EAN-13 02x/04x/2xx and UPC 2/4 = variable-weight or
    retailer-assigned POS codes, e.g. a `2000xxxx`). Restricted codes aren't globally unique, so
    using one as a confirmation key invites a false match on an unrelated product/site."""
    return ean_valid(s) and not re.match(r"(?:0[24]|2\d)", s or "")


def api(path, body, timeout=60, retries=3):
    """POST to Firecrawl with retry/backoff on transient network/DNS errors (e.g.
    getaddrinfo failures under load) so a momentary blip never blanks a product.
    Real API errors (HTTP 4xx/5xx) are not retried."""
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                "https://api.firecrawl.dev/v2/" + path,
                data=json.dumps(body).encode(),
                headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529) and attempt < retries - 1:
                last = e  # transient server / rate-limit — back off + retry (matters under --workers)
                time.sleep(min(2 ** attempt, 12))
                continue
            raise  # 402/403/404/400 etc. — a real client error; let the caller handle it
        except Exception as e:  # URLError (DNS/conn reset), timeout, etc. — transient
            last = e
            time.sleep(min(2 ** attempt, 10))
    raise last


def img_search(query):
    res = api("search", {"query": query, "limit": 6, "sources": ["images"]})
    return (res.get("data") or {}).get("images", []), res.get("creditsUsed", 0)


def web_search(query, limit=5, domains=None):
    """Plain web search (pages, not images). Optionally restrict to specific domains
    (used to hit a brand's official site). Returns (page_urls, creditsUsed).
    Tolerant of the response shape: data may be {web:[...]}/{results:[...]} or a bare list,
    and items may be objects (.url) or plain strings — so a v2 shape change degrades to an
    empty list (safe no-op) rather than crashing or silently mis-parsing."""
    body = {"query": query, "limit": limit, "sources": ["web"]}
    # includeDomains requires real domains (with a TLD). OFFICIAL_DOMAINS also holds bare
    # fragments (e.g. "karlie") used only for substring ranking — sending those 400s the API.
    valid = [d for d in (domains or []) if "." in d and " " not in d and "/" not in d]
    if valid:
        body["includeDomains"] = valid
    res = api("search", body)
    data = res.get("data")
    if isinstance(data, dict):
        items = data.get("web") or data.get("results") or data.get("organic") or []
    elif isinstance(data, list):
        items = data
    else:
        items = []
    urls = []
    for r in items:
        u = r if isinstance(r, str) else (r.get("url") if isinstance(r, dict) else None)
        if u:
            urls.append(u)
    return urls, res.get("creditsUsed", 0)


def extract_ref(name):
    """Leading manufacturer article code in the POS name (e.g. B413, AE906/A, LA400,
    00207PR). Normalised to alnum-uppercase; empty if the name has no such code."""
    m = re.match(r"\s*([A-Za-z]{0,4}\d{2,}[A-Za-z0-9/\-]*)", name or "")
    ref = re.sub(r"[^A-Z0-9]", "", (m.group(1) if m else "").upper())
    return ref if len(ref) >= 3 else ""


def ref_ok(ref):
    """Article codes usable for confirmation must contain a letter and be >=4 chars —
    a bare short number (e.g. '400') collides with prices/weights/other SKUs on a page."""
    return bool(ref) and len(ref) >= 4 and bool(re.search(r"[A-Z]", ref))


def _og_image(html):
    """The page's og:image (usually the clean hero shot) — used when the search-result
    image is dead/poor but the confirmed page carries a good product photo."""
    h = html or ""
    for pat in (r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)',
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']'):
        m = re.search(pat, h, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ""


def _grounding(md):
    """Flatten scraped markdown for description grounding, but pull the most description-relevant
    sections — full INGREDIENTS/composition AND analytical constituents/nutrition (a must for food),
    plus DIMENSIONS/size and material — to the FRONT so they survive truncation and reach the writer
    even when they sit far down the page. Composition and nutrition are captured as SEPARATE heads so a
    long ingredient list can't crowd out the macros."""
    flat = re.sub(r"\s+", " ", md or "").strip()
    heads = []
    for pat in (
        r"(?:composition|ingredients)\b.{0,1500}",   # full ingredient list — can run long
        r"(?:analytical constituents|crude protein|protein\s*[:\d]|nutritional additives|"
        r"fat content|crude (?:fat|fibre|ash)|moisture)\b.{0,700}",  # nutrition / macros, captured separately
        r"(?:dimensions?|measurements?|product size|size\s*[:\-]).{0,200}",
        r"\b\d+(?:[.,]\d+)?\s?(?:cm|mm|kg|g|ml|l)\b.{0,120}",  # a stated size/weight + nearby context
        # material / construction / durability features (e.g. a toy's inner nylon rope)
        r"(?:made (?:of|from|with)|material\b|nylon|polyester|cotton|rubber|silicone|ceramic|"
        r"stainless steel|alumini?um|wood(?:en)?|reinforced|inner rope|rope core|chew[- ]?proof|"
        r"heavy[- ]?duty|durable|rugged|tear[- ]?resistant|non[- ]?toxic)\b.{0,220}",
    ):
        m = re.search(pat, flat, re.IGNORECASE)
        if m:
            heads.append(m.group(0).strip())
    prefix = (" | ".join(heads) + " || ") if heads else ""
    return (prefix + flat)[:6000]


FOOD_TYPE = re.compile(r"\b(?:food|treat|snack|biscuit|kibble|wet|dry|dental|milk|paste|meal|chew(?:s|ing)?)\b",
                       re.IGNORECASE)


def _has_comp(text):
    """Does the grounding already carry an ingredient/composition section?"""
    return bool(re.search(r"composition|ingredients|analytical constituents|crude protein", text or "", re.IGNORECASE))


# Generic filler/adjective words in a composition that DON'T distinguish one recipe from another — the
# distinctive part is the protein/flavour. Used so two different flavours of one line don't look alike.
_ING_FILLER = {
    "fresh", "dried", "dehydrated", "frozen", "raw", "whole", "ground", "meal", "meat", "animal",
    "animals", "derivatives", "derivative", "products", "byproducts", "cereals", "cereal", "grain",
    "grains", "rice", "maize", "corn", "wheat", "barley", "oats", "oils", "oil", "fats", "fat",
    "minerals", "mineral", "vegetable", "vegetables", "vegetal", "plant", "protein", "proteins",
    "extract", "extracts", "with", "and", "various", "sugars", "sugar", "additives", "additive",
    "yeast", "yeasts", "fibre", "fiber", "content", "including", "from", "origin", "based", "natural",
    "premium", "quality", "poultry", "starch", "pulp", "flour", "broth", "gravy", "jelly", "sauce",
}
# Recognised protein/flavour words (what a product name usually advertises).
_FLAVORS = {
    "chicken", "beef", "lamb", "turkey", "duck", "salmon", "tuna", "fish", "sardine", "trout",
    "herring", "venison", "rabbit", "pork", "veal", "liver", "kangaroo", "goat", "quail", "mackerel",
    "whitefish", "cod", "shrimp", "prawn", "ocean", "game", "boar", "buffalo", "egg", "cheese",
}


def _lead_distinctive(text):
    """Leading DISTINCTIVE ingredient(s) — the protein/flavour that defines the recipe — with generic
    fillers removed, so corroboration anchors on what actually differs between variants (chicken vs
    lamb), not on shared rice/fats/minerals."""
    m = re.search(r"(?:composition|ingredients)\s*[:\-]?\s*(.{0,160})", text or "", re.IGNORECASE)
    seg = (m.group(1) if m else (text or "")[:160]).lower()
    out = []
    for item in re.split(r"[,;|()]", seg)[:5]:
        for w in re.findall(r"[a-z]{4,}", item):
            if w not in _ING_FILLER:
                out.append(w)
        if out:  # stop at the first item yielding a distinctive token (the dominant ingredient)
            break
    return out[:2]


def _ings_agree(a, b):
    """Corroborate ONLY when the leading distinctive ingredient (the defining protein/flavour) matches —
    so lamb-vs-turkey (sharing only rice/maize) does NOT agree, and a generic 'meat and animal
    derivatives' label (no distinctive token) cannot corroborate at all."""
    la, lb = _lead_distinctive(a), _lead_distinctive(b)
    return bool(la and lb and (set(la) & set(lb)))


def _flavor_consistent(name, comp_text):
    """A non-barcode composition is trusted (green) only if the product NAME's flavour, when it has one,
    actually appears in the composition — catches a wrong-variant pull (a 'Lamb' product whose fetched
    composition contains no lamb). No flavour word in the name -> nothing to contradict."""
    nf = {f for f in _FLAVORS if re.search(r"\b" + f + r"\b", (name or "").lower())}
    if not nf:
        return True
    seg = (comp_text or "").lower()
    return any(re.search(r"\b" + f + r"\b", seg) for f in nf)


def base_domain(host):
    """Registrable domain (drops subdomains): emea.acana.com and www.acana.com both -> acana.com."""
    parts = (host or "").split(".")
    if len(parts) <= 2:
        return host or ""
    if len(parts[-1]) == 2 and parts[-2] in ("co", "com", "org", "net", "gov", "ac", "edu"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _site_key(host):
    """Brand label of a host, ignoring subdomains AND TLD, so different regional TLDs of one brand
    (orijenpetfoods.com vs orijenpetfoods.co.uk) are recognised as the SAME source, not independent."""
    b = base_domain(host)
    return b.split(".")[0] if b else ""


def page_confirms(page_url, variants, ref, bt, allow_ref):
    """Scrape once (markdown for grounding + rawHtml for structured data). Confirm identity by
    GTIN — found in the page's structured data / raw HTML (JSON-LD gtin/mpn, meta, data-attrs)
    OR in visible text — or by (article code + brand). Matched on digit/code boundaries so a
    chance overlap can't mint a false 'verified'.
    Returns (key|None, credits, grounding excerpt, og:image url)."""
    res = api("scrape", {"url": page_url, "formats": ["markdown", "rawHtml"], "onlyMainContent": True})
    data = res.get("data") or {}
    md = data.get("markdown", "") or ""
    html = data.get("rawHtml", "") or ""
    used = res.get("creditsUsed", 1)
    excerpt = _grounding(md)
    og = _og_image(html)
    # GTIN in structured data / raw HTML (contiguous) or visible text (spaces tolerated).
    if variants and (gtin_in(html, variants, contiguous=True) or gtin_in(md, variants, contiguous=False)):
        return "ean", used, excerpt, og
    # Article code: letter-bearing, brand present on page, matched on a code boundary.
    if allow_ref and ref_ok(ref) and bt and (bt & toks(md)):
        pat = r"(?<![A-Z0-9])" + r"[^A-Z0-9]*".join(re.escape(c) for c in ref) + r"(?![A-Z0-9])"
        if re.search(pat, md.upper()):
            return "ref", used, excerpt, og
    return None, used, excerpt, og


def fetch_grounding(url):
    """Scrape a page's main text for description grounding (no confirmation logic — identity is
    already proven). Returns (excerpt, creditsUsed). Used to ground the rows that were verified
    without a scrape (barcode-in-filename shortcut, vision) so their description still draws from
    the same source as the image."""
    res = api("scrape", {"url": url, "formats": ["markdown"], "onlyMainContent": True})
    md = (res.get("data") or {}).get("markdown", "") or ""
    return _grounding(md), res.get("creditsUsed", 1)


def image_check(url):
    """Fetch the image once and judge it. Returns (live, good):
      live = the URL actually serves an image (200 + image content-type) — a kept row must
             never point at a dead/blocked link;
      good = live AND a usable full-product photo: at least MIN_IMG_PX on the short side
             (not a thumbnail/icon) and within MAX_IMG_RATIO (not a banner or sliver crop).
    Plain HTTP, no Firecrawl credit. If Pillow is unavailable the quality test is skipped
    (good follows live) so the gate can never block a run for a missing dependency."""
    if not url:
        return False, False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as r:
            if r.status != 200 or "image" not in r.headers.get("Content-Type", "").lower():
                return False, False
            data = r.read(5_000_000)  # cap the download; enough to read any sane product photo
    except Exception:
        return False, False
    if not _PILImage:
        return True, True
    try:
        w, h = _PILImage.open(io.BytesIO(data)).size
    except Exception:
        return True, False  # bytes served but unreadable as an image -> live, not trusted
    short, long_ = min(w, h), max(w, h)
    good = short >= MIN_IMG_PX and (long_ / max(short, 1)) <= MAX_IMG_RATIO
    return True, good


def _vision_image_block(url):
    """Build the image content block for a vision call. Fetch + downscale to VISION_MAX_PX on the
    long edge and send as base64 (bounds image-token cost — a high-res photo is ~3x the tokens of a
    1024px one). Falls back to a URL block if Pillow is missing; returns None if we have nothing
    usable (so the caller fails open to 'no')."""
    if not url:
        return None
    if not _PILImage:
        return {"type": "image", "source": {"type": "url", "url": url}}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read(8_000_000)
        im = _PILImage.open(io.BytesIO(data)).convert("RGB")
        w, h = im.size
        long_ = max(w, h)
        if long_ > VISION_MAX_PX:
            scale = VISION_MAX_PX / long_
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
        b64 = base64.standard_b64encode(buf.getvalue()).decode()
        return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}}
    except Exception:
        return {"type": "image", "source": {"type": "url", "url": url}}


def vision_assess(img_url, name, brand, ptype):
    """Ask Opus vision to judge an image for THIS product on three axes -> dict
    {match, single, whole, confidence, reason}. Conservative + fail-open: any error/missing key
    returns all-false, so a vision hiccup can never fabricate a pass or a quality verdict."""
    fail = {"match": False, "single": False, "whole": False, "confidence": 0.0, "reason": "no-vision"}
    if not (ANTHROPIC_KEY and img_url):
        return fail
    block = _vision_image_block(img_url)
    if not block:
        return fail
    prompt = (
        "You inspect product photos for a pet-shop catalogue. "
        f'Claimed product: name="{name}" brand="{brand or "n/a"}" category="{ptype or "n/a"}".\n'
        "Judge the image on three axes, strictly:\n"
        "1. match — does it clearly show THIS product (same brand and item type, and "
        "variant/flavour/size if discernible)? A different brand/product, a generic stock photo, "
        "or packaging you cannot match = false.\n"
        "2. single — is exactly ONE unit shown, OR a coherent multipack/set that IS this SKU "
        "(e.g. a 24-can tray sold as one)? Mark false when the SAME item is repeated purely as a "
        "marketing arrangement (e.g. three identical bags fanned out side by side).\n"
        "3. whole — is the entire product visible, not cropped or cut off at an edge?\n"
        'Reply ONLY with JSON: {"match": true|false, "single": true|false, "whole": true|false, '
        '"confidence": 0.0-1.0, "reason": "<short>"}.'
    )
    body = json.dumps({
        "model": VISION_MODEL, "max_tokens": 300,
        "messages": [{"role": "user", "content": [block, {"type": "text", "text": prompt}]}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    data = None
    for attempt in range(3):  # back off on rate-limit/5xx so parallel load can't fail-open to a wrong verdict
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                data = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529) and attempt < 2:
                time.sleep(min(2 ** attempt, 12))
                continue
            if DEBUG:
                print(f"  vision http {e.code}")
            return fail
        except Exception as e:  # transient network — retry, then give up (fail-open to no-match)
            if attempt < 2:
                time.sleep(min(2 ** attempt, 12))
                continue
            if DEBUG:
                print(f"  vision err: {e}")
            return fail
    try:
        text = data["content"][0]["text"].strip()
        if text.startswith("```"):
            text = re.sub(r"^json\s*", "", text.split("```")[1].strip())
        obj = json.loads(text)
        return {
            "match": bool(obj.get("match")),
            "single": bool(obj.get("single")),
            "whole": bool(obj.get("whole")),
            "confidence": float(obj.get("confidence", 0) or 0),
            "reason": str(obj.get("reason", ""))[:120],
        }
    except Exception as e:
        if DEBUG:
            print(f"  vision parse err: {e}")
        return fail


def img_pref(url):
    """Reliability preference for an image HOST (higher = better). Once identity is confirmed we'd
    rather show the same product from a fast https / well-known CDN than from a flaky plain-http or
    obscure host that times out — a verified row with an unloadable image is useless."""
    u = (url or "").lower()
    s = 0.5 if u.startswith("https") else -0.5  # plain http hosts are disproportionately flaky
    if re.search(r"media-amazon|images-amazon|ssl-images-amazon|cdn\.shopify|shopify|cloudfront|"
                 r"\bcdn\b|imgix|akamai|googleusercontent|scene7|cloudinary", u):
        s += 0.3
    return s


def score(cand, core, bt, offdoms):
    """0..1 relevance. Product-match is measured from the TITLE only (URL paths like
    '/fish/' otherwise leak category words and inflate the match); the URL contributes
    pet-domain + source-preference signals."""
    title = (cand.get("title", "") or "").lower()
    url = (cand.get("url", "") or "").lower()
    dom = domain_of(url)
    tt = toks(title)
    petsig = bool(PET_SIG.search(title + " " + url))
    brandhit = bool(bt & tt)
    base = (len(core & tt) / len(core)) if core else (1.0 if brandhit else 0.0)
    if base < MIN_BASE:
        return 0.0  # the product itself didn't match — brand/pet cannot rescue it
    sc = base
    if bt:
        sc += 0.12 if brandhit else -0.20
    if petsig:
        sc += 0.10
    elif not brandhit:
        sc -= 0.15
    if offdoms and any(d in dom for d in offdoms):
        sc += 0.20  # the brand's own official site — prefer it
    elif OFF_DOMAIN.search(dom) and not petsig:
        sc -= 0.30  # clearly wrong-category domain (surgical/craft/candy/...)
    w = cand.get("imageWidth") or 0
    if w and w < 150:
        sc *= 0.5
    return max(0.0, min(1.0, sc))


def ranked(images, core, bt, offdoms):
    """All candidates with score >= MIN_BASE, best first. Logo/banner/placeholder image URLs
    are dropped here so they never enter the pool."""
    out = [(score(im, core, bt, offdoms), im) for im in images
           if im.get("imageUrl") and is_product_image(im["imageUrl"])]
    out = [(s, im) for s, im in out if s > 0]
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def main():
    products = json.load(open(IN, encoding="utf-8"))
    done = {}
    if os.path.exists(OUT):
        done = {int(k): v for k, v in json.load(open(OUT, encoding="utf-8")).items()}
    state = {"credits": sum(v.get("credits", 0) for v in done.values()),
             "vision_calls": sum(v.get("vision", 0) for v in done.values())}
    lock = threading.Lock()  # guards the shared counters + done/flush when WORKERS > 1

    def process(p):
        """Resolve one product. Returns (rec, kind) to store, or (None, 'retry') when a
        network error left us with nothing — that row is NOT recorded, so a later sweep
        retries it instead of falsely concluding 'no-results'."""
        with lock:
            if state["credits"] >= CREDIT_CAP:
                return None, "capped"  # spend ceiling — leave unrecorded so a resume continues here
        bc = (p["barcode"] or "").split(".")[0].strip()  # tolerate float artifacts like '5350...3.00'
        ean = bc if reliable_gtin(bc) else None
        variants = gtin_variants(ean)
        ref = extract_ref(p["name"])
        core = toks(p["clean"]) - brand_toks(p["brand"])
        bt = brand_toks(p["brand"])
        offdoms = official_domains_for(p["brand"])
        chosen = None
        had_error = False
        pool = {}  # imageUrl -> (score, image, via)
        img_memo = {}
        scraped = set()  # page URLs already scraped this product (don't pay twice)
        acc = {"credits": 0, "vision": 0}  # this product's own spend (thread-owned, no lock needed)
        t0 = time.time()  # per-product clock; later stages/scrapes are skipped once past PRODUCT_BUDGET

        def spend(c):  # tally credits per-product (for the rec) AND globally (cap check + live total)
            acc["credits"] += c
            with lock:
                state["credits"] += c

        def vbump():
            acc["vision"] += 1
            with lock:
                state["vision_calls"] += 1

        def img_ok(u):
            """(live, good) for an image URL, fetched at most once per product."""
            if u not in img_memo:
                img_memo[u] = image_check(u)
            return img_memo[u]

        def add(images, via):
            for s, im in ranked(images, core, bt, offdoms):
                u = im["imageUrl"]
                if u not in pool or s > pool[u][0]:
                    pool[u] = (s, im, via)

        def tier(confirmed_doms, is_off):
            return "verified-official" if is_off else ("verified-cross" if len(confirmed_doms) >= 2 else "verified")

        def verify_top():
            """Confirm a ranked image candidate. 0) the GTIN in the image filename/URL needs no
            scrape; 1) else scrape the top-3 pages for GTIN (structured/text) or article code.
            Returns a chosen tuple with a LIVE image, preferring a good full-product photo."""
            cands = sorted(pool.values(), key=lambda x: x[0], reverse=True)
            # 0) image filename / page URL literally carries the barcode -> the picture IS it.
            if variants:
                for s, im, via in cands:
                    if (gtin_in(im["imageUrl"], variants) or gtin_in(im.get("url", ""), variants)) \
                            and img_ok(im["imageUrl"])[0]:
                        return (s, im, via, "verified", "ean-url", "")
            # 1) scrape + confirm
            confirmed, checked = [], 0
            for s, im, via in cands:
                if time.time() - t0 > PRODUCT_BUDGET:
                    break
                pg = im.get("url")
                if not pg or pg in scraped or checked >= 3:
                    continue
                scraped.add(pg)
                checked += 1
                try:
                    key, vc, excerpt, og = page_confirms(pg, variants, ref, bt, bool(core))
                    spend(vc)
                except Exception:
                    continue
                if key:
                    dom = domain_of(pg)
                    is_off = bool(offdoms) and any(d in dom for d in offdoms)
                    confirmed.append((s, im, via, dom, is_off, key, excerpt, og))
                    if is_off:
                        break  # official-site confirmation is the best obtainable
            return _pick_confirmed(confirmed)

        def verify_urls(urls, via):
            """Confirm via given PAGE urls (web-search results, which have no image of their own):
            scrape, confirm, and take the page's og:image as the product photo."""
            confirmed, checked = [], 0
            for pg in urls:
                if time.time() - t0 > PRODUCT_BUDGET:
                    break
                if not pg or pg in scraped or checked >= 3:
                    continue
                scraped.add(pg)
                checked += 1
                try:
                    key, vc, excerpt, og = page_confirms(pg, variants, ref, bt, bool(core))
                    spend(vc)
                except Exception:
                    continue
                if key and og and is_product_image(og):
                    dom = domain_of(pg)
                    is_off = bool(offdoms) and any(d in dom for d in offdoms)
                    im = {"imageUrl": og, "url": pg, "title": ""}
                    confirmed.append((0.78, im, via, dom, is_off, key, excerpt, og))
                    if is_off:
                        break
            return _pick_confirmed(confirmed)

        def _pick_confirmed(confirmed):
            """Tier the confirmed candidates, then choose the image — but ONLY from a page we
            actually verified on (the candidate's own product image or that page's og:image). An
            image from a different site is NOT honestly 'barcode-verified', so we never substitute
            one here; if no confirmed-page image loads we return None and the row falls back to the
            `likely` tier (where the vision pass may re-confirm it as `verified-visual`). Among the
            confirmed-page images, prefer the most reliable host (https/CDN) and a good full photo
            over a flaky plain-http link that times out."""
            if not confirmed:
                return None
            confirmed.sort(key=lambda x: (x[4], x[0]), reverse=True)
            conf = tier({c[3] for c in confirmed}, confirmed[0][4])
            key, excerpt = confirmed[0][5], confirmed[0][6]
            opts = {}  # imageUrl -> (score, im_dict, via); same-page images only
            for s, im, via, dom, isoff, k, exc, og in confirmed:
                for u, idict in ((im["imageUrl"], im),
                                 (og, {"imageUrl": og, "url": im.get("url", ""), "title": im.get("title", "")})):
                    if u and is_product_image(u) and (u not in opts or s > opts[u][0]):
                        opts[u] = (s, idict, via)
            ranked_opts = sorted(opts.items(), key=lambda kv: (img_pref(kv[0]), kv[1][0]), reverse=True)
            for want_good in (True, False):  # reliable+good first, then reliable+live
                for u, (s, im, via) in ranked_opts:
                    live, good = img_ok(u)
                    if (good if want_good else live):
                        return (s, im, via, conf, key, excerpt)
            return None

        def quality_pass(chosen):
            """Vision-judge the chosen image for single-product + uncropped (and identity for an
            unconfirmed tier). On failure, try up to MAX_QUALITY_ALTS clean pooled alternates.
            Returns (chosen, img_provenance, img_quality). Accuracy rules:
              - a real barcode confirmation is NEVER discarded for an unproven image: a verified row
                swaps only to a same-page clean image or an off-source one vision is very sure of
                (>= VISION_STRICT_CONF); otherwise it keeps its image and just flags the quality;
              - any GREEN minted by vision alone (verified-visual) needs >= VISION_STRICT_CONF."""
            s, im, via, conf, key, excerpt = chosen
            if state["vision_calls"] >= VISION_CALL_CAP:
                return chosen, "", ""  # spend ceiling reached — leave the row as resolved
            barcode_verified = conf in ("verified-official", "verified-cross", "verified")
            src_dom = domain_of(im.get("url", ""))
            base_prov = "official" if (offdoms and any(d in src_dom for d in offdoms)) else "source"

            a = vision_assess(im["imageUrl"], p["clean"], p["brand"], p["type"])
            vbump()
            ident_ok = barcode_verified or (a["match"] and a["confidence"] >= VISION_MIN_CONF)
            if ident_ok and a["single"] and a["whole"]:  # primary image is clean and is the product
                if conf == "likely":  # unconfirmed identity — vision mints green only when very sure
                    if a["confidence"] >= VISION_STRICT_CONF:
                        return (s, im, via, "verified-visual", "vision", excerpt), "ai-matched", ""
                    return chosen, "", ""  # clean but not sure enough — stays likely (its own image)
                return chosen, base_prov, ""

            # primary failed (quality, or identity on a likely row) — hunt a clean pooled alternate.
            seen, tried = {im["imageUrl"]}, 0
            for cs, cim, cvia in sorted(pool.values(), key=lambda x: x[0], reverse=True):
                if tried >= MAX_QUALITY_ALTS:
                    break
                cu = cim["imageUrl"]
                if cu in seen or not is_product_image(cu) or not img_ok(cu)[1]:
                    continue
                seen.add(cu)
                tried += 1
                ca = vision_assess(cu, p["clean"], p["brand"], p["type"])
                vbump()
                if not (ca["match"] and ca["single"] and ca["whole"]):
                    continue
                cdom = domain_of(cim.get("url", ""))
                same = bool(cdom) and cdom == src_dom
                strong = ca["confidence"] >= VISION_STRICT_CONF
                prov = base_prov if same else ("off-source:" + cdom)
                if barcode_verified:
                    # keep the barcode tier; swap only to a same-page image or an off-source one we
                    # are very sure of — never discard a barcode confirmation for an unproven picture.
                    if same or strong:
                        return (s, cim, cvia, conf, key, excerpt), prov, ""
                    continue
                # likely row: vision is the only identity signal. Green only when very sure.
                if strong:
                    return (s, cim, cvia, "verified-visual", "vision", excerpt), prov, ""
                return (s, cim, cvia, "likely", "", excerpt), prov, ""

            # no clean alternate. Keep the primary image; flag the quality issue for manual swap.
            if conf == "likely" and not ident_ok:
                return chosen, base_prov, ""  # unconfirmed + unclear photo — already yellow, no extra tag
            quality = "multi" if not a["single"] else ("crop" if not a["whole"] else "unclear")
            return chosen, base_prov, quality

        try:
            if ean or ref:  # Stage 1: barcode/code image search + confirm
                imgs, c = img_search(ean or (p["brand"] + " " + ref))
                spend(c)
                add(imgs, "barcode")
                chosen = verify_top()
            if not chosen and ean and time.time() - t0 < PRODUCT_BUDGET:  # Stage 2: EAN web search (official-scoped first, then general)
                urls = []
                scoped = [d for d in offdoms if "." in d]  # real domains only (bare frags can't scope)
                if scoped:
                    w, c = web_search(f'{ean} {p["brand"]}', domains=scoped)
                    spend(c)
                    urls += w
                w, c = web_search(ean)
                spend(c)
                urls += w
                # dedupe preserving order
                seen, ordered = set(), []
                for u in urls:
                    if u not in seen:
                        seen.add(u)
                        ordered.append(u)
                if DEBUG and not ordered:
                    print(f"  row {p['row']} ean-web: 0 page urls (stage no-op)")
                chosen = verify_urls(ordered[:6], "ean-web")
            if not chosen and time.time() - t0 < PRODUCT_BUDGET:  # Stage 3: name image search to broaden, confirm again
                parts = [p["brand"], p["clean"], p["type"]]
                if not bt:
                    parts.append("pet")
                imgs, c = img_search(" ".join(filter(None, parts)) or p["clean"])
                spend(c)
                add(imgs, "name")
                chosen = verify_top()
        except Exception as e:
            had_error = True
            print(f"  row {p['row']} search err: {e}")

        order = sorted(pool.values(), key=lambda x: x[0], reverse=True)
        # Stage 4: unverified fallback — top candidate that clears the bar AND has a good
        # full-product image (identity unconfirmed, so a crop/thumbnail is not worth showing).
        if not chosen and core:
            for s, im, via in order:
                if s < THRESHOLD:
                    break
                if img_ok(im["imageUrl"])[1]:
                    chosen = (s, im, via, "likely", "", "")
                    break

        # Stage 5 (opt-in `--vision`): quality + identity judgement on the chosen image. May swap a
        # multi-pack/cropped image for a clean pooled alternate (tagged when off-source), promote a
        # `likely` whose image vision confirms, or flag an unfixable image for manual swap.
        img_provenance, img_quality = "", ""
        if VISION and ANTHROPIC_KEY and chosen and chosen[1].get("imageUrl"):
            chosen, img_provenance, img_quality = quality_pass(chosen)

        # Description grounding + provenance. A verified row draws its description from the SAME page
        # the identity/image came from; a row with thin/no page text gets ONE bounded trusted-source
        # fetch so the description can still cite real specifics (tagged `supplemented`).
        desc_provenance = ""
        if chosen:
            excerpt = chosen[5]
            src_url = chosen[1].get("url")
            if chosen[3].startswith("verified") and not excerpt and src_url and src_url not in scraped:
                scraped.add(src_url)
                try:
                    exc, vc = fetch_grounding(src_url)
                    spend(vc)
                    if exc:
                        excerpt = exc
                        chosen = chosen[:5] + (exc,)
                except Exception as e:
                    if DEBUG:
                        print(f"  row {p['row']} grounding fetch failed: {e}")
            desc_provenance = "source" if excerpt else ""
            # Supplement ONLY identity-confirmed rows: enriching a `likely` row's description with
            # specifics from a name-matched page risks describing a different variant (false advert).
            # Two triggers: (a) thin/empty grounding; (b) a FOOD/TREAT whose page carries no composition
            # (the barcode often confirms on a retailer listing without ingredients) -> fetch the brand's
            # ingredients page so the full composition + analytical constituents reach the writer.
            is_food = bool(FOOD_TYPE.search(p["type"] or ""))
            ingredients_src = "source" if (is_food and _has_comp(excerpt)) else ""  # where composition came from
            thin = len(excerpt or "") < GROUND_MIN
            need_comp = is_food and not _has_comp(excerpt)
            if chosen[3].startswith("verified") and (thin or need_comp) and (core or bt) \
                    and time.time() - t0 < PRODUCT_BUDGET:
                q = " ".join(filter(None, [p["brand"], p["clean"], p["type"]]))
                if need_comp:
                    q += " ingredients composition"
                try:
                    urls = []
                    scoped = [d for d in offdoms if "." in d]   # the brand's official domain(s), if known
                    if scoped:
                        w, c = web_search(q, domains=scoped)
                        spend(c)
                        urls += w
                    w, c = web_search(q)
                    spend(c)
                    urls += w
                    seen_u = set()
                    urls = [u for u in urls if not (u in seen_u or seen_u.add(u))]
                    pref = lambda u: (2 if offdoms and any(x in domain_of(u) for x in offdoms)
                                      else (1 if PET_SIG.search(u) else 0))
                    cands = [u for u in sorted(urls, key=pref, reverse=True)
                             if u not in scraped and not OFF_DOMAIN.search(domain_of(u))]
                    nm = []  # name-matched composition from DISTINCT domains: [(dom, comp_text, merged)]
                    for u in cands[:2]:
                        if time.time() - t0 > PRODUCT_BUDGET:
                            break
                        scraped.add(u)
                        dom = domain_of(u)
                        # barcode-confirm the supplement page with the SAME GTIN check as the main
                        # verification, so a composition we adopt is tied to THIS exact item -> green.
                        key, vc, exc, _og = page_confirms(u, variants, ref, bt, bool(core))
                        spend(vc)
                        if not exc:
                            continue
                        if need_comp and _has_comp(exc):
                            merged = (exc + " || " + (excerpt or ""))[:6000]
                            if key:  # barcode-confirmed -> GREEN (verified for this exact product)
                                excerpt = merged
                                chosen = chosen[:5] + (excerpt,)
                                if thin:
                                    desc_provenance = "source"
                                ingredients_src = "verified:" + dom
                                break
                            if any(x in dom for x in offdoms) and _flavor_consistent(p["name"], exc):
                                excerpt = merged  # brand's OWN site + flavour matches the name -> GREEN
                                chosen = chosen[:5] + (excerpt,)
                                ingredients_src = "official:" + dom
                                break
                            if _site_key(dom) not in [_site_key(d) for d, _, _ in nm]:
                                nm.append((dom, exc, merged))  # independent (distinct-brand) name-matched source
                        elif thin and not need_comp and len(exc) >= GROUND_MIN:  # thin non-food row needs real text
                            excerpt = exc
                            chosen = chosen[:5] + (exc,)
                            desc_provenance = "source" if key else "supplemented:" + dom
                            break
                    if need_comp and not _has_comp(excerpt) and nm:
                        excerpt = nm[0][2]
                        chosen = chosen[:5] + (excerpt,)
                        if (len(nm) >= 2 and _ings_agree(nm[0][1], nm[1][1])
                                and _flavor_consistent(p["name"], nm[0][1])):  # 2 independent + name flavour -> GREEN
                            ingredients_src = "cross:" + nm[0][0] + "+" + nm[1][0]
                        else:                                                  # single / unconfirmed -> YELLOW
                            ingredients_src = "supplemented:" + nm[0][0]
                except Exception as e:
                    if DEBUG:
                        print(f"  row {p['row']} supplement fetch failed: {e}")
            if not excerpt:
                desc_provenance = "name-only"

        rec = {"credits": acc["credits"], "vision": acc["vision"],
               "score": round(order[0][0], 2) if order else 0.0}
        if chosen:
            s, im, via, conf, key, excerpt = chosen
            rec.update(url=im["imageUrl"], src=im.get("url", ""), title=im.get("title", ""),
                       via=via, key=key, score=round(s, 2), confidence=conf,
                       img_provenance=img_provenance, img_quality=img_quality,
                       desc_provenance=desc_provenance, ingredients_src=ingredients_src)
            if excerpt:
                rec["page_text"] = excerpt  # grounds the description with real product info
            return rec, ("ver" if conf.startswith("verified") else "lik")
        if not order and had_error:
            return None, "retry"  # network error, no data — leave for a retry sweep
        top = order[0][1] if order else {}
        rec.update(url="", confidence=None,
                   reason="low-confidence" if order else "no-results",
                   best_title=top.get("title", ""), best_url=top.get("imageUrl", ""))
        return rec, "blank"

    def flush():
        # Atomic: write a temp file then os.replace, so a crash/kill/reboot mid-write can never
        # truncate the checkpoint to invalid JSON and lose all prior (paid-for) progress on resume.
        tmp = OUT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({str(k): v for k, v in done.items()}, f, ensure_ascii=False, indent=0)
        os.replace(tmp, OUT)

    capped = False
    # Self-healing sweeps: anything left unrecorded (network errors) is retried up to 4x. Within a
    # sweep, products are independent, so we fan them out across WORKERS threads (the work is almost
    # all network wait). A row hitting the credit cap returns "capped" and is left unrecorded so a
    # resume picks up exactly where this run stopped.
    for sweep in range(4):
        todo = [p for p in products if p["row"] not in done]
        if not todo:
            break
        print(f"sweep {sweep + 1}: {len(todo)} to process "
              f"(cap {CREDIT_CAP}, workers {WORKERS}, vision={'on' if VISION else 'off'})")
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = {ex.submit(process, p): p for p in todo}
            for fut in as_completed(futs):
                p = futs[fut]
                try:
                    rec, kind = fut.result()
                except Exception as e:  # an unexpected crash -> leave unrecorded for the next sweep
                    if DEBUG:
                        print(f"  row {p['row']} crashed: {e}")
                    continue
                if kind == "capped":
                    capped = True
                    continue
                if kind == "retry":
                    continue  # not recorded -> next sweep re-attempts it
                with lock:
                    done[p["row"]] = rec
                    flush()
                    nd = len(done)
                    cr, vca = state["credits"], state["vision_calls"]
                if nd % 10 == 0:
                    v = sum(1 for x in done.values() if (x.get("confidence") or "").startswith("verified"))
                    l = sum(1 for x in done.values() if x.get("confidence") == "likely")
                    print(f"  {nd} done | {v} verified | {l} likely | {cr} credits | {vca} vision")
        if capped:
            print(f"!! credit cap reached at {len(done)} products -- stopping (resume to continue)")
            break
    # Finalize stragglers that errored through every sweep, so a resume terminates cleanly — but NOT
    # when we stopped on the cap (those rows aren't failures, just not-yet-reached).
    if not capped:
        for p in products:
            if p["row"] not in done:
                done[p["row"]] = {"credits": 0, "vision": 0, "score": 0.0, "url": "", "confidence": None,
                                  "reason": "no-results-after-retries"}
    flush()
    vv = sum(1 for x in done.values() if x.get("confidence") == "verified-visual")
    v = sum(1 for x in done.values() if (x.get("confidence") or "").startswith("verified"))
    l = sum(1 for x in done.values() if x.get("confidence") == "likely")
    print(f"DONE: {len(done)} | {v} verified (incl. {vv} image-AI) + {l} likely = {v + l} kept "
          f"({100 * (v + l) // max(len(done), 1)}%) | {state['credits']} credits | {state['vision_calls']} vision calls")


if __name__ == "__main__":
    main()
