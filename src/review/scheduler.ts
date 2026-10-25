// Spaced repetition with FSRS. FSRS keeps a forgetting curve per item and
// brings it back when predicted recall falls to about 90 percent. What it
// learns from each review is the rating, and the pilot never picks one: it is
// read from the answer itself. A miss is Again. A right answer is Hard when it
// was slow or needed help, Easy when it came quickly, Good otherwise. A miss
// that picked an unsafe option also comes back again before the session ends.

import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';
import { reviewItems, type ReviewItem } from './items';
import { parseLessonCard, lessonCardId, type StepOutcome } from './lessonCards';
import { load, save } from '../lib/storage';

const KEY = 'downwind.review.v1';
const scheduler = fsrs({ enable_fuzz: true });

interface Stored {
  cards: Record<string, Card>;
  history: { id: string; at: string; correct: boolean; seconds?: number; usedHelp?: boolean; unsafe?: boolean }[];
}

function read(): Stored {
  const s = load<Stored>(KEY, { cards: {}, history: [] });
  for (const id of Object.keys(s.cards)) {
    const c = s.cards[id];
    c.due = new Date(c.due);
    if (c.last_review) c.last_review = new Date(c.last_review);
  }
  return s;
}

export interface AnswerSignal {
  correct: boolean;
  /** From the question appearing to the answer being committed. */
  seconds: number;
  /** Words in the prompt and options, to allow for reading time. */
  words: number;
  /** Opened a hint or a reference before answering. */
  usedHelp?: boolean;
  /** The wrong answer chosen was an unsafe one (lower minimums than legal, entering without a clearance). */
  unsafe?: boolean;
}

/** Reading at about four words a second, plus time to think. */
export function thinkingSeconds(s: AnswerSignal): number {
  return Math.max(0, s.seconds - s.words / 4);
}

export function ratingFor(s: AnswerSignal): Grade {
  if (!s.correct) return Rating.Again;
  const t = thinkingSeconds(s);
  if (s.usedHelp || t > 25) return Rating.Hard;
  if (t < 6) return Rating.Easy;
  return Rating.Good;
}

export const wordsIn = (item: ReviewItem) => [item.prompt, ...item.options].join(' ').split(/\s+/).length;

/** A card in a review session: a question from the bank, or a step from a lesson already flown. */
export type DueCard = { kind: 'bank'; id: string; item: ReviewItem } | { kind: 'lesson'; id: string };

/**
 * Cards due now, oldest due first, then bank items never seen. Lesson cards
 * join the deck when their lesson is flown (enrollLesson), so they are never "new" here.
 */
export function dueCards(now = new Date(), limit = 10): DueCard[] {
  const s = read();
  const bank = new Map(reviewItems.map((i) => [i.id, i]));
  const toCard = (id: string): DueCard | null => {
    const item = bank.get(id);
    if (item) return { kind: 'bank', id, item };
    return parseLessonCard(id) ? { kind: 'lesson', id } : null;
  };
  const due = Object.keys(s.cards)
    .filter((id) => s.cards[id].due <= now)
    .sort((a, b) => +s.cards[a].due - +s.cards[b].due)
    .map(toCard)
    .filter((c): c is DueCard => c !== null);
  const fresh = reviewItems.filter((i) => !s.cards[i.id]).map((item): DueCard => ({ kind: 'bank', id: item.id, item }));
  return [...due, ...fresh].slice(0, limit);
}

/** Bank items due now, oldest due first, then new items. */
export function dueItems(now = new Date(), limit = 10): ReviewItem[] {
  return dueCards(now, Infinity)
    .flatMap((c) => (c.kind === 'bank' ? [c.item] : []))
    .slice(0, limit);
}

/**
 * Put a finished lesson's decisions and worked numbers into the deck, rated
 * from how they went in the lesson. Flying the lesson again counts as a review.
 */
export function enrollLesson(lessonId: string, outcomes: StepOutcome[], now = new Date()): void {
  for (const o of outcomes) {
    recordAnswer(lessonCardId(lessonId, o.stepId), { correct: o.correct, usedHelp: o.partial, unsafe: o.unsafe, seconds: 10, words: 0 }, now);
  }
}

export function recordAnswer(itemId: string, signal: AnswerSignal, now = new Date()): Card {
  const s = read();
  const card = s.cards[itemId] ?? createEmptyCard(now);
  const next = scheduler.next(card, now, ratingFor(signal)).card;
  s.cards[itemId] = next;
  s.history.push({ id: itemId, at: now.toISOString(), correct: signal.correct, seconds: Math.round(signal.seconds), usedHelp: signal.usedHelp, unsafe: signal.unsafe });
  save(KEY, s);
  return next;
}

export interface TaskMastery {
  acs: string;
  answered: number;
  correctRate: number;
}

/** Per-ACS-task summary for the readiness map, weighting recent answers more. */
export function masteryByTask(): TaskMastery[] {
  const s = read();
  const byTask = new Map<string, { w: number; c: number; n: number }>();
  const items = new Map(reviewItems.map((i) => [i.id, i]));
  const tasksOf = (id: string): string[] => {
    const item = items.get(id);
    if (item) return [item.acs];
    return parseLessonCard(id)?.lesson.acs ?? [];
  };
  s.history.forEach((h, idx) => {
    const weight = 0.5 + (idx + 1) / s.history.length / 2;
    for (const acs of tasksOf(h.id)) {
      const t = byTask.get(acs) ?? { w: 0, c: 0, n: 0 };
      t.w += weight;
      if (h.correct) t.c += weight;
      t.n++;
      byTask.set(acs, t);
    }
  });
  return [...byTask.entries()]
    .map(([acs, t]) => ({ acs, answered: t.n, correctRate: t.c / t.w }))
    .sort((a, b) => a.acs.localeCompare(b.acs));
}

export function resetReview(): void {
  save(KEY, { cards: {}, history: [] });
}
