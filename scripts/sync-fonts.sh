#!/usr/bin/env bash
# Downloads the Noto Sans JP font embedded in the server-side PDF forms and
# its SIL Open Font License into assets/fonts/. Refuses to overwrite unless --force.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/assets/fonts"
FONT_URL="https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf"
LICENSE_URL="https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE"
FONT="$DIR/NotoSansJP-Regular.otf"
LICENSE="$DIR/OFL.txt"
FORCE="${1:-}"
mkdir -p "$DIR"
if [ -s "$FONT" ] && [ "$FORCE" != "--force" ]; then
  echo "font already present: $FONT ($(wc -c <"$FONT") bytes); use --force to re-download"
else
  curl -fsSL --retry 3 -o "$FONT" "$FONT_URL"
  curl -fsSL --retry 3 -o "$LICENSE" "$LICENSE_URL"
fi
echo "sha256: $(shasum -a 256 "$FONT" | cut -d' ' -f1)"
echo "size:   $(wc -c <"$FONT") bytes"
