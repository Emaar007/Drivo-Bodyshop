# Drivo Bodyshop Rentals – Daily Task Dashboard (build brief, v2)

## Goal
A dashboard for Drivo Rent A Car's bodyshop rentals, running on Cloudflare (free tier), pulling data automatically
from our rental system (TSD) and showing **Today's tasks**: rentals that are overdue and must be extended, rentals
about to be due, and the money at risk. No manual uploads.

## Why this exists (business context)
Most bodyshop rentals are out-of-pocket (customer pays). If a rental passes its drop-off date and nobody extends it,
it keeps running unpaid and creates outstanding balances. The main job is catching overdue rentals every day, with
customer-paid ones first. Other payers: insurance companies and body shops.

## Definitions
- **Overdue** = rental is still out (not returned) AND its scheduled drop-off date has passed (drop-off date < today,
  America/New_York). Example: today is 20 Oct, drop-off was 19 Oct, not returned -> overdue by 1 day, must be extended.
- **Due soon** = still out and scheduled drop-off within the next 3 days (configurable). Extend before it goes overdue.
- **Open-ended** = still out and no drop-off date. Show separately, flagged "no return date".
- Payer type: Customer (out of pocket) / Insurance / Body shop. Customer-paid overdue rentals are the top priority.
- Amount due < 0 means credit/overpaid: show separately, never count as receivable.

## Hosting: Cloudflare (free)
- **Cloudflare Workers** (with static assets) serving a React + Vite + TypeScript + Tailwind front end,
  and a **Hono** API in the same Worker. Deploy with `wrangler`.
- **D1** (SQLite) for daily snapshots, task status (done / snoozed / extended), and notes.
- **Cron Trigger** (e.g. 07:00 America/New_York, set in UTC accordingly) fetches TSD, stores a snapshot, builds the day's task list.
- **Cloudflare Access (Zero Trust)** in front of the app for login (allow only company emails / Microsoft login). The Worker
  reads the verified identity header/JWT to record who completed a task. No custom auth code.
- Secrets (never in code or git): `wrangler secret put TSD_API_KEY`, `TSD_API_URL`. Local dev uses `.dev.vars` (gitignored).
- API key only used server-side in the Worker, never sent to the browser.
- Note: Workers do not have a fixed outbound IP. Confirm with TSD whether the API restricts IPs. If it does, we need a different
  host or proxy; stop and tell the user.

## Data source: TSD (API docs pending)
TSD has no public API docs. The user will get documentation from TSD support. Until then:
- Define `interface RentalSource { fetchRentals(): Promise<Rental[]> }` in `src/worker/source/types.ts`.
- Implement `SampleFileSource` (reads `/data/sample.xlsx`, converted to JSON at build time, for development) and a stub `TsdSource`
  with TODOs for endpoints, auth, pagination, field mapping. Keep ALL field mapping in `src/worker/source/tsd.ts`.
- **The app must only send read requests** (GET / read-only queries). The key has full access, so never write a call that changes TSD data.
  Add a test that the TSD client exposes no non-GET methods.
- Normalised `Rental` type:
  `raNumber, pickupDate, scheduledDropOff (nullable), actualReturn (nullable) or status, isOut (bool), sourceOfBusiness,
  referralAgency (body shop), companyName (insurer), rentalDays, totalBill, totalAmountDue, renterBill, renterAmountDue,
  companyBill, companyAmountDue`.
- `isOut` must come from the real status / actual-return field in TSD. NOTE: the sample report has only "Drop Off Date", and
  it cannot tell a returned car from an overdue one; do not infer `isOut` from the drop-off date alone once the API is connected.
  In the sample file, treat a blank Drop Off Date as "still out" (that is what the sample means).

### Sample report columns (for the sample adapter and as a reference of what TSD should provide)
R/A Number, Pickup Date, Drop Off Date, Source of Business, Referral Agency, Company 1 Name, Rental Days, Total Bill,
Total Amount Due, Renter Total Bill, Renter Amount Due, Total Company Total Bill, Total Company Amount Due.

### Data-quality rules (seen in the sample)
- Referral Agency and Company 1 Name are sometimes swapped or the same value. Normalise using editable lists
  (`config/bodyshops.ts`, `config/insurers.ts`, alias map e.g. STATEFARM -> State Farm).
- Blank company => Customer pays. Payer = Mixed when both renter and company balances are > 0.
- Parse dates as America/New_York.

## Navigation (separate sections, left sidebar)
1. **Today's Tasks** (daily work: act on things)
2. **Balances** (all rentals with money due: search and filter)
3. **Collections** (how much of what we billed has been collected, with percentages)
4. **Reports** (period reports and exports)
5. **Shift** (end-of-shift handover)
6. **Settings** (rules, body shop contacts, name aliases; admin only)
The pages below map to these sections: "Today" = Today's Tasks, "Balances" = Balances, "Shift view" = Shift, "History" lives inside Reports.

### Collections section (amount collected and percentages)
- Definitions: `billed = Total Bill`, `outstanding = max(Total Amount Due, 0)`, `collected = billed - outstanding`
  (credits/overpayments shown separately, not netted into collected), `collection rate % = collected / billed`.
  Compute the same for renter and company shares (`Renter Total Bill/Amount Due`, `Total Company Total Bill/Amount Due`).
- KPI cards: total billed, collected, outstanding, collection rate %, overdue amount at risk, number of rentals with balance.
- Breakdowns (table + bar chart, sortable): collection rate % and outstanding by payer type (Customer / Insurance / Body shop),
  by insurer, by body shop, by month of pickup, by month of drop-off.
- Compare periods (this month vs last month, last 30 vs previous 30) with up/down indicators.
- Aging of outstanding (0-15, 16-30, 31-60, 60+ days) as a stacked bar.
- Trend line of collection rate % and outstanding over time from the daily snapshots (needs snapshots, so history starts the day we begin saving them;
  say so on the chart).
- Every figure drills down to the filtered Balances table.

### Reports section
- Preset reports: Overdue rentals, Outstanding balances (aging), Collections by payer, Collections by body shop, Collections by insurer,
  Task activity (completed / in progress by user and day), Rentals returned / extended per day.
- Controls: date range, payer type, insurer, body shop, user. Export CSV and print-friendly view / PDF.
- Scheduled summary (optional later): daily or weekly email summary via Cloudflare Email Routing/Resend.

## Pages
1. **Today**: the task list, grouped by priority:
   1. Overdue, customer-paid (call the customer, extend the rental, collect payment)
   2. Overdue, insurance / body shop (call the adjuster or shop, get extension approved)
   3. Due in 1-3 days (extend before it goes overdue)
   4. Open-ended rentals (no return date)
   5. Data to fix (missing/ambiguous payer, negative balances)
   Each row: R/A number, renter/company, body shop, payer, scheduled drop-off, days overdue, rental days so far, amount due
   (renter vs company split), status buttons: Extended (+ new date) / Returned / Snooze until / note.
2. **Overdue**: sortable, filterable table (payer type, insurer, body shop, days overdue), CSV export.
3. **Balances** (all rentals with amount due > 0, open and closed): full table plus summary cards.
   - Columns: R/A, status (out / returned), payer type, who owes (renter amount due vs company amount due), body shop, insurer,
     pickup, drop-off, days outstanding, total bill, total amount due.
   - `days outstanding` = days since drop-off for returned rentals; for rentals still out, days since pickup (label it clearly).
   - Filters: payer type, insurer, body shop, status (out / returned), age bucket (0-15, 16-30, 31-60, 60+ days) or a custom min days,
     min/max amount due, "customer owes" vs "company owes", text search on R/A or name.
   - Sorting: largest amount due, longest outstanding, and any column. Quick presets: "Largest balances", "Oldest unpaid", "Customer-paid owing".
   - Summary: total due, by payer type, by insurer, by body shop, aging buckets, top 10 balances. CSV export of the filtered view.
   - Click a row to open the rental detail drawer (contacts, history, notes, create a task).
4. **Shift view** (end of shift): tasks grouped by status for the day/shift: Completed, In progress, Not started (with counts). Shows who
   completed each, when, and the note/outcome. Filter by user and date; a "copy / export shift summary" button for handover.
5. **History**: per-day snapshot counts and amounts (overdue count, amount at risk), what changed since yesterday
   (new overdue, extended, returned).
Header shows "Data updated <time>" and a "Refresh now" button (rate-limited); warn if the last successful fetch is older than 24h.

## Contacts and task workflow
- Every rental has a referring body shop. Our database holds each body shop's contact info (name, contact person, phone, email, address).
  Add a `Contact` source: `fetchBodyshopContacts()` (from TSD/our DB once docs are known; until then a CSV import / `bodyshops` table in D1
  with an admin page to edit). Match rentals to body shops by normalised name (use the alias map; unmatched names go in "Data to fix").
- Also show the renter (customer) name and phone, and the insurer name (and phone/claim contact if available) on each task.
- Every task card shows, in one place: R/A, why it is a task (overdue 1 day, balance $X 34 days old...), body shop name + phone (tap-to-call
  `tel:` link) + email, customer name + phone (tap-to-call), insurer, amounts, and the suggested action (e.g. "Call Novitec Auto Body,
  customer is out of pocket, extend to <date>").
  Example: "BRK-22784, referred by Novitec Auto Body (phone ...), customer <name> (phone ...), overdue 1 day, $1,734.56 billed".
- Task statuses: **Not started -> In progress -> Completed** (also Snoozed). Buttons on every task: Start, Complete, Snooze, Reopen.
  Completing a task asks for an outcome (Extended to <date> / Returned / Payment promised <date> / Paid / Unreachable / Other) and an optional note.
  Store user, timestamps and outcome in D1. A task that is completed but still overdue/unpaid the next day comes back as a new task.
- Task filters on Today: status tabs (All, Not started, In progress, Completed) with counts, by priority, by payer, by body shop, assigned user.
- Optional: assign a task to a user ("Take it").

## Rules config
`config/rules.ts`: DUE_SOON_DAYS = 3, timezone, priority order, per-payer overrides. Rules live in one pure, tested module.

## Tests (Vitest)
Overdue/due-soon boundaries (drop-off today is not overdue; yesterday is 1 day overdue), payer derivation,
name normalisation, negative balances, no-write-calls guard on the TSD client.

## Build order
1. Scaffold Vite + React + Hono Worker + D1 (wrangler), sample adapter, normalisation, rules engine with tests.
2. Today, Overdue, Balances pages on sample data.
3. D1 schema: snapshots, tasks, notes. Cron Trigger saving a daily snapshot.
4. Cloudflare Access login, record who handles each task.
5. Real TSD adapter once docs arrive; confirm the IP restriction question; deploy with `wrangler deploy`.

---

## Implementation notes (2026-10-20, after the first build)

What differs from the brief above, and why:

- **TSD data source = Azure SQL, not an API.** TSD's data is in `azure-sql-tsd-drivo.database.windows.net`, database `42295`
  (see `docs/tsd-schema.md`). The Azure firewall allow-lists IPs; Cloudflare Workers have no fixed IP, so the Worker's cron
  cannot fetch. Instead a puller server with a fixed, allow-listed IP runs `scripts/tsd/push_bodyshop.py`
  hourly and POSTs the extract to `/api/ingest` (bearer `INGEST_TOKEN`). Setup: `deploy/puller/` and
  `docs/IT-HANDOVER.md`. (Until 2026-11 this was the third-party droplet `drivo-push`, 143.244.161.163; retired.)
  Since 2026-11-25 the Worker instead **pulls** the extract hourly (:25) from the corporate portal (corporate.drivo.com runs the
  same puller at :20 and serves the result; secret `DRIVO_EXTRACT_TOKEN`, code `src/worker/extract.ts`). "Refresh now" pulls on
  demand. 07:25 New York the cron also rebuilds the day's tasks/snapshot. Pushes to `/api/ingest` keep working.
- `RentalSource`/`TsdSource` from the brief became `scripts/tsd/bodyshop.sql` (the only TSD-touching code, SELECTs only,
  guarded by `tests/tsd-readonly.test.ts`) + `src/shared/normalize.ts` (all field mapping). `SampleFileSource` is
  `data/sample.json`, an anonymised real extract (`scripts/tsd/make_sample.py`), served when `USE_SAMPLE_DATA=true`.
- `isOut` = `Cra001.DATE_IN IS NULL` (real return field). Money: returned rentals from posted charges/payments in `Cpay`
  (`due = ΣC − ΣP`, validated against TSD's A/R ledger); rentals still out are **estimated** (rate × days through the later of
  now / scheduled drop-off × tax) and labelled "est" everywhere.
- Body shop rentals = TSD sources 146-150 (`<LOC> B2B - BODYSHOP`) and older per-shop sources, or a referral agency of
  company type body shop / repair facility. Volume: ~10-20 rentals a month since Dec 2025, ~6 out at a time.
- Overdue page lives at `/overdue`; History is the "History (snapshots)" preset inside Reports.

Run: `npm run dev` (sample data) · `npm test` · deploy steps in `README.md`.

## Design spec (2026-10-21)

`PROJECT.md` PART 2 ("Operations Ledger") is the visual spec and wins on UI details. Implemented in `src/app/index.css` (tokens),
`src/app/ui/` (Logo, primitives, Runway, TaskRow) and `public/brand/` (logo files derived from the provided Drivo logo).
Dark is the default theme, "Paper" is light. Fonts are self-hosted via @fontsource.
