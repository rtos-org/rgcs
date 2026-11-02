-- 2026-10-20: briefings, named sets of saved missions with a colour and a vehicle per row.
-- No foreign key to missions: a deleted mission leaves its row, which reads back as missing.
CREATE TABLE briefings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  active_mission_id INTEGER,
  created_by        TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE TABLE briefing_missions (
  briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  mission_id  INTEGER NOT NULL,
  color       TEXT NOT NULL,
  sysid       INTEGER,
  PRIMARY KEY (briefing_id, position)
);
