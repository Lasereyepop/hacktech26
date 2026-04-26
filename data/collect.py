#!/usr/bin/env python3
"""
Gaze data collection pipeline. Single session: calibrate → collect all files.
Uses MediaPipe FaceLandmarker for true head-invariant gaze tracking.

One landmarker lives for the entire session.
Raw (unsmoothed) gaze is saved to .npz. Smoothing is display-only.
Every frame gets a gaze point — if detection fails, last known position is carried forward.
"""

import argparse
import sys
import threading
import time
import collections
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import numpy as np
from pynput import keyboard

IMAGE_EXTS = frozenset({'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp', '.gif'})
VIDEO_EXTS = frozenset({'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v', '.webm'})
DISPLAY_WIN = "Gaze Collector"
CAL_WIN = "Calibration — stare at each dot"

MODEL_PATH = Path(__file__).parent / "face_landmarker.task"
MODEL_URL  = ("https://storage.googleapis.com/mediapipe-models/"
              "face_landmarker/face_landmarker/float16/latest/face_landmarker.task")

LEFT_IRIS    = 468
RIGHT_IRIS   = 473
L_EYE_OUTER  = 33
L_EYE_INNER  = 133
R_EYE_INNER  = 362
R_EYE_OUTER  = 263
L_EYE_TOP    = 159
L_EYE_BOT    = 145
R_EYE_TOP    = 386
R_EYE_BOT    = 374


def _ensure_model():
    if not MODEL_PATH.exists():
        print(f"Downloading face landmark model (~29 MB) → {MODEL_PATH}")
        urllib.request.urlretrieve(MODEL_URL, str(MODEL_PATH))
        print("  Model downloaded.")


def get_screen_size():
    try:
        from screeninfo import get_monitors
        m = get_monitors()[0]
        return m.width, m.height
    except Exception:
        return 1470, 956


def get_pupil_features(frame, landmarker, timestamp_ms):
    """Returns head-invariant pupil features (4-vector) using MediaPipe."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect_for_video(mp_img, timestamp_ms)
    
    if not result.face_landmarks:
        return None
    
    lm = result.face_landmarks[0]
    
    l_eye_w = lm[L_EYE_INNER].x - lm[L_EYE_OUTER].x
    r_eye_w = lm[R_EYE_OUTER].x - lm[R_EYE_INNER].x
    if l_eye_w < 1e-6 or r_eye_w < 1e-6:
        return None
    
    l_rel_x = (lm[LEFT_IRIS].x  - lm[L_EYE_OUTER].x) / l_eye_w
    r_rel_x = (lm[RIGHT_IRIS].x - lm[R_EYE_INNER].x) / r_eye_w
    
    l_eye_h = max(lm[L_EYE_BOT].y - lm[L_EYE_TOP].y, 1e-6)
    r_eye_h = max(lm[R_EYE_BOT].y - lm[R_EYE_TOP].y, 1e-6)
    l_ctr_y = (lm[L_EYE_TOP].y + lm[L_EYE_BOT].y) / 2
    r_ctr_y = (lm[R_EYE_TOP].y + lm[R_EYE_BOT].y) / 2
    l_rel_y = (lm[LEFT_IRIS].y  - l_ctr_y) / l_eye_h
    r_rel_y = (lm[RIGHT_IRIS].y - r_ctr_y) / r_eye_h
    
    return np.array([l_rel_x, l_rel_y, r_rel_x, r_rel_y], dtype=np.float64)


def poly_features(raw):
    """Degree-2 polynomial feature vector for stable regression."""
    lx, ly, rx, ry = raw
    return np.array([
        1,
        lx, ly, rx, ry,
        (lx + rx) / 2, (ly + ry) / 2,
    ], dtype=np.float64)


class Smoother:
    def __init__(self, window=5):
        self._buf = collections.deque(maxlen=window)
    def update(self, val):
        self._buf.append(val)
        return np.mean(self._buf, axis=0)


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


def init_window():
    cv2.namedWindow(DISPLAY_WIN, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(DISPLAY_WIN, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)


def pupil_to_screen(feat, cx, cy, screen_w, screen_h):
    f = poly_features(feat)
    sx = int(np.clip(np.dot(f, cx), 0, screen_w - 1))
    sy = int(np.clip(np.dot(f, cy), 0, screen_h - 1))
    return sx, sy


CAL_GRID       = (3, 3)
COUNTDOWN_SEC  = 1
STD_THRESH     = 0.015  # relative units
STABLE_FRAMES  = 12

def run_calibration(cap, landmarker, screen_w, screen_h, start_ts):
    rows, cols = CAL_GRID
    mx, my = int(screen_w * 0.12), int(screen_h * 0.12)
    cal_screen = [
        (int(mx + (screen_w - 2*mx) * c / (cols-1)),
         int(my + (screen_h - 2*my) * r / (rows-1)))
        for r in range(rows) for c in range(cols)
    ]

    pupil_samples = []
    screen_samples = []
    ts = start_ts

    cv2.namedWindow(CAL_WIN, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(CAL_WIN, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    for i, (sx, sy) in enumerate(cal_screen):
        print(f"\n--- Point {i+1}/{len(cal_screen)} at ({sx}, {sy}) ---")

        for c in range(COUNTDOWN_SEC, 0, -1):
            bg = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
            cv2.circle(bg, (sx, sy), 20, (0, 220, 0), -1, cv2.LINE_AA)
            cv2.circle(bg, (sx, sy), 5, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.putText(bg, f"({i+1}/{len(cal_screen)}) Look at the dot — {c}...",
                        (screen_w//2 - 250, screen_h - 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (180, 180, 180), 2)
            cv2.imshow(CAL_WIN, bg)
            cv2.waitKey(1000)

        streak = []
        deadline = time.time() + 15
        last_log = time.time()

        while True:
            if time.time() > deadline:
                print(f"  TIMEOUT — skipping point {i+1}")
                break

            ret, frame = cap.read()
            if not ret:
                continue

            ts += 1
            feat = get_pupil_features(frame, landmarker, ts)

            if feat is None:
                if streak:
                    print(f"  No face — resetting streak (was {len(streak)})")
                streak = []
            else:
                streak.append(feat)

                if len(streak) >= 8:
                    recent = np.array(streak[-8:])
                    std_max = recent.std(axis=0).max()
                    if std_max > STD_THRESH:
                        print(f"  Unstable (max_std={std_max:.3f}) — resetting")
                        streak = []
                    elif time.time() - last_log > 0.3:
                        print(f"  Stable streak={len(streak)} "
                              f"lx={feat[0]:.2f} ly={feat[1]:.2f} "
                              f"rx={feat[2]:.2f} ry={feat[3]:.2f} "
                              f"std={std_max:.3f}")
                        last_log = time.time()

            progress = min(len(streak) / STABLE_FRAMES, 1.0)
            bg = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
            cv2.circle(bg, (sx, sy), 32, (60, 60, 60), 4)
            if progress > 0:
                sweep = progress * 360.0
                for thick, color in [(6, (0, 160, 80)), (4, (0, 220, 110)), (2, (80, 255, 160))]:
                    cv2.ellipse(bg, (sx, sy), (32, 32), -90, 0, sweep, color, thick, cv2.LINE_AA)
            dot_r = max(8, int(18 - progress * 6))
            cv2.circle(bg, (sx, sy), dot_r, (0, 220, 0), -1, cv2.LINE_AA)
            cv2.circle(bg, (sx, sy), 4, (255, 255, 255), -1, cv2.LINE_AA)

            if feat is None:
                cv2.putText(bg, "NO FACE DETECTED",
                            (screen_w//2 - 180, 50),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 80, 255), 2)

            cv2.imshow(CAL_WIN, bg)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                cv2.destroyAllWindows()
                return None

            if len(streak) >= STABLE_FRAMES:
                break

        if len(streak) >= STABLE_FRAMES:
            avg = np.mean(streak[-STABLE_FRAMES:], axis=0)
            print(f"  ACCEPTED  lx={avg[0]:.2f} ly={avg[1]:.2f} rx={avg[2]:.2f} ry={avg[3]:.2f}")
            pupil_samples.append(avg)
            screen_samples.append([sx, sy])

            for t in range(10):
                alpha = 1.0 - t / 10.0
                flash = bg.copy()
                w = int(255 * alpha)
                cv2.circle(flash, (sx, sy), 32, (w, w, w), 4, cv2.LINE_AA)
                cv2.circle(flash, (sx, sy), 18, (w, w, w), -1, cv2.LINE_AA)
                cv2.imshow(CAL_WIN, flash)
                cv2.waitKey(25)

    cv2.destroyWindow(CAL_WIN)

    if len(pupil_samples) < 5:
        print(f"\n  Only {len(pupil_samples)} points collected — need at least 5.")
        return None, None, ts

    pupil_arr = np.array(pupil_samples)
    screen_arr = np.array(screen_samples)

    F = np.array([poly_features(p) for p in pupil_arr])
    cx, _, _, _ = np.linalg.lstsq(F, screen_arr[:, 0], rcond=None)
    cy, _, _, _ = np.linalg.lstsq(F, screen_arr[:, 1], rcond=None)

    pred_x = F @ cx
    pred_y = F @ cy
    residual = np.sqrt((pred_x - screen_arr[:, 0])**2 + (pred_y - screen_arr[:, 1])**2).mean()
    print(f"\n  Calibration residual: {residual:.1f} px (mean)")

    return cx, cy, ts


def live_test(cap, landmarker, cx, cy, screen_w, screen_h, start_ts):
    print("\n  === LIVE TEST (press Q to accept, R to recalibrate) ===")
    print("  Look around — red dot should follow your gaze.\n")

    WIN = "Gaze Live Test (Q=accept, R=recalibrate)"
    cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(WIN, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    trail = collections.deque(maxlen=25)
    smoother = Smoother(window=3)
    fps_buf = collections.deque(maxlen=60)
    prev_t = time.time()
    ts = start_ts

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        ts += 1
        feat = get_pupil_features(frame, landmarker, ts)

        display = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)

        if feat is not None:
            feat = smoother.update(feat)
            sx, sy = pupil_to_screen(feat, cx, cy, screen_w, screen_h)

            trail.append((sx, sy))
            for k in range(1, len(trail)):
                alpha = k / len(trail)
                thick = max(1, int(4 * alpha))
                cv2.line(display, trail[k-1], trail[k], (0, 0, int(255*alpha)), thick)

            cv2.circle(display, (sx, sy), 14, (0, 0, 255), 2)
            cv2.circle(display, (sx, sy), 4, (0, 0, 255), -1)
            cv2.putText(display, f"({sx}, {sy})",
                        (sx + 18, sy - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)
        else:
            cv2.putText(display, "NO FACE DETECTED",
                        (screen_w//2 - 200, screen_h//2),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 80, 255), 2)

        now = time.time()
        fps_buf.append(1 / max(now - prev_t, 1e-6))
        prev_t = now
        cv2.putText(display, f"FPS: {np.mean(fps_buf):.0f}  (Q=accept, R=recalibrate)",
                    (20, screen_h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (120, 120, 120), 1)

        cv2.imshow(WIN, display)
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            cv2.destroyWindow(WIN)
            return 'accept', ts
        if key == ord('r'):
            cv2.destroyWindow(WIN)
            return 'recalibrate', ts

    cv2.destroyWindow(WIN)
    return 'accept', ts


def collect_image(path, cap, landmarker, cx, cy, gkey, screen_w, screen_h, output_path, start_ts):
    img = cv2.imread(str(path))
    if img is None:
        print(f"    Cannot read: {path}")
        return start_ts

    orig_h, orig_w = img.shape[:2]
    canvas, x_off, y_off, scale = letterbox(img, screen_w, screen_h)
    MAX_SEC = 3.0

    gaze_points, detected, timestamps = [], [], []
    t_start = None
    last_gaze = None
    smoother = Smoother(window=3)
    ts = start_ts

    print(f"    {orig_w}x{orig_h} image. Hold G to record ({MAX_SEC}s max). Q to skip.")

    # Require releasing G before starting this file
    while gkey.held:
        display = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
        cv2.putText(display, "Release G to start next image", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 160, 255), 2)
        cv2.imshow(DISPLAY_WIN, display)
        if cv2.waitKey(16) & 0xFF == ord('q'):
            return ts

    while True:
        ret, frame = cap.read()
        if not ret:
            continue
            
        ts += 1
        feat = get_pupil_features(frame, landmarker, ts)
        display = canvas.copy() if gkey.held else np.zeros((screen_h, screen_w, 3), dtype=np.uint8)

        if gkey.held:
            if t_start is None:
                t_start = time.perf_counter()

            if feat is not None:
                raw_sx, raw_sy = pupil_to_screen(feat, cx, cy, screen_w, screen_h)
                last_gaze = (raw_sx, raw_sy)
                gaze_points.append([raw_sx, raw_sy]); detected.append(True)
            elif last_gaze is not None:
                gaze_points.append(list(last_gaze)); detected.append(False)

            if gaze_points:
                timestamps.append(time.perf_counter() - t_start)

            if feat is not None:
                smoothed = smoother.update(feat)
                dsx, dsy = pupil_to_screen(smoothed, cx, cy, screen_w, screen_h)
                cv2.circle(display, (dsx, dsy), 12, (0, 0, 255), -1)

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
            if feat is not None:
                smoothed = smoother.update(feat)
                dsx, dsy = pupil_to_screen(smoothed, cx, cy, screen_w, screen_h)
                cv2.circle(display, (dsx, dsy), 12, (180, 180, 0), 1)

        cv2.imshow(DISPLAY_WIN, display)
        if cv2.waitKey(1) & 0xFF == ord('q'):
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
        
    return ts


def collect_video(path, cap, landmarker, cx, cy, gkey, screen_w, screen_h, output_path, start_ts):
    vcap = cv2.VideoCapture(str(path))
    if not vcap.isOpened():
        print(f"    Cannot open: {path}")
        return start_ts

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
            return start_ts

    dummy = np.zeros((orig_h, orig_w, 3), dtype=np.uint8)
    _, x_off, y_off, scale = letterbox(dummy, screen_w, screen_h)

    gaze_points, frame_indices, detected_mask = [], [], []
    last_gaze = None
    smoother = Smoother(window=3)
    ts = start_ts

    ret, current_raw = vcap.read()
    if not ret:
        vcap.release(); return ts

    frame_idx = 0
    canvas, _, _, _ = letterbox(current_raw, screen_w, screen_h)
    t_next = time.perf_counter() + interval

    while True:
        ret_cam, cam_frame = cap.read()
        feat = None
        if ret_cam:
            ts += 1
            feat = get_pupil_features(cam_frame, landmarker, ts)
        
        display = canvas.copy() if gkey.held else np.zeros((screen_h, screen_w, 3), dtype=np.uint8)

        if gkey.held:
            if feat is not None:
                raw_sx, raw_sy = pupil_to_screen(feat, cx, cy, screen_w, screen_h)
                last_gaze = (raw_sx, raw_sy)
                gaze_points.append([raw_sx, raw_sy]); detected_mask.append(True)
            elif last_gaze is not None:
                gaze_points.append(list(last_gaze)); detected_mask.append(False)
            else:
                gaze_points.append([screen_w//2, screen_h//2]); detected_mask.append(False)
            frame_indices.append(frame_idx)

            if feat is not None:
                smoothed = smoother.update(feat)
                dsx, dsy = pupil_to_screen(smoothed, cx, cy, screen_w, screen_h)
                cv2.circle(display, (dsx, dsy), 12, (0, 0, 255), -1)

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
            if feat is not None:
                smoothed = smoother.update(feat)
                dsx, dsy = pupil_to_screen(smoothed, cx, cy, screen_w, screen_h)
                cv2.circle(display, (dsx, dsy), 12, (180, 180, 0), 1)

        cv2.imshow(DISPLAY_WIN, display)
        if cv2.waitKey(1) & 0xFF == ord('q'):
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
        
    return ts


def main():
    parser = argparse.ArgumentParser(description="Gaze collection: calibrate → collect.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="output")
    parser.add_argument("--camera", type=int, default=0)
    args = parser.parse_args()

    input_dir  = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()
    if not input_dir.exists():
        print(f"Input not found: {input_dir}"); sys.exit(1)

    screen_w, screen_h = get_screen_size()
    print(f"Screen: {screen_w}x{screen_h}")

    _ensure_model()
    options = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        running_mode=mp_vision.RunningMode.VIDEO,
    )
    
    with mp_vision.FaceLandmarker.create_from_options(options) as landmarker:
        cap = cv2.VideoCapture(args.camera)
        if not cap.isOpened():
            print("Cannot open camera"); sys.exit(1)

        print("Warming up (2s)...")
        t0 = time.time()
        ts = 0
        while time.time() - t0 < 2:
            ret, frame = cap.read()
            if ret:
                ts += 1
                get_pupil_features(frame, landmarker, ts)

        print("\n--- CALIBRATION ---")
        while True:
            cx, cy, ts = run_calibration(cap, landmarker, screen_w, screen_h, ts)
            if cx is None:
                print("Calibration failed."); cap.release(); sys.exit(1)
            action, ts = live_test(cap, landmarker, cx, cy, screen_w, screen_h, ts)
            if action == 'recalibrate':
                print("\nRecalibrating...\n"); continue
            break

        print("\n--- COLLECTION ---")
        all_exts = IMAGE_EXTS | VIDEO_EXTS
        files = [(p, 'image' if p.suffix.lower() in IMAGE_EXTS else 'video')
                 for p in sorted(input_dir.rglob("*"))
                 if p.is_file() and p.suffix.lower() in all_exts]

        if not files:
            print(f"No files in {input_dir}"); cap.release(); sys.exit(0)

        print(f"Found {len(files)} file(s).\n")
        gkey = GKey()
        init_window()

        for i, (fpath, ftype) in enumerate(files):
            rel = fpath.relative_to(input_dir)
            out = output_dir / rel.with_suffix('.npz')
            out.parent.mkdir(parents=True, exist_ok=True)
            print(f"  [{i+1}/{len(files)}] {rel}  ({ftype})")
            if ftype == 'image':
                ts = collect_image(fpath, cap, landmarker, cx, cy, gkey, screen_w, screen_h, out, ts)
            else:
                ts = collect_video(fpath, cap, landmarker, cx, cy, gkey, screen_w, screen_h, out, ts)
            print()

        cv2.destroyAllWindows()
        gkey.stop()
        cap.release()
        print("Collection complete.")

if __name__ == "__main__":
    main()
