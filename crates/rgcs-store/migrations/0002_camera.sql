-- P2: camera profiles (spec 60 §3.3), gimbal joystick profile, presentation tokens.
CREATE TABLE camera_profiles (
  sysid             INTEGER PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('none', 'mavlink', 'siyi_mt11')),
  host              TEXT NOT NULL,
  port              INTEGER NOT NULL,
  rtsp_url          TEXT NOT NULL,
  comp_id           INTEGER NOT NULL,
  video_source_mode TEXT NOT NULL CHECK (video_source_mode IN ('auto', 'mt11')),
  android_url       TEXT NOT NULL,
  encoding_preset   TEXT NOT NULL,
  thermal_palette   INTEGER NOT NULL,
  thermal_overlay   INTEGER NOT NULL,
  ai_box_px         INTEGER NOT NULL,
  clock_sync        INTEGER NOT NULL,
  auto_record       INTEGER NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE gimbal_input_profile (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE presentation_tokens (
  token      TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
