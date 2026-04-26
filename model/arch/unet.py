import torch
import torch.nn as nn
import torchvision.models as models


class DecoderBlock(nn.Module):
    def __init__(self, in_ch, skip_ch, out_ch):
        super().__init__()
        self.up = nn.Upsample(scale_factor=2, mode="bilinear", align_corners=True)
        self.conv = nn.Sequential(
            nn.Conv2d(in_ch + skip_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )

    def forward(self, x, skip):
        x = self.up(x)
        if x.shape[2:] != skip.shape[2:]:
            x = nn.functional.interpolate(x, size=skip.shape[2:], mode="bilinear", align_corners=True)
        x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class GazeUNet(nn.Module):
    """
    UNet with ResNet-50 encoder for saliency prediction.
    Outputs both a heatmap and bottleneck features for the transformer decoder.
    """

    def __init__(self, backbone="resnet50", pretrained=True, bottleneck_dim=256):
        super().__init__()
        if backbone == "resnet50":
            resnet = models.resnet50(weights=models.ResNet50_Weights.DEFAULT if pretrained else None)
        elif backbone == "resnet18":
            resnet = models.resnet18(weights=models.ResNet18_Weights.DEFAULT if pretrained else None)
        else:
            raise ValueError(f"Unsupported backbone: {backbone}")

        self.stem = nn.Sequential(resnet.conv1, resnet.bn1, resnet.relu, resnet.maxpool)
        self.enc1 = resnet.layer1  # 256 ch (resnet50) / 64 ch (resnet18), stride 4
        self.enc2 = resnet.layer2  # 512 / 128, stride 8
        self.enc3 = resnet.layer3  # 1024 / 256, stride 16
        self.enc4 = resnet.layer4  # 2048 / 512, stride 32

        enc4_ch = 2048 if backbone == "resnet50" else 512
        enc3_ch = 1024 if backbone == "resnet50" else 256
        enc2_ch = 512 if backbone == "resnet50" else 128
        enc1_ch = 256 if backbone == "resnet50" else 64
        stem_ch = 64

        self.dec4 = DecoderBlock(enc4_ch, enc3_ch, 512)
        self.dec3 = DecoderBlock(512, enc2_ch, 256)
        self.dec2 = DecoderBlock(256, enc1_ch, 128)
        self.dec1 = DecoderBlock(128, stem_ch, 64)

        self.heatmap_conv = nn.Conv2d(64, 1, 1)

        self.bottleneck_proj = nn.Sequential(
            nn.Conv2d(enc4_ch, bottleneck_dim, 1, bias=False),
            nn.BatchNorm2d(bottleneck_dim),
            nn.ReLU(inplace=True),
        )

    def _heatmap(self, x, target_size):
        x = self.heatmap_conv(x)
        x = nn.functional.interpolate(x, size=target_size, mode="bilinear", align_corners=True)
        return torch.sigmoid(x)

    def encode(self, x):
        """Extract bottleneck features for the transformer decoder. Returns (B, H'*W', D)."""
        s0 = self.stem(x)
        s1 = self.enc1(s0)
        s2 = self.enc2(s1)
        s3 = self.enc3(s2)
        s4 = self.enc4(s3)

        feat = self.bottleneck_proj(s4)  # (B, D, H', W')
        B, D, H, W = feat.shape
        return feat.flatten(2).permute(0, 2, 1)  # (B, H'*W', D)

    def forward(self, x):
        """Returns (heatmap, bottleneck_features)."""
        input_size = x.shape[2:]  # (H, W)

        s0 = self.stem(x)
        s1 = self.enc1(s0)
        s2 = self.enc2(s1)
        s3 = self.enc3(s2)
        s4 = self.enc4(s3)

        d4 = self.dec4(s4, s3)
        d3 = self.dec3(d4, s2)
        d2 = self.dec2(d3, s1)
        d1 = self.dec1(d2, s0)

        heatmap = self._heatmap(d1, input_size)

        feat = self.bottleneck_proj(s4)
        B, D, H, W = feat.shape
        bottleneck = feat.flatten(2).permute(0, 2, 1)

        return heatmap, bottleneck
