// Which TSD charge lines count as the rental (and therefore toward balances, collections, overdue amounts,
// reports and exports). Tolls, tickets and similar pass-through charges are excluded: Drivo is only responsible
// for the rental itself. ONE place to change this list.
//
// Matching is on the charge line's TSD type code (Cpay.TYPE) first, then case-insensitive keyword patterns on the
// description. Codes seen on body shop rentals (Dec 2025 - Oct 2026) are listed explicitly below; a code that is in
// none of the lists is "unclassified": it is still counted (never silently dropped) and flagged under Data to fix.

/** Excluded: tolls, tickets, violations, congestion zone and their admin fees. */
export const EXCLUDED_CODES: string[] = [
  'TRANS', // EZ PASS TRANSPONDER (tolls)
  'TRANS FEE', // EZPASS TRANSPONDER FEE
  'TICKET', // TRAFFIC VIOLATION TICKET
  'CRZ', // CONGESTION RELIEF ZONE (NYC toll)
  'CRZ FEE', // CONGESTION RELIEF ZONE ADMIN FEE
];

/** Case-insensitive patterns on the description for codes not listed anywhere (new TSD codes). */
export const EXCLUDED_PATTERNS: RegExp[] = [
  /\btolls?\b/i,
  /\btickets?\b/i,
  /\bcitations?\b/i,
  /\btraffic violation/i,
  /\bparking\b/i,
  /\bfines?\b/i,
  /\be-?z\s?-?pass\b/i,
  /\btransponder/i,
  /\bcongestion\b/i,
  /\bpass[- ]through\b/i,
  /\bred light\b/i,
  /\bspeed camera\b/i,
];

/**
 * Transfers: a deposit moved from the rental to the toll account ("DEPOSIT APPLIED TO TOLLS" on the rental,
 * the same amount negative on the toll sub-RA). The line is excluded AND the same amount is taken off the
 * rental's payments, because that money went to the tolls, not to the rental.
 */
export const TRANSFER_TO_EXCLUDED_CODES: string[] = ['DEPTOLL'];

/** Rental charges: always counted. */
export const RENTAL_CODES: string[] = [
  'A', // RATE CHARGE
  'J', // SALES TAX
  'K', // NYRT
  'L', // FACILITY CHARGE
  'F', // FUEL CHARGE
  'C', // LATE CHARGE
  'G', // SURCHARGE
  'H', // INTEREST
  'T06', 'T07', 'T09', 'T10', 'T11', // VLF, MVR tax, DSF, recovery fees
  'UPGRADE', 'ADD', 'BASIC', 'COMP', 'ROAD', 'LIP', 'PAI/PEC',
  'CDW W/$0DED', 'CDW W/$1500DED', 'CDW W/$1000DED', 'CDW W/$200DED', 'CDWLT W/$0DED', 'CDWLT W/$1500D',
  'CREDIT-CS', // REFUND FOR CUSTOMER SERVICE
];

/**
 * Counted for now but NEEDS YOUR CONFIRMATION (listed in Settings > Excluded charges as "to confirm").
 * Move a code to EXCLUDED_CODES or RENTAL_CODES once decided.
 */
export const TO_CONFIRM_CODES: Record<string, string> = {
  DAMAGE: 'Damage charge (after-rental record)',
  'CDW-DAM': 'CDW damage',
  'A-DAM': 'Allowance on damage',
  DEP: 'Deposit applied to a damage claim',
  CLAIMPF: 'Claim processing fee',
  KEYS: 'Lost / missing keys',
  'GEO FENCE': 'Geo-fence violation fee (contract fee, not a traffic violation)',
  GEO: 'Geo-fence fee',
  DISPUTE: 'Disputed charge',
};

/** Overrides by exact description (upper case), applied before everything else. */
export const DESCRIPTION_OVERRIDES: Record<string, 'rental' | 'excluded'> = {};

export type ChargeClass = 'rental' | 'excluded' | 'transfer' | 'to_confirm' | 'unclassified';

export function classifyCharge(code: string, description: string): ChargeClass {
  const c = (code ?? '').trim().toUpperCase();
  const d = (description ?? '').trim();
  const override = DESCRIPTION_OVERRIDES[d.toUpperCase()];
  if (override) return override;
  if (TRANSFER_TO_EXCLUDED_CODES.includes(c)) return 'transfer';
  if (EXCLUDED_CODES.includes(c)) return 'excluded';
  if (RENTAL_CODES.includes(c)) return 'rental';
  if (c in TO_CONFIRM_CODES) return 'to_confirm';
  if (EXCLUDED_PATTERNS.some((p) => p.test(d) || p.test(c))) return 'excluded';
  return 'unclassified';
}

/** Counted toward the rental balance? */
export function isCounted(cls: ChargeClass): boolean {
  return cls === 'rental' || cls === 'to_confirm' || cls === 'unclassified';
}
