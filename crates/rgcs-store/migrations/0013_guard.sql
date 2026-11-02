-- 2026-10-25: AI 緊急介入 decision records and external-data source settings (plan 2026-10-25-ai-guard).
CREATE TABLE guard_decisions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  sysid     INTEGER NOT NULL,
  alert_id  TEXT NOT NULL,
  event     TEXT NOT NULL CHECK (event IN ('toilet_bowl')),
  phase     TEXT NOT NULL,
  level     TEXT NOT NULL CHECK (level IN ('l0','l1','l2','l3')),
  flight_id INTEGER,
  record    TEXT NOT NULL
);
CREATE INDEX guard_decisions_sysid_ts ON guard_decisions (sysid, ts);
CREATE TABLE env_sources (
  id         TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL,
  interval_s INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
