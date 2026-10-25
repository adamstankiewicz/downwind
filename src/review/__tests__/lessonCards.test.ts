import { describe, expect, it } from 'vitest';
import { KASH } from '../../data/airports';
import { sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { lessonContext } from '../../course/practice';
import { allLessons, lessonById } from '../../course/modules';
import { emptyAnswers, type LessonAnswers } from '../../course/progress';
import { variantCount } from '../../course/variant';
import { buildCard, lessonCardId, lessonOutcomes, parseLessonCard, reviewableSteps } from '../lessonCards';
import { dueCards, enrollLesson, masteryByTask, resetReview } from '../scheduler';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const ctx = lessonContext(KASH, sampleC172K, defaultPilot.minimums, NOW);

describe('lesson review cards', () => {
  it('round-trips card ids', () => {
    const id = lessonCardId('2.2', 'd1');
    expect(parseLessonCard(id)?.lesson.id).toBe('2.2');
    expect(parseLessonCard(id)?.stepId).toBe('d1');
    expect(parseLessonCard('fr-interval')).toBeNull();
    expect(parseLessonCard('L:99.9:d1')).toBeNull();
  });

  it('builds a card for every reviewable step of every lesson, in every situation', () => {
    for (const lesson of allLessons) {
      const steps = reviewableSteps(lesson.build(ctx));
      expect(steps.length, lesson.id).toBeGreaterThan(0);
      for (const s of steps) {
        for (let seed = 0; seed < variantCount(lesson) * 2; seed++) {
          const card = buildCard(lessonCardId(lesson.id, s.id), ctx, seed);
          expect(card?.step.id, `${lesson.id} ${s.id} seed ${seed}`).toBe(s.id);
        }
      }
    }
  });

  it('enrolls a flown lesson, brings it back when due, and counts it toward its ACS tasks', () => {
    resetReview();
    const lesson = lessonById('2.2')!;
    const steps = lesson.build(ctx);
    const answers: LessonAnswers = emptyAnswers();
    for (const s of steps) {
      if (s.kind === 'decide') answers.decisions[s.id] = { choice: Object.keys(s.grades).find((k) => s.grades[k] === 'unsafe')! };
      if (s.kind === 'turn') answers.blanks[s.id] = Object.fromEntries(s.blanks.map((b) => [b.id, String(b.answer)]));
    }
    const outcomes = lessonOutcomes(steps, answers);
    expect(outcomes.some((o) => o.unsafe && !o.correct)).toBe(true);
    expect(outcomes.some((o) => o.correct)).toBe(true);
    enrollLesson(lesson.id, outcomes, NOW);
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    const due = dueCards(later, 100).filter((c) => c.kind === 'lesson').map((c) => c.id);
    expect(due).toContain(lessonCardId('2.2', outcomes.find((o) => !o.correct)!.stepId));
    expect(masteryByTask().map((m) => m.acs)).toEqual(expect.arrayContaining(lesson.acs));
    resetReview();
  });
});
