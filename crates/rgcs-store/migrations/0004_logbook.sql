-- P5: vehicle registry + pilot columns, inspection templates/runs (様式 2), flights + squawks
-- (様式 1), maintenance records (様式 3), stored DataFlash logs (addendum §5.5 / §5.6 / §5.8).
-- Record tables are append-only; a correction is a new row with `supersedes = <old id>`.

ALTER TABLE vehicles ADD COLUMN registration TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN uas_type TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN type_cert_no TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN airworthiness_class TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN airworthiness_no TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN manufacturer TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN serial_no TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN initial_flight_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN inspection_template_id INTEGER;

ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN license_no TEXT NOT NULL DEFAULT '';

CREATE TABLE inspection_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE inspection_template_items (
  template_id INTEGER NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  label       TEXT NOT NULL,
  detail      TEXT NOT NULL,
  PRIMARY KEY (template_id, position)
);

CREATE TABLE inspection_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sysid            INTEGER NOT NULL,
  template_id      INTEGER NOT NULL,
  template_name    TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  place            TEXT NOT NULL,
  lat              REAL,
  lon              REAL,
  performed_on     TEXT NOT NULL,
  inspector        TEXT NOT NULL,
  notes            TEXT NOT NULL,
  supersedes       INTEGER,
  created_by       TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE TABLE inspection_results (
  run_id   INTEGER NOT NULL REFERENCES inspection_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label    TEXT NOT NULL,
  detail   TEXT NOT NULL,
  result   TEXT NOT NULL CHECK (result IN ('ok', 'ng', 'skipped')),
  remark   TEXT NOT NULL,
  PRIMARY KEY (run_id, position)
);

CREATE TABLE flights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sysid           INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('draft', 'confirmed')),
  pilot           TEXT NOT NULL,
  pilot_license   TEXT NOT NULL,
  takeoff_at      INTEGER NOT NULL,
  landed_at       INTEGER,
  takeoff_lat     REAL,
  takeoff_lon     REAL,
  landing_lat     REAL,
  landing_lon     REAL,
  takeoff_place   TEXT NOT NULL DEFAULT '',
  landing_place   TEXT NOT NULL DEFAULT '',
  purposes        TEXT NOT NULL DEFAULT '[]',
  specific_flight TEXT NOT NULL DEFAULT '[]',
  summary         TEXT NOT NULL DEFAULT '',
  safety_notes    TEXT NOT NULL DEFAULT '',
  supersedes      INTEGER,
  created_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX flights_sysid_takeoff ON flights (sysid, takeoff_at);

CREATE TABLE flight_squawks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_id   INTEGER NOT NULL REFERENCES flights(id),
  occurred_on TEXT NOT NULL,
  description TEXT NOT NULL,
  action_on   TEXT NOT NULL,
  action      TEXT NOT NULL,
  confirmer   TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE maintenance_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sysid         INTEGER NOT NULL,
  performed_on  TEXT NOT NULL,
  total_minutes INTEGER NOT NULL,
  detail        TEXT NOT NULL,
  reason        TEXT NOT NULL,
  place         TEXT NOT NULL,
  engineer      TEXT NOT NULL,
  notes         TEXT NOT NULL,
  supersedes    INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE flight_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sysid      INTEGER NOT NULL,
  flight_id  INTEGER REFERENCES flights(id),
  fc_log_id  INTEGER,
  filename   TEXT NOT NULL,
  size       INTEGER NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('mavlink', 'upload')),
  fetched_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

-- Default template: MLIT 様式 2 の 9 項目 (取扱要領 別添).
INSERT INTO inspection_templates (id, name, version, created_by, created_at, updated_at)
  VALUES (1, '様式2 標準', 1, 'system', 0, 0);
INSERT INTO inspection_template_items (template_id, position, label, detail) VALUES
  (1, 1, '機体全般', '機器の取り付け状態(ネジ、コネクタ、ケーブル等)'),
  (1, 2, 'プロペラ', '外観、損傷、ゆがみ'),
  (1, 3, 'フレーム', '外観、損傷、ゆがみ'),
  (1, 4, '通信系統', '機体と操縦装置の通信品質の健全性'),
  (1, 5, '推進系統', 'モーター又は発動機の健全性'),
  (1, 6, '電源系統', '機体及び操縦装置の電源の健全性'),
  (1, 7, '自動制御系統', '飛行制御装置の健全性'),
  (1, 8, '操縦装置', '外観、スティックの健全性、スイッチの健全性'),
  (1, 9, 'バッテリー、燃料', 'バッテリーの充電状況、残燃料表示機能の健全性');
