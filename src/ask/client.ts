// Talks to /api/ask on the edge worker. The feature is optional: when the
// worker has no API key, or there is no worker at all (dev, offline), the app
// hides Ask the instructor rather than show something that cannot answer.

import { parseReply, type AskReply, type AskRequest } from './context';

const BASE = (import.meta.env?.VITE_ASK_BASE as string | undefined) ?? '/api/ask';

let available: Promise<boolean> | null = null;

/** Asked once per session. */
export function askAvailable(): Promise<boolean> {
  available ??= fetch(BASE, { method: 'GET', headers: { Accept: 'application/json' } })
    .then(async (res) => res.ok && (await res.json() as { available?: unknown }).available === true)
    .catch(() => false);
  return available;
}

export type AskResult =
  | { ok: true; reply: AskReply }
  | { ok: false; reason: 'unavailable' | 'busy' | 'failed' };

export async function askInstructor(req: AskRequest, signal?: AbortSignal): Promise<AskResult> {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (res.status === 503 || res.status === 501) {
      available = Promise.resolve(false);
      return { ok: false, reason: 'unavailable' };
    }
    if (res.status === 429) return { ok: false, reason: 'busy' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    const reply = parseReply(await res.json());
    return reply ? { ok: true, reply } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** For tests: forget the availability answer. */
export function resetAskAvailability() {
  available = null;
}
