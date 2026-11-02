#!/usr/bin/env bash
# Docker "Pi equivalent" (deploy/docker/compose.yaml) for deployment testing.
#   up | down              start (build) / remove the stack (down also drops the Pi's disk)
#   install [ARGS]         run deploy/install.sh inside the Pi with dist/pi/rgcs-server
#   shell | logs           shell in the Pi / last 200 journal lines of rgcs-server
#   link udp|serial        FC link stand-in: Rpanion UDP 15555, or pty /dev/ttyFC
#   lte on|off             netem 80 ms ± 20 ms, 1 % loss on the Pi's interface
#   bench [SECS] [CPUS]    rgcs-server CPU / memory over a window with the CPU limited (no UI client)
# The host SITL (tcp:5760) accepts ONE client: stop scripts/dev.sh first.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DC=(docker compose -f "$ROOT/deploy/docker/compose.yaml")
pi() { "${DC[@]}" exec -T pi "$@"; }

wait_systemd() {
  for _ in $(seq 1 60); do
    state=$(pi systemctl is-system-running 2>/dev/null || true)
    case "$state" in running|degraded) echo "[pi-sim] systemd: $state"; return 0 ;; esac
    sleep 1
  done
  echo "[pi-sim] systemd did not come up (state: ${state:-?})" >&2
  return 1
}

link() {
  case "$1" in
    udp) pi sh -c 'sed -i "s/^FC_MODE=.*/FC_MODE=udp/" /etc/default/fc-link' ;;
    serial) pi sh -c 'sed -i "s/^FC_MODE=.*/FC_MODE=serial/" /etc/default/fc-link' ;;
    *) echo "link udp|serial" >&2; exit 2 ;;
  esac
  pi systemctl restart fc-link
  echo "[pi-sim] fc-link: $1"
}

lte() {
  case "$1" in
    on) pi tc qdisc replace dev eth0 root netem delay 80ms 20ms loss 1% ;;
    off) pi tc qdisc del dev eth0 root 2>/dev/null || true ;;
    *) echo "lte on|off" >&2; exit 2 ;;
  esac
  echo "[pi-sim] lte: $1"
}

bench() {
  local secs="${1:-60}" cpus="${2:-1}" a b mem
  docker update --cpus "$cpus" rgcs-pi-pi-1 >/dev/null
  a=$(pi systemctl show rgcs-server -p CPUUsageNSec --value)
  sleep "$secs"
  b=$(pi systemctl show rgcs-server -p CPUUsageNSec --value)
  mem=$(pi systemctl show rgcs-server -p MemoryCurrent --value)
  docker update --cpus 0 rgcs-pi-pi-1 >/dev/null
  awk -v a="$a" -v b="$b" -v s="$secs" -v m="$mem" -v c="$cpus" \
    'BEGIN { printf "[pi-sim] bench %ds, --cpus %s: CPU %.1f%% of one core, memory %.1f MB\n", s, c, (b-a)/(s*1e7), m/1048576 }'
}

case "${1:-}" in
  up)
    "${DC[@]}" up -d --build
    wait_systemd ;;
  down) "${DC[@]}" down -v ;;
  install) shift; pi /mnt/deploy/deploy/install.sh --binary /mnt/dist/rgcs-server "$@" ;;
  shell) "${DC[@]}" exec pi bash ;;
  logs) pi journalctl -u rgcs-server -n 200 --no-pager ;;
  link) link "${2:-}" ;;
  lte) lte "${2:-}" ;;
  bench) bench "${2:-60}" "${3:-1}" ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
