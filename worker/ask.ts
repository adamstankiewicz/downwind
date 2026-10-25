// POST /api/ask: one question from a pilot in a lesson, answered by Claude.
// GET /api/ask says whether the feature is on. It is on only when the worker
// has the ANTHROPIC_API_KEY secret; without it the app hides the feature.
//
// Cost: the cheapest current model with thinking off; the system prompt is
// the same on every request and cached; the lesson context is short; answers
// are capped; identical questions on the same step are served from the edge
// cache for a day; and an optional rate limit caps bursts per address.

import Anthropic from '@anthropic-ai/sdk';
import { MAX_FOLLOWUPS, MAX_QUESTION, REPLY_SCHEMA, parseReply, systemPrompt, userMessage, type AskRequest } from '../src/ask/context';

export interface AskEnv {
  ANTHROPIC_API_KEY?: string;
  /** Optional override of the model id. */
  ASK_MODEL?: string;
  /** Optional comma-separated origins allowed to ask, such as the app's own. Unset allows any. */
  ASK_ORIGINS?: string;
  /** Optional Workers rate limit binding (wrangler.toml [[ratelimits]]), keyed by client address. */
  ASK_LIMIT?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 400;
const ANSWER_CACHE_SECONDS = 24 * 60 * 60;
const MAX_BODY = 16_000;

type Create = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export async function handleAsk(request: Request, env: AskEnv, create?: Create): Promise<Response> {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const on = Boolean(env.ANTHROPIC_API_KEY);
  if (request.method === 'GET') return json({ available: on }, 200, cors);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, cors);
  if (!on) return json({ error: 'Ask the instructor is not set up on this server.' }, 503, cors);
  if (origin && !allowed(origin, env)) return json({ error: 'Not allowed from this origin.' }, 403, cors);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too long.' }, 413, cors);
  const req = validRequest(text);
  if (!req) return json({ error: 'Not a question.' }, 400, cors);

  const model = env.ASK_MODEL || MODEL;
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const key = new Request(`https://ask.cache/${model}/${await sha256(JSON.stringify(req))}`);
  const hit = await cache?.match(key);
  if (hit) return withHeaders(hit, cors);

  if (env.ASK_LIMIT) {
    const who = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await env.ASK_LIMIT.limit({ key: who })).success) return json({ error: 'Busy. Try again in a minute.' }, 429, cors);
  }

  const call = create ?? ((p) => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages.create(p));
  let message: Anthropic.Message;
  try {
    message = await call({
      model,
      max_tokens: MAX_TOKENS,
      // A short explanation from context does not need reasoning tokens.
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage(req) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Busy. Try again in a minute.' }, 429, cors);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'Ask the instructor is not set up on this server.' }, 503, cors);
    return json({ error: 'The instructor could not answer.' }, 502, cors);
  }
  if (message.stop_reason === 'refusal') {
    return json({ answer: 'I can only help with this lesson. Try asking about the step in front of you.', refs: [] }, 200, cors);
  }
  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  let reply = null;
  try {
    reply = parseReply(JSON.parse(textBlock?.text ?? ''));
  } catch {
    reply = null;
  }
  if (!reply) return json({ error: 'The instructor could not answer.' }, 502, cors);

  const out = json(reply, 200, cors);
  if (cache) {
    const stored = json(reply, 200, { 'Cache-Control': `public, max-age=${ANSWER_CACHE_SECONDS}` });
    await cache.put(key, stored);
  }
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
