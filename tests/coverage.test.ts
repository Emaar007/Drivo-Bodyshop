import { describe, expect, it } from 'vitest';
import type { Rental, RentalNote } from '../src/shared/types';
import { coverageText, deriveCoverage, parseNote } from '../src/shared/coverage';
import { taskReasons } from '../src/shared/rules';

const TODAY = '2026-10-22';
const note = (text: string, at = '2026-10-20T10:00', subject: string | null = 'INSURANCE CALL'): RentalNote => ({ at, by: 'Agent', subject, text });
const base = { kind: 'rental' as const, payerType: 'insurance' as const, isOut: true };

function rentalWith(pickup: string, notes: RentalNote[] = [], over: Partial<Rental> = {}): Rental {
  const rentalDays = Math.round((Date.parse(TODAY) - Date.parse(pickup)) / 86_400_000);
  const r = {
    raNumber: 'LGA-1', baseRaNumber: null, kind: 'rental', location: 'LGA', unitNumber: null, vehicleClass: null,
    pickupDate: `${pickup}T10:00`, scheduledDropOff: '2026-11-30T10:00', actualReturn: null, isOut: true, rentalDays,
    sourceOfBusiness: '', referralAgencyRaw: null, bodyshop: null, insurer: { name: 'GEICO' } as never, companyName: 'GEICO', payerType: 'insurance',
    renter: { name: 'A B', phone: null, email: null }, dailyRate: 30,
    money: { totalBill: 0, totalAmountDue: 0, renterBill: 0, renterAmountDue: 0, companyBill: 0, companyAmountDue: 0, totalPaid: 0, companyPaid: 0, estimated: true, lastPaymentDate: null },
    extensions: [], notes, checkedOutBy: null, dataIssues: [], subRentals: [],
    excluded: { charges: 0, paid: 0, lines: [], questionable: [], allocationUnclear: false }, nonRentalOnly: false,
    ...over,
  } as Rental;
  r.coverage = deriveCoverage(r, r.notes, null, TODAY);
  return r;
}

describe('verification task and deadline', () => {
  it('pickup day 0-3 gets a task with days left; day 4 is overdue', () => {
    for (const [pickup, left] of [['2026-10-22', 3], ['2026-10-21', 2], ['2026-10-20', 1], ['2026-10-19', 0]] as const) {
      const r = rentalWith(pickup);
      expect(taskReasons(r, TODAY)).toContain('verify_insurance');
      expect(r.coverage.daysToDeadline).toBe(left);
      expect(r.coverage.level).toBe('warn');
    }
    const late = rentalWith('2026-10-18');
    expect(taskReasons(late, TODAY)).toContain('verify_insurance');
    expect(late.coverage.daysToDeadline).toBe(-1);
    expect(late.coverage.level).toBe('danger');
    expect(coverageText(late.coverage)).toBe('Not verified, 1d past deadline');
  });
  it('out-of-pocket rentals get no verification task', () => {
    const r = rentalWith('2026-10-20', [], { payerType: 'customer' });
    expect(r.coverage.status).toBe('not_applicable');
    expect(taskReasons(r, TODAY)).not.toContain('verify_insurance');
  });
  it('rentals opened before the feature are included (old pickup, still out)', () => {
    const r = rentalWith('2026-08-01');
    expect(taskReasons(r, TODAY)).toContain('verify_insurance');
  });
  it('returned rentals get no verification task', () => {
    const r = rentalWith('2026-10-20', [], { isOut: false, actualReturn: '2026-10-21T10:00' });
    expect(taskReasons(r, TODAY)).not.toContain('verify_insurance');
  });
  it('a verified note removes the verification task', () => {
    const r = rentalWith('2026-10-15', [note('insurance verified, $30 for 30 days')]);
    expect(r.coverage.status).toBe('verified');
    expect(taskReasons(r, TODAY)).not.toContain('verify_insurance');
  });
});

describe('note parsing', () => {
  it.each([
    ['insurance verified, $30 for 30 days', 30, 30],
    ['Ins verified $35/day 21 days', 35, 21],
    ['approved 14 days @ $40', 40, 14],
    ['ADJ: Team Level PN:  DAILY RATE: $30 MAX COVERAGE: $900 APPROVED DAYS: 30', 30, 30],
    ['The adjuster approved only 23 days. I have updated the agreement', null, 23],
    ['COVERAGE VERIFIED 60$/DAY', 60, null],
    ['Insurance verified for 30 d', null, 30],
  ])('%s', (text, rate, days) => {
    const p = parseNote(text);
    expect(p.kind).toBe('verified');
    expect(p.ratePerDay).toBe(rate);
    expect(p.days).toBe(days);
  });
  it('max coverage divided by the rate gives the days when days are not stated', () => {
    expect(parseNote('coverage confirmed $50/day max coverage $1500').days).toBe(30);
  });
  it('ignores TSD template text such as credit check approvals', () => {
    expect(parseNote('GEO FENCE INFORMED THE CREDIT CHECK RETURNED "APPROVED"').kind).toBe('none');
    expect(parseNote('INFO/EMAIL VERIFIED CREDIT CHECK APPROVED').kind).toBe('none');
    expect(parseNote('waived fee APPROVED BY JAMES').kind).toBe('none');
  });
  it('reads denials', () => {
    expect(parseNote("customer doesn't have rental coverage").kind).toBe('denied');
    expect(parseNote('Insurance will not cover the rental').kind).toBe('denied');
  });
  it('verified but no days: "days unknown" with the raw note', () => {
    const r = rentalWith('2026-10-15', [note('Insurance verified, adjuster Tony')]);
    expect(r.coverage.status).toBe('verified_days_unknown');
    expect(r.coverage.note).toContain('adjuster Tony');
    expect(coverageText(r.coverage)).toBe('Verified, days unknown');
  });
  it('"until the end of the repair" is verified without a day count', () => {
    const p = parseNote('Insurance covers 30$/day, till the end of the repair');
    expect(p.kind).toBe('verified');
    expect(p.untilRepair).toBe(true);
  });
});

describe('coverage math', () => {
  it('days used, remaining and the display text', () => {
    const r = rentalWith('2026-10-01', [note('insurance verified, $30 for 30 days', '2026-10-02T10:00')]);
    expect(r.coverage.coveredDays).toBe(30);
    expect(r.coverage.daysUsed).toBe(21);
    expect(r.coverage.daysLeft).toBe(9);
    expect(r.coverage.level).toBe('ok');
    expect(coverageText(r.coverage)).toBe('21 / 30 days, 9 left, $30/day');
  });
  it('amber at 3 days or less, red and a coverage-ending task once exhausted while out', () => {
    const warn = rentalWith('2026-10-01', [note('verified $30 for 23 days')]);
    expect(warn.coverage.daysLeft).toBe(2);
    expect(warn.coverage.level).toBe('warn');
    const over = rentalWith('2026-10-01', [note('verified $30 for 14 days')]);
    expect(over.coverage.daysLeft).toBe(-7);
    expect(over.coverage.level).toBe('danger');
    expect(taskReasons(over, TODAY)).toContain('coverage_ending');
  });
  it('the most recent verification wins; later "N more days" notes add days', () => {
    const r = rentalWith('2026-09-20', [
      note('verified $30 for 14 days', '2026-09-21T10:00'),
      note('insurance approved 30 days $35/day', '2026-09-25T10:00'),
      note('adjuster extended 10 more days', '2026-10-15T10:00', 'ADJUSTER CALL'),
      note('customer wanted to extend 4 more days gave same rate', '2026-10-16T10:00', 'CUSTOMER CALL'),
    ]);
    expect(r.coverage.ratePerDay).toBe(35);
    expect(r.coverage.coveredDays).toBe(40);
    expect(r.coverage.extensionDays).toBe(10);
  });
  void base;
});

describe('real TSD phrasings (Oct 2026 extract)', () => {
  it('reads "$50 PER DAY $1500 MAX" as 30 days', () => {
    const p = parseNote('-BRANDON APPROVED ONLY DEP\n$50 PER DAY $1500 MAX');
    expect(p.kind).toBe('verified');
    expect(p.ratePerDay).toBe(50);
    expect(p.days).toBe(30);
  });
  it('the customer\'s word and "approved for fuel" are not verifications', () => {
    expect(parseNote('Statefarm refused to disclose the information. According to customer, statefarm covers up to $1000.').kind).toBe('none');
    expect(parseNote('EUGENE APPROVED FOR FUEL').kind).toBe('none');
    expect(parseNote('GEO FENCE INFORMED\nCREDIT APPROVED').kind).toBe('none');
  });
  it('"5 DAYS APPROVED / ICAR AND NO DAILY RATE" gives 5 days', () => {
    const p = parseNote('5 DAYS APPROVED / ICAR AND NO DAILY RATE');
    expect(p.kind).toBe('verified');
    expect(p.days).toBe(5);
  });
});
