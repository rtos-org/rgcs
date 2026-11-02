# Native linux/arm64 build image for the Pi binary (Apple Silicon host: no emulation).
# bookworm = Raspberry Pi OS 12, so the binary links against glibc <= 2.36.
FROM rust:1-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends binutils file \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
