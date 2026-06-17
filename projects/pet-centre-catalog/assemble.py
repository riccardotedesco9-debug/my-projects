#!/usr/bin/env python
"""Write enriched descriptions + image URLs back into the catalog.

Two modes:
  --preview : build a compact standalone workbook from a subset (for review).
  (default) : copy the source workbook and fill columns B (Description), F (Image URL),
              and a new G (Image Confidence), preserving every other column.

Image cells are colour-coded so curation is fast and a wrong guess can never look
confirmed: VERIFIED = clean (white), LIKELY = red fill ("check me"), BLANK = grey.

Usage:
  python assemble.py --rows rows.json --desc desc.json --img img.json --out out.xlsx [--src src.xlsx] [--preview]
"""
import argparse
import io
import json
import urllib.request

import openpyxl
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Font, PatternFill

try:
    from PIL import Image as PILImage
except ImportError:
    PILImage = None


def fetch_thumb(url, box=110):
    """Download an image and return a small PNG thumbnail in a BytesIO (preview only)."""
    if not (url and PILImage):
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        im = PILImage.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((box, box))
        out = io.BytesIO()
        im.save(out, format="PNG")
        out.seek(0)
        return out
    except Exception:
        return None

YELLOW = PatternFill("solid", fgColor="FFEB9C")   # likely / unverified — review this
RED = PatternFill("solid", fgColor="FFC7CE")      # blank — needs manual sourcing
HEAD = PatternFill("solid", fgColor="00975A")     # Pet Centre green
HEADFONT = Font(bold=True, color="FFFFFF")


def load(path):
    return json.load(open(path, encoding="utf-8"))


def img_url(rec):
    return rec.get("url", "") if rec else ""


def confidence(rec):
    c = rec.get("confidence") if rec else None
    if c and c.startswith("verified"):
        return c  # verified-official / verified-cross / verified
    if c == "likely":
        return "likely (check)"
    return "blank: " + ((rec or {}).get("reason") or "no-data")


def style_cell(cell, rec):
    c = rec.get("confidence") if rec else None
    if c and c.startswith("verified"):
        return  # white — trusted
    cell.fill = YELLOW if c == "likely" else RED


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--desc", required=True)
    ap.add_argument("--img", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--src")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--embed", action="store_true", help="embed image thumbnails (preview only)")
    a = ap.parse_args()

    rows = load(a.rows)
    desc = {int(k): v for k, v in load(a.desc).items()}
    img = {int(k): v for k, v in load(a.img).items()}

    if a.preview:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Catalog preview"
        headers = ["Name", "Brand", "Type", "Barcode", "Description", "Image URL", "Image Confidence"]
        if a.embed:
            headers.append("Image")
        ws.append(headers)
        for i, h in enumerate(headers, 1):
            c = ws.cell(row=1, column=i)
            c.fill = HEAD
            c.font = HEADFONT
        for p in rows:
            rec = img.get(p["row"])
            url = img_url(rec)
            ws.append([p["name"], p["brand"], p["type"], p["barcode"],
                       desc.get(p["row"], ""), url, confidence(rec)])
            r = ws.max_row
            if url:
                cell = ws.cell(row=r, column=6)
                cell.hyperlink = url
                cell.font = Font(color="0563C1", underline="single")
            style_cell(ws.cell(row=r, column=6), rec)
            if a.embed:  # drop the actual thumbnail in the last column for at-a-glance review
                thumb = fetch_thumb(url)
                if thumb:
                    xi = XLImage(thumb)
                    ws.add_image(xi, f"{openpyxl.utils.get_column_letter(len(headers))}{r}")
                    ws.row_dimensions[r].height = 85
        widths = [40, 14, 20, 16, 70, 50, 16]
        if a.embed:
            widths.append(17)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=2):
            row[4].alignment = Alignment(wrap_text=True, vertical="top")
        ws.freeze_panes = "A2"
        wb.save(a.out)
        print(f"Preview workbook -> {a.out} ({len(rows)} rows)")
        return

    # Full mode: edit a copy of the source workbook in place.
    wb = openpyxl.load_workbook(a.src)
    ws = wb.worksheets[0]
    ws.cell(row=1, column=7, value="Image Confidence").font = Font(bold=True)
    filled_d = filled_i = 0
    for p in rows:
        r = p["row"]
        if r in desc:
            ws.cell(row=r, column=2, value=desc[r])
            filled_d += 1
        rec = img.get(r)
        url = img_url(rec)
        cell = ws.cell(row=r, column=6, value=url)
        if url:
            cell.hyperlink = url
            cell.font = Font(color="0563C1", underline="single")
            filled_i += 1
        style_cell(cell, rec)
        ws.cell(row=r, column=7, value=confidence(rec))
    wb.save(a.out)
    print(f"Enriched workbook -> {a.out}: {filled_d} descriptions, {filled_i} image URLs")


if __name__ == "__main__":
    main()
