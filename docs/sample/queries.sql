-- Example dashboard queries against the sample database.
-- Run with:
--   sqlite3 airtrek-sample.db < queries.sql

.headers on
.mode column
.width 22 12 14 14 18

SELECT '── Total Tows (30D) ──' AS '';
SELECT COUNT(*) AS total_tows_30d
FROM mission
WHERE started_at >= datetime('now','-30 days');

SELECT '── Total Tows (MTD) ──' AS '';
SELECT COUNT(*) AS total_tows_mtd
FROM mission
WHERE started_at >= strftime('%Y-%m-01', 'now');

SELECT '── Avg. Tow Time (30D) ──' AS '';
SELECT
  printf('%dm %02ds',
    CAST(AVG((julianday(ended_at) - julianday(started_at)) * 86400) / 60 AS INTEGER),
    CAST(AVG((julianday(ended_at) - julianday(started_at)) * 86400) AS INTEGER) % 60
  ) AS avg_tow_time_30d
FROM mission
WHERE ended_at IS NOT NULL AND started_at >= datetime('now','-30 days');

SELECT '── Daily counts (last 30 days) ──' AS '';
SELECT date(started_at) AS day, COUNT(*) AS tows
FROM mission
WHERE started_at >= datetime('now','-30 days')
GROUP BY day
ORDER BY day;

SELECT '── Hourly distribution (last 30 days, avg/day) ──' AS '';
SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour,
       printf('%.2f', COUNT(*) / 30.0) AS avg_per_hour
FROM mission
WHERE started_at >= datetime('now','-30 days')
GROUP BY hour
ORDER BY hour;

SELECT '── Per-tug usage ──' AS '';
SELECT tug.name AS tug,
       COUNT(m.id) AS tows,
       COALESCE(SUM(m.total_distance_ft), 0) AS total_ft,
       printf('%.1f', COALESCE(SUM(m.total_distance_ft), 0) / 5280.0) AS miles
FROM tug
LEFT JOIN mission m ON m.tug_id = tug.id
GROUP BY tug.id;

SELECT '── Flagged for Review ──' AS '';
SELECT COUNT(*) AS flagged_count FROM mission WHERE flagged = 1;

SELECT '── Recent missions (History view) ──' AS '';
.width 4 19 9 16 9 21 8 12 7
SELECT m.id, m.started_at, m.tail_number, m.operator_name, tug.name AS tug,
       printf('%s -> %s', zf.name, zt.name) AS route,
       m.total_distance_ft AS distance, m.status, m.flagged
FROM mission m
LEFT JOIN tug ON tug.id = m.tug_id
LEFT JOIN zone zf ON zf.id = m.route_from_id
LEFT JOIN zone zt ON zt.id = m.route_to_id
ORDER BY m.started_at DESC;

SELECT '── Drill-down: mission 3 events ──' AS '';
.width 3 4 19 7 22 9
SELECT id, mission_id, occurred_at, offset_seconds, type, severity
FROM event WHERE mission_id = 3 ORDER BY occurred_at;

SELECT '── Drill-down: mission 3 media ──' AS '';
.width 3 4 16 32 10 10 9
SELECT id, mission_id, kind, r2_key, content_type, bytes, duration_seconds
FROM mission_media WHERE mission_id = 3;
