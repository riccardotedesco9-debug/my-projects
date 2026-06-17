#!/usr/bin/env python
"""Build a visual PDF preview of the enriched sample: thumbnail + name/brand/type +
confidence + description + source URL, one row per product, colour-coded by confidence
(green = verified, yellow = likely, red = blank). Review aid only — the real deliverable
is the xlsx; here you can eyeball every image inline without opening URLs.

Usage: python make-preview-pdf.py <rows.json> <desc.json> <img.json> <out.pdf>
"""
import io
import json
import sys
import urllib.request

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Table, TableStyle

ROWS, DESC, IMG, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

GREEN = colors.HexColor("#E6F4EA")
YELLOW = colors.HexColor("#FFF4CC")
RED = colors.HexColor("#FCE4E4")
HEADER = colors.HexColor("#00975A")


def fetch_thumb(url, box=120):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        im = PILImage.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((box, box))
        out = io.BytesIO()
        im.save(out, format="PNG")
        out.seek(0)
        return out, im.size
    except Exception:
        return None, None


def conf_label(rec):
    c = rec.get("confidence") if rec else None
    if c and c.startswith("verified"):
        return c, GREEN
    if c == "likely":
        return "likely (check)", YELLOW
    return "blank: " + ((rec or {}).get("reason") or "no-data"), RED


def main():
    rows = json.load(open(ROWS, encoding="utf-8"))
    desc = {int(k): v for k, v in json.load(open(DESC, encoding="utf-8")).items()}
    img = {int(k): v for k, v in json.load(open(IMG, encoding="utf-8")).items()}

    styles = getSampleStyleSheet()
    name_st = ParagraphStyle("name", parent=styles["Normal"], fontSize=9, leading=11, spaceAfter=2)
    meta_st = ParagraphStyle("meta", parent=styles["Normal"], fontSize=7.5, leading=9, textColor=colors.HexColor("#555555"))
    desc_st = ParagraphStyle("desc", parent=styles["Normal"], fontSize=8.5, leading=10.5, spaceBefore=2)
    url_st = ParagraphStyle("url", parent=styles["Normal"], fontSize=6.5, leading=8, textColor=colors.HexColor("#0563C1"))

    doc = SimpleDocTemplate(OUT, pagesize=A4, topMargin=12 * mm, bottomMargin=12 * mm,
                            leftMargin=12 * mm, rightMargin=12 * mm,
                            title="Pet Centre - sample preview")
    data, row_bg = [], []
    counts = {"verified": 0, "likely": 0, "blank": 0}
    for p in rows:
        rec = img.get(p["row"])
        label, bg = conf_label(rec)
        counts["verified" if label.startswith("verified") else ("likely" if label.startswith("likely") else "blank")] += 1
        url = (rec or {}).get("url", "")
        thumb, size = fetch_thumb(url) if url else (None, None)
        if thumb:
            # PIL px are read by reportlab as points; scale to fit a 26mm box (keeps the
            # left column uniform instead of overflowing) preserving aspect ratio.
            w, h = size
            box = 26 * mm
            scale = min(box / w, box / h)
            cell_img = Image(thumb, width=w * scale, height=h * scale)
            cell_img.hAlign = "CENTER"
        else:
            cell_img = Paragraph("<i>no image</i>", meta_st)
        text = [
            Paragraph(f'<b>{p["name"]}</b>', name_st),
            Paragraph(f'{p["brand"] or "no brand"} &nbsp;·&nbsp; {p["type"] or ""} &nbsp;·&nbsp; <b>{label}</b>', meta_st),
            Paragraph(desc.get(p["row"], ""), desc_st),
        ]
        if url:
            text.append(Paragraph(url, url_st))
        data.append([cell_img, text])
        row_bg.append(bg)

    table = Table(data, colWidths=[34 * mm, 142 * mm])
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDDDDD")),
    ]
    for i, bg in enumerate(row_bg):
        style.append(("BACKGROUND", (0, i), (-1, i), bg))
    table.setStyle(TableStyle(style))

    title_st = ParagraphStyle("title", parent=styles["Title"], fontSize=15, textColor=HEADER)
    legend_st = ParagraphStyle("legend", parent=styles["Normal"], fontSize=9)
    head = [
        Paragraph("Pet Centre — catalogue enrichment sample", title_st),
        Paragraph(
            f'{len(rows)} products &nbsp;|&nbsp; '
            f'<font backColor="#E6F4EA"><b>&nbsp;{counts["verified"]} verified&nbsp;</b></font> (barcode-confirmed, trust) &nbsp; '
            f'<font backColor="#FFF4CC"><b>&nbsp;{counts["likely"]} likely&nbsp;</b></font> (check) &nbsp; '
            f'<font backColor="#FCE4E4"><b>&nbsp;{counts["blank"]} blank&nbsp;</b></font> (no confident match)',
            legend_st),
        Paragraph("<br/>", legend_st),
    ]
    doc.build(head + [table])
    print(f"PDF -> {OUT} ({len(rows)} rows; {counts})")


if __name__ == "__main__":
    main()
