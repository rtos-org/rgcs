-- 2026-10-18 design: the persistent message log (spec 10 §1, 50 §2.2). AUTOINCREMENT keeps
-- ids unique across restarts so acknowledgements always point at the right row.
CREATE TABLE messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  sysid        INTEGER,
  source       TEXT NOT NULL CHECK (source IN ('vehicle', 'link', 'command', 'system')),
  severity     TEXT NOT NULL CHECK (severity IN ('info', 'ok', 'warn', 'error')),
  raw_severity INTEGER,
  text         TEXT NOT NULL,
  acked_by     TEXT,
  acked_at     INTEGER
);
CREATE INDEX messages_sysid_id ON messages (sysid, id);
