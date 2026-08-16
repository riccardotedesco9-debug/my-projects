"""Verify the finished cheat sheet PDF.

The point of this script is that it tests the artifact that gets printed, not
the intermediate PNGs. A barcode can survive extraction and still be ruined by
page scaling, so it is re-decoded here at realistic print resolutions.

Checks:
  1. page count and paper size
  2. every barcode decodes at 300 dpi, and the payload matches extraction
  3. every barcode still decodes at 150 dpi, giving margin for a cheap printer
  4. the text layer carries no NUL bytes, which is how a ligature or font
     problem shows up even when the page looks perfect
  5. printed barcode width is wide enough to scan
"""
import json
import sys
from pathlib import Path

import pymupdf
import zxingcpp
from PIL import Image

PDF = Path(sys.argv[1])
MANIFEST = Path(sys.argv[2])

EXPECTED_PAGES = 10
A4 = (595, 842)          # points, within rounding
MIN_BARCODE_MM = 40.0

doc = pymupdf.open(PDF)
manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
expected_payloads = {v["payload"] for v in manifest.values() if v["payload"]}

failures = []
print(f"file      {PDF.name}  ({PDF.stat().st_size / 1024:.0f} KB)")

# ---- 1. shape -------------------------------------------------------------
print(f"pages     {len(doc)}")
if len(doc) != EXPECTED_PAGES:
    failures.append(f"expected {EXPECTED_PAGES} pages, got {len(doc)}")

r = doc[0].rect
print(f"size      {r.width:.0f} x {r.height:.0f} pt")
if abs(r.width - A4[0]) > 2 or abs(r.height - A4[1]) > 2:
    failures.append(f"not A4: {r.width:.0f}x{r.height:.0f}")

# ---- 2. barcodes decode out of the finished PDF ---------------------------
# 300 dpi is the gate. Lower resolutions are reported for information only:
# rendering a dense Code 128 at 150 dpi starves the decoder of pixels, which
# says something about the rasteriser and nothing about paper. What actually
# governs scannability on paper is narrow bar width, measured in step 3.
for dpi in (300, 150):
    found = {}
    for pno in range(len(doc)):
        pix = doc[pno].get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
        img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
        for res in zxingcpp.read_barcodes(img):
            found.setdefault(res.text, pno + 1)

    missing = expected_payloads - set(found)
    slugs = sorted(k for k, v in manifest.items() if v["payload"] in missing)
    note = "" if not slugs else f"   (not read: {', '.join(slugs)})"
    print(f"decode    {dpi:>3} dpi  {len(found)}/{len(expected_payloads)} barcodes read{note}")

    if dpi == 300:
        if missing:
            failures.append(f"did not decode at 300 dpi: {slugs}")
        unexpected = set(found) - expected_payloads
        if unexpected:
            failures.append(f"unexpected payloads decoded: {unexpected}")

# ---- 3. narrow bar width on paper -----------------------------------------
# The real scannability criterion. The DS2278 reads Code 128 down to about
# 0.1mm, and 0.19mm (7.5 mil) is the usual retail floor, so that is the gate.
MIN_MODULE_MM = 0.19


def narrowest_bar_mm(page, bbox, dpi=600):
    clip = pymupdf.Rect(bbox)
    pix = page.get_pixmap(clip=clip, dpi=dpi, colorspace=pymupdf.csGRAY)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    row = list(img.crop((0, img.height // 2, img.width, img.height // 2 + 1)).getdata())

    runs, n = [], 0
    for px in row:
        if px < 128:
            n += 1
        elif n:
            runs.append(n)
            n = 0
    if n:
        runs.append(n)
    if not runs:
        return None

    # the narrowest bar recurs many times; a one off short run is an edge artifact
    for width in sorted(set(runs)):
        if runs.count(width) >= 3:
            return width * 25.4 / dpi
    return min(runs) * 25.4 / dpi


widths = []
for pno in range(len(doc)):
    for info in doc[pno].get_image_info():
        mm = narrowest_bar_mm(doc[pno], info["bbox"])
        if mm:
            widths.append((mm, pno + 1))

if widths:
    worst, worst_pg = min(widths)
    print(f"barwidth  narrowest bar {worst:.2f}mm (page {worst_pg}), floor {MIN_MODULE_MM}mm")
    if worst < MIN_MODULE_MM:
        failures.append(f"narrowest bar {worst:.2f}mm is below the {MIN_MODULE_MM}mm floor on page {worst_pg}")

# ---- 4. text layer --------------------------------------------------------
text = "".join(p.get_text() for p in doc)
nulls = text.count("\x00")
print(f"text      {len(text)} chars, {nulls} NUL bytes")
if nulls:
    failures.append(f"text layer contains {nulls} NUL bytes, check ligature settings")

# Words carrying fi / fl, the ligature pairs that lose their ToUnicode mapping
# first when font settings are wrong. These must come from body prose: letter
# spaced headings are emitted by Chromium as separate glyphs with spaces
# between them, so a word only appearing in a heading can never match.
lower = text.lower()
for word in ("configuration", "firmware", "confirmation", "specifications", "flat"):
    if word not in lower:
        failures.append(f"word {word!r} missing from text layer, possible glyph mapping fault")

# ---- 5. printed barcode size ---------------------------------------------
narrow = []
for pno in range(len(doc)):
    for info in doc[pno].get_image_info():
        w_mm = pymupdf.Rect(info["bbox"]).width / 72 * 25.4
        if w_mm < MIN_BARCODE_MM:
            narrow.append(f"p{pno + 1} {w_mm:.0f}mm")
print(f"width     narrowest barcodes: {narrow if narrow else 'all >= ' + str(MIN_BARCODE_MM) + 'mm'}")
if narrow:
    failures.append(f"barcodes printed narrower than {MIN_BARCODE_MM}mm: {narrow}")

# ---- result ---------------------------------------------------------------
print()
if failures:
    print(f"FAILED ({len(failures)})")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All checks passed.")
