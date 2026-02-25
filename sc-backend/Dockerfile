# ── Stage 1: Build SuperCollider 3.14.1 from source ──────────────────────────
# No Linux binary is available for SC 3.14; must build from source.
# SC_QT=OFF: headless build, no Qt dependency at all.
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential cmake git \
    libjack-jackd2-dev \
    libsndfile1-dev \
    libfftw3-dev \
    libavahi-client-dev \
    libudev-dev \
    libicu-dev \
    libreadline-dev \
    libncurses-dev \
    && rm -rf /var/lib/apt/lists/*

# Clone with submodules (boost, yaml-cpp, etc. are vendored)
RUN git clone --depth 1 --branch Version-3.14.1 --recurse-submodules \
    https://github.com/supercollider/supercollider.git /sc-src

RUN cmake -B /sc-build -S /sc-src \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DSC_QT=OFF \
        -DSC_IDE=OFF \
        -DSUPERNOVA=OFF \
        -DNO_X11=ON \
        -DINSTALL_HELP=ON \
        -DINSTALL_OLD_HELP=OFF \
        -DINSTALL_EXAMPLE_PROJECTS=OFF \
    && cmake --build /sc-build --parallel $(nproc) \
    && cmake --install /sc-build

# ── Pre-render SC help to static HTML ────────────────────────────────────────
# SCDoc.renderAll is synchronous; writes HTML to helpTargetDir then the sentinel
# file signals completion. sclang is killed once rendering is done.
RUN mkdir -p /usr/local/share/SuperCollider/Help && \
    sh -c ' \
        printf "SCDoc.helpTargetDir = \"/usr/local/share/SuperCollider/Help\"; SCDoc.renderAll; File.new(\"/tmp/sc-help-done\",\"w\").close;\n" \
            | sclang & \
        SCPID=$!; i=0; \
        while [ "$i" -lt 300 ] && [ ! -f /tmp/sc-help-done ]; do sleep 2; i=$((i+2)); done; \
        echo "[help] Rendered in ${i}s"; \
        kill $SCPID 2>/dev/null; wait $SCPID 2>/dev/null; true \
    '

# ── Stage 2: Runtime image ────────────────────────────────────────────────────
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ── Runtime packages ──────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    # JACK dummy backend + jack_connect/jack_lsp tools + libjack-jackd2-0
    jackd2 \
    # SC runtime shared libraries
    libsndfile1 \
    libfftw3-double3 \
    libavahi-client3 \
    libudev1 \
    libicu70 \
    libreadline8 \
    libncurses6 \
    # Audio: PulseAudio null sink (for optional monitoring)
    pulseaudio \
    pulseaudio-utils \
    libasound2-plugins \
    alsa-utils \
    # ffmpeg: JACK client → encode MP3 → push to Icecast
    # Ubuntu 22.04 ffmpeg is compiled with --enable-libjack --enable-libmp3lame
    ffmpeg \
    # Utilities
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Copy SC 3.14.1 binaries and class library from builder ───────────────────
COPY --from=builder /usr/local/bin/sclang  /usr/local/bin/sclang
COPY --from=builder /usr/local/bin/scsynth /usr/local/bin/scsynth
COPY --from=builder /usr/local/share/SuperCollider /usr/local/share/SuperCollider
COPY --from=builder /usr/local/lib/SuperCollider   /usr/local/lib/SuperCollider

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
