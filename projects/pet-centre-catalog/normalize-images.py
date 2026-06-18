#!/usr/bin/env python
"""Normalize each chosen product image for a clean, uniform Hike POS import.

For every row with a resolved image URL: download it, flatten transparency onto white, contain-fit it
(NEVER cropped) and centre it on a square white canvas, and save a JPEG <= 1 MB. The result is uniform,
centred, never cut off, and in a format/size Hike accepts (JPG/PNG, <= 1 MB) — fixing the ~16% WEBP
rejections and the cropping risk of non-square source images.

Output: square JPGs in <outdir>/<row>.jpg. Resumable (skips rows already done). Re-hosting the JPGs to a
stable URL (Cloudflare R2) so Hike can pull them is a separate step (see --upload, added once R2 is set up).

Usage: python normalize-images.py <img_json> [outdir] [--size N]
"""
import io
import json
import os
import sys
import urllib.request

from PIL import Image, ImageChops

IMG = sys.argv[1]
OUTDIR = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else ".tmp/normalized"
SIZE = 1000
if "--size" in sys.argv:
    i = sys.argv.index("--size")
    if i + 1 < len(sys.argv) and sys.argv[i + 1].isdigit():
        SIZE = int(sys.argv[i + 1])
MAX_KB = 1000  # Hike's per-image ceiling
TRIM = "--no-trim" not in sys.argv   # trim white margin by default; --no-trim keeps the original framing


def content_bbox(im, tol=14):
    """Bounding box of the non-white content. None if the frame is effectively blank, or if the only
    'content' is a tiny speck (< 4% on both axes — likely a stray logo/mark, not the product) so we don't
    crazily zoom a mis-detection."""
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bbox = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > tol else 0).getbbox()
    if not bbox:
        return None
    if (bbox[2] - bbox[0]) < 0.04 * im.width and (bbox[3] - bbox[1]) < 0.04 * im.height:
        return None
    return bbox


def square_pad(data, size, trim=True, fill=0.86, max_up=3.0):
    """Centre the product on a white square so it FILLS the frame (fixes 'tiny / zoomed-out' packshots).
    Transparency is flattened to white, the white border is trimmed off, then the product is scaled so its
    longer side is ~`fill` of the canvas — but never upscaled more than `max_up`x, so a genuinely low-res
    source softens gently instead of turning to mush. Output is always a uniform size x size JPEG."""
    im = Image.open(io.BytesIO(data))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im).convert("RGB")
    else:
        im = im.convert("RGB")
    box = content_bbox(im) if trim else None
    if box:
        im = im.crop(box)
    scale = min(fill * size / max(im.width, im.height), max_up)   # fill the frame, capped upscale
    if scale != 1.0:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    if im.width > size or im.height > size:                       # safety: never exceed the canvas
        im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas


def save_jpg(im, path, max_kb=MAX_KB):
    """Save JPEG, stepping quality down until <= max_kb; if a pathological image is still over, downscale
    once and retry, then warn (rather than silently keep an oversized file Hike would reject). A 1000px
    packshot is normally far under, so the fallback rarely fires."""
    for q in range(90, 49, -8):
        im.save(path, "JPEG", quality=q, optimize=True)
        if os.path.getsize(path) <= max_kb * 1024:
            return
    im.resize((im.width * 3 // 4, im.height * 3 // 4), Image.LANCZOS).save(path, "JPEG", quality=80, optimize=True)
    if os.path.getsize(path) > max_kb * 1024:
        print(f"  WARNING: {path} is {os.path.getsize(path) // 1024}KB (> {max_kb}KB) — may exceed Hike's limit")


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    img = json.load(open(IMG, encoding="utf-8"))
    todo = [(int(k), v["url"]) for k, v in img.items()
            if isinstance(v, dict) and v.get("url")]
    done = ok = fail = 0
    for row, url in todo:
        out = os.path.join(OUTDIR, f"{row}.jpg")
        if os.path.exists(out):
            done += 1
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            save_jpg(square_pad(data, SIZE, trim=TRIM), out)
            ok += 1
        except Exception as e:
            fail += 1
            print(f"  row {row}: FAILED ({type(e).__name__})")
    print(f"normalized {ok} new (+{done} already done), {fail} failed -> {OUTDIR}/  (size {SIZE}px, <= {MAX_KB}KB JPG)")


if __name__ == "__main__":
    main()
