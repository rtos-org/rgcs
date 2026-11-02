-- 2026-10-31: docomo LTE area overlay. One row per named rectangle; tiles live in
-- <data_dir>/lte/{z}/{x}/{y}.gif. Times are unix ms; `last_error` is a short code.
CREATE TABLE lte_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  south REAL NOT NULL,
  west REAL NOT NULL,
  north REAL NOT NULL,
  east REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  tiles_total INTEGER NOT NULL DEFAULT 0,
  tiles_ok INTEGER NOT NULL DEFAULT 0,
  tiles_failed INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER,
  data_modified INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
