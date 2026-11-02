#!/usr/bin/env bash
# The Pi binary is an aarch64 ELF, runs on plain Debian bookworm (glibc <= 2.36)
# and answers --version without a config file. Prints "CHECK build: OK" or FAIL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/dist/pi/rgcs-server"
fail() { echo "FAIL: $*"; exit 1; }

[ -x "$BIN" ] || fail "missing $BIN (run scripts/build-pi.sh)"
file "$BIN" | grep -q 'ARM aarch64' || fail "not an aarch64 ELF: $(file "$BIN")"
[ -x "$ROOT/dist/pi/siyi_sim" ] || fail "missing dist/pi/siyi_sim"
out=$(docker run --rm --platform linux/arm64 -v "$ROOT/dist/pi:/d:ro" debian:bookworm-slim /d/rgcs-server --version)
echo "    $out"
echo "$out" | grep -Eq '^rgcs-server [0-9]+\.[0-9]+\.[0-9]+ \([0-9a-f]{7,}(-dirty)?\)$' || fail "--version must carry the build id: $out"
[ "$out" = "rgcs-server $(cat "$ROOT/dist/pi/VERSION" | sed 's/+/ (/; s/$/)/')" ] || fail "--version ($out) != VERSION ($(cat "$ROOT/dist/pi/VERSION"))"
[ -x "$ROOT/dist/pi/hang-server" ] && file "$ROOT/dist/pi/hang-server" | grep -q 'ARM aarch64' || fail "missing aarch64 dist/pi/hang-server test fixture"
max=$(docker run --rm --platform linux/arm64 -v "$ROOT/dist/pi:/d:ro" rgcs-build-arm64 \
  sh -c "objdump -T /d/rgcs-server | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1")
echo "    highest glibc symbol: $max"
[ "$(printf '%s\nGLIBC_2.36\n' "$max" | sort -V | tail -1)" = "GLIBC_2.36" ] || fail "needs $max (> bookworm's 2.36)"
size=$(wc -c <"$BIN" | tr -d ' ')
echo "    size: $((size / 1024 / 1024)) MB"
pkg=$(find "$ROOT/dist/pi" -maxdepth 1 -name "rgcs-pi-*.tar.gz" | sort | tail -1)
[ -n "$pkg" ] || fail "no rgcs-pi-*.tar.gz package"
for f in rgcs-server install.sh rgcs-server.service config.toml.example VERSION; do
  tar -tzf "$pkg" | grep -q "/$f$" || fail "package lacks $f"
done
echo "    package: $(basename "$pkg")"
echo "CHECK build: OK"
