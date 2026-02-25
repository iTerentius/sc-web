# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

A dockerized SuperCollider environment accessible from a browser on the local network. Write and evaluate sclang code, see the post window, hear live audio via MP3 stream, and download rendered audio files.

## Host Machine

- GMKtec M7 Ultra, Ryzen 7 PRO 6850U, 32GB DDR5, Ubuntu (latest), always on, home LAN only
- Docker CE installed. No SSL needed.

## Stack

| Service | Role |
|---|---|
| `sclang` + `scsynth` | Headless SuperCollider audio engine (Ubuntu 22.04 container) |
| Node.js bridge | WebSocket server: pipes browser code to sclang stdin, streams post window back |
| ffmpeg | JACK client → encodes MP3 → pushes to Icecast (replaces darkice) |
| Icecast2 | HTTP MP3 stream mount the browser `<audio>` element connects to |
| React + CodeMirror | Frontend editor with sclang syntax highlighting |
| nginx | Serves React SPA, proxies `/ws`, `/stream` |

All services run in Docker containers via `docker-compose.yml`.

## Audio Architecture (Critical — read before touching start.sh)

**Why this setup exists:**
- Ubuntu 22.04's `supercollider-server` package is **JACK-only** — `scsynth` links only against `libjack.so.0`, no ALSA compiled in.
- `snd-dummy` requires a host kernel module (explicitly not wanted).
- jackd's ALSA driver + PulseAudio ALSA plugin fails: PulseAudio virtual devices don't support mmap, which jackd requires.
- jackd's **dummy backend** works perfectly in a container — no hardware needed.
- Ubuntu 22.04's `ffmpeg` is compiled with `--enable-libjack`, so it can be a JACK client and capture audio directly.

**Actual working audio path:**
```
scsynth → JACK (dummy backend, no hardware)
        → ffmpeg (JACK client) → libmp3lame encode → HTTP PUT → Icecast:8000/stream.mp3
                                                                → nginx /stream → browser
```

**Port wiring (automatic):** `start.sh` runs a background polling loop that waits for `SuperCollider:out_1/2` ports to register, then calls `jack_connect` to wire them to `ffmpeg:input_1/2`. This is why there's a brief delay (~10s) between server boot and audio appearing in the stream.

**`/dev/shm` size:** jackd needs ~107 MB of shared memory. Docker's default 64 MB shm is not enough. `docker-compose.yml` sets `shm_size: '256m'` for `sc-backend`.

**`JACK_NO_AUDIO_RESERVATION=1`:** Required. Without it, jackd tries to talk to D-Bus for audio device reservation, which fails in a container (no session bus).

**PulseAudio** is still started (null sink) for optional future use (e.g. monitoring), but is not in the main audio chain.

## Commands

```bash
# Build all images
docker compose build

# Start full stack (detached)
docker compose up -d

# Follow all logs
docker compose logs -f

# Follow a single service
docker compose logs -f sc-backend

# Rebuild one service and restart
docker compose build sc-backend && docker compose up -d --force-recreate sc-backend

# Shell into SC container
docker compose exec sc-backend bash

# Check all processes running inside sc-backend
docker compose exec sc-backend ps aux

# List JACK ports and connections (inside sc-backend)
docker compose exec sc-backend jack_lsp -c

# Verify stream is flowing (should return many bytes instantly)
curl -m 3 --range 0-8191 http://localhost:8000/stream.mp3 | wc -c

# Tear down including volumes
docker compose down -v
```

## Debugging

**SC not booting:**
- Check `docker compose logs sc-backend` for sclang compile errors or `JackDriver` messages
- Port connector log line `[port-connect] Connected!` confirms audio is wired

**No stream audio:**
- `jack_lsp -c` inside container — `SuperCollider:out_1` should show `ffmpeg:input_1` as a connected destination
- `curl -m 3 http://localhost:8000/stream.mp3 | wc -c` — non-zero means Icecast is serving

**jackd crashes on restart:**
- Stale JACK shm files fill up `/dev/shm`. `start.sh` cleans them on every startup with `rm -f /dev/shm/jack-*`
- If it still fails: `docker compose exec sc-backend df -h /dev/shm` — must be 256 MB, not 64 MB

**sclang Qt errors (`qt.qpa.xcb`):**
- `QT_QPA_PLATFORM=offscreen` is set in `bridge/index.js` for sclang's environment — required for headless

## SuperCollider Package

Ubuntu 22.04 ships SuperCollider 3.11.2 via `supercollider-language` + `supercollider-server`. No PPA needed — the apt version works. It is JACK-only (no ALSA backend compiled in).

## Networking

- LAN only, no SSL, no certbot.
- Exposed ports: `80` (nginx → frontend + proxied stream), `8000` (Icecast direct).
- Access via host LAN IP.
