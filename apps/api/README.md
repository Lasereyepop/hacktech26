# Gaze Prediction API

FastAPI backend that serves the trained gaze model (`model/checkpoints/gaze_epoch250.pt`).

It loads the checkpoint **once** at startup (warm singleton) and exposes endpoints
for heatmap, scanpath (algorithmic, recommended), and the experimental transformer
decoder mode.

> Looking for the user-facing run instructions? See the
> [project root README](../../README.md#tldr) — this file is the deep-dive
> reference for the API itself.

## Quick start

```bash
# 1. From the repo root, install Python deps. We use the hacktech26 conda env;
#    any Python ≥3.10 with torch ≥2.1 will work.
/opt/anaconda3/envs/hacktech26/bin/pip install -r apps/api/requirements.txt

# 2. (Optional) override defaults via env file
cp apps/api/.env.example apps/api/.env
set -a; source apps/api/.env; set +a

# 3. Launch the API on http://127.0.0.1:8000
PYTHON=/opt/anaconda3/envs/hacktech26/bin/python ./apps/api/run_dev.sh
```

You should see something like:

```
[gaze-api] repo:      /Users/.../hacktech26
[gaze-api] python:    /opt/anaconda3/envs/hacktech26/bin/python (Python 3.11.x)
[gaze-api] checkpoint:model/checkpoints/gaze_epoch250.pt
[gaze-api] device:    auto
[gaze-api] listening: http://127.0.0.1:8000
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO     gaze_api: gaze model ready on cpu (epoch=249, val_loss=0.407) in 1.4s
```

Hit `http://127.0.0.1:8000/docs` for the auto-generated Swagger UI.

## Environment variables

A complete template lives in [`./.env.example`](./.env.example). Summary:

| Variable           | Default                                  | Description |
|--------------------|------------------------------------------|-------------|
| `GAZE_CHECKPOINT`  | `model/checkpoints/gaze_epoch250.pt`     | Path to the `.pt` checkpoint to load |
| `MODEL_DEVICE`     | `auto`                                   | `auto`, `cpu`, `cuda`, or `mps` |
| `API_HOST`         | `127.0.0.1`                              | uvicorn bind host |
| `API_PORT`         | `8000`                                   | uvicorn bind port |
| `ALLOWED_ORIGINS`  | `http://localhost:3000,http://127.0.0.1:3000` | CORS origins (comma-separated) |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MB)                       | Reject larger uploads |
| `LOG_LEVEL`        | `INFO`                                   | Python logging level |

## Endpoints

All prediction endpoints accept a single multipart upload field named `image`
(PNG / JPEG / WebP / BMP / GIF).

### `GET /health`

```json
{
  "status": "ok",
  "device": "cpu",
  "checkpoint": "/abs/path/to/gaze_epoch250.pt",
  "epoch": 249,
  "val_loss": 0.0123
}
```

### `POST /predict/heatmap`

UNet-only saliency. Returns the raw heatmap and a JET overlay rendered onto the
original image.

```bash
curl -F "image=@design.png" http://127.0.0.1:8000/predict/heatmap | jq 'keys'
# ["elapsed_ms", "heatmap_b64", "heatmap_resolution", "height", "overlay_b64", "width"]
```

### `POST /predict/scanpath` (recommended)

Heatmap-guided scanpath generator: extracts salient waypoints, orders them, and
fits a cubic spline with variable speed.

Form fields (all optional):

| Field                | Default | Range  |
|----------------------|---------|--------|
| `n_frames`           | 90      | 4–600  |
| `fps`                | 30      | 1–120  |
| `max_fixations`      | 50      | 2–200  |
| `fixation_threshold` | 0.02    | float  |

Response:

```json
{
  "width": 1280,
  "height": 720,
  "fps": 30,
  "n_frames": 90,
  "gaze_sequence": [{"frame": 0, "x": 0.51, "y": 0.42}, ...],
  "fixations": [{"x": 0.51, "y": 0.42, "dwell_ms": 200, "fixation_index": 1, ...}, ...],
  "heatmap_b64": "<base64 PNG>",
  "overlay_b64": "<base64 PNG>",
  "elapsed_ms": 318.4
}
```

### `POST /predict/decoder` (experimental)

Runs the transformer decoder with IOR suppression. `mode` may be `ad` or `ego`.
Slower and less stable than `/predict/scanpath`; mostly here for parity with
`model.inference`.

## Calling from the Next.js app

The web app ships a proxy at `apps/web/app/api/gaze/[action]/route.ts`, so the
browser never has to know the FastAPI URL. Configure with `GAZE_API_URL`
(defaults to `http://127.0.0.1:8000`).

```ts
// In a "use client" component:
const form = new FormData();
form.append("image", artboardPngBlob);
form.append("n_frames", "90");

const res = await fetch("/api/gaze/scanpath", { method: "POST", body: form });
const data = await res.json();
// data.gaze_sequence, data.fixations, data.heatmap_b64, data.overlay_b64
```

The proxy supports:

| Browser route        | Forwards to                          |
|----------------------|--------------------------------------|
| `GET  /api/gaze/health`   | `GET  /health`                  |
| `POST /api/gaze/heatmap`  | `POST /predict/heatmap`         |
| `POST /api/gaze/scanpath` | `POST /predict/scanpath`        |
| `POST /api/gaze/decoder`  | `POST /predict/decoder`         |

The dashboard's "Gaze prediction" section (Artboard inspector → bottom of the
right-hand panel) drives this end to end:
1. rasterizes the artboard region (via `html-to-image`),
2. POSTs the PNG to `/api/gaze/scanpath`,
3. renders the returned heatmap PNG as a `multiply` overlay on the artboard,
4. drops numbered fixation pins at each `(fix.x, fix.y)` position.

If the backend is not reachable, the inspector pill shows "Backend offline"
and the help line tells the user how to start it.
