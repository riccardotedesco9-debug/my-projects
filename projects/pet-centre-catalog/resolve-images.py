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
  5. VISION (opt-in `--vision`): for a remaining `likely`, ask Haiku vision whether the photo IS
     the product; a strict yes -> its own tier `verified-visual` (trusted, but labelled distinctly
     from a barcode confirmation). Never overrides a name mismatch.

Tiers: verified-official > verified-cross (2+ domains) > verified > verified-visual > likely > blank.
Anything not confidently matched is left blank + flagged. Resumable; hard credit cap.
Reads FIRECRAWL_API_KEY (and ANTHROPIC_API_KEY if --vision) from env (inject via `op run`).

Usage: python resolve-images.py <in_json> <out_json> [credit_cap] [threshold] [--vision]
"""
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

try:
    from PIL import Image as _PILImage
except Exception:  # Pillow missing -> quality gate degrades to liveness-only (never blocks)
    _PILImage = None

IN = sys.argv[1]
OUT = sys.argv[2]
CREDIT_CAP = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].lstrip("-").isdigit() else 35000
THRESHOLD = float(sys.argv[4]) if len(sys.argv) > 4 and re.fullmatch(r"[0-9.]+", sys.argv[4]) else 0.55
VISION = "--vision" in sys.argv
DEBUG = "--debug" in sys.argv or os.environ.get("RI_DEBUG") == "1"
MIN_BASE = 0.30  # distinctive product tokens must overlap at least this much
MIN_IMG_PX = 250    # short side below this is a thumbnail/icon, not a usable product photo
MAX_IMG_RATIO = 3.0  # wider/taller than this is a banner or sliver crop, not a full product
VISION_MODEL = "claude-haiku-4-5-20251001"
VISION_MIN_CONF = 0.8  # vision must be at least this sure before it may promote a likely

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


def api(path, body, timeout=90, retries=4):
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
        except urllib.error.HTTPError:
            raise  # genuine API response (402/403/429/5xx) — let the caller handle it
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
    excerpt = re.sub(r"\s+", " ", md)[:1800]
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
    return re.sub(r"\s+", " ", md)[:1800], res.get("creditsUsed", 1)


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


def vision_confirm(img_url, name, brand, ptype):
    """Ask Haiku vision whether the image really shows this product. Conservative: True only on
    an explicit high-confidence yes. Fail-open to False on any error/missing key, so a vision
    hiccup can never fabricate a verification."""
    if not (ANTHROPIC_KEY and img_url):
        return False
    prompt = (
        "You verify product photos for a pet-shop catalogue.\n"
        f'Claimed product: name="{name}" brand="{brand or "n/a"}" category="{ptype or "n/a"}".\n'
        "Look at the image. Does it clearly show THIS product — same brand and same item type "
        "(and variant/flavour/size if discernible)? Be strict: if it's a different brand, a "
        "different product, a generic/stock photo, packaging you cannot match, or you are unsure, "
        "answer no.\n"
        'Reply ONLY with JSON: {"match": true|false, "confidence": 0.0-1.0, "reason": "<short>"}.'
    )
    body = json.dumps({
        "model": VISION_MODEL, "max_tokens": 200,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "url", "url": img_url}},
            {"type": "text", "text": prompt},
        ]}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        text = data["content"][0]["text"].strip()
        if text.startswith("```"):
            text = re.sub(r"^json\s*", "", text.split("```")[1].strip())
        obj = json.loads(text)
        return bool(obj.get("match")) and float(obj.get("confidence", 0)) >= VISION_MIN_CONF
    except Exception as e:
        print(f"  vision err: {e}")
        return False


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
    state = {"credits": sum(v.get("credits", 0) for v in done.values()), "vision_calls": 0}

    def process(p):
        """Resolve one product. Returns (rec, kind) to store, or (None, 'retry') when a
        network error left us with nothing — that row is NOT recorded, so a later sweep
        retries it instead of falsely concluding 'no-results'."""
        ean = p["barcode"] if reliable_gtin(p["barcode"]) else None
        variants = gtin_variants(ean)
        ref = extract_ref(p["name"])
        core = toks(p["clean"]) - brand_toks(p["brand"])
        bt = brand_toks(p["brand"])
        offdoms = official_domains_for(p["brand"])
        cr0 = state["credits"]
        chosen = None
        had_error = False
        pool = {}  # imageUrl -> (score, image, via)
        img_memo = {}
        scraped = set()  # page URLs already scraped this product (don't pay twice)

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
                pg = im.get("url")
                if not pg or pg in scraped or checked >= 3:
                    continue
                scraped.add(pg)
                checked += 1
                try:
                    key, vc, excerpt, og = page_confirms(pg, variants, ref, bt, bool(core))
                    state["credits"] += vc
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
                if not pg or pg in scraped or checked >= 3:
                    continue
                scraped.add(pg)
                checked += 1
                try:
                    key, vc, excerpt, og = page_confirms(pg, variants, ref, bt, bool(core))
                    state["credits"] += vc
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

        try:
            if ean or ref:  # Stage 1: barcode/code image search + confirm
                imgs, c = img_search(ean or (p["brand"] + " " + ref))
                state["credits"] += c
                add(imgs, "barcode")
                chosen = verify_top()
            if not chosen and ean:  # Stage 2: EAN web search (official-scoped first, then general)
                urls = []
                scoped = [d for d in offdoms if "." in d]  # real domains only (bare frags can't scope)
                if scoped:
                    w, c = web_search(f'{ean} {p["brand"]}', domains=scoped)
                    state["credits"] += c
                    urls += w
                w, c = web_search(ean)
                state["credits"] += c
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
            if not chosen:  # Stage 3: name image search to broaden, confirm again
                parts = [p["brand"], p["clean"], p["type"]]
                if not bt:
                    parts.append("pet")
                imgs, c = img_search(" ".join(filter(None, parts)) or p["clean"])
                state["credits"] += c
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

        # Stage 5 (opt-in): vision tie-breaker — promote a `likely` to `verified-visual` only on
        # a strict high-confidence image match. Conservative, name already agreed (cleared score).
        if VISION and ANTHROPIC_KEY and chosen and chosen[3] == "likely":
            state["vision_calls"] += 1
            if vision_confirm(chosen[1]["imageUrl"], p["clean"], p["brand"], p["type"]):
                s, im, via, _, _, _ = chosen
                chosen = (s, im, via, "verified-visual", "vision", "")

        # Ground EVERY verified row's description in its own source page, so the description shares
        # the image's provenance. Scrape-confirmed rows already carry page_text; the filename-
        # shortcut (`ean-url`) and vision-confirmed rows don't — fetch it from the chosen image's
        # source page now (one scrape) so green = image AND a page-grounded description.
        if chosen and chosen[3].startswith("verified") and not chosen[5]:
            src_url = chosen[1].get("url")
            if src_url and src_url not in scraped:
                scraped.add(src_url)
                try:
                    exc, vc = fetch_grounding(src_url)
                    state["credits"] += vc
                    if exc:
                        chosen = chosen[:5] + (exc,)
                except Exception as e:
                    if DEBUG:
                        print(f"  row {p['row']} grounding fetch failed: {e}")

        rec = {"credits": state["credits"] - cr0, "score": round(order[0][0], 2) if order else 0.0}
        if chosen:
            s, im, via, conf, key, excerpt = chosen
            rec.update(url=im["imageUrl"], src=im.get("url", ""), title=im.get("title", ""),
                       via=via, key=key, score=round(s, 2), confidence=conf)
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
        json.dump({str(k): v for k, v in done.items()}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    capped = False
    # Self-healing sweeps: anything left unrecorded (network errors) is retried up to 4x.
    for sweep in range(4):
        todo = [p for p in products if p["row"] not in done]
        if not todo:
            break
        print(f"sweep {sweep + 1}: {len(todo)} to process (cap {CREDIT_CAP}, vision={'on' if VISION else 'off'})")
        for n, p in enumerate(todo):
            if state["credits"] >= CREDIT_CAP:
                print(f"!! credit cap reached at {len(done)} products -- stopping")
                capped = True
                break
            rec, kind = process(p)
            if kind == "retry":
                continue  # not recorded -> next sweep re-attempts it
            done[p["row"]] = rec
            flush()
            if (n + 1) % 10 == 0:
                v = sum(1 for x in done.values() if (x.get("confidence") or "").startswith("verified"))
                l = sum(1 for x in done.values() if x.get("confidence") == "likely")
                print(f"  {len(done)} done | {v} verified | {l} likely | {state['credits']} credits")
            time.sleep(0.3)
        if capped:
            break
    # Finalize stragglers that errored through every sweep, so a resume terminates cleanly.
    for p in products:
        if p["row"] not in done:
            done[p["row"]] = {"credits": 0, "score": 0.0, "url": "", "confidence": None,
                              "reason": "no-results-after-retries"}
    flush()
    vv = sum(1 for x in done.values() if x.get("confidence") == "verified-visual")
    v = sum(1 for x in done.values() if (x.get("confidence") or "").startswith("verified"))
    l = sum(1 for x in done.values() if x.get("confidence") == "likely")
    print(f"DONE: {len(done)} | {v} verified (incl. {vv} image-AI) + {l} likely = {v + l} kept "
          f"({100 * (v + l) // max(len(done), 1)}%) | {state['credits']} credits | {state['vision_calls']} vision calls")


if __name__ == "__main__":
    main()
