"""
Smooth scanpath generator from a saliency heatmap.
Finds ~20 salient waypoints, fits a smooth curve through them,
and varies speed based on inter-point distance:
  - Far jumps → fast saccade
  - Close points → slow scanning/reading
"""

import numpy as np
from scipy import ndimage
from scipy.interpolate import CubicSpline


def find_waypoints(heatmap, n_points=50, min_distance=0.03):
    """
    Extract ordered waypoints from the heatmap by iteratively picking
    salient peaks with IOR suppression.
    """
    h, w = heatmap.shape
    smoothed = ndimage.gaussian_filter(heatmap, sigma=max(h, w) * 0.02)

    points = []
    mask = np.ones_like(smoothed)

    for _ in range(n_points * 3):
        masked = smoothed * mask
        if masked.max() < 0.02:
            break

        peak_idx = np.argmax(masked)
        py, px = divmod(peak_idx, w)
        cx, cy = px / w, py / h
        salience = float(masked[py, px])

        too_close = False
        for px2, py2, _ in points:
            if np.sqrt((cx - px2) ** 2 + (cy - py2) ** 2) < min_distance:
                too_close = True
                break

        if not too_close:
            points.append((cx, cy, salience))

        yy, xx = np.mgrid[0:h, 0:w]
        suppress = np.exp(-((xx / w - cx) ** 2 + (yy / h - cy) ** 2) / (2 * 0.02 ** 2))
        mask *= (1 - suppress)

        if len(points) >= n_points:
            break

    if len(points) < 2:
        points = [(0.5, 0.4, 0.5), (0.5, 0.6, 0.5)]

    return points


def order_waypoints(points):
    """
    Order waypoints into a natural viewing sequence:
    start at most salient, then nearest-neighbor with a reading bias.
    """
    remaining = list(range(len(points)))

    # Start at most salient
    best = max(remaining, key=lambda i: points[i][2])
    ordered = [best]
    remaining.remove(best)

    while remaining:
        last_x, last_y, _ = points[ordered[-1]]

        # Score = distance penalty + slight reading-order bias (down and right)
        def score(i):
            px, py, sal = points[i]
            dist = np.sqrt((px - last_x) ** 2 + (py - last_y) ** 2)
            # Prefer nearby points, with slight bias toward continuing downward
            reading_bias = 0.02 * max(0, py - last_y)
            return dist - reading_bias - sal * 0.05

        nearest = min(remaining, key=score)
        ordered.append(nearest)
        remaining.remove(nearest)

    return [points[i] for i in ordered]


def fit_smooth_curve(waypoints, n_frames=90, fps=30):
    """
    Fit a cubic spline through waypoints and sample with variable speed:
    fast through large gaps (saccades), slow through close points (scanning).
    """
    xs = np.array([p[0] for p in waypoints])
    ys = np.array([p[1] for p in waypoints])

    n_pts = len(xs)

    # Parameterize by cumulative chord length
    dists = np.zeros(n_pts)
    for i in range(1, n_pts):
        dists[i] = dists[i - 1] + np.sqrt((xs[i] - xs[i - 1]) ** 2 + (ys[i] - ys[i - 1]) ** 2)

    total_dist = dists[-1]
    if total_dist < 1e-6:
        return [(float(xs[0]), float(ys[0]))] * n_frames

    # Normalize parameter to [0, 1]
    t_param = dists / total_dist

    # Fit cubic splines
    cs_x = CubicSpline(t_param, xs, bc_type='clamped')
    cs_y = CubicSpline(t_param, ys, bc_type='clamped')

    # Variable speed sampling:
    # Compute "speed" at each segment — large gaps = fast, small gaps = slow
    segment_dists = np.diff(dists)
    # Inverse speed: spend MORE time on short segments (scanning), LESS on long (saccades)
    inv_speed = 1.0 / (segment_dists + 0.005)
    inv_speed = inv_speed ** 0.8  # sharper contrast between dwell and saccade

    # Time allocated per segment proportional to inverse speed
    time_weights = inv_speed / inv_speed.sum()

    # Build non-uniform t samples: dense where slow, sparse where fast
    t_samples = [0.0]
    for i in range(len(time_weights)):
        n_seg_frames = max(2, int(time_weights[i] * n_frames))
        seg_t = np.linspace(t_param[i], t_param[i + 1], n_seg_frames, endpoint=False)
        t_samples.extend(seg_t[1:].tolist())

    t_samples.append(1.0)
    t_samples = np.array(t_samples)

    # Resample to exactly n_frames using uniform interpolation of our variable-speed parameter
    t_uniform = np.linspace(0, len(t_samples) - 1, n_frames)
    t_final = np.interp(t_uniform, np.arange(len(t_samples)), t_samples)
    t_final = np.clip(t_final, 0, 1)

    # Sample the spline
    gaze_x = cs_x(t_final)
    gaze_y = cs_y(t_final)

    gaze_x = np.clip(gaze_x, 0, 1)
    gaze_y = np.clip(gaze_y, 0, 1)

    return [(float(gaze_x[i]), float(gaze_y[i])) for i in range(n_frames)]


def generate_scanpath(heatmap, n_frames=120, fps=30, max_fixations=50):
    """
    Generate a smooth, realistic scanpath from a saliency heatmap.

    1. Find ~20 salient waypoints
    2. Order them in a natural viewing sequence
    3. Fit a cubic spline and sample with variable speed

    heatmap: ndarray (H, W) float in [0, 1]
    Returns: list of (x, y) tuples, one per frame, normalized [0, 1]
    """
    waypoints = find_waypoints(heatmap, n_points=max_fixations)
    waypoints = order_waypoints(waypoints)
    return fit_smooth_curve(waypoints, n_frames=n_frames, fps=fps)
