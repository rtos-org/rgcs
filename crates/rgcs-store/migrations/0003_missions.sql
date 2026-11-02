-- P3: saved mission plans (spec 60 §3.8). `home` / `items` are JSON of the rgcs-core types.
CREATE TABLE missions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  sysid         INTEGER,
  default_alt   REAL NOT NULL,
  default_frame TEXT NOT NULL CHECK (default_frame IN ('rel', 'abs', 'ter')),
  speed         REAL NOT NULL,
  home          TEXT,
  items         TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
