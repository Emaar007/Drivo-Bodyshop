import { describe, expect, it } from 'vitest';
import type { Rental } from '../src/shared/types';
import { agingBucket, classify, daysOutstanding, daysOverdue, taskReasons, collectionTotals, amountAtRisk } from '../src/shared/rules';
import { DEFAULT_RULES } from '../src/shared/config/rules';
import { rentalDaysBetween, daysBetween, parseUsDateTime, todayIn } from '../src/shared/dates';

const TODAY = '2026-10-20';

function rental(over: Partial<Rental> = {}): Rental {
  return {
    raNumber: 'BRK-1',
    baseRaNumber: null,
    kind: 'rental',
    location: 'BRK',
    unitNumber: null,
    vehicleClass: null,
    pickupDate: '2026-10-01T10:00',
    scheduledDropOff: '2026-10-19T10:00',
    actualReturn: null,
    isOut: true,
    rentalDays: 19,
    sourceOfBusiness: 'BRK B2B - BODYSHOP',
    referralAgencyRaw: 'NOVITEC AUTO BODY',
    bodyshop: { key: 'NOVITECAUTOBODY', name: 'Novitec Auto Body', phone: '(646) 306-6646', email: null, contact: null, address: null, matched: true },
    insurer: null,
    companyName: null,
    payerType: 'customer',
    renter: { name: 'Alex Rivera', phone: '(555) 000-0000', email: null },
    dailyRate: 35,
    money: { totalBill: 800, totalAmountDue: 300, renterBill: 800, renterAmountDue: 300, companyBill: 0, companyAmountDue: 0, totalPaid: 500, companyPaid: 0, estimated: true, lastPaymentDate: null },
    extensions: [],
    notes: [],
    checkedOutBy: null,
    dataIssues: [],
    subRentals: [],
    ...over,
  };
}

describe('overdue / due soon boundaries', () => {
  it('drop-off yesterday, not returned = overdue by 1 day', () => {
    const r = rental({ scheduledDropOff: '2026-10-19T16:39' });
    expect(classify(r, TODAY)).toBe('overdue');
    expect(daysOverdue(r, TODAY)).toBe(1);
  });
  it('drop-off today is not overdue (due today)', () => {
    const r = rental({ scheduledDropOff: '2026-10-20T09:00' });
    expect(classify(r, TODAY)).toBe('due_today');
    expect(daysOverdue(r, TODAY)).toBe(0);
    expect(taskReasons(r, TODAY)).toEqual(['due_soon']);
  });
  it('drop-off within DUE_SOON_DAYS is due soon; one day past the window is just out', () => {
    expect(classify(rental({ scheduledDropOff: '2026-10-23T09:00' }), TODAY)).toBe('due_soon');
    expect(classify(rental({ scheduledDropOff: '2026-10-24T09:00' }), TODAY)).toBe('out');
  });
  it('returned rentals are never overdue, whatever the drop-off date', () => {
    const r = rental({ scheduledDropOff: '2026-09-01T09:00', actualReturn: '2026-09-05T09:00', isOut: false });
    expect(classify(r, TODAY)).toBe('returned');
    expect(daysOverdue(r, TODAY)).toBeNull();
  });
  it('no drop-off date = open-ended', () => {
    expect(classify(rental({ scheduledDropOff: null }), TODAY)).toBe('open_ended');
    expect(taskReasons(rental({ scheduledDropOff: null }), TODAY)).toEqual(['open_ended']);
  });
  it('per-payer due-soon override applies', () => {
    const rules = { ...DEFAULT_RULES, dueSoonDaysByPayer: { insurance: 7 } };
    const r = rental({ scheduledDropOff: '2026-10-26T09:00', payerType: 'insurance' });
    expect(classify(r, TODAY, rules)).toBe('due_soon');
    expect(classify(r, TODAY)).toBe('out');
  });
});

describe('task priorities', () => {
  it('customer-paid overdue comes first, company-paid second', () => {
    expect(taskReasons(rental(), TODAY)).toEqual(['overdue_customer']);
    expect(taskReasons(rental({ payerType: 'insurance' }), TODAY)).toEqual(['overdue_company']);
    expect(taskReasons(rental({ payerType: 'bodyshop' }), TODAY)).toEqual(['overdue_company']);
    expect(taskReasons(rental({ payerType: 'mixed' }), TODAY)).toEqual(['overdue_customer']);
  });
  it('data issues on an open rental add a data_fix task', () => {
    const r = rental({ scheduledDropOff: '2026-11-01T09:00', dataIssues: ['Body shop "X" not in the contact list'] });
    expect(taskReasons(r, TODAY)).toEqual(['data_fix']);
  });
  it('a returned rental with a credit balance is a data_fix task', () => {
    const r = rental({ isOut: false, actualReturn: '2026-10-10T09:00', money: { ...rental().money, totalAmountDue: -50 } });
    expect(taskReasons(r, TODAY)).toEqual(['data_fix']);
  });
  it('after-rental sub-RAs never become tasks', () => {
    expect(taskReasons(rental({ kind: 'after_rental', baseRaNumber: 'BRK-1' }), TODAY)).toEqual([]);
  });
});

describe('balances', () => {
  it('days outstanding: since return when returned, since pickup when out', () => {
    expect(daysOutstanding(rental(), TODAY)).toEqual({ days: 19, basis: 'since pickup' });
    expect(daysOutstanding(rental({ isOut: false, actualReturn: '2026-10-05T12:00' }), TODAY)).toEqual({ days: 15, basis: 'since return' });
  });
  it('aging buckets', () => {
    expect(agingBucket(0)).toBe('0-15 days');
    expect(agingBucket(15)).toBe('0-15 days');
    expect(agingBucket(16)).toBe('16-30 days');
    expect(agingBucket(60)).toBe('31-60 days');
    expect(agingBucket(61)).toBe('60+ days');
  });
  it('negative balances are credits, never receivables', () => {
    const paid = rental({ money: { ...rental().money, totalBill: 100, totalAmountDue: -25, totalPaid: 125 } });
    const owing = rental({ money: { ...rental().money, totalBill: 200, totalAmountDue: 50, totalPaid: 150 } });
    const t = collectionTotals([paid, owing]);
    expect(t.billed).toBe(300);
    expect(t.outstanding).toBe(50);
    expect(t.credits).toBe(25);
    expect(t.collected).toBe(250);
    expect(t.withBalance).toBe(1);
    expect(t.rate).toBeCloseTo(250 / 300);
  });
  it('amount at risk = amount due on overdue rentals only', () => {
    const overdue = rental();
    const fine = rental({ raNumber: 'BRK-2', scheduledDropOff: '2026-11-01T09:00' });
    expect(amountAtRisk([overdue, fine], TODAY)).toBe(300);
  });
});

describe('dates', () => {
  it('rental days count like TSD (whole 24h periods, 1h grace)', () => {
    expect(rentalDaysBetween('2026-09-16T11:58', '2026-09-28T12:19')).toBe(12); // LGA-99229
    expect(rentalDaysBetween('2026-09-28T14:56', '2026-10-08T13:58')).toBe(10); // BRK-23026
    expect(rentalDaysBetween('2026-09-16T10:21', '2026-10-14T15:47')).toBe(29); // SUBS-1214
    expect(rentalDaysBetween('2026-10-01T10:00', '2026-10-01T12:00')).toBe(1);
  });
  it('calendar day arithmetic', () => {
    expect(daysBetween('2026-10-19', '2026-10-20')).toBe(1);
    expect(daysBetween('2026-10-20', '2026-10-19')).toBe(-1);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });
  it('parses TSD log timestamps', () => {
    expect(parseUsDateTime('10/19/2026 04:39 PM')).toBe('2026-10-19T16:39');
    expect(parseUsDateTime('10/07/2026 12:08 AM')).toBe('2026-10-07T00:08');
  });
  it('today in New York is a YYYY-MM-DD', () => {
    expect(todayIn('America/New_York', new Date('2026-10-20T03:30:00Z'))).toBe('2026-10-19'); // 23:30 the day before in NY
    expect(todayIn('America/New_York', new Date('2026-10-20T12:00:00Z'))).toBe('2026-10-20');
  });
});
