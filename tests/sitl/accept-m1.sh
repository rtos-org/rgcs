#!/usr/bin/env bash
# M1 acceptance against a running rgcs-server + SITL (scripts/dev.sh):
# login → confirm → ARM → audit row → DISARM. Prints OK / FAIL and exits accordingly.
set -euo pipefail
URL="${RGCS_URL:-http://127.0.0.1:8000}"
SYSID="${SYSID:-1}"
H='X-Requested-With: rgcs'
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

api() { curl -s -b "$JAR" -c "$JAR" -H "$H" -H 'content-type: application/json' "$@"; }
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
armed() { api "$URL/api/vehicles/$SYSID" | json 'd["data"]["armed"]'; }
wait_armed() {  # $1 = True|False, up to 10 s
  for _ in $(seq 1 40); do [ "$(armed)" = "$1" ] && return 0; sleep 0.25; done
  return 1
}

api -d '{"username":"admin","password":"admin"}' "$URL/api/auth/login" | json 'd["data"]["username"]' | grep -q admin || { echo "FAIL: login"; exit 1; }
api "$URL/api/vehicles/$SYSID" | json 'd["data"]["mode"]' >/dev/null || { echo "FAIL: vehicle $SYSID not connected"; exit 1; }
if [ "$(armed)" = "True" ]; then echo "vehicle already armed; disarming first"; fi

send_confirmed() {
  local cmd="$1"
  local tok reply
  tok=$(api -d "{\"cmd\":\"$cmd\"}" "$URL/api/vehicles/$SYSID/confirm" | json 'd["data"]["confirm_token"]')
  reply=$(api -d "{\"cmd\":\"$cmd\",\"confirm_token\":\"$tok\"}" "$URL/api/vehicles/$SYSID/command")
  echo "$reply" | json 'd.get("data", d.get("error"))'
}

if [ "$(armed)" = "True" ]; then send_confirmed disarm >/dev/null; wait_armed False || { echo "FAIL: could not disarm"; exit 1; }; fi
send_confirmed arm >/dev/null
result=""
for _ in $(seq 1 40); do
  result=$(api "$URL/api/history/audit?limit=1" | json '(d["data"][0]["command"], d["data"][0]["result"], d["data"][0].get("reason"))')
  case "$result" in *"'arm', 'ok'"*|*"'arm', 'failed'"*|*"'arm', 'timeout'"*) break;; esac
  sleep 0.25
done
echo "audit: $result"
case "$result" in
  *"'arm', 'ok'"*)
    echo "OK: arm audited as ok"
    wait_armed True || { echo "FAIL: vehicle never reported armed"; exit 1; }
    send_confirmed disarm >/dev/null
    wait_armed False && echo "disarmed again" || { echo "FAIL: vehicle still armed"; exit 1; }
    ;;
  *"'arm', 'failed'"*) echo "OK: arm refused by the vehicle (PreArm) and audited as failed";;
  *) echo "FAIL: no arm result in the audit log"; exit 1;;
esac
