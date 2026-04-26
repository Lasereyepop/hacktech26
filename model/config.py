from dataclasses import dataclass, field


@dataclass
class UNetConfig:
    backbone: str = "resnet50"
    pretrained: bool = True
    input_size: int = 224
    bottleneck_dim: int = 256


@dataclass
class DecoderConfig:
    d_model: int = 256
    nhead: int = 8
    num_layers: int = 4
    dim_feedforward: int = 1024
    dropout: float = 0.1
    max_seq_len: int = 90


@dataclass
class TrainConfig:
    stage: str = "joint"  # "unet", "decoder", "joint"
    mode: str = "ad"  # "ad" or "ego"
    epochs: int = 50
    batch_size: int = 32
    lr_encoder: float = 1e-5
    lr_decoder: float = 1e-4
    weight_decay: float = 1e-4
    grad_clip: float = 10.0
    warmup_steps: int = 500
    num_workers: int = 4
    save_every: int = 5
    val_split: float = 0.05
    seq_len: int = 90
    fps: int = 30
    image_size: int = 224


@dataclass
class InferenceConfig:
    temperature: float = 0.02
    n_frames: int = 90
    ior_strength: float = 0.3
    ior_decay: float = 0.95
    ior_sigma: float = 0.05
    fixation_threshold: float = 0.02
    fps: int = 30
