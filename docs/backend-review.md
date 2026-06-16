# Backend Design Review

> **Status — historical (2026-06-16).** This review audited **schema v0.1**.
> All **critical** and **important** items below have been addressed in
> **schema v0.2** ([backend.md](backend.md), [sample/](sample/)). The
> document is retained as the record of how the v0.2 schema arrived at its
> current shape; the open architectural questions in `backend.md` §5
> remain outstanding.

Pre-implementation audit of [backend.md](backend.md) + [sample/](sample/),
intended for the engineering committee. Findings were verified against the
v0.1 [airtrek-sample.db](sample/airtrek-sample.db); each defect below has a
reproduction snippet that ran against that v0.1 file (those probes will now
*fail* — i.e. the constraint kicks in — against the v0.2 sample DB, which
is the point).

## Executive summary

The design's **direction is sound** — D1 + R2 + Workers is the right
Cloudflare-native shape, the five-table normalization is right-sized, and
every dashboard card maps to a single indexed query. The schema, however,
has **gaps that will bite at implementation time** if not addressed: it has
no data-integrity constraints beyond NOT NULL/FK, no idempotency primitives
for a retrying robot fleet, and two of the dashboard queries are subtly
wrong in ways that won't show up until the data is sparse.

There are **5 critical, 5 important, and 5 minor** items below, plus a few
points of doc inaccuracy and architectural decisions the committee needs to
own before code is written.

---

## CRITICAL (fix before any code is written)

### C1. No idempotency primitives — robot retries will duplicate data

The doc states `Idempotency-Key` headers will be used, but the **schema has
no column to store/check them**. Confirmed: inserting the same event twice
silently succeeds.

```
=== probe 3: duplicate event accepted? ===
2     -- event was inserted twice; count for mission 3 went from 1 → 2
```

Robots on flaky connectivity will retry. Without server-side dedup, every
retry creates a phantom event/mission.

**Fix:** add a `client_uuid` column to `mission` and `event` (and arguably
`mission_media`) with a UNIQUE constraint, and have ingest write it from
the `Idempotency-Key` header.

```sql
ALTER TABLE mission ADD COLUMN client_uuid TEXT UNIQUE;
ALTER TABLE event   ADD COLUMN client_uuid TEXT UNIQUE;
ALTER TABLE mission_media ADD COLUMN client_uuid TEXT UNIQUE;
```

Workers then does `INSERT … ON CONFLICT (client_uuid) DO NOTHING RETURNING id`
to make writes idempotent.

### C2. `mission_media` allows duplicate rows per (mission, kind)

There's no UNIQUE on `(mission_id, kind)`, so a retry can land two
`left_wing` rows for the same mission.

```
=== probe 2: duplicate media row accepted? ===
1|3|left_wing|missions/3/left_wing.mp4
4|3|left_wing|missions/3/left_wing_DUPLICATE.mp4
```

Downstream, the drawer query (`WHERE mission_id=? AND kind=?`) suddenly
returns two rows and either picks one arbitrarily or breaks.

**Fix:**
```sql
CREATE UNIQUE INDEX uq_media_mission_kind ON mission_media(mission_id, kind);
```

### C3. No CHECK constraints on enum-like columns

`mission.status`, `mission_media.kind`, `event.severity`/`type`, `zone.type`
are all documented as enums but unconstrained. Bogus values insert cleanly:

```
=== probe 1: invalid status accepted? ===
999|totally-bogus-status

=== probe 4: invalid kind / zone.type accepted? ===
GhostZone|not-a-real-type
completely_made_up_kind
```

Any typo in a robot's firmware silently corrupts the data; later, dashboard
filters and joins behave erratically.

**Fix:** add CHECK constraints (SQLite supports them; D1 does too).
```sql
status   TEXT NOT NULL CHECK (status IN ('in_progress','completed','warning','aborted')),
kind     TEXT NOT NULL CHECK (kind IN ('left_wing','right_wing','sensor_overlay','gps_track','screenshot')),
severity TEXT          CHECK (severity IS NULL OR severity IN ('info','warning','critical')),
type (zone) TEXT NOT NULL CHECK (type IN ('hangar','ramp','apron_spot')),
```

### C4. `mission.status = 'online'` is the wrong vocabulary

The current enum includes `'online'`, which was inherited from the
prototype's `TowLog.status` (a robot connection state). For a **mission's**
lifecycle, the meaningful states are `in_progress` → `completed` | `aborted`,
with `warning` overlaying when events were severe. Keeping `online` in the
mission status enum will confuse implementers and customers who try to
filter "missions with warnings."

**Fix:** rename to `in_progress | completed | warning | aborted` (and pair
with C3's CHECK). The `online`/`offline` notion belongs on `robot.condition`
or a separate `robot_session` if we ever need it.

### C5. Robot ↔ mission relationship is unrepresented

The product is wingwalking with **two robots per mission, one per wingtip**,
but the schema captures this only implicitly. If one robot is in maintenance
and a third is rotated in, or per-robot battery-at-end is needed, there's
nowhere to put it.

**Fix:** even at this scale, add the join table now — it's painful to add
later because existing rows would have unknown robot pairings.

```sql
CREATE TABLE mission_robot (
  mission_id     INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  robot_id       INTEGER NOT NULL REFERENCES robot(id),
  side           TEXT NOT NULL CHECK (side IN ('port','starboard')),
  battery_start  INTEGER,
  battery_end    INTEGER,
  PRIMARY KEY (mission_id, robot_id)
);
```

This also lets the Fleet Status tow-count for each robot become a real query
(`SELECT robot.name, COUNT(mr.mission_id) FROM robot LEFT JOIN mission_robot
mr ON …`) instead of a hardcoded total.

---

## IMPORTANT (fix before customer launch)

### I1. Hourly-distribution query divides by hardcoded `30`

```sql
SELECT … COUNT(*) / 30.0 …
```

If there are fewer than 30 days of data (e.g., first month of operation),
the average is **under-reported**. With the sample data (5 days, 4 missions
in hour 9), the query says `0.133/hr` when the real per-active-day average
is `0.8/hr` — a 6× under-count.

**Fix:** divide by the actual day span:
```sql
WITH days AS (
  SELECT MAX(julianday('now') - julianday(MIN(started_at)), 1) AS d
  FROM mission WHERE started_at >= datetime('now','-30 days')
)
SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour,
       COUNT(*) / (SELECT d FROM days) AS avg_per_hour
FROM mission
WHERE started_at >= datetime('now','-30 days')
GROUP BY hour;
```

### I2. Daily-count query skips empty days

```
=== probe 7: daily counts ===
2026-06-11|1
2026-06-13|1   -- missing 2026-06-12
2026-06-14|1
2026-06-15|2
2026-06-16|3
```

The dashboard chart needs zeros to render an honest line. Either fill on
the client (acceptable) or generate the date series server-side with a
recursive CTE. **Decide which** — both are valid, but they shouldn't
both fill, and they shouldn't both forget.

### I3. Ingest doc is inaccurate about R2 pre-signed URL shape

The diagram shows the upload step returning `{ url, fields }` — that's
**S3 POST policy** syntax. R2's standard pre-signed URL is a **PUT URL
(single string)** generated via the S3-compatible API or the R2 binding.
The robot then does `PUT <url>` with the file body, no `fields` involved.

**Fix:** the doc paragraph and the diagram should say "pre-signed PUT URL"
explicitly, and the response should be `{ url, expires_at }`.

### I4. "Workers Secret" doesn't scale to a fleet of robots

The doc says credentials live in "a `robot_credential` table (or a Workers
Secret)." A single Workers Secret per robot is unmanageable past ~5 robots
(no rotation, no revocation, no per-robot scoping). The committee should
commit to the `robot_credential` table approach now:

```sql
CREATE TABLE robot_credential (
  id          INTEGER PRIMARY KEY,
  robot_id    INTEGER NOT NULL REFERENCES robot(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,    -- bcrypt/argon2 of the bearer token
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  last_used_at TEXT
);
```

Workers hashes the inbound bearer token, looks it up, checks `revoked_at`.
Standard pattern.

### I5. Avg-tow-time query evaluates `AVG()` twice

The `queries.sql` version of the avg-tow-time formatter computes
`AVG((julianday(ended)-julianday(started))*86400)` twice in the same
SELECT (once for minutes, once for seconds), which the optimizer *should*
collapse but isn't guaranteed to. A CTE is unambiguous:

```sql
WITH avg_s AS (
  SELECT AVG((julianday(ended_at) - julianday(started_at)) * 86400) AS s
  FROM mission
  WHERE ended_at IS NOT NULL AND started_at >= datetime('now','-30 days')
)
SELECT printf('%dm %02ds',
              CAST(s/60 AS INTEGER),
              CAST(s AS INTEGER) % 60) AS avg_tow_time_30d
FROM avg_s;
```

---

## MINOR (decide intentionally, don't accept by default)

### M1. CASCADE delete vs. immutability

Both `event` and `mission_media` cascade on `mission` delete. But missions
are **audit history** — they shouldn't be hard-deleted at all. Recommend
either dropping `ON DELETE CASCADE` (force the deleter to clean up first),
or introducing a `deleted_at` soft-delete column. Either way, document the
chosen policy.

### M2. Time-zone migration risk

The schema and Workers will store UTC. The **current prototype data** in
`MOCK_LOGS` uses local-style timestamps (`'2026-05-25 10:02'`, ambiguous
TZ). When the prototype is replaced by real data, downstream consumers
that compare to `Date.now()` may shift by hours depending on user TZ.
Flag this for the cutover.

### M3. `mission` integer vs. float consistency

`total_distance_ft INTEGER` but `max_speed_mph REAL`. Distance is also a
measured quantity with sub-foot precision possible. Pick one convention
(both REAL, or both INTEGER with documented unit). Cosmetic, but committee
will ask.

### M4. Cache TTL of "~5 min" on metrics is probably too long

The dashboard is a live ops surface; customers expect "what's happening
right now." 60 seconds is a more honest default; 5 minutes will lead to
"is this stale?" support tickets. Cheap to tune later, but worth flagging.

### M5. D1 quotas + concurrency aren't mentioned

D1 (as of writing) has per-database limits (storage, queries/second, max
row size). Not a concern at this scale, but the doc should reference the
current Cloudflare limits page and note that **D1 serializes writes per
database** — if write contention from many robots becomes an issue, you'd
shard by `facility_id` (which is one of the open questions).

---

## What's solid (don't change)

- **Five-table normalization** is the right granularity for now. Resist
  the urge to add `aircraft` / `operator` tables until they carry metadata
  beyond their identifier.
- **Index choices** match the queries — `idx_mission_started`,
  `idx_mission_tug`, and the partial index `idx_mission_flagged WHERE
  flagged = 1` are all justified. Probe confirmed FKs are enforced when
  `PRAGMA foreign_keys=ON` (which D1 does by default for Workers
  bindings).
- **Direct-to-R2 upload via pre-signed URLs** is the right pattern; saves
  Workers CPU and bandwidth cost on large video.
- **The 5 open questions** at the end of `backend.md` are exactly the
  decisions that need to be made before code lands — committee should
  answer them in writing.
- **Sample DB with relative-time seed** means re-seeding tomorrow still
  exercises the "last 30 days" path correctly.

---

## Decisions the committee needs to make

In priority order (the first three change the schema; the rest just need a
stated policy):

1. **Mission boundary** — single segment per mission, or `mission_segment`
   table for multi-stop? (backend.md open question #1)
2. **Multi-tenancy** — single tenant for the lifetime of v1, or
   `tenant_id` columns added now? (open question #4)
3. **Multi-site** — single facility for the lifetime of v1, or
   `facility_id` added now? (open question #3)
4. **Mission mutability** — can events/media/flag changes be appended
   after `ended_at`? (open question #2)
5. **Retention** — how long do raw videos live in R2; do mission rows
   ever leave D1? (open question #5)

---

## Suggested consolidated patch

If the committee greenlights the critical + important fixes above, here is
the minimal diff to `schema.sql`. Treat this as the v0.2 schema.

```sql
-- C3 + C4: enum CHECKs and corrected mission.status vocabulary.
-- C1: idempotency keys on writable tables.
-- C2: UNIQUE on (mission_id, kind) for mission_media.
-- C5: mission_robot join table.

ALTER TABLE zone
  ADD COLUMN check_type CHECK (type IN ('hangar','ramp','apron_spot'));
-- (Note: SQLite ADD CHECK requires table rebuild; in practice this lands
-- via a migration, not in-place. Shown for clarity.)

CREATE TABLE mission_v2 (
  id                INTEGER PRIMARY KEY,
  client_uuid       TEXT UNIQUE,                          -- C1
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
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','completed','warning','aborted')),  -- C3+C4
  flagged           INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE event_v2 (
  id             INTEGER PRIMARY KEY,
  client_uuid    TEXT UNIQUE,                              -- C1
  mission_id     INTEGER NOT NULL REFERENCES mission(id),
  occurred_at    TEXT NOT NULL,
  offset_seconds INTEGER,
  type           TEXT          CHECK (type IS NULL OR type IN ('obstacle_proximity','speed_warning','manual_flag')),  -- C3
  severity       TEXT          CHECK (severity IS NULL OR severity IN ('info','warning','critical')),                -- C3
  details_json   TEXT
);

CREATE TABLE mission_media_v2 (
  id               INTEGER PRIMARY KEY,
  client_uuid      TEXT UNIQUE,                            -- C1
  mission_id       INTEGER NOT NULL REFERENCES mission(id),
  kind             TEXT NOT NULL CHECK (kind IN ('left_wing','right_wing','sensor_overlay','gps_track','screenshot')),  -- C3
  r2_key           TEXT NOT NULL UNIQUE,
  content_type     TEXT,
  bytes            INTEGER,
  duration_seconds REAL,
  uploaded_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_media_mission_kind ON mission_media_v2(mission_id, kind);  -- C2

CREATE TABLE mission_robot (                              -- C5
  mission_id     INTEGER NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  robot_id       INTEGER NOT NULL REFERENCES robot(id),
  side           TEXT NOT NULL CHECK (side IN ('port','starboard')),
  battery_start  INTEGER,
  battery_end    INTEGER,
  PRIMARY KEY (mission_id, robot_id)
);

CREATE TABLE robot_credential (                           -- I4
  id           INTEGER PRIMARY KEY,
  robot_id     INTEGER NOT NULL REFERENCES robot(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  last_used_at TEXT
);
```

(In a real migration, you'd rename the new tables back over the old, or
use wrangler d1 migrations to handle the rebuild. Shown as `_v2` here for
clarity of what's changing.)

---

## Pass/fail signoff

| Item | Status |
|---|---|
| Stack choice (D1 + R2 + Workers) | ✅ |
| Schema shape (5 tables) | ✅ — with the patches above |
| Index coverage | ✅ |
| Ingest sequencing | ✅ — with R2 URL doc fix |
| Idempotency | ❌ — C1 must land |
| Data integrity (CHECK / UNIQUE) | ❌ — C2, C3 must land |
| Status vocabulary | ❌ — C4 must land |
| Robot↔mission link | ❌ — C5 must land |
| Hourly / daily query correctness | ⚠️ — I1, I2 must land |
| Auth scalability | ⚠️ — I4 must land |
| Doc accuracy | ⚠️ — I3 must land |
| Open architectural questions | ⚠️ — committee must answer |

Recommendation: **conditional pass** — proceed to Workers prototyping once
the critical fixes are merged and the five open questions in backend.md §5
have written answers.
