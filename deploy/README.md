# Deploying rgcs-server on a Raspberry Pi

RGCS runs on the vehicle's companion computer: a Raspberry Pi 4 / 5 (64-bit Raspberry Pi OS or
Debian) next to the flight controller, optionally with Rpanion-server and MediaMTX.

## 1. Build

On a development machine with Docker:

```sh
scripts/build-pi.sh
```

This writes `dist/pi/rgcs-pi-<version>.tar.gz`, which contains:
- `rgcs-server`: aarch64, release build, with the UI embedded;
- `install.sh`, `rgcs-server.service` and `config.toml.example`.

## 2. Install or upgrade

Copy the archive to the Pi, then:

```sh
tar xzf rgcs-pi-<version>.tar.gz && cd rgcs-pi-<version> && sudo ./install.sh
```

The installer:
- puts the binary in `/opt/rgcs/bin`;
- creates the system user `rgcs` (in `dialout`, for serial links) and the data directory
  `/var/lib/rgcs`;
- writes `/etc/rgcs/config.toml` from the example **only if it does not exist**;
- installs and starts `rgcs-server.service`.

It then waits for `/api/health`. If the new binary does not answer in time, the previous one is
restored automatically.

Upgrades use the same command. `sudo ./install.sh --rollback` restores the previous release by
hand.

On the first install, edit `/etc/rgcs/config.toml` and run `sudo systemctl restart rgcs-server`.
- `mavlink_url`: the flight controller link.
- `whep_upstream`: only with video.
- The common keys are explained in [config.toml.example](config.toml.example).

`data_dir` (`/var/lib/rgcs`) holds:
- the SQLite database;
- the audience logo;
- downloaded logs;
- plugin overlay tiles.

Plugins go in `/var/lib/rgcs/plugins`, see [PLUGINS.md](../PLUGINS.md).

**Security**: the development login `admin` / `admin` stays active until accounts are created.
Expose port 8000 only on the vehicle LAN or a VPN, never directly to the internet.

## 3. Video (optional)

Install [MediaMTX](https://github.com/bluenviron/mediamtx). Copy `mediamtx.yml` to
`/usr/local/etc/mediamtx.yml` and enable its service.

The example relays a SIYI MT11 RTSP stream (`rtsp://192.168.144.25:8554/video1`) as WebRTC:
- Signalling stays on `127.0.0.1:8889`, because `rgcs-server` relays the browsers' WHEP offers
  (`whep_upstream`).
- Media leaves on UDP / TCP 8189. Allow that port only from the operators' LAN or VPN.

`rgcs-server.service` conflicts with the older `mt11-camera-ui.service`. Both open the MT11's
TCP control port, which accepts a single client, so never run them together.

## 4. Audience view (optional)

1. Create a link in the UI: user menu → **Audience view**.
2. Open `/present?t=…` in a separate browser window on the second screen and press F11.
3. Revoke the link afterwards.

## Before a flight

1. Plan in RGCS (**Flight plan**) and save the plan.
2. Use **Export .waypoints** to simulate the plan in SITL or Mission Planner first. If you edit it
   there, import the file back: the `.waypoints` round trip is exact.
3. On the day, let only RGCS talk to the vehicle. **Write to vehicle** reads the mission back and
   compares it before you arm.

## Trying it without a Pi

`scripts/pi-sim.sh up` runs a Pi equivalent in Docker (systemd, the same paths and the installer).
`tests/pi/accept-deploy.sh` runs the deployment checks against it.

For development on your own machine, see the [README](../README.md#quick-start-development).
