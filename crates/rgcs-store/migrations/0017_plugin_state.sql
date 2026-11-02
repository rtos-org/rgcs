-- 2026-11-01: plugins (design 2026-11-01-plugin-overlays). An admin's on/off choice per plugin
-- directory; no row means enabled.
CREATE TABLE plugin_state (
  plugin_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL
);
