FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ── System packages ───────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    # SuperCollider — JACK-only build on Ubuntu 22.04; jackd dummy backend used
    supercollider-language \
    supercollider-server \
    # Audio: PulseAudio (for optional monitoring), ALSA plugin
    pulseaudio \
    pulseaudio-utils \
    libasound2-plugins \
    alsa-utils \
    # ffmpeg: JACK client → encode MP3 → push to Icecast (replaces darkice)
    # Ubuntu 22.04 ffmpeg is compiled with --enable-libjack --enable-libmp3lame
    ffmpeg \
    # Utilities
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 via NodeSource ─────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── App user (PulseAudio refuses to start as root) ───────────────────────────
RUN useradd -m -u 1000 -s /bin/bash scuser \
    && adduser scuser audio \
    && adduser scuser pulse-access 2>/dev/null || true

# ── Node bridge ───────────────────────────────────────────────────────────────
WORKDIR /home/scuser
COPY bridge/package*.json bridge/
RUN npm --prefix bridge install --omit=dev \
    && chown -R scuser:scuser bridge

COPY --chown=scuser:scuser bridge/ bridge/
COPY --chown=scuser:scuser sc/    sc/
COPY --chown=scuser:scuser start.sh start.sh
RUN chmod +x start.sh

USER scuser
EXPOSE 4000
CMD ["/home/scuser/start.sh"]
