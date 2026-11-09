// Shared between the Worker and the React app.

// ---------- Raw payload from scripts/tsd/push_bodyshop.py (shape = scripts/tsd/bodyshop.sql) ----------

export interface RawRental {
  raNumber: string;
  baseRaNumber: string | null;
  raType: 'C' | 'D' | string;
  location: string | null;
  unitNumber: string | null;
  vehicleClass: string | null;
  pickupDate: string | null; // 'YYYY-MM-DD HH:MM:SS' America/New_York (TSD stores local time)
  scheduledDropOff: string | null;
  actualReturn: string | null;
  closedFlag: number | null;
  rentalDays: number | null;
  sourceId: number | null;
  sourceOfBusiness: string | null;
  referralAgencyNum: string | null;
  referralAgencyName: string | null;
  referralAgencyType: number | null;
  renterFirstName: string | null;
  renterLastName: string | null;
  renterHomePhone: string | null;
  renterWorkPhone: string | null;
  renterCellPhone: string | null;
  renterEmail: string | null;
  dailyRate: number | null;
  rateCode: string | null;
  checkedOutBy: string | null;
  checkedInBy: string | null;
  poNumber: string | null;
  billFlag: number | boolean | null;
  paidFlag: number | boolean | null;
  raNotes: string | null;
}

export interface RawSplit {
  raNumber: string;
  companyNum: string | null;
  companyName: string | null;
  companyType: number | null; // Cco.TYPE: 1 insurance, 2 dealership, 3 body shop, 7 repair facility
  splitType: number | null;
  activeStatus: string | null;
  claimNumber: string | null;
  policyNumber: string | null;
  percentPay: number | null;
  amountPerDayAuthorised: number | null;
  maxPay: number | null;
  authorisedDays: number | null;
  adjusterFirstName: string | null;
  adjusterLastName: string | null;
  adjusterPhone: string | null;
  repairLocation: string | null;
  repairPhone: string | null;
  repairOrder: string | null;
  prioritySort: number | null;
}

export interface RawMoney {
  raNumber: string;
  totalBill: number;
  companyBill: number;
  rateCharges: number;
  totalPaid: number;
  companyPaid: number;
  chargeLines: number;
  lastPaymentDate: string | null;
  lastChargeDate: string | null;
  billedCompanyNum: string | null;
}

export interface RawCompany {
  num: string;
  type: number;
  name: string | null;
  contact: string | null;
  phone: string | null;
  mobilePhone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  active: number | boolean | null;
  directBill: number | boolean | null;
  gracePeriodDays: number | null;
}

export interface RawExtension {
  raNumber: string;
  changedAt: string;
  employeeId: string | null;
  message: string | null; // "From: 10/19/2026 04:39 PM To: 10/23/2026 04:39 PM"
}

export interface RawNote {
  raNumber: string;
  createdAt: string;
  subject: string | null;
  text: string | null;
  employeeId: string | null;
}

export interface RawEmployee {
  employeeId: string;
  firstName: string | null;
  lastName: string | null;
  userName: string | null;
  location: string | null;
}

/** Charge lines grouped by type/description (section 8 of bodyshop.sql). Absent in older pushes. */
export interface RawCharge {
  raNumber: string;
  chargeType: string;
  description: string;
  toCompany: number | boolean;
  amount: number;
  lines: number;
}

export interface TsdPayload {
  source: 'tsd' | 'sample';
  database?: string;
  since: string;
  fetchedAt: string; // ISO UTC
  durationSec?: number;
  rentals: RawRental[];
  splits: RawSplit[];
  money: RawMoney[];
  companies: RawCompany[];
  extensions: RawExtension[];
  notes: RawNote[];
  employees: RawEmployee[];
  charges?: RawCharge[];
}

// ---------- Normalised model ----------

export type PayerType = 'customer' | 'insurance' | 'bodyshop' | 'mixed' | 'other' | 'unknown';

export interface Contact {
  key: string; // normalised name
  name: string; // display name
  phone: string | null;
  email: string | null;
  contact: string | null; // contact person
  address: string | null;
  matched: boolean; // false when the TSD name did not match any known company
}

export interface Insurer {
  name: string;
  phone: string | null;
  email: string | null;
  claimNumber: string | null;
  policyNumber: string | null;
  adjusterName: string | null;
  adjusterPhone: string | null;
  amountPerDayAuthorised: number | null;
  authorisedDays: number | null;
  maxPay: number | null;
}

export interface Money {
  totalBill: number;
  totalAmountDue: number; // may be negative = credit
  renterBill: number;
  renterAmountDue: number;
  companyBill: number;
  companyAmountDue: number;
  totalPaid: number;
  companyPaid: number;
  estimated: boolean; // true while the rental is out (bill = rate x days + tax, not yet posted in TSD)
  lastPaymentDate: string | null;
}

/** One excluded (or questionable) charge line, kept for Settings > Excluded charges. */
export interface ChargeLine {
  code: string;
  description: string;
  amount: number;
  toCompany: boolean;
  cls: 'rental' | 'excluded' | 'transfer' | 'to_confirm' | 'unclassified';
}

export interface ExcludedInfo {
  /** Charges left out of the rental balance (tolls, tickets, transfers to tolls). */
  charges: number;
  /** Payments attributed to those charges (taken off the rental's payments). */
  paid: number;
  lines: ChargeLine[];
  /** Counted lines that need a decision (to confirm / unclassified). */
  questionable: ChargeLine[];
  /** TSD does not link payments to charges: true when payments had to be split between rental and excluded charges. */
  allocationUnclear: boolean;
}

export interface Coverage {
  applies: boolean; // insurance / body shop pays
  status: 'not_applicable' | 'not_verified' | 'verified' | 'verified_days_unknown' | 'denied';
  coveredDays: number | null; // null = unknown or "until the repair is done"
  ratePerDay: number | null;
  maxAmount: number | null;
  untilRepair: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string | null; // the raw note the status came from
  extensionDays: number;
  daysUsed: number;
  daysLeft: number | null;
  deadline: string | null; // pickup + 3 days
  daysToDeadline: number | null; // negative = past the deadline
  level: 'none' | 'ok' | 'warn' | 'danger';
}

export interface Extension {
  at: string;
  by: string | null; // employee name
  from: string | null; // 'YYYY-MM-DD HH:MM'
  to: string | null;
}

export interface RentalNote {
  at: string;
  by: string | null;
  subject: string | null;
  text: string;
}

export interface Rental {
  raNumber: string;
  baseRaNumber: string | null;
  kind: 'rental' | 'after_rental'; // after_rental = TSD "-D01" sub-RA (tickets, tolls, damage)
  location: string;
  unitNumber: string | null;
  vehicleClass: string | null;
  pickupDate: string | null; // 'YYYY-MM-DDTHH:MM' local New York
  scheduledDropOff: string | null;
  actualReturn: string | null;
  isOut: boolean;
  rentalDays: number; // TSD's count when returned; elapsed days while out
  sourceOfBusiness: string;
  referralAgencyRaw: string | null;
  bodyshop: Contact | null;
  insurer: Insurer | null;
  companyName: string | null; // the direct-bill company (insurer or body shop)
  payerType: PayerType;
  renter: { name: string; phone: string | null; email: string | null };
  dailyRate: number | null;
  money: Money;
  extensions: Extension[];
  notes: RentalNote[];
  checkedOutBy: string | null;
  dataIssues: string[];
  subRentals: string[]; // RA numbers of after_rental records attached to this rental
  /** Non-rental charges left out of `money` (tolls, tickets...). */
  excluded: ExcludedInfo;
  /** Every charge on this record is non-rental (e.g. a toll-only sub-RA): hidden from all views. */
  nonRentalOnly: boolean;
  coverage: Coverage;
}

export interface Lookups {
  bodyshops: Contact[];
  insurers: Contact[];
}

export interface Dataset {
  fetchedAt: string;
  source: 'tsd' | 'sample';
  since: string;
  rentals: Rental[];
  /** Records left out of every view because all their charges are tolls / tickets (Settings > Excluded charges). */
  excludedRecords: Rental[];
  lookups: Lookups;
  /** False when the push had no charge line items (older push script): exclusions could not be applied. */
  chargeDetail: boolean;
}

// ---------- Tasks ----------

export type TaskReason = 'overdue_customer' | 'overdue_company' | 'coverage_ending' | 'verify_insurance' | 'due_soon' | 'open_ended' | 'data_fix' | 'manual';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'snoozed';
export type TaskOutcome = 'extended' | 'returned' | 'payment_promised' | 'paid' | 'unreachable' | 'verified' | 'other';

export interface Task {
  id: number;
  taskDate: string;
  raNumber: string;
  reason: TaskReason;
  priority: number;
  status: TaskStatus;
  assignedTo: string | null;
  snoozedUntil: string | null;
  outcome: TaskOutcome | null;
  outcomeDate: string | null;
  outcomeNote: string | null;
  createdAt: string;
  startedAt: string | null;
  startedBy: string | null;
  completedAt: string | null;
  completedBy: string | null;
  updatedAt: string;
}

export interface TeamNote {
  id: number;
  raNumber: string;
  taskId: number | null;
  text: string;
  createdAt: string;
  createdBy: string;
}

export interface Snapshot {
  snapshotDate: string;
  createdAt: string;
  overdueCount: number;
  overdueCustomer: number;
  dueSoonCount: number;
  openEndedCount: number;
  outCount: number;
  amountAtRisk: number;
  outstandingTotal: number;
  billedTotal: number;
  collectedTotal: number;
  /** null = saved before tolls/tickets were excluded ("before fix"). */
  rulesVersion: number | null;
  overdueRaNumbers: string[];
  outRaNumbers: string[];
}

export interface TaskEvent {
  id: number;
  taskId: number;
  raNumber: string;
  action: string;
  detail: Record<string, unknown> | null;
  at: string;
  by: string;
}

export interface Me {
  email: string;
  name: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
}

export interface User {
  email: string;
  name: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
  createdBy: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
}

export interface Status {
  fetchedAt: string | null;
  source: 'tsd' | 'sample' | null;
  rentalCount: number;
  stale: boolean; // last successful fetch older than 24h
  today: string; // YYYY-MM-DD New York
  rules: { dueSoonDays: number; timezone: string };
}
