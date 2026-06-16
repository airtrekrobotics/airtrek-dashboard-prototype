# Airtrek Dashboard — Backend Design Notes (v0.2)

A design doc for the backend that will feed the
[customer-facing dashboard](https://airtrekrobotics.github.io/airtrek-dashboard-prototype/).
The dashboard today runs on a seeded mock dataset; this doc sketches what it
takes to swap that for a real Cloudflare-native backend.

**Status:** v0.2 — incorporates the [review](backend-review.md) findings
(critical + important items) and the operational reality of the
[customer_recorder](https://github.com/airtrekrobotics/) bag-based recording
pipeline. Five open architectural questions remain (§5).

## Stack

- **Cloudflare D1** — serverless SQLite for the structured "view."
- **Cloudflare R2** — object storage for raw MCAP bags and derived video.
- **Cloudflare Workers** — the API the dashboard reads from.
- **Cloudflare Container** (or a small VPS) — the post-processor that turns
  bags into D1 rows + derived video.

D1 fits this data shape and stays cheap (generous free tier; ~$0 at prototype
scale). Caveat: D1 is SQLite under the hood — single-region writes,
eventually-consistent global read replicas. Plenty fast for the foreseeable
future; only revisit if you're doing millions of writes/day or need
synchronous multi-region.

## Contents
1. [Schema](#1-schema)
2. [How the dashboard maps to the schema](#2-how-the-dashboard-maps-to-the-schema)
3. [Ingest — bag → R2 → post-processor → D1](#3-ingest--bag--r2--post-processor--d1)
4. [Read API for the dashboard](#4-read-api-for-the-dashboard)
5. [Open questions](#5-open-questions)
6. [Cost considerations](#6-cost-considerations)

## 1. Schema

Eleven tables. The five "core" tables from v0.1 are still recognizable but
hardened with idempotency keys, CHECK constraints, and a few additions
required by the bag-based pipeline (`operator`, `mission_bag`,
`mission_processing`, `mission_robot`, `robot_credential`).

```sql
PRAGMA foreign_keys = ON;

-- Map zones the aircraft moves between (hangars, ramp, apron parking).
CREATE TABLE zone (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,                          -- 'Hangar 1', 'Ramp'
  type          TEXT NOT NULL CHECK (type IN ('hangar','ramp','apron_spot')),
  hmi_hangar_id TEXT UNIQUE,                                    -- matches MissionCommand.hangar_id
  -- map coordinates as % (drives dashboard map rendering)
  x_pct         REAL,
  y_pct         REAL,
  -- geographic bounds for end-point inference from final-GPS telemetry
  center_lat    REAL,
  center_lon    REAL,
  bbox_lat_min  REAL,
  bbox_lat_max  REAL,
  bbox_lon_min  REAL,
  bbox_lon_max  REAL
);

-- Tugs (Lektro, Mototok, Harlan, Towflexx, ...).
CREATE TABLE tug (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  model           TEXT,
  current_zone_id INTEGER REFERENCES zone(id),
  condition       TEXT,
  notes           TEXT
);

-- Wingtip robots (2 today; designed for more).
CREATE TABLE robot (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,                            -- 'Robot 01'
  battery_pct  INTEGER,                                          -- last reported
  condition    TEXT,
  last_seen_at TEXT
);

-- Long-lived API keys for the NX uploader + (future) robots that write directly.
CREATE TABLE robot_credential (
  id           INTEGER PRIMARY KEY,
  robot_id     INTEGER NOT NULL REFERENCES robot(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,                            -- bcrypt/argon2 of the bearer token
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  last_used_at TEXT
);

-- Operators (HMI tablet users). Auto-registered on first sighting by external_id.
CREATE TABLE operator (
  id          INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,                             -- HmiTelemetry.operator_id (JWT subject)
  full_name   TEXT,                                              -- nullable; admin fills in post-hoc
  email       TEXT,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Core table: one row per mission (a logical wingwalking session).
-- A mission may span MULTIPLE BAGS — see mission_bag.
CREATE TABLE mission (
  id                INTEGER PRIMARY KEY,
  hmi_mission_uuid  TEXT UNIQUE,                                 -- emitted by HMI; groups bags into missions
  started_at        TEXT NOT NULL,                               -- ISO-8601 UTC; first SUMMON
  ended_at          TEXT,                                         -- null until last bag's terminal idle
  tail_number       TEXT NOT NULL,                               -- from HmiTelemetry.active_tail
  operator_id       INTEGER REFERENCES operator(id),
  tug_id            INTEGER REFERENCES tug(id),                  -- NULL until HMI starts sending tug info
  route_from_id     INTEGER REFERENCES zone(id),                 -- from SUMMON.hangar_id, or 'Ramp' for apron-coord SUMMONs
  route_to_id       INTEGER REFERENCES zone(id),                 -- inferred from final GPS via zone bbox
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

-- Which robots participated in a mission, and per-robot battery deltas.
CREATE TABLE mission_robot (
  mission_id    INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  robot_id      INTEGER NOT NULL REFERENCES robot(id),
  side          TEXT NOT NULL CHECK (side IN ('port','starboard')),
  battery_start INTEGER,
  battery_end   INTEGER,
  PRIMARY KEY (mission_id, robot_id)
);

-- Many-to-one: bags that belong to a mission, grouped by hmi_mission_uuid.
-- bag_key is the R2 key of the raw MCAP (e.g. 'raw/sucw/robot_1/airtrek_customer_robot_1_20260527T144712.mcap').
CREATE TABLE mission_bag (
  bag_key    TEXT PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES mission(id),
  sequence   INTEGER NOT NULL,                                   -- ordering within the mission (0,1,2,…)
  started_at TEXT NOT NULL,
  ended_at   TEXT
);
CREATE INDEX idx_bag_mission ON mission_bag(mission_id);

-- Post-processing pipeline state, one row per bag.
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

-- First-class events copied verbatim from a dedicated bag topic (TBD).
-- client_uuid is the message UUID from the event payload; UNIQUE makes
-- re-processing the same bag idempotent.
CREATE TABLE event (
  id             INTEGER PRIMARY KEY,
  client_uuid    TEXT UNIQUE,
  mission_id     INTEGER NOT NULL REFERENCES mission(id),
  occurred_at    TEXT NOT NULL,                                  -- absolute UTC
  offset_seconds INTEGER,                                         -- seconds into the mission (video timeline)
  type           TEXT CHECK (type IS NULL OR type IN ('obstacle_proximity','speed_warning','manual_flag','fault')),
  severity       TEXT CHECK (severity IS NULL OR severity IN ('info','warning','critical')),
  details_json   TEXT
);
CREATE INDEX idx_event_mission ON event(mission_id);

-- Pointers to derived video / screenshots in R2. The bag-extracted H264 access
-- units are muxed (`ffmpeg -c copy`, no re-encode) into per-feed MP4s.
CREATE TABLE mission_media (
  id               INTEGER PRIMARY KEY,
  mission_id       INTEGER NOT NULL REFERENCES mission(id),
  kind             TEXT NOT NULL CHECK (kind IN ('left_wing','right_wing','sensor_overlay','bev','gps_track','screenshot','person_snapshot')),
  r2_key           TEXT NOT NULL UNIQUE,                        -- e.g. 'derived/missions/123/left_wing.mp4'
  content_type     TEXT,
  bytes            INTEGER,
  duration_seconds REAL,
  uploaded_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_mission ON mission_media(mission_id);
CREATE UNIQUE INDEX uq_media_mission_kind ON mission_media(mission_id, kind);
```

Schema notes:
- **All timestamps UTC ISO-8601**; convert in the UI.
- **`flagged` is a column on `mission`** (not a side table) — single bit, indexed via partial index.
- **`mission.tug_id` is NULL** until the HMI starts publishing tug info; the post-processor leaves it alone otherwise.
- **`operator.full_name` is nullable** because the post-processor auto-creates operator rows from the JWT subject (`external_id`) on first sighting; an admin UI fills in the human-readable bits later.
- **`zone.hmi_hangar_id`** is the canonical string the HMI ships in `MissionCommand.hangar_id`; might or might not equal the dashboard-display `name`.
- **R2 keys live in two prefixes:** `raw/<site>/<robot>/<bag>.mcap` for incoming bags; `derived/missions/<id>/<kind>.mp4` for post-processor output. Lifecycle policies can be applied per prefix.
- **Cascade behavior:** only `mission_robot` and `event`/`mission_media`/`mission_bag` could cascade. They don't — missions are audit history; deletion should be a deliberate admin action. (Add `deleted_at` if soft-delete is needed.)

## 2. How the dashboard maps to the schema

Every metric card and chart in the live dashboard is one indexed query against
`mission`. The queries below are the production-grade versions (the v0.1 doc
had a few subtle bugs around hardcoded divisors and missing-day fills; see
[backend-review.md](backend-review.md) §I1–I2).

```sql
-- Total Tows (30D)
SELECT COUNT(*) FROM mission
WHERE started_at >= datetime('now','-30 days');

-- Total Tows (MTD)
SELECT COUNT(*) FROM mission
WHERE started_at >= strftime('%Y-%m-01', 'now');

-- Avg. Tow Time (30D), formatted "Xm YYs"; AVG evaluated once via CTE.
WITH s AS (
  SELECT AVG((julianday(ended_at) - julianday(started_at)) * 86400) AS avg_s
  FROM mission
  WHERE ended_at IS NOT NULL AND started_at >= datetime('now','-30 days')
)
SELECT printf('%dm %02ds',
              CAST(avg_s / 60 AS INTEGER),
              CAST(avg_s AS INTEGER) % 60) AS avg_tow_time_30d
FROM s;

-- Daily counts, zero-filled across the full 30-day window (so the chart
-- always draws an honest line, not a sparse one).
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

-- Hourly distribution, divided by the ACTUAL day span (so a first-week
-- launch isn't under-reported 6×).
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

-- Per-tug Fleet Status (count + total distance, summed to miles).
SELECT tug.name AS tug,
       COUNT(m.id) AS tows,
       COALESCE(SUM(m.total_distance_ft), 0) AS total_ft,
       printf('%.1f', COALESCE(SUM(m.total_distance_ft), 0) / 5280.0) AS total_miles
FROM tug
LEFT JOIN mission m ON m.tug_id = tug.id
GROUP BY tug.id;

-- Flagged for Review
SELECT COUNT(*) FROM mission WHERE flagged = 1;
```

## 3. Ingest — bag → R2 → post-processor → D1

The robot and the dashboard never touch each other directly. Raw MCAP bags
are durable in R2; everything in D1 is **derived** from them and is fully
reproducible if extraction logic changes.

```
ROBOT (Jetson)                  CHARGING STATION (NX + NAS)        CLOUDFLARE
─────────────────               ────────────────────────────       ──────────

customer_recorder writes
  /data/bags/airtrek_customer_*.mcap

on dock, airtrek_uploader
  pushes bag → NAS        ───▶  NAS: <facility>/<robot>/<bag>.mcap
                                       │
                                       │ nx_sync (rclone or small daemon):
                                       │   - watches NAS for new bags
                                       │   - PUTs to R2 via S3 API
                                       │   - multipart for large bags
                                       │   - idempotent (content-hash key + If-None-Match)
                                       ▼
                                                                  R2: raw/<site>/<robot>/<bag>.mcap
                                                                       │
                                                                       │ R2 event notification
                                                                       ▼
                                                                  Cloudflare Queues
                                                                       │
                                                                       ▼
                                                                  Container worker "mission_ingest"
                                                                  ┌───────────────────────────────┐
                                                                  │ 1. mcap-py streams the bag    │
                                                                  │ 2. Extract from topics:       │
                                                                  │    - /hmi/mission_command     │
                                                                  │      (1st msg = SUMMON →      │
                                                                  │       route_from,             │
                                                                  │       hmi_mission_uuid)       │
                                                                  │    - /hmi/telemetry           │
                                                                  │      (active_tail, operator)  │
                                                                  │    - /autonomy/state          │
                                                                  │      (mission boundary,       │
                                                                  │       status, route_to via    │
                                                                  │       final goal_pose / GPS)  │
                                                                  │    - /robot/telemetry,        │
                                                                  │      /robot_2/telemetry       │
                                                                  │      (distance, max_speed,    │
                                                                  │       battery_end)            │
                                                                  │    - /customer/*/image_h264   │
                                                                  │      (H264 access units)      │
                                                                  │    - <events topic, TBD>      │
                                                                  │ 3. ffmpeg -c copy: H264 →     │
                                                                  │    MP4 per feed (no encode)   │
                                                                  │ 4. PUT derived/missions/      │
                                                                  │    <id>/<kind>.mp4 → R2       │
                                                                  │ 5. UPSERT into D1:            │
                                                                  │    - operator (by external_id)│
                                                                  │    - mission (by hmi_mission  │
                                                                  │      _uuid)                   │
                                                                  │    - mission_bag (this bag)   │
                                                                  │    - mission_robot            │
                                                                  │    - event (by client_uuid)   │
                                                                  │    - mission_media            │
                                                                  │ 6. UPSERT mission_processing  │
                                                                  │    (status='done')            │
                                                                  └───────────────────────────────┘
on R2 ack + verify,
  airtrek_uploader prunes
  the local bag
  (README §storage)
```

### Key properties

- **Edge does not post-process.** NX/NAS only shuttles bags. All
  extraction, transcoding, and D1 writes happen in the Container worker
  triggered by R2 events. This keeps raw data immutable + reproducible and
  keeps facility hardware out of the business-logic deployment loop. If a
  facility's uplink can't sustain the bag rate, the escape hatch is a
  hybrid pattern (NX fast-path summary alongside background bag upload);
  don't build that until measured bandwidth pressure exists.

- **Idempotency at every hop.**
  - Bag → R2: keyed by `raw/<site>/<robot>/<filename>`; re-upload of the
    same bag is a no-op (`If-None-Match`).
  - R2 → Queue: dedup by message body (the R2 key).
  - Queue → D1: every write is `INSERT … ON CONFLICT DO NOTHING` keyed on
    a stable identifier (`mission.hmi_mission_uuid`,
    `event.client_uuid`, `mission_media.r2_key`, etc.). Re-running the
    post-processor against the same bag converges, never duplicates.

- **Mission boundary = `hmi_mission_uuid`.** The HMI generates a UUID
  when an operator starts a mission and includes it in every telemetry
  message and `MissionCommand` for the life of that mission. All bags
  tagged with the same UUID get one `mission` row + N `mission_bag` rows.
  (This requires a small HMI change. The post-processor falls back to
  treating each bag as its own mission if `hmi_mission_uuid` is absent —
  flagged in `mission_processing.last_error` for review.)

- **Start point (`route_from_id`).** Read from the first
  `/hmi/mission_command` message of the first bag in the mission:
  - `goal_source == GOAL_SOURCE_HANGAR (2)` → look up zone by
    `hmi_hangar_id == cmd.hangar_id`; fall back to the canonical 'Ramp'
    zone if unknown (and log a `last_error` so we can add the missing
    hangar to `zone`).
  - `goal_source == GOAL_SOURCE_APRON_COORD (1)` → 'Ramp'. (We can later
    add a richer apron-spot zone type if customers want finer granularity.)

- **End point (`route_to_id`).** Read the final GPS sample from telemetry,
  match against `zone` bboxes (`lat BETWEEN min AND max AND lon BETWEEN
  min AND max`). Exactly one match → that zone. Zero matches → 'Ramp'
  (fallback). Multiple matches → smallest bbox wins; log for the "review
  zone overlaps" report.

- **Events are first-class.** The post-processor copies them verbatim
  from a dedicated event topic (topic name TBD with safety). Each event
  message carries its own UUID, which becomes `event.client_uuid` —
  re-processing the same bag inserts each event at most once. If the
  event topic isn't shipping yet, the `event` table simply stays empty;
  no derivation engine is required.

- **Auth (writes).** The NX uploader (and any future direct-write robot)
  holds a long-lived bearer token; the server compares its bcrypt/argon2
  hash to `robot_credential.key_hash`. Rotation = insert new, revoke old
  by setting `revoked_at`. Workers reject revoked or unknown keys.

- **Time.** Robots stamp timestamps in UTC from their own clocks
  (NTP-synced). The post-processor compares to wall-clock on ingest and
  flags bags with skew > 5 min for review.

## 4. Read API for the dashboard

The dashboard talks to Workers via this REST surface:

| Endpoint | Purpose |
|---|---|
| `GET /v1/missions?from=&to=&tug=&operator=&flagged=&q=&limit=&cursor=` | Paginated History |
| `GET /v1/missions/:id` | Drawer detail (events + media keys + bags) |
| `PATCH /v1/missions/:id/flag` | Toggle flagged |
| `GET /v1/metrics/summary` | The 4 metric cards in one call |
| `GET /v1/metrics/daily?days=30` | 30-day chart |
| `GET /v1/metrics/hourly?days=30` | Daily-pattern chart |
| `GET /v1/fleet` | Robots + tugs with derived counts/distance |
| `GET /v1/missions/:id/media/:kind` | Signed R2 GET URL for the video |

The metrics endpoints can be cached at the edge (Workers Cache API) for
60s — long enough to absorb dashboard refreshes, short enough that a new
mission lands within a minute.

## 5. Open questions

The mission-boundary question from v0.1 is **answered** (HMI mission UUID).
These remain:

1. **Mission mutability.** Can `event` rows or `flagged` change after
   `ended_at`? (Affects: can we re-run the post-processor at any time?
   Yes, recommended — but operators may also flag manually in the dashboard;
   we need a precedence rule.)
2. **Multi-site.** Add `facility_id` to `zone`/`mission`/`tug`/`robot` now,
   or wait? Painful to retrofit. **Recommendation:** add now; default to a
   single seeded facility row.
3. **Multi-tenancy.** Same question for `tenant_id` if each customer's
   logs need isolation. **Recommendation:** decide before the first
   customer; same retrofit risk.
4. **Retention.** R2 stores raw bags forever ($cheap) or expires them after
   N days? Derived MP4s likewise? **Recommendation:** raw forever, derived
   regenerable.
5. **Event topic.** Which ROS topic carries first-class events, and is it
   in the current `customer_recorder` feed list? If not, add to the
   recorder before the first production bag.
6. **Tug provenance.** When/how does HMI start sending tug selection?
   `mission.tug_id` stays NULL until then.

## 6. Cost considerations

Numbers below are order-of-magnitude on Cloudflare's current public pricing,
parameterized on **30-min missions** with **multiple H264 video feeds**.
The parser never re-encodes video (it `ffmpeg -c copy`'s H264 access units
into MP4 containers), which is what keeps compute near-free.

Per bag, the post-processor does ~30–60 s of wall-clock work on 1 vCPU /
1 GB RAM. On Cloudflare Containers (~$0.000089/(vCPU-s + GiB-s)) that's
**~$0.005 per bag**.

| Scale | Bags/day | Compute | R2 storage (raw + derived) | Total |
|---|---|---|---|---|
| 1 facility, 30/day | 30 | ~$5/mo | ~$30/mo | **~$35/mo** |
| 5 facilities, 50/day each | 250 | ~$40/mo | ~$150/mo | **~$190/mo** |
| 20 facilities, 50/day each | 1,000 | ~$160/mo | ~$600/mo | **~$760/mo** |

D1 reads/writes stay free-tier at all of those. R2 egress is free
(downloads cost the project nothing). The escape hatch when these numbers
get inconvenient is a $5–10/mo VPS draining the same Queue.

**What would change this:** re-encoding video for adaptive streaming
(~$0.05–0.30/bag, 10–60×), or running ML inference on video to derive
events (~$1–5/bag — a different cost class, would warrant a separate
pipeline).

## Next concrete artifact

With the v0.2 schema locked, the smallest end-to-end step is:

1. **D1 migration** that creates these tables + seeds `tug`, `robot`,
   `zone`, and an admin `operator` row. (`wrangler d1 migrations apply`.)
2. **A read-only Workers project** that exposes the §4 endpoints
   reading from D1. Dashboard's `MOCK_LOGS` import becomes a `fetch()`
   call — a small, contained change to [App.tsx](../App.tsx).
3. **A Container worker** (Dockerfile + Python entrypoint) that drains
   the Queue and runs the §3 post-processing logic. Pair with an
   `nx_sync` daemon for the NAS → R2 hop.

The dashboard would point at the live API the same day the first bag
lands in R2; subsequent bags trickle in as missions complete.
