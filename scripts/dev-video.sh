#!/usr/bin/env bash
# Local video stack for development: MediaMTX (WHEP on 127.0.0.1:8889, RTSP publish on 8554)
# plus an ffmpeg test pattern published as rtsp://127.0.0.1:8554/video1 — the path the MT11
# profile resolves to when its host is 127.0.0.1 (simulator). Requires: brew install mediamtx ffmpeg
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="$ROOT/.dev"
mkdir -p "$DEV_DIR"
command -v mediamtx >/dev/null || { echo "[video] mediamtx not found: brew install mediamtx" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "[video] ffmpeg not found: brew install ffmpeg" >&2; exit 1; }

cat >"$DEV_DIR/mediamtx.yml" <<'YML'
logLevel: info
rtsp: yes
rtspAddress: 127.0.0.1:8554
rtmp: no
hls: no
srt: no
api: no
metrics: no
pprof: no
playback: no
webrtc: yes
webrtcAddress: 127.0.0.1:8889
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189
webrtcIPsFromInterfaces: yes
paths:
  all_others:
YML

PIDS=()
cleanup() { trap - EXIT INT TERM; for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "[video] starting mediamtx -> $DEV_DIR/mediamtx.log"
mediamtx "$DEV_DIR/mediamtx.yml" >"$DEV_DIR/mediamtx.log" 2>&1 &
PIDS+=($!)
sleep 1
echo "[video] publishing ffmpeg testsrc2 1280x720@30 to rtsp://127.0.0.1:8554/video1"
ffmpeg -hide_banner -loglevel warning -re -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -c:v libx264 -preset veryfast -tune zerolatency -g 30 -pix_fmt yuv420p \
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/video1 >"$DEV_DIR/ffmpeg.log" 2>&1 &
PIDS+=($!)
echo "[video] WHEP: http://127.0.0.1:8889/video1/whep  (set whep_upstream to this for the sim profile)"
wait
