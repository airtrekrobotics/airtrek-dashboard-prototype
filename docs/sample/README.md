# Sample SQLite Database (schema v0.2)

A tiny working version of the [backend schema](../backend.md) — eleven tables
seeded with a handful of missions, tugs, robots, operators, events, media
pointers, and pipeline-state rows — so you can poke at it and see how the
dashboard's metrics map to real SQL.

The same schema runs on **Cloudflare D1** unchanged (D1 *is* SQLite). When the
real backend lands, you'll point D1 at this same DDL.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | `CREATE TABLE`s + sample `INSERT`s. Idempotent — re-run on a fresh db file. |
| `queries.sql` | The example dashboard queries from `backend.md`, runnable. |
| `airtrek-sample.db` | The resulting database (~140 KB). Checked in for convenience. |

## Re-seed from scratch

```bash
cd docs/sample
rm -f airtrek-sample.db
sqlite3 airtrek-sample.db < schema.sql
```

Seed timestamps are expressed as `datetime('now', '-N hours')` etc., so a
re-seed always produces data "from the last few days" — meaning the
last-30-days / MTD queries stay meaningful no matter when you run them.

## Run the example queries

```bash
sqlite3 airtrek-sample.db < queries.sql
```

You'll see, in order:

1. **Total Tows (30D)** — same query that powers the dashboard card.
2. **Total Tows (MTD)** — month-to-date count.
3. **Avg. Tow Time (30D)** — formatted as `Xm YYs` (CTE so `AVG` evaluates once).
4. **Daily counts** — zero-filled across the 30-day window.
5. **Hourly distribution** — divides by the *actual* day span, so a new deployment isn't under-reported.
6. **Per-tug usage** — counts + total distance per tug, what Fleet Status shows.
7. **Per-operator usage** — derived via the new `operator` table.
8. **Per-robot usage** — derived via the `mission_robot` join table.
9. **Flagged for Review** — count of flagged missions.
10. **Recent missions** — what the History view paginates, with operator/tug/route joined in.
11. **Drill-down on mission 3** — events, bags (multi-bag mission), and media — what the detail drawer reads.
12. **Pipeline health** — bags not yet finished post-processing.

## Poke around interactively

```bash
sqlite3 airtrek-sample.db
sqlite> .tables
sqlite> .schema mission
sqlite> SELECT * FROM mission ORDER BY started_at DESC LIMIT 3;
sqlite> SELECT tug.name, COUNT(m.id) FROM tug LEFT JOIN mission m ON m.tug_id = tug.id GROUP BY tug.id;
sqlite> .quit
```

## What this lets you verify

- **The schema is workable** — eleven tables, foreign keys, partial index on
  `flagged`, CHECK constraints on every enum-like column, UNIQUE on
  `(mission_id, kind)` for media — all run cleanly.
- **Idempotency primitives are in place** — `mission.hmi_mission_uuid`,
  `event.client_uuid`, `mission_bag.bag_key`, `mission_media.r2_key` all
  enforce uniqueness so re-running the post-processor on the same bag
  converges instead of duplicating rows.
- **Every dashboard card and chart is one indexed query** against `mission`
  (joining the relevant lookup tables).
- **Multi-bag missions work** — mission 3 spans two bags grouped by
  `hmi_mission_uuid`.
- **No code is needed** to introspect the data — `sqlite3` + a query is enough,
  which is also how you'll debug the live D1 database via `wrangler d1 execute`.
