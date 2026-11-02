-- 2026-10-21: survey-grid blocks (JSON of rgcs-core SurveyBlock) planned with a mission.
ALTER TABLE missions ADD COLUMN surveys TEXT NOT NULL DEFAULT '[]';
