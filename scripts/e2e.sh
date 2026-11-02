#!/usr/bin/env bash
# Playwright E2E against a real rgcs-server serving the built UI.
#
#   scripts/e2e.sh                          # no vehicle link needed (login / shell journeys)
#   scripts/e2e.sh --with-sitl              # + detail.spec.ts against SITL on tcp:5760
#   scripts/e2e.sh --with-sitl --with-sim   # + camera.spec.ts (MT11 simulator on 37261)
#   scripts/e2e.sh --with-video [...]       # + present.spec.ts (MediaMTX + ffmpeg, scripts/dev-video.sh)
#
# Env: E2E_PORT (default 8010), RGCS_SERVER_BIN (default target/debug/rgcs-server, built if missing),
#      E2E_SITL_URL (default tcp:127.0.0.1:5760; e.g. a second SITL instance -I1 on tcp:127.0.0.1:5770).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT/apps/rgcs-server/ui"
DEV_DIR="$ROOT/.dev"
PORT="${E2E_PORT:-8010}"
BIN="${RGCS_SERVER_BIN:-$ROOT/target/debug/rgcs-server}"
WITH_SITL=0
WITH_SIM=0
WITH_VIDEO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --with-sitl) WITH_SITL=1; shift ;;
    --with-sim) WITH_SIM=1; shift ;;
    --with-video) WITH_VIDEO=1; shift ;;
    *) break ;;
  esac
done
SIM_PORT=37261

export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p "$DEV_DIR"
rm -rf "$DEV_DIR/e2e-data" && mkdir -p "$DEV_DIR/e2e-data"

if [ -z "${RGCS_SERVER_BIN:-}" ]; then
  echo "[e2e] building rgcs-server (no-op when up to date)"
  (cd "$ROOT" && cargo build -q -p rgcs-server)
fi
# Rebuild the UI bundle when it is missing or any source is newer than it (a stale dist tests old code).
if [ ! -f "$UI_DIR/dist/index.html" ] || [ "${E2E_REBUILD_UI:-0}" = 1 ] \
   || [ -n "$(find "$UI_DIR/src" "$UI_DIR/index.html" -newer "$UI_DIR/dist/index.html" -print -quit 2>/dev/null)" ]; then
  echo "[e2e] building UI"
  (cd "$UI_DIR" && npm run build >/dev/null)
fi

CONFIG="$DEV_DIR/e2e-config.toml"
{
  echo "listen = \"127.0.0.1:$PORT\""
  # Without --with-sitl the server must not find a vehicle, even if a SITL happens to be running.
  if [ "$WITH_SITL" = 1 ]; then echo "mavlink_url = \"${E2E_SITL_URL:-tcp:127.0.0.1:5760}\""; else echo "mavlink_url = \"tcp:127.0.0.1:5799\""; fi
  echo "data_dir = \"$DEV_DIR/e2e-data\""
  echo "ui_dir = \"$UI_DIR/dist\""
  if [ "$WITH_VIDEO" = 1 ]; then echo "whep_upstream = \"http://127.0.0.1:8889/video1/whep\""; fi
} >"$CONFIG"

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT

if [ "$WITH_SIM" = 1 ]; then
  echo "[e2e] starting MT11 simulator on $SIM_PORT"
  (cd "$ROOT" && cargo build -q -p rgcs-camera --features sim --example siyi_sim)
  "$ROOT/target/debug/examples/siyi_sim" --port "$SIM_PORT" >"$DEV_DIR/e2e-sim.log" 2>&1 &
  PIDS+=($!)
fi
if [ "$WITH_VIDEO" = 1 ]; then
  "$ROOT/scripts/dev-video.sh" >"$DEV_DIR/e2e-video.log" 2>&1 &
  PIDS+=($!)
  sleep 3
fi

echo "[e2e] starting rgcs-server on :$PORT"
RGCS_CONFIG="$CONFIG" "$BIN" >"$DEV_DIR/e2e-server.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 60); do
  curl -sf --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 0.5
done
curl -sf --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "[e2e] server did not start"; cat "$DEV_DIR/e2e-server.log"; exit 1; }
if [ "$WITH_SIM" = 1 ]; then
  J=$(mktemp)
  curl -s -c "$J" -H 'X-Requested-With: rgcs' -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}' "http://127.0.0.1:$PORT/api/auth/login" >/dev/null
  curl -s -b "$J" -H 'X-Requested-With: rgcs' -H 'content-type: application/json' -X PUT \
    -d "{\"kind\":\"siyi_mt11\",\"host\":\"127.0.0.1\",\"port\":$SIM_PORT}" "http://127.0.0.1:$PORT/api/vehicles/1/camera/profile" >/dev/null
  rm -f "$J"
fi
[ "$WITH_SITL" = 1 ] && sleep 12   # streams start after the 10 s SET_MESSAGE_INTERVAL grace

cd "$UI_DIR"
export E2E_BASE_URL="http://127.0.0.1:$PORT"
[ "$WITH_SITL" = 1 ] && export RGCS_E2E_SITL=1
[ "$WITH_SIM" = 1 ] && export RGCS_E2E_SIM=1
[ "$WITH_VIDEO" = 1 ] && export RGCS_E2E_VIDEO=1
npx playwright test "$@"
