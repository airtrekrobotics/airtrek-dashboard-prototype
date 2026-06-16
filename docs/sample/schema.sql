-- Airtrek Dashboard sample SQLite database.
-- Run with:
--   rm -f airtrek-sample.db && sqlite3 airtrek-sample.db < schema.sql
--
-- Seed timestamps are expressed relative to "now" so the metric queries
-- (last 30 days, etc.) stay meaningful whenever you re-seed.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Tables (mirror docs/backend.md)
-- ---------------------------------------------------------------------------

CREATE TABLE zone (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  type   TEXT NOT NULL,            -- 'hangar' | 'ramp'
  x_pct  REAL,
  y_pct  REAL
);

CREATE TABLE tug (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  model           TEXT,
  current_zone_id INTEGER REFERENCES zone(id),
  condition       TEXT,
  notes           TEXT
);

CREATE TABLE robot (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  battery_pct  INTEGER,
  condition    TEXT,
  last_seen_at TEXT
);

CREATE TABLE mission (
  id                INTEGER PRIMARY KEY,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  tail_number       TEXT NOT NULL,
  operator_name     TEXT NOT NULL,
  tug_id            INTEGER REFERENCES tug(id),
  route_from_id     INTEGER REFERENCES zone(id),
  route_to_id       INTEGER REFERENCES zone(id),
  total_distance_ft INTEGER,
  max_speed_mph     REAL,
  battery_end_pct   INTEGER,
  status            TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress|online|warning|aborted
  flagged           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mission_started ON mission(started_at);
CREATE INDEX idx_mission_tug     ON mission(tug_id);
CREATE INDEX idx_mission_flagged ON mission(flagged) WHERE flagged = 1;

CREATE TABLE event (
  id             INTEGER PRIMARY KEY,
  mission_id     INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  occurred_at    TEXT NOT NULL,
  offset_seconds INTEGER,
  type           TEXT,
  severity       TEXT,
  details_json   TEXT
);
CREATE INDEX idx_event_mission ON event(mission_id);

CREATE TABLE mission_media (
  id               INTEGER PRIMARY KEY,
  mission_id       INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  r2_key           TEXT NOT NULL,
  content_type     TEXT,
  bytes            INTEGER,
  duration_seconds REAL,
  uploaded_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_mission ON mission_media(mission_id);

-- ---------------------------------------------------------------------------
-- Seed data (small but representative)
-- ---------------------------------------------------------------------------

INSERT INTO zone (id, name, type, x_pct, y_pct) VALUES
  (1, 'Hangar 1', 'hangar', 14, 64),
  (2, 'Hangar 2', 'hangar', 35, 63),
  (3, 'Hangar 3', 'hangar', 56, 69),
  (4, 'Ramp',     'ramp',   50, 24);

INSERT INTO tug (id, name, model, current_zone_id, condition) VALUES
  (1, 'Lektro',   'AP88',        3, 'Good'),
  (2, 'Mototok',  'Spacer 8200', 3, 'Good'),
  (3, 'Harlan',   'HTAP-50',     1, 'Service Due'),
  (4, 'Towflexx', 'TF1',         3, 'Good');

INSERT INTO robot (id, name, battery_pct, condition, last_seen_at) VALUES
  (1, 'Robot 01', 94, 'Good', datetime('now', '-15 minutes')),
  (2, 'Robot 02', 88, 'Good', datetime('now', '-15 minutes'));

-- 8 missions across the last week (id 8 is still in progress)
INSERT INTO mission
  (id, started_at,                              ended_at,                                                  tail_number, operator_name,   tug_id, route_from_id, route_to_id, total_distance_ft, max_speed_mph, battery_end_pct, status,        flagged)
VALUES
  (1,  datetime('now', '-3 hours'),             datetime('now', '-3 hours', '+18 minutes'),                'N412EF',    'Chris Lee',       1, 1, 4, 478,  3.4, 84, 'online',      0),
  (2,  datetime('now', '-7 hours'),             datetime('now', '-7 hours', '+22 minutes'),                'N715SD',    'Huzefa Dossaji',  2, 2, 3, 612,  3.1, 88, 'online',      0),
  (3,  datetime('now', '-1 day', '-2 hours'),   datetime('now', '-1 day', '-2 hours', '+25 minutes'),      'N342AT',    'Jon Taylor',      3, 4, 1, 542,  2.9, 72, 'online',      1),
  (4,  datetime('now', '-1 day', '-6 hours'),   datetime('now', '-1 day', '-6 hours', '+15 minutes'),      'N102QX',    'David Ladnier',   1, 3, 4, 720,  3.8, 65, 'warning',     1),
  (5,  datetime('now', '-2 days'),              datetime('now', '-2 days', '+20 minutes'),                 'N586BJ',    'Chris Lee',       1, 1, 2, 305,  3.0, 91, 'online',      0),
  (6,  datetime('now', '-3 days'),              datetime('now', '-3 days', '+24 minutes'),                 'N994LL',    'Huzefa Dossaji',  4, 2, 4, 580,  3.5, 78, 'online',      0),
  (7,  datetime('now', '-5 days'),              datetime('now', '-5 days', '+19 minutes'),                 'N812XP',    'Jon Taylor',      1, 4, 3, 410,  2.7, 84, 'online',      0),
  (8,  datetime('now', '-20 minutes'),          NULL,                                                       'N554BB',    'David Ladnier',   2, 1, 4, NULL, NULL, NULL, 'in_progress', 0);

-- Events on a couple of missions
INSERT INTO event (mission_id, occurred_at, offset_seconds, type, severity) VALUES
  (3, datetime('now', '-1 day', '-2 hours', '+7 minutes'),  420, 'obstacle_proximity', 'warning'),
  (4, datetime('now', '-1 day', '-6 hours', '+3 minutes'),  180, 'obstacle_proximity', 'warning'),
  (4, datetime('now', '-1 day', '-6 hours', '+11 minutes'), 660, 'speed_warning',      'info');

-- Media pointers (the actual bytes would live in R2; these reference fake keys)
INSERT INTO mission_media (mission_id, kind, r2_key, content_type, bytes, duration_seconds) VALUES
  (3, 'left_wing',      'missions/3/left_wing.mp4',      'video/mp4', 18874368, 1500),
  (3, 'right_wing',     'missions/3/right_wing.mp4',     'video/mp4', 17825792, 1500),
  (3, 'sensor_overlay', 'missions/3/sensor_overlay.mp4', 'video/mp4', 23068672, 1500);
