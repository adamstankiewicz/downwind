import { describe, expect, it } from 'vitest';
import { KASH } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { lessonContext } from '../../course/practice';
import { emptyAnswers } from '../../course/progress';
import { modules } from '../../course/modules';
import { resolvesToSource } from '../../refs/resolve';
import { askContext, askRequest, citableRefs, parseReply, systemPrompt, userMessage, MAX_QUESTION } from '../context';
import { handleAsk } from '../../../worker/ask';
import type Anthropic from '@anthropic-ai/sdk';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const lessons = modules.flatMap((m) => m.lessons);
const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with an airplane', lessonContext(KASH, sampleC172K, mins, NOW)],
] as const;

describe.each(contexts)('ask context: %s', (_name, ctx) => {
  it.each(lessons.map((l) => [l.id, l] as const))('%s keeps answers out until the pilot commits', (_id, lesson) => {
    for (const step of lesson.build(ctx)) {
      const hidden = JSON.stringify(askContext(lesson, step, ctx, emptyAnswers(), false));
      expect(hidden).not.toMatch(/"grade"|"answer"|"bestCalls"|"instructorWhy"|"consequence"/);
      expect(hidden.length).toBeLessThan(12_000);
    }
  });
});

describe('ask context', () => {
  const ctx = contexts[0][1];
  const lesson = lessons[0];
  const decide = lessons.flatMap((l) => l.build(ctx).map((s) => [l, s] as const)).find(([, s]) => s.kind === 'decide')!;

  it('names the practice field and leaves the airplane out when there is none', () => {
    const c = askContext(lesson, lesson.build(ctx)[0], ctx, emptyAnswers(), false);
    expect(c.field.practice).toBe(true);
    expect(c.field.icao).toBe('KXYZ');
    expect(c.airplane).toBeNull();
  });

  it('adds the pick, its grade and the best call once committed', () => {
    const [l, s] = decide;
    if (s.kind !== 'decide') throw new Error('not a decision');
    const answers = { ...emptyAnswers(), decisions: { [s.id]: { choice: s.options[0].id } } };
    const c = askContext(l, s, ctx, answers, true);
    expect(c.step.pilotChose).toBe(s.options[0].label);
    expect(c.step.grade).toBe(s.grades[s.options[0].id]);
  });

  it('trims the question and keeps the last few turns', () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    const r = askRequest(`  ${'x'.repeat(MAX_QUESTION + 50)} `, turns, askContext(lesson, lesson.build(ctx)[0], ctx, emptyAnswers(), false));
    expect(r.question.length).toBe(MAX_QUESTION);
    expect(r.earlier.map((t) => t.question)).toEqual(['q3', 'q4', 'q5']);
    expect(userMessage(r)).toContain("Pilot's question:");
  });
});

describe('references', () => {
  it('keeps only labels the resolver opens', () => {
    expect(citableRefs(['14 CFR 91.155(c)', 'AIM 7-1', 'PHAK ch. 11', 'PHAK, hypoxia', 'Some blog', 'POH section 4', 'AIM 7-1', 3])).toEqual([
      '14 CFR 91.155(c)', 'AIM 7-1', 'PHAK ch. 11', 'PHAK, hypoxia',
    ]);
    expect(citableRefs('AIM 7-1')).toEqual([]);
  });

  it('lists only passages that resolve in the system prompt', () => {
    const listed = systemPrompt().split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));
    expect(listed.length).toBeGreaterThan(10);
    for (const l of listed) expect(resolvesToSource(l), l).toBe(true);
  });

  it('does not change between requests, so it caches', () => {
    expect(systemPrompt()).toBe(systemPrompt());
    expect(systemPrompt()).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('parses a reply and refuses an empty one', () => {
    expect(parseReply({ answer: ' Look at the gust spread. ', refs: ['Nope', 'AIM 7-1'] })).toEqual({ answer: 'Look at the gust spread.', refs: ['AIM 7-1'] });
    expect(parseReply({ answer: '', refs: [] })).toBeNull();
    expect(parseReply('hi')).toBeNull();
  });
});

describe('worker /api/ask', () => {
  const ctx = contexts[1][1];
  const lesson = lessons[0];
  const body = JSON.stringify(askRequest('Why does the gust matter?', [], askContext(lesson, lesson.build(ctx)[0], ctx, emptyAnswers(), false)));
  const post = (b = body) => new Request('https://w/api/ask', { method: 'POST', body: b, headers: { 'Content-Type': 'application/json' } });
  const reply = (text: string, stop: Anthropic.Beta.BetaMessage['stop_reason'] = 'end_turn') =>
    ({ content: [{ type: 'text', text, citations: null }], stop_reason: stop } as unknown as Anthropic.Beta.BetaMessage);

  it('says it is off and refuses questions without a key', async () => {
    expect(await (await handleAsk(new Request('https://w/api/ask'), {})).json()).toEqual({ available: false });
    expect((await handleAsk(post(), {})).status).toBe(503);
  });

  it('answers with a cached system prompt and filtered refs', async () => {
    let sent: Anthropic.Beta.MessageCreateParamsNonStreaming | null = null;
    const res = await handleAsk(post(), { ANTHROPIC_API_KEY: 'k' }, async (p) => {
      sent = p;
      return reply(JSON.stringify({ answer: 'Because the spread is what you fly in the flare.', refs: ['AIM 7-1', 'made up'] }));
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: 'Because the spread is what you fly in the flare.', refs: ['AIM 7-1'] });
    const p = sent as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming;
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBeLessThanOrEqual(1024);
    expect(p.system).toEqual([{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }]);
    expect(p.output_config?.effort).toBe('low');
  });

  it('rejects junk, long questions and refusals without crashing', async () => {
    const key = { ANTHROPIC_API_KEY: 'k' };
    const never = async () => { throw new Error('should not call'); };
    expect((await handleAsk(post('not json'), key, never)).status).toBe(400);
    expect((await handleAsk(post(JSON.stringify({ question: 'x'.repeat(MAX_QUESTION + 1), context: {} })), key, never)).status).toBe(400);
    const refused = await handleAsk(post(), key, async () => reply('', 'refusal'));
    expect(refused.status).toBe(200);
    expect((await refused.json() as { refs: string[] }).refs).toEqual([]);
    expect((await handleAsk(post(), key, async () => reply('not json'))).status).toBe(502);
  });
});
