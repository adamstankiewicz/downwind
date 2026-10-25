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
  | { ok: false; reason: 'unavailable' | 'busy' | 'failed' | 'limit' };

/** Questions one device may ask in a day. Keeps the bill small; the worker also limits bursts per address. */
export const DAILY_LIMIT = 30;
const COUNT_KEY = 'downwind.ask.count.v1';

const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** Questions asked on this device today. */
export function askedToday(now = new Date()): number {
  try {
    const c = JSON.parse(localStorage.getItem(COUNT_KEY) ?? 'null') as { day?: string; n?: number } | null;
    return c?.day === today(now) ? c.n ?? 0 : 0;
  } catch {
    return 0;
  }
}

function countAsk(now = new Date()) {
  try {
    localStorage.setItem(COUNT_KEY, JSON.stringify({ day: today(now), n: askedToday(now) + 1 }));
  } catch {
    // Private mode: no count, and the worker's limit still applies.
  }
}

export async function askInstructor(req: AskRequest, signal?: AbortSignal): Promise<AskResult> {
  if (askedToday() >= DAILY_LIMIT) return { ok: false, reason: 'limit' };
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
    if (reply) countAsk();
    return reply ? { ok: true, reply } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** For tests: forget the availability answer. */
export function resetAskAvailability() {
  available = null;
}
