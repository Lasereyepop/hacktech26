# Gaze Prediction Model

The trained checkpoint we ship is **`checkpoints/gaze_epoch250.pt`**
(53 M parameters, epoch 249, val_loss 0.407). Use it however you like:

| You want to…                          | Read…                                                              |
|---------------------------------------|--------------------------------------------------------------------|
| Click a button in the design tool     | The dashboard's *Gaze prediction* section — see the [root README](../README.md#way-1--from-the-dashboard-recommended) |
| Hit a REST endpoint from your service | [FastAPI quick start](../apps/api/README.md) (HTTP at `:8000`)      |
| Run inference offline / in a script   | The **CLI inference** section just below                            |
| Train your own checkpoint             | The **Full pipeline** section further down                          |

---

## CLI inference

Run all commands from the **repo root** so `model.*` imports resolve. Use
the shipped checkpoint or pass your own path to `--checkpoint`.

### Static images (websites, ads, UI designs)

```bash
# Scanpath — popup display
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input image.png --scanpath

# Scanpath — save MP4 (1080p, 8 seconds)
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input image.png --scanpath --save

# Heatmap — popup display
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input image.png --heatmap

# Heatmap — save PNG overlay
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input image.png --heatmap --save
```

### Video (egocentric / first-person)

```bash
# Heatmap overlay on every frame — save MP4 (1080p)
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input video.mp4 --heatmap

# Heatmap + predicted gaze point with trail — save MP4 (1080p)
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input video.mp4 --heatmap --scanpath
```

### Decoder (experimental, not recommended)

```bash
# Transformer decoder scanpath — popup display
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input image.png --visualize

# Transformer decoder scanpath — save MP4
python -m model.inference --checkpoint model/checkpoints/gaze_epoch250.pt --input image.png --visualize --save
```

For everything else, run `python -m model.inference --help`.

### Library use

```python
from model.inference import run_scanpath_gen, run_heatmap

result = run_scanpath_gen(
    "model/checkpoints/gaze_epoch250.pt",
    "image.png",
    device="cpu",            # or "cuda" / "mps"
)
for fix in result["fixations"]:
    print(f"#{fix['fixation_index']}: ({fix['x']:.2f}, {fix['y']:.2f}) "
          f"{fix['dwell_ms']:.0f} ms")

overlay, png_path = run_heatmap(
    "model/checkpoints/gaze_epoch250.pt", "image.png", device="cpu",
)
```

---

## How It Works

The model has two parts:

1. **UNet saliency encoder** — takes an image/frame, outputs a heatmap of where people look. This is the trained component and it works well.
2. **Scanpath generator** — takes the heatmap, finds ~50 salient waypoints, fits a smooth cubic spline through them with variable speed (slow scanning in salient regions, fast saccades between them). This is algorithmic, no training needed.

The transformer decoder exists in the codebase but is not used for production inference — it couldn't learn reliable temporal dynamics from our dataset size. The scanpath generator produces more realistic results.

---

## Setup

```bash
conda activate hacktech26
pip install torch torchvision numpy opencv-python pillow scipy tqdm
```

## Full Pipeline

### 1. Collect gaze data

```bash
python data/calibration.py
python data/collect.py --input data/input --output data/output
```

### 2. Preprocess

```bash
# Static images (websites, ads)
python -m model.data.preprocess --input data/input --gaze data/output --out data/processed

# Video (egocentric) — note fps flag
python -m model.data.preprocess --input data/input/ironsite --gaze data/output/ironsite --out data/processed_ironsite --seq-len 90 --fps 15
```

### 3. Train (UNet only — recommended)

```bash
# Single GPU
python -m model.train --data data/processed --mode ad --stage unet --epochs 2000

# Multi-GPU
CUDA_VISIBLE_DEVICES=0,1,2 NCCL_P2P_DISABLE=1 torchrun \
    --nproc_per_node=3 --master_port=29501 \
    -m model.train --data data/processed --mode ad --stage unet --epochs 2000

# Egocentric video data
CUDA_VISIBLE_DEVICES=0,1 NCCL_P2P_DISABLE=1 torchrun \
    --nproc_per_node=2 --master_port=29502 \
    -m model.train --data data/processed_ironsite --mode ego --stage unet --epochs 2000 --batch 4
```

**Important:** Scale `--batch` to your dataset size. With DDP, effective batch = `--batch × n_gpus`. If effective batch > dataset size, training loss will be 0.0 from epoch 1. Rule of thumb: effective batch should be ≤ 25% of dataset size.

Checkpoints saved to `checkpoints/` (`_best.pt`, `_epochN.pt`, `_final.pt`).

### 4. Run inference on your fresh checkpoint

After training, point `--checkpoint` at the new file (e.g. `_best.pt`) and
use the same CLI / library entry points documented at the top of this file.

---

## Training Args

| Arg | Default | Description |
|---|---|---|
| `--data` | required | Path to preprocessed data directory |
| `--mode` | `ad` | `ad` (static images) or `ego` (egocentric video) |
| `--stage` | `joint` | `unet` (recommended), `decoder`, or `joint` |
| `--epochs` | `50` | Training epochs |
| `--batch` | `32` | Per-GPU batch size |
| `--lr-encoder` | `5e-5` | UNet learning rate |
| `--lr-decoder` | `5e-4` | Decoder learning rate |
| `--noise-std` | `0.02` | Noise on teacher forcing tokens (decoder only) |
| `--grad-clip` | `10.0` | Gradient clipping max norm |
| `--save-every` | `5` | Checkpoint frequency (epochs) |
| `--save-dir` | `checkpoints` | Checkpoint directory |
| `--resume` | none | Resume from checkpoint path |
| `--backbone` | `resnet50` | UNet backbone (`resnet50` or `resnet18`) |
| `--seq-len` | `90` | Sequence length (frames) |

---

## File Structure

```
model/
├── train.py                Training (multi-GPU DDP)
├── inference.py            Inference (scanpath, heatmap, decoder)
├── config.py               Hyperparameters
│
├── arch/                   Neural network
│   ├── unet.py             ResNet-50 UNet saliency encoder
│   ├── decoder.py          Transformer decoder (experimental)
│   └── predictor.py        Combined model (GazePredictor)
│
├── data/                   Data pipeline
│   ├── dataset.py          PyTorch datasets with augmentation
│   └── preprocess.py       Raw gaze .npz → training samples
│
└── utils/                  Utilities
    ├── scanpath_gen.py     Spline-based scanpath from heatmap
    ├── postprocess.py      Fixation clustering, heatmap generation
    └── heuristic.py        Simple heuristic fallback
```

## Architecture

```
Image → UNet (ResNet-50) → saliency heatmap
                                  ↓
                    scanpath_gen: find 50 salient waypoints
                                  ↓
                    order by viewing sequence (salience + reading order)
                                  ↓
                    fit cubic spline, variable speed sampling
                    (slow in salient regions, fast saccades between)
                                  ↓
                    240 frames at 30fps = 8 second gaze video
```

## Troubleshooting

**Train loss is 0.0 from epoch 1:** Batch size too large for dataset. Reduce `--batch` so effective batch (batch × n_gpus) is well under your dataset size.

**Heatmap too narrow/concentrated:** Train UNet alone (`--stage unet`), not joint. Joint training lets the decoder pull the heatmap toward fewer regions.

**Multi-GPU hangs:** Set `NCCL_P2P_DISABLE=1` and make sure GPUs are visible via `CUDA_VISIBLE_DEVICES`.

**Scanpath looks robotic:** Increase waypoints or n_frames in `utils/scanpath_gen.py`. Current defaults: 50 waypoints, 240 frames.
