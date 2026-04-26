import math

import numpy as np


def derive_fixations(gaze_sequence, fps=30, spatial_threshold=0.02):
    """
    Cluster raw frame-level gaze into discrete fixation events.
    gaze_sequence: list of (x, y) tuples or ndarray (T, 2), normalized [0, 1]
    Returns: list of dicts with x, y, dwell_ms, fixation_index, start_frame, end_frame
    """
    if isinstance(gaze_sequence, np.ndarray):
        points = [(float(g[0]), float(g[1])) for g in gaze_sequence]
    else:
        points = gaze_sequence

    if not points:
        return []

    fixations = []
    cluster = [points[0]]
    cluster_start = 0

    for i, point in enumerate(points[1:], start=1):
        dx = point[0] - cluster[-1][0]
        dy = point[1] - cluster[-1][1]
        dist = math.sqrt(dx * dx + dy * dy)

        if dist < spatial_threshold:
            cluster.append(point)
        else:
            cx = sum(p[0] for p in cluster) / len(cluster)
            cy = sum(p[1] for p in cluster) / len(cluster)
            dwell_ms = len(cluster) / fps * 1000
            fixations.append({
                "x": round(cx, 4),
                "y": round(cy, 4),
                "dwell_ms": round(dwell_ms, 1),
                "fixation_index": len(fixations) + 1,
                "start_frame": cluster_start,
                "end_frame": cluster_start + len(cluster) - 1,
            })
            cluster = [point]
            cluster_start = i

    cx = sum(p[0] for p in cluster) / len(cluster)
    cy = sum(p[1] for p in cluster) / len(cluster)
    dwell_ms = len(cluster) / fps * 1000
    fixations.append({
        "x": round(cx, 4),
        "y": round(cy, 4),
        "dwell_ms": round(dwell_ms, 1),
        "fixation_index": len(fixations) + 1,
        "start_frame": cluster_start,
        "end_frame": cluster_start + len(cluster) - 1,
    })

    return fixations


def gaze_to_heatmap(gaze, height=224, width=224, sigma=11.0):
    """
    Generate a saliency heatmap from gaze coordinates.
    gaze: ndarray (T, 2) normalized [0, 1], or list of (x, y)
    Returns: ndarray (height, width) float32 in [0, 1]
    """
    if isinstance(gaze, list):
        gaze = np.array(gaze, dtype=np.float32)

    heatmap = np.zeros((height, width), dtype=np.float64)

    yy, xx = np.mgrid[0:height, 0:width].astype(np.float64)
    xx = xx / width
    yy = yy / height
    sigma_norm = sigma / max(height, width)

    for i in range(len(gaze)):
        gx, gy = float(gaze[i, 0]), float(gaze[i, 1])
        g = np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * sigma_norm ** 2))
        heatmap += g

    if heatmap.max() > 0:
        heatmap /= heatmap.max()

    return heatmap.astype(np.float32)
