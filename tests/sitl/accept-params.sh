#!/usr/bin/env bash
# P4 acceptance against a running rgcs-server + SITL (scripts/dev.sh):
# refresh → all parameters (>1,000) downloaded with progress → write FENCE_ALT_MAX with a
# confirm token → read-back verified → row in param_history → restore. Prints "ACCEPT params: OK" or FAIL.
set -euo pipefail
URL="${RGCS_URL:-http://127.0.0.1:8000}"
SYSID="${SYSID:-1}"
H='X-Requested-With: rgcs'
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

api() { curl -s -b "$JAR" -c "$JAR" -H "$H" "$@"; }
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

api -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}' "$URL/api/auth/login" | json 'd["data"]["username"]' | grep -q admin || fail "login"
api "$URL/api/vehicles/$SYSID" | json 'd["data"]["link"]' | grep -q ok || fail "vehicle $SYSID not connected"
api "$URL/api/vehicles/$SYSID" | json 'd["data"]["armed"]' | grep -q False || fail "vehicle is armed; disarm first"

echo "[1] refresh → full download"
api -X POST "$URL/api/vehicles/$SYSID/params/refresh" >/dev/null
for i in $(seq 1 120); do
  p=$(api "$URL/api/vehicles/$SYSID/params/progress")
  recv=$(echo "$p" | json 'd["data"]["received"]'); total=$(echo "$p" | json 'd["data"]["total"]'); done_=$(echo "$p" | json 'd["data"]["complete"]')
  [ $((i % 5)) -eq 0 ] && echo "    $recv / $total"
  [ "$done_" = True ] && break
  sleep 1
done
[ "${done_:-False}" = True ] || fail "download did not complete ($recv / $total)"
[ "$recv" -gt 1000 ] || fail "expected more than 1,000 parameters, got $recv"
echo "    complete: $recv parameters"

echo "[2] FENCE_ALT_MAX before"
before=$(api "$URL/api/vehicles/$SYSID/params" | json '[e["value"] for e in d["data"]["entries"] if e["name"]=="FENCE_ALT_MAX"][0]')
echo "    $before"
target=150; [ "$before" = "150.0" ] && target=120

write() {  # $1 = value
  local tok res
  tok=$(api -H 'content-type: application/json' -d '{"cmd":"param_write"}' "$URL/api/vehicles/$SYSID/confirm" | json 'd["data"]["confirm_token"]')
  res=$(api -X PUT -H 'content-type: application/json' -d "{\"changes\":[{\"name\":\"FENCE_ALT_MAX\",\"value\":$1}],\"confirm_token\":\"$tok\"}" "$URL/api/vehicles/$SYSID/params")
  echo "    $res"
  echo "$res" | json 'd["data"][0]["verified"]' | grep -qx True || fail "write of $1 not verified"
}

echo "[3] write $target (confirmed, verified)"
write "$target"
echo "[4] unconfirmed write is refused"
api -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: application/json' -d '{"changes":[{"name":"FENCE_ALT_MAX","value":99}]}' "$URL/api/vehicles/$SYSID/params" | grep -qx 409 || fail "unconfirmed write was not refused"
echo "[5] param_history has the row"
api "$URL/api/history/params?sysid=$SYSID&limit=1" | json 'd["data"][0]["name"], d["data"][0]["old_value"], d["data"][0]["new_value"], d["data"][0]["verified"]' | grep -q "FENCE_ALT_MAX.*True" || fail "history row missing"
echo "[6] restore $before"
write "$before"
echo "ACCEPT params: OK ($recv parameters)"
