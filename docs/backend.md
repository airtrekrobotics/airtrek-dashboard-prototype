# Airtrek Dashboard — Backend Design Notes (v0.3)

A design doc for the backend that will feed the
[customer-facing dashboard](https://airtrekrobotics.github.io/airtrek-dashboard-prototype/).
The dashboard today runs on a seeded mock dataset; this doc sketches what it
takes to swap that for a real Cloudflare-native backend.

**Status:** v0.3 — replaces v0.2's multi-bag-grouping machinery (HMI mission
UUID + `mission_bag` join) with a 1:1 bag↔mission model, and adds a cheap
**real-vs-dummy** classification step to the ingest pipeline. The
[v0.1 → v0.2 review](backend-review.md) findings are still in effect.

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
3. [Ingest — bag → R2 → classifier → post-processor → D1](#3-ingest--bag--r2--classifier--post-processor--d1)
4. [Read API for the dashboard](#4-read-api-for-the-dashboard)
5. [Open questions](#5-open-questions)
6. [Cost considerations](#6-cost-considerations)

## 1. Schema

Ten tables. One real bag → one mission, anchored by `mission.source_bag_key`.
Dummy bags are recognized at the classifier stage and never produce a
mission row; they're tracked only in `mission_processing` for audit.

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

-- Long-lived API keys for the NX uploader (and any future direct writers).
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

-- Core table: one row per real mission, 1:1 with its source bag.
CREATE TABLE mission (
  id                INTEGER PRIMARY KEY,
  source_bag_key    TEXT NOT NULL UNIQUE,                       -- R2 key; idempotency anchor
  started_at        TEXT NOT NULL,                               -- ISO-8601 UTC; first SUMMON in bag
  ended_at          TEXT,                                         -- last return-to-idle in bag
  tail_number       TEXT NOT NULL,                               -- from HmiTelemetry.active_tail
  operator_id       INTEGER REFERENCES operator(id),
  tug_id            INTEGER REFERENCES tug(id),                  -- NULL until HMI sends tug info
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

-- One row per bag the cloud has ever seen. The classifier writes the verdict
-- here BEFORE the heavy extraction; dummies stop here and never produce a
-- mission row.
CREATE TABLE mission_processing (
  bag_key               TEXT PRIMARY KEY,
  mission_id            INTEGER REFERENCES mission(id),         -- NULL for dummies
  status                TEXT NOT NULL CHECK (status IN (
                          'queued','classifying','parsing','transcoding',
                          'done','done_dummy','failed')),
  classification        TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (classification IN ('unknown','real','dummy')),
  classification_reason TEXT,                                    -- e.g. 'no_wingwalking', 'off_jetson_no_video'
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  bytes                 INTEGER,
  duration_ms           INTEGER,
  started_at            TEXT,
  completed_at          TEXT
);
CREATE INDEX idx_processing_classification ON mission_processing(classification);

-- First-class events copied verbatim from a dedicated bag topic (TBD).
CREATE TABLE event (
  id             INTEGER PRIMARY KEY,
  client_uuid    TEXT UNIQUE,                                    -- from event payload; idempotent ingest
  mission_id     INTEGER NOT NULL REFERENCES mission(id),
  occurred_at    TEXT NOT NULL,
  offset_seconds INTEGER,
  type           TEXT CHECK (type IS NULL OR type IN ('obstacle_proximity','speed_warning','manual_flag','fault')),
  severity       TEXT CHECK (severity IS NULL OR severity IN ('info','warning','critical')),
  details_json   TEXT
);
CREATE INDEX idx_event_mission ON event(mission_id);

-- Pointers to derived video / screenshots in R2. Bag-extracted H264 access
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
- **`mission.source_bag_key` is the single idempotency anchor.** Re-processing the same bag converges (`INSERT … ON CONFLICT (source_bag_key) DO NOTHING`); never duplicates.
- **`mission.tug_id` stays NULL** until HMI publishes tug info; the post-processor leaves it alone otherwise.
- **`operator.full_name` is nullable** so the post-processor can auto-create operator rows from a JWT subject without blocking ingest.
- **`zone.hmi_hangar_id`** is the canonical string the HMI ships in `MissionCommand.hangar_id`; might or might not equal the dashboard-display `name`.
- **R2 keys live in two prefixes:** `raw/<site>/<robot>/<bag>.mcap` for incoming bags; `derived/missions/<id>/<kind>.mp4` for post-processor output. Lifecycle policies can be applied per prefix.
- **No `mission_bag` join table.** In the customer_recorder model, a bag closes only on return-to-idle, which is the natural mission boundary; multi-summon-within-a-bag already stays in one file by construction. If clustering multiple bags under a single "super-mission" ever becomes a real product concept, adding a nullable `mission.parent_mission_id` or a `mission_group` table is purely additive.

## 2. How the dashboard maps to the schema

Every metric card and chart in the live dashboard is one indexed query against
`mission`. These are the production-grade versions (the v0.1 doc had subtle
bugs around hardcoded divisors and missing-day fills; see
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

-- Daily counts, zero-filled across the full 30-day window.
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

-- Hourly distribution, divided by the ACTUAL day span.
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

-- Pipeline health: what's in flight or got rejected.
SELECT classification, status, COUNT(*) FROM mission_processing
GROUP BY classification, status;
```

## 3. Ingest — bag → R2 → classifier → post-processor → D1

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
                                       │   - idempotent (key + If-None-Match)
                                       ▼
                                                                  R2: raw/<site>/<robot>/<bag>.mcap
                                                                       │
                                                                       │ R2 event notification
                                                                       ▼
                                                                  Cloudflare Queues
                                                                       │
                                                                       ▼
                                                                  Container worker "mission_ingest"

                                                                  ┌─── CLASSIFY (cheap; indexed read) ───┐
                                                                  │ Read only two channels via MCAP      │
                                                                  │ summary/index (~2–3 MB total):       │
                                                                  │   /autonomy/state                    │
                                                                  │   /hmi/mission_command               │
                                                                  │ real = any mission_state=='wingwalking'│
                                                                  │     OR any command==AIRCRAFT_SELECT  │
                                                                  │ dummy otherwise.                     │
                                                                  │ Write mission_processing(            │
                                                                  │   classification, status='done_dummy'│
                                                                  │   or continue with 'parsing').      │
                                                                  └──────────────────────────────────────┘
                                                                                │
                                                                  ┌─ if dummy ─┘   ┌─ if real ─┐
                                                                  │                 ▼
                                                                  │           ┌── EXTRACT ───────────────┐
                                                                  ▼           │ Full MCAP stream:          │
                                                                STOP          │   /hmi/mission_command     │
                                                                              │   (1st = SUMMON →          │
                                                                              │    route_from)             │
                                                                              │   /hmi/telemetry           │
                                                                              │   (active_tail, operator)  │
                                                                              │   /autonomy/state          │
                                                                              │   (timestamps,             │
                                                                              │    final GPS → route_to)   │
                                                                              │   /robot/telemetry,        │
                                                                              │   /robot_2/telemetry       │
                                                                              │   (distance, max_speed,    │
                                                                              │    battery_end)            │
                                                                              │   /customer/*/image_h264   │
                                                                              │   <events topic, TBD>      │
                                                                              │                            │
                                                                              │ ffmpeg -c copy: H264 → MP4 │
                                                                              │ PUT derived → R2           │
                                                                              │                            │
                                                                              │ UPSERT D1:                 │
                                                                              │   operator (by external_id)│
                                                                              │   mission (by              │
                                                                              │     source_bag_key)        │
                                                                              │   mission_robot, event,    │
                                                                              │   mission_media            │
                                                                              │ mission_processing.status  │
                                                                              │   = 'done'                 │
                                                                              └────────────────────────────┘
on R2 ack + verify,
  airtrek_uploader prunes
  the local bag
```

### Key properties

- **Classifier-first.** The cheap indexed read happens before any video
  work. ~$1e-5/bag, sub-second. Dummies cost essentially nothing and never
  create a mission row, never trigger video transcoding, never appear in
  the dashboard. They live only in `mission_processing` for audit.

- **Edge does not post-process.** NX/NAS only shuttles bags. All
  extraction, transcoding, and D1 writes happen in the Container worker
  triggered by R2 events. Raw data is immutable + reproducible from R2;
  facility hardware is out of the business-logic deployment loop.

- **Idempotency at every hop.**
  - Bag → R2: keyed by `raw/<site>/<robot>/<filename>`; re-upload is a no-op (`If-None-Match`).
  - R2 → Queue: dedup by message body (the R2 key).
  - Queue → D1: every write is `INSERT … ON CONFLICT DO NOTHING` keyed on a stable identifier — `mission.source_bag_key`, `event.client_uuid`, `mission_media.r2_key`, etc. Re-running the post-processor against the same bag converges.

- **One real bag → one mission.** The customer_recorder closes a bag only
  on return-to-idle, which is the natural mission boundary. Multiple
  summons within one excursion stay in the same bag (per the recorder
  design). No multi-bag grouping needed.

- **Start point (`route_from_id`).** Read from the first
  `/hmi/mission_command` message of the bag:
  - `goal_source == GOAL_SOURCE_HANGAR (2)` → look up zone by
    `hmi_hangar_id == cmd.hangar_id`. Unknown hangar_ids fall back to
    'Ramp' and log a `last_error` so we can extend the `zone` table.
  - `goal_source == GOAL_SOURCE_APRON_COORD (1)` → 'Ramp'.

- **End point (`route_to_id`).** Match the final telemetry GPS sample
  against `zone` bboxes. One match → that zone. Zero → 'Ramp' fallback.
  Multiple → smallest bbox wins; log for review.

- **Events are first-class.** The post-processor copies them verbatim
  from a dedicated event topic (name TBD with safety). Each message
  carries a UUID that becomes `event.client_uuid`. If the topic isn't
  shipping yet, `event` stays empty — no derivation engine required.

- **Auth (writes).** The NX uploader (and any future direct-write robot)
  holds a long-lived bearer token; the server compares its
  bcrypt/argon2 hash to `robot_credential.key_hash`. Rotation = insert
  new + revoke old (set `revoked_at`).

- **Time.** Robots stamp timestamps in UTC. The post-processor compares
  to wall-clock on ingest and flags bags with skew > 5 min for review.

### Pipeline assumption worth flagging

The cheap classifier (~$1e-5/bag) **relies on the recorder writing bags
uncompressed with a full MCAP index** (current `mcap_writer.yaml` setting,
`compression: None`). With that, the classifier byte-range-reads two small
channels and skips the video entirely.

**If the dock uploader later turns on bag-wide chunk compression**, indexed
seeking no longer avoids decompression — the classifier suddenly pays
near-full-bag CPU+I/O. Two mitigations to keep ready:

1. Ask the uploader team to keep data channels uncompressed (or compress
   per-channel), so indexed seeking stays cheap.
2. Have the uploader emit a small sidecar JSON next to each MCAP with the
   classification verdict (and a few key stats). The classifier becomes
   "read 1 KB JSON" instead of "MCAP byte-range read." Pre-decides the
   real/dummy question before the post-processor even runs.

## 4. Read API for the dashboard

The dashboard talks to Workers via this REST surface:

| Endpoint | Purpose |
|---|---|
| `GET /v1/missions?from=&to=&tug=&operator=&flagged=&q=&limit=&cursor=` | Paginated History |
| `GET /v1/missions/:id` | Drawer detail (events + media keys + source bag) |
| `PATCH /v1/missions/:id/flag` | Toggle flagged |
| `GET /v1/metrics/summary` | The 4 metric cards in one call |
| `GET /v1/metrics/daily?days=30` | 30-day chart |
| `GET /v1/metrics/hourly?days=30` | Daily-pattern chart |
| `GET /v1/fleet` | Robots + tugs with derived counts/distance |
| `GET /v1/missions/:id/media/:kind` | Signed R2 GET URL for the video |
| `GET /v1/pipeline/health` | Recent `mission_processing` rows (ops/admin) |

The metrics endpoints can be cached at the edge (Workers Cache API) for
60s — long enough to absorb dashboard refreshes, short enough that a new
mission lands within a minute.

## 5. Open questions

1. **Mission mutability.** Can `event` rows or `flagged` change after
   `ended_at`? (The post-processor can be re-run at will, but operators
   may also flag manually in the dashboard — precedence rule?)
2. **Multi-site.** Add `facility_id` to `zone`/`mission`/`tug`/`robot`
   now, or wait? Painful to retrofit. **Recommendation:** add now,
   default to one seeded facility row.
3. **Multi-tenancy.** Same question for `tenant_id` if each customer's
   logs need isolation. **Recommendation:** decide before the first
   customer; same retrofit risk.
4. **Raw-bag retention.** R2 stores raw bags forever (cheap) or expires
   after N days? Derived MP4s likewise? **Recommendation:** raw forever
   (reproducibility); derived regenerable.
5. **Dummy-bag retention.** Once classified, do dummy bags stay in R2
   for audit, or get deleted after K days? They're not useful to the
   dashboard; only useful for "why did the classifier drop this?"
   debugging. **Recommendation:** 30-day expiry on dummy bags only.
6. **Aborted real missions.** A bag that hit `AIRCRAFT_SELECT` but never
   reached `wingwalking` classifies as `real` but the mission was
   aborted. Surface as a sub-status (`real_aborted` vs `real_completed`)
   in the dashboard, or fold into the existing `mission.status='aborted'`?
7. **Event topic.** Which ROS topic carries first-class events, and is
   it in the current customer_recorder feed list? If not, add to the
   recorder before the first production bag.
8. **Tug provenance.** When/how does HMI start sending tug selection?
   `mission.tug_id` stays NULL until then.
9. **Uploader compression.** If the dock uploader turns on chunk-level
   compression, the cheap classifier path collapses. Either: (a) keep
   data channels uncompressed; (b) have the uploader emit a 1 KB sidecar
   JSON with the verdict; (c) accept ~50–100× higher classifier cost.

## 6. Cost considerations

Numbers are order-of-magnitude on Cloudflare's current public pricing,
parameterized on **30-min missions** with multiple H264 video feeds.
The post-processor never re-encodes video (`ffmpeg -c copy` muxes H264
access units into MP4 containers), which is what keeps compute near-free.

**Classifier (every bag):** indexed MCAP read of ~2–3 MB → ~$1e-5/bag,
sub-second. Negligible.

**Full extraction (real bags only):** ~30–60 s of wall-clock on 1 vCPU /
1 GB RAM. On Cloudflare Containers (~$0.000089/(vCPU-s + GiB-s)), about
**$0.005 per real bag**. Dummy bags stop at the classifier.

| Scale | Bags/day (incl. dummies) | Compute | R2 storage (raw + derived) | Total |
|---|---|---|---|---|
| 1 facility, 30/day | 30 | ~$5/mo | ~$30/mo | **~$35/mo** |
| 5 facilities, 50/day each | 250 | ~$40/mo | ~$150/mo | **~$190/mo** |
| 20 facilities, 50/day each | 1,000 | ~$160/mo | ~$600/mo | **~$760/mo** |

Assumes ~70/30 real/dummy. D1 reads/writes stay free-tier at all scales.
R2 egress is free. Escape hatch when the numbers get inconvenient is a
$5–10/mo VPS draining the same Queue.

**What would change the math:** re-encoding video for adaptive streaming
(~$0.05–0.30/bag, 10–60×); ML inference on video to derive events
(~$1–5/bag, a different cost class).

## Next concrete artifact

With the v0.3 schema locked, the smallest end-to-end step is:

1. **D1 migration** that creates these tables + seeds `tug`, `robot`,
   `zone`, and an admin `operator` row. (`wrangler d1 migrations apply`.)
2. **A read-only Workers project** that exposes the §4 endpoints
   reading from D1. Dashboard's `MOCK_LOGS` import becomes a `fetch()`
   call — a small, contained change to [App.tsx](../App.tsx).
3. **A Container worker** (Dockerfile + Python entrypoint) that drains
   the Queue, runs the §3 classifier-then-extract logic, and writes to
   D1 + R2. Pair with an `nx_sync` daemon for the NAS → R2 hop.

The dashboard would point at the live API the same day the first real
bag lands in R2; subsequent bags trickle in as missions complete.
