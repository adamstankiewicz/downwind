// Course progress, lesson scoring and the instructor's fading. Pure functions
// over plain data; the UI persists the result through lib/storage.

import type { ChoiceId, Grade } from '../scenarios/goNoGo';
import { allLessons, modules } from './modules';
import type { Blank, Coach, Lesson, Module, Step } from './types';

export const COURSE_KEY = 'downwind.course.v1';

export type Lcg = 'Explain' | 'Practice' | 'Perform' | 'Manage/Decide';

export interface LessonRecord {
  attempts: number;
  /** ISO time of the first completion. */
  completedAt: string | null;
  lastAt: string;
  lastGrade: Grade;
  bestGrade: Grade;
  lcg: Lcg;
  /** Older saves may still carry this flag from the removed confidence slider. */
  confidentlyWrong?: boolean;
}

export type CourseProgress = Record<string, LessonRecord>;

export interface DecisionAnswer {
  choice: ChoiceId;
}

export interface LessonAnswers {
  /** Typed or picked values by step id, then blank id. */
  blanks: Record<string, Record<string, string>>;
  decisions: Record<string, DecisionAnswer>;
}

export interface DecisionResult {
  stepId: string;
  title: string;
  choice: ChoiceId;
  grade: Grade;
  best: ChoiceId[];
}

export interface LessonResult {
  grade: Grade;
  lcg: Lcg;
  blanksRight: number;
  blanksTotal: number;
  decisions: DecisionResult[];
}

const RANK: Grade[] = ['unsafe', 'marginal', 'acceptable', 'best'];
const worse = (a: Grade, b: Grade) => (RANK.indexOf(a) <= RANK.indexOf(b) ? a : b);
const better = (a: Grade, b: Grade) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);

export function emptyAnswers(): LessonAnswers {
  return { blanks: {}, decisions: {} };
}

/** Steps the pilot sees, given the decisions made so far. */
export function visibleSteps(steps: Step[], answers: LessonAnswers): Step[] {
  return steps.filter((s) => {
    if (!s.showIf) return true;
    const made = answers.decisions[s.showIf.step];
    return made ? s.showIf.choices.includes(made.choice) : false;
  });
}

/** Lenient on case, spaces, commas and a trailing unit. */
export function checkBlank(blank: Blank, value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (typeof blank.answer === 'string') return v.toLowerCase() === blank.answer.toLowerCase();
  const n = Number(v.replace(/[, ]/g, '').replace(/[^\d.-].*$/, ''));
  return Number.isFinite(n) && Math.abs(n - blank.answer) <= (blank.tolerance ?? 0);
}

export function lcgFor(grade: Grade, blanksRatio: number): Lcg {
  const base: Lcg = grade === 'best' ? 'Manage/Decide' : grade === 'acceptable' ? 'Perform' : grade === 'marginal' ? 'Practice' : 'Explain';
  // A good decision on numbers you couldn't produce is a lucky one.
  if (blanksRatio < 0.5 && (base === 'Manage/Decide' || base === 'Perform')) return 'Practice';
  return base;
}

export function scoreLesson(steps: Step[], answers: LessonAnswers): LessonResult {
  const shown = visibleSteps(steps, answers);
  let right = 0;
  let total = 0;
  const decisions: DecisionResult[] = [];
  for (const s of shown) {
    if (s.kind === 'turn') {
      for (const b of s.blanks) {
        total++;
        if (checkBlank(b, answers.blanks[s.id]?.[b.id] ?? '')) right++;
      }
    } else if (s.kind === 'decide') {
      const a = answers.decisions[s.id];
      if (!a) continue;
      const top = RANK.slice().reverse().find((g) => Object.values(s.grades).includes(g))!;
      decisions.push({
        stepId: s.id, title: s.title, choice: a.choice, grade: s.grades[a.choice],
        best: (Object.keys(s.grades) as ChoiceId[]).filter((id) => s.grades[id] === top),
      });
    }
  }
  const grade = decisions.reduce<Grade>((g, d) => worse(g, d.grade), 'best');
  return {
    grade,
    lcg: lcgFor(grade, total ? right / total : 1),
    blanksRight: right,
    blanksTotal: total,
    decisions,
  };
}

export function recordLesson(progress: CourseProgress, lessonId: string, result: LessonResult, now = new Date()): CourseProgress {
  const prev = progress[lessonId];
  const at = now.toISOString();
  return {
    ...progress,
    [lessonId]: {
      attempts: (prev?.attempts ?? 0) + 1,
      completedAt: prev?.completedAt ?? at,
      lastAt: at,
      lastGrade: result.grade,
      bestGrade: prev ? better(prev.bestGrade, result.grade) : result.grade,
      lcg: result.lcg,
    },
  };
}

export function isDone(progress: CourseProgress, lessonId: string): boolean {
  return Boolean(progress[lessonId]?.completedAt);
}

/** The first playable lesson not yet flown, in course order. */
export function nextLesson(progress: CourseProgress): Lesson | null {
  return allLessons.find((l) => !isDone(progress, l.id)) ?? null;
}

/** Lessons flown but graded marginal or unsafe last time, worth flying again. */
export function toRefly(progress: CourseProgress): Lesson[] {
  return allLessons.filter((l) => {
    const r = progress[l.id];
    return r && (r.lastGrade === 'unsafe' || r.lastGrade === 'marginal');
  });
}

export function moduleProgress(progress: CourseProgress, m: Module): { done: number; total: number } {
  const total = m.lessons.length || m.outline.length;
  return { done: m.lessons.filter((l) => isDone(progress, l.id)).length, total };
}

export function courseProgress(progress: CourseProgress): { done: number; total: number } {
  return modules.reduce(
    (acc, m) => {
      const p = moduleProgress(progress, m);
      return { done: acc.done + p.done, total: acc.total + p.total };
    },
    { done: 0, total: 0 },
  );
}

/**
 * The instructor briefs fully the first time, then steps back: once a lesson
 * has been flown, or three lessons of its module are done, the short line is
 * enough.
 */
export function coachLevel(progress: CourseProgress, lesson: Lesson): keyof Coach {
  if (progress[lesson.id]) return 'short';
  const m = modules.find((x) => x.n === lesson.module);
  const done = m ? m.lessons.filter((l) => isDone(progress, l.id)).length : 0;
  return done >= 3 ? 'short' : 'full';
}
