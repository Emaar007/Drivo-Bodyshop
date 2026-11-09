// Built-in login: email + password accounts managed by admins inside the dashboard, HMAC-signed
// HttpOnly cookie sessions. Replaces Cloudflare Access (which needs a card on file). If Access is
// ever put in front, its Cf-Access-Authenticated-User-Email header is still honoured.
import type { Env } from './env';
import type { Me, User } from '@shared/types';

const SESSION_COOKIE = 'drivo_session';
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100_000;
const MAX_ATTEMPTS = 8; // per email and per IP, per 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60_000;

export class AuthError extends Error {}

interface ReqLike {
  header(name: string): string | undefined;
}

// ---------- Password hashing (WebCrypto PBKDF2-SHA256) ----------

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number';
  return null;
}

// ---------- Sessions ----------

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function secretOf(env: Env): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET is not set (wrangler secret put SESSION_SECRET)');
  return s;
}

export async function createSessionCookie(env: Env, email: string, secure: boolean): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = btoa(JSON.stringify({ e: email, x: exp })).replace(/=+$/, '');
  const sig = await hmac(secretOf(env), payload);
  const value = `${payload}.${sig}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

async function readSession(env: Env, req: ReqLike): Promise<string | null> {
  const cookie = req.header('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  if ((await hmac(secretOf(env), payload)) !== sig) return null;
  try {
    const { e, x } = JSON.parse(atob(payload)) as { e: string; x: number };
    if (typeof e !== 'string' || typeof x !== 'number' || x < Date.now()) return null;
    return e.toLowerCase();
  } catch {
    return null;
  }
}

// ---------- Users ----------

interface UserRow {
  email: string; name: string; password_hash: string; is_admin: number; active: number; created_at: string; created_by: string; last_login_at: string | null; must_change_pw: number;
}

function rowToUser(r: UserRow): User {
  return { email: r.email, name: r.name, isAdmin: !!r.is_admin, active: !!r.active, createdAt: r.created_at, createdBy: r.created_by, lastLoginAt: r.last_login_at, mustChangePassword: !!r.must_change_pw };
}

export async function getUser(env: Env, email: string): Promise<UserRow | null> {
  return (await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first<UserRow>()) ?? null;
}

export async function listUsers(env: Env): Promise<User[]> {
  const res = await env.DB.prepare('SELECT * FROM users ORDER BY name').all<UserRow>();
  return res.results.map(rowToUser);
}

export async function userCount(env: Env): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>())?.n ?? 0;
}

export async function createUser(env: Env, u: { email: string; name: string; password: string; isAdmin: boolean; by: string; mustChange?: boolean }): Promise<User> {
  const email = u.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError('Invalid email');
  const problem = passwordProblem(u.password);
  if (problem) throw new AuthError(problem);
  const hash = await hashPassword(u.password);
  await env.DB.prepare('INSERT INTO users (email, name, password_hash, is_admin, active, created_at, created_by, must_change_pw) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
    .bind(email, u.name.trim() || email.split('@')[0], hash, u.isAdmin ? 1 : 0, new Date().toISOString(), u.by, u.mustChange ? 1 : 0).run();
  return rowToUser((await getUser(env, email))!);
}

export async function updateUser(env: Env, email: string, patch: { name?: string; isAdmin?: boolean; active?: boolean; password?: string; mustChange?: boolean }): Promise<User> {
  const u = await getUser(env, email);
  if (!u) throw new AuthError('User not found');
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name.trim()); }
  if (patch.isAdmin !== undefined) { sets.push('is_admin = ?'); vals.push(patch.isAdmin ? 1 : 0); }
  if (patch.active !== undefined) { sets.push('active = ?'); vals.push(patch.active ? 1 : 0); }
  if (patch.password !== undefined) {
    const problem = passwordProblem(patch.password);
    if (problem) throw new AuthError(problem);
    sets.push('password_hash = ?'); vals.push(await hashPassword(patch.password));
    sets.push('must_change_pw = ?'); vals.push(patch.mustChange ? 1 : 0);
  }
  if (!sets.length) return rowToUser(u);
  vals.push(email.toLowerCase());
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE email = ?`).bind(...vals).run();
  return rowToUser((await getUser(env, email))!);
}

export async function deleteUser(env: Env, email: string): Promise<void> {
  await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email.toLowerCase()).run();
}

// ---------- Login ----------

async function tooManyAttempts(env: Env, key: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT count, first_at FROM login_attempts WHERE key = ?').bind(key).first<{ count: number; first_at: string }>();
  if (!row) return false;
  if (Date.now() - new Date(row.first_at).getTime() > ATTEMPT_WINDOW_MS) {
    await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
    return false;
  }
  return row.count >= MAX_ATTEMPTS;
}

async function recordAttempt(env: Env, key: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO login_attempts (key, count, first_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1',
  ).bind(key, new Date().toISOString()).run();
}

export async function login(env: Env, email: string, password: string, ip: string): Promise<User> {
  const e = email.trim().toLowerCase();
  if (await tooManyAttempts(env, `e:${e}`) || await tooManyAttempts(env, `ip:${ip}`)) throw new AuthError('Too many attempts, try again in 15 minutes');
  const u = await getUser(env, e);
  const ok = u && u.active && (await verifyPassword(password, u.password_hash));
  if (!ok) {
    await Promise.all([recordAttempt(env, `e:${e}`), recordAttempt(env, `ip:${ip}`)]);
    throw new AuthError('Wrong email or password');
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET last_login_at = ? WHERE email = ?').bind(new Date().toISOString(), e),
    env.DB.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').bind(`e:${e}`, `ip:${ip}`),
  ]);
  return rowToUser(u);
}

// ---------- Identity for a request ----------

export async function identify(env: Env, req: ReqLike, adminEmails: string[]): Promise<Me | null> {
  // 1. Cloudflare Access, if it is ever enabled in front of the Worker.
  const accessEmail = req.header('cf-access-authenticated-user-email')?.toLowerCase();
  if (accessEmail) {
    const u = await getUser(env, accessEmail);
    return { email: accessEmail, name: u?.name ?? nameOf(accessEmail), isAdmin: !!u?.is_admin || adminEmails.includes(accessEmail), mustChangePassword: false };
  }
  // 2. Our own session cookie.
  const email = await readSession(env, req);
  if (email) {
    const u = await getUser(env, email);
    if (u && u.active) return { email: u.email, name: u.name, isAdmin: !!u.is_admin || adminEmails.includes(u.email), mustChangePassword: !!u.must_change_pw };
    return null;
  }
  // 3. Local development without a login.
  if (env.DEV === 'true') {
    const email = (req.header('x-dev-user') ?? 'dev@drivo.com').toLowerCase();
    return { email, name: nameOf(email), isAdmin: true, mustChangePassword: false };
  }
  return null;
}

export function nameOf(email: string): string {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
