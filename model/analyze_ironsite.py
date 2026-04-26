"""
Run gaze heatmap model on all ironsite videos and analyze attention patterns.
Extracts per-frame attention metrics, detects task cycles, measures focus patterns.

Usage:
    python -m model.analyze_ironsite --checkpoint model/checkpoints/iron_epoch250.pt
"""

import argparse
import json
import os
from pathlib import Path

import cv2
import numpy as np
import torch
from torchvision import transforms
from tqdm import tqdm

from .arch import GazePredictor
from .config import UNetConfig


CANONICAL_STEM_REWRITES = {
    "09_prep_standby_production_mp": "09_prep_standby",
    "12_downtime_prep_mp": "12_downtime",
    "13_transit_prep_mp": "13_transit",
}


def load_model(checkpoint_path, device="cpu"):
    state = torch.load(checkpoint_path, map_location=device, weights_only=True)
    model = GazePredictor()
    model.load_state_dict(state["model"], strict=False)
    model = model.to(device).eval()
    return model


def canonical_video_stem(video_name: str) -> str:
    stem = Path(video_name).stem
    if stem.endswith("_raw"):
        stem = stem[:-4]
    elif stem.endswith("_heatmap"):
        stem = stem[:-8]
    return CANONICAL_STEM_REWRITES.get(stem, stem)


def source_priority(video_name: str) -> int:
    stem = Path(video_name).stem
    if stem.endswith("_raw"):
        return 2
    if stem.endswith("_heatmap"):
        return 1
    return 0


@torch.no_grad()
def process_video(model, video_path, device="cpu", sample_every=1, image_size=224):
    """
    Run UNet on every Nth frame. Returns per-frame metrics:
    - peak_x, peak_y: predicted gaze center (heatmap peak)
    - focus_score: how concentrated the attention is (entropy inverse)
    - heatmap_std: spatial spread of attention
    - top_region: which quadrant gets most attention (TL, TR, BL, BR, CENTER)
    """
    cap = cv2.VideoCapture(str(video_path))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0

    transform = transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    results = []
    frame_idx = 0

    for i in tqdm(range(total_frames), desc=f"  {Path(video_path).stem}",
                  bar_format="  {desc:>40} {bar:20} {percentage:3.0f}%"):
        ret, frame_bgr = cap.read()
        if not ret:
            break

        if i % sample_every != 0:
            frame_idx += 1
            continue

        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        tensor = transform(frame_rgb).unsqueeze(0).to(device)

        heatmap, _ = model.unet(tensor)
        hm = heatmap[0, 0].detach().cpu().numpy()

        # Peak location (predicted gaze center)
        peak_idx = np.argmax(hm)
        py, px = divmod(peak_idx, hm.shape[1])
        peak_x = px / hm.shape[1]
        peak_y = py / hm.shape[0]

        # Focus score: how peaked is the heatmap
        hm_norm = hm / (hm.sum() + 1e-8)
        entropy = -np.sum(hm_norm * np.log(hm_norm + 1e-8))
        max_entropy = np.log(hm.size)
        focus_score = 1.0 - (entropy / max_entropy)  # 1 = laser focused, 0 = uniform

        # Spatial spread
        heatmap_std = float(hm.std())

        # Quadrant analysis
        h, w = hm.shape
        quadrants = {
            "TL": hm[:h//2, :w//2].sum(),
            "TR": hm[:h//2, w//2:].sum(),
            "BL": hm[h//2:, :w//2].sum(),
            "BR": hm[h//2:, w//2:].sum(),
            "CENTER": hm[h//4:3*h//4, w//4:3*w//4].sum(),
        }
        top_region = max(quadrants, key=quadrants.get)

        results.append({
            "frame": i,
            "time_s": round(i / fps, 2),
            "peak_x": round(float(peak_x), 4),
            "peak_y": round(float(peak_y), 4),
            "focus_score": round(float(focus_score), 4),
            "heatmap_std": round(float(heatmap_std), 4),
            "top_region": top_region,
            "quadrants": {k: round(float(v), 4) for k, v in quadrants.items()},
        })

        frame_idx += 1

    cap.release()
    return results, fps


def detect_gaze_cycles(results, distance_threshold=0.15, min_cycle_frames=5):
    """
    Detect repetitive attention cycles (e.g., look at blocks → look at wall → repeat).
    A cycle is when the gaze returns near a previously visited location after visiting
    a different location.
    """
    if len(results) < 10:
        return []

    peaks = np.array([[r["peak_x"], r["peak_y"]] for r in results])

    cycles = []
    anchor = peaks[0]
    away = False
    cycle_start = 0

    for i in range(1, len(peaks)):
        dist = np.sqrt((peaks[i][0] - anchor[0])**2 + (peaks[i][1] - anchor[1])**2)

        if not away and dist > distance_threshold:
            away = True
        elif away and dist < distance_threshold * 0.7:
            cycle_len = i - cycle_start
            if cycle_len >= min_cycle_frames:
                cycles.append({
                    "start_frame": results[cycle_start]["frame"],
                    "end_frame": results[i]["frame"],
                    "start_time": results[cycle_start]["time_s"],
                    "end_time": results[i]["time_s"],
                    "duration_s": round(results[i]["time_s"] - results[cycle_start]["time_s"], 2),
                    "anchor_x": round(float(anchor[0]), 4),
                    "anchor_y": round(float(anchor[1]), 4),
                })
            away = False
            anchor = peaks[i]
            cycle_start = i

    return cycles


def detect_focus_segments(results, fps, focus_threshold_high=0.6, focus_threshold_low=0.35,
                          min_segment_s=3.0):
    """
    Segment the video into focused (active work) vs diffuse (idle/scanning) periods
    based on attention concentration.
    """
    segments = []
    current_state = None
    segment_start = 0

    for i, r in enumerate(results):
        state = "focused" if r["focus_score"] > focus_threshold_high else \
                "diffuse" if r["focus_score"] < focus_threshold_low else "moderate"

        if state != current_state:
            if current_state is not None:
                duration = r["time_s"] - results[segment_start]["time_s"]
                if duration >= min_segment_s:
                    segments.append({
                        "state": current_state,
                        "start_time": results[segment_start]["time_s"],
                        "end_time": r["time_s"],
                        "duration_s": round(duration, 2),
                        "avg_focus": round(np.mean([results[j]["focus_score"]
                                                     for j in range(segment_start, i)]), 4),
                    })
            current_state = state
            segment_start = i

    # Last segment
    if current_state and len(results) > segment_start:
        duration = results[-1]["time_s"] - results[segment_start]["time_s"]
        if duration >= min_segment_s:
            segments.append({
                "state": current_state,
                "start_time": results[segment_start]["time_s"],
                "end_time": results[-1]["time_s"],
                "duration_s": round(duration, 2),
                "avg_focus": round(np.mean([r["focus_score"] for r in results[segment_start:]]), 4),
            })

    return segments


def compute_summary(results, cycles, segments, fps, video_name):
    """Compute overall summary stats for a video."""
    focus_scores = [r["focus_score"] for r in results]
    peak_xs = [r["peak_x"] for r in results]
    peak_ys = [r["peak_y"] for r in results]

    # Gaze movement speed
    peaks = np.array([[r["peak_x"], r["peak_y"]] for r in results])
    if len(peaks) > 1:
        diffs = np.sqrt(np.sum(np.diff(peaks, axis=0)**2, axis=1))
        avg_speed = float(diffs.mean())
        max_speed = float(diffs.max())
    else:
        avg_speed = max_speed = 0

    # Time in each state
    focused_time = sum(s["duration_s"] for s in segments if s["state"] == "focused")
    diffuse_time = sum(s["duration_s"] for s in segments if s["state"] == "diffuse")
    moderate_time = sum(s["duration_s"] for s in segments if s["state"] == "moderate")
    total_time = results[-1]["time_s"] if results else 0

    # Region preference
    region_counts = {}
    for r in results:
        reg = r["top_region"]
        region_counts[reg] = region_counts.get(reg, 0) + 1

    # Task label from filename
    stem = canonical_video_stem(video_name)
    task_label = stem.split("_", 1)[1].replace("_", " ") if "_" in stem else "unknown"

    return {
        "video": video_name,
        "task_label": task_label,
        "total_duration_s": round(total_time, 1),
        "frames_analyzed": len(results),
        "focus": {
            "mean": round(float(np.mean(focus_scores)), 4),
            "std": round(float(np.std(focus_scores)), 4),
            "min": round(float(np.min(focus_scores)), 4),
            "max": round(float(np.max(focus_scores)), 4),
        },
        "gaze_speed": {
            "avg": round(avg_speed, 5),
            "max": round(max_speed, 5),
        },
        "time_breakdown": {
            "focused_s": round(focused_time, 1),
            "diffuse_s": round(diffuse_time, 1),
            "moderate_s": round(moderate_time, 1),
            "focused_pct": round(focused_time / max(total_time, 1) * 100, 1),
            "diffuse_pct": round(diffuse_time / max(total_time, 1) * 100, 1),
        },
        "cycles_detected": len(cycles),
        "avg_cycle_duration_s": round(np.mean([c["duration_s"] for c in cycles]), 2) if cycles else 0,
        "region_preference": region_counts,
        "gaze_coverage": {
            "x_range": round(float(np.max(peak_xs) - np.min(peak_xs)), 4),
            "y_range": round(float(np.max(peak_ys) - np.min(peak_ys)), 4),
        },
    }


def print_report(summaries):
    """Print a readable report of all video analyses."""
    print("\n" + "=" * 70)
    print("  IRONSITE ATTENTION ANALYSIS REPORT")
    print("=" * 70)

    for s in summaries:
        print(f"\n  {s['video']}")
        print(f"  Task: {s['task_label']}")
        print(f"  Duration: {s['total_duration_s']}s  |  Frames analyzed: {s['frames_analyzed']}")
        print(f"  Focus score: {s['focus']['mean']:.3f} avg (std {s['focus']['std']:.3f})")
        print(f"  Gaze speed: {s['gaze_speed']['avg']:.4f} avg")
        print()
        print(f"  Time breakdown:")
        tb = s["time_breakdown"]
        focused_bar = "█" * int(tb["focused_pct"] / 2)
        diffuse_bar = "░" * int(tb["diffuse_pct"] / 2)
        print(f"    Focused:  {tb['focused_s']:>6.1f}s ({tb['focused_pct']:>5.1f}%) {focused_bar}")
        print(f"    Diffuse:  {tb['diffuse_s']:>6.1f}s ({tb['diffuse_pct']:>5.1f}%) {diffuse_bar}")
        print(f"    Moderate: {tb['moderate_s']:>6.1f}s")
        print()
        print(f"  Repetitive cycles detected: {s['cycles_detected']}")
        if s["avg_cycle_duration_s"] > 0:
            print(f"    Avg cycle duration: {s['avg_cycle_duration_s']:.1f}s")
        print(f"  Gaze coverage: x={s['gaze_coverage']['x_range']:.3f}  y={s['gaze_coverage']['y_range']:.3f}")
        print(f"  Region preference: {s['region_preference']}")
        print("  " + "-" * 50)

    # Cross-video comparison
    print(f"\n{'=' * 70}")
    print("  CROSS-VIDEO COMPARISON")
    print(f"{'=' * 70}")

    # Group by task type
    task_groups = {}
    for s in summaries:
        task = s["task_label"]
        base_task = task.split()[0]  # "production", "prep", "downtime", "transit"
        if base_task not in task_groups:
            task_groups[base_task] = []
        task_groups[base_task].append(s)

    print(f"\n  {'Task Type':<20} {'Count':>5} {'Avg Focus':>10} {'Focused%':>10} {'Cycles':>8} {'Gaze Speed':>12}")
    print(f"  {'-'*20} {'-'*5} {'-'*10} {'-'*10} {'-'*8} {'-'*12}")
    for task, group in sorted(task_groups.items()):
        avg_focus = np.mean([s["focus"]["mean"] for s in group])
        avg_focused_pct = np.mean([s["time_breakdown"]["focused_pct"] for s in group])
        avg_cycles = np.mean([s["cycles_detected"] for s in group])
        avg_speed = np.mean([s["gaze_speed"]["avg"] for s in group])
        print(f"  {task:<20} {len(group):>5} {avg_focus:>10.3f} {avg_focused_pct:>9.1f}% {avg_cycles:>8.1f} {avg_speed:>12.5f}")

    print()


def main():
    parser = argparse.ArgumentParser(description="Analyze ironsite videos with gaze model")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--video-dir", default="data/input/ironsite_full")
    parser.add_argument("--output", default="model/ironsite_analysis.json")
    parser.add_argument("--sample-every", type=int, default=3,
                        help="Process every Nth frame (default 3, balances speed vs resolution)")
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    device = args.device
    if device == "cpu" and torch.backends.mps.is_available():
        device = "mps"

    print(f"\n  Loading model from {args.checkpoint}")
    model = load_model(args.checkpoint, device=device)

    video_dir = Path(args.video_dir)
    videos = sorted([
        p
        for ext in ("*.mp4", "*.mov")
        for p in video_dir.glob(ext)
    ])
    print(f"  Found {len(videos)} videos in {video_dir}\n")

    all_summaries = []
    all_data = {}
    chosen_sources = {}

    for video_path in videos:
        results, fps = process_video(model, video_path, device=device,
                                     sample_every=args.sample_every)

        cycles = detect_gaze_cycles(results)
        segments = detect_focus_segments(results, fps)
        summary = compute_summary(results, cycles, segments, fps, video_path.name)

        # Trim per-frame quadrants to keep file size sane; keep the fields the
        # analytics dashboard needs to draw sparklines and time-series charts.
        slim_frames = [
            {
                "frame": r["frame"],
                "time_s": r["time_s"],
                "peak_x": r["peak_x"],
                "peak_y": r["peak_y"],
                "focus_score": r["focus_score"],
                "top_region": r["top_region"],
            }
            for r in results
        ]

        canonical_key = canonical_video_stem(video_path.name)
        priority = source_priority(video_path.name)
        prev_priority = chosen_sources.get(canonical_key, -1)

        if priority < prev_priority:
            continue

        chosen_sources[canonical_key] = priority
        all_data[canonical_key] = {
            "summary": summary,
            "cycles": cycles,
            "segments": segments,
            "frames": slim_frames,
        }

    all_summaries = [blob["summary"] for blob in all_data.values()]

    print_report(all_summaries)

    # Save full data
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(all_data, f, indent=2)
    print(f"  Full analysis saved to {output_path}")

    # Also publish a copy under ironsite/data/ so the static analytics dashboard
    # at ironsite/analytics.html can fetch it without traversing parents.
    dashboard_copy = Path(__file__).resolve().parent.parent / "ironsite" / "data" / "ironsite_analysis.json"
    dashboard_copy.parent.mkdir(parents=True, exist_ok=True)
    with open(dashboard_copy, "w") as f:
        json.dump(all_data, f, indent=2)
    print(f"  Dashboard copy saved to {dashboard_copy}\n")


if __name__ == "__main__":
    main()
