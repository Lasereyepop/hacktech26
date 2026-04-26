"""FastAPI backend serving the trained gaze prediction model."""

from __future__ import annotations

import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from typing import Optional

# Make `model.*` importable when running from anywhere.
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from apps.api.inference_service import (  # noqa: E402
    decode_image_bytes,
    default_checkpoint_path,
    default_device,
    get_model_handle,
    load_model_handle,
    run_decoder_from_rgb,
    run_heatmap_from_rgb,
    run_scanpath_from_rgb,
)

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("gaze_api")


MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/bmp",
    "image/gif",
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    checkpoint = default_checkpoint_path()
    device = default_device()

    if not os.path.exists(checkpoint):
        logger.error("checkpoint not found at %s", checkpoint)
        raise RuntimeError(
            f"Gaze checkpoint missing at {checkpoint}. Set GAZE_CHECKPOINT to override."
        )

    load_model_handle(checkpoint, device=device, pretrained_backbone=False)
    yield


app = FastAPI(
    title="Gaze Prediction API",
    description=(
        "FastAPI backend serving the trained gaze model "
        "(`model/checkpoints/gaze_epoch250.pt` by default)."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
_origins = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _read_image_upload(file: UploadFile) -> "tuple[bytes, str]":
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content type: {file.content_type}",
        )

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large ({len(raw)} bytes, limit {MAX_UPLOAD_BYTES}).",
        )

    return raw, file.filename or "upload"


def _decode_or_400(raw: bytes):
    try:
        return decode_image_bytes(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/")
def root():
    return {
        "name": "gaze-prediction-api",
        "status": "ok",
        "endpoints": [
            "GET /health",
            "POST /predict/heatmap   (multipart 'image')",
            "POST /predict/scanpath  (multipart 'image')",
            "POST /predict/decoder   (multipart 'image' + form 'mode' = ad|ego)",
        ],
    }


@app.get("/health")
def health():
    try:
        handle = get_model_handle()
    except RuntimeError as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "loading", "detail": str(exc)},
        )

    return {
        "status": "ok",
        "device": handle.device,
        "checkpoint": handle.checkpoint_path,
        "epoch": handle.epoch,
        "val_loss": handle.val_loss,
    }


@app.post("/predict/heatmap")
async def predict_heatmap(image: UploadFile = File(...)):
    raw, filename = await _read_image_upload(image)
    rgb = _decode_or_400(raw)

    t0 = time.time()
    result = run_heatmap_from_rgb(rgb)
    elapsed_ms = round((time.time() - t0) * 1000, 1)

    logger.info("heatmap %s w=%d h=%d in %sms", filename, result["width"], result["height"], elapsed_ms)
    result["elapsed_ms"] = elapsed_ms
    return result


@app.post("/predict/scanpath")
async def predict_scanpath(
    image: UploadFile = File(...),
    n_frames: int = Form(90),
    fps: int = Form(30),
    max_fixations: int = Form(50),
    fixation_threshold: float = Form(0.02),
):
    if n_frames < 4 or n_frames > 600:
        raise HTTPException(status_code=400, detail="n_frames must be in [4, 600]")
    if fps < 1 or fps > 120:
        raise HTTPException(status_code=400, detail="fps must be in [1, 120]")
    if max_fixations < 2 or max_fixations > 200:
        raise HTTPException(status_code=400, detail="max_fixations must be in [2, 200]")

    raw, filename = await _read_image_upload(image)
    rgb = _decode_or_400(raw)

    t0 = time.time()
    result = run_scanpath_from_rgb(
        rgb,
        n_frames=n_frames,
        fps=fps,
        fixation_threshold=fixation_threshold,
        max_fixations=max_fixations,
    )
    elapsed_ms = round((time.time() - t0) * 1000, 1)

    logger.info(
        "scanpath %s w=%d h=%d frames=%d fixations=%d in %sms",
        filename,
        result["width"],
        result["height"],
        result["n_frames"],
        len(result["fixations"]),
        elapsed_ms,
    )
    result["elapsed_ms"] = elapsed_ms
    return result


@app.post("/predict/decoder")
async def predict_decoder(
    image: UploadFile = File(...),
    mode: str = Form("ad"),
    n_frames: int = Form(90),
    fps: int = Form(30),
    temperature: float = Form(0.02),
    fixation_threshold: float = Form(0.02),
):
    if mode not in {"ad", "ego"}:
        raise HTTPException(status_code=400, detail="mode must be 'ad' or 'ego'")
    if n_frames < 4 or n_frames > 600:
        raise HTTPException(status_code=400, detail="n_frames must be in [4, 600]")

    raw, filename = await _read_image_upload(image)
    rgb = _decode_or_400(raw)

    t0 = time.time()
    result = run_decoder_from_rgb(
        rgb,
        mode=mode,
        n_frames=n_frames,
        fps=fps,
        temperature=temperature,
        fixation_threshold=fixation_threshold,
    )
    elapsed_ms = round((time.time() - t0) * 1000, 1)

    logger.info(
        "decoder %s mode=%s frames=%d in %sms",
        filename,
        mode,
        result["n_frames"],
        elapsed_ms,
    )
    result["elapsed_ms"] = elapsed_ms
    return result
