#!/usr/bin/env python
"""Render the engine's resolved output into a human-checkable scan report.

Accuracy rule inherited from the engine: a name is only shown as identified when the barcode was
confirmed LITERALLY at the source. Anything else is reported as unresolved, never as a best guess
dressed up as a result.

Usage: python report-scans.py [resolved.json] [catalog.json] [skipped.json] [out.md]
"""
import json
import sys

RESOLVED = sys.argv[1] if len(sys.argv) > 1 else "../.tmp/resolved.json"
CATALOG = sys.argv[2] if len(sys.argv) > 2 else "../.tmp/catalog.json"
SKIPPED = sys.argv[3] if len(sys.argv) > 3 else "../.tmp/catalog-skipped.json"
OUT = sys.argv[4] if len(sys.argv) > 4 else "../docs/scan-identification-260816.md"

KIND_NOTE = {
    "gs1-serial": "GS1 serial capture (AI 21/250) — identifies one physical unit, carries no GTIN",
    "in-store":   "in-store / variable-weight prefix — not globally unique, cannot be verified",
    "other":      "supplier or model code, not a GTIN",
}


def clean(s):
    """Collapse whitespace and trim separator chrome. The U+FFFD strip is defensive — it does not
    normally trigger; names legitimately contain ™, ö, é, Greek and Cyrillic, which a cp1252 console
    renders as "?" while the stored UTF-8 is correct. Never strip non-ASCII to chase that."""
    return " ".join((s or "").replace("�", "").split()).strip(" -|")


def main():
    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    catalog = json.load(open(CATALOG, encoding="utf-8"))
    skipped = json.load(open(SKIPPED, encoding="utf-8"))
    by_row = {str(c["row"]): c for c in catalog}

    # Denominator is the SCANNED GTIN count, not the number of rows the resolver happened to record:
    # a row dropped as retry/capped would otherwise vanish from both numerator and denominator and the
    # report would read 100% while products were missing.
    for c in catalog:
        resolved.setdefault(str(c["row"]), {"reason": "not-processed"})
    rows = []
    for row, rec in resolved.items():
        rows.append({
            "barcode": by_row.get(row, {}).get("barcode", ""),
            "name": clean(rec.get("name_found", "")),
            "sources": rec.get("name_sources") or [],
            "image": rec.get("url", ""),
            "src": rec.get("src", ""),
            "conf": rec.get("confidence") or "",
            "reason": rec.get("reason", ""),
        })
    rows.sort(key=lambda r: (not r["name"], r["barcode"]))
    named = [r for r in rows if r["name"]]
    unnamed = [r for r in rows if not r["name"]]
    with_img = [r for r in named if r["image"]]

    L = []
    L.append("# Garage scan — barcode identification (2026-08-16)\n")
    L.append(f"**{len(named)}/{len(rows)} scanned GTINs identified** "
             f"({100 * len(named) // max(len(rows), 1)}%), {len(with_img)} with a product image. "
             f"{len(skipped)} scanned codes are not lookupable at all.\n")
    L.append("Every name below is **barcode-confirmed**: the GTIN was found literally in the source "
             "page's structured data, HTML or visible text. Names with 2+ independent sources are the "
             "most trustworthy. Nothing here is a name-similarity guess.\n")

    L.append("\n## Identified\n")
    L.append("| # | Barcode | Product | Sources | Image |")
    L.append("|---|---|---|---|---|")
    for i, r in enumerate(named, 1):
        srcs = ", ".join(s.replace("www.", "") for s in r["sources"][:3]) or "-"
        img = f"[photo]({r['image']})" if r["image"] else "-"
        L.append(f"| {i} | `{r['barcode']}` | {r['name'] or '-'} | {len(r['sources'])} — {srcs} | {img} |")

    if unnamed:
        L.append("\n## Not identified — manual sourcing needed\n")
        L.append("| Barcode | Why |")
        L.append("|---|---|")
        for r in unnamed:
            L.append(f"| `{r['barcode']}` | {r['reason'] or 'no confirmation found'} |")

    if skipped:
        L.append("\n## Not lookupable — no product barcode in the scan\n")
        L.append("| Scanned code | What it is |")
        L.append("|---|---|")
        for s in skipped:
            L.append(f"| `{s['scanned']}` | {KIND_NOTE.get(s['kind'], s['kind'])} |")
        L.append("\nThese need the product's own EAN/UPC re-scanned from the packaging, or manual entry.")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print(f"{len(named)}/{len(rows)} identified, {len(with_img)} with image, {len(skipped)} not lookupable")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
