-- Flight plans replaced briefings (2026-10-31): the planner keeps its open plans in the browser,
-- and each saved plan is a row of `missions`. Saved briefings are dropped, not migrated.
DROP TABLE briefing_missions;
DROP TABLE briefings;
