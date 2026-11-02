-- 2026-10-21: shared survey camera list (photogrammetry survey grid). The built-in row is
-- seeded here and cannot be edited or deleted through the API.
CREATE TABLE survey_cameras (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  sensor_w_mm    REAL NOT NULL,
  sensor_h_mm    REAL NOT NULL,
  image_w_px     INTEGER NOT NULL,
  image_h_px     INTEGER NOT NULL,
  focal_mm       REAL NOT NULL,
  shutter_s      REAL NOT NULL,
  min_interval_s REAL NOT NULL,
  builtin        INTEGER NOT NULL DEFAULT 0
);
INSERT INTO survey_cameras
  (name, sensor_w_mm, sensor_h_mm, image_w_px, image_h_px, focal_mm, shutter_s, min_interval_s, builtin)
VALUES ('Sony α7R IV 35mm', 35.7, 23.8, 9504, 6336, 35.0, 0.001, 1.0, 1);
