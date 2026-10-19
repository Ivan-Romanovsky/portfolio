"""Cut a "looks in N directions" video into per-direction frame sequences for the hero.

The video must start in the neutral pose and come back to it between turns (see the prompt in CLAUDE.md).
Frames must be decoded first (tools/gaze/decode.swift writes 000.png, 001.png, ...).

  tools/LivePortrait/.venv/bin/python tools/gaze/video_frames.py --frames <dir> --out public/character \
      --names left,right,up,down,upleft,upright,downleft,downright

Output: base.webp (neutral pose, full frame), <name>_NN.webp (moving region only, feathered alpha,
center -> extreme), seq.json.
"""
import argparse
import glob
import json
import os

import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--names', default='left,right,up,down,upleft,upright,downleft,downright')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--quality', type=int, default=82)
    ap.add_argument('--feather', type=int, default=40)
    a = ap.parse_args()
    names = a.names.split(',')

    paths = sorted(glob.glob(os.path.join(a.frames, '[0-9][0-9][0-9].png')))
    # compare only the central (head) area: the background's slow lighting drift must not count as motion
    small = [cv2.resize(cv2.imread(p, cv2.IMREAD_GRAYSCALE), (320, 180)).astype(np.float32)[0:110, 100:220] for p in paths]
    d = np.array([np.abs(f - small[0]).mean() for f in small])
    d = np.convolve(d, np.ones(5) / 5, mode='same')

    # neutral moments = local minima between turns; a turn = stretch between two neutral moments
    n, r = len(d), 8
    centers = [0] + [i for i in range(r, n - r) if d[i] == d[i - r:i + r + 1].min() and d[i] < d.max() * 0.6] + [n - 1]
    centers = [c for k, c in enumerate(centers) if k == 0 or c - centers[k - 1] > r]
    segs = list(zip(centers[:-1], centers[1:]))
    if len(segs) != len(names):
        raise SystemExit(f'found {len(segs)} turns, expected {len(names)}: {segs}')

    os.makedirs(a.out, exist_ok=True)
    full = cv2.imread(paths[0])
    H0, W0 = full.shape[:2]
    s = a.width / W0
    W, H = a.width, round(H0 * s)
    rs = lambda im: cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA)
    base = rs(full)
    cv2.imwrite(os.path.join(a.out, 'base.webp'), base, [cv2.IMWRITE_WEBP_QUALITY, a.quality + 6])

    seq, frames = {}, {}
    for name, (st, en) in zip(names, segs):
        peak = st + int(np.argmax(d[st:en]))
        frames[name] = list(range(st, peak + 1))  # neutral -> extreme

    # moving region: union of pixels that change anywhere, padded
    moved = np.zeros((H, W), bool)
    cache = {}
    for ids in frames.values():
        for k in ids:
            cache[k] = rs(cv2.imread(paths[k]))
            diff = np.abs(cv2.GaussianBlur(cache[k], (9, 9), 0).astype(np.int16) - cv2.GaussianBlur(base, (9, 9), 0)).max(axis=2)
            moved |= diff > 45  # real motion only, not the slow lighting drift
    # keep only the blob around the character (frame center); swaying plants or flickering lights elsewhere are ignored
    m8 = cv2.dilate(moved.astype(np.uint8), np.ones((15, 15), np.uint8))
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m8)
    cy, cx = H // 3, W // 2
    keep = lab[cy, cx] if lab[cy, cx] else int(np.argmax(stats[1:, cv2.CC_STAT_AREA])) + 1
    moved = (lab == keep) & moved
    ys, xs = np.nonzero(moved)
    pad = a.feather + 24
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(W, xs.max() + pad), min(H, ys.max() + pad)
    # feathered alpha so the crop melts into the base even when the lighting drifts a little
    alpha = np.zeros((y1 - y0, x1 - x0), np.float32)
    f = a.feather
    alpha[f:-f or None, f:-f or None] = 1
    alpha = cv2.GaussianBlur(alpha, (0, 0), f / 2.5)
    for x in (0,):  # edges that touch the frame border stay opaque
        if x0 == 0: alpha[:, :f] = np.maximum(alpha[:, :f], alpha[:, f:f + 1])
        if y0 == 0: alpha[:f, :] = np.maximum(alpha[:f, :], alpha[f:f + 1, :])
        if x1 == W: alpha[:, -f:] = np.maximum(alpha[:, -f:], alpha[:, -f - 1:-f])
        if y1 == H: alpha[-f:, :] = np.maximum(alpha[-f:, :], alpha[-f - 1:-f, :])
    a8 = (alpha * 255).astype(np.uint8)

    total = 0
    for name, ids in frames.items():
        for j, k in enumerate(ids):
            crop = cache[k][y0:y1, x0:x1]
            rgba = np.dstack([crop, a8])
            p = os.path.join(a.out, f'{name}_{j:02d}.webp')
            cv2.imwrite(p, rgba, [cv2.IMWRITE_WEBP_QUALITY, a.quality])
            total += os.path.getsize(p)
        seq[name] = len(ids)
    json.dump({'w': W, 'h': H, 'box': [int(x0), int(y0), int(x1), int(y1)], 'seq': seq,
               'source': {n: [frames[n][0], frames[n][-1]] for n in frames}},
              open(os.path.join(a.out, 'seq.json'), 'w'))
    print('turns', {n: (frames[n][0], frames[n][-1]) for n in frames})
    print('box', (x0, y0, x1, y1), 'frames', sum(seq.values()), f'{total / 1048576:.1f} MB')


if __name__ == '__main__':
    main()
