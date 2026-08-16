#!/usr/bin/env python
"""Parse a garage barcode-scan list into the catalogue engine's working JSON.

The pet-shop pipeline starts from a POS export that already carries names, so its
`read-catalog.py` maps xlsx columns. A garage scan has only the code, so this emits the same
record shape with the name fields empty — the engine then resolves identity from the barcode
alone (its barcode-DB + EAN-web-confirm stages need no name).

Codes that can never be looked up are classified out rather than searched:
  in-store   — valid EAN/UPC but a restricted prefix (02x/04x/2xx, UPC 2/4): retailer-assigned,
               not globally unique, so confirming against one invites a false match.
  gs1-serial — a GS1 Application-Identifier capture, e.g. "(21)28624(250)2610" (AI 21 = serial
               number, AI 250 = secondary serial). Identifies ONE physical unit, carries no GTIN.
  other      — alphanumeric supplier/model codes with no GTIN at all.

DEDUPLICATION — the rule is "never lose a unique code", so collapsing is deliberately narrow:
  * GTINs collapse on their canonical GTIN-14 form, which merges ONLY mathematically identical
    renderings of one code (UPC-12 `700175992406` == EAN-13 `0700175992406`). Two different
    products cannot share a GTIN-14, so this can never merge distinct items.
  * Everything else collapses on the EXACT string — no case folding, no trimming of interior
    characters — because two supplier codes differing only in case cannot be assumed identical.
Every collapse is recorded with both line numbers in `*-duplicates.json`, and a conservation
check asserts kept + collapsed == total scanned before anything is written. Nothing is silent.

Usage: python read-scans.py [scans.txt] [out_json]
"""
import json
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "../data/scans-260816.txt"
OUT = sys.argv[2] if len(sys.argv) > 2 else "../.tmp/catalog.json"

GS1_AI = re.compile(r"\(\d{2,4}\)")


def ean_valid(s):
    if not s or not s.isdigit() or len(s) not in (8, 12, 13, 14):
        return False
    digs = [int(c) for c in s]
    tot = sum(v * (3 if i % 2 == 0 else 1) for i, v in enumerate(digs[:-1][::-1]))
    return (10 - tot % 10) % 10 == digs[-1]


def classify(code):
    """(kind, normalised). 'gtin' is the only lookupable kind."""
    c = (code or "").strip().split(".")[0]   # tolerate Excel float artifacts like '5350...3.0'
    if not c:
        return "other", ""
    if GS1_AI.search(c):
        return "gs1-serial", c
    if c.isdigit() and ean_valid(c):
        # Restricted / in-store prefixes are not globally unique -> unusable as a confirmation key.
        # EAN-13 02x/04x/2xx, and a raw UPC-12 whose number-system digit is 2 or 4. The 12-digit case
        # needs its own test: as an EAN-13 it would be written 0<upc>, so matching on the leading
        # digit alone missed every 4xxxxxxxxxxx retailer code and let it mint a false confirmation.
        instore = re.match(r"(?:0[24]|2\d)", c) or (len(c) == 12 and c[0] in "24")
        return ("in-store" if instore else "gtin"), c
    return "other", c


def dedupe_key(kind, code):
    """The identity a duplicate is judged on. GTINs -> canonical GTIN-14 (merges only equivalent
    renderings of the SAME code); anything else -> the exact string, so nothing is merged on a
    guess. Prefixed by kind so a numeric supplier code can never collide with a real GTIN."""
    if kind in ("gtin", "in-store"):
        return "gtin:" + code.zfill(14)
    return kind + ":" + code


def main():
    rows, skipped, seen, dupes = [], [], {}, []
    total = 0
    with open(SRC, encoding="utf-8-sig") as f:
        for n, ln in enumerate(f, start=1):
            raw = ln.strip()
            if not raw or raw.startswith("#"):
                continue
            total += 1
            kind, norm = classify(raw)
            key = dedupe_key(kind, norm)
            if key in seen:
                first = seen[key]
                first["dupes"] += 1
                dupes.append({"key": key, "dropped_line": n, "dropped_raw": raw,
                              "kept_line": first["row"], "kept_raw": first["scanned"]})
                continue
            rec = {"row": n, "name": "", "clean": "", "barcode": norm if kind == "gtin" else "",
                   "type": "", "brand": "", "scanned": norm, "kind": kind, "dupes": 0}
            seen[key] = rec
            (rows if kind == "gtin" else skipped).append(rec)

    # Conservation check — the guard against silently losing a unique code. Every scanned line must
    # end up either as a kept record or as an explicitly logged duplicate.
    kept = len(rows) + len(skipped)
    if kept + len(dupes) != total:
        sys.exit(f"ABORT: {total} scanned but {kept} kept + {len(dupes)} duplicates "
                 f"= {kept + len(dupes)}. Refusing to write a lossy catalogue.")
    distinct_codes = {r["scanned"] for r in rows} | {r["scanned"] for r in skipped}
    if len(distinct_codes) != kept:
        sys.exit(f"ABORT: {kept} records but only {len(distinct_codes)} distinct codes — "
                 f"deduplication merged two different codes. Refusing to write.")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)
    with open(OUT.replace(".json", "-skipped.json"), "w", encoding="utf-8") as f:
        json.dump(skipped, f, ensure_ascii=False, indent=0)
    with open(OUT.replace(".json", "-duplicates.json"), "w", encoding="utf-8") as f:
        json.dump(dupes, f, ensure_ascii=False, indent=0)

    print(f"{total} codes scanned -> {len(rows)} lookupable GTINs, {len(skipped)} not lookupable, "
          f"{len(dupes)} duplicates collapsed  (conservation check passed)")
    print(f"-> {OUT}")
    for d in dupes:
        print(f"  dup line {d['dropped_line']} '{d['dropped_raw']}' == line {d['kept_line']} '{d['kept_raw']}'")
    for r in skipped:
        print(f"  {r['kind']:11} {r['scanned']}")


if __name__ == "__main__":
    main()
