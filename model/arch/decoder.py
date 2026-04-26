import math

import torch
import torch.nn as nn


def sinusoidal_2d(x, y, dim=256):
    """
    2D sinusoidal positional encoding for continuous (x, y) in [0, 1].
    Produces a (dim,) vector preserving spatial relationships.
    """
    quarter = dim // 4
    freqs = torch.exp(
        torch.arange(quarter, device=x.device, dtype=x.dtype)
        * -(math.log(10000.0) / quarter)
    )
    x_enc = torch.cat([torch.sin(x.unsqueeze(-1) * freqs), torch.cos(x.unsqueeze(-1) * freqs)], dim=-1)
    y_enc = torch.cat([torch.sin(y.unsqueeze(-1) * freqs), torch.cos(y.unsqueeze(-1) * freqs)], dim=-1)
    return torch.cat([x_enc, y_enc], dim=-1)


class GazeDecoder(nn.Module):
    """
    Autoregressive transformer decoder for gaze sequence prediction.
    Cross-attends to UNet bottleneck features, self-attends over gaze history.
    """

    def __init__(self, d_model=256, nhead=8, num_layers=4, dim_feedforward=1024,
                 dropout=0.1, max_seq_len=90):
        super().__init__()
        self.d_model = d_model
        self.max_seq_len = max_seq_len

        self.gaze_proj = nn.Linear(d_model, d_model)
        self.bos_token = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)

        self.temporal_pos = nn.Parameter(torch.randn(1, max_seq_len + 1, d_model) * 0.02)

        decoder_layer = nn.TransformerDecoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerDecoder(decoder_layer, num_layers=num_layers)
        self.output_head = nn.Linear(d_model, 2)

        self._init_weights()

    def _init_weights(self):
        nn.init.xavier_uniform_(self.gaze_proj.weight)
        nn.init.zeros_(self.gaze_proj.bias)
        nn.init.xavier_uniform_(self.output_head.weight)
        nn.init.zeros_(self.output_head.bias)

    def encode_gaze(self, x, y):
        """Encode (x, y) gaze coordinates into token embeddings. x, y: (B, T)."""
        raw = sinusoidal_2d(x, y, self.d_model)  # (B, T, D)
        return self.gaze_proj(raw)

    def forward(self, memory, gaze_x, gaze_y, noise_std=0.0):
        """
        Training forward pass with teacher forcing.
        memory: (B, S, D) from UNet bottleneck
        gaze_x, gaze_y: (B, T) ground truth coordinates [0, 1]
        noise_std: if > 0, add Gaussian noise to teacher forcing tokens.
            Simulates the imperfect inputs the model sees at inference,
            closing the train/inference gap.
        Returns: predicted (x, y) at each step, shape (B, T, 2)
        """
        B, T = gaze_x.shape
        device = gaze_x.device

        if noise_std > 0 and self.training:
            gaze_x = (gaze_x + torch.randn_like(gaze_x) * noise_std).clamp(0, 1)
            gaze_y = (gaze_y + torch.randn_like(gaze_y) * noise_std).clamp(0, 1)

        gaze_tokens = self.encode_gaze(gaze_x, gaze_y)  # (B, T, D)
        bos = self.bos_token.expand(B, -1, -1)
        tokens = torch.cat([bos, gaze_tokens[:, :-1]], dim=1)  # shift right

        tokens = tokens + self.temporal_pos[:, :T, :]

        causal_mask = nn.Transformer.generate_square_subsequent_mask(T, device=device)

        out = self.transformer(
            tgt=tokens,
            memory=memory,
            tgt_mask=causal_mask,
            tgt_is_causal=True,
        )

        return torch.sigmoid(self.output_head(out))  # (B, T, 2) in [0, 1]

    @torch.no_grad()
    def generate(self, memory, n_steps, temperature=0.02):
        """
        Autoregressive inference. Generates one (x, y) per step.
        memory: (B, S, D) from UNet bottleneck
        Returns: (B, n_steps, 2)
        """
        B = memory.shape[0]
        device = memory.device

        tokens = self.bos_token.expand(B, -1, -1)  # (B, 1, D)
        predictions = []

        for t in range(n_steps):
            pos_tokens = tokens + self.temporal_pos[:, :tokens.shape[1], :]

            out = self.transformer(
                tgt=pos_tokens,
                memory=memory,
            )

            xy = torch.sigmoid(self.output_head(out[:, -1:, :]))  # (B, 1, 2)

            if temperature > 0:
                xy = xy + torch.randn_like(xy) * temperature
                xy = xy.clamp(0, 1)

            predictions.append(xy)

            new_token = self.encode_gaze(xy[:, :, 0], xy[:, :, 1])
            tokens = torch.cat([tokens, new_token], dim=1)

        return torch.cat(predictions, dim=1)  # (B, n_steps, 2)
