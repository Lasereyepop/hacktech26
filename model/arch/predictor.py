import torch
import torch.nn as nn

from .unet import GazeUNet
from .decoder import GazeDecoder
from ..config import UNetConfig, DecoderConfig


class GazePredictor(nn.Module):
    """
    Full gaze prediction model: UNet encoder + transformer decoder.
    Supports two decoder heads (ad/webpage and egocentric).

    forward() is DDP-safe — all training stages route through it so that
    DistributedDataParallel's AllReduce hooks fire correctly.
    """

    def __init__(self, unet_cfg=None, decoder_cfg=None):
        super().__init__()
        unet_cfg = unet_cfg or UNetConfig()
        decoder_cfg = decoder_cfg or DecoderConfig()

        self.unet = GazeUNet(
            backbone=unet_cfg.backbone,
            pretrained=unet_cfg.pretrained,
            bottleneck_dim=unet_cfg.bottleneck_dim,
        )

        self.ad_decoder = GazeDecoder(
            d_model=decoder_cfg.d_model,
            nhead=decoder_cfg.nhead,
            num_layers=decoder_cfg.num_layers,
            dim_feedforward=decoder_cfg.dim_feedforward,
            dropout=decoder_cfg.dropout,
            max_seq_len=decoder_cfg.max_seq_len,
        )

        self.ego_decoder = GazeDecoder(
            d_model=decoder_cfg.d_model,
            nhead=decoder_cfg.nhead,
            num_layers=decoder_cfg.num_layers,
            dim_feedforward=decoder_cfg.dim_feedforward,
            dropout=decoder_cfg.dropout,
            max_seq_len=decoder_cfg.max_seq_len,
        )

    def get_decoder(self, mode):
        return self.ad_decoder if mode == "ad" else self.ego_decoder

    def forward(self, images, gaze_x=None, gaze_y=None, mode="ad", stage="joint", noise_std=0.0):
        """
        DDP-safe forward for all training stages.

        stage="unet":    returns {"heatmap": Tensor}
        stage="decoder": returns {"gaze": Tensor}
        stage="joint":   returns {"heatmap": Tensor, "gaze": Tensor}

        Always call this through the DDP wrapper (never model.module.xxx).
        """
        is_video = images.dim() == 5

        if is_video:
            B, T, C, H, W = images.shape
            unet_input = images[:, 0]  # heatmap from first frame
            flat = images.reshape(B * T, C, H, W)
            heatmap, _ = self.unet(unet_input)
            _, bottleneck = self.unet(flat)
            S, D = bottleneck.shape[1], bottleneck.shape[2]
            bottleneck = bottleneck.reshape(B, T * S, D)
        else:
            heatmap, bottleneck = self.unet(images)

        result = {}

        if stage in ("unet", "joint"):
            result["heatmap"] = heatmap

        if stage in ("decoder", "joint") and gaze_x is not None:
            decoder = self.get_decoder(mode)
            result["gaze"] = decoder(bottleneck, gaze_x, gaze_y, noise_std=noise_std)

        return result

    @torch.no_grad()
    def predict(self, images, mode="ad", n_steps=90, temperature=0.02):
        """
        Inference: generate a gaze scanpath.
        images: (B, 3, H, W) for static, (B, T, 3, H, W) for video
        Returns: gaze_sequence (B, n_steps, 2), heatmap (B, 1, H, W)
        """
        self.eval()

        if images.dim() == 5:
            heatmap, _ = self.unet(images[:, 0])
            B, T, C, H, W = images.shape
            flat = images.reshape(B * T, C, H, W)
            _, bottleneck = self.unet(flat)
            S, D = bottleneck.shape[1], bottleneck.shape[2]
            bottleneck = bottleneck.reshape(B, T * S, D)
        else:
            heatmap, bottleneck = self.unet(images)

        decoder = self.get_decoder(mode)
        gaze_seq = decoder.generate(bottleneck, n_steps, temperature)

        return gaze_seq, heatmap
