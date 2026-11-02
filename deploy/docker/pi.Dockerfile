# A Raspberry Pi OS (bookworm, arm64) stand-in with systemd as PID 1, for testing the
# deployment (deploy/install.sh) end to end. Not used on the real Pi.
FROM debian:bookworm
ENV container=docker DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus socat curl iproute2 \
      file python3 ca-certificates sudo procps \
 && rm -rf /var/lib/apt/lists/*
# Units that make no sense in a container.
RUN systemctl mask systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket \
      getty.target console-getty.service systemd-firstboot.service
# The Pi's default user; dialout grants the serial port like on the real Pi.
RUN useradd -m -u 1000 -G dialout,sudo -s /bin/bash pi
COPY mt11-camera-ui.service fc-link.service mt11-sim.service /etc/systemd/system/
COPY fc-link.sh /usr/local/bin/fc-link
RUN chmod 0755 /usr/local/bin/fc-link \
 && printf 'FC_MODE=udp\nFC_HOST=host.docker.internal\nFC_PORT=5760\n' >/etc/default/fc-link \
 && systemctl enable mt11-camera-ui.service fc-link.service mt11-sim.service
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
