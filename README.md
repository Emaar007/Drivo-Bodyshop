# Drivo Bodyshop Rentals – Daily Task Dashboard

Catches body shop rentals that are overdue or about to be due, shows who owes what, and tracks the
team's follow-up work. Runs on Cloudflare (Workers + D1, free tier); data comes from TSD's Azure SQL
database through a small read-only push script.

## Data flow

```
TSD (Azure SQL 42295)  --SELECT only-->  puller server (hourly)    --POST /api/ingest-->  Cloudflare Worker + D1  -->  React app
                                           scripts/tsd/push_bodyshop.py                      src/worker                  src/app
```

- **Why a push and not a Worker cron fetch:** the Azure SQL firewall allow-lists IPs. Cloudflare Workers
  have no fixed IP, so the Worker cannot connect. A puller server with a fixed, allow-listed IP runs the
  extraction and posts the JSON (setup: `docs/IT-HANDOVER.md`). The Worker's own cron (07:00
  New York) only builds the day's task list and snapshot from the latest push.
- `scripts/tsd/bodyshop.sql` is the only place that touches TSD. It contains SELECTs only; the connection
  is opened read-only; `tests/tsd-readonly.test.ts` fails if a write statement is ever added.
- Field mapping TSD -> app lives in `scripts/tsd/bodyshop.sql` (columns) and `src/shared/normalize.ts`
  (payer, money, contacts). Everything learned about TSD's schema is in `docs/tsd-schema.md`.

## Layout

```
src/shared/      types, dates, normalize (TSD -> Rental), rules (overdue/due soon/aging/collections), config/
src/worker/      Hono API, D1 access, task engine, cron (index.ts, data.ts, tasks.ts, auth.ts)
src/app/         React + Vite + Tailwind: Today, Overdue, Balances, Collections, Reports, Shift, Settings
scripts/tsd/     bodyshop.sql (extraction), push_bodyshop.py (puller, see docs/IT-HANDOVER.md), make_sample.py (anonymiser)
migrations/      D1 schema
data/sample.json anonymised extract (real shape, fake people) used in dev/tests and with USE_SAMPLE_DATA=true
tests/           Vitest: rule boundaries, payer/name normalisation, money, read-only guard
docs/            tsd-schema.md
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars          # USE_SAMPLE_DATA=true, INGEST_TOKEN=dev-token
npm run db:migrate:local
npm run dev                             # http://localhost:5173  (Worker + local D1 via the Cloudflare Vite plugin)
npm test
```

With `USE_SAMPLE_DATA=true` the app serves `data/sample.json` until a push arrives. To push real data to
the local server (needs the TSD password and an IP on the Azure firewall, e.g. the office network):

```bash
python3 -m venv .venv && .venv/bin/pip install pymssql
set -a; . ~/.config/drivo/tsd.env; set +a; export TSD_SQL_DB=42295
.venv/bin/python -I scripts/tsd/push_bodyshop.py --url http://localhost:5173 --token dev-token
```

`--out .cache/payload.json` writes the payload instead of posting; `npm run sample:build` turns it into a
fresh anonymised `data/sample.json`.

## Deploy

1. `npx wrangler login`
2. `npx wrangler d1 create drivo-bodyshop` -> paste the id into `wrangler.jsonc` (`database_id`).
3. `npm run db:migrate:remote`
4. `npx wrangler secret put INGEST_TOKEN` (any long random string; the puller server gets the same value).
5. `openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET` (signs the login cookie).
6. Optionally `wrangler.jsonc` vars: `ADMIN_EMAILS` (comma-separated fallback admins). Keep `USE_SAMPLE_DATA` `"false"`.
7. `npm run deploy`
8. **Login**: open the URL. With no accounts yet it shows a one-time "first-time setup" form that creates the first
   admin. Admins add the rest of the team under Settings -> Users (temporary password, changed at first sign-in).
   Sessions are HMAC-signed HttpOnly cookies (7 days); 8 failed attempts per email/IP lock login for 15 minutes.
   Cloudflare Access was the original plan but its free plan needs a card on file; if it is ever enabled in front of
   the Worker, its `Cf-Access-Authenticated-User-Email` header is honoured automatically.
   `/api/ingest` skips the login and is protected by the bearer token instead.

### Data puller (TSD -> dashboard)

The dashboard cannot reach TSD itself (Azure SQL firewall, no fixed IP on Workers), so a small server with a
fixed IP runs `scripts/tsd/push_bodyshop.py` hourly and POSTs to `/api/ingest`. Install it with
`sudo bash deploy/puller/setup.sh`; the full procedure (prerequisites, ingest token, testing with `--check`,
troubleshooting) is in **[docs/IT-HANDOVER.md](docs/IT-HANDOVER.md)**.

The DigitalOcean droplet `143.244.161.163` that used to do this is no longer used (third-party owned).

## Rules (src/shared/config/rules.ts)

- **Overdue**: still out (`DATE_IN` empty in TSD) and scheduled drop-off date < today (America/New_York).
  Drop-off today is "due today", not overdue; yesterday is 1 day overdue.
- **Due soon**: still out, drop-off within `dueSoonDays` (3, editable in Settings; per-payer override possible).
- **Open-ended**: still out, no drop-off date.
- **Payer**: company billed on the posted charges, else the direct-bill company on the RA; its TSD company type
  decides Insurance / Body shop; none = Customer; both owing = Mixed. Customer-paid overdue rentals are priority 1.
- **Money**: returned rentals use TSD's posted charges and payments (`due = bill - paid`, validated against TSD's
  A/R ledger). Rentals still out are **estimated** (daily rate x elapsed days x tax) and labelled "est" because TSD
  posts charges only at return. Negative balances are credits and never counted as receivable.
- **Tasks**: generated per rental per reason per day; statuses Not started -> In progress -> Completed, plus
  Snoozed. Completing asks for an outcome. A rental still overdue tomorrow gets a fresh task.

## Where things are editable

| What | Where |
|---|---|
| Due-soon days, admin emails | Settings page (D1 `settings`) or `wrangler.jsonc` vars |
| Body shop contacts (phone/email/contact person) | Settings page (overrides TSD's `Cco` record) |
| Name aliases (STATEFARM -> State Farm) | `src/shared/config/{bodyshops,insurers}.ts` + Settings page |
| Tax estimate per location, priority order, aging buckets | `src/shared/config/rules.ts` |
| Which TSD sources count as body shop rentals | `scripts/tsd/bodyshop.sql` (`#base`) |

## Open items

- Ask TSD for a **read-only** SQL login and switch the puller's settings to it (`docs/IT-HANDOVER.md`).
- Cloudflare Access policy and the `/api/ingest` bypass rule are set up in the Cloudflare dashboard by the owner.
- Optional later: daily/weekly email summary (Email Routing / Resend) from the Worker cron.

## Design notes

The UI follows `PROJECT.md` PART 2, the "Operations Ledger" spec: graphite surfaces tinted toward Drivo Blue, hairline
rules, tabular numerals, colour only where it means something (blue = brand / selection, red = overdue, amber = due soon,
green = paid / collected; payer hues only on small outlined tags). Dark is the default; "Paper" is the light theme.

- Tokens: `src/app/index.css` (`--bg-0/1/2`, `--line`, `--brand*`, `--text-0/1/2`, status and payer colours). No hex in components.
- Type (self-hosted via @fontsource-variable/inter): one family, Inter, with optical sizing. Titles and big figures 600 with tight
  tracking, UI 400/500, R/A numbers 600 with wide tracking, money and dates in tabular figures (`.num`). The spec's Plex/Barlow mix
  was replaced on 2026-10-21 because the small monospace figures read fuzzy on the dark theme.
- Logo: `public/brand/logo-{white,blue}.png`, `mark-{white,blue}.png`, derived from the provided Drivo logo (white = blue sidebar,
  blue = Paper theme and print). `src/app/ui/Logo.tsx`.
- Components: `src/app/ui/` (primitives: Panel, Stat, Sparkline, Tag/PayerTag, StatusDot, IconButton, Tooltip, Tabs, FilterSelect,
  Switch, EmptyState, Skeleton; plus Runway and TaskRow). `src/app/components/ui.tsx` keeps the older names as a thin layer on top.
- Today: status header (hero figure, segmented bar, four KPI cells with 14-day sparklines from snapshots), the 14-day runway,
  one filter row, then the task ledger (56px rows, inline expand, completed rows collapsed at the bottom).
- Copy: reasons are at most six words; dates `Oct 22`, times `4:39 PM`, durations `43d`, missing values `-`.
