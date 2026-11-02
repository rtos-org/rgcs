"""Generate the RGCS login cloud layers (uniform cover, two densities, day + dusk).

Usage:  python gen_clouds.py <out_dir>
Needs:  numpy, pillow   (pip install numpy pillow)

Outputs (1600x1000 RGBA WebP, ~230-250 KB each):
  cloud_thin_day.webp   cloud_dense_day.webp    -> light theme (10 · Daylight)
  cloud_thin_dusk.webp  cloud_dense_dusk.webp   -> dark theme  (09 · 3D Terrain)
Deterministic: fixed seeds, so re-running gives the same images.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

W, H = 1600, 1000


def bandpass(rng, beta, fmin):
    """1/f^beta noise with the lowest frequencies removed, so coverage is even (no big hole)."""
    n = rng.standard_normal((H, W))
    F = np.fft.fft2(n)
    fy = np.fft.fftfreq(H)[:, None]
    fx = np.fft.fftfreq(W)[None, :]
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1
    F = F / f ** beta
    F[f < fmin] = 0
    o = np.real(np.fft.ifft2(F))
    lo, hi = np.percentile(o, 1), np.percentile(o, 99)
    return np.clip((o - lo) / (hi - lo), 0, 1)


def layer(seed, thresh, soft, beta, fmin, tone, add, path):
    rng = np.random.default_rng(seed)
    base = bandpass(rng, beta, fmin)
    n = base * 0.92 + bandpass(rng, 1.7, 1 / 120) * 0.08
    dens = np.clip((n - thresh) / soft, 0, 1) ** 0.85
    gy, _ = np.gradient(base)
    light = np.clip(0.97 + gy * 140, 0.86, 1.0) * (0.95 + 0.05 * dens)  # soft top light
    rgb = np.stack([tone[i] * light + add[i] for i in range(3)], -1)
    rgb_img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").filter(ImageFilter.GaussianBlur(6))
    alpha = Image.fromarray(np.clip(dens * 255, 0, 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(8))
    img = rgb_img.convert("RGBA")
    img.putalpha(alpha)
    img.save(path, quality=78)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    palettes = {
        "day": ((235, 240, 248), (18, 14, 7)),      # near-white, faint blue
        "dusk": ((118, 132, 152), (20, 24, 34)),    # blue-grey for the dark theme
    }
    for name, (tone, add) in palettes.items():
        layer(41, 0.30, 0.32, 2.3, 1 / 520, tone, add, os.path.join(out, f"cloud_dense_{name}.webp"))
        layer(57, 0.46, 0.36, 2.1, 1 / 320, tone, add, os.path.join(out, f"cloud_thin_{name}.webp"))
    print("wrote 4 files to", out)


if __name__ == "__main__":
    main()
