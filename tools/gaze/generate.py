"""Generate a head-pose grid from one portrait with LivePortrait.

Run from tools/LivePortrait with its venv:
  PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python ../gaze/generate.py --src ... --out ... [--test]

Grid cell (col, row) -> yaw from -YAW..+YAW (left to right on screen), pitch from +PITCH..-PITCH (top to bottom).
Eyes lead the head: eyeball direction is added on top of the head rotation.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
import torch

LP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'LivePortrait'))
sys.path.insert(0, LP)
os.chdir(LP)

from src.config.argument_config import ArgumentConfig  # noqa: E402
from src.config.crop_config import CropConfig  # noqa: E402
from src.config.inference_config import InferenceConfig  # noqa: E402
from src.gradio_pipeline import GradioPipeline  # noqa: E402
from src.utils.camera import get_rotation_matrix  # noqa: E402
from src.utils.crop import prepare_paste_back, paste_back  # noqa: E402
from src.utils.io import load_img_online  # noqa: E402
from src.utils.retargeting_utils import calc_eye_close_ratio  # noqa: E402


def fields(cls, d):
    return cls(**{k: v for k, v in d.items() if hasattr(cls, k)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cols', type=int, default=15)
    ap.add_argument('--rows', type=int, default=9)
    ap.add_argument('--yaw', type=float, default=20)     # degrees, each side
    ap.add_argument('--pitch', type=float, default=12)   # degrees, up and down
    ap.add_argument('--eyes-x', type=float, default=10)  # eyeball offset at full yaw
    ap.add_argument('--eyes-y', type=float, default=14)  # eyeball offset at full pitch
    ap.add_argument('--max-dim', type=int, default=1920)
    ap.add_argument('--quality', type=int, default=82)  # webp quality of the cropped frames
    ap.add_argument('--test', action='store_true', help='only corners, edges and center')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    args = ArgumentConfig()
    pipe = GradioPipeline(fields(InferenceConfig, args.__dict__), fields(CropConfig, args.__dict__), args)
    w = pipe.live_portrait_wrapper
    dev = w.device
    print('device', dev)

    img = load_img_online(os.path.abspath(a.src), mode='rgb', max_dim=a.max_dim, n=2)
    crop = pipe.cropper.crop_source_image(img, pipe.cropper.crop_cfg)
    if crop is None:
        sys.exit('no face found')
    I_s = w.prepare_source(crop['img_crop_256x256'])
    lmk = crop['lmk_crop']
    mask = prepare_paste_back(w.inference_cfg.mask_crop, crop['M_c2o'], dsize=(img.shape[1], img.shape[0]))
    info = w.get_kp_info(I_s)
    f_s = w.extract_feature_3d(I_s)
    x_s = w.transform_keypoint(info)
    R_s = get_rotation_matrix(info['pitch'], info['yaw'], info['roll'])
    eye_ratio = float(calc_eye_close_ratio(lmk[None]).mean())
    print('source pose', float(info['pitch']), float(info['yaw']), float(info['roll']), 'eyes', round(eye_ratio, 3))

    def render(dyaw, dpitch, ex, ey, eyes_closed=False):
        R_d = get_rotation_matrix(info['pitch'] + dpitch, info['yaw'] + dyaw, info['roll'])
        R_new = (R_d @ R_s.permute(0, 2, 1)) @ R_s
        delta = info['exp'].clone().to(dev)
        if ex or ey:
            delta = pipe.update_delta_new_eyeball_direction(torch.tensor(ex).to(dev), torch.tensor(ey).to(dev), delta)
        x_d = info['scale'].to(dev) * (info['kp'].to(dev) @ R_new.to(dev) + delta) + info['t'].to(dev)
        if eyes_closed:
            r = w.calc_combined_eye_ratio([[0.0]], lmk)
            x_d = x_d + w.retarget_eye(x_s, r)
        x_d = w.stitching(x_s, x_d)
        out = w.parse_output(w.warp_decode(f_s, x_s, x_d)['out'])[0]
        return paste_back(out, crop['M_c2o'], img, mask)

    def save(name, rgb):
        cv2.imwrite(os.path.join(a.out, name), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_WEBP_QUALITY, 88])

    cols, rows = a.cols, a.rows
    cells = [(c, r) for r in range(rows) for c in range(cols)]
    if a.test:
        mc, mr = cols // 2, rows // 2
        cells = sorted({(0, mr), (cols - 1, mr), (mc, 0), (mc, rows - 1), (mc, mr), (0, 0), (cols - 1, rows - 1)})

    with torch.no_grad():
        center = render(0, 0, 0, 0).astype(np.int16)
        moved = np.zeros(center.shape[:2], bool)   # pixels that differ from the center pose in any frame
        for i, (c, r) in enumerate(cells):
            u = c / (cols - 1) * 2 - 1   # -1 left .. +1 right (screen)
            v = r / (rows - 1) * 2 - 1   # -1 top .. +1 bottom (screen)
            # signs checked on contact sheets: -yaw turns the head toward screen right, +pitch tilts it down,
            # +eyes_x moves pupils toward screen right, -eyes_y moves them down
            rgb = render(-u * a.yaw, v * a.pitch, u * a.eyes_x, -v * a.eyes_y)
            save(f'g_{c:02d}_{r:02d}.webp', rgb)
            moved |= np.abs(rgb.astype(np.int16) - center).max(axis=2) > 6
            print(f'{i + 1}/{len(cells)} c{c} r{r}', flush=True)
        blink = render(0, 0, 0, 0, eyes_closed=True)
        save('blink.webp', blink)
        save('base.webp', center.astype(np.uint8))

    ys, xs = np.nonzero(moved)
    m = 16
    box = [max(0, int(xs.min()) - m), max(0, int(ys.min()) - m),
           min(img.shape[1], int(xs.max()) + m), min(img.shape[0], int(ys.max()) + m)]
    # keep only the moving region in every frame; base.webp stays full size
    x0, y0, x1, y1 = box
    for name in [f'g_{c:02d}_{r:02d}.webp' for c, r in cells] + ['blink.webp']:
        p = os.path.join(a.out, name)
        cv2.imwrite(p, cv2.imread(p)[y0:y1, x0:x1], [cv2.IMWRITE_WEBP_QUALITY, a.quality])
    json.dump({'cols': cols, 'rows': rows, 'yaw': a.yaw, 'pitch': a.pitch, 'w': img.shape[1], 'h': img.shape[0],
               'box': box, 'cropped': True}, open(os.path.join(a.out, 'grid.json'), 'w'))
    print('moving region', box)


if __name__ == '__main__':
    main()
