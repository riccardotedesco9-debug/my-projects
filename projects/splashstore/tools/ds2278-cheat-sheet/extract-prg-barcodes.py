"""Extract DS2278 configuration barcodes from Zebra's Product Reference Guide.

Two kinds live in the manual and each needs different handling:

  vector  the bars are filled rectangles in the content stream, so they can be
          rendered at any resolution with no loss. Rendered at 600 dpi.
  raster  the bars are a small embedded PNG (about 152x32). Rendering the page
          would interpolate and blur the bar edges, so the original image is
          pulled out and scaled up with NEAREST, which keeps edges hard.

Every barcode gets a white quiet zone added around it. Without roughly ten
modules of clear space a Code 128 barcode will not decode no matter how sharp
the bars are.

Each result is decoded immediately. A barcode that does not decode here will
not decode off paper either, so it fails the build rather than shipping.
"""
import sys
from pathlib import Path

import pymupdf
import zxingcpp
from PIL import Image

PRG = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

DPI = 600
# Code 128 needs its quiet zone left and right, where the scanner looks for the
# start and stop guards. Vertically the quiet zone does nothing for a linear
# barcode, so the crop is tight top and bottom. It has to be: Zebra's caption
# sits only about 8pt under the bars, and anything looser slices the top half
# of that caption into the image, where it collides with the label on the sheet.
PAD_X_PT = 20
PAD_TOP_PT = 4
PAD_BOTTOM_PT = 2
PAD_FRAC = 0.14      # quiet zone as fraction of width, applied to raster crops

# slug, pdf page, caption fragment that sits under the barcode
TARGETS = [
    ("defaults",           63,  "Set Factory Defaults"),
    ("enter-key",          89,  "Add Enter Key"),
    ("tab-key",            89,  "Tab Key"),
    ("hid-bluetooth",     103,  "HID Bluetooth Classic"),
    ("usb-keyboard-hid",  154,  "USB Keyboard"),
    ("volume-low",         65,  "Low Volume"),
    ("volume-high",        65,  "High Volume"),
    ("trigger-standard",   74,  "Standard (Level)"),
    ("presentation-mode",  74,  "Presentation (Blink)"),
    ("suffix-data-suffix1", 92, "<DATA> <SUFFIX 1>"),
    ("batch-normal",      130,  "Normal (00h)"),
    ("batch-out-of-range", 130, "Out of Range Batch Mode"),
    ("batch-persist-on",  131,  "Persistent Batch Enable"),
    ("cancel",            414,  "Cancel"),
]

doc = pymupdf.open(PRG)


def vector_boxes(page):
    """Cluster narrow filled rects into barcode bounding boxes."""
    bars = []
    for d in page.get_drawings():
        if d.get("fill") is None:
            continue
        r = d["rect"]
        if 0 < r.width < 6 and 6 < r.height < 90:
            bars.append(r)
    if not bars:
        return []

    rows = {}
    for r in bars:
        key = next((k for k in rows if abs(k - r.y0) <= 6.0), r.y0)
        rows.setdefault(key, []).append(r)

    boxes = []
    for _, rs in rows.items():
        rs.sort(key=lambda r: r.x0)
        run = [rs[0]]
        for r in rs[1:]:
            if r.x0 - run[-1].x1 <= 14.0:
                run.append(r)
            else:
                boxes.append(run)
                run = [r]
        boxes.append(run)

    out = []
    for g in boxes:
        if len(g) < 15:
            continue
        b = pymupdf.Rect(g[0])
        for r in g:
            b |= r
        if b.width >= 50:
            out.append(b)
    return out


def caption_of(page, box, pad=60, depth=30):
    zone = pymupdf.Rect(box.x0 - pad, box.y1, box.x1 + pad, box.y1 + depth)
    return " ".join((page.get_textbox(zone) or "").split())


def text_intruding(page, clip):
    """Any manual text caught inside the crop, which would print as a smear."""
    out = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        if pymupdf.Rect(x0, y0, x1, y1).intersects(clip):
            out.append(word)
    return out


def save_vector(page, box, slug):
    clip = pymupdf.Rect(box.x0 - PAD_X_PT, box.y0 - PAD_TOP_PT,
                        box.x1 + PAD_X_PT, box.y1 + PAD_BOTTOM_PT) & page.rect
    intruders = text_intruding(page, clip)
    if intruders:
        raise SystemExit(
            f"{slug}: crop swallows manual text {intruders}. "
            f"Tighten PAD_TOP_PT / PAD_BOTTOM_PT."
        )

    pix = page.get_pixmap(clip=clip, dpi=DPI, colorspace=pymupdf.csGRAY)
    path = OUT / f"{slug}.png"
    pix.save(path)
    return path


def save_raster(page, info, slug):
    """Pull the embedded image at native size and upscale with NEAREST."""
    xref = info["xref"]
    raw = doc.extract_image(xref)
    img = Image.open(pymupdf.io.BytesIO(raw["image"])) if hasattr(pymupdf, "io") else None
    if img is None:
        import io
        img = Image.open(io.BytesIO(raw["image"]))
    img = img.convert("L")

    scale = max(1, round(1600 / img.width))
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)

    padx = int(img.width * PAD_FRAC)
    pady = max(8, int(img.height * 0.30))
    canvas = Image.new("L", (img.width + 2 * padx, img.height + 2 * pady), 255)
    canvas.paste(img, (padx, pady))

    path = OUT / f"{slug}.png"
    canvas.save(path)
    return path


results = []
for slug, pno, want in TARGETS:
    page = doc[pno - 1]
    hit = None

    # try vector first
    for box in vector_boxes(page):
        cap = caption_of(page, box)
        if want.lower().lstrip("*") in cap.lower():
            hit = ("vector", save_vector(page, box, slug), cap)
            break

    # fall back to embedded raster
    if hit is None:
        for info in page.get_image_info(xrefs=True):
            box = pymupdf.Rect(info["bbox"])
            if box.width < 40:
                continue
            cap = caption_of(page, box)
            if want.lower().lstrip("*") in cap.lower():
                hit = ("raster", save_raster(page, info, slug), cap)
                break

    if hit is None:
        results.append((slug, pno, "NOT FOUND", "", ""))
        continue

    kind, path, cap = hit
    img = Image.open(path)
    decoded = zxingcpp.read_barcodes(img)
    if decoded:
        d = decoded[0]
        status = f"OK {d.format.name}"
        payload = d.text
    else:
        status = "DECODE FAILED"
        payload = ""
    results.append((slug, pno, f"{kind} {status}", payload, cap[:52]))

print(f"{'slug':<20} {'pg':>4}  {'result':<22} {'payload':<14} caption")
print("-" * 104)
bad = 0
for slug, pno, status, payload, cap in results:
    if "OK" not in status:
        bad += 1
    print(f"{slug:<20} {pno:>4}  {status:<22} {payload:<14} {cap}")
print("-" * 104)
print(f"{len(results) - bad}/{len(results)} decoded")

# The manifest carries Zebra's own caption and the decoded payload through to
# the page build, so labels on the sheet trace back to the manual rather than
# being retyped from memory.
import json
manifest = {
    slug: {"page": pno, "status": status, "payload": payload, "caption": cap}
    for slug, pno, status, payload, cap in results
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
print(f"wrote {OUT / 'manifest.json'}")

sys.exit(1 if bad else 0)
