#!/usr/bin/env bash
# The Docker Pi equivalent is up (after scripts/pi-sim.sh up, before any install).
# Prints "CHECK env: OK" or FAIL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pi() { docker compose -f "$ROOT/deploy/docker/compose.yaml" exec -T pi "$@"; }
fail() { echo "FAIL: $*"; exit 1; }

state=$(pi systemctl is-system-running || true)
case "$state" in running|degraded) ;; *) fail "systemd state: $state" ;; esac
[ "$(pi systemctl is-active mt11-camera-ui)" = active ] || fail "the Python service stand-in is not active"
[ "$(pi systemctl is-enabled mt11-camera-ui)" = enabled ] || fail "the Python service stand-in is not enabled"
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18000/)
[ "$code" = 200 ] || fail "port 18000 → $code (expected the stand-in on :8000)"
[ "$(pi systemctl is-active mt11-sim)" = active ] || fail "MT11 simulator not running"
pi sh -c 'ss -ltn | grep -q "127.0.0.1:37260"' || fail "MT11 simulator not listening on 37260"
whep=$(pi curl -s -o /dev/null -w '%{http_code}' -X OPTIONS http://127.0.0.1:8889/video1/whep || true)
[ "$whep" != 000 ] || fail "MediaMTX WHEP not reachable inside the Pi"
pi sh -c 'test ! -e /dev/ttyFC' || fail "/dev/ttyFC present in udp mode"
pi sh -c 'id pi | grep -q dialout' || fail "user pi is not in dialout"
echo "CHECK env: OK"
