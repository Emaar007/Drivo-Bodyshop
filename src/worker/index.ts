// Hono API + static assets, one Worker. See README for the data flow.
import { Hono } from 'hono';
import type { Env } from './env';
import {
  AuthError, clearSessionCookie, createSessionCookie, createUser, deleteUser, getUser, identify, listUsers, login, updateUser, userCount, verifyPassword,
} from './auth';
import { invalidateCache, latestIngest, loadDataset, loadSettings, storeIngest, validatePayload } from './data';
import {
  applyTaskAction, createManualTask, ensureTasks, listEvents, listSnapshots, listTasks, listTasksRange, saveSnapshot, tasksForRental, type TaskAction,
} from './tasks';
import { nowLocalIn, todayIn } from '@shared/dates';
import type { Me, Status, TeamNote } from '@shared/types';
import { normalizeKey } from '@shared/normalize';

type App = { Bindings: Env; Variables: { me: Me } };
const app = new Hono<App>();

const STALE_HOURS = 24;

app.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, 401);
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
});

// ---------- Ingest (machine to machine, bearer token) ----------
app.post('/api/ingest', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!c.env.INGEST_TOKEN || token !== c.env.INGEST_TOKEN) return c.json({ error: 'bad token' }, 401);
  const body = await c.req.json().catch(() => null);
  if (!validatePayload(body)) return c.json({ error: 'payload shape not recognised' }, 400);
  const ingestId = await storeIngest(c.env, body);
  const settings = await loadSettings(c.env);
  const nowLocal = nowLocalIn(settings.rules.timezone);
  const today = nowLocal.slice(0, 10);
  const { dataset } = await loadDataset(c.env, nowLocal);
  await saveSnapshot(c.env, dataset, today, ingestId, settings.rules);
  const { created } = await ensureTasks(c.env, dataset, today, settings.rules);
  return c.json({ ok: true, ingestId, rentals: body.rentals.length, tasksCreated: created, today });
});

// ---------- Login (built-in accounts; see auth.ts) ----------
const isSecure = (c: { req: { url: string } }) => c.req.url.startsWith('https://');

app.get('/api/auth/setup', async (c) => c.json({ needsSetup: (await userCount(c.env)) === 0 }));

// First run only: when no user exists, the first visitor creates the first admin account.
app.post('/api/auth/setup', async (c) => {
  if ((await userCount(c.env)) > 0) return c.json({ error: 'Setup already done' }, 409);
  const body = (await c.req.json()) as { email: string; name: string; password: string };
  const user = await createUser(c.env, { email: body.email, name: body.name, password: body.password, isAdmin: true, by: 'setup' });
  c.header('Set-Cookie', await createSessionCookie(c.env, user.email, isSecure(c)));
  return c.json({ ok: true, user });
});

app.post('/api/auth/login', async (c) => {
  const body = (await c.req.json()) as { email: string; password: string };
  if (!body.email || !body.password) return c.json({ error: 'email and password required' }, 400);
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const user = await login(c.env, body.email, body.password, ip);
  c.header('Set-Cookie', await createSessionCookie(c.env, user.email, isSecure(c)));
  return c.json({ ok: true });
});

app.post('/api/auth/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie(isSecure(c)));
  return c.json({ ok: true });
});

// ---------- Everything below needs a signed-in user ----------
// No session needed (ingest has its own bearer token). /api/auth/password is NOT here: it needs the signed-in user.
const PUBLIC_PATHS = new Set(['/api/ingest', '/api/auth/setup', '/api/auth/login', '/api/auth/logout']);
const MUST_CHANGE_ALLOWED = new Set(['/api/me', '/api/auth/password']);

app.use('/api/*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  const settings = await loadSettings(c.env);
  const me = await identify(c.env, c.req, settings.adminEmails);
  if (!me) throw new AuthError('Not signed in');
  // A user whose password was set by an admin must change it before using anything else.
  if (me.mustChangePassword && !MUST_CHANGE_ALLOWED.has(c.req.path)) return c.json({ error: 'Change your password first' }, 403);
  c.set('me', me);
  await next();
});

app.get('/api/me', (c) => c.json(c.get('me')));

app.post('/api/auth/password', async (c) => {
  const me = c.get('me');
  const body = (await c.req.json()) as { current: string; next: string };
  const u = await getUser(c.env, me.email);
  if (!u) return c.json({ error: 'No local account' }, 400);
  if (!(await verifyPassword(body.current ?? '', u.password_hash))) return c.json({ error: 'Current password is wrong' }, 400);
  await updateUser(c.env, me.email, { password: body.next, mustChange: false });
  return c.json({ ok: true });
});

// Users (admin)
app.get('/api/users', async (c) => { requireAdmin(c); return c.json(await listUsers(c.env)); });
app.post('/api/users', async (c) => {
  requireAdmin(c);
  const body = (await c.req.json()) as { email: string; name: string; password: string; isAdmin?: boolean };
  return c.json(await createUser(c.env, { email: body.email, name: body.name, password: body.password, isAdmin: !!body.isAdmin, by: c.get('me').email, mustChange: true }));
});
app.put('/api/users/:email', async (c) => {
  requireAdmin(c);
  const email = decodeURIComponent(c.req.param('email'));
  const body = (await c.req.json()) as { name?: string; isAdmin?: boolean; active?: boolean; password?: string };
  if (email === c.get('me').email && (body.isAdmin === false || body.active === false)) return c.json({ error: 'You cannot remove your own access' }, 400);
  return c.json(await updateUser(c.env, email, { ...body, mustChange: body.password !== undefined }));
});
app.delete('/api/users/:email', async (c) => {
  requireAdmin(c);
  const email = decodeURIComponent(c.req.param('email'));
  if (email === c.get('me').email) return c.json({ error: 'You cannot delete yourself' }, 400);
  await deleteUser(c.env, email);
  return c.json({ ok: true });
});

app.get('/api/status', async (c) => {
  const settings = await loadSettings(c.env);
  const row = await latestIngest(c.env);
  const sample = !row && c.env.USE_SAMPLE_DATA === 'true';
  const fetchedAt = row?.fetched_at ?? null;
  const ageH = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000 : Infinity;
  const status: Status = {
    fetchedAt,
    source: row ? row.source : sample ? 'sample' : null,
    rentalCount: row ? (await c.env.DB.prepare('SELECT rental_count n FROM ingests WHERE id = ?').bind(row.id).first<{ n: number }>())?.n ?? 0 : 0,
    stale: !sample && ageH > STALE_HOURS,
    today: todayIn(settings.rules.timezone),
    rules: { dueSoonDays: settings.rules.dueSoonDays, timezone: settings.rules.timezone },
  };
  return c.json(status);
});

app.get('/api/data', async (c) => {
  const settings = await loadSettings(c.env);
  const { dataset, receivedAt } = await loadDataset(c.env, nowLocalIn(settings.rules.timezone));
  return c.json({ ...dataset, receivedAt, rules: settings.rules });
});

// "Refresh now": rebuilds today's tasks and snapshot from the latest push. The push itself runs on
// the puller server (the Worker cannot reach Azure SQL). Rate-limited to once a minute.
let lastRefresh = 0;
app.post('/api/refresh', async (c) => {
  if (Date.now() - lastRefresh < 60_000) return c.json({ error: 'Please wait a minute between refreshes' }, 429);
  lastRefresh = Date.now();
  invalidateCache();
  const settings = await loadSettings(c.env);
  const nowLocal = nowLocalIn(settings.rules.timezone);
  const { dataset, ingestId } = await loadDataset(c.env, nowLocal);
  const today = nowLocal.slice(0, 10);
  if (ingestId !== null) await saveSnapshot(c.env, dataset, today, ingestId, settings.rules);
  const { created } = await ensureTasks(c.env, dataset, today, settings.rules);
  return c.json({ ok: true, tasksCreated: created });
});

// ---------- Tasks ----------
app.get('/api/tasks', async (c) => {
  const settings = await loadSettings(c.env);
  const nowLocal = nowLocalIn(settings.rules.timezone);
  const today = nowLocal.slice(0, 10);
  const date = c.req.query('date') ?? today;
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (date === today) {
    const { dataset } = await loadDataset(c.env, nowLocal);
    await ensureTasks(c.env, dataset, today, settings.rules);
  }
  if (from && to) return c.json(await listTasksRange(c.env, from, to));
  return c.json(await listTasks(c.env, date));
});

app.get('/api/tasks/rental/:ra', async (c) => c.json(await tasksForRental(c.env, c.req.param('ra'))));

app.post('/api/tasks', async (c) => {
  const settings = await loadSettings(c.env);
  const body = (await c.req.json()) as { raNumber: string; note?: string | null };
  if (!body.raNumber) return c.json({ error: 'raNumber required' }, 400);
  const today = todayIn(settings.rules.timezone);
  return c.json(await createManualTask(c.env, body.raNumber, today, c.get('me').email, body.note ?? null));
});

app.post('/api/tasks/:id/action', async (c) => {
  const id = Number(c.req.param('id'));
  const body = (await c.req.json()) as TaskAction;
  if (!['start', 'complete', 'snooze', 'reopen', 'assign'].includes(body.action)) return c.json({ error: 'unknown action' }, 400);
  if (body.action === 'complete' && !body.outcome) return c.json({ error: 'outcome required' }, 400);
  if (body.action === 'snooze' && !/^\d{4}-\d{2}-\d{2}$/.test(body.until ?? '')) return c.json({ error: 'until (YYYY-MM-DD) required' }, 400);
  return c.json(await applyTaskAction(c.env, id, body, c.get('me').email));
});

app.get('/api/events', async (c) => {
  const from = c.req.query('from') ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const to = c.req.query('to') ?? new Date(Date.now() + 86_400_000).toISOString();
  return c.json(await listEvents(c.env, from, to));
});

// ---------- Team notes ----------
app.get('/api/notes', async (c) => {
  const ra = c.req.query('ra');
  const q = ra
    ? c.env.DB.prepare('SELECT * FROM notes WHERE ra_number = ? ORDER BY id DESC').bind(ra)
    : c.env.DB.prepare('SELECT * FROM notes ORDER BY id DESC LIMIT 500');
  const res = await q.all<{ id: number; ra_number: string; task_id: number | null; text: string; created_at: string; created_by: string }>();
  const notes: TeamNote[] = res.results.map((n) => ({ id: n.id, raNumber: n.ra_number, taskId: n.task_id, text: n.text, createdAt: n.created_at, createdBy: n.created_by }));
  return c.json(notes);
});

app.post('/api/notes', async (c) => {
  const body = (await c.req.json()) as { raNumber: string; text: string; taskId?: number | null };
  if (!body.raNumber || !body.text?.trim()) return c.json({ error: 'raNumber and text required' }, 400);
  const me = c.get('me');
  const now = new Date().toISOString();
  const res = await c.env.DB.prepare('INSERT INTO notes (ra_number, task_id, text, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(body.raNumber, body.taskId ?? null, body.text.trim(), now, me.email).run();
  if (body.taskId) {
    await c.env.DB.prepare('INSERT INTO task_events (task_id, ra_number, action, detail, at, by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(body.taskId, body.raNumber, 'note', JSON.stringify({ text: body.text.trim() }), now, me.email).run();
  }
  const note: TeamNote = { id: Number(res.meta.last_row_id), raNumber: body.raNumber, taskId: body.taskId ?? null, text: body.text.trim(), createdAt: now, createdBy: me.email };
  return c.json(note);
});

// ---------- History ----------
app.get('/api/history', async (c) => c.json(await listSnapshots(c.env)));

// ---------- Settings (admin) ----------
function requireAdmin(c: { get: (k: 'me') => { isAdmin: boolean } }): void {
  if (!c.get('me').isAdmin) throw new AuthError('Admin only');
}

app.get('/api/settings', async (c) => {
  const settings = await loadSettings(c.env);
  const contacts = await c.env.DB.prepare('SELECT * FROM bodyshop_contacts ORDER BY display_name').all();
  const aliases = await c.env.DB.prepare('SELECT * FROM aliases ORDER BY kind, alias').all();
  return c.json({ rules: settings.rules, adminEmails: settings.adminEmails, contacts: contacts.results, aliases: aliases.results, me: c.get('me') });
});

app.put('/api/settings/rules', async (c) => {
  requireAdmin(c);
  const body = (await c.req.json()) as Record<string, unknown>;
  const me = c.get('me');
  const now = new Date().toISOString();
  const allowed: Record<string, (v: unknown) => string | null> = {
    dueSoonDays: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? String(Number(v)) : null),
    staleExtensionDays: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? String(Number(v)) : null),
    adminEmails: (v) => (typeof v === 'string' ? v : null),
    dueSoonDaysByPayer: (v) => (v && typeof v === 'object' ? JSON.stringify(v) : null),
    taxRateByLocation: (v) => (v && typeof v === 'object' ? JSON.stringify(v) : null),
  };
  const stmts: D1PreparedStatement[] = [];
  for (const [k, conv] of Object.entries(allowed)) {
    if (!(k in body)) continue;
    const v = conv(body[k]);
    if (v === null) return c.json({ error: `invalid value for ${k}` }, 400);
    stmts.push(c.env.DB.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by').bind(k, v, now, me.email));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  invalidateCache();
  return c.json({ ok: true });
});

app.put('/api/settings/contacts/:key', async (c) => {
  requireAdmin(c);
  const body = (await c.req.json()) as { displayName: string; contact?: string | null; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null };
  const key = normalizeKey(c.req.param('key')) || normalizeKey(body.displayName);
  if (!key || !body.displayName) return c.json({ error: 'displayName required' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO bodyshop_contacts (key, display_name, contact, phone, email, address, notes, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET display_name = excluded.display_name, contact = excluded.contact, phone = excluded.phone, email = excluded.email, address = excluded.address, notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(key, body.displayName, body.contact ?? null, body.phone ?? null, body.email ?? null, body.address ?? null, body.notes ?? null, new Date().toISOString(), c.get('me').email).run();
  invalidateCache();
  return c.json({ ok: true, key });
});

app.delete('/api/settings/contacts/:key', async (c) => {
  requireAdmin(c);
  await c.env.DB.prepare('DELETE FROM bodyshop_contacts WHERE key = ?').bind(c.req.param('key')).run();
  invalidateCache();
  return c.json({ ok: true });
});

app.put('/api/settings/aliases', async (c) => {
  requireAdmin(c);
  const body = (await c.req.json()) as { alias: string; canonical: string; kind: 'bodyshop' | 'insurer' };
  const alias = normalizeKey(body.alias);
  if (!alias || !body.canonical || !['bodyshop', 'insurer'].includes(body.kind)) return c.json({ error: 'alias, canonical, kind required' }, 400);
  await c.env.DB.prepare('INSERT INTO aliases (alias, canonical, kind, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical, kind = excluded.kind, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .bind(alias, body.canonical.trim(), body.kind, new Date().toISOString(), c.get('me').email).run();
  invalidateCache();
  return c.json({ ok: true, alias });
});

app.delete('/api/settings/aliases/:alias', async (c) => {
  requireAdmin(c);
  await c.env.DB.prepare('DELETE FROM aliases WHERE alias = ?').bind(c.req.param('alias')).run();
  invalidateCache();
  return c.json({ ok: true });
});

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

// Static assets / SPA fallback handled by the assets binding (run_worker_first only for /api/*).
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // Cron: 07:00 New York. Both UTC hours in wrangler.jsonc fire; only the one that is 07:00 locally does work.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const settings = await loadSettings(env);
    const nowLocal = nowLocalIn(settings.rules.timezone);
    if (nowLocal.slice(11, 13) !== '07') return;
    ctx.waitUntil((async () => {
      const today = nowLocal.slice(0, 10);
      const { dataset, ingestId } = await loadDataset(env, nowLocal);
      if (ingestId !== null) await saveSnapshot(env, dataset, today, ingestId, settings.rules);
      await ensureTasks(env, dataset, today, settings.rules);
    })());
  },
} satisfies ExportedHandler<Env>;
