#!/usr/bin/env python3
"""
Mouse data collection pipeline (simulating gaze).
Hold G to record mouse position + advance video. Release G to pause.
Video ends recording automatically. For images, release G to stop.
Press Q to skip to the next file.

Usage:
    python collect_mouse.py --input INPUT_DIR --output OUTPUT_DIR
"""

import argparse
import sys
import threading
import time
from pathlib import Path

import cv2
import numpy as np
from pynput import keyboard

IMAGE_EXTS = frozenset({'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp', '.gif'})
VIDEO_EXTS = frozenset({'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v', '.webm'})
DISPLAY_WIN = "Mouse Collector"

def get_screen_size():
    try:
        from screeninfo import get_monitors
        m = get_monitors()[0]
        return m.width, m.height
    except Exception:
        return 1470, 956

class GKey:
    def __init__(self):
        self._held = False
        self._lock = threading.Lock()
        self._listener = keyboard.Listener(on_press=self._press, on_release=self._release)
        self._listener.start()
    def _press(self, key):
        try:
            if key.char == 'g':
                with self._lock: self._held = True
        except AttributeError: pass
    def _release(self, key):
        try:
            if key.char == 'g':
                with self._lock: self._held = False
        except AttributeError: pass
    @property
    def held(self):
        with self._lock: return self._held
    def stop(self):
        self._listener.stop()

def letterbox(content, screen_w, screen_h):
    h, w = content.shape[:2]
    scale = min(screen_w / w, screen_h / h)
    nw, nh = int(w * scale), int(h * scale)
    resized = cv2.resize(content, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
    x_off, y_off = (screen_w - nw) // 2, (screen_h - nh) // 2
    canvas[y_off:y_off+nh, x_off:x_off+nw] = resized
    return canvas, x_off, y_off, scale

_mouse_pos = (0, 0)
def _mouse_cb(event, x, y, flags, param):
    global _mouse_pos
    if event == cv2.EVENT_MOUSEMOVE or event == cv2.EVENT_LBUTTONDOWN or event == cv2.EVENT_LBUTTONUP:
        _mouse_pos = (x, y)

def init_window():
    cv2.namedWindow(DISPLAY_WIN, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(DISPLAY_WIN, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
    cv2.setMouseCallback(DISPLAY_WIN, _mouse_cb)

def collect_image(path, gkey, screen_w, screen_h, output_path):
    global _mouse_pos
    img = cv2.imread(str(path))
    if img is None:
        print(f"    Cannot read: {path}")
        return

    orig_h, orig_w = img.shape[:2]
    canvas, x_off, y_off, scale = letterbox(img, screen_w, screen_h)
    MAX_SEC = 3.0

    gaze_points, detected, timestamps = [], [], []
    t_start = None

    print(f"    {orig_w}x{orig_h} image. Hold G to record ({MAX_SEC}s max). Q to skip.")

    # Require releasing G before starting this file
    while gkey.held:
        display = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
        cv2.putText(display, "Release G to start next image", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 160, 255), 2)
        cv2.imshow(DISPLAY_WIN, display)
        if cv2.waitKey(16) & 0xFF == ord('q'):
            return

    while True:
        display = canvas.copy() if gkey.held else np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
        raw_sx, raw_sy = _mouse_pos

        if gkey.held:
            if t_start is None:
                t_start = time.perf_counter()

            gaze_points.append([raw_sx, raw_sy])
            detected.append(True)
            timestamps.append(time.perf_counter() - t_start)

            cv2.circle(display, (raw_sx, raw_sy), 12, (0, 0, 255), -1)

            elapsed = time.perf_counter() - t_start
            remaining = max(0, MAX_SEC - elapsed)
            cv2.putText(display, f"RECORDING  {remaining:.1f}s left",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            if elapsed >= MAX_SEC:
                print(f"    {MAX_SEC}s reached — auto-advancing.")
                break
        else:
            cv2.putText(display, "Hold G to record  |  Q to skip",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
            cv2.circle(display, (raw_sx, raw_sy), 12, (180, 180, 0), 1)

        cv2.imshow(DISPLAY_WIN, display)
        if cv2.waitKey(16) & 0xFF == ord('q'):
            break

    if gaze_points:
        np.savez(str(output_path),
                 gaze=np.array(gaze_points, dtype=np.float32),
                 detected=np.array(detected, dtype=bool),
                 timestamps=np.array(timestamps, dtype=np.float32),
                 dimensions=np.array([orig_w, orig_h], dtype=np.int32),
                 display_offset=np.array([x_off, y_off], dtype=np.int32),
                 display_scale=np.array([scale], dtype=np.float32),
                 source_type=np.array(['image']))
        n_real = sum(detected)
        print(f"    Saved {len(gaze_points)} pts ({n_real} detected) → {output_path}")
    else:
        print("    No gaze recorded.")

def collect_video(path, gkey, screen_w, screen_h, output_path):
    global _mouse_pos
    vcap = cv2.VideoCapture(str(path))
    if not vcap.isOpened():
        print(f"    Cannot open: {path}")
        return

    fps    = vcap.get(cv2.CAP_PROP_FPS) or 30.0
    total  = int(vcap.get(cv2.CAP_PROP_FRAME_COUNT))
    orig_w = int(vcap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(vcap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    interval = 1.0 / fps

    print(f"    {orig_w}x{orig_h} @ {fps:.1f}fps, {total} frames. Hold G to record. Q to skip.")

    # Require releasing G before starting this file
    while gkey.held:
        display = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
        cv2.putText(display, "Release G to start next video", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 160, 255), 2)
        cv2.imshow(DISPLAY_WIN, display)
        if cv2.waitKey(16) & 0xFF == ord('q'):
            vcap.release()
            return

    dummy = np.zeros((orig_h, orig_w, 3), dtype=np.uint8)
    _, x_off, y_off, scale = letterbox(dummy, screen_w, screen_h)

    gaze_points, frame_indices, detected_mask = [], [], []

    ret, current_raw = vcap.read()
    if not ret:
        vcap.release(); return

    frame_idx = 0
    canvas, _, _, _ = letterbox(current_raw, screen_w, screen_h)
    t_next = time.perf_counter() + interval

    while True:
        display = canvas.copy() if gkey.held else np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
        raw_sx, raw_sy = _mouse_pos

        if gkey.held:
            gaze_points.append([raw_sx, raw_sy])
            detected_mask.append(True)
            frame_indices.append(frame_idx)

            cv2.circle(display, (raw_sx, raw_sy), 12, (0, 0, 255), -1)

            cv2.putText(display, f"RECORDING  {frame_idx}/{total}",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            if time.perf_counter() >= t_next:
                ret_v, nxt = vcap.read()
                if not ret_v:
                    cv2.imshow(DISPLAY_WIN, display); cv2.waitKey(600)
                    print("    Video ended."); break
                current_raw = nxt
                canvas, _, _, _ = letterbox(current_raw, screen_w, screen_h)
                frame_idx += 1; t_next += interval
        else:
            t_next = time.perf_counter() + interval
            cv2.putText(display, f"Paused (hold G)  {frame_idx}/{total}",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
            cv2.circle(display, (raw_sx, raw_sy), 12, (180, 180, 0), 1)

        cv2.imshow(DISPLAY_WIN, display)
        if cv2.waitKey(16) & 0xFF == ord('q'):
            break

    vcap.release()
    if gaze_points:
        np.savez(str(output_path),
                 gaze=np.array(gaze_points, dtype=np.float32),
                 detected=np.array(detected_mask, dtype=bool),
                 frame_indices=np.array(frame_indices, dtype=np.int32),
                 dimensions=np.array([orig_w, orig_h], dtype=np.int32),
                 display_offset=np.array([x_off, y_off], dtype=np.int32),
                 display_scale=np.array([scale], dtype=np.float32),
                 fps=np.array([fps], dtype=np.float32),
                 source_type=np.array(['video']))
        n_real = sum(detected_mask)
        print(f"    Saved {len(gaze_points)} pts ({n_real} detected) → {output_path}")
    else:
        print("    No gaze recorded.")


def main():
    parser = argparse.ArgumentParser(description="Mouse data collection (simulated gaze).")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="output")
    args = parser.parse_args()

    input_dir  = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()
    if not input_dir.exists():
        print(f"Input not found: {input_dir}"); sys.exit(1)

    screen_w, screen_h = get_screen_size()
    print(f"Screen: {screen_w}x{screen_h}")

    print("\n--- COLLECTION ---")
    all_exts = IMAGE_EXTS | VIDEO_EXTS
    files = [(p, 'image' if p.suffix.lower() in IMAGE_EXTS else 'video')
             for p in sorted(input_dir.rglob("*"))
             if p.is_file() and p.suffix.lower() in all_exts]

    if not files:
        print(f"No files in {input_dir}"); sys.exit(0)

    print(f"Found {len(files)} file(s).\n")
    gkey = GKey()
    init_window()

    for i, (fpath, ftype) in enumerate(files):
        rel = fpath.relative_to(input_dir)
        out = output_dir / rel.with_suffix('.npz')
        out.parent.mkdir(parents=True, exist_ok=True)
        print(f"  [{i+1}/{len(files)}] {rel}  ({ftype})")
        if ftype == 'image':
            collect_image(fpath, gkey, screen_w, screen_h, out)
        else:
            collect_video(fpath, gkey, screen_w, screen_h, out)
        print()

    cv2.destroyAllWindows()
    gkey.stop()
    print("Collection complete.")

if __name__ == "__main__":
    main()
