# Dashboard update: two changes

Read this whole file first. Work on Part A first, then Part B. Read-only toward TSD at all times. Show me the investigation results
(A1 and B notes investigation) BEFORE changing any code, then implement after I confirm.

---
# PART A: Exclude tolls, tickets and other non-rental charges from balances and reports

Problem: the dashboard's Balances, Collections, Overdue and Reports views include charges that are NOT rental charges
(tolls, tickets/citations/fines, and similar third-party or administrative fees). We are only responsible for the rental itself,
so these must never count toward balances, amounts due, collection rates, overdue amounts at risk, or any report/export.

1. INVESTIGATE FIRST (do not guess). Find where amounts come from (the TSD adapter / sample report and the code that computes
   totalBill, totalAmountDue, renterAmountDue, companyAmountDue, billed, collected, outstanding). Check whether TSD returns
   charges as line items (charge type/code/description) or only as totals. List every distinct charge type/description you can
   find in the real data or sample, with counts and totals, grouped into: rental charges vs. non-rental
   (tolls, tickets, citations, violations, admin/processing fees, etc.). Ask me to confirm ambiguous types before excluding them
   (for example fuel, damage, cleaning, taxes, insurance/CDW, late fees, extension fees). Do not silently exclude anything not
   clearly a toll or ticket.
2. If TSD gives charge line items: calculate all money fields from rental charge lines only. Put the exclusion list in ONE config file
   (config/charges.ts): excluded charge types / case-insensitive keyword patterns (toll, ticket, citation, violation, fine, parking,
   e-zpass, ezpass, pass-through, admin fee ...), plus an allow-list/override. Payments must be applied only to the balance of the
   included charges so amounts due are never wrong (a payment made toward a toll must not reduce the rental balance, and vice versa;
   if TSD does not say which charge a payment is for, flag it and ask me).
3. If TSD only gives totals (no line items): find the fields that give the non-rental portion (tolls/tickets/other fees totals)
   and subtract them. If that is impossible, STOP and tell me exactly what field or report TSD support needs to provide; do not guess.
4. Rentals that ONLY have non-rental balances due (e.g. rental fully paid but a toll still owed) must NOT show up in Balances, Overdue,
   Today tasks or Reports. Rentals with both show only the rental portion.
5. Add a small optional view, hidden by default, in Settings > "Excluded charges": rentals and amounts that were excluded (tolls/tickets),
   so I can verify nothing is lost, with CSV export. Never mix it into the totals.
6. Apply the rule everywhere: Today tasks, Balances, Collections (billed, collected, outstanding, rate %), Overdue amount at risk, Reports,
   all CSV/PDF exports, and sparklines/history snapshots (recompute, or mark old snapshots as "before fix").
7. Tests (Vitest): rental charge + toll + ticket gives only the rental amount due; toll-only balance excluded from all views; collection
   rate uses rental charges only; keyword matching is case-insensitive; unknown charge types are flagged, not silently included or excluded.

---
# PART B: New task type, Insurance verification

Build it on top of the existing task system (same statuses: Not started / In progress / Completed, same Today page, contacts, priorities). Keep it simple.

## Rule
- When a rental is opened, if it is NOT out of pocket (payer is Insurance or Body shop; i.e. a company/insurer is attached or the billing type is not Customer),
  create a task "Verify insurance coverage". Deadline = 3 days after pickup. Show "due in X days" and mark OVERDUE after the deadline.
- Billing type is detected automatically from the existing payer logic (customer-only = out of pocket = no verification task).
  Rentals with an ambiguous or missing payer go to "Data to fix", not silently skipped.
- Apply it to ALL rentals that are currently open, including ones opened before this feature existed (use their pickup date for the
  3-day deadline; those already past 3 days show as overdue verification). Do not create tasks for returned rentals.
- Each task shows: R/A, insurer, body shop, adjuster/claim contact if available, pickup date, deadline, days left. Use the existing compact row design
  (DESIGN.md) with a clear "Insurance verification" tag; place it in its own group on Today, above "Due soon" and below overdue-rental calls.

## How a task gets completed (TSD is read-only for us)
- I verify coverage by phone/portal, then write a note in TSD, e.g. "Insurance verified, $30 for 30 days".
- The dashboard reads the rental's Notes field from TSD. When a note indicating verification is found, the task auto-completes (also allow manual Complete).
- First INVESTIGATE how notes arrive from TSD (field name, one note vs. many, timestamps, author). Show me what you find and a few real examples before coding.

## Note parsing (lenient, no strict format)
- Detect verification by keywords (case-insensitive): "verified", "verification", "approved", "coverage confirmed".
- Extract when present: daily rate covered ("$30"), number of days covered ("30 days", "for 30 d", "30 days approved"), and optionally the date.
  Examples to support: "insurance verified, $30 for 30 days", "Ins verified $35/day 21 days", "approved 14 days @ $40".
- Put the patterns in one config file so I can add formats. If a note says verified but days cannot be read, mark "Verified, days unknown" and show the raw note.
- If several notes exist, use the most recent verification note. An extension note like "extended 10 more days" adds to the covered days
  (ask me if unsure about a specific case).

## Coverage display
- On every non-out-of-pocket rental (Today rows, Cars out, Balances, rental drawer) show: covered days, days used so far, days remaining, and daily rate
  ("21 / 30 days, 9 left, $30/day"). Thin progress bar. Amber when <= 3 days remain, red when coverage is exhausted but the rental is still out.
- Rentals still out and past the covered days create a task "Coverage ending / extend with insurance".
- Rentals without a verification note show "Not verified" (red once past the 3-day deadline).

## Tests (Vitest)
Pickup day 0-3 gets a task, day 4 is overdue; out-of-pocket gets no task; note parsing for the example formats; coverage days used/remaining math;
a verified note auto-completes the task; open rentals from before the feature are included.
