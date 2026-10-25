import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { parseMetar } from '../../lib/metar';
import { densityAltitudeFt } from '../../lib/density';
import { sampleTrainerPerformance, takeoffDistance } from '../../lib/perf';
import { resolveRef } from '../../refs/resolve';
import { performanceLessons } from '../performance';
import {
  capGrade, climbGainFt, fuelGrade, fuelToGross, lessonAirplane, loadWb, loadingGrade, reserveGrade, runwayGrade, tripFuel, PRACTICE_TRAINER,
} from '../airplane';
import { lessonContext } from '../practice';
import { checkBlank, scoreLesson, visibleSteps } from '../progress';
import { modules } from '../modules';
import { buildBrief } from '../../scenarios/goNoGo';
import { dailySheet } from '../daily';
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
const turn = (steps: Step[]) => steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
const blank = (steps: Step[], id: string) => turn(steps).blanks.find((b) => b.id === id)!;
const [L31, L32, L33, L34] = performanceLessons;
const P = sampleTrainerPerformance();

describe('the lesson airplane', () => {
  it('uses the practice trainer without a usable airplane, and says it is sample', () => {
    const ap = lessonAirplane(blankAircraft);
    expect(ap.practice).toBe(true);
    expect(ap.profile).toBe(PRACTICE_TRAINER);
    expect(ap.sampleWb && ap.samplePerf).toBe(true);
    expect(ap.name).toBe('the practice trainer');
  });
  it('uses the pilot\'s airplane when it has stations and an envelope, and flags sample values', () => {
    const ap = lessonAirplane(sampleC172K);
    expect(ap.practice).toBe(false);
    expect(ap.samplePerf).toBe(true);
    const own = lessonAirplane({ ...sampleC172K, sampleValues: false });
    expect(own.sampleWb || own.samplePerf).toBe(false);
    expect(lessonAirplane({ ...sampleC172K, stations: sampleC172K.stations.filter((s) => s.id !== 'rear') }).practice).toBe(true);
  });
  it('finds the most fuel that keeps a load under gross', () => {
    const ap = lessonAirplane(sampleC172K);
    const load = { frontLb: 340, rearLb: 340, bagLb: 40 };
    const gal = fuelToGross(ap, load);
    expect(loadWb(ap, { ...load, fuelGal: gal }).overGross).toBe(false);
    expect(loadWb(ap, { ...load, fuelGal: gal + 1 }).overGross).toBe(true);
  });
});

describe('grading rules', () => {
  it('grades fuel against the legal and the real reserve', () => {
    const plan = (g: number) => tripFuel(P, { climbMin: 10, cruiseMin: 60, night: false, onBoardGal: g });
    expect(fuelGrade(plan(14))).toBe('unsafe');
    expect(fuelGrade(plan(17))).toBe('marginal');
    expect(fuelGrade(plan(22))).toBe('best');
    expect(reserveGrade(29)).toBe('unsafe');
    expect(reserveGrade(40, true)).toBe('unsafe');
    expect(reserveGrade(45)).toBe('marginal');
    expect(reserveGrade(60)).toBe('best');
  });
  it('grades runway against the book distance and half again', () => {
    expect(runwayGrade(2100, 2000)).toBe('unsafe');
    expect(runwayGrade(1500, 2000)).toBe('marginal');
    expect(runwayGrade(1300, 2000)).toBe('best');
  });
  it('grades loading by the limits first', () => {
    const ap = lessonAirplane(sampleC172K);
    const trip = { climbMin: 10, cruiseMin: 40, night: false };
    expect(loadingGrade(ap, { frontLb: 340, rearLb: 340, bagLb: 40, fuelGal: 38 }, trip)).toBe('unsafe');
    expect(loadingGrade(ap, { frontLb: 340, rearLb: 0, bagLb: 200, fuelGal: 20 }, trip)).toBe('unsafe');
    expect(loadingGrade(ap, { frontLb: 340, rearLb: 0, bagLb: 0, fuelGal: 38 }, trip)).toBe('best');
    expect(loadingGrade(ap, { frontLb: 340, rearLb: 0, bagLb: 0, fuelGal: 14 }, trip)).toBe('marginal');
    expect(capGrade('best', 'acceptable')).toBe('acceptable');
    expect(capGrade('unsafe', 'acceptable')).toBe('unsafe');
  });
  it('climbs less far in hot air', () => {
    const cool = climbGainFt(P, { fieldElevFt: 600, altimeterInHg: 29.92, oatC: 14 }, 3);
    const hot = climbGainFt(P, { fieldElevFt: 600, altimeterInHg: 29.92, oatC: 34 }, 3);
    expect(cool).toBeGreaterThan(hot + 300);
    expect(climbGainFt(P, { fieldElevFt: 600, altimeterInHg: 29.92, oatC: 14 }, 6)).toBeGreaterThan(cool);
  });
});

describe.each(contexts)('module 3 lessons: %s', (_name, ctx) => {
  it.each(performanceLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, lesson) => {
    const steps = lesson.build(ctx);
    expect(steps.length).toBeGreaterThan(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      if (s.figure?.kind === 'metar') expect(parseMetar(s.figure.raw).station).toBe(ctx.airport.icao);
      if (s.figure?.kind === 'perf') expect(s.figure.sample).toBe(true);
      if (s.figure?.kind === 'wb') expect(s.figure.sample).toBe(true);
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
        expect(s.options.length).toBeLessThanOrEqual(4);
        expect(Object.keys(s.grades).sort()).toEqual(s.options.map((o) => o.id).sort());
        for (const o of s.options) expect(s.consequence[o.id]).toBeTruthy();
      }
      if (s.showIf) expect(steps.some((x) => x.id === s.showIf!.step)).toBe(true);
      const text = JSON.stringify(s);
      expect(text).not.toMatch(/—|!(?!=)/);
      expect(text).not.toMatch(/NaN|undefined|Infinity/);
      if (ctx.practiceField) expect(text).not.toMatch(/KASH|C172|Cessna/);
    }
  });
});

describe('module 3 teaches what it says', () => {
  for (const [name, ctx] of contexts) {
    it(`3.1 puts full tanks over gross and makes fuel the lever (${name})`, () => {
      const steps = L31.build(ctx);
      expect(blank(steps, 'over').label).toBe('Over max gross by');
      const d = decide(steps, 'd1');
      expect(d.grades).toMatchObject({ 'as-loaded': 'unsafe', 'bag-out': 'unsafe', 'less-fuel': 'best', 'one-friend': 'acceptable' });
    });
    it(`3.3 grades each departure by the book distance and the margin (${name})`, () => {
      const d = decide(L33.build(ctx), 'd1');
      expect(d.grades['go-morning']).toBe('best');
      expect(['marginal', 'unsafe']).toContain(d.grades['go-now']);
    });
    it(`3.4 is legal but short of a real reserve, and landing for fuel beats pressing on (${name})`, () => {
      const steps = L34.build(ctx);
      expect(decide(steps, 'd1').grades).toMatchObject({ go: 'marginal', 'top-off': 'best', cancel: 'acceptable' });
      const d2 = decide(steps, 'd2');
      expect(d2.grades.divert).toBe('best');
      expect(['marginal', 'unsafe']).toContain(d2.grades.continue);
    });
  }
  for (const [name, ctx] of contexts.slice(0, 2)) {
    it(`3.2 makes climbing over the field the call on a hot day (${name})`, () => {
      const steps = L32.build(ctx);
      const d = decide(steps, 'd1');
      expect(d.grades).toMatchObject({ 'straight-out': 'unsafe', 'climb-overhead': 'best', 'wait-morning': 'acceptable' });
    });
  }

  it('3.2 asks for the density altitude the engine computes from the report', () => {
    for (const [, ctx] of contexts) {
      const steps = L32.build(ctx);
      const fig = steps.find((s) => s.id === 't1')!.figure;
      const m = parseMetar(fig?.kind === 'metar' ? fig.raw : '');
      const da = densityAltitudeFt(ctx.airport.elevationFt, m.altimeterInHg!, m.tempC!);
      expect(Math.abs((blank(steps, 'da').answer as number) - da)).toBeLessThanOrEqual(1);
    }
  });

  it('3.3 asks for the corrected distances the engine computes', () => {
    const ctx = contexts[1][1];
    const steps = L33.build(ctx);
    const t = turn(steps);
    const oat = Number(/at (-?\d+)°C/.exec(t.prompt)![1]);
    const d = takeoffDistance(sampleC172K.performance!, { fieldElevFt: KASH.elevationFt + 200, altimeterInHg: 29.92, oatC: oat, headwindKt: 4, surface: 'grass' });
    expect(blank(steps, 'over50').answer).toBe(d.over50Ft);
    expect(blank(steps, 'roll').answer).toBe(d.groundRollFt);
  });

  it('3.4 asks the in-flight question only after going', () => {
    const steps = L34.build(contexts[0][1]);
    const ids = (choice: string) => visibleSteps(steps, { blanks: {}, decisions: { d1: { choice } } }).map((s) => s.id);
    expect(ids('go')).toContain('d2');
    expect(ids('top-off')).not.toContain('d2');
    const r = scoreLesson(steps, { blanks: {}, decisions: { d1: { choice: 'go' }, d2: { choice: 'divert' } } });
    expect(r.grade).toBe('marginal');
  });

  it('cites references that resolve and lists the module as written', () => {
    for (const l of performanceLessons) for (const ref of l.refs) expect(resolveRef(ref).length).toBeGreaterThan(0);
    const m = modules.find((x) => x.n === 3)!;
    expect(m.lessons.map((l) => l.id)).toEqual(['3.1', '3.2', '3.3', '3.4']);
    expect(m.outline).toEqual([]);
  });
});

describe('daily sheet airplane line', () => {
  it('asks for the density altitude once 3.2 is flown', () => {
    const metar = parseMetar('METAR KASH 241653Z 27008KT 10SM CLR 32/10 A2990 RMK AO2');
    const brief = buildBrief({ airport: KASH, aircraft: blankAircraft, wb: null, minimums: mins, metar, taf: null, departure: NOW, tripHours: 1 });
    const done = { completedAt: NOW.toISOString(), attempts: 1, lastAt: '', lastGrade: 'best', bestGrade: 'best', lcg: 'Perform' } as const;
    const line = dailySheet(brief, { '3.2': done }, mins).find((s) => s.id === 'airplane')!;
    expect(line.covered).toBe(true);
    expect(line.prompt?.answer).toBe(brief.facts.densityAltitudeFt);
    expect(dailySheet(brief, {}, mins).find((s) => s.id === 'airplane')!.taughtBy).toBe('Lesson 3.2');
  });
});
