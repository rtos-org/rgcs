#!/usr/bin/env bash
# P6: the browser journeys against the installed Pi (after tests/pi/accept-deploy.sh, or
# scripts/pi-sim.sh install on a fresh Pi): audience video, MT11 camera,
# detail/commands and logbook — once plainly and once over emulated LTE (netem 80 ms ± 20 ms,
# 1 % loss). Needs the host SITL with no other client. Prints "ACCEPT stack: OK (plain, lte)".
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="http://127.0.0.1:18000"
H='X-Requested-With: rgcs'
JAR="$(mktemp)"
DC=(docker compose -f "$ROOT/deploy/docker/compose.yaml")
pi() { "${DC[@]}" exec -T pi "$@"; }
fail() { echo "FAIL: $*"; exit 1; }
# eval runs only expressions written in this script (same helper as tests/sitl/*.sh).
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
api() { curl -s -b "$JAR" -c "$JAR" -H "$H" -H 'content-type: application/json' "$@"; }
healthy() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health")" = 200 ]; }
cleanup() { "$ROOT/scripts/pi-sim.sh" lte off >/dev/null 2>&1 || true; rm -f "$JAR"; }
trap cleanup EXIT

echo "[1] point the server at MediaMTX and the MT11 simulator"
pi sh -c 'grep -q "^whep_upstream" /etc/rgcs/config.toml || echo "whep_upstream = \"http://127.0.0.1:8889/video1/whep\"" >> /etc/rgcs/config.toml'
pi systemctl restart rgcs-server
for _ in $(seq 1 60); do healthy && break; sleep 1; done
healthy || fail "rgcs-server not healthy"
api -d '{"username":"admin","password":"admin"}' "$URL/api/auth/login" | json 'd["data"]["username"]' | grep -q admin || fail "login"
for _ in $(seq 1 60); do
  [ "$(api "$URL/api/vehicles/1" | json 'd.get("data") is not None and d["data"]["gps"]["fix"] >= 3')" = True ] && break; sleep 1
done
api -X PUT -d '{"kind":"siyi_mt11","host":"127.0.0.1","port":37260}' "$URL/api/vehicles/1/camera/profile" \
  | json 'd["success"]' | grep -qx True || fail "camera profile"

camera_connected() { api "$URL/api/vehicles/1/camera" | json 'd["data"]["state"]["connected"]' 2>/dev/null | grep -qx True; }

run_e2e() {  # $1 = label
  echo "[e2e:$1]"
  # The camera journey expects a fresh MT11 (zoom 1.0×): restart the simulator and wait for the link.
  pi systemctl restart mt11-sim
  for _ in $(seq 1 30); do camera_connected && break; sleep 1; done
  camera_connected || fail "camera not connected to the MT11 simulator"
  local log="${TMPDIR:-/tmp}/rgcs-accept-stack-$1.log"
  (cd "$ROOT/apps/rgcs-server/ui" && E2E_BASE_URL="$URL" RGCS_E2E_SIM_PORT=37260 RGCS_E2E_SITL=1 RGCS_E2E_SIM=1 RGCS_E2E_VIDEO=1 \
    npx playwright test e2e/present.spec.ts e2e/camera.spec.ts e2e/detail.spec.ts e2e/logbook.spec.ts) >"$log" 2>&1 || true
  grep -E '^\s+[0-9]+ (passed|failed|flaky)' "$log" || true
  if grep -Eq '^\s+[0-9]+ failed' "$log"; then
    grep -E '✘|Error:|Expected|Received|^\s+> ' "$log" | head -20
    fail "E2E ($1); full output: $log (traces under apps/rgcs-server/ui/test-results)"
  fi
}

echo "[2] browser journeys"
run_e2e plain
echo "[3] the same over emulated LTE"
"$ROOT/scripts/pi-sim.sh" lte on
run_e2e lte
echo "ACCEPT stack: OK (plain, lte)"
