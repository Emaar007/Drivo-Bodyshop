// Pull the hourly TSD extract from the corporate portal (corporate.drivo.com) and load it, so no one has to
// run scripts/tsd/pull_extract.mjs by hand. The portal's server is on the TSD Azure SQL firewall and runs this
// repo's read-only puller every hour at :20; the Worker never talks to TSD itself.
import type { TsdPayload } from '@shared/types';
import { validatePayload } from './data';

export const DEFAULT_EXTRACT_URL = 'https://corporate.drivo.com/api/bodyshop/extract';

export class ExtractError extends Error {}

/** Download and check the extract. Throws ExtractError with a message fit for the UI / logs. */
export async function fetchExtract(url: string, token: string, fetchImpl: typeof fetch = fetch): Promise<TsdPayload> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'drivo-bodyshop-dashboard/1.0' } });
  } catch (e) {
    throw new ExtractError(`Could not reach the corporate portal: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401 || res.status === 403) throw new ExtractError(`The corporate portal refused the extract token (${res.status})`);
  if (!res.ok) throw new ExtractError(`The corporate portal answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ExtractError('The corporate portal sent something that is not JSON');
  }
  if (!validatePayload(body)) throw new ExtractError('The extract from the corporate portal is not in the expected shape');
  return body;
}

/** Only store an extract TSD produced after the one we already have (the portal refreshes once an hour). */
export function isNewer(payload: Pick<TsdPayload, 'fetchedAt'>, lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return true;
  const a = Date.parse(payload.fetchedAt);
  const b = Date.parse(lastFetchedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return payload.fetchedAt !== lastFetchedAt;
  return a > b;
}
