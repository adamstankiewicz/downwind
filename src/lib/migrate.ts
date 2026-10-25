// One-time moves of saved data when the course changes shape. Each step reads
// the old key only while the new one is missing, so it runs once and never
// touches progress saved under the new numbering.

import { load, save } from './storage';

const has = (key: string) => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

/**
 * The oral and flight review moved from module 9 to module 11 when Airport
 * operations and Aerodynamics came in as 9 and 10. Lesson "9.2" is now
 * "11.2", and its review cards "L:9.2:d1" are now "L:11.2:d1".
 */
export const renumberLessonId = (id: string) => id.replace(/^9\./, '11.');
export const renumberCardId = (id: string) => id.replace(/^L:9\./, 'L:11.');

const renameKeys = <T>(o: Record<string, T>, f: (k: string) => string): Record<string, T> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));

export function migrateCourse(v1: Record<string, unknown>) {
  return renameKeys(v1, renumberLessonId);
}

export function migrateReview(v1: { cards: Record<string, unknown>; history: { id: string }[] }) {
  return { cards: renameKeys(v1.cards, renumberCardId), history: v1.history.map((h) => ({ ...h, id: renumberCardId(h.id) })) };
}

export function migrateStorage(): void {
  if (!has('downwind.course.v2') && has('downwind.course.v1')) {
    save('downwind.course.v2', migrateCourse(load<Record<string, unknown>>('downwind.course.v1', {})));
  }
  if (!has('downwind.review.v2') && has('downwind.review.v1')) {
    save('downwind.review.v2', migrateReview(load('downwind.review.v1', { cards: {}, history: [] })));
  }
}
