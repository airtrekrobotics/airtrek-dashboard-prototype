-- Example dashboard queries against the sample database (schema v0.2).
-- Run with:
--   sqlite3 airtrek-sample.db < queries.sql

.headers on
.mode column

SELECT '── Total Tows (30D) ──' AS '';
SELECT COUNT(*) AS total_tows_30d
FROM mission
WHERE started_at >= datetime('now','-30 days');

SELECT '── Total Tows (MTD) ──' AS '';
SELECT COUNT(*) AS total_tows_mtd
FROM mission
WHERE started_at >= strftime('%Y-%m-01', 'now');

SELECT '── Avg. Tow Time (30D), CTE form so AVG evaluates once ──' AS '';
WITH s AS (
  SELECT AVG((julianday(ended_at) - julianday(started_at)) * 86400) AS avg_s
  FROM mission
  WHERE ended_at IS NOT NULL AND started_at >= datetime('now','-30 days')
)
SELECT printf('%dm %02ds',
              CAST(avg_s / 60 AS INTEGER),
              CAST(avg_s AS INTEGER) % 60) AS avg_tow_time_30d
FROM s;

SELECT '── Daily counts (zero-filled across the 30-day window) ──' AS '';
WITH RECURSIVE days(d) AS (
  SELECT date('now','-29 days')
  UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now')
)
SELECT d AS day, COALESCE(c.tows, 0) AS tows
FROM days
LEFT JOIN (
  SELECT date(started_at) AS day, COUNT(*) AS tows
  FROM mission
  WHERE started_at >= datetime('now','-30 days')
  GROUP BY day
) c ON c.day = days.d
ORDER BY day;

SELECT '── Hourly distribution (divides by ACTUAL day span, zero-filled hours) ──' AS '';
WITH RECURSIVE hours(h) AS (
  SELECT 0 UNION ALL SELECT h+1 FROM hours WHERE h < 23
), span AS (
  SELECT MAX(1.0, julianday('now') - julianday(MIN(started_at))) AS days
  FROM mission WHERE started_at >= datetime('now','-30 days')
), counts AS (
  SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour, COUNT(*) AS c
  FROM mission
  WHERE started_at >= datetime('now','-30 days')
  GROUP BY hour
)
SELECT hours.h AS hour,
       printf('%.2f', COALESCE(counts.c, 0) / (SELECT days FROM span)) AS avg_per_hour
FROM hours
LEFT JOIN counts ON counts.hour = hours.h
ORDER BY hour;

SELECT '── Per-tug usage (count + total distance) ──' AS '';
SELECT tug.name AS tug,
       COUNT(m.id) AS tows,
       COALESCE(SUM(m.total_distance_ft), 0) AS total_ft,
       printf('%.1f', COALESCE(SUM(m.total_distance_ft), 0) / 5280.0) AS miles
FROM tug
LEFT JOIN mission m ON m.tug_id = tug.id
GROUP BY tug.id;

SELECT '── Per-operator usage ──' AS '';
SELECT COALESCE(o.full_name, o.external_id) AS operator,
       COUNT(m.id) AS tows
FROM operator o
LEFT JOIN mission m ON m.operator_id = o.id
GROUP BY o.id
ORDER BY tows DESC;

SELECT '── Per-robot usage (via mission_robot) ──' AS '';
SELECT r.name AS robot,
       COUNT(mr.mission_id) AS tows
FROM robot r
LEFT JOIN mission_robot mr ON mr.robot_id = r.id
GROUP BY r.id;

SELECT '── Flagged for Review ──' AS '';
SELECT COUNT(*) AS flagged_count FROM mission WHERE flagged = 1;

SELECT '── Recent missions (History view, joined to lookup tables) ──' AS '';
.width 4 19 9 18 12 22 8 12 7
SELECT m.id, m.started_at, m.tail_number,
       COALESCE(o.full_name, o.external_id) AS operator,
       tug.name AS tug,
       printf('%s -> %s', zf.name, zt.name) AS route,
       m.total_distance_ft AS distance,
       m.status, m.flagged
FROM mission m
LEFT JOIN operator o ON o.id = m.operator_id
LEFT JOIN tug      ON tug.id = m.tug_id
LEFT JOIN zone zf  ON zf.id = m.route_from_id
LEFT JOIN zone zt  ON zt.id = m.route_to_id
ORDER BY m.started_at DESC;

SELECT '── Drill-down: mission 3 events ──' AS '';
.width 3 4 19 7 22 9
SELECT id, mission_id, occurred_at, offset_seconds, type, severity
FROM event WHERE mission_id = 3 ORDER BY occurred_at;

SELECT '── Drill-down: mission 3 bags (multi-bag mission) ──' AS '';
.width 4 9 50 21
SELECT mission_id, sequence, bag_key, started_at FROM mission_bag WHERE mission_id = 3 ORDER BY sequence;

SELECT '── Drill-down: mission 3 media ──' AS '';
.width 3 4 16 36 10 10 9
SELECT id, mission_id, kind, r2_key, content_type, bytes, duration_seconds
FROM mission_media WHERE mission_id = 3;

SELECT '── Pipeline health: bags not yet processed ──' AS '';
SELECT bag_key, status, attempt_count, last_error
FROM mission_processing
WHERE status IN ('queued','parsing','transcoding','failed')
ORDER BY bag_key;
