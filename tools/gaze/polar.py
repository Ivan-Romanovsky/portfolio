"""Build a dense polar grid of head poses from an "8 directions" video, with RIFE frame interpolation.

Why: the video only has 8 straight lines out of the center (12-21 frames each). Showing them as-is means
big jumps between poses and a detour through the center whenever the cursor changes direction.
RIFE synthesises the missing poses, so the site gets A angles x R radii and can walk to any pose directly.

  tools/LivePortrait/.venv/bin/python tools/gaze/polar.py --frames <decoded pngs> --out public/character

Grid: angle a in 0..A-1 (0 = right, clockwise in screen space: right, down-right, down, ...),
radius r in 0..R-1 (0 = neutral, R-1 = the extreme pose in the video). r = 0 is one shared frame.
Radial steps are spaced by visual change, not by video time, so the head moves at an even pace.
"""
import argparse
import json
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RIFE = os.path.join(ROOT, 'tools/rife/rife-ncnn-vulkan-20221029-macos')
ORDER = ['right', 'downright', 'down', 'downleft', 'left', 'upleft', 'up', 'upright']  # clockwise from right
SEGMENTS = {  # first and extreme frame of each turn in assets/character/source/look8.mp4
    'left': (0, 20), 'right': (33, 44), 'up': (57, 73), 'down': (85, 99),
    'upleft': (111, 127), 'upright': (140, 153), 'downleft': (164, 179), 'downright': (197, 211),
}
# frames where the character blinks mid-turn: skipped, RIFE bridges the gap between open-eyed frames
BLINKS = set(range(5, 12)) | set(range(33, 37)) | set(range(86, 93)) | set(range(201, 206))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--crop', default='650,70,1270,690', help='head region in source pixels: x0,y0,x1,y1')
    ap.add_argument('--angles', type=int, default=24)
    ap.add_argument('--radii', type=int, default=14)
    ap.add_argument('--width', type=int, default=1600, help='scene width on the site')
    ap.add_argument('--quality', type=int, default=76)
    ap.add_argument('--feather', type=int, default=36)
    ap.add_argument('--jobs', type=int, default=3)
    ap.add_argument('--cols', type=int, default=0, help='write a cartesian yaw x pitch set instead of polar files')
    ap.add_argument('--rows', type=int, default=5)
    a = ap.parse_args()
    A, R = a.angles, a.radii
    assert A % len(ORDER) == 0
    sub = A // len(ORDER)
    x0, y0, x1, y1 = map(int, a.crop.split(','))
    work = tempfile.mkdtemp(prefix='polar-')

    def src(i):
        return os.path.join(a.frames, f'{i:03d}.png')

    def crop(i):
        p = os.path.join(work, f'src_{i:03d}.png')
        if not os.path.exists(p):
            cv2.imwrite(p, cv2.imread(src(i))[y0:y1, x0:x1])
        return p

    def rife(p0, p1, t, out):
        subprocess.run([os.path.join(RIFE, 'rife-ncnn-vulkan'), '-0', p0, '-1', p1, '-o', out, '-s', f'{t:.4f}',
                        '-m', os.path.join(RIFE, 'rife-v4.6')], check=True, capture_output=True)
        return out

    pool = ThreadPoolExecutor(a.jobs)

    # 1. radial: neutral -> extreme, resampled to R evenly spaced steps of visual change
    small = lambda p: cv2.resize(cv2.imread(p, cv2.IMREAD_GRAYSCALE), (155, 155)).astype(np.float32)
    rad = {}
    jobs = []
    for d, (s, e) in SEGMENTS.items():
        # every direction starts from the same neutral frame
        chain = [crop(0)] + [crop(i) for i in range(s + 1, e + 1) if i not in BLINKS]
        f = [small(p) for p in chain]
        cum = np.concatenate([[0], np.cumsum([np.abs(f[k + 1] - f[k]).mean() for k in range(len(f) - 1)])])
        cum /= cum[-1]
        rad[d] = []
        for r in range(R):
            pos = r / (R - 1)
            k = min(len(chain) - 2, int(np.searchsorted(cum, pos, side='right') - 1))
            t = (pos - cum[k]) / max(1e-6, cum[k + 1] - cum[k])
            if t < 0.06:
                rad[d].append(chain[k])
            elif t > 0.94:
                rad[d].append(chain[k + 1])
            else:
                out = os.path.join(work, f'rad_{d}_{r:02d}.png')
                rad[d].append(out)
                jobs.append(pool.submit(rife, chain[k], chain[k + 1], t, out))
    for j in jobs:
        j.result()
    print('radial done', flush=True)

    # 2. angular: between neighbouring directions at the same radius
    grid = {}
    jobs = []
    for ai in range(A):
        k, m = divmod(ai, sub)
        d0, d1 = ORDER[k], ORDER[(k + 1) % len(ORDER)]
        for r in range(R):
            if r == 0 or m == 0:
                grid[(ai, r)] = rad[d0][r]
            else:
                out = os.path.join(work, f'ang_{ai:02d}_{r:02d}.png')
                grid[(ai, r)] = out
                jobs.append(pool.submit(rife, rad[d0][r], rad[d1][r], m / sub, out))
    for n, j in enumerate(jobs):
        j.result()
    print('angular done', len(jobs), 'interpolations', flush=True)

    # 3. write: scaled to the site's scene width, feathered alpha so the crop melts into base.webp
    W0 = cv2.imread(src(0)).shape[1]
    s = a.width / W0
    bx, by = round(x0 * s), round(y0 * s)
    bw, bh = round((x1 - x0) * s), round((y1 - y0) * s)
    alpha = np.zeros((bh, bw), np.float32)
    f = a.feather
    alpha[f:-f, f:-f] = 1
    alpha = (cv2.GaussianBlur(alpha, (0, 0), f / 2.5) * 255).astype(np.uint8)
    os.makedirs(a.out, exist_ok=True)
    total = 0
    put = lambda p, name: (cv2.imwrite(os.path.join(a.out, name),
                                       np.dstack([cv2.resize(cv2.imread(p), (bw, bh), interpolation=cv2.INTER_AREA), alpha]),
                                       [cv2.IMWRITE_WEBP_QUALITY, a.quality]), os.path.getsize(os.path.join(a.out, name)))[1]
    full = cv2.imread(src(0))
    H = round(full.shape[0] * s)
    cv2.imwrite(os.path.join(a.out, 'base.webp'), cv2.resize(full, (a.width, H), interpolation=cv2.INTER_AREA),
                [cv2.IMWRITE_WEBP_QUALITY, 86])
    box = [bx, by, bx + bw, by + bh]

    if a.cols:
        # cartesian set: column = yaw (cursor x), row = pitch (cursor y), like a video scrubbed in 2D.
        # (u, v) in the square maps onto the polar grid with radius = max(|u|, |v|), so every edge of the
        # square is an extreme pose and the corners are the diagonal extremes.
        C, Rw = a.cols, a.rows
        for row in range(Rw):
            for col in range(C):
                u, v = col / (C - 1) * 2 - 1, row / (Rw - 1) * 2 - 1
                rad = max(abs(u), abs(v))
                ri = round(rad * (R - 1))
                ai = round(np.arctan2(v, u) / (2 * np.pi / A)) % A
                total += put(grid[(0 if ri == 0 else ai, ri)], f'c_{row:02d}_{col:02d}.webp')
        json.dump({'w': a.width, 'h': H, 'box': box, 'cols': C, 'rows': Rw}, open(os.path.join(a.out, 'grid.json'), 'w'))
        print(f'{C * Rw} frames, {total / 1048576:.1f} MB, box {bw}x{bh}')
        return

    for (ai, r), p in grid.items():
        if r == 0 and ai > 0:
            continue
        total += put(p, 'p_center.webp' if r == 0 else f'p_{ai:02d}_{r:02d}.webp')
    json.dump({'w': a.width, 'h': H, 'box': box, 'angles': A, 'radii': R}, open(os.path.join(a.out, 'polar.json'), 'w'))
    print(f'{1 + A * (R - 1)} frames, {total / 1048576:.1f} MB, box {bw}x{bh}')


if __name__ == '__main__':
    main()
