"""
Multi-GPU training for gaze prediction model.

Single GPU:
    python -m model.train --data data/processed --mode ad --stage joint

Multi-GPU (follows Condition-ACT pattern):
    CUDA_VISIBLE_DEVICES=0,1,2,3 NCCL_P2P_DISABLE=1 torchrun \
        --nproc_per_node=4 --master_port=29501 \
        -m model.train --data data/processed --mode ad --stage joint --epochs 50

Stages:
    unet    - Train UNet saliency encoder only (heatmap supervision)
    decoder - Train decoder only (freeze UNet, gaze sequence supervision)
    joint   - Train both with differential learning rates
"""

import argparse
import os
from pathlib import Path

import torch
import torch.distributed as dist
import torch.nn as nn
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader, DistributedSampler, random_split
from tqdm import tqdm

from .config import UNetConfig, DecoderConfig
from .arch import GazePredictor
from .data import StaticGazeDataset, VideoGazeDataset


# ---------------------------------------------------------------------------
# DDP setup (mirrors Condition-ACT)
# ---------------------------------------------------------------------------

def setup_ddp():
    if "RANK" in os.environ and "WORLD_SIZE" in os.environ:
        rank = int(os.environ["RANK"])
        local_rank = int(os.environ["LOCAL_RANK"])
        world_size = int(os.environ["WORLD_SIZE"])
        torch.cuda.set_device(local_rank)
        dist.init_process_group(backend="nccl", init_method="env://")
        return rank, local_rank, world_size
    print("Not using DDP. Running on single GPU.")
    return 0, 0, 1


def cleanup_ddp():
    if dist.is_initialized():
        dist.destroy_process_group()


# ---------------------------------------------------------------------------
# Loss
# ---------------------------------------------------------------------------

def heatmap_loss(pred, target, entropy_weight=0.1):
    bce = nn.functional.binary_cross_entropy(pred, target)
    mse = nn.functional.mse_loss(pred, target)
    # Entropy regularization: penalize concentrated heatmaps
    p = pred.clamp(1e-6, 1 - 1e-6)
    entropy = -(p * p.log() + (1 - p) * (1 - p).log()).mean()
    return bce + mse - entropy_weight * entropy


def gaze_loss(pred, target):
    return nn.functional.l1_loss(pred, target)


def compute_loss(output, gaze_gt, heatmap_gt, stage):
    """Compute loss from model output dict. Returns (total_loss, h_loss, g_loss)."""
    h_loss = torch.tensor(0.0, device=gaze_gt.device)
    g_loss = torch.tensor(0.0, device=gaze_gt.device)

    if "heatmap" in output:
        h_loss = heatmap_loss(output["heatmap"], heatmap_gt)
    if "gaze" in output:
        g_loss = gaze_loss(output["gaze"], gaze_gt)

    if stage == "unet":
        return h_loss, h_loss.item(), 0.0
    elif stage == "decoder":
        return g_loss, 0.0, g_loss.item()
    else:
        return h_loss + g_loss, h_loss.item(), g_loss.item()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Train gaze prediction model")
    parser.add_argument("--data", required=True, help="Processed data directory")
    parser.add_argument("--mode", default="ad", choices=["ad", "ego"])
    parser.add_argument("--stage", default="joint", choices=["unet", "decoder", "joint"])
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--lr-encoder", type=float, default=5e-5)
    parser.add_argument("--lr-decoder", type=float, default=5e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--grad-clip", type=float, default=10.0)
    parser.add_argument("--warmup-steps", type=int, default=500)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--save-every", type=int, default=5)
    parser.add_argument("--save-dir", default="checkpoints")
    parser.add_argument("--save-name", default="gaze")
    parser.add_argument("--resume", default=None, help="Checkpoint to resume from")
    parser.add_argument("--noise-std", type=float, default=0.02, help="Noise added to teacher forcing tokens")
    parser.add_argument("--val-split", type=float, default=0.05)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--seq-len", type=int, default=90)
    parser.add_argument("--backbone", default="resnet50")
    parser.add_argument("--d-model", type=int, default=256)
    parser.add_argument("--dec-layers", type=int, default=4)
    parser.add_argument("--nhead", type=int, default=8)
    args = parser.parse_args()

    # --- DDP ---
    global_rank, local_rank, world_size = setup_ddp()
    is_master = global_rank == 0
    use_ddp = world_size > 1
    device = torch.device(f"cuda:{local_rank}" if torch.cuda.is_available() else "cpu")

    torch.manual_seed(42 + global_rank)

    if is_master:
        print()
        print(f"  stage={args.stage}  mode={args.mode}  "
              f"epochs={args.epochs}  batch={args.batch}  gpus={world_size}")
        print()

    # --- Dataset ---
    is_static = args.mode == "ad"
    if is_static:
        full_dataset = StaticGazeDataset(args.data, image_size=args.image_size, augment=True)
    else:
        full_dataset = VideoGazeDataset(args.data, image_size=args.image_size, augment=True)

    val_size = max(1, int(len(full_dataset) * args.val_split))
    train_size = len(full_dataset) - val_size
    train_dataset, val_dataset = random_split(
        full_dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(42),
    )

    if is_master:
        print(f"  dataset: {len(full_dataset)} total  {train_size} train  {val_size} val")
        print()

    train_sampler = DistributedSampler(train_dataset, shuffle=True) if use_ddp else None
    val_sampler = DistributedSampler(val_dataset, shuffle=False) if use_ddp else None

    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch,
        shuffle=(train_sampler is None),
        sampler=train_sampler,
        num_workers=args.num_workers,
        pin_memory=True,
        persistent_workers=args.num_workers > 0,
        drop_last=True,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch,
        shuffle=False,
        sampler=val_sampler,
        num_workers=args.num_workers,
        pin_memory=True,
    )

    # --- Model ---
    unet_cfg = UNetConfig(backbone=args.backbone, bottleneck_dim=args.d_model)
    decoder_cfg = DecoderConfig(
        d_model=args.d_model, nhead=args.nhead,
        num_layers=args.dec_layers, max_seq_len=args.seq_len,
    )
    model = GazePredictor(unet_cfg=unet_cfg, decoder_cfg=decoder_cfg).to(device)

    if args.resume:
        state = torch.load(args.resume, map_location=device, weights_only=True)
        model.load_state_dict(state["model"], strict=False)
        if is_master:
            print(f"Resumed from {args.resume}")

    # Freeze UNet when only training decoder
    if args.stage == "decoder":
        for p in model.unet.parameters():
            p.requires_grad = False

    if use_ddp:
        model = nn.SyncBatchNorm.convert_sync_batchnorm(model)
        # find_unused_parameters=True because only one decoder head (ad or ego)
        # is active per training run — the other head's params are unused.
        model = DDP(model, device_ids=[local_rank], find_unused_parameters=True)

    # --- Optimizer (differential LR) ---
    raw_model = model.module if use_ddp else model
    param_groups = []

    if args.stage in ("unet", "joint"):
        param_groups.append({"params": raw_model.unet.parameters(), "lr": args.lr_encoder})

    decoder = raw_model.get_decoder(args.mode)
    if args.stage in ("decoder", "joint"):
        param_groups.append({"params": decoder.parameters(), "lr": args.lr_decoder})

    optimizer = torch.optim.AdamW(param_groups, weight_decay=args.weight_decay)

    # Save base LR for warmup before scheduler touches anything
    base_lrs = [pg["lr"] for pg in optimizer.param_groups]

    total_steps = len(train_loader) * args.epochs
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=total_steps, eta_min=min(base_lrs) * 0.01,
    )

    # --- Save dir ---
    save_dir = Path(args.save_dir)
    if is_master:
        save_dir.mkdir(parents=True, exist_ok=True)

    # --- Training loop ---
    best_val_loss = float("inf")
    step = 0

    epoch_bar = tqdm(
        range(args.epochs),
        desc="training",
        disable=not is_master,
        bar_format="{l_bar}{bar:30}{r_bar}",
    )

    try:
        for epoch in epoch_bar:
            model.train()
            if train_sampler is not None:
                train_sampler.set_epoch(epoch)

            epoch_loss = 0.0
            epoch_h = 0.0
            epoch_g = 0.0
            n_batches = 0

            batch_bar = tqdm(
                train_loader,
                desc=f"  epoch {epoch+1:>3}",
                leave=False,
                disable=not is_master,
                bar_format="  {desc} {bar:20} {n_fmt}/{total_fmt}  loss={postfix}",
                postfix=f"{0.0:.4f}",
            )

            for frames, gaze_gt, heatmap_gt in batch_bar:
                frames = frames.to(device, non_blocking=True)
                gaze_gt = gaze_gt.to(device, non_blocking=True)
                heatmap_gt = heatmap_gt.to(device, non_blocking=True)

                step += 1
                if step <= args.warmup_steps:
                    scale = step / args.warmup_steps
                    for pg, base_lr in zip(optimizer.param_groups, base_lrs):
                        pg["lr"] = base_lr * scale

                optimizer.zero_grad(set_to_none=True)

                gaze_x = gaze_gt[:, :, 0]
                gaze_y = gaze_gt[:, :, 1]

                output = model(
                    frames,
                    gaze_x=gaze_x if args.stage != "unet" else None,
                    gaze_y=gaze_y if args.stage != "unet" else None,
                    mode=args.mode,
                    stage=args.stage,
                    noise_std=args.noise_std,
                )

                loss, h_l, g_l = compute_loss(output, gaze_gt, heatmap_gt, args.stage)

                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), args.grad_clip)
                optimizer.step()

                if step > args.warmup_steps:
                    scheduler.step()

                epoch_loss += loss.item()
                epoch_h += h_l
                epoch_g += g_l
                n_batches += 1

                batch_bar.set_postfix_str(f"{epoch_loss / n_batches:.4f}")

            # --- Validation ---
            model.eval()
            val_loss_sum = 0.0
            val_batches = 0

            with torch.no_grad():
                for frames, gaze_gt, heatmap_gt in val_loader:
                    frames = frames.to(device, non_blocking=True)
                    gaze_gt = gaze_gt.to(device, non_blocking=True)
                    heatmap_gt = heatmap_gt.to(device, non_blocking=True)

                    gaze_x = gaze_gt[:, :, 0]
                    gaze_y = gaze_gt[:, :, 1]

                    output = model(
                        frames,
                        gaze_x=gaze_x if args.stage != "unet" else None,
                        gaze_y=gaze_y if args.stage != "unet" else None,
                        mode=args.mode,
                        stage=args.stage,
                    )

                    loss, _, _ = compute_loss(output, gaze_gt, heatmap_gt, args.stage)
                    val_loss_sum += loss.item()
                    val_batches += 1

            avg_train = epoch_loss / max(n_batches, 1)
            avg_val = val_loss_sum / max(val_batches, 1)
            lr = optimizer.param_groups[0]["lr"]

            # Update epoch bar
            postfix = {"train": f"{avg_train:.4f}", "val": f"{avg_val:.4f}", "lr": f"{lr:.1e}"}
            if args.stage == "joint":
                postfix["hmap"] = f"{epoch_h/max(n_batches,1):.4f}"
                postfix["gaze"] = f"{epoch_g/max(n_batches,1):.4f}"
            epoch_bar.set_postfix(postfix, refresh=True)

            saved = ""

            # --- Checkpoint (master only, then barrier) ---
            if is_master:
                ckpt = {"model": raw_model.state_dict(), "epoch": epoch, "val_loss": avg_val}

                if avg_val < best_val_loss:
                    best_val_loss = avg_val
                    torch.save(ckpt, save_dir / f"{args.save_name}_best.pt")
                    saved = " *best*"

                if (epoch + 1) % args.save_every == 0:
                    torch.save(ckpt, save_dir / f"{args.save_name}_epoch{epoch+1}.pt")
                    saved = saved or " saved"

            if saved and is_master:
                tqdm.write(f"  epoch {epoch+1:>3}  train={avg_train:.4f}  val={avg_val:.4f}{saved}")

            if use_ddp:
                dist.barrier(device_ids=[local_rank])

    finally:
        if is_master:
            print()
            print(f"  done. best val loss: {best_val_loss:.4f}")
            torch.save(
                {"model": raw_model.state_dict(), "epoch": args.epochs},
                save_dir / f"{args.save_name}_final.pt",
            )
            print(f"  saved to {save_dir / f'{args.save_name}_final.pt'}")
            print()

        cleanup_ddp()


if __name__ == "__main__":
    main()
