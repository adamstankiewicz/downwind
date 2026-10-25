// POST /api/ask: one question from a pilot in a lesson, answered by a model
// behind the AskModel interface (worker/models), Claude by default.
// GET /api/ask says whether the feature is on. It is on only when the worker
// has the ANTHROPIC_API_KEY secret; without it the app hides the feature.
//
// Every model must pass the eval suite (evals/ask) before it is configured here.
//
// Routing: Haiku answers most questions. The questions it gets wrong too
// often in the evals (see needsStrong) go to Sonnet, about 20 times the price.
//
// Cost: the cheapest current model with thinking off for most questions; the system prompt is
// the same on every request and cached; the lesson context is short; answers
// are capped; identical questions on the same step are served from the edge
// cache for a day; and an optional rate limit caps bursts per address.

import { MAX_FOLLOWUPS, MAX_QUESTION, REPLY_SCHEMA, parseReply, systemPrompt, userMessage, type AskRequest } from '../src/ask/context';
import { anthropicModel } from './models/anthropic';
import { routedModel } from './models/router';
import { ModelError, type AskModel } from './models/types';

export interface AskEnv {
  ANTHROPIC_API_KEY?: string;
  /** Optional override of the model for most questions, such as `claude-haiku-5-5` or `claude-haiku-5-5+think`. */
  ASK_MODEL?: string;
  /** Optional override of the model for the hard questions; `none` sends every question to ASK_MODEL. */
  ASK_STRONG_MODEL?: string;
  /** Optional comma-separated origins allowed to ask, such as the app's own. Unset allows any. */
  ASK_ORIGINS?: string;
  /** Optional Workers rate limit binding (wrangler.toml [[ratelimits]]), keyed by client address. */
  ASK_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const MAX_TOKENS = 400;
const ANSWER_CACHE_SECONDS = 24 * 60 * 60;
const MAX_BODY = 16_000;
const UNAVAILABLE = 'Ask the instructor is not set up on this server.';
const COULD_NOT = 'The instructor could not answer.';

export const DEFAULT_STRONG_MODEL = 'claude-sonnet-5-5';

/** The model the worker is configured with, or null when it has none. */
export function configuredModel(env: AskEnv): AskModel | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  const cheap = anthropicModel(env.ANTHROPIC_API_KEY, env.ASK_MODEL || undefined);
  const strong = env.ASK_STRONG_MODEL || DEFAULT_STRONG_MODEL;
  return strong === 'none' ? cheap : routedModel(cheap, anthropicModel(env.ANTHROPIC_API_KEY, strong));
}

/**
 * Questions the cheap model should not answer: a decision not yet committed or
 * blanks not yet checked, where a slip gives the answer away.
 */
export function needsStrong(req: AskRequest): boolean {
  const step = req.context.step as { kind?: string; committed?: boolean; checked?: boolean };
  return (step.kind === 'decide' && !step.committed) || (step.kind === 'turn' && !step.checked);
}

/** `model` is for tests and evals; production uses the configured one. */
export async function handleAsk(request: Request, env: AskEnv, model: AskModel | null = configuredModel(env)): Promise<Response> {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET') return json({ available: model !== null }, 200, cors);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, cors);
  if (!model) return json({ error: UNAVAILABLE }, 503, cors);
  if (origin && !allowed(origin, env)) return json({ error: 'Not allowed from this origin.' }, 403, cors);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too long.' }, 413, cors);
  const req = validRequest(text);
  if (!req) return json({ error: 'Not a question.' }, 400, cors);

  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const key = new Request(`https://ask.cache/${encodeURIComponent(model.id)}/${needsStrong(req) ? 's' : 'c'}/${await sha256(JSON.stringify(req))}`);
  const hit = await cache?.match(key);
  if (hit) return withHeaders(hit, cors);

  if (env.ASK_LIMIT) {
    const who = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await env.ASK_LIMIT.limit({ key: who })).success) return json({ error: 'Busy. Try again in a minute.' }, 429, cors);
  }

  let result;
  try {
    result = await model.complete({ system: systemPrompt(), user: userMessage(req), schema: REPLY_SCHEMA, maxTokens: MAX_TOKENS, strong: needsStrong(req) });
  } catch (e) {
    const reason = e instanceof ModelError ? e.reason : 'failed';
    if (reason === 'busy') return json({ error: 'Busy. Try again in a minute.' }, 429, cors);
    if (reason === 'auth') return json({ error: UNAVAILABLE }, 503, cors);
    return json({ error: COULD_NOT }, 502, cors);
  }
  if (result.kind === 'refused') {
    return json({ answer: 'I can only help with this lesson. Try asking about the step in front of you.', refs: [] }, 200, cors);
  }
  let reply = null;
  try {
    reply = parseReply(JSON.parse(result.text));
  } catch {
    reply = null;
  }
  if (!reply) return json({ error: COULD_NOT }, 502, cors);

  const out = json(reply, 200, cors);
  if (cache) await cache.put(key, json(reply, 200, { 'Cache-Control': `public, max-age=${ANSWER_CACHE_SECONDS}` }));
  return out;
}

function validRequest(text: string): AskRequest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as Partial<AskRequest>;
  if (typeof r?.question !== 'string' || !r.question.trim() || r.question.length > MAX_QUESTION) return null;
  if (!r.context || typeof r.context !== 'object') return null;
  const earlier = Array.isArray(r.earlier)
    ? r.earlier
        .filter((t) => t && typeof t.question === 'string' && typeof t.answer === 'string')
        .slice(-MAX_FOLLOWUPS)
        .map((t) => ({ question: t.question.slice(0, MAX_QUESTION), answer: t.answer.slice(0, 1200) }))
    : [];
  return { question: r.question.trim(), earlier, context: r.context };
}

function allowed(origin: string, env: AskEnv): boolean {
  if (!env.ASK_ORIGINS) return true;
  return env.ASK_ORIGINS.split(',').map((s) => s.trim()).includes(origin);
}

function corsHeaders(origin: string | null, env: AskEnv): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && allowed(origin, env) ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
