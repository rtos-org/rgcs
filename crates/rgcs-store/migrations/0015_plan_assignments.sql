-- 2026-10-31: plan assignment board. One row per vehicle: its assigned plan and the last
-- saved plan written to it (id + `updated_at` version). `written_plan_id` is history, no FK.
CREATE TABLE plan_assignments (
  sysid INTEGER PRIMARY KEY,
  plan_id INTEGER REFERENCES missions(id) ON DELETE SET NULL,
  assigned_by TEXT,
  assigned_at INTEGER,
  written_plan_id INTEGER,
  written_plan_updated_at INTEGER,
  written_at INTEGER,
  written_by TEXT
);
