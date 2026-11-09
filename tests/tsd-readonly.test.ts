// Guard: the TSD client must never be able to change TSD data.
// The push script runs scripts/tsd/bodyshop.sql with a read-only connection; this test fails the
// build if anyone adds a write statement to that file or drops the read-only flag.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../scripts/tsd/bodyshop.sql', import.meta.url), 'utf-8');
const py = readFileSync(new URL('../scripts/tsd/push_bodyshop.py', import.meta.url), 'utf-8');

function statements(text: string): string[] {
  // strip comments, split on semicolons
  const noComments = text.replace(/--[^\n]*/g, '');
  return noComments.split(';').map((s) => s.trim()).filter(Boolean);
}

describe('TSD access is read-only', () => {
  it('bodyshop.sql contains only SELECT / SET / DECLARE / temp-table statements', () => {
    for (const st of statements(sql)) {
      const first = st.split(/\s+/)[0].toUpperCase();
      const ok =
        ['SELECT', 'SET', 'DECLARE', 'WITH'].includes(first) ||
        /^IF OBJECT_ID\('tempdb\.\.#\w+'\) IS NOT NULL DROP TABLE #\w+$/i.test(st);
      expect(ok, `unexpected statement: ${st.slice(0, 80)}`).toBe(true);
    }
  });
  it('bodyshop.sql has no write keywords outside temp tables', () => {
    const upper = sql.replace(/--[^\n]*/g, '').toUpperCase();
    for (const kw of ['INSERT ', 'UPDATE ', 'DELETE ', 'MERGE ', 'TRUNCATE ', 'ALTER ', 'CREATE TABLE', 'EXEC ', 'EXECUTE ', 'DROP TABLE CRA', 'DROP TABLE CPAY']) {
      expect(upper.includes(kw), `found ${kw.trim()} in bodyshop.sql`).toBe(false);
    }
    // the only INTO is a SELECT INTO a temp table
    for (const m of upper.matchAll(/INTO\s+(\S+)/g)) expect(m[1].startsWith('#')).toBe(true);
  });
  it('the push script opens a read-only connection and only uses GET-free HTTP (POST to our own API)', () => {
    expect(py).toMatch(/read_only=True/);
    expect(py).not.toMatch(/cur(sor)?\.execute\([^)]*(INSERT|UPDATE|DELETE)/i);
    expect(py).not.toMatch(/conn\.commit\(/);
  });
});
