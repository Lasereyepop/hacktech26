import numpy as np


def heuristic_scanpath(heatmap, n_fixations=5, fps=30):
    """
    Generate a scanpath directly from a saliency heatmap with explicit IOR.
    No learned decoder needed. Fallback for when the trained model fails.

    heatmap: ndarray (H, W) float in [0, 1]
    Returns: list of (x, y) tuples, one per frame, normalized [0, 1]
    """
    h, w = heatmap.shape
    ior_mask = np.ones_like(heatmap)
    gaze_sequence = []

    heatmap_safe = heatmap.copy()
    heatmap_safe = np.maximum(heatmap_safe, 1e-8)

    for i in range(n_fixations):
        prob = heatmap_safe * ior_mask
        total = prob.sum()
        if total <= 0:
            break
        prob = prob / total

        idx = np.random.choice(h * w, p=prob.flatten())
        fy, fx = divmod(idx, w)
        cx, cy = fx / w, fy / h

        dwell_ms = np.random.uniform(200, 450)
        n_frames = max(1, int(dwell_ms / 1000 * fps))

        for _ in range(n_frames):
            jx = cx + np.random.normal(0, 0.005)
            jy = cy + np.random.normal(0, 0.005)
            gaze_sequence.append((
                float(np.clip(jx, 0, 1)),
                float(np.clip(jy, 0, 1)),
            ))

        yy, xx = np.mgrid[0:h, 0:w]
        gaussian = np.exp(-((xx / w - cx) ** 2 + (yy / h - cy) ** 2) / (2 * 0.06 ** 2))
        ior_mask *= (1 - 0.8 * gaussian)

    return gaze_sequence
