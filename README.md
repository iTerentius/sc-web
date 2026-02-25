# SC Web

A browser-based [SuperCollider](https://supercollider.github.io/) IDE. Write and evaluate sclang code, see the post window, hear live audio, and browse the built-in help — all from a browser on your local network.

![SC Web screenshot](https://github.com/user-attachments/assets/placeholder)

## Features

- **Code editor** — CodeMirror 6 with full SuperCollider syntax highlighting
- **Eval** — `Ctrl+Enter` sends code to sclang; output appears in the post window
- **Stop** — `CmdPeriod` silences all running synths
- **Live audio** — scsynth streams MP3 via Icecast; press Play in the browser toolbar
- **Help browser** — full SC 3.14.1 documentation in a side panel; click any code example to load it into the editor
- **Ctrl+/** — toggle line comments on selected lines

## Stack

| Service | Role |
|---|---|
| `sclang` + `scsynth` 3.14.1 | Headless SuperCollider audio engine |
| Node.js bridge | WebSocket server — pipes code to sclang, streams post window back |
| ffmpeg | JACK client → MP3 encode → Icecast |
| Icecast2 | HTTP MP3 stream mount |
| React + CodeMirror 6 | Frontend editor |
| nginx | Serves SPA, proxies `/ws`, `/stream`, `/help` |

All services run in Docker via `docker-compose.yml`.

## Requirements

- Docker with Compose (Docker CE recommended)
- ~4 GB disk space for the SC build image
- A machine on your local network (no SSL/domain needed)

## Quick start

```bash
git clone https://github.com/iTerentius/sc-web.git
cd sc-web

# Build all images (first build takes 10–20 min — compiles SC 3.14.1 from source)
docker compose build

# Start everything
docker compose up -d

# Open in browser
# http://<host-ip>   (default port 80)
# http://<host-ip>:8000  (Icecast status page)
```

Then in the browser:

1. Wait for the post window to show `=== SuperCollider server booted ===`
2. Press **Play** on the audio player in the toolbar
3. Hit **Ctrl+Enter** to evaluate the example code — you should hear a sine wave

## Usage

### Editor shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Evaluate all code |
| `Ctrl+/` | Toggle line comment(s) |

### Help browser

Click the **Help** tab in the right panel to open the full SC 3.14.1 documentation. Hover any code example and click **↗ send to editor** to load it into the editor, then `Ctrl+Enter` to run it.

### Stopping audio

Click **Stop** (or evaluate `CmdPeriod.run;`) to silence all running synths without rebooting the server.

## Audio architecture

Ubuntu 22.04's `supercollider-server` package is JACK-only (no ALSA). The audio chain is:

```
scsynth → JACK (dummy backend, no hardware)
        → ffmpeg (JACK client) → libmp3lame → Icecast:8000/stream.mp3
                                               → nginx /stream → browser <audio>
```

**Why jackd dummy backend?** No real audio hardware is needed inside the container. jackd's dummy backend satisfies scsynth's JACK requirement without kernel modules or hardware access.

**Why ffmpeg instead of darkice?** Ubuntu 22.04's ffmpeg is compiled with `--enable-libjack`, so it can be a JACK client directly. This avoids the intermediate PulseAudio routing that darkice requires.

## Configuration

Key environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `ICECAST_PASSWORD` | `hackme` | Icecast source password |
| `ICECAST_HOST` | `icecast` | Icecast service hostname |
| `ICECAST_PORT` | `8000` | Icecast port |
| `ICECAST_MOUNT` | `stream.mp3` | Stream mount point |

To change the Icecast password, update both `docker-compose.yml` and `icecast/icecast.xml`.

## Development

```bash
# Follow logs for all services
docker compose logs -f

# Follow a single service
docker compose logs -f sc-backend

# Rebuild one service after code changes
docker compose build sc-backend && docker compose up -d --force-recreate sc-backend

# Shell into the SC container
docker compose exec sc-backend bash

# Check JACK connections (confirms audio is wired)
docker compose exec sc-backend jack_lsp -c

# Verify the stream is flowing
curl -m 3 --range 0-8191 http://localhost:8000/stream.mp3 | wc -c
```

### Frontend dev server

The frontend uses Vite. To run it locally against a running Docker stack:

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

The Vite config proxies `/ws`, `/stream`, and `/help` to the Docker services.

## Project structure

```
sc-web/
├── docker-compose.yml
├── sc-backend/
│   ├── Dockerfile          # Multi-stage: builds SC 3.14.1, renders help HTML
│   ├── start.sh            # Starts PulseAudio, JACK, ffmpeg, Node bridge
│   ├── bridge/
│   │   └── index.js        # WebSocket bridge + /help static file server
│   └── sc/
│       └── startup.scd     # Boots scsynth on container start
├── icecast/
│   └── icecast.xml         # Icecast2 configuration
└── frontend/
    ├── nginx.conf           # Proxies /ws, /stream, /help; serves SPA
    ├── src/
    │   ├── App.jsx          # Main React component
    │   └── sc-language.js  # SC syntax highlighting + Ctrl+/ keymap
    └── Dockerfile           # node:20-alpine build → nginx:alpine serve
```

## Troubleshooting

**SC not booting**
- Check `docker compose logs sc-backend` for sclang compile errors
- Look for `[port-connect] Connected!` — confirms JACK audio is wired

**No audio in browser**
- Make sure you pressed **Play** on the audio player — it does not autoplay
- `jack_lsp -c` inside the container should show `SuperCollider:out_1 → ffmpeg:input_1`
- `curl -m 3 http://localhost:8000/stream.mp3 | wc -c` — non-zero means Icecast is serving

**Help panel is blank**
- Help HTML is pre-rendered at build time; a fresh `docker compose build sc-backend` will regenerate it

**jackd crashes on restart**
- Stale JACK shared memory fills `/dev/shm` — `start.sh` cleans it on every boot
- Check `docker compose exec sc-backend df -h /dev/shm` — must show 256 MB (set via `shm_size` in compose)
