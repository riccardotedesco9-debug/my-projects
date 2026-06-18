#!/usr/bin/env python
"""Build a deliberately CHALLENGING 50-product sample for the v3 image+description test.

Reads .tmp/catalog.json (full 9,817-product working set) and selects 50 rows stratified across
the failure modes the resolver has to survive, so the test exercises real edge cases rather than
easy wins. Reproducible (fixed seed). Pins the known multi-bag image case (ACANA Cat First Feast,
row 44) so the single-product fix is always exercised.

Challenge axes (one product is assigned to the FIRST matching bucket, in priority order):
  missing-barcode · restricted/in-store barcode (unverifiable) · heavily-abbreviated name ·
  multipack SKU (a multi-unit image is legitimate) · accessory where dimensions matter ·
  big-brand food bag (multi-image marketing risk) · no brand · valid-EAN major brand (baseline) ·
  valid-EAN obscure brand.

Usage: python build-sample.py [catalog_json] [out_json] [n]
"""
import json
import random
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else ".tmp/catalog.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else ".tmp/sample6.json"
N = int(sys.argv[3]) if len(sys.argv) > 3 else 50
SEED = 42
PINNED_ROWS = [44]  # ACANA Cat First Feast 1.8KG — the 3-bags-in-one-image case from review

MAJOR_BRANDS = {
    "acana", "royal", "canin", "hills", "monge", "brit", "trixie", "flamingo", "karlie",
    "versele", "laga", "beaphar", "kong", "ferplast", "schesir", "padovan", "savic", "duvo",
    "zolux", "rogz", "julius", "camon", "imac",
}
FOOD_TYPES = re.compile(r"food|treat|wet|dry|snack|biscuit|kibble", re.IGNORECASE)
ACCESSORY_TYPES = re.compile(
    r"toy|bed|collar|leash|lead|harness|bowl|cage|aquarium|tank|litter|groom|brush|scratch|"
    r"carrier|kennel|crate|fountain|feeder|terrarium|aviary|hutch", re.IGNORECASE)
SIZE_TOK = re.compile(r"\b\d+(?:[.,]\d+)?\s?(?:CM|MM|M|L|LT)\b", re.IGNORECASE)
MULTIPACK = re.compile(r"\bX\s?\d+\b|\d+\s?X\s?\d+|\b\d+\s?(?:PK|PCS|PC|PACK)\b", re.IGNORECASE)


def ean_valid(s):
    if not s or not s.isdigit() or len(s) not in (8, 12, 13, 14):
        return False
    digs = [int(c) for c in s]
    body = digs[:-1][::-1]
    tot = sum(v * (3 if i % 2 == 0 else 1) for i, v in enumerate(body))
    return (10 - tot % 10) % 10 == digs[-1]


def reliable_gtin(s):
    """Valid EAN/UPC that is NOT a restricted / in-store prefix (02x/04x/2xx)."""
    return ean_valid(s) and not re.match(r"(?:0[24]|2\d)", s or "")


def brand_hit(brand):
    bl = (brand or "").lower()
    return any(b in bl for b in MAJOR_BRANDS)


def abbreviated(clean):
    """Heavily-abbreviated name: >=3 alpha tokens and >=half of them are <=4 chars (e.g.
    'Adlt Chic Pot Grfr')."""
    toks = [t for t in re.split(r"[^A-Za-z]+", clean or "") if t]
    if len(toks) < 3:
        return False
    return sum(1 for t in toks if len(t) <= 4) / len(toks) >= 0.5


def bucket(p):
    bc = p["barcode"]
    name = p["name"] or ""
    if not bc:
        return "missing-barcode"
    if ean_valid(bc) and not reliable_gtin(bc):
        return "restricted-barcode"
    if abbreviated(p["clean"]):
        return "abbreviated-name"
    if MULTIPACK.search(name):
        return "multipack"
    if ACCESSORY_TYPES.search(p["type"] or "") and SIZE_TOK.search(name):
        return "accessory-dims"
    if FOOD_TYPES.search(p["type"] or "") and brand_hit(p["brand"]):
        return "food-bag-major"
    if not (p["brand"] or "").strip():
        return "no-brand"
    if reliable_gtin(bc) and brand_hit(p["brand"]):
        return "ean-major-brand"
    if reliable_gtin(bc):
        return "ean-obscure-brand"
    return "other"


# Target mix (sums to 50). Short buckets are topped up from the leftover pool.
# (This catalog has no blank barcodes — Hike always assigns one — so there is no missing-barcode axis.)
QUOTAS = {
    "food-bag-major": 8, "restricted-barcode": 7, "ean-major-brand": 7, "ean-obscure-brand": 7,
    "abbreviated-name": 5, "accessory-dims": 8, "multipack": 4, "no-brand": 4,
}


def main():
    catalog = json.load(open(SRC, encoding="utf-8"))
    by_row = {p["row"]: p for p in catalog}
    rng = random.Random(SEED)

    buckets = {}
    for p in catalog:
        buckets.setdefault(bucket(p), []).append(p)

    chosen, taken = [], set()

    def add(p):
        if p["row"] not in taken:
            taken.add(p["row"])
            chosen.append(p)

    for r in PINNED_ROWS:  # always include the known cases first
        if r in by_row:
            add(by_row[r])

    for name, quota in QUOTAS.items():
        already = sum(1 for c in chosen if bucket(c) == name)  # count pinned rows in this bucket
        need = max(0, quota - already)
        pool = [p for p in buckets.get(name, []) if p["row"] not in taken]
        rng.shuffle(pool)
        for p in pool[:need]:
            if len(chosen) >= N:
                break
            add(p)

    if len(chosen) < N:  # top up from everything not yet taken, seeded
        leftover = [p for p in catalog if p["row"] not in taken]
        rng.shuffle(leftover)
        for p in leftover:
            if len(chosen) >= N:
                break
            add(p)

    chosen = chosen[:N]
    chosen.sort(key=lambda p: p["row"])
    json.dump(chosen, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    dist = {}
    for p in chosen:
        dist[bucket(p)] = dist.get(bucket(p), 0) + 1
    print(f"Wrote {len(chosen)} products -> {OUT}")
    for k in sorted(dist):
        print(f"  {k}: {dist[k]}")


if __name__ == "__main__":
    main()
