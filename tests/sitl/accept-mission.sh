#!/usr/bin/env bash
# P3 acceptance against a running rgcs-server + SITL (scripts/dev.sh):
# import the 20-WP fixture → write to the vehicle → read back equal → export == fixture →
# ARM + mission_start (confirmed) → MISSION_CURRENT advances. Prints "ACCEPT mission: OK" or FAIL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="${RGCS_URL:-http://127.0.0.1:8000}"
SYSID="${SYSID:-1}"
FIXTURE="$ROOT/crates/rgcs-mission/tests/fixtures/demo20.waypoints"
H='X-Requested-With: rgcs'
JAR="$(mktemp)"; OUT="$(mktemp)"
trap 'rm -f "$JAR" "$OUT"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

api() { curl -s -b "$JAR" -c "$JAR" -H "$H" "$@"; }
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

api -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}' "$URL/api/auth/login" | json 'd["data"]["username"]' | grep -q admin || fail "login"
api "$URL/api/vehicles/$SYSID" | json 'd["data"]["link"]' | grep -q ok || fail "vehicle $SYSID not connected"

echo "[1] waiting for GPS fix…"
for _ in $(seq 1 120); do
  fix=$(api "$URL/api/vehicles/$SYSID" | json 'd["data"]["gps"]["fix"]')
  [ "$fix" -ge 3 ] && break
  sleep 1
done
[ "${fix:-0}" -ge 3 ] || fail "no GPS fix"

echo "[2] import fixture → saved mission"
mission=$(api -H 'content-type: text/plain' -H 'X-Mission-Name: accept20' --data-binary "@$FIXTURE" "$URL/api/missions/import")
echo "$mission" | json 'len(d["data"]["items"])' | grep -qx 20 || fail "import did not yield 20 items: $mission"
saved=$(echo "$mission" | python3 -I -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["data"]))' | api -H 'content-type: application/json' -d @- "$URL/api/missions")
id=$(echo "$saved" | json 'd["data"]["id"]')
echo "    saved id $id"

echo "[3] write to the vehicle (verified read-back)"
report=$(api -H 'content-type: application/json' -d "{\"mission_id\":$id}" "$URL/api/vehicles/$SYSID/mission/upload")
echo "    $report"
echo "$report" | json 'd["data"]["verified"]' | grep -qx True || fail "upload not verified"
echo "$report" | json 'd["data"]["items"]' | grep -qx 20 || fail "upload item count"

echo "[4] read back"
api "$URL/api/vehicles/$SYSID/mission" | json 'len(d["data"]["items"])' | grep -qx 20 || fail "download item count"

echo "[5] export == fixture"
api "$URL/api/missions/$id/export?format=waypoints" > "$OUT"
cmp -s "$OUT" "$FIXTURE" || { diff "$FIXTURE" "$OUT" | head -5; fail "export differs from the fixture"; }

send_confirmed() {  # $1 = cmd, $2 = optional JSON args
  local cmd="$1" args="${2:-}" tok body
  tok=$(api -H 'content-type: application/json' -d "{\"cmd\":\"$cmd\"}" "$URL/api/vehicles/$SYSID/confirm" | json 'd["data"]["confirm_token"]')
  body="{\"cmd\":\"$cmd\",\"confirm_token\":\"$tok\"${args:+,\"args\":$args}}"
  api -H 'content-type: application/json' -d "$body" "$URL/api/vehicles/$SYSID/command" >/dev/null
}

echo "[6] STABILIZE → ARM → mission_start"
mode=$(api "$URL/api/vehicles/$SYSID" | json 'd["data"]["mode"]')
if [ "$mode" != "STABILIZE" ]; then
  send_confirmed set_mode '{"mode":"STABILIZE"}'   # ArduCopter refuses to arm in AUTO / RTL / LAND
  for _ in $(seq 1 20); do [ "$(api "$URL/api/vehicles/$SYSID" | json 'd["data"]["mode"]')" = STABILIZE ] && break; sleep 0.5; done
fi
send_confirmed arm
for _ in $(seq 1 40); do [ "$(api "$URL/api/vehicles/$SYSID" | json 'd["data"]["armed"]')" = True ] && break; sleep 0.5; done
[ "$(api "$URL/api/vehicles/$SYSID" | json 'd["data"]["armed"]')" = True ] || fail "vehicle did not arm (PreArm?)"
send_confirmed mission_start
echo "[7] watching MISSION_CURRENT for 90 s"
last=-1; moved=0
for _ in $(seq 1 90); do
  seq_now=$(api "$URL/api/vehicles/$SYSID/mission/progress" | json 'd["data"]["seq"] if d["data"] else -1')
  if [ "$seq_now" != "$last" ]; then echo "    seq $seq_now  mode $(api "$URL/api/vehicles/$SYSID" | json 'd["data"]["mode"]')"; last=$seq_now; fi
  [ "$seq_now" -ge 2 ] && moved=1 && break
  sleep 1
done
[ "$moved" = 1 ] || fail "MISSION_CURRENT never reached item 2"
echo "ACCEPT mission: OK (id $id, 20 items verified, export identical, AUTO advancing)"
