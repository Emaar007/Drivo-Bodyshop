-- Drivo bodyshop rentals: READ-ONLY extraction from the TSD database (Azure SQL, database 42295).
-- Run by scripts/tsd/push_bodyshop.py. Every statement is a SELECT; nothing here writes.
--
-- Result sets, in order (the Python script names them by position):
--   1 rentals     base rental agreements (TYPE 'C') for body shop sources, plus their
--                 after-rental sub-RAs (TYPE 'D', KNUM like 'BASE-D01': tickets, tolls, damage)
--   2 splits      direct-bill rows (CSplit): who is expected to pay besides the renter
--   3 money       charges and payments per RA from Cpay (bill, paid, company share)
--   4 companies   body shops / repair facilities / dealerships / insurers with contacts (Cco)
--   5 extensions  "Modify Exp. Date In" events from TRANSLOG (BGN01 = 49)
--   6 notes       counter notes (CNotes), printing/damage/accounting entries left out
--   7 employees   EmpID -> name, to show who extended / noted
--   8 charges     charge lines grouped by type/description (tolls and tickets are excluded downstream)
--
-- Facts behind the mapping (verified 2026-10-20 against live data, see docs/tsd-schema.md):
--   * open rental      = TYPE 'C' AND DATE_IN IS NULL (CLOSED_FLAG = 0). EXP_DATE = scheduled drop-off.
--   * returned rental  = TYPE 'C' AND DATE_IN IS NOT NULL.
--   * Cpay.PAY_CHARGE: 'C' charge, 'P' payment, 'A' card authorisation (not money), 'G' ledger mirror.
--     Charges are posted at return; while a rental is open the bill is NOT in Cpay (only deposits).
--     amount due = SUM(C) - SUM(P). Charges/payments with CO set belong to the direct-bill company.
--   * Cpay has no index on KNUM: result set 3 is a full scan (minutes). Keep it to one pass.
--   * Cco.TYPE: 1 insurance, 2 dealership, 3 body shop, 7 repair facility.
--   * Body shop sources (Csource): 146-150 "<LOC> B2B - BODYSHOP"; older per-shop sources listed below.

SET NOCOUNT ON;
DECLARE @since date = '$(SINCE)';

IF OBJECT_ID('tempdb..#base') IS NOT NULL DROP TABLE #base;
SELECT r.KNUM
INTO #base
FROM Cra001 r
LEFT JOIN Cco c ON c.NUM = r.ReferralAgency
WHERE r.TYPE = 'C'
  AND r.DATE_OUT >= @since
  AND (
    r.SOURCE IN (146, 147, 148, 149, 150,            -- <LOC> B2B - BODYSHOP
                 24, 109, 110, 111, 112, 113, 115, 116, 117, 121, 141,  -- NO LIMIT shops, METRO HONDA
                 124, 126, 127, 128, 139, 140, 142, 143)                 -- other per-shop sources
    OR c.TYPE IN (3, 7)                               -- referred by a body shop / repair facility
  );

IF OBJECT_ID('tempdb..#ra') IS NOT NULL DROP TABLE #ra;
SELECT r.KNUM, CAST(NULL AS varchar(20)) AS BaseKNUM INTO #ra FROM Cra001 r WHERE r.KNUM IN (SELECT KNUM FROM #base)
UNION ALL
SELECT d.KNUM, LEFT(d.KNUM, LEN(d.KNUM) - 4)
FROM Cra001 d
WHERE d.TYPE = 'D' AND d.KNUM LIKE '%-D__'
  AND LEFT(d.KNUM, LEN(d.KNUM) - 4) IN (SELECT KNUM FROM #base);

-- 1 rentals
SELECT
  r.KNUM                                   AS raNumber,
  x.BaseKNUM                               AS baseRaNumber,
  r.TYPE                                   AS raType,
  r.LOC_OUT                                AS location,
  r.UNUM                                   AS unitNumber,
  r.CLASS                                  AS vehicleClass,
  CONVERT(varchar(19), r.DATE_OUT, 120)    AS pickupDate,
  CONVERT(varchar(19), r.EXP_DATE, 120)    AS scheduledDropOff,
  CONVERT(varchar(19), r.DATE_IN, 120)     AS actualReturn,
  r.CLOSED_FLAG                            AS closedFlag,
  r.RentalDays                             AS rentalDays,
  r.SOURCE                                 AS sourceId,
  s.Name                                   AS sourceOfBusiness,
  r.ReferralAgency                         AS referralAgencyNum,
  ref.NAME                                 AS referralAgencyName,
  ref.TYPE                                 AS referralAgencyType,
  r.FNAME                                  AS renterFirstName,
  r.LNAME                                  AS renterLastName,
  r.HPHONE                                 AS renterHomePhone,
  r.WPHONE                                 AS renterWorkPhone,
  d.Aoth3                                  AS renterCellPhone,
  d.Aoth4                                  AS renterEmail,
  rr.Rate1                                 AS dailyRate,
  rr.CH1                                   AS rateCode,
  r.CHECKED_OUT_BY                         AS checkedOutBy,
  r.CHECKED_IN_BY                          AS checkedInBy,
  r.PO                                     AS poNumber,
  r.BillFlag                               AS billFlag,
  r.PaidFlag                               AS paidFlag,
  LEFT(r.Notes, 500)                       AS raNotes
FROM #ra x
JOIN Cra001 r ON r.KNUM = x.KNUM
LEFT JOIN Csource s ON s.ID = r.SOURCE
LEFT JOIN Cco ref ON ref.NUM = r.ReferralAgency
LEFT JOIN CDetail d ON d.Knum = r.KNUM
LEFT JOIN CraRate rr ON rr.ID = r.RateID
ORDER BY r.DATE_OUT DESC;

-- 2 splits
SELECT
  sp.KNUM                                  AS raNumber,
  sp.CO                                    AS companyNum,
  c.NAME                                   AS companyName,
  c.TYPE                                   AS companyType,
  sp.TYPE                                  AS splitType,
  sp.activeStatus                          AS activeStatus,
  sp.CLAIM                                 AS claimNumber,
  sp.POLICY                                AS policyNumber,
  sp.PERCENTPAY                            AS percentPay,
  sp.AMTPERDAYAUTH                         AS amountPerDayAuthorised,
  sp.MAXPAY                                AS maxPay,
  sp.DAYS                                  AS authorisedDays,
  sp.ADJUSTER_FNAME                        AS adjusterFirstName,
  sp.ADJUSTER_LNAME                        AS adjusterLastName,
  sp.ADJUSTER_PHONE                        AS adjusterPhone,
  sp.REPAIRLOC                             AS repairLocation,
  sp.BODY_SHOP_PH                          AS repairPhone,
  sp.RO_NUMBER                             AS repairOrder,
  sp.PrioritySort                          AS prioritySort
FROM CSplit sp
LEFT JOIN Cco c ON c.NUM = sp.CO
WHERE sp.KNUM IN (SELECT KNUM FROM #ra)
ORDER BY sp.KNUM, sp.PrioritySort, sp.ID;

-- One full scan of Cpay (no index on KNUM) into a temp table; sections 3 and 8 aggregate it.
IF OBJECT_ID('tempdb..#cp') IS NOT NULL DROP TABLE #cp;
SELECT p.KNUM, p.PAY_CHARGE, p.TYPE, p.DESCRIPTION, p.AMOUNT, p.CO, p.Pay_Date
INTO #cp
FROM Cpay p
WHERE p.KNUM IN (SELECT KNUM FROM #ra) AND p.PAY_CHARGE IN ('C', 'P');

-- 3 money (totals per RA)
SELECT
  p.KNUM                                                                                   AS raNumber,
  SUM(CASE WHEN p.PAY_CHARGE = 'C' THEN p.AMOUNT ELSE 0 END)                               AS totalBill,
  SUM(CASE WHEN p.PAY_CHARGE = 'C' AND NULLIF(p.CO, '') IS NOT NULL THEN p.AMOUNT ELSE 0 END) AS companyBill,
  SUM(CASE WHEN p.PAY_CHARGE = 'C' AND p.TYPE = 'A' THEN p.AMOUNT ELSE 0 END)              AS rateCharges,
  SUM(CASE WHEN p.PAY_CHARGE = 'P' THEN p.AMOUNT ELSE 0 END)                               AS totalPaid,
  SUM(CASE WHEN p.PAY_CHARGE = 'P' AND NULLIF(p.CO, '') IS NOT NULL THEN p.AMOUNT ELSE 0 END) AS companyPaid,
  SUM(CASE WHEN p.PAY_CHARGE = 'C' THEN 1 ELSE 0 END)                                      AS chargeLines,
  MAX(CASE WHEN p.PAY_CHARGE = 'P' THEN p.Pay_Date END)                                    AS lastPaymentDate,
  MAX(CASE WHEN p.PAY_CHARGE = 'C' THEN p.Pay_Date END)                                    AS lastChargeDate,
  MAX(NULLIF(p.CO, ''))                                                                    AS billedCompanyNum
FROM #cp p
GROUP BY p.KNUM;

-- 4 companies
SELECT
  c.NUM            AS num,
  c.TYPE           AS type,
  c.NAME           AS name,
  c.CONTACT        AS contact,
  c.PHONE          AS phone,
  c.MobilePhone    AS mobilePhone,
  c.EMAIL_ADDRESS  AS email,
  c.STREET1        AS street,
  c.CITY           AS city,
  c.STATE          AS state,
  c.ZIP            AS zip,
  c.ACTIVE_FLAG    AS active,
  c.DirectBill     AS directBill,
  c.GracePeriod    AS gracePeriodDays
FROM Cco c
WHERE c.TYPE IN (1, 2, 3, 7)
ORDER BY c.TYPE, c.NAME;

-- 5 extensions
SELECT
  t.Knum                                   AS raNumber,
  CONVERT(varchar(19), t.TRANS_DATE, 120)  AS changedAt,
  t.EMP_CODE                               AS employeeId,
  LEFT(t.Msg, 200)                         AS message
FROM TRANSLOG t
WHERE t.BGN01 = '49' AND t.Knum IN (SELECT KNUM FROM #ra)
ORDER BY t.TRANS_DATE;

-- 6 notes
SELECT
  n.Knum                                   AS raNumber,
  CONVERT(varchar(19), n.CreateDate, 120)  AS createdAt,
  n.Subject                                AS subject,
  LEFT(LTRIM(RTRIM(CONCAT(n.Entry1, ' ', n.Entry2, ' ', n.Entry3, ' ', n.Entry4))), 1000) AS text,
  n.EnteredBy                              AS employeeId
FROM CNotes n
WHERE n.Knum IN (SELECT KNUM FROM #ra)
  AND ISNULL(n.SubType, '') NOT IN ('P', 'D', 'O')
ORDER BY n.CreateDate;

-- 7 employees
SELECT e.EmpID AS employeeId, e.FirstName AS firstName, e.LastName AS lastName, e.UserName AS userName, e.LocCode AS location
FROM Cemp01 e;

-- 8 charges: charge lines per RA, type and description, company vs renter (for the toll/ticket exclusion,
--   src/shared/config/charges.ts). Payments stay aggregated in section 3: TSD does not link a payment to a charge.
SELECT
  p.KNUM                                                         AS raNumber,
  LTRIM(RTRIM(ISNULL(p.TYPE, '')))                               AS chargeType,
  LTRIM(RTRIM(ISNULL(p.DESCRIPTION, '')))                        AS description,
  CASE WHEN NULLIF(p.CO, '') IS NOT NULL THEN 1 ELSE 0 END       AS toCompany,
  SUM(p.AMOUNT)                                                  AS amount,
  COUNT(*)                                                       AS lines
FROM #cp p
WHERE p.PAY_CHARGE = 'C'
GROUP BY p.KNUM, LTRIM(RTRIM(ISNULL(p.TYPE, ''))), LTRIM(RTRIM(ISNULL(p.DESCRIPTION, ''))), CASE WHEN NULLIF(p.CO, '') IS NOT NULL THEN 1 ELSE 0 END;
