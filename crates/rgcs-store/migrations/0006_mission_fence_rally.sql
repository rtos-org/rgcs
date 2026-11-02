-- 2026-10-19: geofence zones and rally points planned with a mission (JSON of rgcs-core types).
ALTER TABLE missions ADD COLUMN fence TEXT NOT NULL DEFAULT '[]';
ALTER TABLE missions ADD COLUMN rally TEXT NOT NULL DEFAULT '[]';
