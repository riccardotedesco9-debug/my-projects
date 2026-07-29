"""Feathers the cut-out portrait's alpha channel.

Two separate problems, two separate treatments:

  1. SILHOUETTE  - where the subject meets transparency, the cut is 6px hard.
     Eroding then blurring alpha softens it along the outline. Done at 3x and
     scaled back, because at 1:1 the erode leaves visible stair-steps.

  2. FRAME EDGE  - below y=778 the arm runs off the LEFT side of the image, so
     alpha is fully opaque at x=0. That is a crop, not an outline: no amount of
     silhouette feathering can touch it, and it reads as a hard vertical line
     against the dark page. Multiplying alpha by a falloff that rises from the
     border inwards dissolves it instead.

Run: python feather-portrait.py
"""
from PIL import Image
import subprocess, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'portrait-cutout-web.webp')

# (name, erode radius @3x, blur radius @3x) - silhouette softness
VARIANTS = [
    ('portrait-cutout-soft1.webp', 3, 9),
    ('portrait-cutout-soft2.webp', 4, 18),
    ('portrait-cutout-soft3.webp', 5, 30),
]

FRAME_FADE = 120          # px, how far in from a touched border the fade runs


def smoothstep(t):
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return t * t * (3 - 2 * t)


def frame_falloff(w, h):
    """1.0 in the middle, easing to 0 at the left border.

    Only the left border is treated: the subject never reaches the top or right,
    and the bottom is faded by the page's own CSS mask, so touching it here
    would double up and eat the chest twice over."""
    col = [smoothstep(x / FRAME_FADE) for x in range(w)]
    m = Image.new('L', (w, h))
    m.putdata([int(round(col[x] * 255)) for _ in range(h) for x in range(w)])
    return m


def build(src_path, out_name, erode, blur):
    """Silhouette feather via ImageMagick (its morphology is better than PIL's),
    then the frame falloff multiplied in."""
    tmp = os.path.join(HERE, '_tmp_' + out_name.replace('.webp', '.png'))
    subprocess.run([
        'magick', src_path, '-resize', '300%',
        '-channel', 'A', '-morphology', 'Erode', f'Disk:{erode}',
        '-blur', f'0x{blur}', '+channel',
        '-resize', '33.3333%', tmp
    ], check=True)

    im = Image.open(tmp).convert('RGBA')
    w, h = im.size
    r, g, b, a = im.split()
    fall = frame_falloff(w, h)

    # multiply, not replace: the silhouette feather has to survive this
    a_px, f_px = a.load(), fall.load()
    a2 = Image.new('L', (w, h))
    a2.putdata([(a_px[x, y] * f_px[x, y]) // 255
                for y in range(h) for x in range(w)])

    Image.merge('RGBA', (r, g, b, a2)).save(
        os.path.join(HERE, out_name), 'WEBP', quality=90)
    os.remove(tmp)

    # report what the borders look like now
    opaque_left = sum(1 for y in range(h) if a2.getpixel((0, y)) > 200)
    print(f'  {out_name:30s} left-border opaque rows: {opaque_left}')


if __name__ == '__main__':
    print(f'frame fade {FRAME_FADE}px, source {os.path.basename(SRC)}')
    for name, e, bl in VARIANTS:
        build(SRC, name, e, bl)
    print('done')
