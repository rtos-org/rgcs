#!/usr/bin/env bash
# Installs or upgrades rgcs-server on a Raspberry Pi (Raspberry Pi OS bookworm, arm64).
#   sudo ./install.sh [--binary PATH] [--health-timeout SECS]   install / upgrade
#   sudo ./install.sh --rollback                                restore the previous binary
# Idempotent. Keeps /etc/rgcs/config.toml and /var/lib/rgcs. Stops and disables the Python
# mt11-camera-ui.service (both bind :8000 and the MT11 takes one TCP client). If the new
# binary does not answer /api/health in time, the previous one is restored (ROLLED BACK).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR=/opt/rgcs/bin
BIN="$BIN_DIR/rgcs-server"
CONF_DIR=/etc/rgcs
CONF="$CONF_DIR/config.toml"
DATA=/var/lib/rgcs
UNIT=/etc/systemd/system/rgcs-server.service
PYTHON_UNIT=mt11-camera-ui.service
NEW_BIN=""
HEALTH_TIMEOUT=30
ROLLBACK=0
TOOK_OVER_PYTHON=0

log() { echo "[install] $*"; }
die() { echo "[install] ERROR: $*" >&2; exit 1; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --binary) NEW_BIN="$2"; shift 2 ;;
      --health-timeout) HEALTH_TIMEOUT="$2"; shift 2 ;;
      --rollback) ROLLBACK=1; shift ;;
      -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  if [ -z "$NEW_BIN" ] && [ -x "$HERE/rgcs-server" ]; then NEW_BIN="$HERE/rgcs-server"; fi
}

check_binary() {
  [ -n "$NEW_BIN" ] && [ -f "$NEW_BIN" ] || die "no binary (use --binary PATH)"
  local v
  v=$("$NEW_BIN" --version 2>/dev/null) || die "$NEW_BIN does not run on this machine"
  case "$v" in rgcs-server\ *) log "new: $v" ;; *) die "$NEW_BIN is not rgcs-server ($v)" ;; esac
}

ensure_user_and_dirs() {
  if ! id rgcs >/dev/null 2>&1; then
    useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin rgcs
    log "created user rgcs"
  fi
  usermod -aG dialout rgcs
  install -d -m 0755 "$BIN_DIR" "$CONF_DIR"
  install -d -m 0750 -o rgcs -g rgcs "$DATA"
}

# Replace $BIN atomically from $1 (rename: never writes into a running, text-busy executable).
put_binary() {
  install -m 0755 "$1" "$BIN.new"
  mv -f "$BIN.new" "$BIN"
}

install_binary() {
  # Rotate .prev only for a different binary: re-running the same release keeps the real rollback target.
  if [ -f "$BIN" ] && ! cmp -s "$NEW_BIN" "$BIN"; then cp -p "$BIN" "$BIN.prev"; fi
  put_binary "$NEW_BIN"
}

ensure_config() {
  if [ -f "$CONF" ]; then
    log "keeping $CONF"
  else
    install -m 0644 "$HERE/config.toml.example" "$CONF"
    log "created $CONF (edit mavlink_url / whep_upstream for this vehicle)"
  fi
}

take_over_python() {
  systemctl list-unit-files "$PYTHON_UNIT" --no-legend 2>/dev/null | grep -q "$PYTHON_UNIT" || return 0
  if systemctl is-active --quiet "$PYTHON_UNIT" || systemctl is-enabled --quiet "$PYTHON_UNIT"; then
    systemctl stop "$PYTHON_UNIT" || true
    systemctl disable "$PYTHON_UNIT" >/dev/null 2>&1 || true
    TOOK_OVER_PYTHON=1
    log "stopped and disabled $PYTHON_UNIT (rgcs-server replaces it)"
  fi
}

install_unit() {
  install -m 0644 "$HERE/rgcs-server.service" "$UNIT"
  systemctl daemon-reload
  systemctl enable rgcs-server >/dev/null 2>&1
}

health_url() {
  local port
  port=$(sed -n 's/^listen *= *"[^"]*:\([0-9]*\)".*/\1/p' "$CONF" | head -1)
  echo "http://127.0.0.1:${port:-8000}/api/health"
}

restart_and_wait() {
  systemctl restart rgcs-server
  local url i
  url=$(health_url)
  for i in $(seq 1 "$HEALTH_TIMEOUT"); do
    if [ "$(curl -s --connect-timeout 1 --max-time 2 -o /dev/null -w '%{http_code}' "$url" || true)" = 200 ]; then return 0; fi
    sleep 1
  done
  return 1
}

restore_previous() {
  [ -f "$BIN.prev" ] || die "no previous binary to restore"
  put_binary "$BIN.prev"
  restart_and_wait || die "the previous binary is not healthy either; see journalctl -u rgcs-server"
}

# A failed first install: nothing to roll back to, so put the Pi back as it was.
undo_first_install() {
  systemctl disable --now rgcs-server >/dev/null 2>&1 || true
  rm -f "$BIN"
  log "rgcs-server stopped and disabled; the failed release was removed"
  if [ "$TOOK_OVER_PYTHON" = 1 ]; then
    systemctl enable --now "$PYTHON_UNIT" >/dev/null 2>&1 || true
    log "RESTORED $PYTHON_UNIT"
  fi
}

warn_dev_login() {
  local url
  url=$(health_url)
  if curl -s --max-time 2 "$url" | grep -q '"dev_mode":true'; then
    log "WARNING: the development login admin/admin is active. Anyone who reaches this port can"
    log "WARNING: ARM the vehicle: expose :$(echo "$url" | sed 's|.*:\([0-9]*\)/.*|\1|') only on the vehicle LAN / VPN, never the open internet."
  fi
}

main() {
  parse_args "$@"
  [ "$(id -u)" = 0 ] || die "run as root (sudo)"
  if [ "$ROLLBACK" = 1 ]; then
    restore_previous
    log "ROLLED BACK to $("$BIN" --version)"
    exit 0
  fi
  check_binary
  ensure_user_and_dirs
  install_binary
  ensure_config
  take_over_python
  install_unit
  if restart_and_wait; then
    log "INSTALLED $("$BIN" --version) ($(health_url))"
    warn_dev_login
    return 0
  fi
  log "not healthy within ${HEALTH_TIMEOUT}s"
  journalctl -u rgcs-server -n 20 --no-pager 2>/dev/null | sed 's/^/[install]   /' || true
  if [ ! -f "$BIN.prev" ]; then
    undo_first_install
    exit 1
  fi
  log "restoring the previous binary"
  restore_previous
  log "ROLLED BACK to $("$BIN" --version)"
  exit 1
}

main "$@"
