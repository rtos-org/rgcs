#!/usr/bin/env bash
# Builds the Raspberry Pi artifacts into dist/pi/:
#   rgcs-server  aarch64, release, UI embedded (feature embed-ui)
#   siyi_sim     aarch64 MT11 simulator (for the Docker Pi equivalent)
#   hang-server  aarch64 test fixture (tests/pi/fixtures/hang-server.c)
#   VERSION      <crate version>+<git sha>
#   rgcs-pi-<version>.tar.gz  rgcs-server + install.sh + unit + config example (copy to the Pi,
#                extract, `sudo ./install.sh`)
# The UI is built on the host (platform independent); Rust builds natively in a
# linux/arm64 rust:bookworm container with cargo caches in named volumes, so the host
# target/ directory is not touched.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist/pi"
IMAGE=rgcs-build-arm64

echo "[build-pi] UI"
(cd "$ROOT/apps/rgcs-server/ui" && npm run build >/dev/null)

echo "[build-pi] build image"
docker build -q --platform linux/arm64 -t "$IMAGE" -f "$ROOT/deploy/docker/build.Dockerfile" "$ROOT/deploy/docker" >/dev/null

sha="$(git -C "$ROOT" rev-parse --short HEAD)"
git -C "$ROOT" diff --quiet HEAD -- . ':!dist' 2>/dev/null || sha="$sha-dirty"
echo "[build-pi] cargo build --release (aarch64), build $sha"
docker run --rm --platform linux/arm64 \
  -v "$ROOT:/src" \
  -v rgcs-cargo-registry:/usr/local/cargo/registry \
  -v rgcs-target-arm64:/target \
  -e CARGO_TARGET_DIR=/target \
  -e CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=gcc \
  -e RGCS_BUILD="$sha" \
  "$IMAGE" sh -c '
    export RUSTUP_TOOLCHAIN="$(rustup default | cut -d" " -f1)" &&
    cargo build --release --locked -p rgcs-server --features embed-ui &&
    cargo build --release --locked -p rgcs-camera --features sim --example siyi_sim &&
    mkdir -p /src/dist/pi &&
    cp /target/release/rgcs-server /src/dist/pi/rgcs-server.new &&
    cp /target/release/examples/siyi_sim /src/dist/pi/siyi_sim.new &&
    mv -f /src/dist/pi/rgcs-server.new /src/dist/pi/rgcs-server &&
    mv -f /src/dist/pi/siyi_sim.new /src/dist/pi/siyi_sim &&
    gcc -O2 -o /src/dist/pi/hang-server.new /src/tests/pi/fixtures/hang-server.c &&
    mv -f /src/dist/pi/hang-server.new /src/dist/pi/hang-server'

version=$(grep -m1 '^version' "$ROOT/Cargo.toml" | sed 's/.*"\(.*\)"/\1/')
echo "$version+$sha" >"$OUT/VERSION"
ver="$(cat "$OUT/VERSION")"
PKG="$OUT/rgcs-pi-$ver"
rm -f "$OUT"/rgcs-pi-*.tar.gz
rm -rf "$PKG" && mkdir -p "$PKG"
cp "$OUT/rgcs-server" "$OUT/VERSION" "$ROOT/deploy/install.sh" "$ROOT/deploy/rgcs-server.service" \
   "$ROOT/deploy/config.toml.example" "$PKG/"
tar -C "$OUT" -czf "$PKG.tar.gz" "rgcs-pi-$ver" && rm -rf "$PKG"
echo "[build-pi] done: $ver -> $OUT (package rgcs-pi-$ver.tar.gz)"
