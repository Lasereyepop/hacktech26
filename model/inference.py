"""
Inference pipeline for gaze prediction.

Usage:
    python -m model.inference --checkpoint checkpoints/gaze_best.pt --input image.jpg --mode ad
    python -m model.inference --checkpoint checkpoints/gaze_best.pt --input video.mp4 --mode ego
    python -m model.inference --checkpoint checkpoints/gaze_best.pt --input image.jpg --heatmap
"""

import argparse
import base64
import io
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torchvision import transforms
from PIL import Image
from tqdm import tqdm

from .config import UNetConfig, DecoderConfig, InferenceConfig
from .arch import GazePredictor
from .utils import derive_fixations, heuristic_scanpath
from .utils.scanpath_gen import generate_scanpath


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"}


def load_model(checkpoint_path, device="cuda", **override_kwargs):
    """Load a trained GazePredictor from checkpoint."""
    state = torch.load(checkpoint_path, map_location=device, weights_only=True)

    unet_cfg = UNetConfig(**{k: v for k, v in override_kwargs.items() if hasattr(UNetConfig, k)})
    decoder_cfg = DecoderConfig(**{k: v for k, v in override_kwargs.items() if hasattr(DecoderConfig, k)})

    model = GazePredictor(unet_cfg=unet_cfg, decoder_cfg=decoder_cfg)
    model.load_state_dict(state["model"], strict=False)
    model = model.to(device).eval()
    return model


def preprocess_image(image_path, image_size=224):
    """Load and preprocess a single image for inference."""
    img = cv2.imread(str(image_path))
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    transform = transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    tensor = transform(img_rgb).unsqueeze(0)  # (1, 3, H, W)
    return tensor, img_rgb


def preprocess_video(video_path, n_frames=90, image_size=224):
    """Load and preprocess video frames for inference."""
    cap = cv2.VideoCapture(str(video_path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    indices = np.linspace(0, total - 1, min(n_frames, total), dtype=int)

    transform = transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    frames = []
    raw_frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        raw_frames.append(rgb)
        frames.append(transform(rgb))

    cap.release()

    while len(frames) < n_frames:
        frames.append(frames[-1])
        raw_frames.append(raw_frames[-1])

    tensor = torch.stack(frames[:n_frames]).unsqueeze(0)  # (1, T, 3, H, W)
    return tensor, raw_frames[0]


def apply_ior_suppression(features, ior_map, strength=0.3):
    """
    Soft suppression of recently fixated regions in feature space.
    features: (B, S, D)
    ior_map: (B, S) suppression weights
    """
    suppression = 1.0 - strength * ior_map.unsqueeze(-1)
    return features * suppression


@torch.no_grad()
def predict_with_ior(model, images, mode="ad", cfg=None):
    """
    Inference with IOR safety net for static images.
    Generates gaze sequence one step at a time with feature suppression.
    """
    cfg = cfg or InferenceConfig()
    device = images.device
    is_static = images.dim() == 4

    raw_model = model.module if hasattr(model, "module") else model
    heatmap, bottleneck = raw_model.unet(images if is_static else images[:, 0])
    B, S, D = bottleneck.shape

    if not is_static:
        B_v, T, C, H, W = images.shape
        flat = images.reshape(B_v * T, C, H, W)
        _, bn = raw_model.unet(flat)
        bottleneck = bn.reshape(B_v, T * bn.shape[1], D)
        S = bottleneck.shape[1]

    decoder = raw_model.get_decoder(mode)
    tokens = decoder.bos_token.expand(B, -1, -1)
    predictions = []

    ior_map = torch.zeros(B, S, device=device)

    for t in tqdm(range(cfg.n_frames), desc="generating", leave=False,
                   bar_format="  {desc} {bar:20} {n_fmt}/{total_fmt}"):
        if is_static:
            memory = apply_ior_suppression(bottleneck, ior_map, cfg.ior_strength)
        else:
            memory = bottleneck

        pos_tokens = tokens + decoder.temporal_pos[:, :tokens.shape[1], :]
        out = decoder.transformer(tgt=pos_tokens, memory=memory)

        xy = torch.sigmoid(decoder.output_head(out[:, -1:, :]))

        if cfg.temperature > 0:
            xy = xy + torch.randn_like(xy) * cfg.temperature
            xy = xy.clamp(0, 1)

        predictions.append(xy)

        new_token = decoder.encode_gaze(xy[:, :, 0], xy[:, :, 1])
        tokens = torch.cat([tokens, new_token], dim=1)

        if is_static:
            ior_map = ior_map * cfg.ior_decay
            x_val, y_val = xy[0, 0, 0].item(), xy[0, 0, 1].item()
            spatial_size = int(S ** 0.5)
            for s_idx in range(S):
                sy, sx = divmod(s_idx, spatial_size)
                sx_norm = (sx + 0.5) / spatial_size
                sy_norm = (sy + 0.5) / spatial_size
                dist_sq = (sx_norm - x_val) ** 2 + (sy_norm - y_val) ** 2
                ior_map[:, s_idx] += torch.exp(torch.tensor(-dist_sq / (2 * cfg.ior_sigma ** 2)))
            ior_map = ior_map.clamp(0, 1)

    gaze_seq = torch.cat(predictions, dim=1)
    return gaze_seq, heatmap


def heatmap_to_base64(heatmap_tensor):
    """Convert (1, H, W) heatmap tensor to base64 PNG."""
    heatmap_np = heatmap_tensor.squeeze().cpu().numpy()
    heatmap_uint8 = (heatmap_np * 255).astype(np.uint8)
    colored = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    colored_rgb = cv2.cvtColor(colored, cv2.COLOR_BGR2RGB)

    img = Image.fromarray(colored_rgb)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def format_output(gaze_seq, heatmap, cfg=None):
    """Format model output as JSON-serializable dict."""
    cfg = cfg or InferenceConfig()

    gaze_np = gaze_seq[0].cpu().numpy()

    gaze_sequence = [
        {"frame": i, "x": round(float(g[0]), 4), "y": round(float(g[1]), 4)}
        for i, g in enumerate(gaze_np)
    ]

    fixations = derive_fixations(gaze_np, fps=cfg.fps, spatial_threshold=cfg.fixation_threshold)

    heatmap_b64 = heatmap_to_base64(heatmap[0])

    return {
        "heatmap": heatmap_b64,
        "gaze_sequence": gaze_sequence,
        "fixations": fixations,
    }


@torch.no_grad()
def run_heatmap(checkpoint_path, input_path, device="cuda", output_path=None,
                image_size=224, **model_kwargs):
    """
    Heatmap-only inference. Runs the UNet, skips the decoder entirely.
    Saves a heatmap overlay image (PNG) on top of the original input.
    Returns the overlay as a numpy array (H, W, 3) RGB.
    """
    input_path = Path(input_path)
    is_image = input_path.suffix.lower() in IMAGE_EXTS

    model = load_model(checkpoint_path, device=device, **model_kwargs)

    if is_image:
        tensor, raw_rgb = preprocess_image(input_path, image_size)
    else:
        tensor, raw_rgb = preprocess_video(input_path, image_size=image_size)

    tensor = tensor.to(device)
    unet_input = tensor if is_image else tensor[:, 0]
    heatmap, _ = model.unet(unet_input)

    heatmap_np = heatmap[0, 0].cpu().numpy()  # (H', W') in [0, 1]

    orig_h, orig_w = raw_rgb.shape[:2]
    heatmap_resized = cv2.resize(heatmap_np, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
    heatmap_uint8 = (heatmap_resized * 255).astype(np.uint8)

    colormap = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    colormap_rgb = cv2.cvtColor(colormap, cv2.COLOR_BGR2RGB)

    alpha = 0.45
    overlay = (raw_rgb.astype(np.float32) * (1 - alpha) +
               colormap_rgb.astype(np.float32) * alpha).astype(np.uint8)

    if output_path is None:
        output_path = input_path.with_name(input_path.stem + "_heatmap.png")

    overlay_bgr = cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(output_path), overlay_bgr)

    return overlay, output_path


@torch.no_grad()
def run_heatmap_video(checkpoint_path, input_path, device="cuda", output_path=None,
                      image_size=224, show_gaze=False, **model_kwargs):
    """
    Per-frame heatmap overlay on a video. Processes every frame through the UNet.
    If show_gaze=True, also draws predicted gaze point and trail on each frame.
    """
    input_path = Path(input_path)
    model = load_model(checkpoint_path, device=device, **model_kwargs)

    cap = cv2.VideoCapture(str(input_path))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    target_w, target_h = 1920, 1080

    if output_path is None:
        output_path = input_path.with_name(input_path.stem + "_heatmap.mp4")

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (target_w, target_h))

    transform = transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    alpha = 0.45
    trail = []

    for i in tqdm(range(total_frames), desc="processing frames",
                  bar_format="  {desc} {bar:20} {n_fmt}/{total_fmt}"):
        ret, frame_bgr = cap.read()
        if not ret:
            break

        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        tensor = transform(frame_rgb).unsqueeze(0).to(device)

        heatmap, _ = model.unet(tensor)
        heatmap_np = heatmap[0, 0].detach().cpu().numpy()

        heatmap_resized = cv2.resize(heatmap_np, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
        heatmap_uint8 = (heatmap_resized * 255).astype(np.uint8)
        colormap = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)

        overlay = (frame_bgr.astype(np.float32) * (1 - alpha) +
                   colormap.astype(np.float32) * alpha).astype(np.uint8)

        overlay = cv2.resize(overlay, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

        if show_gaze:
            # Predicted gaze = peak of heatmap
            peak_idx = np.argmax(heatmap_np)
            py, px = divmod(peak_idx, heatmap_np.shape[1])
            gx = px / heatmap_np.shape[1]
            gy = py / heatmap_np.shape[0]
            screen_x = int(gx * target_w)
            screen_y = int(gy * target_h)

            trail.append((screen_x, screen_y))
            if len(trail) > 30:
                trail.pop(0)

            for k in range(1, len(trail)):
                a = k / len(trail)
                cv2.line(overlay, trail[k - 1], trail[k], (255, 255, 0), int(2 + a * 4))

            cv2.circle(overlay, (screen_x, screen_y), 10, (0, 0, 255), -1)

        writer.write(overlay)

    cap.release()
    writer.release()
    print(f"\n  saved heatmap video to {output_path}\n")
    return output_path


@torch.no_grad()
def run_scanpath_gen(checkpoint_path, input_path, device="cuda", cfg=None, **model_kwargs):
    """
    Heatmap-guided scanpath generation. Uses the trained UNet for saliency,
    then generates a realistic trajectory algorithmically.
    No decoder needed.
    """
    cfg = cfg or InferenceConfig()
    input_path = Path(input_path)
    is_image = input_path.suffix.lower() in IMAGE_EXTS

    model = load_model(checkpoint_path, device=device, **model_kwargs)

    if is_image:
        tensor, raw_image = preprocess_image(input_path)
    else:
        tensor, raw_image = preprocess_video(input_path, n_frames=cfg.n_frames)

    tensor = tensor.to(device)
    unet_input = tensor if is_image else tensor[:, 0]
    heatmap, _ = model.unet(unet_input)
    heatmap_np = heatmap[0, 0].cpu().numpy()

    gaze_list = generate_scanpath(heatmap_np, n_frames=cfg.n_frames, fps=cfg.fps)

    gaze_np = np.array(gaze_list, dtype=np.float32)
    gaze_seq = torch.from_numpy(gaze_np).unsqueeze(0).to(device)

    return format_output(gaze_seq, heatmap, cfg=cfg)


def run_inference(checkpoint_path, input_path, mode="ad", device="cuda",
                  use_heuristic=False, cfg=None, **model_kwargs):
    """
    Full inference pipeline: load model, preprocess input, predict, format output.
    """
    cfg = cfg or InferenceConfig()
    input_path = Path(input_path)
    is_image = input_path.suffix.lower() in IMAGE_EXTS

    model = load_model(checkpoint_path, device=device, **model_kwargs)

    if is_image:
        tensor, raw_image = preprocess_image(input_path)
    else:
        tensor, raw_image = preprocess_video(input_path, n_frames=cfg.n_frames)

    tensor = tensor.to(device)

    if use_heuristic:
        heatmap, _ = model.unet(tensor if is_image else tensor[:, 0])
        heatmap_np = heatmap[0, 0].detach().cpu().numpy()
        gaze_list = heuristic_scanpath(heatmap_np, n_fixations=6, fps=cfg.fps)
        gaze_np = np.array(gaze_list, dtype=np.float32)
        if len(gaze_np) < cfg.n_frames:
            pad = np.tile(gaze_np[-1:], (cfg.n_frames - len(gaze_np), 1))
            gaze_np = np.concatenate([gaze_np, pad])
        gaze_seq = torch.from_numpy(gaze_np[:cfg.n_frames]).unsqueeze(0).to(device)
    else:
        gaze_seq, heatmap = predict_with_ior(model, tensor, mode=mode, cfg=cfg)

    return format_output(gaze_seq, heatmap, cfg=cfg)


@torch.no_grad()
def render_gaze_video(raw_rgb, gaze_preds, save_path=None, title="Gaze Viz"):
    """
    Render animated gaze trail on an image.
    gaze_preds: ndarray (T, 2) normalized [0, 1]
    If save_path is provided, saves MP4 and returns without displaying.
    """
    # Scale to 1920x1080
    target_w, target_h = 1920, 1080
    scaled = cv2.resize(raw_rgb, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    viz_canvas = cv2.cvtColor(scaled, cv2.COLOR_RGB2BGR)
    h, w = target_h, target_w

    video_writer = None
    if save_path:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        video_writer = cv2.VideoWriter(str(save_path), fourcc, 30.0, (w, h))

    trail = []
    for i, (gx, gy) in enumerate(gaze_preds):
        px, py = int(gx * w), int(gy * h)

        frame = viz_canvas.copy()
        trail.append((px, py))
        if len(trail) > 30:
            trail.pop(0)

        for k in range(1, len(trail)):
            alpha = k / len(trail)
            cv2.line(frame, trail[k - 1], trail[k], (255, 255, 0), int(2 + alpha * 4))

        cv2.circle(frame, (px, py), 8, (0, 0, 255), -1)

        if video_writer:
            video_writer.write(frame)
        else:
            cv2.imshow(title, frame)
            if cv2.waitKey(33) & 0xFF == ord('q'):
                cv2.destroyAllWindows()
                return

    if video_writer:
        video_writer.release()
        print(f"\n  saved video to {save_path}\n")
    else:
        cv2.destroyAllWindows()


@torch.no_grad()
def run_viz(checkpoint_path, input_path, mode="ad", device="cuda",
            n_frames=90, save_path=None, use_scanpath_gen=False, **model_kwargs):
    """
    Run inference and show/save an animated gaze trail.
    use_scanpath_gen: if True, use heatmap-guided algorithmic generation instead of decoder.
    """
    input_path = Path(input_path)
    model = load_model(checkpoint_path, device=device, **model_kwargs)

    tensor, raw_rgb = preprocess_image(input_path)
    tensor = tensor.to(device)

    cfg = InferenceConfig(n_frames=n_frames)

    if use_scanpath_gen:
        heatmap, _ = model.unet(tensor)
        heatmap_np = heatmap[0, 0].detach().cpu().numpy()
        gaze_list = generate_scanpath(heatmap_np, n_frames=n_frames, fps=30)
        gaze_preds = np.array(gaze_list, dtype=np.float32)
    else:
        gaze_seq, _ = predict_with_ior(model, tensor, mode=mode, cfg=cfg)
        gaze_preds = gaze_seq.cpu().numpy()[0]

    render_gaze_video(raw_rgb, gaze_preds, save_path=save_path)


def main():
    parser = argparse.ArgumentParser(description="Run gaze prediction inference")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--mode", default="ad", choices=["ad", "ego"])
    parser.add_argument("--output", default=None, help="Output path (JSON for scanpath, PNG for heatmap, MP4 for video)")
    parser.add_argument("--temperature", type=float, default=0.02)
    parser.add_argument("--n-frames", type=int, default=90)
    parser.add_argument("--heatmap", action="store_true", help="Output heatmap overlay instead of scanpath")
    parser.add_argument("--visualize", action="store_true", help="Show animated gaze trail")
    parser.add_argument("--save", action="store_true", help="Save the visualization (as video) or heatmap")
    parser.add_argument("--heuristic", action="store_true", help="Use old heuristic scanpath fallback")
    parser.add_argument("--scanpath", action="store_true", help="Generate scanpath from heatmap (no decoder)")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    is_video = Path(args.input).suffix.lower() not in IMAGE_EXTS

    if args.heatmap:
        if is_video:
            output_path = args.output or Path("model") / (Path(args.input).stem + "_heatmap.mp4")
            run_heatmap_video(
                args.checkpoint, args.input,
                device=args.device, output_path=str(output_path),
                show_gaze=args.scanpath,
            )
        else:
            output_path = args.output or Path("model") / (Path(args.input).stem + "_heatmap.png")
            overlay, out = run_heatmap(
                args.checkpoint, args.input,
                device=args.device, output_path=output_path,
            )
            if args.save:
                print(f"\n  heatmap saved to {out}\n")
            else:
                print("\n  displaying heatmap... (press any key to exit)")
                cv2.imshow("Gaze Heatmap", cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))
                cv2.waitKey(0)
                cv2.destroyAllWindows()
        return

    if args.scanpath and not is_video:
        save_path = None
        if args.save:
            save_path = str(args.output or Path("model") / Path(args.input).with_suffix(".mp4").name)
        n = 120 if args.n_frames == 90 else args.n_frames
        run_viz(
            args.checkpoint, args.input, mode=args.mode,
            device=args.device, n_frames=n,
            save_path=save_path, use_scanpath_gen=True,
        )
        return

    if args.visualize:
        save_path = None
        if args.save:
            save_path = args.output or Path("model") / Path(args.input).with_suffix(".mp4").name

        run_viz(
            args.checkpoint, args.input, mode=args.mode,
            device=args.device, n_frames=args.n_frames,
            save_path=save_path,
            use_scanpath_gen=args.scanpath,
        )
        return

    cfg = InferenceConfig(temperature=args.temperature, n_frames=args.n_frames)

    result = run_inference(
        args.checkpoint, args.input, mode=args.mode,
        device=args.device, use_heuristic=args.heuristic, cfg=cfg,
    )

    output_path = args.output or Path("model") / Path(args.input).with_suffix(".json").name
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    n_fix = len(result["fixations"])
    print()
    print(f"  {len(result['gaze_sequence'])} gaze points, {n_fix} fixations")
    print()
    for fix in result["fixations"]:
        bar_len = int(fix["dwell_ms"] / 20)
        bar = "█" * min(bar_len, 25)
        print(f"  {fix['fixation_index']:>2}. ({fix['x']:.2f}, {fix['y']:.2f})  "
              f"{fix['dwell_ms']:>5.0f}ms  {bar}")
    print()
    print(f"  saved to {output_path}")
    print()


if __name__ == "__main__":
    main()
