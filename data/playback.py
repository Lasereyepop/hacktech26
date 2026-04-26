#!/usr/bin/env python3
"""
Playback gaze data over original images/videos.
Reads .npz files produced by collect.py.

Shows gaze point (red = detected, yellow = carried forward from last detection).
Displays coordinates on screen. Optional --trail for gaze history.

Usage:
    python playback.py --input INPUT_DIR --gaze GAZE_DIR
    python playback.py --input INPUT_DIR --gaze GAZE_DIR --trail 20
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTS = frozenset({'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp', '.gif'})
VIDEO_EXTS = frozenset({'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v', '.webm'})

DISPLAY_WIN = "Gaze Playback"


def get_screen_size():
    try:
        from screeninfo import get_monitors
        m = get_monitors()[0]
        return m.width, m.height
    except Exception:
        return 1470, 956


def letterbox(content, screen_w, screen_h):
    h, w = content.shape[:2]
    scale = min(screen_w / w, screen_h / h)
    nw, nh = int(w * scale), int(h * scale)
    resized = cv2.resize(content, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
    x_off = (screen_w - nw) // 2
    y_off = (screen_h - nh) // 2
    canvas[y_off:y_off+nh, x_off:x_off+nw] = resized
    return canvas, x_off, y_off, scale


def remap_gaze(gaze, old_offset, old_scale, new_offset, new_scale):
    content = (gaze - old_offset) / old_scale
    return content * new_scale + new_offset


def draw_gaze(frame, pt, is_detected, trail, trail_len):
    if trail_len > 0 and len(trail) > 1:
        history = trail[-trail_len:]
        n = len(history)
        for i, (p, _) in enumerate(history[:-1]):
            alpha = (i + 1) / n
            radius = max(2, int(7 * alpha))
            b = int(255 * (1 - alpha))
            r = int(255 * alpha)
            cv2.circle(frame, (int(p[0]), int(p[1])), radius, (b, 60, r), -1)

    if pt is not None:
        x, y = int(pt[0]), int(pt[1])
        if is_detected:
            color = (0, 0, 255)       # red = real detection
            label_color = (0, 255, 255)
        else:
            color = (0, 180, 255)     # orange = carried forward
            label_color = (0, 180, 255)

        cv2.circle(frame, (x, y), 15, color, 2)
        cv2.circle(frame, (x, y), 4, color, -1)
        cv2.putText(frame, f"({x}, {y})",
                    (x + 18, y - 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, label_color, 2)


# ---------------------------------------------------------------------------
# Image playback
# ---------------------------------------------------------------------------

def playback_image(content_path, gaze_path, screen_w, screen_h, trail_len):
    data = np.load(str(gaze_path), allow_pickle=True)
    gaze       = data['gaze']
    detected   = data['detected'] if 'detected' in data else np.ones(len(gaze), dtype=bool)
    dims       = data['dimensions']
    old_offset = data['display_offset'].astype(float)
    old_scale  = float(data['display_scale'][0])

    img = cv2.imread(str(content_path))
    if img is None:
        print(f"  Cannot read: {content_path}")
        return

    canvas, new_x_off, new_y_off, new_scale = letterbox(img, screen_w, screen_h)
    new_offset = np.array([new_x_off, new_y_off], dtype=float)
    gaze_remapped = remap_gaze(gaze, old_offset, old_scale, new_offset, new_scale)

    n = len(gaze_remapped)
    n_det = int(detected.sum())
    print(f"  {dims[0]}x{dims[1]} image, {n} gaze points ({n_det} detected, {n - n_det} carried fwd)")
    print(f"  Space=pause  Q=next  Red=detected  Orange=carried forward")

    trail  = []  # list of (point, is_detected) tuples
    i      = 0
    paused = False

    while i < n:
        pt  = gaze_remapped[i]
        det = bool(detected[i])
        trail.append((pt, det))

        frame = canvas.copy()
        draw_gaze(frame, pt, det, trail, trail_len)

        cv2.putText(frame, f"Point {i+1}/{n}  {'DETECTED' if det else 'CARRIED FWD'}",
                    (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
        cv2.imshow(DISPLAY_WIN, frame)

        key = cv2.waitKey(33) & 0xFF  # ~30fps playback
        if key == ord('q'):
            return
        if key == ord(' '):
            paused = not paused

        if not paused:
            i += 1

    cv2.waitKey(500)


# ---------------------------------------------------------------------------
# Video playback
# ---------------------------------------------------------------------------

def playback_video(content_path, gaze_path, screen_w, screen_h, trail_len):
    data = np.load(str(gaze_path), allow_pickle=True)
    gaze       = data['gaze']
    detected   = data['detected'] if 'detected' in data else np.ones(len(gaze), dtype=bool)
    frame_idxs = data['frame_indices'].astype(int)
    dims       = data['dimensions']
    fps        = float(data['fps'][0])
    old_offset = data['display_offset'].astype(float)
    old_scale  = float(data['display_scale'][0])

    vcap = cv2.VideoCapture(str(content_path))
    if not vcap.isOpened():
        print(f"  Cannot open: {content_path}")
        return

    total    = int(vcap.get(cv2.CAP_PROP_FRAME_COUNT))
    interval = 1.0 / fps

    dummy = np.zeros((dims[1], dims[0], 3), dtype=np.uint8)
    _, new_x_off, new_y_off, new_scale = letterbox(dummy, screen_w, screen_h)
    new_offset = np.array([new_x_off, new_y_off], dtype=float)
    gaze_remapped = remap_gaze(gaze, old_offset, old_scale, new_offset, new_scale)

    # Build frame_idx -> (gaze_point, is_detected) map
    gaze_map = {}
    for fi, g, d in zip(frame_idxs, gaze_remapped, detected):
        gaze_map[int(fi)] = (tuple(g), bool(d))

    n_det = int(detected.sum())
    print(f"  {dims[0]}x{dims[1]} @ {fps:.1f}fps, {total} frames")
    print(f"  {len(gaze)} gaze points ({n_det} detected, {len(gaze)-n_det} carried fwd). Q=next.")

    trail     = []
    frame_idx = 0
    t_next    = time.perf_counter() + interval

    while True:
        ret, raw = vcap.read()
        if not ret:
            break

        canvas, _, _, _ = letterbox(raw, screen_w, screen_h)
        entry = gaze_map.get(frame_idx)
        pt  = entry[0] if entry else None
        det = entry[1] if entry else True

        if pt:
            trail.append((pt, det))

        draw_gaze(canvas, pt, det, trail, trail_len)

        label = "DETECTED" if (entry and det) else ("CARRIED FWD" if entry else "—")
        cv2.putText(canvas, f"Frame {frame_idx}/{total}  [{label}]",
                    (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)

        cv2.imshow(DISPLAY_WIN, canvas)

        now  = time.perf_counter()
        wait = max(1, int((t_next - now) * 1000))
        key  = cv2.waitKey(wait) & 0xFF
        t_next += interval
        frame_idx += 1

        if key == ord('q'):
            break

    vcap.release()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Playback gaze data over original content")
    parser.add_argument("--input", required=True, help="Input directory (original images/videos)")
    parser.add_argument("--gaze",  required=True, help="Gaze data directory (.npz from collect.py)")
    parser.add_argument("--trail", type=int, default=10, metavar="N",
                        help="Trailing gaze points (default: 10, 0=off)")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    gaze_dir  = Path(args.gaze).resolve()
    screen_w, screen_h = get_screen_size()

    cv2.namedWindow(DISPLAY_WIN, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(DISPLAY_WIN, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    found = False
    for fpath in sorted(input_dir.rglob("*")):
        if not fpath.is_file():
            continue
        ext = fpath.suffix.lower()
        if ext in IMAGE_EXTS:
            ftype = 'image'
        elif ext in VIDEO_EXTS:
            ftype = 'video'
        else:
            continue

        rel       = fpath.relative_to(input_dir)
        gaze_path = gaze_dir / rel.with_suffix('.npz')
        if not gaze_path.exists():
            print(f"No gaze data for {rel}, skipping.")
            continue

        found = True
        print(f"\nPlaying: {rel}")
        if ftype == 'image':
            playback_image(fpath, gaze_path, screen_w, screen_h, args.trail)
        else:
            playback_video(fpath, gaze_path, screen_w, screen_h, args.trail)

    if not found:
        print("No matching content + gaze file pairs found.")
        print(f"  Looked for .npz files in: {gaze_dir}")
        print(f"  Matching content in: {input_dir}")

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
