#!/usr/bin/env bash
# One-shot local dev stack: ArduCopter SITL + rgcs-server + UI.
#
#   scripts/dev.sh            # Vite dev server with HMR on :5173 (proxies /api and /ws to :8000)
#   scripts/dev.sh --built    # serve apps/rgcs-server/ui/dist from rgcs-server on :8000 (builds if missing)
#   scripts/dev.sh --no-sitl  # reuse a SITL you already started on tcp:5760
#   scripts/dev.sh --siyi-sim # also run the MT11 simulator on 37260 and point UAV-01's camera at it
#   scripts/dev.sh --video    # also run MediaMTX + ffmpeg test pattern (scripts/dev-video.sh)
#   scripts/dev.sh --sitl 3   # three SITL vehicles (SYSID 1..3, homes ~100 m apart) through
#                             # scripts/mav-relay.py on udp:14550 -> rgcs-server udpin:14551
#   scripts/dev.sh --quadplane  # add one ArduPlane QuadPlane SITL after the copters (next SYSID,
#                             # through the relay; needs build/sitl/bin/arduplane)
#   scripts/dev.sh --sitl 0 --quadplane  # fixed wing only: the QuadPlane is SYSID 1 (UAV-01)
#   scripts/dev.sh --plane    # add one plain ArduPlane SITL (after the QuadPlane)
#   scripts/dev.sh --rover    # add one ArduRover SITL last (needs build/sitl/bin/ardurover)
#   scripts/dev.sh --sitl 1 --quadplane --plane --rover  # one of each: copter, VTOL, plane, rover
#   scripts/dev.sh --docker ...  # SITL in Docker containers (scripts/sitl-docker.sh build once);
#                             # no native ArduPilot build needed. Same ports, SYSIDs and homes.
#
# Env overrides: SITL_DOCKER=1 (= --docker), ARDUPILOT_DIR, SITL_HOME (lat,lon,alt,yaw), SITL_SPEEDUP, SITL_COUNT, RGCS_PORT, UI_PORT,
#   QUADPLANE_HOME (the QuadPlane's own home, lat,lon,alt,yaw).
# Everything runtime-related lives in .dev/ (git-ignored). Ctrl-C stops all three processes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="$ROOT/.dev"
UI_DIR="$ROOT/apps/rgcs-server/ui"
# Prefer the upstream-master worktree (Copter 4.7+: NAV_ARC_WAYPOINT) when it has been built.
# Default checkouts sit next to this repo: ../ardupilot-latest, else ../ardupilot.
if [ -z "${ARDUPILOT_DIR:-}" ] && [ -x "$(dirname "$ROOT")/ardupilot-latest/build/sitl/bin/arducopter" ]; then
  ARDUPILOT_DIR="$(dirname "$ROOT")/ardupilot-latest"
fi
ARDUPILOT_DIR="${ARDUPILOT_DIR:-$(dirname "$ROOT")/ardupilot}"
SITL_BIN="$ARDUPILOT_DIR/build/sitl/bin/arducopter"
SITL_PARAMS="$ARDUPILOT_DIR/Tools/autotest/default_params/copter.parm"
PLANE_BIN="$ARDUPILOT_DIR/build/sitl/bin/arduplane"
QUADPLANE_PARAMS="$ARDUPILOT_DIR/Tools/autotest/default_params/quadplane.parm"
PLANE_PARAMS="$ARDUPILOT_DIR/Tools/autotest/models/plane.parm"
ROVER_BIN="$ARDUPILOT_DIR/build/sitl/bin/ardurover"
ROVER_PARAMS="$ARDUPILOT_DIR/Tools/autotest/default_params/rover.parm"
SITL_HOME="${SITL_HOME:-36.2509,137.6385,1505,0}"  # 上高地 (河童橋付近): 3D 地図の確認用
# The QuadPlane flies from 那智勝浦 (the home of the saved plan nachikatsuura_abso_loiter), not 上高地.
QUADPLANE_HOME="${QUADPLANE_HOME:-33.6682026,135.9041309,87.36,0}"
SITL_SPEEDUP="${SITL_SPEEDUP:-1}"
SITL_PORT=5760
SITL_COUNT="${SITL_COUNT:-1}"
RELAY_VEHICLE_PORT=14550
RELAY_SERVER_PORT=14551
RGCS_PORT="${RGCS_PORT:-8000}"
UI_PORT="${UI_PORT:-5173}"

MODE="vite"
START_SITL=1
SIYI_SIM=0
VIDEO=0
QUADPLANE=0
PLANE=0
ROVER=0
DOCKER="${SITL_DOCKER:-0}"
ARGS=("$@")
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  case "$arg" in
    --sitl) i=$((i + 1)); SITL_COUNT="${ARGS[$i]:-}" ;;
    --built) MODE="built" ;;
    --no-sitl) START_SITL=0 ;;
    --siyi-sim) SIYI_SIM=1 ;;
    --video) VIDEO=1 ;;
    --quadplane) QUADPLANE=1 ;;
    --plane) PLANE=1 ;;
    --rover) ROVER=1 ;;
    --docker) DOCKER=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

export PATH="$HOME/.cargo/bin:$PATH"
EXTRAS=$((QUADPLANE + PLANE + ROVER))
mkdir -p "$DEV_DIR/sitl" "$DEV_DIR/data"

PIDS=()
CONTAINERS=()
cleanup() {
  trap - EXIT INT TERM
  echo
  echo "[dev] stopping..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  for c in "${CONTAINERS[@]:-}"; do
    [ -n "$c" ] && "$ROOT/scripts/sitl-docker.sh" stop "$c"
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# --sitl 0 --quadplane: the QuadPlane alone, as SYSID 1 (UAV-01).
if ! [[ "$SITL_COUNT" =~ ^[0-9]$ ]] || { [ "$SITL_COUNT" = 0 ] && [ "$EXTRAS" = 0 ]; }; then
  echo "[dev] --sitl / SITL_COUNT must be 1..9, or 0 with --quadplane/--plane/--rover (got '$SITL_COUNT')" >&2
  exit 2
fi

# The i-th vehicle's home: SITL_HOME moved ~100 m north per vehicle.
home_of() {
  awk -v h="$SITL_HOME" -v i="$1" 'BEGIN { split(h, p, ","); printf "%.6f,%s,%s,%s", p[1] + i * 0.0009, p[2], p[3], p[4] }'
}

# start_sitl <name> <vehicle> <instance> <home> <log> [relay]: one SITL, natively or (--docker) in a
# container, state in .dev/sitl/<name>. With "relay" SERIAL0 goes to the relay; without it the SITL
# listens on tcp 5760+10*instance. SYSID = instance + 1.
start_sitl() {
  local name="$1" vehicle="$2" inst="$3" home="$4" log="$5" relay="${6:-}"
  if [ "$DOCKER" = 1 ]; then
    local mode=(--publish)
    [ -n "$relay" ] && mode=(--relay "$RELAY_VEHICLE_PORT")
    "$ROOT/scripts/sitl-docker.sh" run "$name" "$vehicle" "$inst" "$home" "${mode[@]}" >"$log" 2>&1 &
    PIDS+=($!)
    CONTAINERS+=("$name")
    return
  fi
  local bin model params serial0=()
  case "$vehicle" in
    copter) bin="$SITL_BIN" model=+ params="$SITL_PARAMS" ;;
    quadplane) bin="$PLANE_BIN" model=quadplane params="$QUADPLANE_PARAMS" ;;
    plane) bin="$PLANE_BIN" model=plane params="$PLANE_PARAMS" ;;
    rover) bin="$ROVER_BIN" model=rover params="$ROVER_PARAMS" ;;
  esac
  if [ ! -x "$bin" ]; then
    echo "[dev] SITL binary not found: $bin (./waf $vehicle in $ARDUPILOT_DIR, or use --docker)" >&2
    exit 1
  fi
  [ -n "$relay" ] && serial0=(--serial0 "udpclient:127.0.0.1:$RELAY_VEHICLE_PORT")
  mkdir -p "$DEV_DIR/sitl/$name"
  (cd "$DEV_DIR/sitl/$name" && exec "$bin" --model "$model" --speedup "$SITL_SPEEDUP" --defaults "$params" \
      --home "$home" -I"$inst" --sysid "$((inst + 1))" ${serial0[@]+"${serial0[@]}"} -w) >"$log" 2>&1 &
  PIDS+=($!)
}

# One non-copter SITL after the copters: start_extra <name> <label> <vehicle> [home].
# Takes the next instance from $n (next SYSID n+1; home n*100 m north unless given) and advances it.
start_extra() {
  local home="${4:-$(home_of "$n")}"
  echo "[dev] starting $2 SITL (SYSID $((n + 1)), home $home) -> $DEV_DIR/sitl-$1.log"
  start_sitl "$1" "$3" "$n" "$home" "$DEV_DIR/sitl-$1.log" relay
  n=$((n + 1))
}

if [ "$START_SITL" = 1 ] && [ "$DOCKER" = 1 ] && [ ! -x "$ROOT/.dev/sitl-docker/build/sitl/bin/arducopter" ]; then
  echo "[dev] Docker SITL not built yet: scripts/sitl-docker.sh build (ARDUPILOT_DIR=<checkout>)" >&2
  exit 1
fi

# --- 1. SITL -----------------------------------------------------------------
if [ "$START_SITL" = 1 ] && { [ "$SITL_COUNT" -gt 1 ] || [ "$EXTRAS" -gt 0 ]; }; then
  echo "[dev] starting the MAVLink relay (vehicles udp:$RELAY_VEHICLE_PORT -> server udp:$RELAY_SERVER_PORT) -> $DEV_DIR/relay.log"
  python3 -I "$ROOT/scripts/mav-relay.py" "$RELAY_VEHICLE_PORT" "$RELAY_SERVER_PORT" >"$DEV_DIR/relay.log" 2>&1 &
  PIDS+=($!)
  for ((i = 0; i < SITL_COUNT; i++)); do
    echo "[dev] starting SITL #$((i + 1)) (SYSID $((i + 1)), home $(home_of "$i")) -> $DEV_DIR/sitl-$((i + 1)).log"
    start_sitl "$((i + 1))" copter "$i" "$(home_of "$i")" "$DEV_DIR/sitl-$((i + 1)).log" relay
  done
  n=$SITL_COUNT
  [ "$QUADPLANE" = 1 ] && start_extra qp QuadPlane quadplane "$QUADPLANE_HOME"
  [ "$PLANE" = 1 ] && start_extra plane Plane plane
  [ "$ROVER" = 1 ] && start_extra rover Rover rover
elif [ "$START_SITL" = 1 ]; then
  if port_in_use "$SITL_PORT"; then
    echo "[dev] SITL already listening on tcp:$SITL_PORT, reusing it"
  else
    echo "[dev] starting ArduCopter SITL (home $SITL_HOME, speedup $SITL_SPEEDUP) -> $DEV_DIR/sitl.log"
    start_sitl 1 copter 0 "$SITL_HOME" "$DEV_DIR/sitl.log"
  fi
fi

# --- 2. rgcs-server ----------------------------------------------------------
if port_in_use "$RGCS_PORT"; then
  echo "[dev] port $RGCS_PORT already in use; stop the other rgcs-server first" >&2
  exit 1
fi

CONFIG="$DEV_DIR/config.toml"
{
  echo "listen = \"127.0.0.1:$RGCS_PORT\""
  if [ "$SITL_COUNT" -gt 1 ] || [ "$EXTRAS" -gt 0 ]; then
    echo "mavlink_url = \"udpin:127.0.0.1:$RELAY_SERVER_PORT\""
  else
    echo "mavlink_url = \"tcp:127.0.0.1:$SITL_PORT\""
  fi
  echo "data_dir = \"$DEV_DIR/data\""
  echo "role = \"standalone\""
  echo "telemetry_interval_ms = 100"
  if [ "$VIDEO" = 1 ]; then echo "whep_upstream = \"http://127.0.0.1:8889/video1/whep\""; fi
  if [ "$MODE" = "built" ]; then echo "ui_dir = \"$UI_DIR/dist\""; fi
  # Machine-local additions (git-ignored, e.g. [[basemaps]] with imagery under your own terms).
  if [ -f "$DEV_DIR/config.local.toml" ]; then echo ''; cat "$DEV_DIR/config.local.toml"; fi
  # AI chat stays off in dev (no LLM calls). Keep [ai] last: TOML keys after it belong to it.
  echo ''
  echo '[ai]'
  echo 'provider = "none"'
  echo '# provider = "openai_compat"  # local OpenAI-compatible endpoint, e.g. Ollama'
  echo '# base_url = "http://127.0.0.1:11434/v1"'
  echo '# model = "qwen3:8b"'
  echo '# provider = "anthropic"      # key from the ANTHROPIC_API_KEY env var, never in this file'
} >"$CONFIG"

if [ "$MODE" = "built" ] && [ ! -f "$UI_DIR/dist/index.html" ]; then
  echo "[dev] ui/dist missing, building UI once..."
  (cd "$UI_DIR" && npm run build)
fi

if [ "$SIYI_SIM" = 1 ]; then
  echo "[dev] starting MT11 simulator on 37260 -> $DEV_DIR/siyi-sim.log"
  (cd "$ROOT" && exec cargo run -q -p rgcs-camera --features sim --example siyi_sim -- --port 37260) >"$DEV_DIR/siyi-sim.log" 2>&1 &
  PIDS+=($!)
fi
if [ "$VIDEO" = 1 ]; then
  "$ROOT/scripts/dev-video.sh" >"$DEV_DIR/video.log" 2>&1 &
  PIDS+=($!)
fi

echo "[dev] starting rgcs-server (config $CONFIG)"
(cd "$ROOT" && RGCS_CONFIG="$CONFIG" exec cargo run -q -p rgcs-server) &
PIDS+=($!)

if [ "$SIYI_SIM" = 1 ]; then
  # Point UAV-01's camera profile at the simulator once the API answers.
  (
    for _ in $(seq 1 120); do curl -sf --max-time 1 "http://127.0.0.1:$RGCS_PORT/api/health" >/dev/null && break; sleep 1; done
    J=$(mktemp)
    curl -s -c "$J" -H 'X-Requested-With: rgcs' -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}' "http://127.0.0.1:$RGCS_PORT/api/auth/login" >/dev/null
    curl -s -b "$J" -H 'X-Requested-With: rgcs' -H 'content-type: application/json' -X PUT \
      -d '{"kind":"siyi_mt11","host":"127.0.0.1","port":37260}' "http://127.0.0.1:$RGCS_PORT/api/vehicles/1/camera/profile" >/dev/null \
      && echo "[dev] UAV-01 camera profile -> MT11 simulator"
    rm -f "$J"
  ) &
fi

# --- 3. UI -------------------------------------------------------------------
if [ "$MODE" = "vite" ]; then
  echo "[dev] starting Vite dev server on :$UI_PORT"
  (cd "$UI_DIR" && RGCS_SERVER="http://127.0.0.1:$RGCS_PORT" exec npm run dev -- --host 127.0.0.1 --port "$UI_PORT" --strictPort) &
  PIDS+=($!)
  URL="http://127.0.0.1:$UI_PORT"
else
  URL="http://127.0.0.1:$RGCS_PORT"
fi

echo
echo "[dev] UI:      $URL"
echo "[dev] API:     http://127.0.0.1:$RGCS_PORT/api/health"
if [ "$SITL_COUNT" -gt 1 ] || [ "$EXTRAS" -gt 0 ]; then
  echo "[dev] SITL:    $SITL_COUNT copters$([ "$QUADPLANE" = 1 ] && echo " + QuadPlane")$([ "$PLANE" = 1 ] && echo " + Plane")$([ "$ROVER" = 1 ] && echo " + Rover") via the relay (logs $DEV_DIR/sitl-N.log, $DEV_DIR/relay.log)"
else
  echo "[dev] SITL:    tcp:127.0.0.1:$SITL_PORT (telemetry streams start ~10-15 s after link-up)"
  echo "[dev] SITL log: $DEV_DIR/sitl.log"
fi
echo "[dev] Ctrl-C stops everything."
echo

wait
