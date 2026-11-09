import { describe, expect, it } from 'vitest';
import type { RawCharge, RawMoney, RawRental, TsdPayload } from '../src/shared/types';
import { classifyCharge } from '../src/shared/config/charges';
import { deriveMoney, normalizePayload } from '../src/shared/normalize';
import { collectionTotals } from '../src/shared/rules';
import { DEFAULT_RULES } from '../src/shared/config/rules';

const raw = (over: Partial<RawRental> = {}): RawRental => ({
  raNumber: 'BRK-1', baseRaNumber: null, raType: 'C', location: 'BRK', unitNumber: null, vehicleClass: null,
  pickupDate: '2026-09-01 10:00:00', scheduledDropOff: '2026-09-10 10:00:00', actualReturn: '2026-09-10 10:00:00', closedFlag: 1,
  rentalDays: 9, sourceId: 146, sourceOfBusiness: 'BRK B2B - BODYSHOP', referralAgencyNum: null, referralAgencyName: null, referralAgencyType: null,
  renterFirstName: 'A', renterLastName: 'B', renterHomePhone: null, renterWorkPhone: null, renterCellPhone: null, renterEmail: null,
  dailyRate: 30, rateCode: 'C', checkedOutBy: null, checkedInBy: null, poNumber: null, billFlag: 0, paidFlag: 0, raNotes: null, ...over,
});
const money = (ra: string, paid: number, companyPaid = 0): RawMoney => ({
  raNumber: ra, totalBill: 0, companyBill: 0, rateCharges: 0, totalPaid: paid, companyPaid, chargeLines: 1, lastPaymentDate: null, lastChargeDate: null, billedCompanyNum: null,
});
const ch = (ra: string, chargeType: string, description: string, amount: number, toCompany = 0): RawCharge => ({ raNumber: ra, chargeType, description, amount, toCompany, lines: 1 });
const args = { isOut: false, billableDays: 9, rules: DEFAULT_RULES, companyPaysAll: false, hasChargeDetail: true };

describe('charge classification', () => {
  it('excludes tolls, tickets and congestion fees; keeps rental lines', () => {
    expect(classifyCharge('TRANS', 'EZ PASS TRANSPONDER')).toBe('excluded');
    expect(classifyCharge('TICKET', 'TRAFFIC VIOLATION TICKET')).toBe('excluded');
    expect(classifyCharge('CRZ FEE', 'CONGESTION RELIEF ZONE ADMIN FEE')).toBe('excluded');
    expect(classifyCharge('A', 'RATE CHARGE')).toBe('rental');
    expect(classifyCharge('J', 'SALES TAX')).toBe('rental');
    expect(classifyCharge('DEPTOLL', 'DEPOSIT APPLIED TO TOLLS')).toBe('transfer');
  });
  it('keyword matching is case-insensitive for new codes', () => {
    expect(classifyCharge('NEWCODE', 'Parking Citation')).toBe('excluded');
    expect(classifyCharge('X1', 'e-zpass toll')).toBe('excluded');
    expect(classifyCharge('X2', 'RED LIGHT camera')).toBe('excluded');
  });
  it('ambiguous codes are counted but marked to confirm; unknown codes are flagged, not dropped', () => {
    expect(classifyCharge('DAMAGE', 'DAMAGE')).toBe('to_confirm');
    expect(classifyCharge('GEO FENCE', 'GEO FENCE VIOLATION FEE')).toBe('to_confirm');
    expect(classifyCharge('ZZZ', 'Something new')).toBe('unclassified');
  });
});

describe('rental money excludes tolls and tickets', () => {
  it('rental + toll + ticket: only the rental amount is due', () => {
    const charges = [ch('BRK-1', 'A', 'RATE CHARGE', 300), ch('BRK-1', 'J', 'SALES TAX', 26.63), ch('BRK-1', 'TRANS', 'EZ PASS TRANSPONDER', 40), ch('BRK-1', 'TICKET', 'TRAFFIC VIOLATION TICKET', 50)];
    const r = deriveMoney({ ...args, raw: raw(), money: money('BRK-1', 200), charges });
    expect(r.money.totalBill).toBeCloseTo(326.63, 2);
    expect(r.money.totalAmountDue).toBeCloseTo(126.63, 2);
    expect(r.excluded.charges).toBeCloseTo(90, 2);
    expect(r.nonRentalOnly).toBe(false);
  });
  it('a payment surplus pays the excluded charges, never makes the rental look overpaid by toll money', () => {
    const charges = [ch('BRK-1', 'A', 'RATE CHARGE', 300), ch('BRK-1', 'TRANS', 'EZ PASS TRANSPONDER', 40)];
    const r = deriveMoney({ ...args, raw: raw(), money: money('BRK-1', 340), charges });
    expect(r.money.totalAmountDue).toBeCloseTo(0, 2);
    expect(r.excluded.paid).toBeCloseTo(40, 2);
    expect(r.excluded.allocationUnclear).toBe(true);
  });
  it('deposit moved to tolls is taken off the rental payments', () => {
    const charges = [ch('BRK-1', 'A', 'RATE CHARGE', 300), ch('BRK-1', 'DEPTOLL', 'DEPOSIT APPLIED TO TOLLS', 50)];
    const r = deriveMoney({ ...args, raw: raw(), money: money('BRK-1', 350), charges });
    expect(r.money.totalBill).toBe(300);
    expect(r.money.totalPaid).toBe(300);
    expect(r.money.totalAmountDue).toBe(0);
  });
  it('a toll-only record (rental paid, toll still owed) is excluded from every view', () => {
    const rentals = [raw(), raw({ raNumber: 'BRK-1-D01', baseRaNumber: 'BRK-1', raType: 'D' })];
    const payload = {
      source: 'tsd', since: '2025-12-01', fetchedAt: '2026-10-22T12:00:00Z', rentals, splits: [], companies: [], extensions: [], notes: [], employees: [],
      money: [money('BRK-1', 300), money('BRK-1-D01', 0)],
      charges: [ch('BRK-1', 'A', 'RATE CHARGE', 300), ch('BRK-1-D01', 'TRANS', 'EZ PASS TRANSPONDER', 60.15), ch('BRK-1-D01', 'TRANS FEE', 'EZPASS TRANSPONDER FEE', 49.75)],
    } as unknown as TsdPayload;
    const ds = normalizePayload(payload, { nowLocal: '2026-10-22T12:00' });
    expect(ds.rentals.map((r) => r.raNumber)).toEqual(['BRK-1']);
    expect(ds.excludedRecords.map((r) => r.raNumber)).toEqual(['BRK-1-D01']);
    expect(ds.excludedRecords[0].excluded.charges).toBeCloseTo(109.9, 2);
    expect(ds.rentals[0].money.totalAmountDue).toBe(0);
    expect(collectionTotals(ds.rentals).outstanding).toBe(0);
  });
  it('collection rate uses rental charges only', () => {
    const charges = [ch('BRK-1', 'A', 'RATE CHARGE', 400), ch('BRK-1', 'TICKET', 'TRAFFIC VIOLATION TICKET', 100)];
    const r = deriveMoney({ ...args, raw: raw(), money: money('BRK-1', 300), charges });
    const t = collectionTotals([{ money: r.money } as never]);
    expect(t.billed).toBe(400);
    expect(t.rate).toBeCloseTo(300 / 400);
  });
  it('unknown charge types are flagged under data to fix and still counted', () => {
    const payload = {
      source: 'tsd', since: '2025-12-01', fetchedAt: '2026-10-22T12:00:00Z', rentals: [raw()], splits: [], companies: [], extensions: [], notes: [], employees: [],
      money: [money('BRK-1', 0)], charges: [ch('BRK-1', 'A', 'RATE CHARGE', 100), ch('BRK-1', 'ZZZ', 'MYSTERY FEE', 25)],
    } as unknown as TsdPayload;
    const r = normalizePayload(payload, { nowLocal: '2026-10-22T12:00' }).rentals[0];
    expect(r.money.totalBill).toBe(125);
    expect(r.dataIssues.some((i) => i.startsWith('Unclassified charge ZZZ'))).toBe(true);
  });
  it('older pushes without charge lines keep working (totals only)', () => {
    const r = deriveMoney({ ...args, hasChargeDetail: false, raw: raw(), money: { ...money('BRK-1', 100), totalBill: 250 } });
    expect(r.money.totalAmountDue).toBe(150);
  });
});
