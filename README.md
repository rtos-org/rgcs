# RGCS

[日本語](README.ja.md)

RGCS is a web ground control station for [ArduPilot](https://ardupilot.org) vehicles:
Copter, QuadPlane, Plane and Rover.
- A single Rust server, `rgcs-server`, speaks MAVLink to the vehicles and relays camera control and
  video. It serves the web UI.
- Operators use a browser on the LAN or over LTE / VPN.
- The server is small enough to run on the vehicle's companion computer (Raspberry Pi), or on a
  laptop next to the radio.

> **Status: early development (0.x).** RGCS is used for development and field trials. It is not
> certified for any operation. You are responsible for flying safely and lawfully, and for
> checking every plan in a simulator first. See [Safety](#safety).

## Features

- **Operations map**
  - 2D / 3D map of every connected vehicle, with tracks, attitude, battery, link and messages.
  - Commands: arm, takeoff, mode, RTL / land and guided "fly here". Arm, disarm, takeoff and
    mission start need a confirmation in the UI.
- **Flight plans**
  - Waypoint missions in 2D and 3D with terrain profiles, survey grids, geofence and rally points.
  - Several plans open at once, compared side by side and assigned to vehicles.
  - Pre-flight checks with one-click fixes.
  - Exact `.waypoints` round trip with Mission Planner.
- **Video and cameras**
  - WebRTC video through MediaMTX.
  - SIYI MT11 gimbal camera control: zoom, thermal, AI tracking, GPS ROI.
  - MAVLink cameras and gimbals, and gamepad / joystick input.
- **Maintenance**
  - Parameter editor with ArduPilot metadata.
  - Calibrations, daily inspections, flight logbook and maintenance records, with PDF / CSV export.
  - DataFlash log download.
- **Situational data**
  - Weather, wind and space-weather factors from public sources.
  - An experimental guard that warns on (and can respond to) dangerous situations, with consent
    and audit.
- **Audience page**: a read-only view for a second screen, behind a revocable link.
- **AI chat (optional)**: ask about the vehicles. It only proposes commands; nothing is sent
  without the operator's click.
  - Providers: Anthropic, or OpenAI-compatible servers such as Ollama.
- **Plugins**: add map overlays and links by dropping a `plugin.toml` into a folder. See
  [PLUGINS.md](PLUGINS.md).
- **UI languages**: English, Japanese, Simplified Chinese and Korean. The default follows the
  browser.

## Repository layout

| Path | |
|---|---|
| `apps/rgcs-server` | the server (axum) and, in `ui/`, the web UI (React, MapLibre) |
| `crates/rgcs-core` | shared domain types; TypeScript bindings are generated with ts-rs |
| `crates/rgcs-mavlink` | MAVLink link, routing, commands and the parameter, mission and log protocols |
| `crates/rgcs-mission` | mission model and `.waypoints` reading / writing |
| `crates/rgcs-store` | SQLite storage and migrations |
| `crates/rgcs-camera`, `rgcs-video`, `rgcs-input` | camera / gimbal drivers, video relay, gamepad input |
| `crates/rgcs-ai`, `rgcs-guard`, `rgcs-env` | AI chat providers, the guard, external data sources |
| `deploy/` | Raspberry Pi install script, systemd unit, `config.toml.example`, MediaMTX config |
| `scripts/` | dev stack, SITL in Docker, e2e tests, Pi build |
| `examples/plugins/` | example plugins |

## Quick start (development)

Requirements:
- Rust (stable, installed via `rust-toolchain.toml`).
- Node.js 22.
- Docker, to run ArduPilot SITL without building it yourself.
- An ArduPilot checkout next to this repository (`../ardupilot`, or set `ARDUPILOT_DIR`).
- For video: MediaMTX and ffmpeg.

```sh
# once: build the SITL image from your ArduPilot checkout
scripts/sitl-docker.sh build

# one copter in SITL + rgcs-server + the UI with hot reload
scripts/dev.sh --docker --sitl 1
# then open http://127.0.0.1:5173 and sign in as admin / admin (development login)

# one of each vehicle type, the MT11 camera simulator and a test video stream
scripts/dev.sh --docker --sitl 1 --quadplane --plane --rover --siyi-sim --video
```

`scripts/dev.sh --help` lists every option. Runtime files live in `.dev/` (git-ignored).

### Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

cd apps/rgcs-server/ui
npm ci
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test -- --run

scripts/e2e.sh            # Playwright against a real server on :8010
```

## Deploying on a Raspberry Pi

`scripts/build-pi.sh` builds an aarch64 release with the UI embedded and packs it with the
installer. On the Pi:

```sh
tar xzf rgcs-pi-<version>.tar.gz && cd rgcs-pi-<version> && sudo ./install.sh
```

The steps, MediaMTX and the audience page are covered in [deploy/README.md](deploy/README.md).
Settings live in `/etc/rgcs/config.toml`; the common keys are explained in
[deploy/config.toml.example](deploy/config.toml.example).

**Security**: the development login `admin` / `admin` stays active until you create accounts.
Expose port 8000 only on the vehicle LAN or a VPN. Report vulnerabilities privately, as described
in [SECURITY.md](SECURITY.md), never in a public issue.

## Map and data sources

RGCS does not bundle map data. By default it requests the sources below from the internet.
Check each provider's terms for your use, and replace a source in `config.toml` when you need
to.

| Data | Default source | Notes |
|---|---|---|
| Base maps | OpenStreetMap tiles, GSI Japan (地理院タイル) | OSM's tile servers are for light use only ([policy](https://operations.osmfoundation.org/policies/tiles/)); configure your own provider with `[[basemaps]]` for regular use |
| 3D terrain | AWS Terrain Tiles (Terrarium) | `terrain_tiles = ""` turns 3D off |
| Place search | OpenStreetMap Nominatim, from the browser | subject to Nominatim's [usage policy](https://operations.osmfoundation.org/policies/nominatim/) |
| Weather | Open-Meteo, JMA AMeDAS, OpenWeatherMap (with your key) | Open-Meteo's free API is for non-commercial use; set an API key for commercial use |
| Space weather | NOAA SWPC, GFZ Kp index | |

Plugins can add more sources. Their terms are the plugin author's and user's responsibility.

## Safety

- RGCS sends real commands to real aircraft. Arm, takeoff and mission start need a confirmation
  in the UI, and the server refuses them without it. That does not make a plan safe.
- Fly new plans in SITL first. Keep a manual pilot and an independent failsafe (RC, RTL / land
  settings on the vehicle).
- Coverage, weather and terrain data are planning aids from third parties. They carry no
  guarantee, especially in the air.

## Contributing

Issues and pull requests are welcome, in English or Japanese. See [CONTRIBUTING.md](CONTRIBUTING.md).
Code contributions need the [Contributor License Agreement](CLA.md): you keep your copyright, and
your contribution always stays available under RGCS's open licence.

## License

RGCS is © 2026 RtoS Co., Ltd. It is licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE), with the
[RGCS Plugin Exception](LICENSE-EXCEPTION.md): a plugin that uses RGCS only through the interface
documented in [PLUGINS.md](PLUGINS.md) may use any license.

If you run a modified RGCS for users over a network, the AGPL requires that you offer them its
source code.

Third-party components keep their own licenses:
- the IBM Plex Sans JP and IBM Plex Mono UI fonts (bundled from Fontsource, SIL OFL 1.1) and the
  Noto Sans JP font for PDF forms (`assets/fonts`, SIL OFL 1.1);
- ArduPilot parameter metadata (`apps/rgcs-server/ui/public/params`, GPL-3.0);
- the Rust and npm dependencies listed in `Cargo.lock` and `package-lock.json`.

"RGCS" and its logo are trademarks of RtoS Co., Ltd. Forks and modified versions are welcome under
another name: see [TRADEMARKS.md](TRADEMARKS.md).
