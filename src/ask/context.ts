// Ask the instructor: what the model is told, and what comes back. The app
// sends the step the pilot is on, their field, airplane and minimums, and the
// report in front of them. The model explains; it never grades, never gives
// away an answer the pilot has not committed, and cites only labels the
// reference resolver can open. Everything here is plain data so the worker
// and the tests share it.

import type { Figure, Lesson, LessonContext, Step } from '../course/types';
import type { LessonAnswers } from '../course/progress';
import { passageLabels, resolvesToSource } from '../refs/resolve';

/** Longest question the worker accepts. A pilot's question is a sentence or two. */
export const MAX_QUESTION = 400;
/** Earlier questions on the same step that go along with a new one. */
export const MAX_FOLLOWUPS = 2;
/** Longest text field sent from a step, and longest earlier answer. Keeps the prompt short. */
const MAX_TEXT = 700;
const clip = (s: string | undefined, n = MAX_TEXT) => (s && s.length > n ? `${s.slice(0, n)}...` : s);

export interface AskTurn {
  question: string;
  answer: string;
}

export interface AskRequest {
  question: string;
  /** Earlier questions and answers on this step, oldest first. */
  earlier: AskTurn[];
  context: AskContext;
}

export interface AskReply {
  answer: string;
  /** Labels the resolver opens. Anything else the model offered is dropped. */
  refs: string[];
}

export interface AskContext {
  /** The lesson's opening brief, so every step carries the rule the lesson teaches. */
  lesson: { id: string; title: string; acs: string[]; refs: string[]; brief?: string };
  step: Record<string, unknown>;
  field: { icao: string; name: string; elevationFt: number; airspace: string; runways: string[]; practice: boolean };
  airplane: { type: string; demonstratedCrosswindKt: number | null; usableFuelGal: number | null; maxGrossLb: number | null; sample: boolean } | null;
  minimums: LessonContext['minimums'];
  report: { metar?: string; taf?: string } | null;
}

/**
 * The context for one step. `revealed` says whether the pilot has checked the
 * blanks or committed the decision; until then answers and grades stay out,
 * so the model cannot give them away.
 */
export function askContext(lesson: Lesson, step: Step, ctx: LessonContext, answers: LessonAnswers, revealed: boolean, figure?: Figure, steps?: Step[]): AskContext {
  const a = ctx.aircraft;
  const hasAirplane = Boolean(a.type.trim());
  return {
    lesson: { id: lesson.id, title: lesson.title, acs: lesson.acs, refs: lesson.refs, brief: briefOf(step, steps ?? lesson.build(ctx)) },
    step: stepFacts(step, answers, revealed),
    field: {
      icao: ctx.airport.icao,
      name: ctx.airport.name,
      elevationFt: ctx.airport.elevationFt,
      airspace: ctx.airport.airspace,
      runways: ctx.airport.runways.map((r) => r.id),
      practice: ctx.practiceField,
    },
    airplane: hasAirplane
      ? {
          type: a.type,
          demonstratedCrosswindKt: a.demonstratedCrosswindKt || null,
          usableFuelGal: a.usableFuelGal || null,
          maxGrossLb: a.maxGrossLb || null,
          sample: a.sampleValues,
        }
      : null,
    minimums: ctx.minimums,
    report: reportOf(figure ?? step.figure),
  };
}

function briefOf(step: Step, steps: Step[]): string | undefined {
  if (step.kind === 'brief') return undefined;
  const first = steps.find((s) => s.kind === 'brief');
  return first?.kind === 'brief' ? clip(first.say.full) : undefined;
}

function stepFacts(step: Step, answers: LessonAnswers, revealed: boolean): Record<string, unknown> {
  const base = { kind: step.kind, title: step.title };
  switch (step.kind) {
    case 'brief':
      return { ...base, scene: clip(step.scene), instructor: clip(step.say.full) };
    case 'example':
      return { ...base, instructor: clip(step.say.full), work: step.work };
    case 'turn': {
      const mine = answers.blanks[step.id] ?? {};
      return {
        ...base,
        prompt: step.prompt,
        checked: revealed,
        blanks: step.blanks.map((b) => ({
          label: b.label,
          unit: b.unit,
          choices: b.choices,
          pilotEntered: mine[b.id] || null,
          ...(revealed ? { answer: b.answer, explain: clip(b.explain, 300) } : {}),
        })),
      };
    }
    case 'dials': {
      // What the pilot sees on screen: the engine's numbers at the current setting.
      const values = answers.dials?.[step.id] ?? Object.fromEntries(step.dials.map((d) => [d.id, d.initial]));
      const state = step.evaluate(values);
      const checked = answers.dialChecks?.[step.id];
      return {
        ...base,
        instructor: step.say.full,
        dials: step.dials.map((d) => ({ label: d.label, value: d.format ? d.format(values[d.id]) : `${values[d.id]} ${d.unit}` })),
        readouts: state.readouts.map((r) => ({ label: r.label, value: r.value })),
        linesCrossed: state.lines.map((l) => l.title),
        engineGrades: Object.fromEntries(state.verdict.options.map((o) => [o.label, state.verdict.grades[o.id]])),
        task: step.task?.prompt,
        ...(revealed && checked && step.task ? { taskResult: step.task.check(checked) } : {}),
      };
    }
    case 'decide': {
      const choice = answers.decisions[step.id]?.choice ?? null;
      return {
        ...base,
        situation: clip(step.situation),
        options: step.options.map((o) => o.label),
        committed: revealed,
        ...(revealed && choice
          ? {
              pilotChose: step.options.find((o) => o.id === choice)?.label,
              grade: step.grades[choice],
              bestCalls: step.options.filter((o) => step.grades[o.id] === 'best').map((o) => o.label),
              consequence: clip(step.consequence[choice]),
              instructorWhy: clip(step.why),
            }
          : {}),
      };
    }
  }
}

function reportOf(figure: Figure | undefined): AskContext['report'] {
  if (figure?.kind === 'metar') return { metar: figure.raw };
  if (figure?.kind === 'taf') return { taf: figure.raw };
  return null;
}

/** Keeps the request small: trims the question and the earlier turns. */
export function askRequest(question: string, earlier: AskTurn[], context: AskContext): AskRequest {
  return {
    question: question.trim().slice(0, MAX_QUESTION),
    earlier: earlier.slice(-MAX_FOLLOWUPS).map((t) => ({ question: t.question, answer: clip(t.answer, 500) ?? '' })),
    context,
  };
}

/** The pilot's own POH, cited by section ("POH section 5, performance"). Shown as a plain chip. */
const POH = /^POH section \d+(, [a-z ,]+)?$/i;

/** The standard POH sections (GAMA order), so "POH, emergency procedures" can be cited as section 3. */
const POH_SECTIONS: [RegExp, string][] = [
  [/limitation/i, '2, limitations'],
  [/emergenc/i, '3, emergency procedures'],
  [/normal procedure/i, '4, normal procedures'],
  [/performance/i, '5, performance'],
  [/weight|balance/i, '6, weight and balance'],
  [/system/i, '7, systems description'],
];

/** A POH ref in the form the app shows, or null. */
export function pohLabel(label: string): string | null {
  if (POH.test(label)) return label;
  if (!/^POH\b/i.test(label)) return null;
  const hit = POH_SECTIONS.find(([r]) => r.test(label));
  return hit ? `POH section ${hit[1]}` : null;
}

/** The model's refs, kept only when the resolver can open them or they name a POH section. Duplicates go too. */
export function citableRefs(refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const r of refs) {
    if (typeof r !== 'string') continue;
    const trimmed = r.trim();
    const label = resolvesToSource(trimmed) ? trimmed : pohLabel(trimmed);
    if (label && !out.includes(label)) out.push(label);
  }
  return out.slice(0, 4);
}

/** The reply the worker returns, from whatever the model produced. Null when it is not usable. */
export function parseReply(raw: unknown): AskReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { answer?: unknown; refs?: unknown };
  if (typeof r.answer !== 'string' || !r.answer.trim()) return null;
  return { answer: r.answer.trim(), refs: citableRefs(r.refs) };
}

/** The JSON shape the model must answer in. */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    refs: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'refs'],
  additionalProperties: false,
} as const;

/**
 * The system prompt. It never changes between requests, so it is cached;
 * everything about the pilot and the step goes in the user turn.
 */
export function systemPrompt(): string {
  return `You are the flight instructor in Downwind, a ground school for private pilots. A pilot is partway through a lesson and has typed a question about the step in front of them. You get the lesson, the step, their home field, their airplane, their personal minimums and any weather report on screen, as JSON.

How to answer:
- Answer the question they asked, about this step, in two to four short sentences. Plain, direct and kind. Explain why before what. Talk about what a pilot notices, decides and says in the airplane, not only what the book says.
- No em dashes, no exclamation marks, no headings, no lists unless they asked for steps. You may use **bold** for one key phrase.
- The lesson's brief and the step state the rules this lesson teaches. When they cover the question, answer from them rather than from memory, and never contradict them.
- Use only numbers that appear in the context. Do no arithmetic of your own, not even a fraction or a difference; do not compute new distances, weights, winds or performance figures. If they need a number the lesson has not shown, tell them which step or tool works it out.
- Never grade, score or rate the pilot, and never say how well they are doing. The app grades.
- If the step is a decision that is not committed yet, or blanks that are not checked yet, do not say which option is best or what a blank's answer is, and do not tell them what to do next, even in other words ("hold outside", "pick the field ahead" is the same as naming the option). Explain the rule and what each choice costs, then hand the choice back to them with a question to ask themselves.
- After they have committed or checked, you may explain the grade and the best call that the context gives. Never contradict it.
- Never assume a real airport, airplane or person beyond what the context names. When the field is marked practice, it is a made-up field for the lesson.
- If the question is not about flying or this lesson, say in one sentence that you can only help with the lesson.
- If you are not sure, say so and point them to their POH, the regulation or a CFI. This is a training aid, not a briefing or a substitute for an instructor.

References: put zero to three labels in "refs", only ones that back what you said. Use exactly one of these forms:
- A regulation: "14 CFR 91.155" or "14 CFR 91.155(c)".
- An AIM section: "AIM 7-1" or "AIM 3-2-5".
- A PHAK chapter: "PHAK ch. 11".
- A section of the pilot's own POH, number and name: "POH section 3, emergency procedures", "POH section 5, performance" or "POH section 6, weight and balance".
- One of these handbook passages, copied exactly:
${passageLabels().map((l) => `  - ${l}`).join('\n')}
The lesson's own refs in the context are good choices when they fit. Leave "refs" empty rather than guess.`;
}

/** The user turn: the context, the earlier exchange on this step, and the question. */
export function userMessage(req: AskRequest): string {
  const earlier = req.earlier.length
    ? `\n\nEarlier on this step:\n${req.earlier.map((t) => `Pilot: ${t.question}\nInstructor: ${t.answer}`).join('\n')}`
    : '';
  return `Context:\n${JSON.stringify(req.context)}${earlier}\n\nPilot's question: ${req.question}`;
}
