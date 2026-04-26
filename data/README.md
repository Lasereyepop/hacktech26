# Gaze Data Collection

Collect gaze data in the browser with WebGazer, then replay the saved `.npz` files with `playback.py`.

The current workflow is:
- browser collection at `apps/web/app/collect/page.tsx`
- mirrored `.npz` export under `stimuli/gaze_output/`
- Python playback with `data/playback.py`

## Quick Start

### 1. Start the web collector

```bash
cd apps/web
npm run dev
```

Open:

```text
http://localhost:3000/collect
```

The collector is currently hardcoded to use the repo-root `stimuli/` directory.

### 2. Record gaze data

1. Open `/collect`
2. Wait for the page to auto-load files from `stimuli/`
3. Click **Start Calibration**
4. Complete the 9-dot calibration
5. Hold `G` to record gaze on each image/video
6. Press `Q` to skip the current file and move to the next one

Saved output is written to:

```text
stimuli/gaze_output/
```

### 3. Replay the saved gaze data

From the repo root:

```bash
python3 data/playback.py --input stimuli --gaze stimuli/gaze_output
python3 data/playback.py --input stimuli --gaze stimuli/gaze_output --trail 20
```

## Collection Flow

1. **Setup** — The collector auto-loads media from `stimuli/`.
2. **Calibration** — WebGazer runs a 9-dot browser calibration pass.
3. **Collection** — Each image/video is shown fullscreen. Hold `G` to record. Press `Q` to skip.
4. **Export** — Each recorded file is saved as a collect.py-compatible `.npz` under `stimuli/gaze_output/` with the same relative path as the source media.

## Controls

| Key | Action |
|-----|--------|
| Hold `G` | Record gaze |
| Release `G` | Stop recording / pause video |
| `Q` | Skip current file and continue |

## Output Layout

The output tree mirrors the input tree and replaces the media extension with `.npz`.

```text
stimuli/
  image.jpg
  clip.mp4
  subdir/
    photo.png

stimuli/gaze_output/
  image.npz
  clip.npz
  subdir/
    photo.npz
```

## Output Format (.npz)

```python
import numpy as np

data = np.load("stimuli/gaze_output/example.npz", allow_pickle=False)
```

### All files

| Key | Shape | Dtype | Description |
|-----|-------|-------|-------------|
| `gaze` | `(N, 2)` | `float32` | Screen pixel coordinates `(x, y)` |
| `dimensions` | `(2,)` | `int32` | Original media dimensions `[width, height]` |
| `display_offset` | `(2,)` | `int32` | Letterbox offset `[x_off, y_off]` in screen pixels |
| `display_scale` | `(1,)` | `float32` | Scale factor applied when the media was displayed |
| `source_type` | `(1,)` | string | `np.array(['image'])` or `np.array(['video'])` |

### Image only

| Key | Shape | Dtype | Description |
|-----|-------|-------|-------------|
| `timestamps` | `(N,)` | `float32` | Seconds since the first saved sample for that image |

### Video only

| Key | Shape | Dtype | Description |
|-----|-------|-------|-------------|
| `frame_indices` | `(N,)` | `int32` | Video frame index for each saved gaze point |
| `fps` | `(1,)` | `float32` | Source video frame rate |

## Converting Screen Coordinates to Content Coordinates

```python
offset = data['display_offset']
scale = float(data['display_scale'][0])
content_xy = (data['gaze'] - offset) / scale
```

`playback.py` performs the inverse remap automatically when it overlays gaze on the original media.

## Playback Notes

- `playback.py` expects a mirrored `.npz` tree under the gaze directory.
- `--input` should point at the original media directory.
- `--gaze` should point at the matching exported `.npz` directory.
- `--trail N` controls how many previous gaze points are shown.

## Requirements

### Web collector

- `npm install` in `apps/web`
- browser camera permission
- `python3` available on your system
- Python packages for the save helper:

```bash
python3 -m pip install numpy opencv-python
```

### Playback

```bash
python3 -m pip install numpy opencv-python screeninfo
```

## Troubleshooting

- If `/collect` does not load files, confirm media exists under `stimuli/`.
- If saving fails, make sure `python3`, `numpy`, and `opencv-python` are available to the Next.js save route.
- If a video will not open in the browser, re-encode it to a browser-friendly H.264 MP4.
