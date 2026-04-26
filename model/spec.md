# Gaze Sequence Prediction Model — Technical Specification

**Version:** 2.0  
**Date:** April 2026  
**Status:** Hackathon Prototype

---

## 1. Problem Statement

Given an input visual scene (static image or video clip), predict a plausible human gaze sequence as a frame-aligned trajectory:

```
S = [(x₁, y₁), (x₂, y₂), ..., (xₙ, yₙ)]
```

Where:
- `(xᵢ, yᵢ)` is the normalized gaze coordinate at frame i, in [0, 1]
- `n` is the total number of frames in the sequence
- Each index corresponds to exactly one frame

Dwell time is implicitly encoded: consecutive frames with similar `(x, y)` values represent a fixation. Dwell time is recovered via post-processing by clustering consecutive similar coordinates.

The model must answer three questions about any visual input:
1. **What does the viewer look at first?** (first fixation location)
2. **Where does attention move next, and in what order?** (scanpath sequence)
3. **How long does the viewer dwell on each region?** (fixation duration derived from frame clustering)

The predictions must be moderately believable — spatially landing on meaningful regions, with a plausible viewing order and realistic fixation/saccade dynamics.

---

## 2. Use Cases

### 2.1 Advertisement and Webpage Analysis

**Input:** Static image of an ad, UI design, or webpage

**Output:**
- Saliency heatmap showing aggregate attention distribution
- Animated scanpath showing temporal order and duration of fixations
- Derived metrics: time-to-first-fixation per element, attention coverage, fixation order

**Questions it answers:**
- Does the user see the CTA button before they disengage?
- Is the headline or the hero image capturing first fixation?
- Does the logo register at all in a typical scanpath?

### 2.2 Egocentric Task Viewing

**Input:** First-person video of a person performing a physical task

**Output:**
- Predicted gaze sequence over subsequent frames
- Implicit signal of intended next action (gaze leads action by 1-2 seconds)

**Questions it answers:**
- Where does the person look before reaching for an object?
- Can gaze predict the next manipulation step?

---

## 3. Architecture

### 3.1 Overview

Two components: a spatial encoder that understands *where is salient*, and a temporal decoder that learns *in what order and for how long humans look there*.

```
Image / Frame → UNet Encoder → Spatial Feature Map F (H' × W' × D)
                                        ↓
BOS token → Transformer Decoder (cross-attends to F)
              → (x₁,y₁), (x₂,y₂), ..., (xₙ,yₙ)
                                        ↓
              post-process → fixation order + dwell times
```

### 3.2 Module 1: UNet Spatial Encoder

**Architecture:** UNet with a pretrained CNN backbone (ResNet-50 or EfficientNet)

**Input:** Single RGB frame, resized to (H × W × 3)

**Output:**
- Saliency heatmap (H × W × 1), values in [0, 1] — used directly for the heatmap visualization
- Bottleneck spatial features (H' × W' × D) — fed to the decoder via cross-attention

This is the proven component. The UNet's encoder-decoder structure with skip connections preserves fine-grained spatial detail needed for dense saliency prediction. We've already validated that this converges quickly on our data.

For the decoder, we extract features from the UNet bottleneck (or an intermediate decoder layer) rather than just the final heatmap. This gives the transformer decoder a richer representation to cross-attend to — not just "how salient" but "what kind of region" (text, face, hand, object).

**Static image handling:** For static images (ads/webpages), the UNet processes the single image once and produces one spatial feature map. The decoder autoregressively generates T gaze steps from that single feature map. No frame replication needed — the image doesn't change, so the features don't change.

**Video handling:** For egocentric video, the UNet processes each frame independently. The decoder cross-attends to the spatial features of the *current* frame at each decoding step, allowing gaze predictions to follow the changing scene. At training time, each step t cross-attends to the UNet features of frame t.

### 3.3 Module 2: Transformer Decoder

**Architecture:** Autoregressive transformer decoder, 4 layers, 8 attention heads, D=256

Intentionally small. The UNet does the heavy lifting on spatial understanding; the decoder only needs to learn temporal dynamics — fixation stability, saccade transitions, and viewing order patterns.

**Input:**
- Spatial features from the UNet bottleneck (via cross-attention). Use the bottleneck specifically (e.g., 16x16xD) — it has rich semantic features. Near-output layers are saliency-tuned and may collapse to "one bright blob" which is bad for cross-attention diversity.
- Sequence of previous gaze tokens (via causal self-attention)

**Output:** Next frame's gaze coordinate `(x, y)`

**Token representation:**

Each gaze position is encoded via 2D sinusoidal positional encoding projected to the model dimension:

```python
gaze_token = linear(sinusoidal_2d(x, y))  # continuous, no quantization
```

The first input is a learned BOS (beginning-of-sequence) token. The decoder learns from data what typical first fixations look like conditioned on this token and the visual features.

**What the decoder learns:**
- **Fixation stability:** producing nearly identical `(x, y)` across consecutive steps when dwelling
- **Saccade transitions:** producing large coordinate jumps to semantically related regions
- **Inhibition of return:** avoiding recently fixated regions (emerges from self-attention over gaze history)
- **Viewing order patterns:** headlines before body text, faces before background, etc.

**Known risk — static image fixation sticking:** On static images, the cross-attended features never change between decoder steps. The only signals driving gaze progression are self-attention over gaze history and sequence position. If the model doesn't learn strong enough IOR from data, it may get stuck on the most salient point indefinitely. Real human scanpaths in the training data do progress, so the training signal exists — but as a safety net, apply inference-time IOR suppression (see §6.1).

### 3.4 Two Decoder Heads

The UNet encoder is shared. Two separate decoder heads (identical architecture, independent weights):

1. **Ad/Webpage decoder** — trained on static image viewing data
2. **Egocentric decoder** — trained on first-person task video data

These modes have different gaze dynamics: static image viewing is bottom-up (driven by visual salience and layout), egocentric viewing is top-down (driven by task intent and motor planning). Separate decoders let each specialize without conflicting gradients.

At inference, select the decoder based on input type. Train whichever head's data is ready first.

---

## 4. Data

### 4.1 Format

Every training sample is a pair:
- `frames`: video or static image frames, shape `(T, H, W, 3)`
- `gaze`: frame-aligned gaze coordinates, shape `(T, 2)`, each row `(x, y)` normalized to [0, 1]

```python
gaze = np.load("gaze.npy")  # shape (T, 2)
# gaze[i] = (x, y) of where the eye was at frame i
# gaze[5:14] all being ~(0.42, 0.31) means a ~300ms fixation at 30fps
```

Format is identical for both modes. The only difference is the data source.

### 4.2 Static Image Data (Ads/Webpages)

Sources: eye tracking datasets over UI screenshots, ads, web pages (SALICON, MIT1003, CAT2000, FiWI, MASSVIS, or proprietary).

Each sample is a single image plus a `(T, 2)` gaze trace from one participant's recorded scan. At training time, the UNet encodes the image once; the decoder sees the same feature map at every step. Multiple participants viewing the same image are stored as separate training samples.

### 4.3 Egocentric Data

Sources: egocentric video with gaze annotations (Ego4D, EGTEA Gaze+, EPIC-Kitchens, or lab-collected).

Longer sequences are windowed into fixed-length chunks of T frames with 50% overlap.

### 4.4 Preprocessing

- All gaze coordinates normalized to [0, 1] relative to stimulus dimensions
- Canonical sequence length T = 90 frames (3 seconds at 30fps) for training and demo. 3 seconds is enough to show 3-5 distinct fixations — sufficient to answer "what first, what second, what third." Shorter sequences also reduce exposure bias at inference (see §6.1).
- Shorter recordings: zero-padded with a padding mask
- Longer recordings: sliding window, 50% overlap
- Raw gaze traces include both fixations and saccades — model learns both from the data, no separation needed

---

## 5. Training

### 5.1 Loss Function

**Primary: L1 loss on (x, y) coordinates.**

```
L = |x_pred - x_gt| + |y_pred - y_gt|
```

Simple, fast convergence, no hyperparameter tuning on sigma.

**Known limitation:** L1 is mean-seeking. When multiple plausible fixation targets exist, the prediction can drift toward the centroid rather than committing to one target. In practice, the cross-attention to UNet features mitigates this — the decoder is conditioned on "where is salient" and tends to snap to actual salient regions rather than averaging between them.

**If L1 produces overly smooth trajectories** (no sharp saccades, center-drifting predictions), upgrade to Gaussian NLL with clamped sigma:

```
L = -log N((x,y) | mu, sigma)
sigma = clamp(predicted_sigma, min=0.01, max=0.15)
```

The clamp prevents sigma collapse (degenerate point predictions) and sigma explosion (uniform predictions). Try L1 first.

### 5.2 Gaze Noise as Implicit Regularization

Raw gaze data from eye trackers is inherently noisy — measurement jitter, microsaccades, and drift mean that even during a stable fixation, consecutive `(x, y)` values are slightly different. This noise is present in the training targets and is **not cleaned out**. This has three beneficial effects:

1. **Natural scheduled sampling.** During teacher forcing, the decoder receives ground truth gaze tokens as input — but those tokens are noisy. The model is trained on slightly perturbed inputs at every step, which partially closes the train/inference distribution gap without any explicit scheduled sampling. The model learns to be robust to small input perturbations because the training data *is* small input perturbations.

2. **Learned stochasticity.** The model is trained to reproduce noisy trajectories, so its outputs will have natural variance. Artificial noise injection at inference (temperature parameter) may need to be very low or zero — the learned behavior is already stochastic.

3. **L1 robustness.** L1 loss finds the spatial median of the noise distribution around each fixation, which for symmetric tracker jitter is the true fixation center. The noise doesn't degrade the loss signal.

**Implication for post-processing:** the `spatial_threshold` in `derive_fixations` (§6.2) must be set larger than the tracker noise floor, otherwise noise jitter will fragment a single fixation into many micro-fixations. A threshold of 0.02 (2% of image dimension) is a reasonable default — typical tracker noise at screen distance is well within this.

### 5.3 Teacher Forcing

During training, the decoder receives ground truth gaze tokens as input at each step. As noted above, the inherent noise in gaze data provides implicit robustness to input perturbation. Explicit scheduled sampling is not needed for v1.

### 5.3 Optimizer and Schedule

- Optimizer: AdamW, weight decay 1e-4
- Learning rate: 1e-4 for decoder, 1e-5 for UNet (preserve spatial features while adapting)
- Schedule: cosine annealing with 500 steps warmup
- Batch size: 32 sequences (reduce if GPU memory constrained)
- Expected convergence: UNet is proven fast; decoder is small (4 layers) and should converge within 20-30 epochs

### 5.4 Training Order

1. Train the UNet on saliency heatmap supervision (MSE or BCE against ground truth heatmaps derived from gaze fixation density). This can be done independently and is already proven.
2. Freeze or lightly fine-tune the UNet. Train the decoder on top, using UNet features via cross-attention.
3. Train whichever decoder head's data is ready first. The second head can be added later with zero changes to the architecture.

---

## 6. Inference

### 6.1 Pipeline

```python
def predict_scanpath(image_or_video, mode, n_frames=90, temperature=0.02):
    # Step 1: Spatial features from UNet
    if is_static_image(image_or_video):
        features = unet.encode(image_or_video)        # single feature map
        heatmap = unet.decode_heatmap(features)
        get_features = lambda t: features               # same features every step
    else:
        get_features = lambda t: unet.encode(image_or_video[t])
        heatmap = unet.decode_heatmap(unet.encode(image_or_video[0]))

    # Step 2: Select decoder
    decoder = ad_decoder if mode == "ad" else egocentric_decoder

    # Step 3: Autoregressive decoding with IOR safety net
    tokens = [BOS_token]
    gaze_sequence = []
    ior_map = torch.zeros_like(heatmap)  # tracks recently fixated regions

    for t in range(n_frames):
        # Suppress recently visited regions in features for static images
        effective_features = get_features(t)
        if is_static_image(image_or_video) and t > 0:
            effective_features = apply_ior_suppression(effective_features, ior_map)

        x, y = decoder(effective_features, tokens)
        # Add small noise for stochasticity
        x += torch.randn(1) * temperature
        y += torch.randn(1) * temperature
        x, y = clamp(x, 0, 1), clamp(y, 0, 1)
        gaze_sequence.append((x, y))
        tokens.append(encode_gaze(x, y))

        # Update IOR map: Gaussian blob at fixation, decaying over time
        ior_map = ior_map * 0.95  # decay previous fixations
        ior_map += gaussian_blob(x, y, sigma=0.05)

    return gaze_sequence, heatmap


def apply_ior_suppression(features, ior_map, strength=0.3):
    """
    Soft suppression — reduces activation at recently fixated locations.
    Only kicks in meaningfully if the decoder is stuck (IOR map concentrated).
    strength=0.3 is gentle enough to not override learned behavior.
    """
    suppression = 1.0 - strength * normalize(ior_map)
    return features * suppression.unsqueeze(-1)
```

**Stochastic sampling:** We add small Gaussian noise scaled by a temperature parameter at inference. `temperature=0` gives the deterministic (but already slightly variable, since the model learned from noisy gaze data) sequence. `temperature=0.01-0.03` adds additional diversity for generating multiple plausible scanpaths from the same input. Keep temperature low — the model already learned natural gaze variance from the noisy training targets; additional noise is just for inter-run diversity, not realism.

**IOR safety net:** For static images, if the learned decoder fails to move the gaze (gets stuck on the most salient point), the IOR suppression gently reduces feature activation at recently fixated locations, nudging the decoder toward new regions. The 0.95 decay means old fixations recover over ~20 steps, so the model can revisit regions after sufficient time — matching real human behavior. This is a safety net, not a crutch: if the decoder learns good IOR from data, the suppression map stays diffuse and has minimal effect.

### 6.2 Post-Processing: Deriving Fixations

```python
def derive_fixations(gaze_sequence, fps=30, spatial_threshold=0.02):
    """
    Cluster raw frame-level gaze into discrete fixation events.
    This is how we answer "what first, what second, how long."
    """
    fixations = []
    cluster = [gaze_sequence[0]]
    for point in gaze_sequence[1:]:
        if dist(point, cluster[-1]) < spatial_threshold:
            cluster.append(point)
        else:
            cx = mean(p[0] for p in cluster)
            cy = mean(p[1] for p in cluster)
            dwell_ms = len(cluster) / fps * 1000
            fixations.append((cx, cy, dwell_ms))
            cluster = [point]
    # don't forget the last cluster
    cx = mean(p[0] for p in cluster)
    cy = mean(p[1] for p in cluster)
    dwell_ms = len(cluster) / fps * 1000
    fixations.append((cx, cy, dwell_ms))
    return fixations
```

### 6.3 Output Format (API → Frontend)

```json
{
  "heatmap": "base64_encoded_png",
  "gaze_sequence": [
    {"frame": 0, "x": 0.42, "y": 0.31},
    {"frame": 1, "x": 0.42, "y": 0.30},
    ...
  ],
  "fixations": [
    {"x": 0.42, "y": 0.31, "dwell_ms": 280, "fixation_index": 1},
    {"x": 0.61, "y": 0.18, "dwell_ms": 190, "fixation_index": 2},
    ...
  ]
}
```

Coordinates are normalized [0, 1] — the frontend scales to any display size.

---

## 7. Evaluation

### 7.1 Spatial Accuracy

- **NSS (Normalized Scanpath Saliency):** do predicted fixations land on actually salient regions?
- **AUC-Judd:** ROC-based spatial accuracy of fixation locations

### 7.2 Sequence Plausibility

- **ScanMatch (DTW-based):** similarity between predicted and ground truth scanpath sequences, accounting for spatial and temporal alignment. Primary metric.
- **MultiMatch:** breaks scanpath similarity into shape, direction, length, position, duration — useful for diagnosing what's wrong if sequences look off.

### 7.3 Sanity Checks (Hackathon-Grade)

Before formal metrics, visually verify:
- First fixation lands on the most salient region (face, headline, bright object)
- Sequence visits 3-5 distinct regions, not just one
- Dwell times are in a realistic range (150-500ms per fixation)
- Saccades are sharp jumps, not slow drifts
- Repeated runs with temperature > 0 produce different but plausible paths

---

## 8. Fallback: Heuristic Scanpath Generator

If the learned decoder fails to train well or produces degenerate sequences, this ~50-line module produces believable scanpaths from the UNet heatmap alone, with no decoder needed. The product story is unchanged — heatmap in, animated scanpath out.

```python
def heuristic_scanpath(heatmap, n_fixations=5, fps=30):
    """
    Sample scanpath directly from the saliency heatmap with explicit IOR.
    No learned decoder required.
    """
    h, w = heatmap.shape
    ior_mask = np.ones_like(heatmap)
    gaze_sequence = []

    for i in range(n_fixations):
        # Weight by saliency * IOR mask
        prob = heatmap * ior_mask
        prob = prob / prob.sum()

        # Sample fixation location
        idx = np.random.choice(h * w, p=prob.flatten())
        fy, fx = idx // w, idx % w
        cx, cy = fx / w, fy / h

        # Sample dwell time from realistic distribution (200-450ms)
        dwell_ms = np.random.uniform(200, 450)
        n_frames = int(dwell_ms / 1000 * fps)

        # Add frames for this fixation with small jitter
        for _ in range(n_frames):
            jx = cx + np.random.normal(0, 0.005)
            jy = cy + np.random.normal(0, 0.005)
            gaze_sequence.append((np.clip(jx, 0, 1), np.clip(jy, 0, 1)))

        # Apply IOR: suppress Gaussian around fixation
        yy, xx = np.mgrid[0:h, 0:w]
        gaussian = np.exp(-((xx/w - cx)**2 + (yy/h - cy)**2) / (2 * 0.06**2))
        ior_mask *= (1 - 0.8 * gaussian)

    return gaze_sequence
```

This is insurance. If the learned model works, this is never used. If the learned model produces garbage at 3am before the demo, swap this in and the frontend still gets a valid scanpath.

---

## 9. MVP Milestones

**Training sequence length:** T=90 frames (3 seconds at 30fps)

### Must-Have (working demo)

1. UNet trained, producing heatmaps on input images/frames
2. One decoder head trained (whichever data is ready first)
3. End-to-end inference: image in → scanpath + heatmap out
4. Frontend renders animated scanpath over the input image
5. Fixation order and dwell times displayed

### Nice-to-Have

- Second decoder head trained
- Multiple scanpath sampling (run inference N times, show variance)
- Derived metrics dashboard (time-to-first-fixation, attention coverage)

### Training Priority

Train the data type that's ready first. The second decoder head is identical architecture with independent weights — adding it later requires zero changes to anything else.

---

## 10. Limitations and Known Risks

- **Exposure bias (low-medium risk):** teacher forcing means the model never sees its own errors during training, but inherent gaze noise in the training targets provides implicit robustness to input perturbation (§5.2). Over 90 steps, errors can still compound. If sequences degrade in later frames, shorten to 60 frames.
- **Static image fixation sticking (medium risk for ad/UI mode):** on static images, constant features may cause the decoder to fixate indefinitely. The IOR safety net (§6.1) mitigates this. If it's still bad, the heuristic fallback (§8) replaces the decoder entirely.
- **L1 mean-seeking (low-medium risk):** if predictions drift toward image center or saccades become slow drifts, upgrade to Gaussian NLL with clamped sigma (§5.1).
- **Per-frame UNet:** processes frames independently with no temporal context. Cannot anticipate scene changes in fast-moving egocentric video.
- **Population-average prediction:** predicts typical gaze patterns, not individual differences.
