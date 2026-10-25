import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { carbIceRisk, relativeHumidity } from '../../lib/systems';
import { systemsLessons } from '../systems';
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
  ['east variation, high field, tight minimums', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500, visibilitySm: 3 }, NOW)],
] as const;

const decide = (steps: Step[], id: string) => steps.find((s) => s.id === id && s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const turn = (steps: Step[]) => steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
const lesson = (id: string) => systemsLessons.find((l) => l.id === id)!;

describe('module 7 is written', () => {
  it('replaces the outline with four lessons', () => {
    const m = modules.find((x) => x.n === 7)!;
    expect(m.lessons.map((l) => l.id)).toEqual(['7.1', '7.2', '7.3', '7.4']);
    expect(m.outline).toEqual([]);
  });
});

describe.each(contexts)('module 7 lessons: %s', (_name, ctx) => {
  it.each(systemsLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, l) => {
    const steps = l.build(ctx);
    expect(steps.length).toBeGreaterThan(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps[0].kind).toBe('brief');
    for (const s of steps) {
      const text = JSON.stringify(s);
      expect(text, `${l.id} ${s.id}`).not.toMatch(/—|!/);
      expect(text, `${l.id} ${s.id}`).not.toMatch(/NaN|undefined|Infinity/);
      if (s.kind === 'turn') {
        for (const b of s.blanks) {
          if (typeof b.answer === 'number') expect(Number.isFinite(b.answer)).toBe(true);
          else expect(b.choices).toContain(b.answer);
          expect(checkBlank(b, String(b.answer))).toBe(true);
          expect(b.explain).toBeTruthy();
        }
      }
      if (s.kind === 'decide') {
        expect(s.options.length).toBeGreaterThanOrEqual(3);
        expect(Object.keys(s.grades).sort()).toEqual(s.options.map((o) => o.id).sort());
        for (const o of s.options) expect(s.consequence[o.id]).toBeTruthy();
        expect(Object.values(s.grades)).toContain('best');
      }
      if (s.figure?.kind === 'electrical') {
        const on = s.figure.loads.filter((x) => x.on).reduce((n, x) => n + x.amps, 0);
        expect(s.figure.totalAmps).toBeCloseTo(on, 5);
        expect(s.figure.sample).toBe(true);
      }
    }
  });

  it('7.1 rewards shedding load and going home, and calls leaving it all on unsafe', () => {
    const steps = lesson('7.1').build(ctx);
    const t = turn(steps);
    const shedMin = t.blanks.find((b) => b.id === 'min')!.answer as number;
    const home = t.blanks.find((b) => b.id === 'home')!.answer as number;
    expect(shedMin).toBeGreaterThan(home + 10);
    expect(decide(steps, 'd1').grades).toEqual({ 'carry-on': 'unsafe', 'shed-home': 'best', 'shed-nearest': 'acceptable' });
  });

  it('7.2 finds the vacuum failure and lands at the nearer field', () => {
    const steps = lesson('7.2').build(ctx);
    const t = turn(steps);
    expect(t.blanks.find((b) => b.id === 'source')!.answer).toBe('Vacuum system');
    expect(t.blanks.find((b) => b.id === 'turning')!.answer).toBe('Turn coordinator');
    const d = decide(steps, 'd1');
    expect(d.grades['trust-attitude']).toBe('unsafe');
    expect(d.grades['cover-land']).toBe('best');
    const fig = d.figure?.kind === 'panel' ? d.figure : null;
    expect(fig?.instruments.filter((i) => i.state === 'wrong').map((i) => i.id).sort()).toEqual(['ai', 'hi']);
  });

  it('7.3 finishes the trip on the nav log', () => {
    const steps = lesson('7.3').build(ctx);
    const d = decide(steps, 'd1');
    expect(d.grades).toMatchObject({ pilotage: 'best', 'ask-atc': 'best' });
    const fig = steps.find((s) => s.figure?.kind === 'navlog')?.figure;
    const mh = turn(steps).blanks.find((b) => b.id === 'mh')!.answer;
    expect(fig?.kind === 'navlog' && fig.log.legs[2].magHeading).toBe(mh);
  });

  it('7.4 reads high icing potential, then a dry tank', () => {
    const steps = lesson('7.4').build(ctx);
    const t = turn(steps);
    expect(t.blanks.find((b) => b.id === 'risk')!.answer).toBe('High icing potential');
    expect(t.blanks.find((b) => b.id === 'rh')!.answer).toBe(relativeHumidity(12, 10));
    expect(carbIceRisk(12, 10)).toBe('high');
    expect(t.figure?.kind).toBe('metar');
    expect(decide(steps, 'd1').grades['full-heat']).toBe('best');
    expect(decide(steps, 'd2').grades['switch-tank']).toBe('best');
  });
});

describe('module 7 scoring', () => {
  it('a clean run of 7.1 grades best', () => {
    const steps = lesson('7.1').build(contexts[0][1]);
    const t = turn(steps);
    const blanks = Object.fromEntries(t.blanks.map((b) => [b.id, String(b.answer)]));
    const r = scoreLesson(steps, { blanks: { t1: blanks }, decisions: { d1: { choice: 'shed-home' } } });
    expect(r.grade).toBe('best');
    expect(r.blanksRight).toBe(3);
    expect(r.decisions[0].best).toEqual(['shed-home']);
  });
});

describe('module 7 situations', () => {
  const ctx = lessonContext(null, blankAircraft, defaultPilot.minimums, new Date(Date.UTC(2026, 9, 24, 16, 20)));
  const g = (id: string, variant: number, step = 'd1') => (systemsLessons.find((l) => l.id === id)!.build({ ...ctx, variant }).find((s) => s.id === step) as Extract<Step, { kind: 'decide' }>).grades;
  it('the right call follows which system failed and what is left', () => {
    expect(g('7.1', 1)).toMatchObject({ 'shed-nearest': 'best', 'carry-on': 'unsafe' });
    expect(g('7.1', 1)['shed-home']).not.toBe('best');
    expect(g('7.2', 0)['trust-attitude']).toBe('unsafe');
    expect(g('7.2', 1)).toMatchObject({ 'trust-attitude': 'best', 'cover-land': 'unsafe' });
    expect(g('7.3', 1)).toMatchObject({ nearest: 'best', pilotage: 'unsafe' });
    expect(g('7.4', 1, 'd2')).toMatchObject({ 'land-now': 'best', 'switch-tank': 'acceptable' });
  });
});
