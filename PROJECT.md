# DRIVO BODYSHOP DASHBOARD: COMPLETE PROJECT FILE (single file)

This one file contains everything Claude Code needs:
- PART 1: Build brief (what to build: data, TSD connection, overdue rules, pages, Cloudflare hosting)
- PART 2: Design spec (how it looks: colours, fonts, layout, components)

## FIRST STEPS FOR CLAUDE CODE
1. Save this file as `PROJECT.md` in the project root and read all of it before writing code.
2. The Drivo logo files are uploaded separately: `logo-white.png`, `logo-blue.png`, `mark-white.png`, `mark-blue.png`. Put them in `public/brand/` (create the folder) and use them as described in section 5 of PART 2.
3. Follow PART 1 for functionality and PART 2 for the visual design. Where they conflict on UI details, PART 2 wins; on data and rules, PART 1 wins.
4. Work in the build order in PART 1. Show progress after each page. Never write to the TSD system (read-only), never commit secrets.

---
# PART 1: BUILD BRIEF
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
# PART 2: DESIGN SPEC
# DESIGN.md – Drivo "Operations Ledger" (v2: serious, restrained)

Paste into Claude Code with: "Redesign the existing dashboard UI to follow DESIGN.md. Keep all data logic, routes and rules unchanged;
only change the presentation layer. Do it page by page, starting with Today, and show me each page before moving on."

## 1. Concept
A serious operations console, like a trading desk or an airline control board: graphite surfaces, hairline rules, precise typography,
the Drivo Blue brand colour and a few muted status colours. Information-dense but calm. It should look expensive and quiet, never playful.
Principles:
1. **Numbers and structure first, words second.** Tables, tabular numerals and short labels beat sentences.
2. **Colour is rare and only means something.** Everything is graphite and grey until something needs action.
3. **No decoration.** No gradients on content, no glows, no emoji, no illustrations, no rounded-bubble UI, no bouncing or looping animation.
4. **Unique through detail, not noise:** a condensed display face for big figures, a strict 4px grid, thin rules, a signature "ledger" table
   look and a runway timeline (section 6). The palette comes from the Drivo logo (Drivo Blue `#0D1CA4`).

## 2. What is wrong today (fix these)
- Task cards are walls of text (headline + 2 sentences + 4 labelled columns + emails + "Paid up" caption).
- Every card has equal weight, so the 3 cars to call do not stand out.
- Default browser selects/checkboxes, plain sidebar with no icons, flat blue boxes.

## 3. Colour tokens (built from the Drivo logo; dark default; define in `:root`)
Logo colours: **Drivo Blue `#0D1CA4`** (the logo background and wordmark colour) and white. The app is graphite + Drivo Blue, with a small set of
distinct, slightly muted status and payer colours so things are easy to tell apart. Serious, not neon.
```
/* surfaces: deep blue-graphite, tinted toward the brand */
--bg-0:  #080B14;   /* page */
--bg-1:  #0E1322;   /* panels */
--bg-2:  #151B2E;   /* raised, hover, table header */
--line:  #212842;   /* hairline rules */
--line-strong: #2F3858;

/* brand */
--brand:        #0D1CA4;   /* Drivo Blue: sidebar background, logo tile, primary button fill */
--brand-deep:   #0A1480;   /* sidebar gradient end / pressed */
--brand-bright: #4A63F0;   /* on-dark accent: links, focus ring, active nav, key figures, charts (readable on dark) */
--brand-tint:   rgba(74,99,240,.14);   /* selected rows, active nav fill */

/* text */
--text-0: #ECEFF8;  --text-1: #A6AEC8;  --text-2: #6E7794;

/* status (muted, used on small marks and subtle row tints; never large solid fills) */
--danger: #E5484D;  --warn: #F0A33A;  --ok: #34B27B;  --info: #4A63F0;
--danger-bg: rgba(229,72,77,.10); --warn-bg: rgba(240,163,58,.10); --ok-bg: rgba(52,178,123,.10);

/* payer tags: distinct hues, outlined chips with a 6px dot and the word spelled out */
--payer-customer: #F0A33A;   /* amber, out-of-pocket = needs the most attention */
--payer-insurance: #2EC4B6;  /* teal */
--payer-bodyshop: #A78BFA;   /* soft violet */
```
- Colour roles: **blue = brand/navigation/selection/focus**, **red = overdue**, **amber = due soon**, **green = paid/completed/collected**,
  and the three payer hues only on small tags. Amber is used for both "due soon" and the Customer payer tag, so the payer tag is a
  hollow outlined chip with a word while due-soon is a left edge bar and row tint; they never look alike.
- Sidebar: solid Drivo Blue gradient (`--brand` to `--brand-deep`) with the white logo. This is the strongest brand moment; the content area stays graphite.
  Active nav item: white text, `rgba(255,255,255,.12)` fill, 2px white bar on the left.
- Primary button: `--brand` fill, white text (hover `--brand-bright`). Secondary: transparent with `--line-strong` border.
- Charts: collected = `--ok`, outstanding = `--brand-bright`, overdue/at risk = `--danger`, grid = hairlines. Max 3 colours per chart.
- Backgrounds are flat; no glows, no blur, no decorative gradients (the sidebar gradient is the only one). Overlays use `0 8px 24px rgba(0,0,0,.45)`.
- Light theme ("Paper"): page `#F4F6FB`, panels `#FFFFFF`, lines `#DDE2EF`, text `#0F1424`/`#525B75`; sidebar stays Drivo Blue; accent `--brand` (#0D1CA4) on light;
  status colours darkened to reach 4.5:1 on white.

## 4. Typography (self-host with @fontsource; no external requests)
- **Display / big figures / page titles:** Barlow Semi Condensed 600 (narrow, engineered feel, makes numbers distinctive).
- **UI and body:** IBM Plex Sans 400/500.
- **Numbers, R/A codes, dates, money:** IBM Plex Mono 500, `font-variant-numeric: tabular-nums`, right-aligned in tables.
- Scale: page title 28, hero figure 56, KPI 32, section title 16 (caps, 0.06em tracking), body 14, label 11 (caps, 0.08em tracking, `--text-2`).
- Labels are small caps in `--text-2`; values in `--text-0`. Max two sizes inside any card. Radius 6px on controls, 8px on panels (small and crisp).

## 5. Logo and branding
The real logo is provided: a white rounded square with a chevron cut-out (arrow pointing forward) and the wordmark "Drivo" in a bold geometric sans, on Drivo Blue `#0D1CA4`.
Provided files (copy into `/public/brand/`):
- `logo-white.png`: full logo, white on transparent (for the blue sidebar and dark surfaces)
- `logo-blue.png`: full logo, Drivo Blue on transparent (for light theme, printed reports, white backgrounds)
- `mark-white.png` / `mark-blue.png`: the square chevron mark only (collapsed sidebar rail, favicon, app icon, loading state)
Use them as-is; never redraw, stretch, recolour or add effects. Clear space around the logo = the height of the "D". Minimum width 96px (full) / 24px (mark).
If SVG versions are available later, replace the PNGs.
Placement:
1. **Sidebar top-left**: white full logo ~112px wide on the Drivo Blue sidebar, with "BODY SHOP RENTALS" in 10px caps, 60% white, under it.
   Collapsed rail: the white mark only.
2. **Printed and exported reports** and the shift handover export: blue logo top-left on white.
3. **Favicon, browser tab and sign-in screen**: the mark (blue tile with white chevron, on white/transparent), logo centred above the sign-in.
4. **Empty and loading states** may show the mark at 40% opacity.
Typography note: the logo wordmark is a geometric sans; the UI uses IBM Plex Sans and Barlow Semi Condensed so the logo stays the only "round geometric" element.

## 6. Layout
- Sidebar 224px, collapses to a 60px icon rail under 1200px. Section icons (lucide, 1.5px stroke): Today=LayoutDashboard, Cars out=Car, Overdue=AlarmClock,
  Shift handover=ClipboardCheck, Balances=Wallet, Collections=PieChart, Reports=FileBarChart, Settings=Settings2. Active item: see section 3 (white text on the blue sidebar).
  Counts are small mono numbers right-aligned; red text only if they contain overdue items.
- Top bar 48px: page title (left), data freshness as a small status dot + mono time (`TSD 8:22 AM`; green < 30 min, amber older, red > 24h),
  refresh icon button, theme toggle, user initials.
- Content max width 1440px, gutters 24px, gap 16px, 4px baseline grid. Mobile: sidebar becomes a bottom tab bar (5 items + More).

## 7. Today page
Four zones, top to bottom:

**A. Status header (replaces the big sentence)**
- Left: the hero figure in Barlow Semi Condensed 56px: the number of cars to call, with the caption `CARS TO CALL TODAY` and a thin
  segmented bar underneath (1px-high rule split into red / amber / grey segments proportional to overdue / due soon / later). If zero: `ALL CLEAR` in `--ok`.
- Right: 4 flat KPI cells separated by vertical hairlines: OVERDUE, AMOUNT AT RISK, DUE IN 3 DAYS, OPEN TASKS. Each: caps label, mono value, and a tiny 14-day
  sparkline (1.5px line, `--text-2`, last point marked). Value turns `--danger` only if > 0 for the overdue cells. No count-up animation.

**B. Runway: scheduled returns, 14 days**
- A thin horizontal timeline: day columns with mono labels (`T 22`), weekend columns slightly darker. Today is a 1px `--brand-bright` line with a small "TODAY" tag.
- Each rental is a small 10px square/diamond mark coloured by state (overdue/due soon/ok/neutral) with the last 4 digits of the R/A under it in mono.
  Hover or focus: a tooltip with R/A, renter, payer, amount. Click: scrolls to and highlights the task.
- "Later than next week" is a `+1` marker at the right edge.

**C. Filter bar (one slim row)**
- Underlined tabs for status with mono counts: `To do 13 · In progress 0 · Done 0 · Snoozed 0`.
- Compact custom dropdowns (priority, payer, body shop) and an "Only mine" switch. No native controls.

**D. Task ledger: compact rows, progressive disclosure**
One row per task (56px), columns on a fixed grid so the eye scans straight down:
```
| edge | R/A (mono)  Payer tag | Reason (short) | Body shop  [call] | Customer  [call] | Amount (mono) State | actions |
```
- Left edge: 3px bar in danger / warn / neutral; overdue rows get a 4% danger tint. No glow.
- Reason: max 6 words, e.g. `Due in 1 day · extend?`, `Overdue 2 days · call now`, `Balance $540 · 34d`. The long explanatory sentence is removed
  from the row and lives only in the drawer.
- Contacts: name plus a square icon button for phone (`tel:`) and one to copy email. Phone numbers and emails are not printed in the row;
  they show on hover and in the drawer. Missing body shop = muted `Add body shop` link.
- Money: right aligned mono. Prepaid shows as a small outlined `Prepaid $127` tag with a check icon, not a big green word.
- Actions: one primary text button (`Start`, `--brand` filled), then icon-only Complete / Snooze / Take it / Expand with tooltips. After Start the primary becomes `Complete`
  and the row shows a 2px `--brand-bright` left edge.
- Expanded drawer (inline, 160ms): full reason sentence, both contacts with phone/email, out-since, drop-off, extensions, unit, bill split renter/company,
  notes, completion outcome (Extended to date / Returned / Payment promised / Paid / Unreachable / Other).
- Group headers: slim sticky caps labels with count and one short hint max. Completed rows collapse to 36px, dimmed, with a check, grouped at the bottom.

## 8. Other pages
- **Overdue / Cars out / Balances:** the same ledger table: sticky `--bg-2` header, 44px rows, hairline separators only, mono right-aligned numbers,
  funnel icon filters in the header, amount cells with a 2px inline bar showing share of max, payer tags as above. Empty state: a single line
  of text with a thin check icon ("No overdue rentals"), no emoji or illustrations.
- **Collections:** collection rate as a large figure with a thin horizontal progress rule (not a colourful gauge); KPI cells with up/down deltas in `--ok`/`--danger`;
  horizontal bars (collected = `--ok`, outstanding = `--brand-bright`) for payer, insurer, body shop; aging as a single stacked bar from `--text-2` to `--danger` as it gets older; trend as a 1.5px line chart
  on hairline gridlines. Max two colours per chart.
- **Shift handover:** three ruled columns (Not started / In progress / Completed) with counts, user initials and time on completed items, and an export button.
- **Reports / Settings:** form-like, single column, labelled inputs, same controls.

## 9. Components (`/src/ui`, single source of truth)
`Panel, Stat, Sparkline, Tag, StatusDot, IconButton, Tooltip, Tabs, FilterSelect, Switch, DataTable, TaskRow, TaskDrawer, Runway, EmptyState, Toast, Skeleton, Logo`.
Radix primitives for behaviour (Select, Tooltip, Dialog, Switch), lucide-react icons, visx or Recharts for charts. Tailwind theme extended with the tokens above;
no hard-coded hex values in components.

## 10. Motion (minimal)
- 120-160ms ease-out for hover, expand and tab changes. Page content fades in once (150ms). Charts draw in once (400ms).
- Nothing loops or pulses. State changes (Start / Complete) are a colour/edge change; completed rows slide to the Completed group (200ms).
- Respect `prefers-reduced-motion` (remove transitions except colour).

## 11. Accessibility and quality
- Contrast >= 4.5:1 for text, >= 3:1 for UI marks; status never relies on colour alone (always icon or word too).
- All icon buttons have aria-labels, visible 2px `--brand-bright` focus rings, targets >= 40px on touch. Table and runway are keyboard navigable.
- Skeleton loaders, fonts with `font-display: swap`, no heavy effects.

## 12. Copy rules
- Max 6 words per reason line, sentence case, no exclamation marks, no emoji.
- Dates `Oct 22`, times `4:39 PM`, money `$1,734.56`, durations `43d`. Missing value = muted `-`.

## 13. Acceptance checklist
- [ ] 6+ task rows above the fold on 1080p (today about 3).
- [ ] No paragraph of text visible in the default state of any row.
- [ ] Graphite + Drivo Blue in the default view; red/amber/green and payer hues appear only where they carry meaning, and no two payer tags look alike.
- [ ] Logo present in the sidebar, favicon and printed reports, in light and dark variants.
- [ ] Dark and light themes both pass contrast checks.

