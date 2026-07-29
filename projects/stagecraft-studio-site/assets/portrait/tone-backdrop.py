"""Pulls down the blown studio backdrop behind the portrait.

Scales the backdrop UNIFORMLY through a real subject matte, so its own radial
gradient and vignette move together and the subject is untouched at any strength.

The matte (subject-matte.png) comes from fal birefnet run on this exact file, so
it is pixel-aligned. That mattered: the pre-existing cut-out in this folder is a
different crop of the shoot and cannot be registered to this framing.

Two cheaper approaches were tried first and both left a grey ring around the head:

  - a tone curve biting only the top end COMPRESSES the backdrop's gradient
    rather than moving it, so the bright centre flattens toward the dimmer edge
    and the join shows;
  - a matte derived from luminance cannot separate backdrop from subject,
    because the backdrop carries its own vignette: its dark corners fall below
    any threshold that excludes the shirt, so they escape the darkening and the
    scaled centre rings against them.

A wide global rolloff avoids the ring but flattens the face once pushed hard,
because it cannot tell subject from backdrop either. Hence the real matte.

Run: python tone-backdrop.py
"""
from PIL import Image, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'portrait-framed-web.webp')   # never overwritten
MATTE = os.path.join(HERE, 'subject-matte.png')

FEATHER = 1.2      # px; birefnet edges are already soft, this just kills aliasing


def tone(out_name, keep):
    """keep=0.70 leaves the backdrop at 70% of its original brightness."""
    im = Image.open(SRC).convert('RGB')
    w, h = im.size
    matte = Image.open(MATTE).convert('L').resize((w, h), Image.LANCZOS) \
                 .filter(ImageFilter.GaussianBlur(FEATHER))

    px, mp = im.load(), matte.load()
    out = Image.new('RGB', (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            s = mp[x, y] / 255.0                 # 1 = subject, 0 = backdrop
            f = keep + (1.0 - keep) * s          # full scaling only off the subject
            r, g, b = px[x, y]
            op[x, y] = (int(r * f), int(g * f), int(b * f))

    path = os.path.join(HERE, out_name)
    out.save(path, 'WEBP', quality=88)

    a = Image.open(path).convert('L')
    def peak(fx, fy):
        return max(a.getpixel((int(w * fx) + i, int(h * fy) + j))
                   for i in range(-12, 12) for j in range(-12, 12))
    print(f'  {out_name:34s} keep={keep}  hotspot {peak(.88, .30)}  '
          f'above-head {peak(.50, .10)}  shirt {peak(.45, .80)}  face {peak(.50, .30)}')


if __name__ == '__main__':
    print('before: hotspot 243, above-head 247, shirt 190, face 245')
    tone('portrait-framed-toned-light.webp', 0.78)
    tone('portrait-framed-toned.webp', 0.66)
    tone('portrait-framed-toned-more.webp', 0.54)
