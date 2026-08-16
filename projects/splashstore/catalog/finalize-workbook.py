#!/usr/bin/env python
"""Finalize the curation workbook for publishing: surface everything the run learned, in the Sheet.

WHY. The engine's curation workbook is a review surface for the fields the ENGINE resolves (identity,
photo, description, ingredients, dimensions). Three kinds of relevant information sit outside that
and were previously invisible to whoever opens the Sheet:

  1. Shopify's own fields (Tags, SEO) — real data, but they lived only in a CSV on disk, so a reviewer
     reading the Sheet reasonably concluded they had not been produced at all.
  2. The provenance behind a GREEN row — how many independent domains confirmed the barcode, and the
     page it was confirmed on. "Verified" is more trustworthy when you can see who verified it.
  3. The scanned codes that are NOT product barcodes. They were dropped before the engine ran, so the
     workbook showed 44 rows for 51 scanned items. Silently shrinking the list makes the job look more
     finished than it is — the same reason `read-scans.py` refuses to write a lossy catalogue.

So this adds columns to Curation, a Shopify tab, and a tab for the codes that need re-scanning.
Idempotent: re-running rebuilds rather than appending duplicates.

Usage: python finalize-workbook.py [workbook.xlsx] [products.csv] [skipped.json] [resolved.json] [catalog.json]
"""
import csv
import json
import sys

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

WORKBOOK = sys.argv[1] if len(sys.argv) > 1 else "../docs/splashstore-scan-curation-260816.xlsx"
CSV_PATH = sys.argv[2] if len(sys.argv) > 2 else "../docs/splashstore-shopify-import-260816.csv"
SKIPPED = sys.argv[3] if len(sys.argv) > 3 else "../.tmp/catalog-skipped.json"
RESOLVED = sys.argv[4] if len(sys.argv) > 4 else "../.tmp/resolved.json"
CATALOG = sys.argv[5] if len(sys.argv) > 5 else "../.tmp/catalog.json"

HEAD = PatternFill("solid", fgColor="00975A")        # matches the engine's own header green
TODO = PatternFill("solid", fgColor="FFF4CC")        # yours to fill, not an engine miss
GREY = PatternFill("solid", fgColor="EDEDED")
HEAD_FONT = Font(bold=True, color="FFFFFF")
LINK_FONT = Font(color="0563C1", underline="single")

# Tinted = the human still has to supply it. SKU and Inventory are no longer here: SKU is generated
# and Inventory carries the owner's 999 placeholder, so tinting them would flag filled data as a gap.
TODO_COLS = {"Price", "Compare-at price", "Cost per item"}
WIDE = {"Title": 44, "Description": 60, "Tags": 38, "SEO title": 34, "SEO description": 50,
        "URL handle": 34, "Product image URL": 30, "Image alt text": 30}

KIND_NOTE = {
    "gs1-serial": "GS1 serial capture (AI 21/250) — identifies one physical unit, carries no product code",
    "in-store":   "in-store / variable-weight prefix — not globally unique, cannot be verified",
    "other":      "supplier or model code, not a GTIN",
}

# Only what the engine's own columns do NOT already say. Deliberately small:
#   SEO title / SEO description duplicate Name / Description (identical in 41/41 rows) and Shopify
#     falls back to those anyway — they live on the Shopify tab for the owner to fill, not here.
#   "Confirmed on page" duplicated Description Source, whose cell is ALREADY a hyperlink to that URL.
#   URL handle is derived from Name and belongs with the import schema, not the review view.
# What survives is genuinely new: the tag set, and HOW MANY independent domains confirmed the barcode
# (the tier label says "Verified", not whether one source or three agreed).
EXTRA = ["Tags", "Confirmed by"]

# Review order: triage signal first (photo + status), then identity and the evidence for it, then the
# enriched content, then measurements, then raw source URLs. Ingredients sit late — for a non-edible
# vertical they are N/A on almost every row and would otherwise split the useful columns in half.
CURATION_ORDER = [
    "Image", "Status", "Name", "Barcode", "Confirmed by",
    "Brand Name", "Product Type",
    "Description", "Description Source", "Tags",
    "Depth (cm)", "Width (cm)", "Height (cm)", "Weight (kg)",
    "Image URL", "Image Source",
    "Ingredients", "Ingredients Source",
    "Best guess (manual)",
]


def reorder_columns(ws, order):
    """Rearrange columns to `order`, carrying values, styling, hyperlinks and widths.

    Column A is never moved: the embedded product thumbnails are anchored to A2..An, and anchors do
    not follow a column rewrite — reordering A would leave every photo pointing at the wrong row.
    """
    headers = [c.value for c in ws[1]]
    target = [h for h in order if h in headers] + [h for h in headers if h not in order]
    if target[0] != headers[0]:
        raise SystemExit(f"refusing to move column A ({headers[0]}) — image anchors would break")
    if target == headers:
        return False

    def snapshot(col):
        return [{
            "value": ws.cell(r, col).value,
            "fill": ws.cell(r, col).fill.copy(),
            "font": ws.cell(r, col).font.copy(),
            "align": ws.cell(r, col).alignment.copy(),
            "fmt": ws.cell(r, col).number_format,
            "link": ws.cell(r, col).hyperlink.target if ws.cell(r, col).hyperlink else None,
        } for r in range(1, ws.max_row + 1)]

    cols = {h: snapshot(i + 1) for i, h in enumerate(headers)}
    widths = {h: ws.column_dimensions[get_column_letter(i + 1)].width
              for i, h in enumerate(headers)}

    for new_i, h in enumerate(target, start=1):
        for r, cell_data in enumerate(cols[h], start=1):
            cell = ws.cell(r, new_i, cell_data["value"])
            cell.fill, cell.font = cell_data["fill"], cell_data["font"]
            cell.alignment, cell.number_format = cell_data["align"], cell_data["fmt"]
            cell.hyperlink = cell_data["link"] or None
        ws.column_dimensions[get_column_letter(new_i)].width = widths[h]
    return True


PX_PER_PT = 96 / 72          # Excel row heights are points; images are pixels
CHAR_PX = 7.0                # approx px per character at the default font
LINE_PT = 14.0               # one wrapped line of text
IMG_PAD_PX = 26              # slack around a thumbnail: Drive's xlsx->Sheets conversion does not
                             # reproduce row heights exactly, and a flush fit clips in the browser
MAX_ROW_PT = 320             # sanity ceiling so one long description cannot create a giant row


def fit_layout(ws, wrap_cols, img_col_width_px=None):
    """Size rows and columns so NOTHING is clipped — not a thumbnail, not a wrapped description.

    Two independent constraints per row, and the row must satisfy both:
      * the tallest embedded image in it, plus padding;
      * the tallest wrapped text among `wrap_cols`, estimated from the column's own width.
    Sized here rather than left to the viewer because Sheets will not auto-fit a row that contains
    an over-the-grid image, and a fixed height set for the image alone silently truncates long text.
    """
    headers = [c.value for c in ws[1]]
    widths = {h: (ws.column_dimensions[get_column_letter(i + 1)].width or 10)
              for i, h in enumerate(headers)}

    img_h = {}
    for im in getattr(ws, "_images", []):
        r = im.anchor._from.row + 1
        img_h[r] = max(img_h.get(r, 0), im.height)
    if img_h and img_col_width_px:
        need = max(im.width for im in ws._images) + IMG_PAD_PX
        ws.column_dimensions["A"].width = max(widths.get(headers[0], 10), need / CHAR_PX)

    for h in wrap_cols:
        if h not in headers:
            continue
        col = headers.index(h) + 1
        for r in range(2, ws.max_row + 1):
            cell = ws.cell(r, col)
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    for r in range(2, ws.max_row + 1):
        need_pt = ((img_h[r] + IMG_PAD_PX) / PX_PER_PT) if r in img_h else 0
        for h in wrap_cols:
            if h not in headers:
                continue
            text = str(ws.cell(r, headers.index(h) + 1).value or "")
            if not text:
                continue
            per_line = max(8, int(widths[h] * CHAR_PX / CHAR_PX))   # chars that fit on one line
            lines = max(1, -(-len(text) // per_line))
            need_pt = max(need_pt, lines * LINE_PT + 6)
        if need_pt:
            ws.row_dimensions[r].height = min(round(need_pt, 1), MAX_ROW_PT)


def style_header(ws, row=1):
    for c in ws[row]:
        if c.value is not None:
            c.fill, c.font = HEAD, HEAD_FONT
            c.alignment = Alignment(vertical="center", wrap_text=True)


def enrich_curation(ws, by_barcode, resolved_by_barcode):
    """Append Tags / SEO / provenance beside the engine's own columns, matched on Barcode."""
    headers = [c.value for c in ws[1]]
    # Rebuild on re-run. Delete BY NAME, highest index first: after reorder_columns the EXTRA columns
    # are no longer adjacent (Confirmed by sits at E, Tags at J), so deleting N consecutive columns
    # from the first one's index removed innocent neighbours — it ate "Depth (cm)".
    for name in sorted((h for h in EXTRA if h in headers),
                       key=lambda n: headers.index(n), reverse=True):
        ws.delete_cols(headers.index(name) + 1)
        headers = [c.value for c in ws[1]]
    start = len(headers) + 1
    bc_col = headers.index("Barcode") + 1

    for i, name in enumerate(EXTRA):
        ws.cell(1, start + i, name)
    for r in range(2, ws.max_row + 1):
        bc = str(ws.cell(r, bc_col).value or "").strip()
        row = by_barcode.get(bc, {})
        rec = resolved_by_barcode.get(bc, {})
        srcs = rec.get("name_sources") or []
        values = [
            row.get("Tags", ""),
            f"{len(srcs)} source{'s' if len(srcs) != 1 else ''}: " + ", ".join(
                s.replace("www.", "") for s in srcs) if srcs else "",
        ]
        for i, v in enumerate(values):
            cell = ws.cell(r, start + i, v)
            cell.alignment = Alignment(vertical="top", wrap_text=(i == 0))
        # A scanned row has no brand/type of its own; both are derived in the Shopify export from
        # words literally present in the confirmed name. Mirror them here so the review view is not
        # showing two blank columns for data that exists one tab over.
        for col, key in (("Brand Name", "Vendor"), ("Product Type", "Type")):
            if col in headers and row.get(key) and not ws.cell(r, headers.index(col) + 1).value:
                ws.cell(r, headers.index(col) + 1, row[key])
    widths = {"Tags": 34, "Confirmed by": 30}
    for i, name in enumerate(EXTRA):
        ws.column_dimensions[get_column_letter(start + i)].width = widths[name]
    style_header(ws)


def build_shopify_tab(wb, rows):
    if "Shopify import" in wb.sheetnames:
        del wb["Shopify import"]
    ws = wb.create_sheet("Shopify import")
    headers = rows[0]
    for r_i, row in enumerate(rows, start=1):
        for c_i, value in enumerate(row, start=1):
            cell = ws.cell(r_i, c_i, value)
            if r_i > 1:
                cell.alignment = Alignment(vertical="top", wrap_text=headers[c_i - 1] in WIDE)
                if headers[c_i - 1] in TODO_COLS:
                    cell.fill = TODO
    # Barcodes must stay text: a spreadsheet renders 700175992406 as 7.00176E+11 and a round-trip
    # would corrupt the one globally-unique field we have.
    if "Barcode" in headers:
        col = get_column_letter(headers.index("Barcode") + 1)
        for r_i in range(2, len(rows) + 1):
            ws[f"{col}{r_i}"].number_format = "@"
    for c_i, h in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(c_i)].width = WIDE.get(h, max(12, min(len(h) + 4, 22)))
    ws.freeze_panes = "C2"
    style_header(ws)
    return len(rows) - 1


def build_unscannable_tab(wb, skipped):
    """The scanned codes that carry no product barcode. They are real stock the owner still has to
    deal with; leaving them out of the deliverable would quietly understate the remaining work."""
    if "Needs re-scan" in wb.sheetnames:
        del wb["Needs re-scan"]
    ws = wb.create_sheet("Needs re-scan")
    for i, h in enumerate(["Scanned code", "What it is", "What to do"], start=1):
        ws.cell(1, i, h)
    for r, s in enumerate(skipped, start=2):
        ws.cell(r, 1, s["scanned"]).number_format = "@"
        ws.cell(r, 2, KIND_NOTE.get(s["kind"], s["kind"])).alignment = Alignment(wrap_text=True, vertical="top")
        ws.cell(r, 3, "Re-scan the product's own EAN/UPC from the packaging, or enter it by hand.")
        for c in range(1, 4):
            ws.cell(r, c).fill = GREY
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 62
    ws.column_dimensions["C"].width = 52
    ws.freeze_panes = "A2"
    style_header(ws)
    return len(skipped)


def check_thumbnails(ws, resolved, catalog):
    """Every row that HAS an image URL must carry an embedded thumbnail.

    A row can end up with a URL but no picture — the image was re-resolved and its normalized JPG was
    left stale or deleted, or the fallback fetch failed at assemble time. The cell then renders as a
    broken-image icon in the Sheet, which looks like a bug in the data rather than a missing file.
    Loud here, because it is invisible once published.
    """
    headers = [c.value for c in ws[1]]
    bc_col = headers.index("Barcode") + 1
    have = {im.anchor._from.row + 1 for im in getattr(ws, "_images", [])}
    by_barcode = {c["barcode"]: str(c["row"]) for c in catalog if c.get("barcode")}

    missing = []
    for r in range(2, ws.max_row + 1):
        code = str(ws.cell(r, bc_col).value or "").strip()
        key = by_barcode.get(code)
        if key and (resolved.get(key, {}) or {}).get("url") and r not in have:
            missing.append((r, code))
    if missing:
        print("  !! rows with an image URL but NO embedded thumbnail (will render broken):")
        for r, code in missing:
            print(f"       sheet row {r}  barcode {code}  -> delete .tmp/normalized/<row>.jpg and re-run step 4")
    return len(missing)


def main():
    wb = openpyxl.load_workbook(WORKBOOK)
    with open(CSV_PATH, encoding="utf-8") as f:
        rows = list(csv.reader(f))
    headers = rows[0]
    by_barcode = {r[headers.index("Barcode")]: dict(zip(headers, r)) for r in rows[1:]}

    catalog = json.load(open(CATALOG, encoding="utf-8"))
    resolved = json.load(open(RESOLVED, encoding="utf-8"))
    resolved_by_barcode = {c["barcode"]: resolved.get(str(c["row"]), {}) for c in catalog}
    skipped = json.load(open(SKIPPED, encoding="utf-8"))

    enrich_curation(wb["Curation"], by_barcode, resolved_by_barcode)
    moved = reorder_columns(wb["Curation"], CURATION_ORDER)
    n_shop = build_shopify_tab(wb, rows)
    n_skip = build_unscannable_tab(wb, skipped)
    broken = check_thumbnails(wb["Curation"], resolved, catalog)

    # Last: size everything so no photo and no sentence is clipped in the browser.
    fit_layout(wb["Curation"],
               ["Name", "Description", "Tags", "Confirmed by", "Ingredients", "Best guess (manual)"],
               img_col_width_px=True)
    fit_layout(wb["Shopify import"],
               ["Title", "Description", "Tags", "Collection", "Image alt text", "URL handle"])
    fit_layout(wb["Needs re-scan"], ["What it is", "What to do"])
    wb.save(WORKBOOK)

    print(f"Finalized {WORKBOOK}")
    print(f"  Curation      + {', '.join(EXTRA)}"
          f"{' | reordered for review flow' if moved else ''}")
    print(f"  Shopify import  {n_shop} products x {len(headers)} columns "
          f"({', '.join(sorted(TODO_COLS & set(headers)))} tinted for you)")
    print(f"  Needs re-scan   {n_skip} codes that carry no product barcode")
    print(f"  thumbnails      {'ALL PRESENT' if not broken else str(broken) + ' MISSING - see above'}")
    print(f"  total scanned accounted for: {wb['Curation'].max_row - 1} + {n_skip} = "
          f"{wb['Curation'].max_row - 1 + n_skip}")


if __name__ == "__main__":
    main()
