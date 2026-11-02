"""Fetch GSI seamless aerial photo tiles and composite the login background.

Usage:  python gen_login_bg.py <out_file.webp> [--lat 36.255] [--lon 137.585] [--zoom 15] [--tiles 6] [--size 1536] [--quality 40]
Needs:  pillow   (pip install pillow; certifi optional, used for CA roots when present); network access only while this runs.

Source: 国土地理院 シームレス空中写真 (GSI seamlessphoto)
  https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg
The UI shows the credit 「出典: 国土地理院(シームレス空中写真)」 next to the image.
Default: a 6 x 6 tile block (1536 px) near Kamikochi at z=15, chosen so no seam between
survey years crosses the middle; quality 40 keeps the WebP around 450 KB (forest texture
compresses poorly).
Deterministic as long as the source tiles do not change.
"""
import argparse
import io
import math
import os
import ssl
import time
import urllib.request

from PIL import Image

TILE = 256
URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'
UA = 'rgcs-login-bg/1.0 (one-off asset build)'


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    y = (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n
    return x, y


def tls_context():
    try:
        import certifi  # some Python builds ship without system CA roots
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


CTX = tls_context()


def fetch(z, x, y):
    req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20, context=CTX) as res:
        return Image.open(io.BytesIO(res.read())).convert('RGB')


def build(lat, lon, z, tiles):
    cx, cy = tile_xy(lat, lon, z)
    x0, y0 = int(cx) - tiles // 2, int(cy) - tiles // 2
    out = Image.new('RGB', (tiles * TILE, tiles * TILE))
    for j in range(tiles):
        for i in range(tiles):
            out.paste(fetch(z, x0 + i, y0 + j), (i * TILE, j * TILE))
            time.sleep(0.05)  # be gentle with the tile server
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument('out')
    p.add_argument('--lat', type=float, default=36.255)
    p.add_argument('--lon', type=float, default=137.585)
    p.add_argument('--zoom', type=int, default=15)
    p.add_argument('--tiles', type=int, default=6)
    p.add_argument('--size', type=int, default=1536)
    p.add_argument('--quality', type=int, default=40)
    a = p.parse_args()
    img = build(a.lat, a.lon, a.zoom, a.tiles)
    if a.size != img.width:
        img = img.resize((a.size, a.size), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    img.save(a.out, quality=a.quality, method=6)
    print('wrote', a.out, os.path.getsize(a.out), 'bytes')


if __name__ == '__main__':
    main()
