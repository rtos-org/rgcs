#!/bin/sh
# Bridges the host's ArduCopter SITL (tcp) to what the real Pi offers rgcs-server:
#   FC_MODE=udp     -> udp 127.0.0.1:15555 (Rpanion-server's output)
#   FC_MODE=serial  -> a pty at /dev/ttyFC (the FC's UART; group dialout, mode 660)
set -eu
. /etc/default/fc-link
case "${FC_MODE:-udp}" in
  udp) exec socat "TCP:${FC_HOST}:${FC_PORT}" UDP:127.0.0.1:15555 ;;
  serial) exec socat "TCP:${FC_HOST}:${FC_PORT}" PTY,link=/dev/ttyFC,raw,echo=0,group=dialout,mode=660 ;;
  *) echo "fc-link: unknown FC_MODE=${FC_MODE}" >&2; exit 2 ;;
esac
