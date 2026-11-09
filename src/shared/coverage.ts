// Insurance verification and coverage, read from TSD notes. Pure functions; patterns in config/coverage.ts.
import type { Coverage, Rental, RentalNote } from './types';
import {
  COVERAGE_WARN_DAYS, DAYS_PATTERNS, DENIED_PATTERNS, EXTENSION_PATTERNS, IGNORE_PATTERNS, MAX_PATTERNS, RATE_PATTERNS,
  UNTIL_REPAIR_PATTERNS, VERIFIED_PATTERNS, VERIFY_DEADLINE_DAYS,
} from './config/coverage';
import { addDays, dateOf, daysBetween } from './dates';

export interface ParsedNote {
  kind: 'verified' | 'denied' | 'extension' | 'none';
  ratePerDay: number | null;
  days: number | null;
  maxAmount: number | null;
  untilRepair: boolean;
}

function firstNumber(text: string, patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Strip template phrases ("credit check returned approved") before looking for a verification. */
function clean(text: string): string {
  let t = ` ${text} `;
  for (const p of IGNORE_PATTERNS) t = t.replace(new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g'), ' ');
  return t;
}

const INSURANCE_CONTEXT = /\b(?:insurance|ins|adjuster|adjustor|adj|coverage|covers|covered|approved|claim)\b/i;

export function parseNote(raw: string, subject?: string | null): ParsedNote {
  const text = clean(`${subject ?? ''} ${raw ?? ''}`);
  const none: ParsedNote = { kind: 'none', ratePerDay: null, days: null, maxAmount: null, untilRepair: false };
  if (!text.trim()) return none;
  if (DENIED_PATTERNS.some((p) => p.test(text))) return { ...none, kind: 'denied' };
  const verified = VERIFIED_PATTERNS.some((p) => p.test(text));
  const ext = firstNumber(text, EXTENSION_PATTERNS);
  if (!verified && ext !== null && INSURANCE_CONTEXT.test(text)) return { ...none, kind: 'extension', days: ext };
  if (!verified) return none;
  const rate = firstNumber(text, RATE_PATTERNS);
  const max = firstNumber(text, MAX_PATTERNS);
  let days = ext !== null ? null : firstNumber(text, DAYS_PATTERNS);
  // "$900 max" should not be read as the daily rate
  const ratePerDay = rate !== null && max !== null && rate === max ? null : rate;
  if (days === null && max !== null && ratePerDay) days = Math.floor(max / ratePerDay);
  return { kind: 'verified', ratePerDay, days, maxAmount: max, untilRepair: UNTIL_REPAIR_PATTERNS.some((p) => p.test(text)) };
}

/** Insurance or body shop pays (any company attached): needs verification. Customer-only does not. */
export function needsVerification(r: Rental): boolean {
  return r.kind === 'rental' && (r.payerType === 'insurance' || r.payerType === 'bodyshop' || r.payerType === 'mixed' || r.payerType === 'other');
}

/**
 * Coverage for a rental, from its notes (most recent verification wins; later "N more days" notes add days).
 * `raNotes` is the RA's single Notes field (no timestamp): used only when no timestamped note verifies.
 */
export function deriveCoverage(r: Pick<Rental, 'kind' | 'payerType' | 'pickupDate' | 'rentalDays' | 'isOut'>, notes: RentalNote[], raNotes: string | null, today: string): Coverage {
  const pickup = dateOf(r.pickupDate);
  const deadline = pickup ? addDays(pickup, VERIFY_DEADLINE_DAYS) : null;
  // the deadline only matters while the car is out; returned rentals just show "Not verified"
  const daysToDeadline = deadline && r.isOut ? daysBetween(today, deadline) : null;
  const base: Coverage = {
    applies: needsVerification(r as Rental),
    status: 'not_verified', coveredDays: null, ratePerDay: null, maxAmount: null, untilRepair: false,
    verifiedAt: null, verifiedBy: null, note: null, extensionDays: 0,
    daysUsed: r.rentalDays, daysLeft: null, deadline, daysToDeadline, level: 'none',
  };
  if (!base.applies) return { ...base, status: 'not_applicable' };

  const sorted = [...notes].sort((a, b) => a.at.localeCompare(b.at));
  let lastIdx = -1;
  let last: ParsedNote | null = null;
  sorted.forEach((n, i) => {
    const p = parseNote(n.text, n.subject);
    if (p.kind === 'verified' || p.kind === 'denied') { lastIdx = i; last = p; }
  });
  let cov: Coverage = base;
  const lastP = last as ParsedNote | null;
  if (lastP && lastIdx >= 0) {
    const n = sorted[lastIdx];
    let ext = 0;
    for (const later of sorted.slice(lastIdx + 1)) {
      const p = parseNote(later.text, later.subject);
      if (p.kind === 'extension' && p.days) ext += p.days;
    }
    cov = lastP.kind === 'denied'
      ? { ...base, status: 'denied', verifiedAt: n.at, verifiedBy: n.by, note: `${n.subject ? `${n.subject}: ` : ''}${n.text}` }
      : {
          ...base,
          status: lastP.days !== null || lastP.untilRepair ? 'verified' : 'verified_days_unknown',
          coveredDays: lastP.days !== null ? lastP.days + ext : null,
          ratePerDay: lastP.ratePerDay, maxAmount: lastP.maxAmount, untilRepair: lastP.untilRepair,
          verifiedAt: n.at, verifiedBy: n.by, note: `${n.subject ? `${n.subject}: ` : ''}${n.text}`, extensionDays: ext,
        };
  } else if (raNotes) {
    const p = parseNote(raNotes);
    if (p.kind === 'verified' || p.kind === 'denied') {
      cov = p.kind === 'denied'
        ? { ...base, status: 'denied', note: `RA notes: ${raNotes}` }
        : { ...base, status: p.days !== null || p.untilRepair ? 'verified' : 'verified_days_unknown', coveredDays: p.days, ratePerDay: p.ratePerDay, maxAmount: p.maxAmount, untilRepair: p.untilRepair, note: `RA notes: ${raNotes}` };
    }
  }
  if (cov.coveredDays !== null) cov.daysLeft = cov.coveredDays - cov.daysUsed;
  cov.level = coverageLevel(cov, r.isOut);
  return cov;
}

/** ok / warn (<= 3 days left) / danger (exhausted while out, or not verified after the deadline, or denied). */
export function coverageLevel(c: Coverage, isOut: boolean): Coverage['level'] {
  if (c.status === 'not_applicable') return 'none';
  if (c.status === 'denied') return 'danger';
  if (c.status === 'not_verified') return c.daysToDeadline === null ? 'none' : c.daysToDeadline < 0 ? 'danger' : 'warn';
  if (c.daysLeft === null) return c.status === 'verified_days_unknown' ? 'warn' : 'ok';
  if (c.daysLeft < 0 && isOut) return 'danger';
  if (c.daysLeft <= COVERAGE_WARN_DAYS) return 'warn';
  return 'ok';
}

/** "21 / 30 days, 9 left, $30/day" */
export function coverageText(c: Coverage): string {
  switch (c.status) {
    case 'not_applicable': return '';
    case 'denied': return 'Coverage denied';
    case 'not_verified':
      if (c.daysToDeadline === null) return 'Not verified';
      return c.daysToDeadline < 0 ? `Not verified, ${-c.daysToDeadline}d past deadline` : `Not verified, ${c.daysToDeadline}d left to verify`;
    case 'verified_days_unknown':
      return `Verified, days unknown${c.ratePerDay ? `, $${c.ratePerDay}/day` : ''}`;
    case 'verified': {
      const rate = c.ratePerDay ? `, $${c.ratePerDay}/day` : '';
      if (c.coveredDays === null) return `Verified until repair is done, ${c.daysUsed} days used${rate}`;
      const left = c.daysLeft ?? 0;
      return `${c.daysUsed} / ${c.coveredDays} days, ${left >= 0 ? `${left} left` : `${-left} over`}${rate}`;
    }
  }
}
