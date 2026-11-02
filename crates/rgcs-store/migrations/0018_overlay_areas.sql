-- 2026-11-01: plugin overlays (design 2026-11-01-plugin-overlays) replace the docomo LTE overlay.
-- Areas are scoped by plugin and overlay; tiles live in
-- <data_dir>/overlays/<plugin_id>/<overlay_id>/{z}/{x}/{y}.<format>. The LTE rows (internal
-- evaluation only) are not carried over: the area is fetched again through the plugin.
CREATE TABLE overlay_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  overlay_id TEXT NOT NULL,
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
CREATE INDEX overlay_areas_by_overlay ON overlay_areas (plugin_id, overlay_id);
DROP TABLE lte_areas;
