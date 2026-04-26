#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, cast

import cv2
import numpy as np


class SaveError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SaveError(message)


def _as_point_matrix(value: Any, name: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.float32)
    _require(array.ndim == 2 and array.shape[1] == 2, f"{name} must have shape (N, 2)")
    return array


def _as_int_vector(value: Any, name: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.int32)
    _require(array.ndim == 1, f"{name} must have shape (N,)")
    return array


def _as_float_vector(value: Any, name: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.float32)
    _require(array.ndim == 1, f"{name} must have shape (N,)")
    return array


def _as_pair(value: Any, name: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.int32)
    _require(array.shape == (2,), f"{name} must have shape (2,)")
    return array


def _as_scalar_array(value: Any, name: str) -> np.ndarray:
    scalar = np.asarray(value, dtype=np.float32).reshape(-1)
    _require(scalar.size == 1, f"{name} must be a scalar or length-1 array")
    return np.array([float(scalar[0])], dtype=np.float32)


def _resolve_video_fps(source_path: Path) -> float:
    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        raise SaveError(f"Cannot open video to read fps: {source_path}")
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    finally:
        cap.release()

    _require(fps > 0, f"Video fps unavailable for {source_path}")
    return fps


def _normalize_source_type(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], str):
        return value[0]
    raise SaveError("source_type must be 'image' or 'video'")


def main() -> int:
    payload = cast(dict[str, Any], json.load(sys.stdin))
    output_path = Path(payload["outputPath"]).expanduser().resolve()
    source_path_value = payload.get("sourcePath")
    source_path = Path(source_path_value).expanduser().resolve() if source_path_value else None
    data = cast(dict[str, Any], payload["data"])

    source_type = _normalize_source_type(data.get("source_type"))
    _require(source_type in {"image", "video"}, "source_type must be 'image' or 'video'")

    gaze = _as_point_matrix(data.get("gaze"), "gaze")
    dimensions = _as_pair(data.get("dimensions"), "dimensions")
    display_offset = _as_pair(data.get("display_offset"), "display_offset")
    display_scale = _as_scalar_array(data.get("display_scale"), "display_scale")

    if source_type == "image":
        timestamps = _as_float_vector(data.get("timestamps"), "timestamps")
        _require(len(timestamps) == len(gaze), "timestamps length must match gaze length")
        np.savez(
            str(output_path),
            gaze=gaze,
            timestamps=timestamps,
            dimensions=dimensions,
            display_offset=display_offset,
            display_scale=display_scale,
            source_type=np.array(["image"]),
        )
        return 0

    frame_indices = _as_int_vector(data.get("frame_indices"), "frame_indices")
    _require(len(frame_indices) == len(gaze), "frame_indices length must match gaze length")

    fps_value = data.get("fps")
    if source_path is not None:
        fps = _resolve_video_fps(source_path)
    elif fps_value is None:
        raise SaveError("sourcePath is required to infer video fps")
    else:
        fps = float(_as_scalar_array(fps_value, "fps")[0])
        _require(fps > 0, "fps must be greater than 0")

    np.savez(
        str(output_path),
        gaze=gaze,
        frame_indices=frame_indices,
        dimensions=dimensions,
        display_offset=display_offset,
        display_scale=display_scale,
        fps=np.array([fps], dtype=np.float32),
        source_type=np.array(["video"]),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
