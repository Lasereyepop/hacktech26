"""
Convert raw collected gaze data (.npz from collect.py) into training-ready samples.

Usage:
    python -m model.preprocess --input data/input --gaze data/output --out data/processed --seq-len 90

Produces one .npz per sample in the output directory:
    frames: (1, H, W, 3) uint8 for images, (T, H, W, 3) for video
    gaze:   (T, 2) float32, normalized [0, 1] in content coordinates
    heatmap: (H, W) float32, saliency heatmap derived from gaze density
    source_type: 'image' or 'video'
"""

import argparse
from pathlib import Path

import cv2
import numpy as np

from ..utils.postprocess import gaze_to_heatmap

IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"})
VIDEO_EXTS = frozenset({".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".m4v", ".webm"})
IMAGE_SIZE = 224


def screen_to_content(gaze_screen, display_offset, display_scale, dimensions):
    """Convert screen-pixel gaze coordinates to content-normalized [0, 1]."""
    x_off, y_off = display_offset
    orig_w, orig_h = dimensions
    scale = display_scale

    content_x = (gaze_screen[:, 0] - x_off) / (orig_w * scale)
    content_y = (gaze_screen[:, 1] - y_off) / (orig_h * scale)

    content_x = np.clip(content_x, 0, 1)
    content_y = np.clip(content_y, 0, 1)

    return np.stack([content_x, content_y], axis=1).astype(np.float32)


def resample_to_frames(gaze, timestamps, seq_len, fps=30):
    """Resample irregularly-timed gaze data to fixed frame rate."""
    duration = timestamps[-1] - timestamps[0]
    n_frames = min(seq_len, max(1, int(duration * fps)))

    frame_times = np.linspace(timestamps[0], timestamps[-1], n_frames)

    gaze_x = np.interp(frame_times, timestamps, gaze[:, 0])
    gaze_y = np.interp(frame_times, timestamps, gaze[:, 1])

    resampled = np.stack([gaze_x, gaze_y], axis=1).astype(np.float32)

    if n_frames < seq_len:
        pad = np.zeros((seq_len - n_frames, 2), dtype=np.float32)
        pad[:] = resampled[-1]
        resampled = np.concatenate([resampled, pad], axis=0)

    return resampled[:seq_len]


def align_video_gaze(gaze, frame_indices, total_frames, seq_len):
    """Align video gaze data to frame indices, interpolating gaps."""
    full_gaze = np.full((total_frames, 2), np.nan, dtype=np.float32)

    valid_mask = (frame_indices >= 0) & (frame_indices < total_frames)
    valid_idx = frame_indices[valid_mask]
    valid_gaze = gaze[valid_mask]

    full_gaze[valid_idx] = valid_gaze

    for dim in range(2):
        col = full_gaze[:, dim]
        valid = ~np.isnan(col)
        if valid.sum() < 2:
            return None
        indices = np.arange(total_frames)
        col[~valid] = np.interp(indices[~valid], indices[valid], col[valid])

    windows = []
    stride = seq_len // 2
    for start in range(0, total_frames - seq_len + 1, stride):
        windows.append(full_gaze[start:start + seq_len])

    if not windows and total_frames >= 10:
        padded = np.zeros((seq_len, 2), dtype=np.float32)
        padded[:total_frames] = full_gaze
        padded[total_frames:] = full_gaze[-1]
        windows.append(padded)

    return windows


def load_image(path, size=IMAGE_SIZE):
    img = cv2.imread(str(path))
    if img is None:
        return None
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (size, size), interpolation=cv2.INTER_LINEAR)
    return img


def load_video_frames(path, frame_start, frame_count, size=IMAGE_SIZE):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None

    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_start)
    frames = []
    for _ in range(frame_count):
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame = cv2.resize(frame, (size, size), interpolation=cv2.INTER_LINEAR)
        frames.append(frame)
    cap.release()

    if not frames:
        return None

    while len(frames) < frame_count:
        frames.append(frames[-1])

    return np.stack(frames, axis=0)


def process_image_sample(content_path, npz_path, seq_len, fps):
    data = np.load(str(npz_path), allow_pickle=True)

    gaze_screen = data["gaze"]
    timestamps = data["timestamps"]
    dimensions = data["dimensions"]
    display_offset = data["display_offset"]
    display_scale = float(data["display_scale"][0])

    # Filter to only detected frames
    if "detected" in data:
        mask = data["detected"].astype(bool)
        gaze_screen = gaze_screen[mask]
        timestamps = timestamps[mask]

    if len(gaze_screen) < 5:
        return []

    gaze_norm = screen_to_content(gaze_screen, display_offset, display_scale, dimensions)
    gaze_resampled = resample_to_frames(gaze_norm, timestamps, seq_len, fps)

    img = load_image(content_path)
    if img is None:
        return []

    heatmap = gaze_to_heatmap(gaze_resampled, height=IMAGE_SIZE, width=IMAGE_SIZE)

    return [{
        "frames": img[np.newaxis],  # (1, H, W, 3)
        "gaze": gaze_resampled,
        "heatmap": heatmap,
        "source_type": "image",
    }]


def process_video_sample(content_path, npz_path, seq_len, fps):
    data = np.load(str(npz_path), allow_pickle=True)

    gaze_screen = data["gaze"]
    frame_indices = data["frame_indices"]
    dimensions = data["dimensions"]
    display_offset = data["display_offset"]
    display_scale = float(data["display_scale"][0])
    video_fps = float(data["fps"][0])

    if "detected" in data:
        mask = data["detected"].astype(bool)
        gaze_screen = gaze_screen[mask]
        frame_indices = frame_indices[mask]

    if len(gaze_screen) < 5:
        return []

    gaze_norm = screen_to_content(gaze_screen, display_offset, display_scale, dimensions)

    cap = cv2.VideoCapture(str(content_path))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    if total_frames < 10:
        return []

    windows = align_video_gaze(gaze_norm, frame_indices, total_frames, seq_len)
    if not windows:
        return []

    samples = []
    stride = seq_len // 2
    for i, gaze_window in enumerate(windows):
        frame_start = i * stride
        frames = load_video_frames(content_path, frame_start, seq_len)
        if frames is None:
            continue

        heatmap = gaze_to_heatmap(gaze_window, height=IMAGE_SIZE, width=IMAGE_SIZE)

        samples.append({
            "frames": frames,
            "gaze": gaze_window,
            "heatmap": heatmap,
            "source_type": "video",
        })

    return samples


def main():
    parser = argparse.ArgumentParser(description="Preprocess raw gaze data for training")
    parser.add_argument("--input", required=True, help="Input content directory")
    parser.add_argument("--gaze", required=True, help="Collected gaze .npz directory")
    parser.add_argument("--out", required=True, help="Output directory for processed samples")
    parser.add_argument("--seq-len", type=int, default=90)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    gaze_dir = Path(args.gaze).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    from tqdm import tqdm

    npz_files = sorted(gaze_dir.rglob("*.npz"))

    sample_idx = 0
    for npz_path in tqdm(npz_files, desc="processing", bar_format="  {desc} {bar:20} {n_fmt}/{total_fmt}"):
        rel = npz_path.relative_to(gaze_dir)
        stem = rel.with_suffix("")

        content_path = None
        for ext in list(IMAGE_EXTS) + list(VIDEO_EXTS):
            candidate = input_dir / stem.with_suffix(ext)
            if candidate.exists():
                content_path = candidate
                break

        if content_path is None:
            continue

        data = np.load(str(npz_path), allow_pickle=True)
        source_type = str(data["source_type"]) if "source_type" in data else "image"

        if "image" in source_type:
            samples = process_image_sample(content_path, npz_path, args.seq_len, args.fps)
        else:
            samples = process_video_sample(content_path, npz_path, args.seq_len, args.fps)

        for sample in samples:
            out_path = out_dir / f"{sample_idx:06d}.npz"
            np.savez_compressed(
                str(out_path),
                frames=sample["frames"],
                gaze=sample["gaze"],
                heatmap=sample["heatmap"],
                source_type=np.array([sample["source_type"]]),
            )
            sample_idx += 1

    print()
    print(f"  {sample_idx} training samples saved to {out_dir}")
    print()


if __name__ == "__main__":
    main()
