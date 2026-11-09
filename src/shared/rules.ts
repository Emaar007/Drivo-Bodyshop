// Pure rules engine: classification, task generation, aging, collections. No I/O.
import type { Rental, TaskReason, PayerType } from './types';
import { DEFAULT_RULES, type RulesConfig } from './config/rules';
import { daysBetween, dateOf, formatDate, monthOf } from './dates';

export type RentalState = 'overdue' | 'due_today' | 'due_soon' | 'open_ended' | 'out' | 'returned' | 'after_rental';

/** Days the scheduled drop-off is in the past (positive = overdue). Null when no date or not out. */
export function daysOverdue(r: Rental, today: string): number | null {
  if (!r.isOut) return null;
  const drop = dateOf(r.scheduledDropOff);
  if (!drop) return null;
  const d = daysBetween(drop, today);
  return d > 0 ? d : 0;
}

/** Days until the scheduled drop-off (0 = today, negative = past). */
export function daysUntilDropOff(r: Rental, today: string): number | null {
  const drop = dateOf(r.scheduledDropOff);
  if (!drop) return null;
  return daysBetween(today, drop);
}

export function dueSoonDaysFor(payer: PayerType, rules: RulesConfig): number {
  return rules.dueSoonDaysByPayer[payer] ?? rules.dueSoonDays;
}

export function classify(r: Rental, today: string, rules: RulesConfig = DEFAULT_RULES): RentalState {
  if (r.kind === 'after_rental') return 'after_rental';
  if (!r.isOut) return 'returned';
  const drop = dateOf(r.scheduledDropOff);
  if (!drop) return 'open_ended';
  const until = daysBetween(today, drop);
  if (until < 0) return 'overdue';
  if (until === 0) return 'due_today';
  if (until <= dueSoonDaysFor(r.payerType, rules)) return 'due_soon';
  return 'out';
}

export function isCompanyPayer(p: PayerType): boolean {
  return p === 'insurance' || p === 'bodyshop' || p === 'other';
}

/** Which Today-page groups a rental belongs to right now. */
export function taskReasons(r: Rental, today: string, rules: RulesConfig = DEFAULT_RULES): TaskReason[] {
  const out: TaskReason[] = [];
  const state = classify(r, today, rules);
  if (state === 'overdue') out.push(isCompanyPayer(r.payerType) ? 'overdue_company' : 'overdue_customer');
  else if (state === 'due_soon' || state === 'due_today') out.push('due_soon');
  else if (state === 'open_ended') out.push('open_ended');
  if (r.kind === 'rental' && r.isOut && r.dataIssues.some((i) => !i.startsWith('No scheduled drop-off'))) out.push('data_fix');
  if (r.kind === 'rental' && !r.isOut && r.money.totalAmountDue < -0.005) out.push('data_fix');
  // Insurance verification: every open rental paid by an insurer / body shop, until a TSD note verifies it.
  if (r.kind === 'rental' && r.isOut && r.coverage?.applies) {
    if (r.coverage.status === 'not_verified') out.push('verify_insurance');
    else if (r.coverage.status === 'verified' && r.coverage.daysLeft !== null && r.coverage.daysLeft < 0) out.push('coverage_ending');
  }
  return out;
}

export function priorityOf(reason: TaskReason, rules: RulesConfig = DEFAULT_RULES): number {
  const i = rules.priorityOrder.indexOf(reason);
  return i < 0 ? rules.priorityOrder.length + 1 : i + 1;
}

/** Suggested action text for a task card. */
export function suggestedAction(r: Rental, reason: TaskReason, today: string): string {
  const shop = r.bodyshop?.name ?? 'the body shop';
  const drop = formatDate(r.scheduledDropOff);
  const over = daysOverdue(r, today) ?? 0;
  switch (reason) {
    case 'overdue_customer':
      return `Call ${shop} and the customer: customer is out of pocket, overdue ${over} day${over === 1 ? '' : 's'}. Extend the rental and collect payment.`;
    case 'overdue_company':
      return `Call ${r.companyName ?? shop}: overdue ${over} day${over === 1 ? '' : 's'}. Get the extension approved${r.insurer?.adjusterName ? ` (adjuster ${r.insurer.adjusterName})` : ''}.`;
    case 'due_soon': {
      const until = daysUntilDropOff(r, today) ?? 0;
      return until === 0
        ? `Due back today (${drop}). Confirm the return with ${shop} or extend now.`
        : `Due in ${until} day${until === 1 ? '' : 's'} (${drop}). Confirm with ${shop} whether the repair is done; extend if not.`;
    }
    case 'open_ended':
      return `No return date on the rental. Agree a drop-off date with ${shop} and set it in TSD.`;
    case 'data_fix':
      return r.dataIssues[0] ?? 'Check the rental data in TSD.';
    case 'verify_insurance': {
      const who = r.insurer?.name ?? r.companyName ?? 'the insurer';
      const d = r.coverage.daysToDeadline ?? 0;
      return `Call ${who}${r.insurer?.adjusterName ? ` (adjuster ${r.insurer.adjusterName})` : ''} and verify rental coverage ${d < 0 ? `(deadline passed ${-d} day${d === -1 ? '' : 's'} ago)` : `by ${formatDate(r.coverage.deadline)}`}. Then note it in TSD, e.g. "Insurance verified, $30 for 30 days".`;
    }
    case 'coverage_ending':
      return `Coverage approved for ${r.coverage.coveredDays} days, the car is out ${r.rentalDays}. Ask ${r.insurer?.name ?? 'the insurer'} for more days or extend with the customer, then note it in TSD.`;
    case 'manual':
      return r.money.totalAmountDue > 0 ? `Follow up on the $${fmt(r.money.totalAmountDue)} balance.` : 'Follow up as noted.';
  }
}

/** Why this is a task, in one short line. */
export function taskWhy(r: Rental, reason: TaskReason, today: string): string {
  const over = daysOverdue(r, today) ?? 0;
  const due = r.money.totalAmountDue;
  const dueTxt = due > 0.005
    ? `$${fmt(due)} due${r.money.estimated ? ' (est.)' : ''}`
    : due < -0.005
      ? r.money.estimated ? `paid up (prepaid $${fmt(-due)} ahead)` : `$${fmt(-due)} credit`
      : 'nothing due';
  switch (reason) {
    case 'overdue_customer':
    case 'overdue_company':
      return `Overdue ${over} day${over === 1 ? '' : 's'}, ${dueTxt}`;
    case 'due_soon': {
      const until = daysUntilDropOff(r, today) ?? 0;
      return `${until === 0 ? 'Due today' : `Due in ${until} day${until === 1 ? '' : 's'}`}, ${dueTxt}`;
    }
    case 'open_ended':
      return `No return date, out ${r.rentalDays} day${r.rentalDays === 1 ? '' : 's'}, ${dueTxt}`;
    case 'data_fix':
      return r.dataIssues.join('; ') || 'Data to check';
    case 'verify_insurance': {
      const d = r.coverage.daysToDeadline ?? 0;
      return d < 0 ? `Verification overdue ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'Verify coverage today' : `Verify coverage, ${d} day${d === 1 ? '' : 's'} left`;
    }
    case 'coverage_ending':
      return `Coverage used up, ${-(r.coverage.daysLeft ?? 0)} day${r.coverage.daysLeft === -1 ? '' : 's'} over`;
    case 'manual':
      return dueTxt;
  }
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Balances / aging ----------

/** Days outstanding: since drop-off for returned rentals; since pickup for rentals still out. */
export function daysOutstanding(r: Rental, today: string): { days: number; basis: 'since return' | 'since pickup' } | null {
  if (r.isOut) {
    const p = dateOf(r.pickupDate);
    return p ? { days: Math.max(0, daysBetween(p, today)), basis: 'since pickup' } : null;
  }
  const d = dateOf(r.actualReturn) ?? dateOf(r.scheduledDropOff);
  return d ? { days: Math.max(0, daysBetween(d, today)), basis: 'since return' } : null;
}

export function agingBucket(days: number, rules: RulesConfig = DEFAULT_RULES): string {
  for (const b of rules.agingBuckets) if (b.maxDays === null || days <= b.maxDays) return b.label;
  return rules.agingBuckets[rules.agingBuckets.length - 1].label;
}

export function outstanding(r: Rental): number {
  return Math.max(r.money.totalAmountDue, 0);
}
export function credit(r: Rental): number {
  return r.money.totalAmountDue < 0 ? -r.money.totalAmountDue : 0;
}

// ---------- Collections ----------

export interface CollectionTotals {
  billed: number;
  outstanding: number;
  collected: number;
  credits: number;
  rate: number | null; // collected / billed
  count: number;
  withBalance: number;
}

export function collectionTotals(rentals: Rental[]): CollectionTotals {
  let billed = 0, out = 0, cred = 0, withBalance = 0;
  for (const r of rentals) {
    billed += r.money.totalBill;
    const o = outstanding(r);
    out += o;
    cred += credit(r);
    if (o > 0.005) withBalance++;
  }
  const collected = billed - out;
  return { billed: r2(billed), outstanding: r2(out), collected: r2(collected), credits: r2(cred), rate: billed > 0 ? collected / billed : null, count: rentals.length, withBalance };
}

export function collectionTotalsShare(rentals: Rental[], share: 'renter' | 'company'): CollectionTotals {
  let billed = 0, out = 0, cred = 0, withBalance = 0;
  for (const r of rentals) {
    const b = share === 'renter' ? r.money.renterBill : r.money.companyBill;
    const d = share === 'renter' ? r.money.renterAmountDue : r.money.companyAmountDue;
    billed += b;
    out += Math.max(d, 0);
    cred += d < 0 ? -d : 0;
    if (d > 0.005) withBalance++;
  }
  const collected = billed - out;
  return { billed: r2(billed), outstanding: r2(out), collected: r2(collected), credits: r2(cred), rate: billed > 0 ? collected / billed : null, count: rentals.length, withBalance };
}

export function groupTotals<K extends string>(rentals: Rental[], keyOf: (r: Rental) => K | null): { key: K; totals: CollectionTotals }[] {
  const groups = new Map<K, Rental[]>();
  for (const r of rentals) {
    const k = keyOf(r);
    if (k === null) continue;
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()].map(([key, rs]) => ({ key, totals: collectionTotals(rs) }));
}

export function pickupMonth(r: Rental): string | null {
  return monthOf(dateOf(r.pickupDate));
}
export function dropOffMonth(r: Rental): string | null {
  return monthOf(dateOf(r.actualReturn) ?? dateOf(r.scheduledDropOff));
}

export function amountAtRisk(rentals: Rental[], today: string, rules: RulesConfig = DEFAULT_RULES): number {
  return r2(rentals.filter((r) => classify(r, today, rules) === 'overdue').reduce((s, r) => s + outstanding(r), 0));
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
