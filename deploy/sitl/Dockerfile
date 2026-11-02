# ArduPilot SITL in Docker (scripts/sitl-docker.sh): the toolchain only. The ArduPilot checkout
# is mounted at build time (copter / plane / rover into .dev/sitl-docker/build), never copied in.
FROM ubuntu:24.04
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ccache g++ git python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# empy must stay below 4 for ArduPilot's code generators.
RUN python3 -m venv /opt/ap-venv \
 && /opt/ap-venv/bin/pip install --no-cache-dir empy==3.3.4 pexpect future lxml setuptools dronecan
ENV PATH=/opt/ap-venv/bin:$PATH
COPY sitl-run.sh /usr/local/bin/sitl-run
RUN chmod 0755 /usr/local/bin/sitl-run
