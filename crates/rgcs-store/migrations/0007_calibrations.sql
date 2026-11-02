-- 2026-10-20: 点検・校正 (spec 10 §7, 60 §2). ArduPilot keeps no calibration dates, so every
-- run started from RGCS is recorded here; the tab shows the latest one per kind.
CREATE TABLE calibrations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sysid     INTEGER NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('accel', 'compass', 'level', 'rc', 'esc', 'motor')),
  ok        INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  operator  TEXT NOT NULL,
  detail    TEXT
);
CREATE INDEX calibrations_sysid_kind ON calibrations (sysid, kind, id);
