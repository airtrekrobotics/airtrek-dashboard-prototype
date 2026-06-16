# Airtrek Dashboard — Backend Design Notes

A starter design doc for the backend that will eventually feed the
[customer-facing dashboard](https://airtrekrobotics.github.io/airtrek-dashboard-prototype/).
The dashboard today runs on a seeded mock dataset; this doc sketches what it
takes to swap that for a real Cloudflare-native backend.

**Status:** discussion draft. Pick what makes sense, push back on what doesn't,
and we'll iterate.

## Stack

- **Cloudflare D1** — serverless SQLite for the relational data.
- **Cloudflare R2** — object storage for sensor video and other large files.
- **Cloudflare Workers** — the API layer that the dashboard and robots talk to.

D1 fits this data shape and volume well, and stays cheap (generous free tier;
$0 at prototype scale). The main caveat: D1 is SQLite under the hood —
single-region writes, eventually-consistent read replicas globally. Plenty
fast for the foreseeable future; only revisit if you're doing millions of
writes/day or need synchronous multi-region.

## Contents
1. [Schema](#1-schema)
2. [How the dashboard maps to the schema](#2-how-the-dashboard-maps-to-the-schema)
3. [Ingest — robot → D1 → dashboard](#3-ingest--robot--d1--dashboard)
4. [Read API for the dashboard](#4-read-api-for-the-dashboard)
5. [Open questions](#5-open-questions-worth-resolving-first)

## 1. Schema

Five tables to start. Keep it lean; normalize further (separate `aircraft`,
`operator` tables) once the metadata starts mattering.

```sql
-- Map zones the aircraft moves between (hangars, ramp, apron spots).
CREATE TABLE zone (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,            -- 'Hangar 1', 'Ramp'
  type   TEXT NOT NULL,                    -- 'hangar' | 'ramp'
  x_pct  REAL,                              -- map coordinates as %
  y_pct  REAL
);

-- Tugs (Lektro, Mototok, Harlan, Towflexx, ...)
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
  name         TEXT NOT NULL UNIQUE,        -- 'Robot 01'
  battery_pct  INTEGER,                      -- last reported
  condition    TEXT,
  last_seen_at TEXT                           -- ISO-8601 UTC
);

-- Core table: one row per tow.
CREATE TABLE mission (
  id                INTEGER PRIMARY KEY,
  started_at        TEXT NOT NULL,           -- ISO-8601 UTC
  ended_at          TEXT,                     -- null until complete
  tail_number       TEXT NOT NULL,           -- 'N412EF'
  operator_name     TEXT NOT NULL,           -- swap for FK when SSO arrives
  tug_id            INTEGER REFERENCES tug(id),
  route_from_id     INTEGER REFERENCES zone(id),
  route_to_id       INTEGER REFERENCES zone(id),
  total_distance_ft INTEGER,
  max_speed_mph     REAL,
  battery_end_pct   INTEGER,
  status            TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress|online|warning|aborted
  flagged           INTEGER NOT NULL DEFAULT 0,            -- bool
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mission_started ON mission(started_at);
CREATE INDEX idx_mission_tug     ON mission(tug_id);
CREATE INDEX idx_mission_flagged ON mission(flagged) WHERE flagged = 1;

-- Obstacle alerts / warnings during a mission.
CREATE TABLE event (
  id             INTEGER PRIMARY KEY,
  mission_id     INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  occurred_at    TEXT NOT NULL,               -- absolute UTC
  offset_seconds INTEGER,                      -- seconds into the mission (video timeline)
  type           TEXT,                         -- 'obstacle_proximity', 'speed_warning'
  severity       TEXT,                         -- 'info' | 'warning' | 'critical'
  details_json   TEXT
);
CREATE INDEX idx_event_mission ON event(mission_id);

-- Pointers to large files in R2 (video, screenshots).
CREATE TABLE mission_media (
  id               INTEGER PRIMARY KEY,
  mission_id       INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,               -- 'left_wing'|'right_wing'|'sensor_overlay'|'gps_track'
  r2_key           TEXT NOT NULL,               -- e.g. 'missions/12345/left_wing.mp4'
  content_type     TEXT,
  bytes            INTEGER,
  duration_seconds REAL,
  uploaded_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_mission ON mission_media(mission_id);
```

Notes:
- All timestamps are UTC ISO-8601 strings; convert in the UI.
- `flagged` is a column on `mission` (not a side table) — single bit, easy to filter/index.
- Video files live in **R2** under `missions/<id>/<kind>.mp4`; D1 only stores the
  pointer + metadata. R2 has no egress fees, so customer downloads stay cheap.
- `operator_name` is text now; promote to a real `operator` table the day
  SSO/login arrives.

## 2. How the dashboard maps to the schema

Every metric card and chart in the live dashboard is one indexed query against
`mission`:

```sql
-- Total Tows (30D) = 538 in the current mock
SELECT COUNT(*) FROM mission
WHERE started_at >= datetime('now','-30 days');

-- Total Tows (MTD)
SELECT COUNT(*) FROM mission
WHERE started_at >= strftime('%Y-%m-01', 'now');

-- Avg. Tow Time (30D) in seconds
SELECT AVG((julianday(ended_at) - julianday(started_at)) * 86400)
FROM mission
WHERE ended_at IS NOT NULL AND started_at >= datetime('now','-30 days');

-- Daily 30-day chart
SELECT date(started_at) AS day, COUNT(*) FROM mission
WHERE started_at >= datetime('now','-30 days')
GROUP BY day ORDER BY day;

-- Hourly distribution (the bimodal chart)
SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour, COUNT(*) / 30.0
FROM mission
WHERE started_at >= datetime('now','-30 days')
GROUP BY hour;

-- Per-tug Fleet Status counts + total distance
SELECT tug.name, COUNT(m.id), SUM(m.total_distance_ft)
FROM tug LEFT JOIN mission m ON m.tug_id = tug.id
GROUP BY tug.id;

-- Flagged for Review count
SELECT COUNT(*) FROM mission WHERE flagged = 1;
```

## 3. Ingest — robot → D1 → dashboard

The dashboard never writes; only the robots/edge gateway do. Lifecycle of one
mission:

```
                                            CLOUDFLARE
                                            ──────────
ROBOT-SIDE (per-aircraft, edge)         Workers (API)         D1            R2
─────────────────────────────────       ─────────────         ────          ──

1) Start of tow
   POST /v1/missions                 ──▶  validate token ──▶ INSERT mission ──▶ {id, upload_token}
   { started_at, tail_number,                                                    │
     operator, tug, route_from,                                                  │
     route_to }                                                                  ▼
                                                              ◀── mission_id

2) During tow (batched, every N sec)
   POST /v1/missions/{id}/events     ──▶  validate ──────▶ INSERT events
   [{ occurred_at, offset_seconds,        idempotency key
      type, severity }, ...]              (UUID per write)

3) End of tow
   PATCH /v1/missions/{id}           ──▶  validate ──────▶ UPDATE mission
   { ended_at, total_distance_ft,                          (set totals, status)
     max_speed_mph, battery_end_pct,
     status }

4) Upload sensor footage
   POST /v1/missions/{id}/media      ──▶  presign R2 PUT  ─────────────────▶  pre-signed URL
   { kind: 'left_wing',                                                          ▲
     content_type: 'video/mp4' }     ◀── { url, fields }                          │
                                                                                  │
   PUT <pre-signed url> + .mp4 ─────────────────────────────────────────────── upload direct
                                                                                  │
   POST /v1/missions/{id}/media/{kind}/complete ─▶ INSERT mission_media          │
   { bytes, duration_seconds }                                                    │
```

Key design choices:
- **Auth (writes):** each robot holds a long-lived API key (random opaque token)
  issued by a one-time bootstrap. Workers verifies on every write against a
  `robot_credential` table (or a Workers Secret). Upgrade to mTLS if needed
  later.
- **Idempotency:** every write accepts an `Idempotency-Key` header (UUID).
  Workers ignores duplicates. This lets robots retry safely over flaky
  connectivity.
- **Buffering:** if the robot loses connectivity mid-mission, it queues writes
  locally and flushes when back online. The mission-start call returns a
  `mission_id`, so buffered events can be tagged with it.
- **Direct-to-R2 upload:** sensor video bypasses Workers via pre-signed URLs —
  Workers never sees the video bytes, so you don't pay Workers CPU/egress on
  them. Cheap and fast.
- **Time:** robots stamp `occurred_at` in UTC from their own clocks. NTP-sync
  them; eventually compare to Workers' time on write and reject if skew >
  a few minutes.

## 4. Read API for the dashboard

The dashboard would talk to Workers via a small REST surface:

| Endpoint | Purpose |
|---|---|
| `GET /v1/missions?from=&to=&tug=&operator=&flagged=&q=&limit=&cursor=` | Paginated History |
| `GET /v1/missions/:id` | Drawer detail (events + media keys) |
| `PATCH /v1/missions/:id/flag` | Toggle flagged |
| `GET /v1/metrics/summary` | The 4 metric cards in one call |
| `GET /v1/metrics/daily?days=30` | 30-day chart |
| `GET /v1/metrics/hourly?days=30` | Daily-pattern chart |
| `GET /v1/fleet` | Robots + tugs with derived counts/distance |
| `GET /v1/missions/:id/media/:kind` | Signed R2 GET URL for the video |

The metrics endpoints can be cached at the edge (Workers Cache API) for ~5 min
— they only move when a new mission completes.

## 5. Open questions worth resolving first

These decisions shape the schema; better to decide before code lands:

1. **What counts as a "mission" boundary?** Pull out of one hangar to one ramp
   position = 1 mission, or is a multi-stop tow one mission? If multi-stop,
   add a `mission_segment` table now — painful to retrofit.
2. **Are events ever appended after a mission "ends"?** (e.g., post-flight
   analysis adds a flag). If yes, the schema is fine; if mission is immutable
   after end, add an ended-at constraint.
3. **Multi-site?** If Airtrek will operate at more than one airport, add
   `facility_id` to `zone` / `mission` / `tug` early. Painful to retrofit.
4. **Multi-tenancy?** If each customer has their own logs, add `tenant_id`
   everywhere now. Same — painful to retrofit.
5. **Retention?** D1 storage is cheap but not free at scale; R2 video can grow
   fast. Decide a policy (e.g., raw video 90 days, mission rows forever).

## Next concrete artifact

Once the open questions above are answered, the smallest end-to-end step is a
minimal Cloudflare Workers project (one file, ~200 lines) that stands up:
- One Worker reading the read-API endpoints from D1.
- A migration script that creates these tables + seeds the `tug`, `robot`,
  `zone` lookup tables.
- A throwaway script that posts a few synthetic missions/events through the
  ingest endpoints so the dashboard has something to render.

After that, swapping the React app's `MOCK_LOGS` import for `fetch('/v1/...')`
is a small, contained change in [App.tsx](../App.tsx) and the views.
