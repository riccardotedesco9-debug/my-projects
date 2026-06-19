#!/usr/bin/env python
"""Phase-A coverage probe: how well do the barcode-keyed product databases cover OUR catalogue?

For a diverse sample of products (mass-market + premium edibles + non-edibles, all with a reliable
GTIN) it queries every CONFIGURED database by barcode and records, per source, whether the product
was found and which fields came back (name / ingredients / image / dimensions). Free, no Firecrawl,
no fabrication — pure read-only HTTP. Sources needing a key are skipped (clearly) when the key is
absent, so the no-key sources run immediately and keyed/paid ones light up once their keys are in
the workspace `.env`.

Output: a printed coverage matrix + `.tmp/db-probe.json` (full per-product detail for spot-checking).

Usage: python probe-databases.py [n_per_tier]
Env (optional, enable extra sources): BARCODELOOKUP_API_KEY, GOUPC_API_KEY, UPCDB_API_KEY,
  DIGITEYES_APP_KEY/DIGITEYES_AUTH_KEY, ICECAT_USERNAME.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

CATALOG = ".tmp/catalog.json"
OUT = ".tmp/db-probe.json"
UA = "PetCentreCatalog/1.0 (pet-shop catalogue enrichment; contact ricotedesco@gmail.com)"

# Brand keywords to span the coverage question: mass-market food (expected to hit open DBs),
# premium/specialty food (the hard reds, expected to miss), and broadly-retailed non-edibles.
EDIBLE_MASS = ["WHISKAS", "Felix", "PEDIGREE", "ROYAL CANIN"]
EDIBLE_PREMIUM = ["ACANA", "Schesir", "Monge"]
NONEDIBLE = ["Trixie", "Kong", "Camon"]

EDIBLE = re.compile(
    r"\b(?:food|treat|snack|biscuit|cookie|kibble|wet|dry|dental|milk|yog(?:h)?urt|paste|pat[eé]|"
    r"mousse|gravy|broth|stew|loaf|sausage|meal|topper|nibble|chew|bone|stick|jerky|rawhide)s?\b",
    re.IGNORECASE)


def ean_valid(s):
    if not s or not s.isdigit() or len(s) not in (8, 12, 13, 14):
        return False
    d = [int(c) for c in s]
    body = d[:-1][::-1]
    tot = sum(v * (3 if i % 2 == 0 else 1) for i, v in enumerate(body))
    return (10 - tot % 10) % 10 == d[-1]


def reliable_gtin(s):
    return ean_valid(s) and not re.match(r"(?:0[24]|2\d)", s or "")


def barcode_of(p):
    return (p.get("barcode") or "").split(".")[0].strip()


def is_edible(p):
    return bool(EDIBLE.search(p.get("type") or ""))


def get_json(url, headers=None, timeout=25):
    """GET -> parsed JSON, or ('__http__', code) on an HTTP error (so 404 reads as a clean miss),
    or None on any other failure. Never raises — the probe must survey, not crash."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return ("__http__", e.code)
    except Exception:
        return None


def _norm(found, name="", brand="", ingredients="", image="", dims="", source_url="", note=""):
    return {"found": bool(found), "name": (name or "")[:120], "brand": (brand or "")[:60],
            "ingredients": (ingredients or "")[:400], "image": image or "",
            "dims": dims or "", "source_url": source_url or "", "note": note}


# ---- sources (each: ean -> normalized dict). No-key sources first. -------------------------------

def src_off_family(host, ean):
    fields = "product_name,brands,ingredients_text,image_front_url,quantity,product_quantity,product_quantity_unit"
    url = f"https://{host}/api/v2/product/{ean}.json?fields={fields}"
    r = get_json(url)
    if isinstance(r, tuple) or not isinstance(r, dict):
        return _norm(False, note="not-found" if isinstance(r, tuple) else "error")
    if r.get("status") == 0:
        return _norm(False, note="not-found")
    pr = r.get("product") or {}
    if not pr:
        return _norm(False, note="not-found")
    qty = " ".join(str(pr.get(k, "")) for k in ("product_quantity", "product_quantity_unit")).strip()
    return _norm(True, pr.get("product_name"), pr.get("brands"), pr.get("ingredients_text"),
                 pr.get("image_front_url"), qty or pr.get("quantity", ""),
                 f"https://{host}/product/{ean}")


def src_openpetfoodfacts(ean):
    return src_off_family("world.openpetfoodfacts.org", ean)


def src_openfoodfacts(ean):
    return src_off_family("world.openfoodfacts.org", ean)


def src_openproductsfacts(ean):
    return src_off_family("world.openproductsfacts.org", ean)


def src_upcitemdb(ean):
    r = get_json(f"https://api.upcitemdb.com/prod/trial/lookup?upc={ean}")
    if not isinstance(r, dict) or r.get("code") != "OK" or not r.get("items"):
        note = "rate-limited" if (isinstance(r, dict) and r.get("code") not in (None, "OK")) else "not-found"
        return _norm(False, note=note)
    it = r["items"][0]
    img = (it.get("images") or [""])[0]
    return _norm(True, it.get("title"), it.get("brand"), "", img,
                 it.get("dimension") or it.get("size") or "",
                 f"https://www.upcitemdb.com/upc/{ean}")


# ---- keyed / paid sources (skipped cleanly when the key is absent) -------------------------------

def src_barcodelookup(ean):
    key = os.environ.get("BARCODELOOKUP_API_KEY")
    if not key:
        return None  # skip — no key
    url = f"https://api.barcodelookup.com/v3/products?barcode={ean}&formatted=y&key={key}"
    r = get_json(url)
    if not isinstance(r, dict) or not r.get("products"):
        return _norm(False, note="not-found")
    pr = r["products"][0]
    img = (pr.get("images") or [""])[0]
    dims = " ".join(filter(None, [pr.get("length"), pr.get("width"), pr.get("height"), pr.get("weight")]))
    return _norm(True, pr.get("title") or pr.get("product_name"), pr.get("brand"),
                 pr.get("ingredients") or pr.get("nutrition_facts") or "", img, dims,
                 f"https://www.barcodelookup.com/{ean}")


def src_goupc(ean):
    key = os.environ.get("GOUPC_API_KEY")
    if not key:
        return None
    r = get_json(f"https://go-upc.com/api/v1/code/{ean}", headers={"Authorization": "Bearer " + key})
    if not isinstance(r, dict) or not r.get("product"):
        return _norm(False, note="not-found")
    pr = r["product"]
    specs = pr.get("specs") or {}
    dims = " ".join(str(specs.get(k, "")) for k in ("Weight", "Size", "Dimensions") if specs.get(k))
    return _norm(True, pr.get("name"), pr.get("brand"), "", pr.get("imageUrl"), dims,
                 f"https://go-upc.com/search?q={ean}")


def src_upcdatabase(ean):
    key = os.environ.get("UPCDB_API_KEY")
    if not key:
        return None
    r = get_json(f"https://api.upcdatabase.org/product/{ean}", headers={"Authorization": "Bearer " + key})
    if not isinstance(r, dict) or not r.get("success"):
        return _norm(False, note="not-found")
    return _norm(True, r.get("title"), r.get("brand"), "", (r.get("images") or [""])[0] if r.get("images") else "",
                 r.get("size") or "", f"https://www.upcdatabase.org/code/{ean}")


def src_icecat(ean):
    """Open Icecat JSON API. Free: the 'openIcecat-live' demo user serves sponsor-brand open content with no
    registration (or set ICECAT_USERNAME for your own account). Strong on branded NON-FOOD: specs, images,
    DIMENSIONS — exactly our weak categories (accessories/gadgets)."""
    user = os.environ.get("ICECAT_USERNAME") or "openIcecat-live"
    url = f"https://live.icecat.biz/api?lang=EN&shopname={user}&GTIN={ean}&content="
    r = get_json(url)
    if isinstance(r, tuple):
        return _norm(False, note="http %s" % r[1])
    if not isinstance(r, dict):
        return _norm(False, note="error")
    data = r.get("data")
    if not isinstance(data, dict) or not data:
        return _norm(False, note=(str(r.get("msg", "")) or "not-found")[:30])
    gen = data.get("GeneralInfo") or {}
    name = gen.get("Title") or gen.get("ProductName") or gen.get("BrandPartCode") or ""
    img = (data.get("Image") or {}).get("HighPic") or (data.get("Image") or {}).get("Pic500x500") or ""
    blob = str(data.get("FeaturesGroups") or []).lower()
    dims = "dims" if any(k in blob for k in ("dimension", "width", "height", "weight", "depth")) else ""
    return _norm(bool(name or img), name, (gen.get("Brand") or ""), "", img, dims, url)


SOURCES = [
    ("OpenPetFoodFacts", src_openpetfoodfacts),
    ("OpenFoodFacts", src_openfoodfacts),
    ("OpenProductsFacts", src_openproductsfacts),
    ("UPCitemdb", src_upcitemdb),
    ("Icecat", src_icecat),
    ("BarcodeLookup", src_barcodelookup),
    ("Go-UPC", src_goupc),
    ("UPCDatabase", src_upcdatabase),
]


def pick_sample(cat, n_each=1):
    """First reliable-GTIN product per target brand, tagged with its tier."""
    chosen = []
    seen_rows = set()

    def grab(brand_kw, tier, want_edible):
        hits = 0
        for p in cat:
            if hits >= n_each:
                break
            if p["row"] in seen_rows:
                continue
            if is_edible(p) != want_edible:
                continue
            if brand_kw.lower() not in (p.get("brand") or "").lower():
                continue
            if not reliable_gtin(barcode_of(p)):
                continue
            chosen.append({"row": p["row"], "tier": tier, "brand": p.get("brand"),
                           "name": p.get("clean") or p.get("name"), "type": p.get("type"),
                           "barcode": barcode_of(p), "edible": want_edible})
            seen_rows.add(p["row"])
            hits += 1

    for b in EDIBLE_MASS:
        grab(b, "edible-mass", True)
    for b in EDIBLE_PREMIUM:
        grab(b, "edible-premium", True)
    for b in NONEDIBLE:
        grab(b, "non-edible", False)
    return chosen


def main():
    n_each = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 1
    cat = json.load(open(CATALOG, encoding="utf-8"))
    sample = pick_sample(cat, n_each)
    active = [(nm, fn) for nm, fn in SOURCES]
    print(f"Probing {len(sample)} products across {len(SOURCES)} sources "
          f"(keyed sources skip when no key)\n")

    results = []
    for s in sample:
        ean = s["barcode"]
        row = {"product": s, "sources": {}}
        for nm, fn in active:
            rec = fn(ean)
            row["sources"][nm] = rec  # None = skipped (no key)
        results.append(row)
        # live one-liner
        hits = [nm for nm, r in row["sources"].items() if r and r.get("found")]
        print(f"  [{s['tier']:14}] {s['brand'][:14]:14} {ean} -> "
              f"{', '.join(hits) if hits else 'NO HITS'}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    # ---- coverage matrix --------------------------------------------------------------------------
    print("\n=== COVERAGE MATRIX (found? / which fields) ===")
    src_names = [nm for nm, _ in active]
    hdr = "product".ljust(28) + "".join(n[:11].ljust(12) for n in src_names)
    print(hdr)
    for r in results:
        line = (r["product"]["brand"][:16] + " " + r["product"]["tier"][:9]).ljust(28)
        for nm in src_names:
            rec = r["sources"][nm]
            if rec is None:
                cell = "-skip-"
            elif not rec["found"]:
                cell = "miss"
            else:
                fl = "".join([("N" if rec["name"] else ""), ("I" if rec["ingredients"] else ""),
                              ("P" if rec["image"] else ""), ("D" if rec["dims"] else "")])
                cell = "HIT:" + (fl or "?")
            line += cell.ljust(12)
        print(line)
    print("\nlegend: HIT flags -> N=name I=ingredients P=image(Photo) D=dimensions ; -skip-=no key")

    # per-source tally
    print("\n=== PER-SOURCE HIT RATE ===")
    for nm in src_names:
        recs = [r["sources"][nm] for r in results]
        if all(x is None for x in recs):
            print(f"  {nm:18} skipped (no key)")
            continue
        found = sum(1 for x in recs if x and x["found"])
        ing = sum(1 for x in recs if x and x["found"] and x["ingredients"])
        img = sum(1 for x in recs if x and x["found"] and x["image"])
        print(f"  {nm:18} {found}/{len(results)} found | {ing} w/ ingredients | {img} w/ image")
    print(f"\nfull detail -> {OUT}")


if __name__ == "__main__":
    main()
