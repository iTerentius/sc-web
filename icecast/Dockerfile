FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Pre-answer debconf so icecast2 installs non-interactively
RUN apt-get update && \
    echo "icecast2 icecast2/icecast-setup boolean false" | debconf-set-selections && \
    apt-get install -y icecast2 && \
    rm -rf /var/lib/apt/lists/*

COPY icecast.xml /etc/icecast2/icecast.xml

EXPOSE 8000

CMD ["icecast2", "-c", "/etc/icecast2/icecast.xml"]
