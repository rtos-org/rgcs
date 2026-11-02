# RGCS plugins

A plugin adds map overlays and links to RGCS without changing its code. You place a folder holding
a `plugin.toml` in the server's plugins directory and restart the server.

This file is the **Plugin Interface** that the RGCS Plugin Exception in
[`LICENSE-EXCEPTION.md`](LICENSE-EXCEPTION.md) refers to. A plugin that uses RGCS only through
what is documented here may be distributed under any terms. See the exception for the exact
conditions.

Plugin format version: **`api = 1`**. Plugins of this version are data only: RGCS never runs code
from a plugin.

## Installing a plugin

1. Find the plugins directory:
   - It is `plugins_dir` in `config.toml`.
   - If that is not set, it is `<data_dir>/plugins`, e.g. `/var/lib/rgcs/plugins`.
2. Copy the plugin folder into it. The folder name must equal the plugin's `id`:

   ```
   /var/lib/rgcs/plugins/
   └── openseamap/
       └── plugin.toml
   ```

3. Restart the server. Plugins are read once, at start.
4. Check **App settings → Plugins**. Each plugin shows its version and what it adds, or why it did
   not load.
   - An admin can switch a plugin off there. The choice is stored on the server.
   - A new plugin starts switched on: placing the folder is the admin's decision.

A plugin that fails to load never stops the server. It is listed with an error code (see
[Errors](#errors)), and the rest of RGCS keeps working.

## Using the overlays

Plugin overlays appear in the map-type menu (the layers button) of the operations map and the
flight-plan map, under **Overlays**:

- **Switch and opacity**: each overlay has its own switch and opacity slider. Both are remembered
  per browser.
- **Legend**: shown under the overlay while it is on.
- **Manage areas…**: for `area` overlays. It opens a sheet where you add the rectangle currently
  in view, watch the fetch progress, and refresh or delete areas.
- **Notice**: while an overlay with a `notice` is on, its notice is shown at the bottom of the
  map. For an `area` overlay the newest fetch date and data date are added to it.
- **Layer order**: overlays sit above the base map and below every RGCS layer (mission path,
  fence, rally points, tracks and vehicles), ordered by plugin and overlay id.

## `plugin.toml` reference

The file is [TOML](https://toml.io).
- It is limited to 64 KiB.
- **Unknown keys are errors**, so a typo is reported instead of being silently ignored.

### Top level

| Key | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | `^[a-z0-9][a-z0-9-]{0,39}$`, equal to the folder name |
| `api` | integer | yes | `1` |
| `version` | string | yes | the plugin's own version, 1–20 characters |
| `name` | text | yes | shown in the menu and the settings |
| `description` | text | no | shown in the settings |
| `author` | string | no | 1–200 characters |
| `homepage` | string | no | `https` URL |
| `[[overlay]]` | table array | no | at most 8 |
| `[[link]]` | table array | no | at most 16 |

### Text

Every user-visible value is **text**, which can be written in two forms:

- A plain string, used for every UI language: `name = "Sea marks"`.
- A table with `en` (required) and optional `ja`, `zh` (Simplified Chinese) and `ko`:
  `name = { en = "Sea marks", ja = "海図標識" }`.

The UI shows the current language and falls back to `en`. Each value is 1–200 characters of plain
text; HTML is not interpreted.

### `[[overlay]]`

| Key | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | same rule as the plugin id, unique in the plugin |
| `name` | text | yes | |
| `tiles` | string | yes | `https` or `http` URL template with `{z}`, `{x}` and `{y}` (XYZ / Web Mercator, y down); no other `{…}`; at most 500 characters |
| `cache` | string | yes | `"area"` or `"direct"` (below) |
| `format` | string | yes | `"gif"` or `"png"` |
| `tile_size` | integer | yes | `256` or `512` |
| `min_zoom` | integer | yes | 0–22, at most `max_zoom`; the layer is hidden below it |
| `max_zoom` | integer | yes | 0–22; the map over-zooms above it |
| `default_opacity` | integer | no | 10–100 percent, default 60 |
| `attribution` | text | no | added to the map attribution while the overlay is on |
| `notice` | text | no | shown on the map while the overlay is on |
| `[[overlay.legend]]` | table array | no | `color = "#rrggbb"`, `label` = text |

**`cache = "direct"`**: the browser loads the tiles from `tiles` itself.
- Use this for sources whose terms allow use straight from the browser.
- RGCS stores nothing.

**`cache = "area"`**: the RGCS server fetches the tiles of chosen rectangles ahead of time,
stores them and serves them from its own origin.
- Use this when the browser should not reach the source in the field: offline sites, or
  same-origin delivery.
- Only use it when the source's terms allow storing and redistributing its tiles.
- `max_zoom - min_zoom` must be at most 8.

What the server does for an `area` overlay:
- Users choose rectangles in the UI. A rectangle needing more than 3000 tiles over
  `min_zoom..=max_zoom` is refused before anything is fetched.
- Fetch limits, across all plugins:
  - at most 2 requests in flight, 100 ms apart;
  - 10 s timeout, no redirects, 512 KiB per tile;
  - `User-Agent: RGCS/<version>`.
- A tile is kept only when:
  - the HTTP status is 200;
  - the content type and magic bytes match `format` (GIF87a/89a, or a PNG with its IHDR);
  - the image is `tile_size` square.
- An HTML answer (a maintenance page, a login wall) is detected and counted as failed. A failed
  tile keeps any copy already stored.
- Tiles are stored under `<data_dir>/overlays/<plugin>/<overlay>/{z}/{x}/{y}.<format>`.
- A tile not stored yet is served as a transparent tile, so the map never shows an error.
- URLs and response bodies are never logged.

### `[[link]]`

| Key | Type | Required | Rules |
|---|---|---|---|
| `label` | text | yes | |
| `url` | string | yes | `https` URL; opened in a new tab without referrer |

Links are listed in the map-type menu under the plugin's name.

### Example: a `direct` overlay

```toml
id = "openseamap"
api = 1
version = "1.0.0"
name = { en = "OpenSeaMap", ja = "OpenSeaMap" }
description = { en = "Sea marks from OpenSeaMap over the base map." }
homepage = "https://openseamap.org/"

[[overlay]]
id = "seamarks"
name = { en = "Sea marks", ja = "海図標識" }
tiles = "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
cache = "direct"
format = "png"
tile_size = 256
min_zoom = 9
max_zoom = 18
default_opacity = 100
attribution = "© OpenSeaMap contributors (CC BY-SA)"
notice = { en = "Not for navigation", ja = "航海用ではありません" }

[[link]]
label = { en = "OpenSeaMap website", ja = "OpenSeaMap のサイト" }
url = "https://map.openseamap.org/"
```

The same file is in [`examples/plugins/openseamap`](examples/plugins/openseamap/plugin.toml).

### Example: an `area` overlay

```toml
id = "coverage"
api = 1
version = "1.0.0"
name = "Coverage"

[[overlay]]
id = "lte"
name = { en = "LTE coverage", ja = "LTE エリア" }
tiles = "https://tiles.example.com/coverage/{z}/{x}/{y}.png"
cache = "area"
format = "png"
tile_size = 256
min_zoom = 8
max_zoom = 14
notice = { en = "Public coverage map. No guarantee in the air.", ja = "公開エリアマップ・上空通信の保証なし" }

[[overlay.legend]]
color = "#ff7f00"
label = "LTE"
```

## Errors

A plugin that did not load is listed in the settings with one of these codes:

| Code | Meaning |
|---|---|
| `parse` | not valid TOML, a wrong type, a missing required key or an unknown key |
| `bad_id` | the plugin or an overlay id breaks the id rule |
| `id_mismatch` | `id` differs from the folder name |
| `api_version` | `api` is not a version this RGCS understands |
| `bad_url` | a tile template, link or homepage URL breaks its rule |
| `bad_zoom` | `min_zoom` > `max_zoom`, `max_zoom` > 22, or an `area` span over 8 |
| `duplicate_overlay` | two overlays share an id |
| `too_large` | `plugin.toml` is over 64 KiB |
| `too_many` | more than 8 overlays or 16 links |
| `bad_value` | tile size, opacity, legend colour, or a text or version that is empty or too long |
| `no_en_text` | a text table has no `en` |

## HTTP API

The UI uses these endpoints. Tools may use them too: they are part of the Plugin Interface. Every
call needs a login session, and every write needs the header `X-Requested-With: rgcs`.

| Method | Path | |
|---|---|---|
| GET | `/api/plugins` | every plugin found, with status, error code, enabled, texts, overlays and links |
| PUT | `/api/plugins/{plugin}` | admin only: `{"enabled": true \| false}` |
| GET | `/api/plugins/{plugin}/overlays/{overlay}/areas` | the areas of an `area` overlay |
| POST | `/api/plugins/{plugin}/overlays/{overlay}/areas/estimate` | `{south, west, north, east}` → `{tiles}` |
| POST | `/api/plugins/{plugin}/overlays/{overlay}/areas` | `{name, south, west, north, east}`: saves the area and starts fetching |
| POST | `/api/plugins/{plugin}/overlays/{overlay}/areas/{id}/refresh` | fetches the area again |
| DELETE | `/api/plugins/{plugin}/overlays/{overlay}/areas/{id}` | removes the area and the tiles no other area covers |
| GET | `/api/plugins/{plugin}/overlays/{overlay}/tiles/{z}/{x}/{y}.{format}` | a stored tile, or a transparent one |

The area and tile routes answer 404 for an unknown, disabled or `direct` overlay.

## Your responsibilities as a plugin author

- **Data terms**: a plugin only points at data. Whether you may show, store or redistribute
  that data is up to its provider's terms:
  - Many map and coverage providers forbid copying their tiles; do not package those as `area`
    overlays.
  - Give the attribution the provider asks for.
- **Safety**: overlays are a planning aid. Use `notice` to say what the data does not
  guarantee (for example, ground coverage maps say nothing about coverage in the air).

## Compatibility

`api` is raised only when the format changes in a way older RGCS versions cannot read. Later
stages (UI scripts and server-side plugins) will be documented here under new `api` versions
before they are supported.
