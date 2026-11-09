// Date helpers. TSD stores naive local times (America/New_York). We keep them as strings
// ('YYYY-MM-DDTHH:MM') and compare calendar dates, never instants, so "overdue" means the
// drop-off *date* is before today's New York date.

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD HH:MM:SS' | 'YYYY-MM-DDTHH:MM' | 'YYYY-MM-DD' -> 'YYYY-MM-DDTHH:MM' (or null). */
export function normalizeLocal(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2})?/.exec(s.trim());
  if (!m) return null;
  return `${m[1]}T${m[2] ?? '00:00'}`;
}

/** The calendar date part of a local timestamp. */
export function dateOf(s: string | null | undefined): string | null {
  const n = normalizeLocal(s);
  return n ? n.slice(0, 10) : null;
}

/** Today's date in the given IANA timezone as 'YYYY-MM-DD'. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Local 'YYYY-MM-DDTHH:MM' for now in a timezone. */
export function nowLocalIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

function utcMidnight(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `a` to `b` (b - a). Both 'YYYY-MM-DD'. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / DAY_MS);
}

/** Add days to a 'YYYY-MM-DD'. */
export function addDays(date: string, days: number): string {
  return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Rental days between two local timestamps the way TSD counts them for these rentals:
 * whole 24h periods, plus one when more than a one-hour grace is used. Minimum 1.
 */
export function rentalDaysBetween(from: string, to: string): number {
  const a = new Date(normalizeLocal(from)!.replace('T', 'T') + ':00Z').getTime();
  const b = new Date(normalizeLocal(to)!.replace('T', 'T') + ':00Z').getTime();
  const hours = (b - a) / 3_600_000;
  if (hours <= 0) return 1;
  const whole = Math.floor(hours / 24);
  const rest = hours - whole * 24;
  return Math.max(1, whole + (rest > 1 ? 1 : 0));
}

/** 'MM/DD/YYYY hh:mm AM' (TSD log format) -> 'YYYY-MM-DDTHH:MM'. */
export function parseUsDateTime(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(s);
  if (!m) return null;
  let h = m[4] ? Number(m[4]) : 0;
  const ap = m[6]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}T${pad(h)}:${m[5] ?? '00'}`;
}

export function monthOf(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct 22' (year added when it is not the current year), with `time`: 'Oct 22, 4:39 PM'. */
export function formatDate(s: string | null | undefined, opts: { time?: boolean; year?: boolean } = {}): string {
  const n = normalizeLocal(s);
  if (!n) return '-';
  const [d, t] = n.split('T');
  const [y, m, day] = d.split('-');
  const showYear = opts.year ?? y !== String(new Date().getFullYear());
  const base = `${MONTHS[Number(m) - 1]} ${Number(day)}${showYear ? `, ${y}` : ''}`;
  if (!opts.time) return base;
  const [hh, mm] = t.split(':').map(Number);
  const ap = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${base}, ${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

export function formatIso(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}
