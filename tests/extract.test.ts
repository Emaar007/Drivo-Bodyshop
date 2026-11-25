// Hourly pull of the TSD extract from the corporate portal (src/worker/extract.ts).
import { describe, expect, it } from 'vitest';
import { ExtractError, fetchExtract, isNewer } from '../src/worker/extract';
import sample from '../data/sample.json';

const URL_ = 'https://portal.example/api/bodyshop/extract';

function fakeFetch(status: number, body: unknown, seen?: { auth?: string | null; url?: string }): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (seen) { seen.url = String(url); seen.auth = new Headers(init?.headers).get('authorization'); }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe('fetchExtract', () => {
  it('downloads with the bearer token and returns a valid payload', async () => {
    const seen: { auth?: string | null; url?: string } = {};
    const p = await fetchExtract(URL_, 'tok-123', fakeFetch(200, sample, seen));
    expect(seen.url).toBe(URL_);
    expect(seen.auth).toBe('Bearer tok-123');
    expect(p.rentals.length).toBe(sample.rentals.length);
  });

  it('explains a refused token', async () => {
    await expect(fetchExtract(URL_, 'bad', fakeFetch(401, { error: 'no' }))).rejects.toThrow(/refused the extract token \(401\)/);
  });

  it('passes on other portal errors, e.g. no extract yet', async () => {
    await expect(fetchExtract(URL_, 't', fakeFetch(503, 'no extract yet'))).rejects.toThrow(/503: no extract yet/);
  });

  it('rejects non-JSON and payloads of the wrong shape', async () => {
    await expect(fetchExtract(URL_, 't', fakeFetch(200, '<html>login</html>'))).rejects.toBeInstanceOf(ExtractError);
    await expect(fetchExtract(URL_, 't', fakeFetch(200, { fetchedAt: '2026-11-25T14:20:06Z', rentals: [] }))).rejects.toThrow(/expected shape/);
  });

  it('reports a network failure', async () => {
    const down = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await expect(fetchExtract(URL_, 't', down)).rejects.toThrow(/Could not reach the corporate portal: fetch failed/);
  });
});

describe('isNewer', () => {
  it('loads the first extract and only later ones after that', () => {
    expect(isNewer({ fetchedAt: '2026-11-25T14:20:06Z' }, null)).toBe(true);
    expect(isNewer({ fetchedAt: '2026-11-25T15:20:04Z' }, '2026-11-25T14:20:06Z')).toBe(true);
    expect(isNewer({ fetchedAt: '2026-11-25T14:20:06Z' }, '2026-11-25T14:20:06Z')).toBe(false);
    expect(isNewer({ fetchedAt: '2026-11-25T13:20:00Z' }, '2026-11-25T14:20:06Z')).toBe(false);
  });
});
