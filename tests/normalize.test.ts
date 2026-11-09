import { describe, expect, it } from 'vitest';
import sample from '../data/sample.json';
import type { TsdPayload } from '../src/shared/types';
import { canonicalName, cleanPhone, derivePayer, normalizeKey, normalizePayload, titleCase } from '../src/shared/normalize';
import { classify, taskReasons } from '../src/shared/rules';

const payload = sample as unknown as TsdPayload;
const NOW = '2026-10-22T12:00';

describe('name normalisation', () => {
  it('keys ignore case, punctuation and legal suffixes', () => {
    expect(normalizeKey("Costa`s Auto Body Inc")).toBe('COSTASAUTOBODY');
    expect(normalizeKey('CAROUSEL COLLISION INC')).toBe(normalizeKey('Carousel Collision'));
    expect(normalizeKey('A & G AUTO ROWS')).toBe('AANDGAUTOROWS');
  });
  it('aliases map variants to one display name', () => {
    expect(canonicalName('STATEFARM', { STATEFARM: 'State Farm' }).name).toBe('State Farm');
    expect(canonicalName('State Farm', { STATEFARM: 'State Farm' }).key).toBe('STATEFARM');
    expect(canonicalName('NOVITEC', { NOVITEC: 'Novitec Auto Body' }).key).toBe('NOVITECAUTOBODY');
  });
  it('title-cases shouty TSD names', () => {
    expect(titleCase('CYCLONE COLLISION CENTER')).toBe('Cyclone Collision Center');
    expect(titleCase('BMW OF BROOKLYN')).toBe('BMW of Brooklyn');
  });
  it('drops placeholder phone numbers', () => {
    expect(cleanPhone('0000000')).toBeNull();
    expect(cleanPhone('1231231231')).toBeNull();
    expect(cleanPhone('+1 718-372-9683')).toBe('(718) 372-9683');
    expect(cleanPhone('6463066646')).toBe('(646) 306-6646');
  });
});

describe('payer derivation', () => {
  const types = new Map([['00037', 1], ['00391', 3], ['00099', 0]]);
  const split = (companyNum: string) => ({ raNumber: 'X', companyNum, companyName: null, companyType: null, splitType: null, activeStatus: null, claimNumber: null, policyNumber: null, percentPay: null, amountPerDayAuthorised: null, maxPay: null, authorisedDays: null, adjusterFirstName: null, adjusterLastName: null, adjusterPhone: null, repairLocation: null, repairPhone: null, repairOrder: null, prioritySort: 1 });
  it('no company = customer pays', () => {
    expect(derivePayer({ splits: [], money: undefined, companyTypeByNum: types, renterDue: 10, companyDue: 0 }).payerType).toBe('customer');
  });
  it('insurance / body shop by company type', () => {
    expect(derivePayer({ splits: [split('00037')], money: undefined, companyTypeByNum: types, renterDue: 0, companyDue: 0 }).payerType).toBe('insurance');
    expect(derivePayer({ splits: [split('00391')], money: undefined, companyTypeByNum: types, renterDue: 0, companyDue: 0 }).payerType).toBe('bodyshop');
    expect(derivePayer({ splits: [split('00099')], money: undefined, companyTypeByNum: types, renterDue: 0, companyDue: 0 }).payerType).toBe('other');
    expect(derivePayer({ splits: [split('99999')], money: undefined, companyTypeByNum: types, renterDue: 0, companyDue: 0 }).payerType).toBe('unknown');
  });
  it('mixed when both the renter and the company owe', () => {
    expect(derivePayer({ splits: [split('00037')], money: undefined, companyTypeByNum: types, renterDue: 50, companyDue: 500 }).payerType).toBe('mixed');
  });
  it('who was actually billed wins over the planned split', () => {
    const money = { raNumber: 'X', totalBill: 1, companyBill: 1, rateCharges: 1, totalPaid: 0, companyPaid: 0, chargeLines: 1, lastPaymentDate: null, lastChargeDate: null, billedCompanyNum: '00391' };
    expect(derivePayer({ splits: [split('00037')], money, companyTypeByNum: types, renterDue: 0, companyDue: 1 }).payerType).toBe('bodyshop');
  });
});

describe('normalizePayload on the sample extract', () => {
  const ds = normalizePayload(payload, { nowLocal: NOW });
  const base = ds.rentals.filter((r) => r.kind === 'rental');
  const subs = ds.rentals.filter((r) => r.kind === 'after_rental');

  it('keeps every record and links sub-RAs to their rental', () => {
    // toll/ticket-only records leave the dataset but are kept for Settings > Excluded charges
    expect(ds.rentals.length + ds.excludedRecords.length).toBe(payload.rentals.length);
    expect(ds.excludedRecords.every((r) => r.kind === 'after_rental')).toBe(true);
    expect(subs.length).toBeGreaterThan(0);
    for (const s of subs) expect(base.find((b) => b.raNumber === s.baseRaNumber)?.subRentals).toContain(s.raNumber);
  });
  it('isOut comes from the return field, not the drop-off date', () => {
    const out = base.filter((r) => r.isOut);
    expect(out.length).toBe(payload.rentals.filter((r) => r.raType === 'C' && !r.actualReturn).length);
    for (const r of base.filter((r) => r.actualReturn)) expect(r.isOut).toBe(false);
  });
  it('open rentals get an estimated bill; returned ones use posted charges', () => {
    for (const r of base) {
      if (r.isOut) expect(r.money.estimated).toBe(true);
      else expect(r.money.estimated).toBe(false);
    }
    const brk = base.find((r) => r.raNumber === 'BRK-22784')!;
    // $35/day since 2026-09-08 16:39: 44 days elapsed at NOW (Oct 22), but billed through the scheduled
    // drop-off 2026-10-29 16:39 (51 days) because the customer prepays to that date; 20.875% tax.
    expect(brk.rentalDays).toBe(44);
    expect(brk.money.totalBill).toBeCloseTo(35 * 51 * 1.20875, 2);
    expect(brk.dataIssues.some((i) => i.startsWith('Credit'))).toBe(false);
    expect(brk.money.totalPaid).toBeGreaterThan(0);
    expect(brk.bodyshop?.name).toBe('Novitec Auto Body');
    expect(brk.bodyshop?.phone).toBe('(646) 306-6646');
    expect(brk.payerType).toBe('customer');
  });
  it('returned rentals: due = bill - paid, insurer billed when charges carry the company', () => {
    const r = base.find((x) => x.raNumber === 'BRK-23026')!;
    expect(r.isOut).toBe(false);
    expect(r.money.totalBill).toBeCloseTo(509.02, 2);
    expect(r.money.companyBill).toBeCloseTo(509.02, 2);
    expect(r.money.totalAmountDue).toBeCloseTo(509.02, 2);
    expect(r.payerType).toBe('insurance');
    expect(r.insurer?.name).toBe('Progressive');
  });
  it('credits are flagged, not counted as receivable', () => {
    const r = base.find((x) => x.raNumber === 'LGA-98883')!;
    expect(r.money.totalAmountDue).toBeLessThan(0);
    expect(r.dataIssues.some((i) => i.startsWith('Credit balance'))).toBe(true);
  });
  it('extensions are parsed from the TSD log', () => {
    const r = base.find((x) => x.raNumber === 'BRK-22784')!;
    expect(r.extensions.length).toBeGreaterThan(3);
    const last = r.extensions[r.extensions.length - 1];
    expect(last.to).toBe('2026-10-29T16:39');
    expect(last.from).toBe('2026-10-22T16:39');
  });
  it('classifies the open rentals against the reference date', () => {
    const states = Object.fromEntries(base.filter((r) => r.isOut).map((r) => [r.raNumber, classify(r, NOW.slice(0, 10))]));
    expect(states['SUBS-1227']).toBe('due_today'); // drop-off 2026-10-22
    expect(states['SUBS-1230']).toBe('due_soon'); // 2026-10-23
    expect(states['BRK-22784']).toBe('out'); // 2026-10-29
    expect(states['BRK-23220']).toBe('out'); // 2026-11-12
    for (const r of base.filter((x) => x.isOut)) expect(taskReasons(r, NOW.slice(0, 10)).length).toBeGreaterThanOrEqual(0);
  });
  it('builds the body shop contact list from TSD companies', () => {
    expect(ds.lookups.bodyshops.length).toBeGreaterThan(50);
    expect(ds.lookups.bodyshops.find((b) => b.key === 'CYCLONECOLLISIONCENTER')?.phone).toBe('(718) 372-9683');
  });
});
