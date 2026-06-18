#!/usr/bin/env python
"""Parse the Pet Centre POS export into a clean working JSON.

Reads the source xlsx and emits one record per product with the row index
(1-based, matching the worksheet) so later phases can write back to the exact
cell. Also derives a cleaned product name (SKU prefix + promo noise stripped)
used for both description prompts and image-search queries.

Usage: python read-catalog.py [source_xlsx] [out_json]
"""
import json
import re
import sys

import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Riccardo\Downloads\Product List Desc.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else ".tmp/catalog.json"

# Leading SKU/article code token, e.g. "00207PR", "0036A", "1400", "100EF".
SKU_PREFIX = re.compile(r"^[0-9][0-9A-Z]*[A-Z0-9]\s+")
# A leading SIZE/quantity token (e.g. "15KG", "100G", "250ML") is product info, not a SKU —
# never strip it.
SIZE_TOK = re.compile(r"^\d+(?:KG|G|ML|L|CM|MM|MG|PCS|PC|X\d+)\b", re.IGNORECASE)
# Trailing promo noise commonly appended by the POS, e.g. "5 OFF", "10 OFF".
PROMO_NOISE = re.compile(r"\s+\d+\s*OFF\s*$", re.IGNORECASE)


def clean_name(raw: str) -> str:
    s = (raw or "").strip()
    if not SIZE_TOK.match(s):
        s = SKU_PREFIX.sub("", s)
    s = PROMO_NOISE.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Title-case ALL-CAPS shouting while keeping size tokens (2KG, 100G) intact.
    if s.isupper():
        s = " ".join(
            w if re.search(r"\d", w) else w.capitalize() for w in s.split(" ")
        )
    return s or raw.strip()


def main() -> None:
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = []
    for idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if idx == 1:
            continue  # header
        name = str(row[0]).strip() if row[0] else ""  # str(): a numeric product name (e.g. "404") mustn't crash .strip()
        if not name:
            continue
        rows.append(
            {
                "row": idx,
                "name": name,
                "clean": clean_name(name),
                # Excel often stores barcodes as numbers -> openpyxl yields a float ('5350...3.0');
                # keep only the integer part so the EAN matches.
                "barcode": str(row[2]).split(".")[0].strip() if len(row) > 2 and row[2] else "",
                "type": str(row[3]).strip() if len(row) > 3 and row[3] else "",
                "brand": str(row[4]).strip() if len(row) > 4 and row[4] else "",
            }
        )
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)
    print(f"Wrote {len(rows)} products -> {OUT}")


if __name__ == "__main__":
    main()
