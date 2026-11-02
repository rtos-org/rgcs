#!/bin/sh
# A release that passes the installer's --version check but never comes up healthy.
case "${1:-}" in
  --version|-V) echo "rgcs-server 9.9.9-broken" ;;
  *) echo "broken build" >&2; exit 1 ;;
esac
