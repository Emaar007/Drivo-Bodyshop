# TSD database: what we learned (2026-10-20)

TSD has no API. Drivo's TSD data lives in an **Azure SQL** database we can read directly:

- Server `azure-sql-tsd-drivo.database.windows.net`, database **`42295`** (`DrivoDatabase` on the same server is empty).
- Login `tsddrivoadmin` (full access - we only ever run SELECTs; ask TSD for a read-only login).
- The Azure firewall allow-lists the office network and the puller server. Cloudflare Workers have no
  fixed IP and cannot connect, which is why the puller pushes the data to the Worker (see README "Data flow"
  and `docs/IT-HANDOVER.md`). The old DigitalOcean droplet `drivo-push` (143.244.161.163) is retired and
  should be removed from the firewall.

## Tables we use

| Table | Rows | What it is | Columns we use |
|---|---|---|---|
| `Cra001` | 805k | Rental agreements. `TYPE`: **C** = rental (open while `DATE_IN IS NULL`, `CLOSED_FLAG=0`), **D** = after-rental sub-RA (`KNUM` like `BRK-22784-D01`: tickets, tolls, damage billed after return), **V** = void, **T** = transfer | `KNUM`, `DATE_OUT`, `EXP_DATE` (scheduled drop-off), `DATE_IN` (actual return), `CLOSED_FLAG`, `RentalDays` (0 while open), `SOURCE`, `ReferralAgency` (-> `Cco.NUM`), `LOC_OUT`, `UNUM`, `CLASS`, renter name/phones, `RateID`, `CHECKED_OUT_BY`, `PO` |
| `CDetail` | 1.7M | One row per RA with extra fields | `Aoth3` = renter cell phone, `Aoth4` = renter email |
| `CraRate` | 1.5M | Rate assigned to the RA | `Rate1` (daily rate, body shop rentals are custom flat daily rates), `CH1` |
| `CSplit` | 461k | Direct-bill rows: which company is expected to pay | `CO` (-> `Cco.NUM`), `CLAIM`, `AMTPERDAYAUTH`, `DAYS`, `MAXPAY`, adjuster name/phone, `REPAIRLOC`, `RO_NUMBER`. `activeStatus='I'` on insurance rows |
| `Cpay` | 9.8M | Charges and payments. **No index on KNUM** -> a full scan (~1-5 min). `PAY_CHARGE`: **C** charge, **P** payment, **A** card authorisation (not money), **G** ledger mirror rows (ignore). `CO` set = billed to / paid by that company. `AT_RETURN=1` rows are posted when the car comes back. | aggregated per KNUM |
| `Cco` | 2k | Companies. `TYPE`: 0 corporate, **1 insurance**, 2 dealership, **3 body shop**, 4 travel agency, **7 repair facility** | `NUM`, `NAME`, `CONTACT`, `PHONE`, `MobilePhone`, `EMAIL_ADDRESS`, address |
| `Csource` | 74 | Source of business | 146-150 = `<LOC> B2B - BODYSHOP`; older per-shop sources (NO LIMIT ..., ACES BODYSHOP, ...) |
| `TRANSLOG` | 24.7M | Event log, indexed on `BGN01` | `BGN01='49'` "Modify Exp. Date In" = extensions, `Msg` = `From: 10/19/2026 04:39 PM To: 10/23/2026 04:39 PM`, `EMP_CODE` |
| `CNotes` | 2.6M | Counter notes | `Subject` (EXTENSION, CUSTOMER CALL, TURNDOWN, MISC NOTE), `Entry1..4`, `EnteredBy`; `SubType` P/D/O are print/damage/accounting noise |
| `Cemp01` | 471 | Employees | `EmpID` -> name |
| `Cins` | 344k | Insurance details typed on the RA (free text `Carrier`) | not used yet (CSplit is the structured source) |

TSD's own view `vw_LocationAnalysis_OverdueRentals` defines overdue exactly as we do:
`CAST(EXP_DATE AS DATE) < CAST(GETDATE() AS DATE) AND CLOSED_FLAG = 0`.

## Money

Verified on every closed body shop rental since June 2026 (`bill - paid` equals TSD's
"A/R DEBIT AT RETURN" ledger row in all cases):

```
total bill          = SUM(Cpay.AMOUNT) WHERE PAY_CHARGE='C'
company bill        = ... AND CO <> ''          (direct-billed to insurer / body shop)
renter bill         = total bill - company bill
total paid          = SUM(Cpay.AMOUNT) WHERE PAY_CHARGE='P'   (deposits, card at close, A/R payments; refunds are negative)
company paid        = ... AND CO <> ''
amount due          = total bill - total paid   (negative = credit / refund due)
```

**While a rental is out, TSD has not posted any charges** - only the customer's weekly deposits
(`CARD DEPOSIT`). The dashboard estimates the running bill as
`daily rate x elapsed rental days x (1 + tax)` and labels it "est.". Tax on NY body shop rentals is
Sales Tax 8.875% + NYRT 12% (`config/rules.ts: taxRateByLocation`). Elapsed days are counted like TSD:
whole 24h periods plus one if more than an hour over.

After-rental sub-RAs (`-D01`, `-D02`...) carry their own charges (traffic tickets, EZ-Pass, fees) and
balances; the dashboard shows them attached to the base rental.

## Payer

1. If charges were posted with a `CO`, that company was billed.
2. Else the `CSplit` row with the lowest `PrioritySort` names the expected payer.
3. `Cco.TYPE` of that company decides: 1 -> Insurance, 3/7/2 -> Body shop, other -> Other.
4. No company -> Customer (out of pocket). Both renter and company owing -> Mixed.

## Volume

Body shop sources started December 2025: 2-20 rentals a month, ~95 base rentals and ~95 sub-RAs
since then, 6 out at any time. The whole extraction takes under a minute (dominated by the Cpay scan).

## Open questions for TSD / the owner

- A **read-only SQL login** for the dashboard (the current one can write).
- Whether the Azure firewall can add Cloudflare... it cannot (no fixed IP) - the puller-server push stays.
- `CraRate.CH1` is 'H' or 'C' on body shop rentals: both bill per day in practice; meaning unconfirmed.
