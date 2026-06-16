-- Airtrek Dashboard sample SQLite database — schema v0.2.
-- Mirrors docs/backend.md §1 exactly. Same DDL runs unchanged on Cloudflare D1.
--
-- Run with:
--   rm -f airtrek-sample.db && sqlite3 airtrek-sample.db < schema.sql
--
-- Seed timestamps are expressed relative to "now" so the metric queries
-- (last 30 days, MTD, …) stay meaningful whenever you re-seed.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE zone (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('hangar','ramp','apron_spot')),
  hmi_hangar_id TEXT UNIQUE,
  x_pct         REAL,
  y_pct         REAL,
  center_lat    REAL,
  center_lon    REAL,
  bbox_lat_min  REAL,
  bbox_lat_max  REAL,
  bbox_lon_min  REAL,
  bbox_lon_max  REAL
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

CREATE TABLE robot_credential (
  id           INTEGER PRIMARY KEY,
  robot_id     INTEGER NOT NULL REFERENCES robot(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  last_used_at TEXT
);

CREATE TABLE operator (
  id          INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  email       TEXT,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mission (
  id                INTEGER PRIMARY KEY,
  hmi_mission_uuid  TEXT UNIQUE,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  tail_number       TEXT NOT NULL,
  operator_id       INTEGER REFERENCES operator(id),
  tug_id            INTEGER REFERENCES tug(id),
  route_from_id     INTEGER REFERENCES zone(id),
  route_to_id       INTEGER REFERENCES zone(id),
  total_distance_ft INTEGER,
  max_speed_mph     REAL,
  battery_end_pct   INTEGER,
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','completed','warning','aborted')),
  flagged           INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mission_started  ON mission(started_at);
CREATE INDEX idx_mission_tug      ON mission(tug_id);
CREATE INDEX idx_mission_operator ON mission(operator_id);
CREATE INDEX idx_mission_flagged  ON mission(flagged) WHERE flagged = 1;

CREATE TABLE mission_robot (
  mission_id    INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  robot_id      INTEGER NOT NULL REFERENCES robot(id),
  side          TEXT NOT NULL CHECK (side IN ('port','starboard')),
  battery_start INTEGER,
  battery_end   INTEGER,
  PRIMARY KEY (mission_id, robot_id)
);

CREATE TABLE mission_bag (
  bag_key    TEXT PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES mission(id),
  sequence   INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT
);
CREATE INDEX idx_bag_mission ON mission_bag(mission_id);

CREATE TABLE mission_processing (
  bag_key       TEXT PRIMARY KEY,
  mission_id    INTEGER REFERENCES mission(id),
  status        TEXT NOT NULL CHECK (status IN ('queued','parsing','transcoding','done','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  bytes         INTEGER,
  duration_ms   INTEGER,
  started_at    TEXT,
  completed_at  TEXT
);

CREATE TABLE event (
  id             INTEGER PRIMARY KEY,
  client_uuid    TEXT UNIQUE,
  mission_id     INTEGER NOT NULL REFERENCES mission(id),
  occurred_at    TEXT NOT NULL,
  offset_seconds INTEGER,
  type           TEXT CHECK (type IS NULL OR type IN ('obstacle_proximity','speed_warning','manual_flag','fault')),
  severity       TEXT CHECK (severity IS NULL OR severity IN ('info','warning','critical')),
  details_json   TEXT
);
CREATE INDEX idx_event_mission ON event(mission_id);

CREATE TABLE mission_media (
  id               INTEGER PRIMARY KEY,
  mission_id       INTEGER NOT NULL REFERENCES mission(id),
  kind             TEXT NOT NULL CHECK (kind IN ('left_wing','right_wing','sensor_overlay','bev','gps_track','screenshot','person_snapshot')),
  r2_key           TEXT NOT NULL UNIQUE,
  content_type     TEXT,
  bytes            INTEGER,
  duration_seconds REAL,
  uploaded_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_mission ON mission_media(mission_id);
CREATE UNIQUE INDEX uq_media_mission_kind ON mission_media(mission_id, kind);

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

INSERT INTO zone (id, name, type, hmi_hangar_id, x_pct, y_pct, center_lat, center_lon, bbox_lat_min, bbox_lat_max, bbox_lon_min, bbox_lon_max) VALUES
  (1, 'Hangar 1', 'hangar', 'h1',   14, 64, 36.3140, -82.4015, 36.3138, 36.3142, -82.4017, -82.4013),
  (2, 'Hangar 2', 'hangar', 'h2',   35, 63, 36.3142, -82.4008, 36.3140, 36.3144, -82.4010, -82.4006),
  (3, 'Hangar 3', 'hangar', 'h3',   56, 69, 36.3144, -82.4001, 36.3142, 36.3146, -82.4003, -82.3999),
  (4, 'Ramp',     'ramp',   'ramp', 50, 24, 36.3155, -82.4010, 36.3150, 36.3160, -82.4020, -82.4000);

INSERT INTO tug (id, name, model, current_zone_id, condition) VALUES
  (1, 'Lektro',   'AP88',        3, 'Good'),
  (2, 'Mototok',  'Spacer 8200', 3, 'Good'),
  (3, 'Harlan',   'HTAP-50',     1, 'Service Due'),
  (4, 'Towflexx', 'TF1',         3, 'Good');

INSERT INTO robot (id, name, battery_pct, condition, last_seen_at) VALUES
  (1, 'Robot 01', 94, 'Good', datetime('now', '-15 minutes')),
  (2, 'Robot 02', 88, 'Good', datetime('now', '-15 minutes'));

-- Operators auto-registered on first sighting from HmiTelemetry.operator_id.
-- external_id is whatever the auth provider hands out as the JWT subject.
INSERT INTO operator (id, external_id, full_name, email, role) VALUES
  (1, 'op_550e8400-e29b-41d4-a716-446655440001', 'Chris Lee',      'chris.lee@airtrekrobotics.com',     'operator'),
  (2, 'op_550e8400-e29b-41d4-a716-446655440002', 'Huzefa Dossaji', 'huzefa.dossaji@airtrekrobotics.com','operator'),
  (3, 'op_550e8400-e29b-41d4-a716-446655440003', 'Jon Taylor',     'jon.taylor@airtrekrobotics.com',    'operator'),
  (4, 'op_550e8400-e29b-41d4-a716-446655440004', 'David Ladnier',  'david.ladnier@airtrekrobotics.com', 'operator');

-- 8 missions across the last week. Mission 8 is still in progress; mission 3
-- demonstrates a multi-bag mission (two bags grouped by hmi_mission_uuid).
INSERT INTO mission
  (id, hmi_mission_uuid,                             started_at,                              ended_at,                                                  tail_number, operator_id, tug_id, route_from_id, route_to_id, total_distance_ft, max_speed_mph, battery_end_pct, status,        flagged)
VALUES
  (1, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0001',   datetime('now', '-3 hours'),            datetime('now', '-3 hours', '+18 minutes'),                'N412EF',    1, 1, 1, 4, 478,  3.4, 84, 'completed',   0),
  (2, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0002',   datetime('now', '-7 hours'),            datetime('now', '-7 hours', '+22 minutes'),                'N715SD',    2, 2, 2, 3, 612,  3.1, 88, 'completed',   0),
  (3, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0003',   datetime('now', '-1 day', '-2 hours'),  datetime('now', '-1 day', '-2 hours', '+55 minutes'),      'N342AT',    3, 3, 4, 1, 542,  2.9, 72, 'completed',   1),
  (4, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0004',   datetime('now', '-1 day', '-6 hours'),  datetime('now', '-1 day', '-6 hours', '+15 minutes'),      'N102QX',    4, 1, 3, 4, 720,  3.8, 65, 'warning',     1),
  (5, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0005',   datetime('now', '-2 days'),             datetime('now', '-2 days', '+20 minutes'),                 'N586BJ',    1, 1, 1, 2, 305,  3.0, 91, 'completed',   0),
  (6, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0006',   datetime('now', '-3 days'),             datetime('now', '-3 days', '+24 minutes'),                 'N994LL',    2, 4, 2, 4, 580,  3.5, 78, 'completed',   0),
  (7, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0007',   datetime('now', '-5 days'),             datetime('now', '-5 days', '+19 minutes'),                 'N812XP',    3, 1, 4, 3, 410,  2.7, 84, 'completed',   0),
  (8, 'mis_3b1c8a3e-c19d-4a01-8f7a-1f1b8a5c0008',   datetime('now', '-20 minutes'),         NULL,                                                       'N554BB',    4, 2, 1, 4, NULL, NULL, NULL, 'in_progress', 0);

-- Both robots participate in every mission (port + starboard wingtip).
INSERT INTO mission_robot (mission_id, robot_id, side, battery_start, battery_end) VALUES
  (1, 1, 'port',      96, 84), (1, 2, 'starboard', 95, 82),
  (2, 1, 'port',      99, 88), (2, 2, 'starboard', 98, 86),
  (3, 1, 'port',      88, 72), (3, 2, 'starboard', 90, 70),
  (4, 1, 'port',      82, 65), (4, 2, 'starboard', 85, 63),
  (5, 1, 'port',      99, 91), (5, 2, 'starboard', 98, 89),
  (6, 1, 'port',      94, 78), (6, 2, 'starboard', 96, 76),
  (7, 1, 'port',      97, 84), (7, 2, 'starboard', 95, 82),
  (8, 1, 'port',      94, NULL),(8, 2, 'starboard', 88, NULL);

-- Bags. Mission 3 has TWO bags (the customer paused and resumed; same UUID).
INSERT INTO mission_bag (bag_key, mission_id, sequence, started_at, ended_at) VALUES
  ('raw/sucw/robot_1/airtrek_customer_robot_1_001.mcap', 1, 0, datetime('now','-3 hours'),                                datetime('now','-3 hours','+18 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_002.mcap', 2, 0, datetime('now','-7 hours'),                                datetime('now','-7 hours','+22 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_003.mcap', 3, 0, datetime('now','-1 day','-2 hours'),                       datetime('now','-1 day','-2 hours','+28 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_004.mcap', 3, 1, datetime('now','-1 day','-2 hours','+30 minutes'),         datetime('now','-1 day','-2 hours','+55 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_005.mcap', 4, 0, datetime('now','-1 day','-6 hours'),                       datetime('now','-1 day','-6 hours','+15 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_006.mcap', 5, 0, datetime('now','-2 days'),                                 datetime('now','-2 days','+20 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_007.mcap', 6, 0, datetime('now','-3 days'),                                 datetime('now','-3 days','+24 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_008.mcap', 7, 0, datetime('now','-5 days'),                                 datetime('now','-5 days','+19 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_009.mcap', 8, 0, datetime('now','-20 minutes'),                             NULL);

-- Post-processing pipeline state per bag.
INSERT INTO mission_processing (bag_key, mission_id, status, attempt_count, bytes, duration_ms, started_at, completed_at) VALUES
  ('raw/sucw/robot_1/airtrek_customer_robot_1_001.mcap', 1, 'done',  1, 482344960,  48230, datetime('now','-3 hours','+19 minutes'), datetime('now','-3 hours','+20 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_002.mcap', 2, 'done',  1, 618573824,  61240, datetime('now','-7 hours','+23 minutes'), datetime('now','-7 hours','+24 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_003.mcap', 3, 'done',  1, 712450048,  72120, datetime('now','-1 day','-2 hours','+29 minutes'), datetime('now','-1 day','-2 hours','+30 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_004.mcap', 3, 'done',  1, 590221312,  59300, datetime('now','-1 day','-2 hours','+56 minutes'), datetime('now','-1 day','-2 hours','+57 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_005.mcap', 4, 'done',  1, 405110784,  42050, datetime('now','-1 day','-6 hours','+16 minutes'), datetime('now','-1 day','-6 hours','+17 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_006.mcap', 5, 'done',  1, 537919488,  54100, datetime('now','-2 days','+21 minutes'), datetime('now','-2 days','+22 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_007.mcap', 6, 'done',  1, 643137536,  64880, datetime('now','-3 days','+25 minutes'), datetime('now','-3 days','+26 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_008.mcap', 7, 'done',  1, 510066688,  51420, datetime('now','-5 days','+20 minutes'), datetime('now','-5 days','+21 minutes')),
  ('raw/sucw/robot_1/airtrek_customer_robot_1_009.mcap', 8, 'queued',0, NULL,       NULL,  NULL,                                       NULL);

-- First-class events copied from the bag's dedicated event topic.
INSERT INTO event (client_uuid, mission_id, occurred_at, offset_seconds, type, severity) VALUES
  ('evt_8a3e1c-7b9d-001', 3, datetime('now','-1 day','-2 hours','+7 minutes'),  420, 'obstacle_proximity', 'warning'),
  ('evt_8a3e1c-7b9d-002', 4, datetime('now','-1 day','-6 hours','+3 minutes'),  180, 'obstacle_proximity', 'warning'),
  ('evt_8a3e1c-7b9d-003', 4, datetime('now','-1 day','-6 hours','+11 minutes'), 660, 'speed_warning',      'info');

-- Derived media — H264 access units muxed (`ffmpeg -c copy`) into MP4 per feed.
INSERT INTO mission_media (mission_id, kind, r2_key, content_type, bytes, duration_seconds) VALUES
  (3, 'left_wing',      'derived/missions/3/left_wing.mp4',      'video/mp4', 18874368, 1500),
  (3, 'right_wing',     'derived/missions/3/right_wing.mp4',     'video/mp4', 17825792, 1500),
  (3, 'sensor_overlay', 'derived/missions/3/sensor_overlay.mp4', 'video/mp4', 23068672, 1500),
  (4, 'left_wing',      'derived/missions/4/left_wing.mp4',      'video/mp4', 12058624,  900),
  (4, 'right_wing',     'derived/missions/4/right_wing.mp4',     'video/mp4', 11534336,  900);
