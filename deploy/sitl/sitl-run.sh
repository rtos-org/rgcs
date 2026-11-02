#!/bin/sh
# Runs a SITL binary with "@host" in its arguments replaced by the Docker host's IPv4 address:
# SITL reads udpclient addresses as dotted quads only, not host names.
set -eu
host=$(getent ahostsv4 host.docker.internal | awk 'NR == 1 { print $1 }')
for a do
  shift
  case $a in
    *@host*)
      [ -n "$host" ] || { echo "sitl-run: host.docker.internal does not resolve" >&2; exit 1; }
      a=$(printf '%s' "$a" | sed "s/@host/$host/g") ;;
  esac
  set -- "$@" "$a"
done
exec "$@"
