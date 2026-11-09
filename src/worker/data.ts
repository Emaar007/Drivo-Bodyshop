// Loading the current dataset: latest TSD push from D1 (or the bundled sample), normalised with
// the aliases / contact overrides / rule settings the admins keep in D1.
import type { Env } from './env';
import type { Contact, Dataset, TsdPayload } from '@shared/types';
import { normalizePayload } from '@shared/normalize';
import { DEFAULT_RULES, type RulesConfig } from '@shared/config/rules';
import sample from '../../data/sample.json';

export interface Settings {
  rules: RulesConfig;
  bodyshopAliases: Record<string, string>;
  insurerAliases: Record<string, string>;
  bodyshopOverrides: Record<string, Partial<Contact>>;
  adminEmails: string[];
}

interface IngestRow {
  id: number;
  fetched_at: string;
  received_at: string;
  source: 'tsd' | 'sample';
  payload: string;
}

export async function loadSettings(env: Env): Promise<Settings> {
  const [settings, aliases, contacts] = await Promise.all([
    env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>(),
    env.DB.prepare('SELECT alias, canonical, kind FROM aliases').all<{ alias: string; canonical: string; kind: string }>(),
    env.DB.prepare('SELECT key, display_name, contact, phone, email, address FROM bodyshop_contacts').all<{
      key: string; display_name: string; contact: string | null; phone: string | null; email: string | null; address: string | null;
    }>(),
  ]);
  const kv = Object.fromEntries(settings.results.map((r) => [r.key, r.value]));
  const rules: RulesConfig = {
    ...DEFAULT_RULES,
    dueSoonDays: num(kv.dueSoonDays, num(env.DUE_SOON_DAYS, DEFAULT_RULES.dueSoonDays)),
    timezone: kv.timezone ?? env.TIMEZONE ?? DEFAULT_RULES.timezone,
    staleExtensionDays: num(kv.staleExtensionDays, DEFAULT_RULES.staleExtensionDays),
    dueSoonDaysByPayer: safeJson(kv.dueSoonDaysByPayer, DEFAULT_RULES.dueSoonDaysByPayer),
    taxRateByLocation: { ...DEFAULT_RULES.taxRateByLocation, ...safeJson(kv.taxRateByLocation, {}) },
  };
  const bodyshopAliases: Record<string, string> = {};
  const insurerAliases: Record<string, string> = {};
  for (const a of aliases.results) (a.kind === 'insurer' ? insurerAliases : bodyshopAliases)[a.alias] = a.canonical;
  const bodyshopOverrides: Record<string, Partial<Contact>> = {};
  for (const c of contacts.results) {
    bodyshopOverrides[c.key] = { name: c.display_name, contact: c.contact ?? undefined, phone: c.phone ?? undefined, email: c.email ?? undefined, address: c.address ?? undefined };
  }
  const adminEmails = (kv.adminEmails ?? env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { rules, bodyshopAliases, insurerAliases, bodyshopOverrides, adminEmails };
}

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
}
function safeJson<T>(v: string | undefined, d: T): T {
  if (!v) return d;
  try { return JSON.parse(v) as T; } catch { return d; }
}

export async function latestIngest(env: Env): Promise<IngestRow | null> {
  const row = await env.DB.prepare('SELECT id, fetched_at, received_at, source, payload FROM ingests ORDER BY id DESC LIMIT 1').first<IngestRow>();
  return row ?? null;
}

export interface Loaded {
  dataset: Dataset;
  ingestId: number | null;
  receivedAt: string | null;
  settings: Settings;
}

// Normalising is cheap (a few hundred rentals) but the payload parse is not free: cache per isolate.
let cache: { ingestId: number | null; settingsKey: string; dataset: Dataset; nowDate: string } | null = null;

export async function loadDataset(env: Env, nowLocal: string): Promise<Loaded> {
  const settings = await loadSettings(env);
  const row = await latestIngest(env);
  const settingsKey = JSON.stringify([settings.rules, settings.bodyshopAliases, settings.insurerAliases, settings.bodyshopOverrides]);
  const ingestId = row?.id ?? null;
  const nowDate = nowLocal.slice(0, 10);
  if (cache && cache.ingestId === ingestId && cache.settingsKey === settingsKey && cache.nowDate === nowDate && !(ingestId === null && env.USE_SAMPLE_DATA !== 'true')) {
    return { dataset: cache.dataset, ingestId, receivedAt: row?.received_at ?? null, settings };
  }
  let payload: TsdPayload | null = null;
  if (row) payload = JSON.parse(row.payload) as TsdPayload;
  else if (env.USE_SAMPLE_DATA === 'true') payload = sample as unknown as TsdPayload;
  const dataset: Dataset = payload
    ? normalizePayload(payload, { rules: settings.rules, nowLocal, bodyshopAliases: settings.bodyshopAliases, insurerAliases: settings.insurerAliases, bodyshopOverrides: settings.bodyshopOverrides })
    : { fetchedAt: '', source: 'tsd', since: '', rentals: [], excludedRecords: [], lookups: { bodyshops: [], insurers: [] }, chargeDetail: false };
  cache = { ingestId, settingsKey, dataset, nowDate };
  return { dataset, ingestId, receivedAt: row?.received_at ?? null, settings };
}

export function invalidateCache(): void {
  cache = null;
}

const REQUIRED: (keyof TsdPayload)[] = ['rentals', 'splits', 'money', 'companies', 'extensions', 'notes', 'employees'];

export function validatePayload(p: unknown): p is TsdPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (typeof o.fetchedAt !== 'string') return false;
  for (const k of REQUIRED) if (!Array.isArray(o[k])) return false;
  const first = (o.rentals as unknown[])[0] as Record<string, unknown> | undefined;
  if (first && typeof first.raNumber !== 'string') return false;
  return true;
}

export async function storeIngest(env: Env, payload: TsdPayload): Promise<number> {
  const res = await env.DB.prepare(
    'INSERT INTO ingests (fetched_at, received_at, source, rental_count, duration_sec, payload) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(payload.fetchedAt, new Date().toISOString(), payload.source === 'sample' ? 'sample' : 'tsd', payload.rentals.length, payload.durationSec ?? null, JSON.stringify(payload))
    .run();
  invalidateCache();
  // Keep the last 60 pushes (audit / replay); the snapshots table keeps the daily history.
  await env.DB.prepare('DELETE FROM ingests WHERE id NOT IN (SELECT id FROM ingests ORDER BY id DESC LIMIT 60) AND id NOT IN (SELECT ingest_id FROM snapshots)').run();
  return Number(res.meta.last_row_id);
}
