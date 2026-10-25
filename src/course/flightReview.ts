// The flight review summary: the record a pilot hands their CFI before a
// 61.56 review. Built from saved progress and filed briefings only.

import type { Grade } from '../scenarios/goNoGo';
import { flightReviewStatus, type CalendarStatus } from './calendar';
import type { FiledSheet } from './daily';
import { modules } from './modules';
import type { CourseProgress } from './progress';

export interface ModuleSummary {
  n: number;
  title: string;
  acsAreas: string[];
  flown: number;
  total: number;
  /** Lessons whose last attempt was graded marginal or unsafe. */
  toRefly: { id: string; title: string; grade: Grade }[];
}

export interface ReviewSummary {
  review: CalendarStatus | null;
  modules: ModuleSummary[];
  lessonsFlown: number;
  lessonsTotal: number;
  /** ACS tasks the pilot has flown a lesson for, in course order. */
  tasksFlown: string[];
  /** ACS tasks a written lesson covers that the pilot hasn't flown yet. */
  tasksOpen: string[];
  briefings: number;
  /** Findings that drove a filed daily briefing, by title, most frequent first. */
  flaggedOnBriefings: { title: string; count: number }[];
  /** What to ask the CFI to spend time on, in the order to raise it. */
  askFor: string[];
}

/**
 * The record for a 61.56 flight review: what the pilot has flown, how it
 * went, and what is worth the CFI's time. Built from saved progress and filed
 * briefings only; it never estimates or scores anything the pilot didn't do.
 */
export function reviewSummary(progress: CourseProgress, log: FiledSheet[], lastReviewIso: string | null, now: Date): ReviewSummary {
  const out: ModuleSummary[] = modules.map((m) => {
    const flown = m.lessons.filter((l) => progress[l.id]?.completedAt).length;
    const toRefly = m.lessons
      .filter((l) => progress[l.id] && (progress[l.id].lastGrade === 'unsafe' || progress[l.id].lastGrade === 'marginal'))
      .map((l) => ({ id: l.id, title: l.title, grade: progress[l.id].lastGrade }));
    return { n: m.n, title: m.title, acsAreas: m.acsAreas, flown, total: m.lessons.length || m.outline.length, toRefly };
  });

  const order: string[] = [];
  const flownTasks = new Set<string>();
  for (const m of modules) {
    for (const l of m.lessons) {
      for (const t of l.acs) {
        if (!order.includes(t)) order.push(t);
        if (progress[l.id]?.completedAt) flownTasks.add(t);
      }
    }
  }

  const counts = new Map<string, number>();
  for (const s of log) {
    for (const f of s.findings) {
      if (f.severity === 'info') continue;
      counts.set(f.title, (counts.get(f.title) ?? 0) + 1);
    }
  }
  const flagged = [...counts.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

  const review = flightReviewStatus(lastReviewIso, now);
  const askFor: string[] = [];
  for (const m of out) {
    for (const r of m.toRefly) askFor.push(`${r.id} ${r.title}: last graded ${r.grade}.`);
  }
  for (const f of flagged.slice(0, 3)) askFor.push(`${f.title}: flagged on ${f.count} filed briefing${f.count === 1 ? '' : 's'}.`);
  for (const m of out) {
    if (m.total > 0 && m.flown === 0 && modules.find((x) => x.n === m.n)!.lessons.length > 0) askFor.push(`Module ${m.n}, ${m.title}: not flown yet.`);
  }

  return {
    review,
    modules: out,
    lessonsFlown: out.reduce((n, m) => n + m.flown, 0),
    lessonsTotal: out.reduce((n, m) => n + m.total, 0),
    tasksFlown: order.filter((t) => flownTasks.has(t)),
    tasksOpen: order.filter((t) => !flownTasks.has(t)),
    briefings: log.length,
    flaggedOnBriefings: flagged,
    askFor,
  };
}
