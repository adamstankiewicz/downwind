import { describe, expect, it } from 'vitest';
import { KASH } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { lessonContext } from '../practice';
import { allLessons } from '../modules';
import { arrange, hash, nextVariant, rng, shuffled, variantCount } from '../variant';
import { recordLesson, type CourseProgress, type LessonResult } from '../progress';
import type { Lesson, Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const ctxs = [
  lessonContext(null, blankAircraft, defaultPilot.minimums, NOW),
  lessonContext(KASH, sampleC172K, defaultPilot.minimums, NOW),
];
const result: LessonResult = { grade: 'best', lcg: 'Manage/Decide', blanksRight: 1, blanksTotal: 1, decisions: [] };
const fake = (variants: number): Lesson => ({ id: 'x.1', module: 1, title: 'x', summary: '', minutes: 1, acs: [], refs: [], variants, build: () => [] });

describe('seeded variety', () => {
  it('is deterministic for a seed', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    expect(shuffled([1, 2, 3, 4, 5], 7)).toEqual(shuffled([1, 2, 3, 4, 5], 7));
    expect(hash('1.1')).not.toBe(hash('1.2'));
  });

  it('shuffles into a permutation, and moves things around across seeds', () => {
    const firsts = new Set<number>();
    for (let s = 0; s < 40; s++) {
      const out = shuffled([0, 1, 2, 3], s);
      expect([...out].sort()).toEqual([0, 1, 2, 3]);
      firsts.add(out[0]);
    }
    expect(firsts.size).toBe(4);
  });

  it('flies every situation once before repeating any', () => {
    const lesson = fake(4);
    let progress: CourseProgress = {};
    const flown: number[] = [];
    for (let i = 0; i < 8; i++) {
      const v = nextVariant(lesson, progress[lesson.id], 1234 + i);
      flown.push(v);
      progress = recordLesson(progress, lesson.id, result, NOW, v);
    }
    expect(new Set(flown.slice(0, 4)).size).toBe(4);
    expect(new Set(flown.slice(4)).size).toBe(4);
    expect(nextVariant(fake(1), undefined, 99)).toBe(0);
  });

  it('reorders options without touching grades, and keeps sequences in order', () => {
    const d: Step = {
      kind: 'decide', id: 'd1', title: 't', situation: 's',
      options: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id })),
      grades: { a: 'unsafe', b: 'best', c: 'marginal', d: 'acceptable' }, consequence: { a: '', b: '', c: '', d: '' }, why: '',
    };
    const orders = new Set<string>();
    for (let s = 0; s < 20; s++) {
      const [out] = arrange([d], s) as Extract<Step, { kind: 'decide' }>[];
      orders.add(out.options.map((o) => o.id).join(''));
      expect(out.grades).toBe(d.grades);
    }
    expect(orders.size).toBeGreaterThan(4);
    const [kept] = arrange([{ ...d, keepOrder: true }], 3) as Extract<Step, { kind: 'decide' }>[];
    expect(kept.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe.each(allLessons.map((l) => [l.id, l] as const))('lesson %s situations', (_id, lesson) => {
  it('builds every situation with the same step ids, each a real decision', () => {
    for (const ctx of ctxs) {
      // Steps that become review cards must exist in every situation.
      const reviewable = lesson.build({ ...ctx, variant: 0 })
        .filter((s) => (s.kind === 'decide' || s.kind === 'turn') && !s.showIf)
        .map((s) => s.id);
      for (let v = 0; v < variantCount(lesson); v++) {
        const steps = lesson.build({ ...ctx, variant: v });
        for (const id of reviewable) expect(steps.some((s) => s.id === id), `${lesson.id} v${v} ${id}`).toBe(true);
        const text = JSON.stringify(steps);
        expect(text, `${lesson.id} v${v}`).not.toMatch(/NaN|undefined|Invalid Date|—/);
        for (const s of steps) {
          if (s.kind === 'turn') {
            for (const b of s.blanks) {
              if (typeof b.answer === 'number') expect(Number.isFinite(b.answer), `${lesson.id} v${v} ${b.id}`).toBe(true);
              else expect(b.choices, `${lesson.id} v${v} ${b.id}`).toContain(b.answer);
            }
          }
          if (s.kind !== 'decide') continue;
          expect(Object.values(s.grades), `${lesson.id} v${v} ${s.id}`).toContain('best');
          for (const o of s.options) {
            expect(s.grades[o.id], `${lesson.id} v${v} ${s.id} ${o.id}`).toBeDefined();
            expect(s.consequence[o.id], `${lesson.id} v${v} ${s.id} ${o.id}`).toBeTruthy();
          }
        }
      }
    }
  });
});
