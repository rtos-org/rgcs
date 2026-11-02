-- 2026-10-22: GPS ROI presets and control parameters per vehicle (spec 60 §3.4).
CREATE TABLE roi_targets (
  sysid      INTEGER NOT NULL,
  id         TEXT NOT NULL CHECK (id IN ('roi_1','roi_2','roi_3','roi_4','roi_5','roi_6','roi_7','roi_8','roi_9','roi_10')),
  name       TEXT NOT NULL DEFAULT '',
  lat        REAL NOT NULL DEFAULT 0,
  lon        REAL NOT NULL DEFAULT 0,
  alt_msl    REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sysid, id)
);
CREATE TABLE roi_control (
  sysid           INTEGER PRIMARY KEY,
  control_mode    TEXT NOT NULL DEFAULT 'rate' CHECK (control_mode IN ('rate','angle')),
  rate_hz         REAL NOT NULL DEFAULT 10,
  target_rate_hz  REAL NOT NULL DEFAULT 2,
  smoothing_tau_s REAL NOT NULL DEFAULT 0.8,
  deadband_deg    REAL NOT NULL DEFAULT 0.3,
  pid_kp          REAL NOT NULL DEFAULT 2.0,
  pid_ki          REAL NOT NULL DEFAULT 0.2,
  pid_kd          REAL NOT NULL DEFAULT 0,
  max_speed       REAL NOT NULL DEFAULT 60,
  yaw_offset_deg  REAL NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);
