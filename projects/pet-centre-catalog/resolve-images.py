#!/usr/bin/env python
"""Resolve a product image URL per product, accuracy-first.

Hierarchy (descend only when identity isn't confirmed):
  1. BARCODE/code search: query the EAN (or brand+article-code) -> gather candidates.
  2. SOURCE-PREFERENCE ranking: official brand domain ≫ pet domain; off-domain
     (surgical/craft/candy/...) penalised; product match measured from the TITLE only
     (URL category paths otherwise leak words); distinctive product tokens MUST overlap
     (base gate) so brand/pet bonuses can never rescue a wrong product.
  3. PAGE-CONFIRM: scrape the top candidates and confirm identity by EAN, or by
     (article-code + brand) when the EAN isn't printed. Tier by source:
     official-brand domain = `verified-official` > 2+ independent domains =
     `verified-cross` > single page = `verified`. The confirming page's text is captured
     to ground the product description with real specifics.
  4. NAME fallback -> unconfirmed but strong match = `likely`; else blank + flagged.

Anything not confidently matched is left blank + flagged. Resumable; hard credit cap.
Reads FIRECRAWL_API_KEY from env (inject via `op run`).

Usage: python resolve-images.py <in_json> <out_json> [credit_cap] [threshold]
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
CREDIT_CAP = int(sys.argv[3]) if len(sys.argv) > 3 else 35000
THRESHOLD = float(sys.argv[4]) if len(sys.argv) > 4 else 0.55
MIN_BASE = 0.30  # distinctive product tokens must overlap at least this much
MIN_IMG_PX = 250    # short side below this is a thumbnail/icon, not a usable product photo
MAX_IMG_RATIO = 3.0  # wider/taller than this is a banner or sliver crop, not a full product
KEY = os.environ.get("FIRECRAWL_API_KEY")
if not KEY:
    sys.exit("FIRECRAWL_API_KEY not set — run via `op run --env-file=.env.tpl -- python resolve-images.py ...`")

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


def page_confirms(page_url, ean, ref, bt, allow_ref):
    """Scrape the page once; confirm identity by EAN, or by (article code + brand) when
    the EAN isn't printed. Both are matched on token boundaries (never as a substring of a
    longer run) so a chance digit/code overlap can't mint a false 'verified'.
    Returns (key|None, credits, product-info excerpt for grounding)."""
    res = api("scrape", {"url": page_url, "formats": ["markdown"], "onlyMainContent": True})
    md = (res.get("data") or {}).get("markdown", "") or ""
    used = res.get("creditsUsed", 1)
    excerpt = re.sub(r"\s+", " ", md)[:1800]
    # EAN: digits only, tolerating single spaces/hyphens, but not embedded in a longer number.
    if ean and re.search(r"(?<!\d)" + r"[\s\-]?".join(ean) + r"(?!\d)", md):
        return "ean", used, excerpt
    # Article code: letter-bearing, brand present on page, matched on a code boundary
    # (tolerating internal separators like the '/' in 'AE906/A').
    if allow_ref and ref_ok(ref) and bt and (bt & toks(md)):
        pat = r"(?<![A-Z0-9])" + r"[^A-Z0-9]*".join(re.escape(c) for c in ref) + r"(?![A-Z0-9])"
        if re.search(pat, md.upper()):
            return "ref", used, excerpt
    return None, used, excerpt


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
    """All candidates with score >= MIN_BASE, best first."""
    out = [(score(im, core, bt, offdoms), im) for im in images if im.get("imageUrl")]
    out = [(s, im) for s, im in out if s > 0]
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def main():
    products = json.load(open(IN, encoding="utf-8"))
    done = {}
    if os.path.exists(OUT):
        done = {int(k): v for k, v in json.load(open(OUT, encoding="utf-8")).items()}
    state = {"credits": sum(v.get("credits", 0) for v in done.values())}

    def process(p):
        """Resolve one product. Returns (rec, kind) to store, or (None, 'retry') when a
        network error left us with nothing — that row is NOT recorded, so a later sweep
        retries it instead of falsely concluding 'no-results'."""
        ean = p["barcode"] if ean_valid(p["barcode"]) else None
        ref = extract_ref(p["name"])
        core = toks(p["clean"]) - brand_toks(p["brand"])
        bt = brand_toks(p["brand"])
        offdoms = official_domains_for(p["brand"])
        cr0 = state["credits"]
        chosen = None
        had_error = False
        pool = {}  # imageUrl -> (score, image, via)
        img_memo = {}

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

        def verify_top(tried):
            """Scrape the top-3 unseen candidate pages and confirm identity (EAN or
            article-code). Tier by source: official-brand domain > 2+ independent domains
            (cross) > single page. Returns a candidate with a LIVE image only."""
            order = sorted(pool.values(), key=lambda x: x[0], reverse=True)
            confirmed, checked = [], 0
            for s, im, via in order:
                if im["imageUrl"] in tried or not im.get("url") or checked >= 3:
                    continue
                tried.add(im["imageUrl"])
                checked += 1
                try:
                    key, vc, excerpt = page_confirms(im["url"], ean, ref, bt, bool(core))
                    state["credits"] += vc
                except Exception:
                    key, excerpt = None, ""
                if key:
                    dom = domain_of(im["url"])
                    is_off = bool(offdoms) and any(d in dom for d in offdoms)
                    confirmed.append((s, im, via, dom, is_off, key, excerpt))
                    if is_off:
                        break  # official-site confirmation is the best obtainable
            if not confirmed:
                return None
            confirmed.sort(key=lambda x: (x[4], x[0]), reverse=True)
            doms = {c[3] for c in confirmed}
            is_off = confirmed[0][4]
            conf = "verified-official" if is_off else ("verified-cross" if len(doms) >= 2 else "verified")
            key, excerpt = confirmed[0][5], confirmed[0][6]
            # Identity is already proven, so prefer a confirmed candidate with a GOOD
            # full-product image; fall back to one that merely loads (a correct small image
            # still beats blanking a verified product); last resort, a high-confidence
            # same-product image that loads.
            for s, im, via, *_ in confirmed:
                if img_ok(im["imageUrl"])[1]:
                    return (s, im, via, conf, key, excerpt)
            for s, im, via, *_ in confirmed:
                if img_ok(im["imageUrl"])[0]:
                    return (s, im, via, conf, key, excerpt)
            for s2, im2, via2 in sorted(pool.values(), key=lambda x: x[0], reverse=True):
                if s2 >= 0.70 and img_ok(im2["imageUrl"])[0]:
                    return (s2, im2, via2, conf, key, excerpt)
            return None

        tried = set()
        try:
            if ean or ref:  # Stage 1: barcode/code search + verify
                imgs, c = img_search(ean or (p["brand"] + " " + ref))
                state["credits"] += c
                add(imgs, "barcode")
                chosen = verify_top(tried)
            if not chosen:  # Stage 2: name search to broaden, verify again
                parts = [p["brand"], p["clean"], p["type"]]
                if not bt:
                    parts.append("pet")
                imgs, c = img_search(" ".join(filter(None, parts)) or p["clean"])
                state["credits"] += c
                add(imgs, "name")
                chosen = verify_top(tried)
        except Exception as e:
            had_error = True
            print(f"  row {p['row']} search err: {e}")

        order = sorted(pool.values(), key=lambda x: x[0], reverse=True)
        # Stage 3: unverified fallback — top candidate that clears the bar AND has a good
        # full-product image (identity is unconfirmed here, so a zoomed crop or thumbnail is
        # not worth showing). Only for products with distinctive tokens; brand-only stays blank.
        if not chosen and core:
            for s, im, via in order:
                if s < THRESHOLD:
                    break
                if img_ok(im["imageUrl"])[1]:
                    chosen = (s, im, via, "likely", "", "")
                    break

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
        print(f"sweep {sweep + 1}: {len(todo)} to process (cap {CREDIT_CAP})")
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
    v = sum(1 for x in done.values() if (x.get("confidence") or "").startswith("verified"))
    l = sum(1 for x in done.values() if x.get("confidence") == "likely")
    print(f"DONE: {len(done)} | {v} verified + {l} likely = {v + l} kept "
          f"({100 * (v + l) // max(len(done), 1)}%) | {state['credits']} credits")


if __name__ == "__main__":
    main()
