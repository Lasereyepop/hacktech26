"""Lightweight wrapper around `model.inference` for serving via FastAPI.

The goal of this module is to:
  * Load the gaze checkpoint exactly once at startup (warm singleton).
  * Reuse the same model + transforms for every request.
  * Skip re-downloading the ImageNet ResNet-50 weights on subsequent runs
    (the gaze checkpoint already contains the trained backbone weights).
  * Operate on raw bytes (uploaded files) instead of disk paths.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms

from model.arch import GazePredictor
from model.config import DecoderConfig, InferenceConfig, UNetConfig
from model.inference import (
    apply_ior_suppression,
    derive_fixations,
    heatmap_to_base64,
)
from model.utils.scanpath_gen import generate_scanpath


logger = logging.getLogger(__name__)


_IMAGE_TRANSFORM = transforms.Compose(
    [
        transforms.ToPILImage(),
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ]
)


@dataclass
class ModelHandle:
    model: GazePredictor
    device: str
    checkpoint_path: str
    epoch: Optional[int] = None
    val_loss: Optional[float] = None


_LOCK = threading.Lock()
_HANDLE: Optional[ModelHandle] = None


def _resolve_device(requested: str) -> str:
    """Pick the best available device, falling back gracefully."""
    if requested == "auto":
        if torch.cuda.is_available():
            return "cuda"
        # MPS works for our UNet; we still default to CPU because torch's MPS
        # backend can be flaky with some ops on older builds. Users can opt in
        # explicitly with MODEL_DEVICE=mps.
        return "cpu"

    if requested == "cuda" and not torch.cuda.is_available():
        logger.warning("cuda requested but unavailable; falling back to cpu")
        return "cpu"

    if requested == "mps" and not torch.backends.mps.is_available():
        logger.warning("mps requested but unavailable; falling back to cpu")
        return "cpu"

    return requested


def load_model_handle(
    checkpoint_path: str,
    device: str = "auto",
    pretrained_backbone: bool = False,
) -> ModelHandle:
    """Load the gaze model once and cache it process-wide."""
    global _HANDLE
    with _LOCK:
        if _HANDLE is not None:
            return _HANDLE

        resolved_device = _resolve_device(device)
        logger.info(
            "loading gaze checkpoint %s on %s", checkpoint_path, resolved_device
        )
        t0 = time.time()

        state = torch.load(
            checkpoint_path, map_location=resolved_device, weights_only=True
        )

        unet_cfg = UNetConfig(pretrained=pretrained_backbone)
        decoder_cfg = DecoderConfig()

        model = GazePredictor(unet_cfg=unet_cfg, decoder_cfg=decoder_cfg)
        model.load_state_dict(state["model"], strict=False)
        model = model.to(resolved_device).eval()

        _HANDLE = ModelHandle(
            model=model,
            device=resolved_device,
            checkpoint_path=checkpoint_path,
            epoch=state.get("epoch"),
            val_loss=state.get("val_loss"),
        )

        logger.info(
            "gaze model ready on %s (epoch=%s, val_loss=%s) in %.1fs",
            resolved_device,
            _HANDLE.epoch,
            _HANDLE.val_loss,
            time.time() - t0,
        )

        return _HANDLE


def get_model_handle() -> ModelHandle:
    if _HANDLE is None:
        raise RuntimeError(
            "Model has not been loaded yet. Call load_model_handle() during startup."
        )
    return _HANDLE


def reset_model_handle() -> None:
    """Test hook to allow reloading the model (rarely needed)."""
    global _HANDLE
    with _LOCK:
        _HANDLE = None


# ---------------------------------------------------------------------------
# Image utilities
# ---------------------------------------------------------------------------


def decode_image_bytes(raw: bytes) -> np.ndarray:
    """Decode an uploaded image into a contiguous (H, W, 3) RGB ndarray."""
    if not raw:
        raise ValueError("empty image payload")

    arr = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        # Fall back to PIL for formats OpenCV may struggle with (e.g. WebP).
        try:
            img_pil = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as exc:
            raise ValueError(f"could not decode image: {exc}") from exc
        return np.array(img_pil, dtype=np.uint8)

    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def preprocess_rgb(rgb: np.ndarray, device: str) -> torch.Tensor:
    """Apply the same transforms as `model.inference.preprocess_image`."""
    tensor = _IMAGE_TRANSFORM(rgb).unsqueeze(0).to(device)
    return tensor


def png_overlay_b64(rgb: np.ndarray, heatmap_2d: np.ndarray, alpha: float = 0.45) -> str:
    """Blend a colored heatmap onto the original image and return base64 PNG."""
    h, w = rgb.shape[:2]
    heatmap_resized = cv2.resize(heatmap_2d, (w, h), interpolation=cv2.INTER_LINEAR)
    heatmap_uint8 = np.clip(heatmap_resized * 255.0, 0, 255).astype(np.uint8)

    colormap = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    colormap_rgb = cv2.cvtColor(colormap, cv2.COLOR_BGR2RGB)

    overlay = (
        rgb.astype(np.float32) * (1.0 - alpha)
        + colormap_rgb.astype(np.float32) * alpha
    ).astype(np.uint8)

    return _rgb_to_base64_png(overlay)


def _rgb_to_base64_png(rgb: np.ndarray) -> str:
    img = Image.fromarray(rgb)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


# ---------------------------------------------------------------------------
# High-level inference helpers (operate on already-decoded image arrays)
# ---------------------------------------------------------------------------


@torch.no_grad()
def run_heatmap_from_rgb(rgb: np.ndarray) -> dict:
    """Run UNet-only and return both the raw heatmap and an RGB overlay."""
    handle = get_model_handle()
    tensor = preprocess_rgb(rgb, handle.device)

    heatmap_tensor, _ = handle.model.unet(tensor)
    heatmap_np = heatmap_tensor[0, 0].detach().cpu().numpy()

    return {
        "heatmap_b64": heatmap_to_base64(heatmap_tensor[0]),
        "overlay_b64": png_overlay_b64(rgb, heatmap_np),
        "width": int(rgb.shape[1]),
        "height": int(rgb.shape[0]),
        "heatmap_resolution": [int(heatmap_np.shape[1]), int(heatmap_np.shape[0])],
    }


@torch.no_grad()
def run_scanpath_from_rgb(
    rgb: np.ndarray,
    *,
    n_frames: int = 90,
    fps: int = 30,
    fixation_threshold: float = 0.02,
    max_fixations: int = 50,
) -> dict:
    """Heatmap-guided scanpath generation (no decoder)."""
    handle = get_model_handle()
    tensor = preprocess_rgb(rgb, handle.device)

    heatmap_tensor, _ = handle.model.unet(tensor)
    heatmap_np = heatmap_tensor[0, 0].detach().cpu().numpy()

    gaze_list = generate_scanpath(
        heatmap_np, n_frames=n_frames, fps=fps, max_fixations=max_fixations
    )
    gaze_np = np.array(gaze_list, dtype=np.float32)

    fixations = derive_fixations(
        gaze_np, fps=fps, spatial_threshold=fixation_threshold
    )

    return {
        "width": int(rgb.shape[1]),
        "height": int(rgb.shape[0]),
        "fps": fps,
        "n_frames": int(gaze_np.shape[0]),
        "gaze_sequence": [
            {
                "frame": i,
                "x": round(float(g[0]), 4),
                "y": round(float(g[1]), 4),
            }
            for i, g in enumerate(gaze_np)
        ],
        "fixations": fixations,
        "heatmap_b64": heatmap_to_base64(heatmap_tensor[0]),
        "overlay_b64": png_overlay_b64(rgb, heatmap_np),
    }


@torch.no_grad()
def run_decoder_from_rgb(
    rgb: np.ndarray,
    *,
    mode: str = "ad",
    n_frames: int = 90,
    fps: int = 30,
    temperature: float = 0.02,
    fixation_threshold: float = 0.02,
) -> dict:
    """Transformer-decoder scanpath with IOR suppression (the model.inference variant)."""
    handle = get_model_handle()
    tensor = preprocess_rgb(rgb, handle.device)

    cfg = InferenceConfig(
        temperature=temperature,
        n_frames=n_frames,
        fps=fps,
        fixation_threshold=fixation_threshold,
    )

    raw_model = handle.model
    heatmap_tensor, bottleneck = raw_model.unet(tensor)
    B, S, D = bottleneck.shape

    decoder = raw_model.get_decoder(mode)
    tokens = decoder.bos_token.expand(B, -1, -1)
    predictions = []
    ior_map = torch.zeros(B, S, device=tensor.device)

    for _ in range(cfg.n_frames):
        memory = apply_ior_suppression(bottleneck, ior_map, cfg.ior_strength)
        pos_tokens = tokens + decoder.temporal_pos[:, : tokens.shape[1], :]
        out = decoder.transformer(tgt=pos_tokens, memory=memory)
        xy = torch.sigmoid(decoder.output_head(out[:, -1:, :]))

        if cfg.temperature > 0:
            xy = xy + torch.randn_like(xy) * cfg.temperature
            xy = xy.clamp(0, 1)

        predictions.append(xy)

        new_token = decoder.encode_gaze(xy[:, :, 0], xy[:, :, 1])
        tokens = torch.cat([tokens, new_token], dim=1)

        ior_map = ior_map * cfg.ior_decay
        x_val = float(xy[0, 0, 0].item())
        y_val = float(xy[0, 0, 1].item())
        spatial_size = int(round(S**0.5))
        sx_idx = torch.arange(S, device=tensor.device) % spatial_size
        sy_idx = torch.arange(S, device=tensor.device) // spatial_size
        sx_norm = (sx_idx + 0.5) / spatial_size
        sy_norm = (sy_idx + 0.5) / spatial_size
        dist_sq = (sx_norm - x_val) ** 2 + (sy_norm - y_val) ** 2
        ior_map = ior_map + torch.exp(-dist_sq / (2 * cfg.ior_sigma**2))[None, :]
        ior_map = ior_map.clamp(0, 1)

    gaze_seq = torch.cat(predictions, dim=1)
    gaze_np = gaze_seq[0].cpu().numpy()

    fixations = derive_fixations(
        gaze_np, fps=cfg.fps, spatial_threshold=cfg.fixation_threshold
    )

    heatmap_np = heatmap_tensor[0, 0].detach().cpu().numpy()

    return {
        "width": int(rgb.shape[1]),
        "height": int(rgb.shape[0]),
        "fps": cfg.fps,
        "n_frames": int(gaze_np.shape[0]),
        "mode": mode,
        "gaze_sequence": [
            {"frame": i, "x": round(float(g[0]), 4), "y": round(float(g[1]), 4)}
            for i, g in enumerate(gaze_np)
        ],
        "fixations": fixations,
        "heatmap_b64": heatmap_to_base64(heatmap_tensor[0]),
        "overlay_b64": png_overlay_b64(rgb, heatmap_np),
    }


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------


def default_checkpoint_path() -> str:
    env_path = os.environ.get("GAZE_CHECKPOINT")
    if env_path:
        return env_path

    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", ".."))
    return os.path.join(repo_root, "model", "checkpoints", "gaze_epoch250.pt")


def default_device() -> str:
    return os.environ.get("MODEL_DEVICE", "auto")
