"""Assemble the head clip for the cursor-scrubbed video (the Framer / "mascot follows the cursor" approach).

Original frames only, at full source resolution: no rescaling, no re-compression until the final MP4.
Each direction becomes one contiguous run of frames, neutral -> extreme, and every run starts with the
exact same neutral frame, so switching direction at the center is invisible. RIFE is used only to
fill the few frames where the character blinks mid-turn.

  tools/LivePortrait/.venv/bin/python tools/gaze/clip.py --frames <decoded pngs> --out <dir>
  swift tools/gaze/encode.swift <dir>/frames <out.mp4> 24 <bitrate>

Output: frames/NNNN.png (head crop), base.webp (whole room, neutral), clip.json (segments, crop box).
"""
import argparse
import json
import os
import subprocess

import cv2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RIFE = os.path.join(ROOT, 'tools/rife/rife-ncnn-vulkan-20221029-macos')
# look8.mp4: first and extreme frame of each turn, and the frames where the character blinks
SEGMENTS = {
    'left': (0, 20), 'right': (33, 44), 'up': (57, 73), 'down': (85, 99),
    'upleft': (111, 127), 'upright': (140, 153), 'downleft': (164, 179), 'downright': (197, 211),
}
BLINKS = set(range(5, 12)) | set(range(33, 37)) | set(range(86, 93)) | set(range(201, 206))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--crop', default='648,68,1272,692', help='head square in source pixels (multiple of 16)')
    ap.add_argument('--reuse', default='', help='dir of already processed frames numbered by segment position')
    ap.add_argument('--base', default='', help='already processed full room image to use as base.webp')
    ap.add_argument('--size', type=int, default=0, help='head frame size when reusing upscaled frames')
    ap.add_argument('--base-width', type=int, default=0, help='resize base.webp to this width')
    a = ap.parse_args()
    x0, y0, x1, y1 = map(int, a.crop.split(','))
    fdir = os.path.join(a.out, 'frames')
    tmp = os.path.join(a.out, 'tmp')
    os.makedirs(fdir, exist_ok=True)
    os.makedirs(tmp, exist_ok=True)
    src = lambda i: os.path.join(a.frames, f'{i:03d}.png')
    crop = lambda i: cv2.imread(src(i))[y0:y1, x0:x1]

    def rife(i0, i1, t, out):
        p0, p1 = os.path.join(tmp, f'{i0}.png'), os.path.join(tmp, f'{i1}.png')
        for i, p in ((i0, p0), (i1, p1)):
            if not os.path.exists(p):
                cv2.imwrite(p, crop(i))
        subprocess.run([os.path.join(RIFE, 'rife-ncnn-vulkan'), '-0', p0, '-1', p1, '-o', out, '-s', f'{t:.4f}',
                        '-m', os.path.join(RIFE, 'rife-v4.6')], check=True, capture_output=True)
        return cv2.imread(out)

    # Blink frames are simply left out. Interpolating across them (RIFE) doubled the eyes where the head
    # moves a lot during the blink, which looks far worse than a slightly bigger step.
    # `--from` reuses frames already processed elsewhere (e.g. Real-ESRGAN output of an earlier run that
    # numbered every position of every segment, blinks included): position k of that run -> file k.
    n = 0
    k_all = 0
    segs = {}
    srcs = []
    for name, (s, e) in SEGMENTS.items():
        start = n
        for i in [0] + list(range(s + 1, e + 1)):   # neutral frame 0 first, for every direction
            if i not in BLINKS:
                out = os.path.join(fdir, f'{n:04d}.png')
                if a.reuse:
                    im = cv2.imread(os.path.join(a.reuse, f'{k_all:04d}.png'))
                    if a.size and im.shape[0] != a.size:
                        im = cv2.resize(im, (a.size, a.size), interpolation=cv2.INTER_AREA)
                    cv2.imwrite(out, im)
                else:
                    cv2.imwrite(out, crop(i))
                srcs.append(i); n += 1
            k_all += 1
        segs[name] = [start, n - 1]

    full = cv2.imread(src(0))
    room = cv2.imread(a.base) if a.base else full
    if a.base_width and room.shape[1] != a.base_width:
        room = cv2.resize(room, (a.base_width, round(room.shape[0] * a.base_width / room.shape[1])), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(a.out, 'base.webp'), room, [cv2.IMWRITE_WEBP_QUALITY, 88])
    # w/h stay in source pixels: the box is placed in % of them, whatever the base image resolution
    json.dump({'w': full.shape[1], 'h': full.shape[0], 'box': [x0, y0, x1, y1], 'fps': 24, 'frames': n, 'seg': segs,
               'src': srcs}, open(os.path.join(a.out, 'clip.json'), 'w'))
    print('frames', n, segs)


if __name__ == '__main__':
    main()
