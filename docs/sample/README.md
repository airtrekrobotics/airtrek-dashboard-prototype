# Sample SQLite Database

A tiny working version of the [backend schema](../backend.md) — the five
tables seeded with a handful of missions, tugs, robots, events, and media
pointers — so you can poke at it and see how the dashboard's metrics map to
real SQL.

The same schema runs on **Cloudflare D1** unchanged (D1 *is* SQLite). When the
real backend lands, you'll point D1 at this same DDL.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | `CREATE TABLE`s + sample `INSERT`s. Idempotent — re-run on a fresh db file. |
| `queries.sql` | The example dashboard queries from `backend.md`, runnable. |
| `airtrek-sample.db` | The resulting database (~60 KB). Checked in for convenience. |

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
3. **Avg. Tow Time (30D)** — formatted as `Xm YYs`.
4. **Daily counts (last 30 days)** — drives the 30-day chart.
5. **Hourly distribution** — drives the bimodal "Daily Pattern" chart.
6. **Per-tug usage** — counts + total distance per tug, what Fleet Status shows.
7. **Flagged for Review** — count of flagged missions.
8. **Recent missions** — what the History view paginates.
9. **Drill-down on mission 3** — its events + media, what the detail drawer reads.

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

- **The schema is workable** — five tables, foreign keys, partial index on
  `flagged`, all run cleanly.
- **Every dashboard card and chart is one indexed query** against `mission`.
- **No code is needed** to introspect the data — `sqlite3` + a query is enough,
  which is also how you'll debug the live D1 database via `wrangler d1 execute`.
