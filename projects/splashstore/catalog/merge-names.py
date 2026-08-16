#!/usr/bin/env python
"""Write the barcode-confirmed names from the resolver back onto the catalogue rows.

A POS export feeds the engine a name up front; a scan does not, so the name only exists AFTER
`resolve-images.py` has confirmed it (`name_found`). Steps 3-5 of the pipeline (descriptions,
workbook) read `clean`/`name`/`brand`/`type`, so this closes the loop and lets the rest of the
engine run unmodified on scanned stock.

Deliberately does NOT guess `brand` or `type`. Most names lead with the brand, but taking the first
token would invent a brand on the ones that don't, and an unverified brand in a shop catalogue is
exactly the false-confidence the engine exists to avoid. Left blank for the human to curate.
An empty `type` also reads as non-edible, which is correct for pool and spa goods.

Emits two files:
  catalog-named.json — every row, name filled where identified (blank otherwise) -> assemble.py
  catalog-desc.json  — only identified rows -> gen-descriptions.py, so the writer is never asked
                       to describe a product it knows nothing about.

Usage: python merge-names.py [catalog.json] [resolved.json] [out_prefix]
"""
import json
import sys

CATALOG = sys.argv[1] if len(sys.argv) > 1 else "../.tmp/catalog.json"
RESOLVED = sys.argv[2] if len(sys.argv) > 2 else "../.tmp/resolved.json"
PREFIX = sys.argv[3] if len(sys.argv) > 3 else "../.tmp/catalog"


def main():
    rows = json.load(open(CATALOG, encoding="utf-8"))
    res = json.load(open(RESOLVED, encoding="utf-8"))

    named = 0
    for r in rows:
        rec = res.get(str(r["row"])) or {}
        # Defensive only: a U+FFFD replacement char would mean a source's encoding was lost upstream,
        # and it is pure noise if so. Note it does NOT normally occur — names legitimately carry ™, é,
        # ö, Greek and Cyrillic, which a cp1252 console renders as "?" while the stored data is fine.
        # Do not "fix" those by stripping non-ASCII; the data is correct and the terminal is not.
        nm = " ".join((rec.get("name_found") or "").replace("�", "").split()).strip(" -|")
        if nm:
            r["name"] = nm
            r["clean"] = nm
            r["name_sources"] = rec.get("name_sources") or []
            named += 1

    with open(f"{PREFIX}-named.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)
    with open(f"{PREFIX}-desc.json", "w", encoding="utf-8") as f:
        json.dump([r for r in rows if r["clean"]], f, ensure_ascii=False, indent=0)

    print(f"{named}/{len(rows)} rows carry a barcode-confirmed name")
    print(f"-> {PREFIX}-named.json (all rows, for the workbook)")
    print(f"-> {PREFIX}-desc.json ({named} rows, for the description writer)")


if __name__ == "__main__":
    main()
