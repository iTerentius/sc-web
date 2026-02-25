#!/usr/bin/env bash
set -euo pipefail

# ── Audio path ─────────────────────────────────────────────────────────────────
# scsynth is JACK-only (Ubuntu 22.04 package, libjack only, no ALSA compiled in).
# jackd ALSA backend with PulseAudio ALSA plugin fails (no mmap support).
# Solution: jackd dummy backend — no real hardware needed.
#
# Chain:
#   scsynth → JACK (dummy) ─┐
#   ffmpeg connects to JACK ─┘ → encode MP3 → Icecast → browser <audio>

export PULSE_RUNTIME_PATH=/tmp/pulse-runtime
export JACK_NO_AUDIO_RESERVATION=1  # skip D-Bus audio device reservation

# ── Clean stale JACK shared memory ────────────────────────────────────────────
# jackd writes 107 MB to /dev/shm. On container restart these linger and
# fill up the 256 MB shm_size, so clean them first.
rm -f /dev/shm/jack-* /dev/shm/jack_sem.* /dev/shm/jack-shm-registry 2>/dev/null || true
rm -rf /dev/shm/jack_db-* 2>/dev/null || true
# Also clear any scsynth shm from a previous run
rm -f /dev/shm/SuperColliderServer_* 2>/dev/null || true

# ── PulseAudio null sink (optional — kept for future monitoring use) ───────────
rm -rf "$PULSE_RUNTIME_PATH"
mkdir -p "$PULSE_RUNTIME_PATH"

echo "[start.sh] Starting PulseAudio..."
pulseaudio \
    --daemonize=no \
    --exit-idle-time=-1 \
    --disallow-exit \
    --log-target=stderr \
    --log-level=notice \
    &

for i in $(seq 1 20); do
    if pactl info &>/dev/null; then
        echo "[start.sh] PulseAudio ready (attempt $i)"
        break
    fi
    sleep 0.5
done

pactl load-module module-null-sink \
    sink_name=sc-null \
    sink_properties=device.description=SuperCollider
pactl set-default-sink   sc-null
pactl set-default-source sc-null.monitor

# ── JACK with dummy backend ────────────────────────────────────────────────────
echo "[start.sh] Starting JACK (dummy backend)..."
jackd --no-realtime -d dummy -r 44100 -p 1024 &
JACK_PID=$!

sleep 3
if kill -0 "$JACK_PID" 2>/dev/null; then
    echo "[start.sh] JACK running (PID $JACK_PID)"
    jack_lsp 2>/dev/null || true
else
    echo "[start.sh] ERROR: jackd failed to start"
    exit 1
fi

# ── ffmpeg: JACK client → Icecast MP3 stream ──────────────────────────────────
# ffmpeg creates JACK input ports (named "ffmpeg:input_1", "ffmpeg:input_2").
# The port-connector script below wires SuperCollider's output to these ports.
echo "[start.sh] Starting ffmpeg JACK→Icecast streamer..."
ffmpeg -nostdin \
    -f jack -i ffmpeg \
    -ac 2 \
    -acodec libmp3lame -b:a 128k \
    -reservoir 0 \
    -flush_packets 1 \
    -content_type audio/mpeg \
    -f mp3 \
    "icecast://source:${ICECAST_PASSWORD:-hackme}@${ICECAST_HOST:-icecast}:${ICECAST_PORT:-8000}/${ICECAST_MOUNT:-stream.mp3}" \
    2>&1 | sed 's/^/[ffmpeg] /' &
FFMPEG_PID=$!
sleep 1

# ── Port connector: wire scsynth → ffmpeg when SC registers ───────────────────
# scsynth registers its JACK ports after s.waitForBoot completes.
# Poll until ports appear, then connect them.
(
    echo "[port-connect] Waiting for SuperCollider JACK ports..."
    for i in $(seq 1 120); do
        if jack_lsp 2>/dev/null | grep -q "^SuperCollider:out_1$"; then
            echo "[port-connect] Connecting SuperCollider → ffmpeg..."
            jack_connect "SuperCollider:out_1" "ffmpeg:input_1" 2>/dev/null && \
            jack_connect "SuperCollider:out_2" "ffmpeg:input_2" 2>/dev/null && \
            echo "[port-connect] Connected! Audio should now flow to Icecast." && \
            jack_lsp -c 2>/dev/null | grep -A2 "SuperCollider:out" || true
            break
        fi
        sleep 1
    done
    echo "[port-connect] done"
) &

# ── Node bridge (manages sclang as child process) ─────────────────────────────
echo "[start.sh] Starting Node bridge..."
exec node /home/scuser/bridge/index.js
