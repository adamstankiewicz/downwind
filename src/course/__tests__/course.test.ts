import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { parseMetar } from '../../lib/metar';
import { parseTaf } from '../../lib/taf';
import { buildBrief } from '../../scenarios/goNoGo';
import { weatherLessons } from '../weather';
import { lessonContext, PRACTICE_FIELD, windGroup, metarText } from '../practice';
import { checkBlank, coachLevel, emptyAnswers, nextLesson, recordLesson, scoreLesson, visibleSteps, type LessonAnswers } from '../progress';
import { dailySheet } from '../daily';
import { modules } from '../modules';
import type { Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };

const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', lessonContext(KASH, sampleC172K, mins, NOW)],
  ['east variation, high field', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
] as const;

const decide = (steps: Step[], id: string) => steps.find((s) => s.id === id && s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;

describe('lesson context', () => {
  it('falls back to the practice field without a usable home field', () => {
    expect(lessonContext(null, blankAircraft, mins).practiceField).toBe(true);
    expect(lessonContext({ ...KASH, runways: [] }, blankAircraft, mins).airport).toBe(PRACTICE_FIELD);
    expect(lessonContext(KASH, blankAircraft, mins).airport.icao).toBe('KASH');
  });

  it('writes wind groups the parser reads back', () => {
    expect(windGroup({ dirTrue: 4, speedKt: 7 })).toBe('36007KT');
    expect(windGroup({ dirTrue: 283, speedKt: 9, gustKt: 18 })).toBe('28009G18KT');
    const raw = metarText({ station: 'KXYZ', at: NOW, wind: { dirTrue: 270, speedKt: 14, gustKt: 22 }, vis: '7SM', sky: ['BKN028'], tempC: 14, dewC: -2, altimeter: 30.02 });
    const m = parseMetar(raw);
    expect(m.wind).toMatchObject({ dirTrue: 270, speedKt: 14, gustKt: 22 });
    expect(m.ceilingFtAgl).toBe(2800);
    expect(m.dewpointC).toBe(-2);
    expect(m.altimeterInHg).toBe(30.02);
  });
});

describe.each(contexts)('module 2 lessons: %s', (_name, ctx) => {
  it.each(weatherLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, lesson) => {
    const steps = lesson.build(ctx);
    expect(steps.length).toBeGreaterThan(2);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      if (s.figure?.kind === 'metar') expect(parseMetar(s.figure.raw).station).toBe(ctx.airport.icao);
      if (s.figure?.kind === 'taf') expect(parseTaf(s.figure.raw).periods.length).toBeGreaterThan(1);
      if (s.kind === 'turn') {
        for (const b of s.blanks) {
          if (typeof b.answer === 'number') expect(Number.isFinite(b.answer)).toBe(true);
          else expect(b.choices).toContain(b.answer);
          expect(checkBlank(b, String(b.answer))).toBe(true);
        }
      }
      if (s.kind === 'decide') {
        expect(s.options.map((o) => o.id).sort()).toEqual(['cancel', 'delay', 'go', 'go-plan']);
        for (const o of s.options) expect(s.consequence[o.id]).toBeTruthy();
      }
      if (s.showIf) expect(steps.some((x) => x.id === s.showIf!.step)).toBe(true);
    }
  });
});

describe('module 2 teaches what it says, at the default minimums', () => {
  for (const [name, ctx] of contexts.slice(0, 2)) {
    it(`2.1 is a good day (${name})`, () => {
      const d = decide(weatherLessons[0].build(ctx), 'd1');
      expect(d.grades.go).toBe('best');
    });
    it(`2.2 puts the gust crosswind over the minimum (${name})`, () => {
      const steps = weatherLessons[1].build(ctx);
      const turn = steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
      const gust = turn.blanks.find((b) => b.id === 'xwg')!.answer as number;
      expect(gust).toBeGreaterThan(ctx.minimums.crosswindKt);
      const d = decide(steps, 'd1');
      expect(d.grades.go).toBe('unsafe');
      expect(d.grades.cancel).toBe('best');
    });
    it(`2.3 makes waiting the best call (${name})`, () => {
      const d = decide(weatherLessons[2].build(ctx), 'd1');
      expect(d.brief?.facts.improvingAt).not.toBeNull();
      expect(d.grades).toMatchObject({ go: 'unsafe', 'go-plan': 'marginal', delay: 'best' });
    });
    it(`2.4 puts the ceiling under the minimum (${name})`, () => {
      const d = decide(weatherLessons[3].build(ctx), 'd1');
      expect(d.brief?.findings.map((f) => f.id)).toContain('ceiling-personal');
      expect(d.grades.go).toBe('unsafe');
    });
    it(`2.5 flags the spread and rewards a plan (${name})`, () => {
      const steps = weatherLessons[4].build(ctx);
      const d = decide(steps, 'd1');
      expect(d.brief?.findings.map((f) => f.id)).toContain('fog');
      expect(d.grades['go-plan']).toBe('best');
      const fig = steps.find((s) => s.id === 'b2')?.figure;
      expect(fig?.kind === 'metar' && parseMetar(fig.raw).ceilingFtAgl).toBe(700);
    });
  }

  it('falls back to engine-led copy when the pilot\'s numbers change the grade', () => {
    // A 1,500 ft ceiling minimum: 2.4's 1,100 ft ceiling is still under it, but a 1,000 ft minimum is not.
    const ctx = lessonContext(KASH, sampleC172K, { ...mins, ceilingFt: 1000 }, NOW);
    const d = decide(weatherLessons[3].build(ctx), 'd1');
    expect(d.grades.go).toBe('best');
    expect(d.consequence.go).toMatch(/With your numbers/);
  });
});

describe('scoring', () => {
  const ctx = contexts[1][1];
  const steps = weatherLessons[4].build(ctx);

  it('shows the in-flight brief only after going', () => {
    const a: LessonAnswers = { blanks: {}, decisions: { d1: { choice: 'go-plan' } } };
    expect(visibleSteps(steps, a).map((s) => s.id)).toContain('b2');
    expect(visibleSteps(steps, a).map((s) => s.id)).not.toContain('b3');
    const b: LessonAnswers = { blanks: {}, decisions: { d1: { choice: 'cancel' } } };
    expect(visibleSteps(steps, b).map((s) => s.id)).toContain('b3');
    expect(visibleSteps(steps, emptyAnswers()).map((s) => s.id)).not.toContain('b2');
  });

  it('grades by the worst decision', () => {
    const r = scoreLesson(steps, {
      blanks: { t1: { spread: '2', fm: '0' } },
      decisions: { d1: { choice: 'go-plan' }, d2: { choice: 'go' } },
    });
    expect(r.grade).toBe('unsafe');
    expect(r.blanksRight).toBe(1);
    expect(r.decisions.find((d) => d.stepId === 'd2')?.best).toEqual(['go-plan']);
  });

  it('checks blanks leniently', () => {
    const b = { id: 'x', label: 'x', answer: 2800, tolerance: 0, explain: '' };
    expect(checkBlank(b, '2,800 ft')).toBe(true);
    expect(checkBlank(b, ' 2800')).toBe(true);
    expect(checkBlank(b, '2700')).toBe(false);
    expect(checkBlank(b, '')).toBe(false);
    expect(checkBlank({ id: 'c', label: 'c', answer: 'VFR', choices: ['VFR'], explain: '' }, 'vfr')).toBe(true);
  });

  it('moves through the course and fades the instructor', () => {
    let p = {};
    expect(nextLesson(p)?.id).toBe('1.1');
    const lesson = weatherLessons[0];
    expect(coachLevel(p, lesson)).toBe('full');
    const r = scoreLesson(lesson.build(ctx), { blanks: {}, decisions: { d1: { choice: 'go' } } });
    p = recordLesson(p, '2.1', r, NOW);
    // Module 1 still comes first.
    expect(nextLesson(p)?.id).toBe('1.1');
    expect(coachLevel(p, lesson)).toBe('short');
    expect(coachLevel(p, weatherLessons[1])).toBe('full');
  });

  it('lists nine modules in ACS order with module 2 written', () => {
    expect(modules.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(modules[1].lessons).toHaveLength(5);
  });
});

describe('daily sheet', () => {
  const metar = parseMetar('METAR KASH 241653Z 27014G22KT 7SM BKN028 14/04 A3002 RMK AO2');
  const taf = parseTaf('TAF KASH 241720Z 2418/2518 28012G20KT P6SM SCT035 FM242200 31008KT P6SM SKC');
  const brief = buildBrief({ airport: KASH, aircraft: blankAircraft, wb: null, minimums: mins, metar, taf, departure: new Date(Date.UTC(2026, 9, 24, 18)), tripHours: 3 });

  it('asks only on covered lines, and files every finding under a line', () => {
    const none = dailySheet(brief, {}, mins);
    expect(none.every((s) => !s.covered && s.prompt === null)).toBe(true);
    expect(none.flatMap((s) => s.findings)).toHaveLength(brief.findings.length);

    const done = { completedAt: NOW.toISOString(), attempts: 1, lastAt: '', lastGrade: 'best', bestGrade: 'best', lcg: 'Perform' } as const;
    const some = dailySheet(brief, { '2.1': done, '2.2': done, '2.4': done }, mins);
    const by = Object.fromEntries(some.map((s) => [s.id, s]));
    expect(by.report.prompt?.answer).toBe('MVFR');
    expect(by.wind.prompt?.answer).toBe(Math.round(brief.facts.runwayWind!.gust!.crosswindKt));
    expect(by.ceiling.prompt?.answer).toBe('No');
    expect(by.forecast.covered).toBe(false);
    expect(by.airplane.covered).toBe(false);
    expect(by.ceiling.findings.map((f) => f.id)).toContain('ceiling-personal');
  });
});

describe('module 2 situations', () => {
  const ctx = contexts[1][1];
  const g = (id: string, variant: number, step = 'd1') => decide(weatherLessons.find((l) => l.id === id)!.build({ ...ctx, variant }), step).grades;
  it('changes the right call with the weather', () => {
    expect(g('2.1', 0).go).toBe('best');
    expect(g('2.1', 1)).toMatchObject({ go: 'unsafe', cancel: 'best' });
    expect(g('2.1', 2)).toMatchObject({ go: 'unsafe', cancel: 'best' });
    expect(g('2.2', 1)).toMatchObject({ go: 'best' });
    expect(g('2.2', 2)).toMatchObject({ go: 'unsafe', cancel: 'best' });
    expect(g('2.3', 1)).toMatchObject({ 'go-plan': 'best' });
    expect(g('2.3', 2)).toMatchObject({ go: 'best' });
    expect(g('2.4', 1)).toMatchObject({ go: 'best' });
    expect(g('2.4', 2)).toMatchObject({ go: 'unsafe', 'go-plan': 'unsafe', cancel: 'best' });
    expect(g('2.5', 1, 'd2')).toMatchObject({ far: 'best', 'go-plan': 'marginal' });
  });
});
