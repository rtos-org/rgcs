#!/usr/bin/env bash
# ArduPilot SITL in Docker: no ArduPilot toolchain on the host, only Docker and a checkout.
#
#   scripts/sitl-docker.sh build                      # image rgcs-sitl + copter/plane/rover binaries
#   scripts/sitl-docker.sh run <name> <vehicle> <instance> <home> --relay <port>
#   scripts/sitl-docker.sh run <name> <vehicle> <instance> <home> --publish
#   scripts/sitl-docker.sh stop <name>
#
# vehicle: copter | quadplane | plane | rover. SYSID = instance + 1 (override: SITL_SYSID).
# --relay <port>: SERIAL0 is a UDP client to that port on the host (scripts/mav-relay.py).
# --publish: SERIAL0 / 1 / 2 (tcp 5760+10*I, +2, +3) and RC input (udp 5501+10*I) on the
#   host's 127.0.0.1, like a native SITL. Instance state (eeprom, logs) in .dev/sitl/<name>.
#
# Env: ARDUPILOT_DIR (checkout with submodules; default ../ardupilot next to this repo), SITL_SPEEDUP.
# Build output: .dev/sitl-docker/{build,ccache} (git-ignored). Rebuild after updating the checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.dev/sitl-docker"
IMAGE="rgcs-sitl:latest"
ARDUPILOT_DIR="${ARDUPILOT_DIR:-$(dirname "$ROOT")/ardupilot}"
SITL_SPEEDUP="${SITL_SPEEDUP:-1}"
USER_ARGS=(--user "$(id -u):$(id -g)" -e HOME=/tmp)

usage() { sed -n '2,15p' "$0"; exit 2; }

# A git worktree's .git is a file pointing at the main checkout's git dir: mount that too,
# at the same path, so waf can read the commit hash.
git_mounts() {
  if [ -f "$ARDUPILOT_DIR/.git" ]; then
    local common
    common="$(git -C "$ARDUPILOT_DIR" rev-parse --path-format=absolute --git-common-dir)"
    echo "-v" "$common:$common:ro"
  fi
}

build() {
  if [ ! -f "$ARDUPILOT_DIR/wscript" ]; then
    echo "[sitl-docker] no ArduPilot checkout at $ARDUPILOT_DIR (set ARDUPILOT_DIR)" >&2
    exit 1
  fi
  if [ ! -f "$ARDUPILOT_DIR/modules/mavlink/message_definitions/v1.0/common.xml" ]; then
    echo "[sitl-docker] submodules missing: git -C $ARDUPILOT_DIR submodule update --init --recursive" >&2
    exit 1
  fi
  docker build -t "$IMAGE" "$ROOT/deploy/sitl"
  mkdir -p "$OUT/build" "$OUT/ccache"
  # shellcheck disable=SC2046
  docker run --rm "${USER_ARGS[@]}" -e CCACHE_DIR=/ccache \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
    -v "$ARDUPILOT_DIR:/ardupilot" $(git_mounts) -v "$OUT/build:/build" -v "$OUT/ccache:/ccache" \
    -w /ardupilot "$IMAGE" sh -euc '
      python3 ./waf configure --board sitl --out /build --no-submodule-update
      python3 ./waf copter plane rover --out /build
      rm -rf /build/params && mkdir -p /build/params
      cp -r Tools/autotest/default_params Tools/autotest/models /build/params/'
  echo "[sitl-docker] built: $(ls "$OUT/build/sitl/bin" | tr '\n' ' ')"
}

# vehicle -> binary, model, defaults (relative to build/params)
vehicle_spec() {
  case "$1" in
    copter) echo "arducopter + default_params/copter.parm" ;;
    quadplane) echo "arduplane quadplane default_params/quadplane.parm" ;;
    plane) echo "arduplane plane models/plane.parm" ;;
    rover) echo "ardurover rover default_params/rover.parm" ;;
    *) echo "[sitl-docker] unknown vehicle '$1' (copter | quadplane | plane | rover)" >&2; exit 2 ;;
  esac
}

run() {
  [ $# -ge 5 ] || usage
  local name="$1" vehicle="$2" inst="$3" home="$4" mode="$5"
  [[ "$inst" =~ ^[0-9]$ ]] || { echo "[sitl-docker] instance must be 0..9 (got '$inst')" >&2; exit 2; }
  local bin model params
  read -r bin model params <<<"$(vehicle_spec "$vehicle")"
  if [ ! -x "$OUT/build/sitl/bin/$bin" ]; then
    echo "[sitl-docker] $bin not built: scripts/sitl-docker.sh build" >&2
    exit 1
  fi
  local state="$ROOT/.dev/sitl/$name" net=() serial0=()
  mkdir -p "$state"
  case "$mode" in
    --relay) [ $# -ge 6 ] || usage; serial0=(--serial0 "udpclient:@host:$6") ;;
    --publish)
      local base=$((5760 + 10 * inst)) rc=$((5501 + 10 * inst))
      net=(-p "127.0.0.1:$base:$base" -p "127.0.0.1:$((base + 2)):$((base + 2))"
           -p "127.0.0.1:$((base + 3)):$((base + 3))" -p "127.0.0.1:$rc:$rc/udp") ;;
    *) usage ;;
  esac
  docker rm -f "rgcs-sitl-$name" >/dev/null 2>&1 || true
  exec docker run --rm --init --name "rgcs-sitl-$name" "${USER_ARGS[@]}" \
    --add-host host.docker.internal:host-gateway ${net[@]+"${net[@]}"} \
    -v "$OUT/build:/build:ro" -v "$state:/work" -w /work "$IMAGE" \
    sitl-run "/build/sitl/bin/$bin" --model "$model" --speedup "$SITL_SPEEDUP" \
      --defaults "/build/params/$params" --home "$home" -I"$inst" --sysid "${SITL_SYSID:-$((inst + 1))}" \
      ${serial0[@]+"${serial0[@]}"} -w
}

case "${1:-}" in
  build) build ;;
  run) shift; run "$@" ;;
  stop) [ $# -ge 2 ] || usage; docker rm -f "rgcs-sitl-$2" >/dev/null 2>&1 || true ;;
  *) usage ;;
esac
