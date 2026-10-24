// Spaced repetition with FSRS. Correctness plus self-rated confidence picks the
// FSRS rating, so a lucky guess is reviewed sooner than a confident answer.

import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';
import { reviewItems, type ReviewItem } from './items';
import { load, save } from '../lib/storage';

const KEY = 'downwind.review.v1';
const scheduler = fsrs({ enable_fuzz: true });

interface Stored {
  cards: Record<string, Card>;
  history: { id: string; at: string; correct: boolean; confidence: number }[];
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

export function ratingFor(correct: boolean, confidencePct: number): Grade {
  if (!correct) return Rating.Again;
  if (confidencePct < 40) return Rating.Hard;
  if (confidencePct < 80) return Rating.Good;
  return Rating.Easy;
}

/** Items due now, oldest due first, then new items. */
export function dueItems(now = new Date(), limit = 10): ReviewItem[] {
  const s = read();
  const due = reviewItems
    .filter((i) => s.cards[i.id] && s.cards[i.id].due <= now)
    .sort((a, b) => +s.cards[a.id].due - +s.cards[b.id].due);
  const fresh = reviewItems.filter((i) => !s.cards[i.id]);
  return [...due, ...fresh].slice(0, limit);
}

export function recordAnswer(itemId: string, correct: boolean, confidencePct: number, now = new Date()): Card {
  const s = read();
  const card = s.cards[itemId] ?? createEmptyCard(now);
  const next = scheduler.next(card, now, ratingFor(correct, confidencePct)).card;
  s.cards[itemId] = next;
  s.history.push({ id: itemId, at: now.toISOString(), correct, confidence: confidencePct });
  save(KEY, s);
  return next;
}

export interface TaskMastery {
  acs: string;
  answered: number;
  correctRate: number;
  /** Share of wrong answers given with 70%+ confidence. */
  confidentlyWrongRate: number;
}

/** Per-ACS-task summary for the readiness map, weighting recent answers more. */
export function masteryByTask(): TaskMastery[] {
  const s = read();
  const byTask = new Map<string, { w: number; c: number; n: number; cw: number; wrong: number }>();
  const items = new Map(reviewItems.map((i) => [i.id, i]));
  s.history.forEach((h, idx) => {
    const item = items.get(h.id);
    if (!item) return;
    const weight = 0.5 + (idx + 1) / s.history.length / 2;
    const t = byTask.get(item.acs) ?? { w: 0, c: 0, n: 0, cw: 0, wrong: 0 };
    t.w += weight;
    if (h.correct) t.c += weight;
    else {
      t.wrong++;
      if (h.confidence >= 70) t.cw++;
    }
    t.n++;
    byTask.set(item.acs, t);
  });
  return [...byTask.entries()]
    .map(([acs, t]) => ({ acs, answered: t.n, correctRate: t.c / t.w, confidentlyWrongRate: t.wrong ? t.cw / t.wrong : 0 }))
    .sort((a, b) => a.acs.localeCompare(b.acs));
}

export function resetReview(): void {
  save(KEY, { cards: {}, history: [] });
}
