// Login guard: identity only from our signed cookie; spoofed Access headers are ignored;
// a user who must change their password gets nothing else from the API.
import { describe, expect, it } from 'vitest';
import worker from '../src/worker/index';
import { createSessionCookie, hashPassword } from '../src/worker/auth';
import type { Env } from '../src/worker/env';

interface UserRow {
  email: string; name: string; password_hash: string; is_admin: number; active: number; created_at: string; created_by: string;
  last_login_at: string | null; must_change_pw: number;
}

/** Just enough of D1 for the auth paths: a users table, everything else empty. */
function fakeEnv(users: UserRow[], extra: Partial<Env> = {}): Env {
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async first<T>() {
          if (/FROM users WHERE email/i.test(sql)) return (users.find((u) => u.email === args[0]) ?? null) as T | null;
          if (/COUNT\(\*\) n FROM users/i.test(sql)) return { n: users.length } as T;
          return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() {
          const m = /UPDATE users SET password_hash = \?, must_change_pw = \? WHERE email = \?/i.exec(sql);
          if (m) { const u = users.find((x) => x.email === args[2]); if (u) { u.password_hash = args[0] as string; u.must_change_pw = args[1] as number; } }
          return { meta: { last_row_id: 0 } };
        },
      };
      return stmt;
    },
    async batch() { return []; },
  };
  return { DB: db as unknown as D1Database, ASSETS: {} as Fetcher, SESSION_SECRET: 'test-secret-0123456789abcdef', ADMIN_EMAILS: 'boss@drivo.com', ...extra };
}

async function user(email: string, opts: Partial<UserRow> = {}): Promise<UserRow> {
  return {
    email, name: email.split('@')[0], password_hash: await hashPassword('Password123'), is_admin: 0, active: 1,
    created_at: '2026-11-01T00:00:00Z', created_by: 'test', last_login_at: null, must_change_pw: 0, ...opts,
  };
}

const call = (env: Env, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://dash.example${path}`, init), env, {} as ExecutionContext);

async function cookieFor(env: Env, email: string): Promise<string> {
  return (await createSessionCookie(env, email, true)).split(';')[0];
}

describe('login guard', () => {
  it('ignores a spoofed Cloudflare Access email header', async () => {
    const env = fakeEnv([await user('boss@drivo.com', { is_admin: 1 })]);
    const res = await call(env, '/api/me', { headers: { 'Cf-Access-Authenticated-User-Email': 'boss@drivo.com' } });
    expect(res.status).toBe(401);
    const data = await call(env, '/api/data', { headers: { 'Cf-Access-Authenticated-User-Email': 'boss@drivo.com' } });
    expect(data.status).toBe(401);
  });

  it('accepts a valid session cookie', async () => {
    const env = fakeEnv([await user('ana@drivo.com')]);
    const res = await call(env, '/api/me', { headers: { cookie: await cookieFor(env, 'ana@drivo.com') } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe('ana@drivo.com');
  });

  it('rejects a cookie signed with another secret, and a deactivated user', async () => {
    const env = fakeEnv([await user('ana@drivo.com'), await user('old@drivo.com', { active: 0 })]);
    const forged = await cookieFor({ ...env, SESSION_SECRET: 'some-other-secret-0123456789' }, 'ana@drivo.com');
    expect((await call(env, '/api/me', { headers: { cookie: forged } })).status).toBe(401);
    expect((await call(env, '/api/me', { headers: { cookie: await cookieFor(env, 'old@drivo.com') } })).status).toBe(401);
  });

  it('a user who must change the password only gets /api/me and the password change', async () => {
    const env = fakeEnv([await user('new@drivo.com', { must_change_pw: 1 })]);
    const cookie = await cookieFor(env, 'new@drivo.com');
    expect((await call(env, '/api/me', { headers: { cookie } })).status).toBe(200);
    expect((await call(env, '/api/data', { headers: { cookie } })).status).toBe(403);
    expect((await call(env, '/api/tasks', { headers: { cookie } })).status).toBe(403);
    const change = await call(env, '/api/auth/password', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ current: 'Password123', next: 'NewPassword456' }),
    });
    expect(change.status).toBe(200);
    const me = (await (await call(env, '/api/me', { headers: { cookie } })).json()) as { mustChangePassword: boolean };
    expect(me.mustChangePassword).toBe(false);
  });

  it('the password change needs a signed-in user', async () => {
    const env = fakeEnv([await user('ana@drivo.com')]);
    const res = await call(env, '/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current: 'x', next: 'y' }) });
    expect(res.status).toBe(401);
  });
});
