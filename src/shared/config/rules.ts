// Business rules in one place. Everything here is plain data; src/shared/rules.ts applies it.
import type { PayerType, TaskReason } from '../types';

export interface RulesConfig {
  /** "Due soon" = still out and scheduled drop-off within this many days (today counts as 0). */
  dueSoonDays: number;
  timezone: string;
  /** Task groups on the Today page, highest priority first. */
  priorityOrder: TaskReason[];
  /** Days-outstanding buckets for aging (upper bounds, inclusive; the last bucket is open-ended). */
  agingBuckets: { label: string; maxDays: number | null }[];
  /**
   * Estimated tax + surcharge on the daily rate while a rental is still out (TSD only posts charges at
   * return). Derived from closed body shop rentals: NY locations charge Sales Tax 8.875% + NYRT 12%.
   */
  taxRateByLocation: Record<string, number>;
  defaultTaxRate: number;
  /** Rentals longer than this with no extension in `staleExtensionDays` get a data-quality flag. */
  staleExtensionDays: number;
  /** Per-payer overrides of dueSoonDays (e.g. insurers need more lead time for approvals). */
  dueSoonDaysByPayer: Partial<Record<PayerType, number>>;
}

export const DEFAULT_RULES: RulesConfig = {
  dueSoonDays: 3,
  timezone: 'America/New_York',
  priorityOrder: ['overdue_customer', 'overdue_company', 'coverage_ending', 'verify_insurance', 'due_soon', 'open_ended', 'data_fix'],
  agingBuckets: [
    { label: '0-15 days', maxDays: 15 },
    { label: '16-30 days', maxDays: 30 },
    { label: '31-60 days', maxDays: 60 },
    { label: '60+ days', maxDays: null },
  ],
  taxRateByLocation: {
    BRK: 0.20875,
    BRKJS: 0.20875,
    LGA: 0.20875,
    JFK: 0.20875,
    SUBS: 0.20875,
    EWR: 0.0663,
    EWRCON: 0.0663,
  },
  defaultTaxRate: 0.20875,
  staleExtensionDays: 14,
  dueSoonDaysByPayer: {},
};

export const TASK_REASON_LABEL: Record<TaskReason, string> = {
  overdue_customer: 'Overdue, customer pays',
  overdue_company: 'Overdue, insurance / body shop pays',
  coverage_ending: 'Coverage ending, extend with insurance',
  verify_insurance: 'Insurance verification',
  due_soon: 'Due in the next days',
  open_ended: 'No return date',
  data_fix: 'Data to fix',
  manual: 'Added by the team',
};

export const TASK_REASON_HINT: Record<TaskReason, string> = {
  overdue_customer: 'Call the customer, extend the rental, collect payment.',
  overdue_company: 'Call the adjuster or the shop, get the extension approved.',
  coverage_ending: 'Still out past the days the insurer approved. Ask the adjuster for more days.',
  verify_insurance: 'Verify coverage within 3 days of pickup, then add a note in TSD',
  due_soon: 'Extend before it goes overdue.',
  open_ended: 'Set a return date with the shop or the customer.',
  data_fix: 'Missing or ambiguous payer, unmatched body shop, or a negative balance.',
  manual: 'Follow-ups the team created from a rental (e.g. a balance to collect).',
};

export const PAYER_LABEL: Record<PayerType, string> = {
  customer: 'Customer',
  insurance: 'Insurance',
  bodyshop: 'Body shop',
  mixed: 'Mixed',
  other: 'Other company',
  unknown: 'Unknown',
};

/** Cco.TYPE codes in TSD. */
export const COMPANY_TYPE = {
  CORPORATE: 0,
  INSURANCE: 1,
  DEALERSHIP: 2,
  BODY_SHOP: 3,
  REPAIR_FACILITY: 7,
} as const;

export const BODYSHOP_COMPANY_TYPES = new Set<number>([COMPANY_TYPE.BODY_SHOP, COMPANY_TYPE.REPAIR_FACILITY, COMPANY_TYPE.DEALERSHIP]);
