"""Build assets/hdri/*.hdr from Poly Haven 1k HDRIs (CC0).

Usage:
  python3 -I tools/assets/build_hdri.py <dir with source *_1k.hdr files> [out dir]

Sources (all Poly Haven, CC0). The 1k .hdr files were taken from GitHub
repositories that carry them unmodified (partial clone + sparse checkout), and
each one's MD5 was checked against Poly Haven's published file list
(api.polyhaven.com/files/<id>), so they are the original Poly Haven files:
  bunker <- empty_warehouse_01_1k.hdr      md5 ab2931b0191b050b97b1e08ab67b0fb0
  forge  <- fireplace_1k.hdr               md5 42ea9e4241d230a343955f4921b9ab30
  fjord  <- kiara_1_dawn_1k.hdr            md5 fcefd321c51b468ead9d5e1a369a3735
  hall   <- warm_reception_dinner_1k.hdr   md5 8c6c3de99bcde3e60233073d03340ed3
See assets/hdri/CREDITS.md for links.

Each map is box-downscaled 2x to 512x256 (energy preserving, so the sun and
lamps keep their total power), white-balanced a little toward its setting (and
slightly desaturated for the two fire-lit interiors),
scaled so its solid-angle mean luminance hits a per-setting target, and written
as RLE RGBE. Every map ends up with comparable brightness, so the renderer can
use similar envMapIntensity values across settings.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rgbe import read_hdr, write_hdr, downscale  # noqa: E402

# name: (source file, RGB white-balance gains, saturation, target mean luminance, note)
# Saturation < 1 pulls the fire-lit interiors back a little so the image light
# doesn't swamp the fighters' colours; the setting's practical lights add the heat.
MAPS = {
    'bunker': ('empty_warehouse_01_1k.hdr', (0.90, 0.98, 1.12), 1.00, 0.50,
               'Empty Warehouse 01 by Sergej Majboroda'),
    'forge': ('fireplace_1k.hdr', (1.00, 0.88, 1.00), 0.75, 0.30,
              'Fireplace by Greg Zaal'),
    'fjord': ('kiara_1_dawn_1k.hdr', (0.86, 0.96, 1.16), 1.00, 0.36,
              'Kiara 1 Dawn by Greg Zaal'),
    'hall': ('warm_reception_dinner_1k.hdr', (0.97, 1.00, 1.10), 0.85, 0.45,
             'Warm Reception Dinner by Dimitrios Savva and Jarod Guest'),
}

LUM = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def mean_lum(img):
    h = img.shape[0]
    w = np.sin((np.arange(h) + 0.5) / h * np.pi)[:, None]
    lum = img @ LUM
    return float((lum * w).sum() / (w.sum() * img.shape[1]))


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'hdri')
    os.makedirs(out, exist_ok=True)
    total = 0
    for name, (fn, wb, sat, target, credit) in MAPS.items():
        img = read_hdr(os.path.join(src, fn))
        img = downscale(img, 512, 256)
        img = img * np.array(wb, dtype=np.float32)
        if sat != 1.0:
            lum = (img @ LUM)[..., None]
            img = np.maximum(lum + (img - lum) * sat, 0)
        m = mean_lum(img)
        img = img * (target / m)
        path = os.path.join(out, name + '.hdr')
        write_hdr(path, img, comment='Splinterhall %s: %s (Poly Haven, CC0), 512x256' % (name, credit))
        size = os.path.getsize(path)
        total += size
        print('%-7s %-28s scale %.3f  mean lum %.3f  peak %.1f  %6.1f KB'
              % (name, fn, target / m, mean_lum(img), float(img.max()), size / 1024))
    print('total %.1f KB' % (total / 1024))


if __name__ == '__main__':
    main()
