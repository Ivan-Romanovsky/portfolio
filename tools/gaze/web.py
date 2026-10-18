"""Shrink the generated gaze grid for the site.

  npm run character            # assets/character/gaze -> public/character
  npm run character -- --scale 0.6 --quality 74
"""
import argparse
import json
import os

import cv2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(ROOT, 'assets/character/gaze'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'public/character'))
    ap.add_argument('--scale', type=float, default=0.66)
    ap.add_argument('--quality', type=int, default=76)
    a = ap.parse_args()

    g = json.load(open(os.path.join(a.src, 'grid.json')))
    os.makedirs(a.out, exist_ok=True)
    s = a.scale
    x0, y0, x1, y1 = g['box']
    # snap the box to whole pixels after scaling so frames and base line up exactly
    bx, by = round(x0 * s), round(y0 * s)
    bw, bh = round((x1 - x0) * s), round((y1 - y0) * s)
    W, H = round(g['w'] * s), round(g['h'] * s)

    def put(name, img, size):
        img = cv2.resize(img, size, interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(a.out, name), img, [cv2.IMWRITE_WEBP_QUALITY, a.quality])

    base = cv2.imread(os.path.join(a.src, 'base.webp'))
    put('base.webp', base, (W, H))
    b, gr, r = [int(v) for v in base[8:40, 8:40].reshape(-1, 3).mean(axis=0)]   # backdrop colour, top-left corner
    bg = f'#{r:02X}{gr:02X}{b:02X}'
    names = [f'g_{c:02d}_{r:02d}.webp' for r in range(g['rows']) for c in range(g['cols'])] + ['blink.webp']
    total = 0
    for n in names:
        put(n, cv2.imread(os.path.join(a.src, n)), (bw, bh))
        total += os.path.getsize(os.path.join(a.out, n))
    json.dump({'cols': g['cols'], 'rows': g['rows'], 'w': W, 'h': H, 'box': [bx, by, bx + bw, by + bh], 'bg': bg},
              open(os.path.join(a.out, 'grid.json'), 'w'))
    print(f'{len(names)} frames, {total / 1048576:.1f} MB, base {W}x{H}, box {bw}x{bh}')


if __name__ == '__main__':
    main()
