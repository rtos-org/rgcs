-- RGCS schema v1 (docs/spec/60-data-model.md). Append-only migrations.
CREATE TABLE users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('operator', 'admin')),
  created_at    TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL REFERENCES users(username),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE audit_log (
  id       INTEGER PRIMARY KEY,
  ts       TEXT NOT NULL,
  operator TEXT NOT NULL,
  sysid    INTEGER,
  target   TEXT NOT NULL,
  command  TEXT NOT NULL,
  args     TEXT,
  result   TEXT NOT NULL,
  reason   TEXT
);
CREATE INDEX audit_log_ts ON audit_log(ts);

CREATE TABLE param_history (
  id        INTEGER PRIMARY KEY,
  ts        TEXT NOT NULL,
  operator  TEXT NOT NULL,
  sysid     INTEGER NOT NULL,
  name      TEXT NOT NULL,
  old_value REAL,
  new_value REAL NOT NULL,
  verified  INTEGER NOT NULL
);

CREATE TABLE vehicles (
  sysid      INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  notes      TEXT
);

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
