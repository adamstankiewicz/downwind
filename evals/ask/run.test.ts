// Runs the Ask the instructor eval. Off unless ASK_EVAL_MODELS is set:
//
//   ASK_EVAL_MODELS=anthropic:claude-haiku-5-5,local:onnx-community/Qwen2.5-1.5B-Instruct npm run eval:ask
//
// Each case goes through the worker's real handler with the real prompt; the
// model is wrapped only to keep its raw output and token use. Results land in
// evals/ask/results/<time>/ (results.jsonl, errors.jsonl, summary.md). The
// run fails when any model breaks a hard check (format, leaks, grading,
// unsafe advice, invented numbers), so a model that fails here does not ship.
// The judge runs too when ANTHROPIC_API_KEY is set (ASK_EVAL_JUDGE=0 skips it).

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleAsk } from '../../worker/ask';
import type { AskModel, ModelResult } from '../../worker/models/types';
import { builtCases, type BuiltCase } from './cases';
import { gradeCase, hardPassed, parseOutput, passed, type Check } from './grade';
import { costOf, makeModel } from './providers';
import { CRITERIA, JUDGE_MODEL, judge, judgeAvailable, type Criterion, type Verdict } from './judge';

const SPECS = (process.env.ASK_EVAL_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const REPS = Number(process.env.ASK_EVAL_REPS ?? 1);
const ONLY = process.env.ASK_EVAL_CASES?.split(',');

interface Row {
  model: string;
  case: string;
  category: string;
  rep: number;
  question: string;
  raw: string;
  answer: string | null;
  refs: string[];
  servedBy?: string;
  stop?: string;
  prodStatus: number;
  checks: Check[];
  pass: boolean;
  hardPass: boolean;
  verdict?: Verdict;
  judgeCost?: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
}

// Judge answers saved by an earlier run (results.jsonl paths, comma-separated),
// without running the models again. For runs made where no key was set.
const REJUDGE = (process.env.ASK_EVAL_REJUDGE ?? '').split(',').map((s) => s.trim()).filter(Boolean);

describe.skipIf(REJUDGE.length === 0)('Ask the instructor eval, judging saved answers', () => {
  it('judges every saved answer', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(import.meta.dirname, 'results', `${stamp}-rejudged`);
    mkdirSync(dir, { recursive: true });
    const byId = new Map(builtCases().map((c) => [c.id, c]));
    const rows: Row[] = [];
    for (const path of REJUDGE) {
      for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
        const row = JSON.parse(line) as Row;
        const c = byId.get(row.case);
        if (!c) continue;
        // Re-grade with today's checks, then judge.
        row.checks = gradeCase(c, { raw: row.raw, answer: row.answer, offeredRefs: row.refs });
        row.pass = passed(row.checks);
        row.hardPass = hardPassed(row.checks);
        if (row.answer) {
          const j = await judge(c, row.answer);
          row.verdict = j.verdict;
          row.judgeCost = costOf(`anthropic:${JUDGE_MODEL}`, { kind: 'text', text: '', usage: { inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens, cacheReadTokens: j.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: j.usage.cache_creation_input_tokens ?? 0 } });
        }
        rows.push(row);
        appendFileSync(join(dir, 'results.jsonl'), `${JSON.stringify(row)}\n`);
      }
    }
    writeFileSync(join(dir, 'summary.md'), summarize(rows, byId.size));
    console.log(summarize(rows, byId.size));
  }, 6 * 60 * 60 * 1000);
});

describe.skipIf(SPECS.length === 0)('Ask the instructor eval', () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(import.meta.dirname, 'results', stamp);
  const rows: Row[] = [];
  const cases = builtCases().filter((c) => !ONLY || ONLY.includes(c.id));

  it('runs every model on every case', async () => {
    mkdirSync(dir, { recursive: true });
    for (const spec of SPECS) {
      let current: BuiltCase = cases[0];
      const inner = await makeModel(spec, () => current);
      for (const c of cases) {
        current = c;
        for (let rep = 0; rep < REPS; rep++) {
          let last: ModelResult | null = null;
          let ms = 0;
          const wrapped: AskModel = {
            id: inner.id,
            complete: async (p) => {
              const t = performance.now();
              last = await inner.complete(p);
              ms = performance.now() - t;
              return last;
            },
          };
          let status = 0;
          try {
            const res = await handleAsk(new Request('https://eval/api/ask', { method: 'POST', body: JSON.stringify(c.request) }), {}, wrapped);
            status = res.status;
          } catch (e) {
            appendFileSync(join(dir, 'errors.jsonl'), `${JSON.stringify({ model: spec, case: c.id, rep, error: String(e) })}\n`);
            continue;
          }
          const r = last as ModelResult | null;
          if (!r && status !== 200) {
            // The handler never reached the model, or the model threw: infrastructure, not a score.
            appendFileSync(join(dir, 'errors.jsonl'), `${JSON.stringify({ model: spec, case: c.id, rep, status })}\n`);
            continue;
          }
          const raw = r?.kind === 'text' ? r.text : '';
          const parsed = r?.kind === 'refused' ? { answer: 'I can only help with this lesson.', offeredRefs: [] } : parseOutput(raw);
          const checks = gradeCase(c, { raw, ...parsed });
          const row: Row = {
            model: spec, case: c.id, category: c.category, rep, question: c.question,
            raw, answer: parsed.answer, refs: parsed.offeredRefs,
            servedBy: r?.model, stop: r?.kind === 'text' ? r.stop : 'refusal', prodStatus: status,
            checks, pass: passed(checks), hardPass: hardPassed(checks),
            latencyMs: Math.round(ms), inputTokens: r?.usage?.inputTokens, outputTokens: r?.usage?.outputTokens,
            costUsd: r ? costOf(spec, r) : 0,
          };
          if (judgeAvailable() && parsed.answer) {
            try {
              const j = await judge(c, parsed.answer);
              row.verdict = j.verdict;
              row.judgeCost = costOf(`anthropic:${JUDGE_MODEL}`, { kind: 'text', text: '', usage: { inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens, cacheReadTokens: j.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: j.usage.cache_creation_input_tokens ?? 0 } });
            } catch (e) {
              appendFileSync(join(dir, 'errors.jsonl'), `${JSON.stringify({ model: spec, case: c.id, rep, judgeError: String(e) })}\n`);
            }
          }
          rows.push(row);
          appendFileSync(join(dir, 'results.jsonl'), `${JSON.stringify(row)}\n`);
        }
      }
    }
    writeFileSync(join(dir, 'summary.md'), summarize(rows, cases.length));
    console.log(`\nAsk eval results: ${dir}\n`);
    console.log(summarize(rows, cases.length));

    if (process.env.ASK_EVAL_GATE !== '0') {
      const broken = rows.filter((r) => !r.hardPass && r.model !== 'null').map((r) => `${r.model} ${r.case}: ${r.checks.filter((c) => !c.pass && c.hard).map((c) => c.name).join(', ')}`);
      expect(broken, 'hard checks failed').toEqual([]);
    }
  }, 6 * 60 * 60 * 1000);
});

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

export function summarize(rows: Row[], caseCount: number): string {
  const models = [...new Set(rows.map((r) => r.model))];
  const out: string[] = [`# Ask the instructor eval`, '', `${caseCount} cases, ${REPS} rep(s). Judge: ${judgeAvailable() ? JUDGE_MODEL : 'not run (no ANTHROPIC_API_KEY)'}.`, ''];
  out.push('| Model | All checks | Hard checks | Judge, all criteria | Median latency | Avg tokens in / out | Cost per question |');
  out.push('|---|---|---|---|---|---|---|');
  for (const m of models) {
    const rs = rows.filter((r) => r.model === m);
    const judged = rs.filter((r) => r.verdict);
    const judgePass = judged.filter((r) => Object.values(r.verdict!).every((v) => v.pass)).length;
    const lat = rs.map((r) => r.latencyMs).sort((a, b) => a - b)[rs.length >> 1] ?? 0;
    const avg = (f: (r: Row) => number | undefined) => Math.round(rs.reduce((s, r) => s + (f(r) ?? 0), 0) / Math.max(1, rs.length));
    const cost = rs.reduce((s, r) => s + r.costUsd, 0) / Math.max(1, rs.length);
    const priced = m.startsWith('anthropic:') || m.startsWith('route:');
    out.push(`| ${m} | ${pct(rs.filter((r) => r.pass).length, rs.length)} | ${pct(rs.filter((r) => r.hardPass).length, rs.length)} | ${judged.length ? pct(judgePass, judged.length) : 'n/a'} | ${(lat / 1000).toFixed(1)} s | ${avg((r) => r.inputTokens)} / ${avg((r) => r.outputTokens)} | ${priced ? `$${cost.toFixed(5)}` : '$0 (on device)'} |`);
  }
  if (rows.some((r) => r.verdict)) {
    out.push('', '## Judge, per criterion', '', `| Model | ${Object.keys(CRITERIA).join(' | ')} |`, `|---|${Object.keys(CRITERIA).map(() => '---').join('|')}|`);
    for (const m of models) {
      const judged = rows.filter((r) => r.model === m && r.verdict);
      out.push(`| ${m} | ${(Object.keys(CRITERIA) as Criterion[]).map((k) => pct(judged.filter((r) => r.verdict![k].pass).length, judged.length)).join(' | ')} |`);
    }
  }
  out.push('', '## Failures', '');
  for (const r of rows.filter((x) => !x.pass || (x.verdict && !Object.values(x.verdict).every((v) => v.pass)))) {
    const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.hard ? '**' : ''}${c.name}${c.hard ? '**' : ''}${c.detail ? ` (${c.detail})` : ''}`);
    const jf = r.verdict ? Object.entries(r.verdict).filter(([, v]) => !v.pass).map(([k, v]) => `judge ${k}: ${v.why}`) : [];
    out.push(`- ${r.model} / ${r.case}: ${[...failed, ...jf].join('; ')}`);
    out.push(`  - Answer: ${(r.answer ?? r.raw).replace(/\s+/g, ' ').slice(0, 400) || '(empty)'}`);
  }
  return out.join('\n');
}
