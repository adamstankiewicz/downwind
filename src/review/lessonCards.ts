// Review cards made from lessons. Every decision and every set of worked
// blanks a pilot has flown becomes a card. When FSRS brings one back, the
// lesson is built again in a situation picked fresh, with the options in a
// new order, so the review asks for the same skill on a different day rather
// than the same answer from memory.

import { lessonById } from '../course/modules';
import { checkBlank, visibleSteps, type LessonAnswers } from '../course/progress';
import { arrange, variantCount } from '../course/variant';
import type { Figure, Lesson, LessonContext, Step } from '../course/types';

export type ReviewStep = Extract<Step, { kind: 'decide' } | { kind: 'turn' }>;

const PREFIX = 'L:';

export const lessonCardId = (lessonId: string, stepId: string) => `${PREFIX}${lessonId}:${stepId}`;

export function parseLessonCard(id: string): { lesson: Lesson; stepId: string } | null {
  if (!id.startsWith(PREFIX)) return null;
  const [lessonId, stepId] = id.slice(PREFIX.length).split(':');
  const lesson = lessonById(lessonId);
  return lesson && stepId ? { lesson, stepId } : null;
}

/**
 * Steps that stand on their own as a review. A step shown only after a
 * particular earlier choice depends on that choice, so it stays in the lesson.
 */
export function reviewableSteps(steps: Step[]): ReviewStep[] {
  return steps.filter((s): s is ReviewStep => (s.kind === 'decide' || s.kind === 'turn') && !s.showIf);
}

export interface StepOutcome {
  stepId: string;
  correct: boolean;
  /** Right, but not cleanly: an acceptable call rather than the best one. */
  partial: boolean;
  /** A decision graded unsafe. */
  unsafe: boolean;
}

/** How a step went. Decisions: best is right, acceptable is right but partial. Blanks: all of them right. */
export function stepOutcome(step: ReviewStep, answers: LessonAnswers): StepOutcome {
  if (step.kind === 'decide') {
    const g = step.grades[answers.decisions[step.id]?.choice ?? ''];
    return { stepId: step.id, correct: g === 'best' || g === 'acceptable', partial: g === 'acceptable', unsafe: g === 'unsafe' };
  }
  const right = step.blanks.filter((b) => checkBlank(b, answers.blanks[step.id]?.[b.id] ?? '')).length;
  return { stepId: step.id, correct: right === step.blanks.length, partial: false, unsafe: false };
}

/** Outcomes for every reviewable step the pilot saw in a finished lesson. */
export function lessonOutcomes(steps: Step[], answers: LessonAnswers): StepOutcome[] {
  return reviewableSteps(visibleSteps(steps, answers)).map((s) => stepOutcome(s, answers));
}

export interface BuiltCard {
  lesson: Lesson;
  step: ReviewStep;
  /** The scene from the lesson's opening brief, so the step has its context. */
  scene?: string;
  /** The step's own figure, or the last one shown before it in the lesson. */
  figure?: Figure;
  variant: number;
}

/** Build a lesson card for review in the situation `seed` picks. Null if the lesson no longer has that step. */
export function buildCard(id: string, ctx: LessonContext, seed: number): BuiltCard | null {
  const p = parseLessonCard(id);
  if (!p) return null;
  const variant = seed % variantCount(p.lesson);
  const steps = arrange(p.lesson.build({ ...ctx, variant }), seed);
  const i = steps.findIndex((s) => s.id === p.stepId);
  const step = steps[i];
  if (!step || (step.kind !== 'decide' && step.kind !== 'turn')) return null;
  const before = steps.slice(0, i + 1);
  const scene = before.find((s): s is Extract<Step, { kind: 'brief' }> => s.kind === 'brief' && Boolean(s.scene))?.scene;
  const figure = before.filter((s) => s.figure).at(-1)?.figure;
  return { lesson: p.lesson, step, scene, figure, variant };
}

export function stepWords(step: ReviewStep, scene?: string): number {
  const text = step.kind === 'decide'
    ? [step.situation, ...step.options.map((o) => o.label)]
    : [step.prompt, ...step.blanks.map((b) => b.label)];
  return [scene ?? '', ...text].join(' ').split(/\s+/).filter(Boolean).length;
}
