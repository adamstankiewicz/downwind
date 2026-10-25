// Variety on replay. A lesson can be written with several situations (its
// `variants`); each flight picks one the pilot hasn't seen yet, and decision
// options are shuffled with a seed so the answer is never "the one in the
// same place as last time". Everything here is deterministic for a seed, so
// tests and the debrief see exactly what the pilot saw.

import type { LessonRecord } from './progress';
import type { Lesson, Step } from './types';

/** A small, fast seeded generator (mulberry32). Returns floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit hash of a string, to mix a step id into a seed. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How many situations a lesson is written with. */
export const variantCount = (lesson: Lesson) => Math.max(1, lesson.variants ?? 1);

/**
 * The situation for the next flight of a lesson: the first one not yet seen,
 * in an order shuffled per pilot by `seed`, then round again once all are seen.
 */
export function nextVariant(lesson: Lesson, record: LessonRecord | undefined, seed: number): number {
  const n = variantCount(lesson);
  if (n === 1) return 0;
  const order = shuffled([...Array(n).keys()], hash(lesson.id) ^ seed);
  const seen = record?.seen ?? [];
  // Seen lists only grow, so count from the last full round.
  const round = seen.slice(seen.length - (seen.length % n));
  return order.find((v) => !round.includes(v)) ?? order[0];
}

/**
 * Options in a fresh order for each decision. Grades and consequences are
 * keyed by option id, so nothing else changes. A decision whose options read
 * as a sequence (altitudes, times) sets `keepOrder` and stays as written.
 */
export function arrange(steps: Step[], seed: number): Step[] {
  return steps.map((s) => {
    if (s.kind !== 'decide' || s.keepOrder) return s;
    return { ...s, options: shuffled(s.options, seed ^ hash(s.id)) };
  });
}
