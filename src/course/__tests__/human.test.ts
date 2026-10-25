import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { parseMetar } from '../../lib/metar';
import { chartAirport, practiceRegion } from '../../chart/practiceRegion';
import { humanFactorsLessons, highestAlong, nightGrades, nightScenario, TRIP } from '../human';
import { lessonContext } from '../practice';
import { checkBlank, scoreLesson } from '../progress';
import { modules } from '../modules';
import type { Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };

const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', lessonContext(KASH, sampleC172K, mins, NOW)],
  ['east variation, high field, tight minimums', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
] as const;

const decide = (steps: Step[], id = 'd1') => steps.find((s) => s.id === id && s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const lesson = (id: string) => humanFactorsLessons.find((l) => l.id === id)!;
const chartIds = new Set([...practiceRegion.airports.map((a) => a.id), ...practiceRegion.checkpoints.map((c) => c.id), ...practiceRegion.airspace.map((v) => v.id)]);

/** Every string a step shows, for checking the copy rules. */
function copy(s: Step): string[] {
  const out: string[] = [s.title];
  if (s.kind === 'brief') out.push(s.scene ?? '', s.say.full, s.say.short);
  if (s.kind === 'example') out.push(s.say.full, s.say.short, ...s.work.flatMap((w) => [w.label, w.value, w.note ?? '']));
  if (s.kind === 'turn') out.push(s.prompt, ...s.blanks.flatMap((b) => [b.label, b.explain, ...(b.choices ?? [])]));
  if (s.kind === 'decide') out.push(s.situation, s.why, ...s.options.map((o) => o.label), ...Object.values(s.consequence));
  return out;
}

describe('module 8 is written', () => {
  it('replaces the outline with five lessons', () => {
    const m = modules.find((x) => x.n === 8)!;
    expect(m.outline).toEqual([]);
    expect(m.lessons.map((l) => l.id)).toEqual(['8.1', '8.2', '8.3', '8.4', '8.5']);
    expect(m.lessons.every((l) => l.module === 8)).toBe(true);
  });
});

describe.each(contexts)('module 8 lessons: %s', (_name, ctx) => {
  it.each(humanFactorsLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, l) => {
    const steps = l.build(ctx);
    expect(steps.length).toBeGreaterThan(2);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps.some((s) => s.kind === 'turn')).toBe(true);
    expect(steps.some((s) => s.kind === 'decide')).toBe(true);
    for (const s of steps) {
      for (const text of copy(s)) {
        expect(text, `${l.id} ${s.id}`).not.toMatch(/[—!]|NaN|undefined|Infinity/);
        if (ctx.practiceField) expect(text).not.toMatch(/KASH|Nashua|C172|Cessna/);
      }
      if (s.figure?.kind === 'metar') expect(parseMetar(s.figure.raw).ceilingFtAgl).not.toBeNull();
      if (s.figure?.kind === 'chart') for (const id of [...(s.figure.route ?? []), ...(s.figure.highlight ?? [])]) expect(chartIds.has(id), id).toBe(true);
      if (s.kind === 'turn') {
        for (const b of s.blanks) {
          if (typeof b.answer === 'number') expect(Number.isFinite(b.answer)).toBe(true);
          else expect(b.choices).toContain(b.answer);
          expect(checkBlank(b, String(b.answer))).toBe(true);
        }
      }
      if (s.kind === 'decide') {
        expect(s.options.length).toBeGreaterThanOrEqual(3);
        expect(Object.keys(s.grades).sort()).toEqual(s.options.map((o) => o.id).sort());
        for (const o of s.options) expect(s.consequence[o.id], o.id).toBeTruthy();
        expect(Object.values(s.grades)).toContain('best');
      }
    }
  });
});

describe('module 8 teaches what it says', () => {
  for (const [name, ctx] of contexts) {
    it(`8.1: clears the written minimum, not the widened one (${name})`, () => {
      const steps = lesson('8.1').build(ctx);
      const d = decide(steps);
      const ceiling = d.brief!.facts.ceilingFtAgl!;
      expect(ceiling).toBeGreaterThanOrEqual(ctx.minimums.ceilingFt);
      expect(ceiling).toBeLessThan(ctx.minimums.ceilingFt + 500);
      expect(d.brief?.findings.map((f) => f.id)).toContain('ceiling-personal');
      expect(d.grades).toMatchObject({ go: 'unsafe', 'go-plan': 'marginal', cancel: 'best' });
      const turn = steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
      expect(turn.blanks.find((b) => b.id === 'ceil')!.answer).toBe(ctx.minimums.ceilingFt + 500);
    });

    it(`8.2: only waiting out the medication is safe (${name})`, () => {
      const d = decide(lesson('8.2').build(ctx));
      expect(d.grades).toEqual({ fly: 'unsafe', 'fly-local': 'unsafe', afternoon: 'unsafe', tomorrow: 'best' });
    });

    it(`8.3: the gap is legal but under the minimum, and turning back is best (${name})`, () => {
      const steps = lesson('8.3').build(ctx);
      const d = decide(steps);
      expect(d.grades).toEqual({ 'press-on': 'unsafe', 'climb-over': 'unsafe', hold: 'marginal', 'turn-back': 'best' });
      const turn = steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
      const gap = turn.blanks.find((b) => b.id === 'gap')!.answer as number;
      expect(gap).toBeLessThan(ctx.minimums.ceilingFt);
      expect(gap).toBeGreaterThan(500);
      expect(d.situation).toMatch(/Legal\./);
      // The report is the destination's, so its base sits where the blank says.
      const fig = turn.figure?.kind === 'metar' ? parseMetar(turn.figure.raw) : null;
      expect(fig!.ceilingFtAgl! + chartAirport('KXQA')!.elevationFt).toBe(turn.blanks.find((b) => b.id === 'base')!.answer);
    });

    it(`8.4: one landing short, so getting current first is best (${name})`, () => {
      const steps = lesson('8.4').build(ctx);
      const d = decide(steps);
      expect(d.grades).toEqual({ go: 'unsafe', 'land-first': 'best', early: 'acceptable', cancel: 'acceptable' });
      const turn = steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
      expect(Object.fromEntries(turn.blanks.map((b) => [b.id, b.answer]))).toEqual({ count: 2, need: 1, reserve: 45 });
    });
  }

  it('8.3 measures the highest ground along the rest of the route', () => {
    const pos = (id: string) => chartAirport(id)?.pos ?? practiceRegion.checkpoints.find((c) => c.id === id)!.pos;
    const hi = highestAlong(TRIP.ahead.map(pos));
    for (const id of TRIP.ahead) expect(hi.msl).toBeGreaterThanOrEqual(practiceRegion.groundFt(pos(id)));
  });

  it('8.4 grades follow the clock, not the copy', () => {
    const s = nightScenario(NOW);
    // Give the pilot a third qualifying landing and going as planned becomes legal.
    const current = { ...s, log: [...s.log, { at: new Date(s.sunset.getTime() - 5 * 86_400_000 + 2 * 3_600_000), sunset: new Date(s.sunset.getTime() - 5 * 86_400_000), fullStop: true, days: 5, minAfterSunset: 120 }] };
    expect(nightGrades(current)).toMatchObject({ go: 'best', 'land-first': 'acceptable' });
  });

  it('scores a lesson by its worst decision', () => {
    const steps = lesson('8.2').build(contexts[1][1]);
    expect(scoreLesson(steps, { blanks: {}, decisions: { d1: { choice: 'tomorrow' } } }).grade).toBe('best');
    expect(scoreLesson(steps, { blanks: {}, decisions: { d1: { choice: 'fly-local' } } }).grade).toBe('unsafe');
  });
});

describe('module 8 situations', () => {
  const ctx = lessonContext(null, blankAircraft, defaultPilot.minimums, NOW);
  const g = (id: string, variant: number) => (humanFactorsLessons.find((l) => l.id === id)!.build({ ...ctx, variant }).find((s) => s.kind === 'decide') as Extract<Step, { kind: 'decide' }>).grades;
  it('the call follows the day, the pilot and the weather both ways', () => {
    expect(g('8.1', 1).go).toBe('best');
    expect(g('8.2', 1)).toMatchObject({ fly: 'unsafe', afternoon: 'acceptable', tomorrow: 'best' });
    expect(g('8.3', 1)).toMatchObject({ 'press-on': 'best', 'turn-back': 'marginal' });
    expect(g('8.4', 1)).toMatchObject({ go: 'best', cancel: 'marginal' });
  });
});
