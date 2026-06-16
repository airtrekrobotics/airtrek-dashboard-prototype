# Sample SQLite Database (schema v0.3)

A tiny working version of the [backend schema](../backend.md) — nine tables
seeded with a handful of real missions plus a couple of dummy bags, so you
can poke at it and see how the dashboard's metrics map to real SQL and how
the post-processing pipeline classifies what it sees.

The same schema runs on **Cloudflare D1** unchanged (D1 *is* SQLite). When the
real backend lands, you'll point D1 at this same DDL.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | `CREATE TABLE`s + sample `INSERT`s. Idempotent — re-run on a fresh db file. |
| `queries.sql` | The example dashboard queries from `backend.md`, runnable. |
| `airtrek-sample.db` | The resulting database (~130 KB). Checked in for convenience. |

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
7. **Per-operator usage** — derived via the `operator` table.
8. **Per-robot usage** — derived via the `mission_robot` join table.
9. **Flagged for Review** — count of flagged missions.
10. **Pipeline health** — `classification × status` breakdown across every bag the cloud has ever seen.
11. **Recent missions** — what the History view paginates, with operator/tug/route joined in.
12. **Drill-down on mission 3** — events, media, and the (single, 1:1) source bag from `mission_processing`.
13. **Dummy / pending bags** — bags the classifier dropped or hasn't run on yet; live only in `mission_processing` with no `mission` row.

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

- **The schema is workable** — nine tables, foreign keys, partial index on
  `flagged`, CHECK constraints on every enum-like column, UNIQUE on
  `(mission_id, kind)` for media — all run cleanly.
- **Idempotency primitives are in place** — `mission.source_bag_key`,
  `event.client_uuid`, `mission_media.r2_key`, and
  `mission_processing.bag_key` all enforce uniqueness so re-running the
  post-processor on the same bag converges instead of duplicating rows.
- **Every dashboard card and chart is one indexed query** against `mission`
  (joining the relevant lookup tables).
- **The real-vs-dummy classifier is first-class.** Two of the seeded
  rows in `mission_processing` are dummy bags (`classification='dummy'`,
  `status='done_dummy'`) with no `mission` row, so the dashboard sees
  only the 8 real missions while the pipeline keeps an audit trail of
  what was dropped and why.
- **No code is needed** to introspect the data — `sqlite3` + a query is enough,
  which is also how you'll debug the live D1 database via `wrangler d1 execute`.
