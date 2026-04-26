import random
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset
from torchvision import transforms
from PIL import Image


class StaticGazeDataset(Dataset):
    """
    Loads preprocessed static image gaze samples with aggressive augmentation.
    Each real sample generates multiple augmented variants per epoch via:
    - Horizontal flip (gaze x → 1-x, heatmap flipped)
    - Random crop + rescale (gaze coords shifted/scaled to match)
    - Color jitter (brightness, contrast, saturation, hue)
    - Gaussian blur
    """

    def __init__(self, data_dir, image_size=224, augment=False):
        self.data_dir = Path(data_dir)
        self.files = []
        for f in sorted(self.data_dir.glob("*.npz")):
            data = np.load(str(f), allow_pickle=True)
            if data["frames"].shape[0] == 1:
                self.files.append(f)

        if not self.files:
            raise FileNotFoundError(f"No static image samples in {data_dir}")

        self.image_size = image_size
        self.augment = augment

        self.base_transform = transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        self.color_jitter = transforms.ColorJitter(
            brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05,
        )
        self.blur = transforms.GaussianBlur(kernel_size=5, sigma=(0.1, 1.5))

    def __len__(self):
        return len(self.files)

    def __getitem__(self, idx):
        data = np.load(str(self.files[idx]), allow_pickle=True)
        frame_np = data["frames"][0]  # (H, W, 3)
        gaze = data["gaze"].copy()    # (T, 2)
        heatmap = data["heatmap"].copy()  # (H, W)

        pil_img = Image.fromarray(frame_np)

        if self.augment:
            # Horizontal flip — 50% chance
            if random.random() < 0.5:
                pil_img = pil_img.transpose(Image.FLIP_LEFT_RIGHT)
                gaze[:, 0] = 1.0 - gaze[:, 0]
                heatmap = np.flip(heatmap, axis=1).copy()

            # Random crop (80-100% of image) — shift gaze to match
            if random.random() < 0.5:
                crop_frac = random.uniform(0.8, 1.0)
                w, h = pil_img.size
                cw, ch = int(w * crop_frac), int(h * crop_frac)
                left = random.randint(0, w - cw)
                top = random.randint(0, h - ch)

                pil_img = pil_img.crop((left, top, left + cw, top + ch))

                # Remap gaze coordinates into crop space
                gaze[:, 0] = (gaze[:, 0] * w - left) / cw
                gaze[:, 1] = (gaze[:, 1] * h - top) / ch
                gaze = np.clip(gaze, 0, 1)

                # Crop and resize heatmap to match
                hm_h, hm_w = heatmap.shape
                hm_left = int(left / w * hm_w)
                hm_top = int(top / h * hm_h)
                hm_cw = int(cw / w * hm_w)
                hm_ch = int(ch / h * hm_h)
                hm_cw = max(1, min(hm_cw, hm_w - hm_left))
                hm_ch = max(1, min(hm_ch, hm_h - hm_top))
                heatmap = heatmap[hm_top:hm_top + hm_ch, hm_left:hm_left + hm_cw]

            # Color jitter
            if random.random() < 0.8:
                pil_img = self.color_jitter(pil_img)

            # Gaussian blur
            if random.random() < 0.3:
                pil_img = self.blur(pil_img)

        frame_tensor = self.base_transform(pil_img)

        # Resize heatmap to standard size
        heatmap_pil = Image.fromarray((heatmap * 255).astype(np.uint8))
        heatmap_pil = heatmap_pil.resize((self.image_size, self.image_size), Image.BILINEAR)
        heatmap_tensor = torch.from_numpy(np.array(heatmap_pil).astype(np.float32) / 255.0).unsqueeze(0)

        gaze_tensor = torch.from_numpy(gaze).float()

        return frame_tensor, gaze_tensor, heatmap_tensor


class VideoGazeDataset(Dataset):
    """Loads video gaze samples with augmentation."""

    def __init__(self, data_dir, image_size=224, augment=False):
        self.data_dir = Path(data_dir)
        self.files = []
        for f in sorted(self.data_dir.glob("*.npz")):
            data = np.load(str(f), allow_pickle=True)
            if data["frames"].shape[0] > 1:
                self.files.append(f)

        if not self.files:
            raise FileNotFoundError(f"No video samples in {data_dir}")

        self.image_size = image_size
        self.augment = augment

        self.base_transform = transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        self.color_jitter = transforms.ColorJitter(
            brightness=0.2, contrast=0.2, saturation=0.1,
        )

    def __len__(self):
        return len(self.files)

    def __getitem__(self, idx):
        data = np.load(str(self.files[idx]), allow_pickle=True)
        frames_np = data["frames"]
        gaze = data["gaze"].copy()
        heatmap = data["heatmap"].copy()

        do_flip = self.augment and random.random() < 0.5
        do_color = self.augment and random.random() < 0.8

        processed = []
        for f in frames_np:
            pil_img = Image.fromarray(f)
            if do_flip:
                pil_img = pil_img.transpose(Image.FLIP_LEFT_RIGHT)
            if do_color:
                pil_img = self.color_jitter(pil_img)
            processed.append(self.base_transform(pil_img))

        if do_flip:
            gaze[:, 0] = 1.0 - gaze[:, 0]
            heatmap = np.flip(heatmap, axis=1).copy()

        frames_tensor = torch.stack(processed)
        gaze_tensor = torch.from_numpy(gaze).float()

        heatmap_pil = Image.fromarray((heatmap * 255).astype(np.uint8))
        heatmap_pil = heatmap_pil.resize((self.image_size, self.image_size), Image.BILINEAR)
        heatmap_tensor = torch.from_numpy(np.array(heatmap_pil).astype(np.float32) / 255.0).unsqueeze(0)

        return frames_tensor, gaze_tensor, heatmap_tensor
