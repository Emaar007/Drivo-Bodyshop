// Turns the raw TSD payload into the normalised Dataset the app works with.
// ALL field mapping from TSD lives here and in scripts/tsd/bodyshop.sql.
import type {
  ChargeLine, Contact, Dataset, ExcludedInfo, Extension, Insurer, Lookups, Money, PayerType, RawCharge, RawCompany, RawMoney, RawRental, RawSplit,
  Rental, RentalNote, TsdPayload,
} from './types';
import { BODYSHOP_ALIASES } from './config/bodyshops';
import { INSURER_ALIASES } from './config/insurers';
import { BODYSHOP_COMPANY_TYPES, COMPANY_TYPE, DEFAULT_RULES, type RulesConfig } from './config/rules';
import { dateOf, normalizeLocal, nowLocalIn, parseUsDateTime, rentalDaysBetween } from './dates';
import { classifyCharge, isCounted } from './config/charges';
import { deriveCoverage } from './coverage';

export interface NormalizeOptions {
  rules?: RulesConfig;
  /** 'YYYY-MM-DDTHH:MM' local New York; defaults to now. Used for elapsed days on open rentals. */
  nowLocal?: string;
  /** Extra aliases from Settings (D1), merged over the config files. */
  bodyshopAliases?: Record<string, string>;
  insurerAliases?: Record<string, string>;
  /** Contact overrides from Settings, keyed by normalised body shop name. */
  bodyshopOverrides?: Record<string, Partial<Contact>>;
}

const LEGAL_SUFFIXES = /\b(INC|LLC|CORP|CORPORATION|CO|LTD|LLP)\b\.?/g;

/** Uppercase, no punctuation/spaces/legal suffixes: the matching key for names. */
export function normalizeKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .replace(/[`'’]/g, '')
    .replace(LEGAL_SUFFIXES, '')
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]/g, '');
}

const SMALL = new Set(['OF', 'AND', 'THE', 'A', 'DE', 'LA']);
const KEEP_UPPER = new Set(['LLC', 'INC', 'NJ', 'NY', 'BMW', 'GM', 'JC', 'JP', 'RT', 'MDS', 'VIP', 'EWR', 'JFK', 'LGA', 'BRK', 'NYCM', 'NJM', 'USAA', 'GEICO', 'CURE', 'B2B', 'II', 'A&G', 'T&W', 'L&S', 'M&N', 'M&T', 'S&A', 'AK', 'CAM', 'KEM', 'G&M']);

/** "NOVITEC AUTO BODY" -> "Novitec Auto Body". */
export function titleCase(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9&]/g, '').toUpperCase();
      if (KEEP_UPPER.has(bare)) return w.toUpperCase();
      if (i > 0 && SMALL.has(bare)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/`/g, "'");
}

export function canonicalName(raw: string | null | undefined, aliases: Record<string, string>): { key: string; name: string } {
  const key0 = normalizeKey(raw);
  const alias = aliases[key0];
  if (alias) return { key: normalizeKey(alias), name: alias };
  return { key: key0, name: titleCase(raw) };
}

export function cleanPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  if (digits.length < 7 || /^0+$/.test(digits) || /^1+$/.test(digits) || digits === '1231231231') return null;
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p.trim();
}

function cleanEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const first = e.split(/[,;\s]+/).find((x) => x.includes('@'));
  return first ? first.toLowerCase() : null;
}

function buildContacts(companies: RawCompany[], types: Set<number>, aliases: Record<string, string>, overrides: Record<string, Partial<Contact>>): Map<string, Contact> {
  const map = new Map<string, Contact>();
  for (const c of companies) {
    if (!types.has(c.type) || !c.name) continue;
    const { key, name } = canonicalName(c.name, aliases);
    if (!key) continue;
    const existing = map.get(key);
    const address = [c.street, c.city, c.state, c.zip].filter(Boolean).join(', ') || null;
    const fresh: Contact = {
      key,
      name,
      phone: cleanPhone(c.phone) ?? cleanPhone(c.mobilePhone),
      email: cleanEmail(c.email),
      contact: c.contact?.trim() || null,
      address,
      matched: true,
    };
    // Duplicate accounts: keep the most complete record.
    map.set(key, existing ? mergeContacts(existing, fresh) : fresh);
  }
  for (const [key, o] of Object.entries(overrides)) {
    const base = map.get(key) ?? { key, name: o.name ?? key, phone: null, email: null, contact: null, address: null, matched: true };
    map.set(key, { ...base, ...stripUndefined(o), key, matched: true });
  }
  return map;
}

function mergeContacts(a: Contact, b: Contact): Contact {
  return {
    key: a.key,
    name: a.name,
    phone: a.phone ?? b.phone,
    email: a.email ?? b.email,
    contact: a.contact ?? b.contact,
    address: a.address ?? b.address,
    matched: true,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Payer from the direct-bill rows and, once charges are posted, from who was actually billed. */
export function derivePayer(args: {
  splits: RawSplit[];
  money: RawMoney | undefined;
  companyTypeByNum: Map<string, number>;
  renterDue: number;
  companyDue: number;
}): { payerType: PayerType; companyNum: string | null; companyType: number | null } {
  const { splits, money, companyTypeByNum, renterDue, companyDue } = args;
  let companyNum: string | null = null;
  if (money?.billedCompanyNum) companyNum = money.billedCompanyNum;
  else if ((money?.chargeLines ?? 0) > 0) companyNum = null; // charges posted and none billed to a company: the renter pays
  else {
    const sorted = [...splits].filter((s) => s.companyNum).sort((a, b) => (a.prioritySort ?? 0) - (b.prioritySort ?? 0));
    companyNum = sorted[0]?.companyNum ?? null;
  }
  const companyType = companyNum ? companyTypeByNum.get(companyNum) ?? null : null;
  if (renterDue > 0.005 && companyDue > 0.005) return { payerType: 'mixed', companyNum, companyType };
  if (!companyNum) return { payerType: 'customer', companyNum: null, companyType: null };
  if (companyType === COMPANY_TYPE.INSURANCE) return { payerType: 'insurance', companyNum, companyType };
  if (companyType !== null && BODYSHOP_COMPANY_TYPES.has(companyType)) return { payerType: 'bodyshop', companyNum, companyType };
  if (companyType === null) return { payerType: 'unknown', companyNum, companyType };
  return { payerType: 'other', companyNum, companyType };
}

/** Splits the charge lines of one RA into counted (rental) and excluded (tolls, tickets, transfers to tolls). */
export function splitCharges(charges: RawCharge[] | undefined): {
  counted: number; countedCompany: number; countedLines: number;
  excluded: number; excludedCompany: number; transferOut: number;
  lines: ChargeLine[]; questionable: ChargeLine[];
} {
  const out = { counted: 0, countedCompany: 0, countedLines: 0, excluded: 0, excludedCompany: 0, transferOut: 0, lines: [] as ChargeLine[], questionable: [] as ChargeLine[] };
  for (const c of charges ?? []) {
    const cls = classifyCharge(c.chargeType, c.description);
    const amount = Number(c.amount) || 0;
    const toCompany = !!Number(c.toCompany);
    const line: ChargeLine = { code: c.chargeType, description: c.description, amount: round2(amount), toCompany, cls };
    if (isCounted(cls)) {
      out.counted += amount;
      if (toCompany) out.countedCompany += amount;
      out.countedLines += Number(c.lines) || 1;
      if (cls !== 'rental' && Math.abs(amount) > 0.005) out.questionable.push(line);
    } else {
      out.excluded += amount;
      if (toCompany) out.excludedCompany += amount;
      // a positive transfer on this RA = the rental's own payments were moved to the toll account
      if (cls === 'transfer' && amount > 0) out.transferOut += amount;
      if (Math.abs(amount) > 0.005) out.lines.push(line);
    }
  }
  return out;
}

/**
 * Money for one RA, rental charges only (tolls, tickets and similar are left out, config/charges.ts).
 *
 * Returned rentals: posted charge lines. TSD does not link a payment to a charge, so payments are attributed as
 * follows: (1) "deposit applied to tolls" transfers are taken off the payments (that money paid tolls);
 * (2) a record whose charges are all excluded gives all its payments to the excluded charges;
 * (3) otherwise payments pay the rental charges first and any surplus the excluded ones. Case (3) with excluded
 * charges present is flagged (`allocationUnclear`).
 *
 * Open rentals get an estimate because TSD posts charges only at return: bill = rate x billable days x (1 + tax),
 * where billable days run from pickup to the later of now and the scheduled drop-off (customers prepay through
 * the drop-off date, so a rental that is not overdue shows ~nothing due; an overdue one grows every day).
 */
export function deriveMoney(args: {
  raw: RawRental;
  money: RawMoney | undefined;
  charges?: RawCharge[];
  hasChargeDetail?: boolean;
  isOut: boolean;
  billableDays: number;
  rules: RulesConfig;
  companyPaysAll: boolean;
}): { money: Money; excluded: ExcludedInfo; nonRentalOnly: boolean } {
  const { raw, money, charges, isOut, billableDays, rules, companyPaysAll } = args;
  const detail = args.hasChargeDetail ?? charges !== undefined;
  const totalPaidAll = money?.totalPaid ?? 0;
  const companyPaidAll = money?.companyPaid ?? 0;
  const sp = detail
    ? splitCharges(charges)
    : { counted: money?.totalBill ?? 0, countedCompany: money?.companyBill ?? 0, countedLines: money?.chargeLines ?? 0, excluded: 0, excludedCompany: 0, transferOut: 0, lines: [], questionable: [] };
  const lastPaymentDate = normalizeLocal(money?.lastPaymentDate);

  // payments left for the rental after transfers to tolls
  const paidAfterTransfer = totalPaidAll - sp.transferOut;
  const hasExcluded = sp.lines.length > 0;

  if (isOut && sp.countedLines === 0) {
    const rate = raw.dailyRate ?? 0;
    const tax = rules.taxRateByLocation[raw.location ?? ''] ?? rules.defaultTaxRate;
    const bill = round2(rate * billableDays * (1 + tax));
    const companyBill = companyPaysAll ? bill : 0;
    const renterBill = bill - companyBill;
    const totalPaid = round2(paidAfterTransfer);
    const companyPaid = companyPaidAll;
    return {
      money: {
        totalBill: bill,
        totalAmountDue: round2(bill - totalPaid),
        renterBill,
        renterAmountDue: round2(renterBill - (totalPaid - companyPaid)),
        companyBill,
        companyAmountDue: round2(companyBill - companyPaid),
        totalPaid,
        companyPaid,
        estimated: true,
        lastPaymentDate,
      },
      excluded: { charges: round2(sp.excluded), paid: round2(sp.transferOut), lines: sp.lines, questionable: sp.questionable, allocationUnclear: false },
      nonRentalOnly: false,
    };
  }

  // A record whose only charges are excluded: everything (charges and payments) belongs to the excluded side.
  if (detail && sp.countedLines === 0 && hasExcluded) {
    return {
      money: { totalBill: 0, totalAmountDue: 0, renterBill: 0, renterAmountDue: 0, companyBill: 0, companyAmountDue: 0, totalPaid: 0, companyPaid: 0, estimated: false, lastPaymentDate },
      excluded: { charges: round2(sp.excluded), paid: round2(totalPaidAll), lines: sp.lines, questionable: sp.questionable, allocationUnclear: false },
      nonRentalOnly: true,
    };
  }

  const totalBill = round2(sp.counted);
  const companyBill = round2(sp.countedCompany);
  // rental first: payments cover the rental charges; any surplus is attributed to excluded charges (up to their amount)
  // excluded charges still to be paid after the transfers (sp.excluded already contains the transfer lines)
  const excludedOpen = Math.max(0, sp.excluded - sp.transferOut);
  const surplus = Math.max(0, paidAfterTransfer - totalBill);
  const toExcluded = hasExcluded ? Math.min(surplus, excludedOpen) : 0;
  const totalPaid = round2(paidAfterTransfer - toExcluded);
  const companyPaid = round2(Math.min(companyPaidAll, Math.max(companyBill, 0) + Math.max(0, totalPaid - totalBill)));
  const renterBill = round2(totalBill - companyBill);
  const renterPaid = round2(totalPaid - companyPaid);
  const allocationUnclear = hasExcluded && excludedOpen > 0.005 && totalPaidAll > 0.005;
  return {
    money: {
      totalBill,
      totalAmountDue: round2(totalBill - totalPaid),
      renterBill,
      renterAmountDue: round2(renterBill - renterPaid),
      companyBill,
      companyAmountDue: round2(companyBill - companyPaid),
      totalPaid,
      companyPaid,
      estimated: false,
      lastPaymentDate,
    },
    excluded: { charges: round2(sp.excluded), paid: round2(sp.transferOut + toExcluded), lines: sp.lines, questionable: sp.questionable, allocationUnclear },
    nonRentalOnly: false,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseExtension(message: string | null): { from: string | null; to: string | null } {
  if (!message) return { from: null, to: null };
  const m = /From:\s*(.+?)\s+To:\s*(.+)$/i.exec(message);
  if (!m) return { from: null, to: null };
  return { from: parseUsDateTime(m[1]), to: parseUsDateTime(m[2]) };
}

export function normalizePayload(payload: TsdPayload, opts: NormalizeOptions = {}): Dataset {
  const rules = opts.rules ?? DEFAULT_RULES;
  const nowLocal = opts.nowLocal ?? nowLocalIn(rules.timezone);
  const today = nowLocal.slice(0, 10);
  const bodyshopAliases = { ...BODYSHOP_ALIASES, ...(opts.bodyshopAliases ?? {}) };
  const insurerAliases = { ...INSURER_ALIASES, ...(opts.insurerAliases ?? {}) };

  const bodyshops = buildContacts(payload.companies, BODYSHOP_COMPANY_TYPES, bodyshopAliases, opts.bodyshopOverrides ?? {});
  const insurers = buildContacts(payload.companies, new Set([COMPANY_TYPE.INSURANCE]), insurerAliases, {});
  const companyByNum = new Map(payload.companies.map((c) => [c.num, c]));
  const companyTypeByNum = new Map(payload.companies.map((c) => [c.num, c.type]));
  const employees = new Map(payload.employees.map((e) => [e.employeeId, titleCase(`${e.firstName ?? ''} ${e.lastName ?? ''}`.trim()) || e.userName || e.employeeId]));

  const splitsByRa = groupBy(payload.splits, (s) => s.raNumber);
  const moneyByRa = new Map(payload.money.map((m) => [m.raNumber, m]));
  const hasChargeDetail = Array.isArray(payload.charges);
  const chargesByRa = groupBy(payload.charges ?? [], (c) => c.raNumber);
  const extByRa = groupBy(payload.extensions, (e) => e.raNumber);
  const notesByRa = groupBy(payload.notes, (n) => n.raNumber);

  const rentals: Rental[] = [];
  for (const raw of payload.rentals) {
    const kind: Rental['kind'] = raw.raType === 'D' || raw.baseRaNumber ? 'after_rental' : 'rental';
    const pickupDate = normalizeLocal(raw.pickupDate);
    const scheduledDropOff = normalizeLocal(raw.scheduledDropOff);
    const actualReturn = normalizeLocal(raw.actualReturn);
    // isOut comes from the real return field, never from the drop-off date.
    const isOut = kind === 'rental' && actualReturn === null && (raw.closedFlag ?? 0) === 0;
    const elapsedDays = pickupDate ? rentalDaysBetween(pickupDate, nowLocal) : 0;
    const rentalDays = isOut ? elapsedDays : raw.rentalDays ?? (pickupDate && actualReturn ? rentalDaysBetween(pickupDate, actualReturn) : 0);

    const splits = splitsByRa.get(raw.raNumber) ?? [];
    const money = moneyByRa.get(raw.raNumber);
    const issues: string[] = [];

    // Payer: first pass without balances to know whether the company pays the whole bill.
    const pre = derivePayer({ splits, money, companyTypeByNum, renterDue: 0, companyDue: 0 });
    const companyPaysAll = pre.payerType === 'insurance' || pre.payerType === 'bodyshop' || pre.payerType === 'other';
    const billableDays = pickupDate && scheduledDropOff && scheduledDropOff > nowLocal ? rentalDaysBetween(pickupDate, scheduledDropOff) : elapsedDays;
    const dm = deriveMoney({ raw, money, charges: chargesByRa.get(raw.raNumber) ?? [], hasChargeDetail, isOut, billableDays, rules, companyPaysAll });
    const m = dm.money;
    const payer = derivePayer({ splits, money, companyTypeByNum, renterDue: m.renterAmountDue, companyDue: m.companyAmountDue });

    // Body shop: the referral agency when it is a shop, else the direct-bill company when it is a shop,
    // else the split's repair location text.
    let bodyshop: Contact | null = null;
    const refType = raw.referralAgencyType;
    const refName = raw.referralAgencyName;
    const shopCandidates: string[] = [];
    if (refName && refType !== null && BODYSHOP_COMPANY_TYPES.has(refType)) shopCandidates.push(refName);
    if (payer.companyNum && payer.companyType !== null && BODYSHOP_COMPANY_TYPES.has(payer.companyType)) {
      const n = companyByNum.get(payer.companyNum)?.name;
      if (n) shopCandidates.push(n);
    }
    for (const s of splits) if (s.repairLocation) shopCandidates.push(s.repairLocation);
    if (refName && refType !== null && !BODYSHOP_COMPANY_TYPES.has(refType) && refType !== COMPANY_TYPE.INSURANCE) {
      // Referral is some other kind of account (e.g. a travel agency) - still try to match the name.
      shopCandidates.push(refName);
    }
    for (const cand of shopCandidates) {
      const { key, name } = canonicalName(cand, bodyshopAliases);
      const hit = bodyshops.get(key);
      if (hit) { bodyshop = hit; break; }
      if (!bodyshop) bodyshop = { key, name, phone: null, email: null, contact: null, address: null, matched: false };
    }
    if (kind === 'rental') {
      if (!bodyshop) issues.push('No referring body shop on the rental');
      else if (!bodyshop.matched) issues.push(`Body shop "${bodyshop.name}" not in the contact list`);
    }

    // Insurer
    let insurer: Insurer | null = null;
    const insSplit = splits.find((s) => s.companyType === COMPANY_TYPE.INSURANCE) ?? null;
    const insNum = payer.companyType === COMPANY_TYPE.INSURANCE ? payer.companyNum : insSplit?.companyNum ?? null;
    if (insNum || insSplit) {
      const co = insNum ? companyByNum.get(insNum) : undefined;
      const { key, name } = canonicalName(co?.name ?? insSplit?.companyName ?? 'Insurance', insurerAliases);
      const known = insurers.get(key);
      insurer = {
        name,
        phone: known?.phone ?? cleanPhone(co?.phone) ?? null,
        email: known?.email ?? cleanEmail(co?.email) ?? null,
        claimNumber: insSplit?.claimNumber?.trim() || null,
        policyNumber: insSplit?.policyNumber?.trim() || null,
        adjusterName: [insSplit?.adjusterFirstName, insSplit?.adjusterLastName].filter(Boolean).join(' ').trim() || null,
        adjusterPhone: cleanPhone(insSplit?.adjusterPhone),
        amountPerDayAuthorised: insSplit?.amountPerDayAuthorised || null,
        authorisedDays: insSplit?.authorisedDays || null,
        maxPay: insSplit?.maxPay || null,
      };
    }

    const companyName = payer.companyNum
      ? payer.companyType === COMPANY_TYPE.INSURANCE
        ? insurer?.name ?? titleCase(companyByNum.get(payer.companyNum)?.name)
        : canonicalName(companyByNum.get(payer.companyNum)?.name, bodyshopAliases).name
      : null;

    if (payer.payerType === 'unknown') issues.push('Direct-bill company is not in the company list');
    if (kind === 'rental' && isOut && (raw.dailyRate ?? 0) <= 0) issues.push('No daily rate on the rental (bill cannot be estimated)');
    if (!isOut && m.totalAmountDue < -0.005) issues.push(`Credit balance of ${Math.abs(m.totalAmountDue).toFixed(2)} (overpaid)`);
    if (kind === 'rental' && !scheduledDropOff && isOut) issues.push('No scheduled drop-off date');
    for (const q of dm.excluded.questionable) {
      if (q.cls === 'unclassified') issues.push(`Unclassified charge ${q.code || '?'} "${q.description}" ${q.amount.toFixed(2)}: counted, classify it in config/charges.ts`);
    }

    const extensions: Extension[] = (extByRa.get(raw.raNumber) ?? []).map((e) => {
      const { from, to } = parseExtension(e.message);
      return { at: normalizeLocal(e.changedAt) ?? e.changedAt, by: e.employeeId ? employees.get(e.employeeId) ?? e.employeeId : null, from, to };
    });
    const notes: RentalNote[] = (notesByRa.get(raw.raNumber) ?? [])
      .filter((n) => (n.text ?? '').trim() || (n.subject ?? '').trim())
      .map((n) => ({ at: normalizeLocal(n.createdAt) ?? n.createdAt, by: n.employeeId ? employees.get(n.employeeId) ?? n.employeeId : null, subject: n.subject?.trim() || null, text: (n.text ?? '').trim() }));

    const renterName = titleCase(`${raw.renterFirstName ?? ''} ${raw.renterLastName ?? ''}`.trim());
    rentals.push({
      raNumber: raw.raNumber,
      baseRaNumber: raw.baseRaNumber ?? null,
      kind,
      location: raw.location ?? '',
      unitNumber: raw.unitNumber || null,
      vehicleClass: raw.vehicleClass || null,
      pickupDate,
      scheduledDropOff,
      actualReturn,
      isOut,
      rentalDays,
      sourceOfBusiness: raw.sourceOfBusiness ?? '',
      referralAgencyRaw: refName,
      bodyshop,
      insurer,
      companyName,
      payerType: payer.payerType,
      renter: {
        name: renterName,
        phone: cleanPhone(raw.renterCellPhone) ?? cleanPhone(raw.renterHomePhone) ?? cleanPhone(raw.renterWorkPhone),
        email: cleanEmail(raw.renterEmail),
      },
      dailyRate: raw.dailyRate ?? null,
      money: m,
      extensions,
      notes,
      checkedOutBy: raw.checkedOutBy ? employees.get(raw.checkedOutBy) ?? raw.checkedOutBy : null,
      dataIssues: issues,
      subRentals: [],
      excluded: dm.excluded,
      nonRentalOnly: dm.nonRentalOnly,
      coverage: deriveCoverage({ kind, payerType: payer.payerType, pickupDate, rentalDays, isOut }, notes, raw.raNotes ?? null, today),
    });
  }

  // Attach after-rental sub-RAs to their base rental and inherit its people/contacts.
  const byRa = new Map(rentals.map((r) => [r.raNumber, r]));
  for (const r of rentals) {
    if (r.nonRentalOnly) continue;
    if (r.kind !== 'after_rental' || !r.baseRaNumber) continue;
    const base = byRa.get(r.baseRaNumber);
    if (!base) continue;
    base.subRentals.push(r.raNumber);
    if (!r.bodyshop) r.bodyshop = base.bodyshop;
    if (!r.insurer) r.insurer = base.insurer;
    if (!r.renter.name) r.renter = base.renter;
    if (!r.scheduledDropOff) r.scheduledDropOff = base.scheduledDropOff;
    if (!r.actualReturn) r.actualReturn = base.actualReturn;
    r.dataIssues = r.dataIssues.filter((i) => !i.startsWith('No referring body shop'));
  }

  const lookups: Lookups = {
    bodyshops: [...bodyshops.values()].sort((a, b) => a.name.localeCompare(b.name)),
    insurers: [...insurers.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  // Records whose charges are all tolls / tickets leave every view (kept for Settings > Excluded charges).
  const kept = rentals.filter((r) => !r.nonRentalOnly);
  const excludedRecords = rentals.filter((r) => r.nonRentalOnly);
  for (const r of excludedRecords) {
    const base = r.baseRaNumber ? byRa.get(r.baseRaNumber) : undefined;
    if (base) { r.bodyshop ??= base.bodyshop; r.insurer ??= base.insurer; if (!r.renter.name) r.renter = base.renter; }
  }
  return { fetchedAt: payload.fetchedAt, source: payload.source, since: payload.since, rentals: kept, excludedRecords, lookups, chargeDetail: hasChargeDetail };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export { dateOf };
