# techhacks — Taste Lab

Taste Lab is a design-intelligence product that pairs a Figma-style design
canvas with a self-trained **gaze-prediction model**. Drop a design on the
canvas, click *Predict gaze*, and see a heatmap + ordered fixation pins
showing where a real viewer would actually look.

```
┌──────────────────────────┐  capture artboard PNG    ┌────────────────┐
│  Next.js dashboard       │ ───────────────────────► │  Next.js proxy │
│  apps/web                │                          │  /api/gaze/*   │
│                          │ ◄─── heatmap + pins ───┐ └───────┬────────┘
└──────────────────────────┘                        │         │
                                                    │         ▼
                                                    │  ┌─────────────────┐
                                                    └──┤  FastAPI gaze   │
                                                       │  apps/api       │
                                                       │  (PyTorch)      │
                                                       └────────┬────────┘
                                                                │
                                                                ▼
                                                       model/checkpoints/
                                                       gaze_epoch250.pt
```

This README is the **single source of truth for running the model**. There
are three ways to do that — pick whichever fits your task.

---

## TL;DR

```bash
# 1) Python deps for the model + API (one time)
/opt/anaconda3/envs/hacktech26/bin/pip install -r apps/api/requirements.txt

# 2) Start the gaze API (loads model once, ~1–2 s on CPU)
PYTHON=/opt/anaconda3/envs/hacktech26/bin/python ./apps/api/run_dev.sh
#   → http://127.0.0.1:8000   |   docs at /docs

# 3) Start the web app (in another shell)
cd apps/web && npm install && npm run dev
#   → http://localhost:3000

# 4) On the dashboard, open a project, scroll the right inspector to
#    "Gaze prediction", click "Predict gaze".
```

That's it. The rest of this doc is reference material.

---

## Prerequisites

| Tool         | Version                | Notes                                       |
|--------------|------------------------|---------------------------------------------|
| Python       | 3.10 – 3.12            | We use the `hacktech26` conda env           |
| PyTorch      | ≥ 2.1                  | CPU is fine; CUDA / Apple MPS auto-detected |
| Node.js      | ≥ 18                   | For the Next.js dashboard                   |
| `npm`        | ≥ 9                    | npm workspaces                              |

**The trained checkpoint** ships in this repo at:

```
model/checkpoints/gaze_epoch250.pt   # 53 M params, epoch 249, val_loss 0.407
```

If you want to use a different checkpoint, set `GAZE_CHECKPOINT` to its path
before starting the API (see `Environment variables` below).

### Install Python deps

```bash
# Pick whichever Python you want to use (or use the env we already have)
conda activate hacktech26                       # if you have the env
# or:
python3 -m venv .venv && source .venv/bin/activate

pip install -r apps/api/requirements.txt
```

This installs `torch`, `torchvision`, `numpy`, `opencv-python`, `Pillow`,
`scipy`, `tqdm`, plus the FastAPI runtime (`fastapi`, `uvicorn[standard]`,
`python-multipart`).

### Install Node deps

```bash
npm install --workspaces        # from the repo root
```

---

## Way 1 — From the dashboard (recommended)

This is the user-facing path: rasterize whatever's on your artboard and run
the model on it.

1. Make sure both servers are running:
   - `./apps/api/run_dev.sh` → FastAPI on `:8000`
   - `npm run dev` (in `apps/web/`) → Next.js on `:3000`

2. Open `http://localhost:3000`, log in (any email works in dev), open a
   project.

3. With **nothing selected** on the canvas, look at the right-hand inspector.
   Scroll to the bottom and you'll see a **Gaze prediction** section.

4. The pill in that section's header should read **Backend ready** (green).
   If it says *Backend offline*, the FastAPI process isn't running — start
   it and click the pill to re-check.

5. Click **Predict gaze**. The button shows *Running…* while the model runs
   (~0.3–1 s on CPU for typical artboards). When it finishes:
   - A colored heatmap is overlaid on the artboard (multiply blend).
   - Numbered circles (the fixation pins) drop on the most-attended points.
   - The inspector lists each fixation: index, normalized `(x, y)`, dwell ms.

6. Use the **Show heatmap** / **Show fixations** toggles to peel layers
   off, or click **Clear** to reset.

> Under the hood the dashboard captures the artboard region with
> `html-to-image`, posts the PNG to `/api/gaze/scanpath` (a Next.js proxy),
> which forwards to the FastAPI backend. See
> [`apps/web/README.md`](apps/web/README.md) for the implementation map.

---

## Way 2 — Direct HTTP (FastAPI)

If you're scripting / integrating from another service, talk to the API
directly. It accepts a single multipart upload field named `image`.

```bash
# Health (also confirms model is loaded)
curl -s http://127.0.0.1:8000/health | jq
# {
#   "status": "ok",
#   "device": "cpu",
#   "checkpoint": "/abs/.../gaze_epoch250.pt",
#   "epoch": 249,
#   "val_loss": 0.407
# }

# UNet-only saliency heatmap
curl -F "image=@design.png" http://127.0.0.1:8000/predict/heatmap | jq 'keys'
# ["elapsed_ms","heatmap_b64","heatmap_resolution","height","overlay_b64","width"]

# Heatmap-guided scanpath (RECOMMENDED)
curl -F "image=@design.png" \
     -F "n_frames=90" -F "fps=30" -F "max_fixations=50" \
     http://127.0.0.1:8000/predict/scanpath > result.json

# Experimental transformer decoder
curl -F "image=@design.png" -F "mode=ad" \
     http://127.0.0.1:8000/predict/decoder > result.json
```

The full endpoint reference (form fields, response schemas, status codes) is
in [`apps/api/README.md`](apps/api/README.md). Live Swagger docs are at
`http://127.0.0.1:8000/docs` while the API is running.

### Calling the API from Python

```python
import requests

with open("design.png", "rb") as f:
    res = requests.post(
        "http://127.0.0.1:8000/predict/scanpath",
        files={"image": ("design.png", f, "image/png")},
        data={"n_frames": 90, "max_fixations": 50},
    )
data = res.json()
for fix in data["fixations"]:
    print(f"#{fix['fixation_index']}: ({fix['x']:.2f}, {fix['y']:.2f})"
          f"  dwell={fix['dwell_ms']:.0f}ms")
```

### Calling the API from the browser

The web app already proxies through `/api/gaze/*`, so you don't need to
touch FastAPI URLs from the client:

```ts
const form = new FormData();
form.append("image", artboardPngBlob);
form.append("n_frames", "90");

const res = await fetch("/api/gaze/scanpath", { method: "POST", body: form });
const data = await res.json();
// data.gaze_sequence | data.fixations | data.heatmap_b64 | data.overlay_b64
```

---

## Way 3 — From Python / CLI (offline, no server)

If you don't want to run the FastAPI process at all, use `model.inference`
directly. This is the path the API uses internally; it's also handy for
batch jobs and notebooks.

```bash
# Run from the repo root so `model.*` imports resolve
cd /path/to/hacktech26
conda activate hacktech26    # or activate your venv

# Scanpath (recommended) — popup display
python -m model.inference \
  --checkpoint model/checkpoints/gaze_epoch250.pt \
  --input design.png \
  --scanpath

# Scanpath — save MP4 (1080p, 8s loop)
python -m model.inference \
  --checkpoint model/checkpoints/gaze_epoch250.pt \
  --input design.png \
  --scanpath --save

# Heatmap-only — save PNG overlay next to design.png
python -m model.inference \
  --checkpoint model/checkpoints/gaze_epoch250.pt \
  --input design.png \
  --heatmap --save
```

Or from inside Python:

```python
from model.inference import run_scanpath_gen, run_heatmap

# Scanpath: returns gaze_sequence + fixations + heatmap_b64 + overlay_b64
result = run_scanpath_gen(
    "model/checkpoints/gaze_epoch250.pt",
    "design.png",
    device="cpu",   # or "cuda" / "mps"
)
for fix in result["fixations"]:
    print(f"#{fix['fixation_index']}: ({fix['x']:.2f}, {fix['y']:.2f})")

# Heatmap: returns the JET overlay numpy array + path to the saved PNG
overlay, png_path = run_heatmap(
    "model/checkpoints/gaze_epoch250.pt", "design.png", device="cpu",
)
```

For details on the CLI flags and model architecture see
[`model/README.md`](model/README.md).

---

## Environment variables

### FastAPI backend (`apps/api/`)

Set these in the shell before launching `run_dev.sh`. There's a template at
[`apps/api/.env.example`](apps/api/.env.example).

| Variable           | Default                                       | Description                                          |
|--------------------|-----------------------------------------------|------------------------------------------------------|
| `GAZE_CHECKPOINT`  | `model/checkpoints/gaze_epoch250.pt`          | Path to the `.pt` checkpoint to load                 |
| `MODEL_DEVICE`     | `auto`                                        | `auto`, `cpu`, `cuda`, or `mps`                      |
| `API_HOST`         | `127.0.0.1`                                   | uvicorn bind host                                    |
| `API_PORT`         | `8000`                                        | uvicorn bind port                                    |
| `ALLOWED_ORIGINS`  | `http://localhost:3000,http://127.0.0.1:3000` | CORS origins (comma-separated)                       |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MB)                            | Reject larger uploads                                |
| `LOG_LEVEL`        | `INFO`                                        | Python logging level                                 |
| `PYTHON`           | `python3`                                     | Python binary used by `run_dev.sh`                   |

### Next.js dashboard (`apps/web/`)

Copy `apps/web/.env.example` → `apps/web/.env.local` and fill in.

| Variable            | Default                  | Description                                                   |
|---------------------|--------------------------|---------------------------------------------------------------|
| `GAZE_API_URL`      | `http://127.0.0.1:8000`  | Where the proxy forwards. Set to a remote host in production. |
| `OPENAI_API_KEY`    | _(blank)_                | Optional. Enables agent planning + GPT Image generation.      |
| `OPENAI_IMAGE_MODEL`| `gpt-image-2`            | Override for the image-gen model.                             |
| `DATA_DIR`          | `.local-data`            | Where projects + assets are stored on disk.                   |

---

## Choosing a device

The API and CLI both pick a device automatically with a `cuda → mps → cpu`
priority order. Override with `MODEL_DEVICE` (API) or `--device` (CLI).

| Device | Roughly expected scanpath latency for 1280×720 input |
|--------|------------------------------------------------------|
| `cuda` | 30–80 ms                                             |
| `mps`  | 100–250 ms                                           |
| `cpu`  | 250–900 ms                                           |

The first request after startup is always slower because PyTorch warms up
its kernels. Subsequent requests use the cached singleton handle.

---

## Verifying everything works

After starting the API:

```bash
# 1. The model is loaded and reachable
curl -s http://127.0.0.1:8000/health
# → {"status":"ok","device":"cpu","checkpoint":"…","epoch":249,...}

# 2. End-to-end inference works (uses any PNG you have lying around)
curl -s -F "image=@some_design.png" \
     http://127.0.0.1:8000/predict/scanpath \
  | python -c "import sys, json; d=json.load(sys.stdin); \
              print('fixations:', len(d['fixations']), \
                    '| elapsed:', d['elapsed_ms'], 'ms')"
# → fixations: 6 | elapsed: 412.3 ms

# 3. The Next.js proxy forwards correctly (web app must be running)
curl -s http://127.0.0.1:3000/api/gaze/health
# → identical payload to step 1
```

---

## Troubleshooting

**`Could not reach gaze API` in the dashboard / `Backend offline` pill.**
Start the API:
`PYTHON=/opt/anaconda3/envs/hacktech26/bin/python ./apps/api/run_dev.sh`.
The proxy default is `http://127.0.0.1:8000`; if you bind a different port,
set `GAZE_API_URL` in `apps/web/.env.local` accordingly.

**`ModuleNotFoundError: model` when running the API.**
You're running outside the repo root and `sys.path` can't find the
`model/` package. Either `cd` to the repo root or use `run_dev.sh` (it `cd`s
for you).

**`RuntimeError: Error(s) in loading state_dict for GazePredictor`.**
The checkpoint architecture doesn't match. Check `GAZE_CHECKPOINT`. The
shipped `gaze_epoch250.pt` matches the default `UNetConfig` /
`DecoderConfig`. If you trained a custom model, make sure the configs match
what was trained.

**`OSError: [E050] Can't find model 'en_core_web_sm'` or similar
extra deps.**
The base model doesn't need spaCy or NLP libraries. If something complains,
it's almost certainly an unrelated dependency in your environment;
re-running `pip install -r apps/api/requirements.txt` in a clean env fixes
it.

**The first request takes 30+ seconds.**
PyTorch is downloading the ResNet-50 ImageNet weights for the backbone.
This only happens once per machine — subsequent runs are instant. If you
want to avoid the download entirely, the API already passes
`pretrained_backbone=False` (the gaze checkpoint contains all weights), so
this should be a one-time penalty for `torchvision`'s internal cache. See
`apps/api/inference_service.py` for the wiring.

**`html-to-image` produces blank PNGs in the dashboard.**
Some browser extensions (esp. ad blockers and dark-mode injectors) modify
DOM nodes in ways that break canvas serialization. Try in a clean profile
or disable the extension for `localhost`.

**Heatmap saturates the whole artboard.**
The model was trained on 224×224 inputs; very tall / wide artboards get
resized which can blur attention. Capture a tighter region (set the
artboard size to closer to 16:9) or use the smaller `n_frames` / increase
`max_fixations` to spread the path more.

---

## Repo layout

```
apps/
  web/    Next.js 16 + React 19 dashboard (the UI you click)
  api/    FastAPI gaze service (HTTP wrapper around model.inference)
model/
  arch/         GazePredictor = UNet (ResNet-50 backbone) + transformer decoder
  checkpoints/  gaze_epoch250.pt   ← the trained weights we ship
  inference.py  CLI + library entry points (run_scanpath_gen, run_heatmap, …)
  utils/        scanpath_gen.py (waypoint + spline scanpath), postprocess.py
data/           Calibration + collection pipeline (only needed if retraining)
```

## Commands

```bash
npm run dev                          # web app dev server
npm run build                        # production build
npm run lint                         # tsc --noEmit
./apps/api/run_dev.sh                # gaze API dev server
python -m model.inference --help     # full CLI flags
```
