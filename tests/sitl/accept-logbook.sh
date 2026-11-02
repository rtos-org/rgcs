#!/usr/bin/env bash
# P5 acceptance against a running rgcs-server + SITL (scripts/dev.sh):
# registry → inspection run (9 seeded items) → ARM / DISARM → flight draft with times, position
# and total → confirm → DataFlash list + fetch → file served → forms 1/2/3 as PDF and CSV.
# Prints "ACCEPT logbook: OK" or FAIL.
set -euo pipefail
URL="${RGCS_URL:-http://127.0.0.1:8000}"
SYSID="${SYSID:-1}"
H='X-Requested-With: rgcs'
JAR="$(mktemp)"
TMP="$(mktemp -d)"
trap 'rm -rf "$JAR" "$TMP"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

api() { curl -s -b "$JAR" -c "$JAR" -H "$H" "$@"; }
japi() { api -H 'content-type: application/json' "$@"; }
# eval runs only expressions written in this script (same helper as accept-m1.sh / accept-params.sh).
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
armed() { api "$URL/api/vehicles/$SYSID" | json 'd["data"]["armed"]'; }
wait_armed() { for _ in $(seq 1 40); do [ "$(armed)" = "$1" ] && return 0; sleep 0.25; done; return 1; }
send_confirmed() {
  local tok
  tok=$(japi -d "{\"cmd\":\"$1\"}" "$URL/api/vehicles/$SYSID/confirm" | json 'd["data"]["confirm_token"]')
  japi -d "{\"cmd\":\"$1\",\"confirm_token\":\"$tok\"}" "$URL/api/vehicles/$SYSID/command" >/dev/null
}

japi -d '{"username":"admin","password":"admin"}' "$URL/api/auth/login" | json 'd["data"]["username"]' | grep -q admin || fail "login"
api "$URL/api/vehicles/$SYSID" | json 'd["data"]["link"]' | grep -q ok || fail "vehicle $SYSID not connected"
[ "$(armed)" = "True" ] && { send_confirmed disarm; wait_armed False || fail "could not disarm"; }

echo "[1] registry (initial 10 min)"
japi -X PUT -d '{"name":"UAV-01","registration":"JU-ACCEPT","uas_type":"回転翼航空機(マルチローター)","model":"SITL","type_cert_no":"","airworthiness_class":"","airworthiness_no":"","manufacturer":"ArduPilot","serial_no":"sim","initial_flight_minutes":10,"inspection_template_id":1}' \
  "$URL/api/vehicles/$SYSID/registry" | json 'd["data"]["registration"]' | grep -q JU-ACCEPT || fail "registry put"

echo "[2] inspection run with the 9 seeded items"
results=$(python3 -I -c 'import json; print(json.dumps([{"position":p,"result":"ok","remark":""} for p in range(1,10)]))')
run=$(japi -d "{\"template_id\":1,\"place\":\"テスト場\",\"lat\":null,\"lon\":null,\"performed_on\":\"$(date +%Y-%m-%d)\",\"inspector\":\"admin\",\"notes\":\"飛行後点検：異常なし\",\"results\":$results,\"supersedes\":null}" "$URL/api/vehicles/$SYSID/inspections")
echo "$run" | json 'd["data"]["has_ng"]' | grep -qx False || fail "inspection save: $run"

echo "[3] ARM → 3 s → DISARM → flight draft"
# A re-ARM within 10 min continues the previous flight (same row, landing moved), so compare the
# last row's landing time rather than the row count.
before=$(api "$URL/api/vehicles/$SYSID/flights" | json '(d["data"][-1]["id"], d["data"][-1]["landed_at"]) if d["data"] else None')
send_confirmed arm
wait_armed True || fail "vehicle never armed (PreArm?)"
sleep 3
send_confirmed disarm
wait_armed False || fail "vehicle still armed"
flight=""
for _ in $(seq 1 20); do
  flights=$(api "$URL/api/vehicles/$SYSID/flights")
  now=$(echo "$flights" | json '(d["data"][-1]["id"], d["data"][-1]["landed_at"]) if d["data"] else None')
  if [ "$now" != "$before" ] && [ "$(echo "$flights" | json 'd["data"][-1]["landed_at"] is not None')" = True ]; then flight=$(echo "$flights" | json 'json.dumps(d["data"][-1])'); break; fi
  sleep 0.5
done
[ -n "$flight" ] || fail "no flight draft after DISARM"
fid=$(echo "$flight" | json 'd["id"]')
echo "$flight" | json 'd["status"]=="draft" and d["flight_minutes"]>=1 and d["takeoff_lat"] is not None and d["total_minutes"]>=11' | grep -qx True || fail "draft fields: $flight"
echo "    flight $fid: $(echo "$flight" | json '(d["flight_minutes"], d["total_minutes"], d["takeoff_lat"], d["pilot"])')"

echo "[4] confirm the flight"
japi -X PATCH -d '{"takeoff_place":"SITL","status":"confirmed"}' "$URL/api/vehicles/$SYSID/flights/$fid" | json 'd["data"]["status"]' | grep -qx confirmed || fail "confirm"

echo "[5] DataFlash list + fetch"
fc=$(api "$URL/api/vehicles/$SYSID/logs/fc")
nlogs=$(echo "$fc" | json 'len(d["data"])')
[ "$nlogs" -ge 1 ] || fail "no logs on the FC: $fc"
logid=$(echo "$fc" | json 'max(d["data"], key=lambda e: e["id"])["id"]')
logsize=$(echo "$fc" | json "[e for e in d['data'] if e['id']==$logid][0]['size']")
stored_before=$(api "$URL/api/vehicles/$SYSID/logs" | json 'len(d["data"]["logs"])')
japi -d "{\"fc_log_id\":$logid,\"flight_id\":$fid}" "$URL/api/vehicles/$SYSID/logs/fetch" | json 'd["data"]["fc_log_id"]' | grep -qx "$logid" || fail "fetch start"
row=""
for i in $(seq 1 240); do
  logs=$(api "$URL/api/vehicles/$SYSID/logs")
  if [ "$(echo "$logs" | json 'len(d["data"]["logs"])')" -gt "$stored_before" ]; then row=$(echo "$logs" | json 'json.dumps(d["data"]["logs"][0])'); break; fi
  [ $((i % 10)) -eq 0 ] && echo "    waiting for log $logid ($logsize bytes)…"
  sleep 0.5
done
[ -n "$row" ] || fail "log $logid was not stored within 120 s"
rid=$(echo "$row" | json 'd["id"]'); rsize=$(echo "$row" | json 'd["size"]')
# The FC keeps appending to the newest log for a while after DISARM, so the stored size may
# exceed the size listed a moment earlier; the served file must match what was stored.
[ "$rsize" -ge "$logsize" ] || fail "stored size $rsize < listed size $logsize"
api -o "$TMP/log.bin" "$URL/api/vehicles/$SYSID/logs/$rid/file"
[ "$(wc -c <"$TMP/log.bin" | tr -d ' ')" = "$rsize" ] || fail "served file size"
echo "    log $rid: $rsize bytes"

echo "[6] forms 1 / 2 / 3 as PDF and CSV"
from="$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d yesterday +%Y-%m-%d)"; to="$(date +%Y-%m-%d)"
for form in 1 2 3; do
  for fmt in pdf csv; do
    code=$(api -o "$TMP/form$form.$fmt" -w '%{http_code}' -D "$TMP/h" "$URL/api/vehicles/$SYSID/logbook/export?form=$form&from=$from&to=$to&format=$fmt")
    [ "$code" = 200 ] || fail "export form $form $fmt → $code"
    grep -qi "content-type: $([ "$fmt" = pdf ] && echo application/pdf || echo text/csv)" "$TMP/h" || fail "content-type form $form $fmt"
  done
  head -c 5 "$TMP/form$form.pdf" | grep -q '%PDF-' || fail "form $form is not a PDF"
done
if command -v pdftotext >/dev/null; then
  pdftotext "$TMP/form1.pdf" - | grep -q 'JOURNEY LOG OF UAS' || fail "form 1 text"
  pdftotext "$TMP/form1.pdf" - | grep -q 'SITL' || fail "form 1 lacks the confirmed flight"
fi
echo "ACCEPT logbook: OK (flight $(echo "$flight" | json 'd["flight_minutes"]') min, log $rsize bytes)"
