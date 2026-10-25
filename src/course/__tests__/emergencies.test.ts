import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { chartAirport } from '../../chart/practiceRegion';
import { checkField, glideReachNm, glideSinkFpm, glidingTurn, headwindOn, reach, turnback, TURNBACK_DEG } from '../../lib/emergency';
import { sampleTrainerPerformance } from '../../lib/perf';
import { gradeAfterTakeoff, gradeEngineFire, gradeField, gradeFireResponse, gradeGlideChoice, gradePartialPower } from '../../scenarios/emergency';
import { resolveRef } from '../../refs/resolve';
import { emergencyLessons } from '../emergencies';
import { lessonContext } from '../practice';
import { checkBlank, scoreLesson } from '../progress';
import { modules } from '../modules';
import type { Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };
const p = sampleTrainerPerformance();

const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', lessonContext(KASH, sampleC172K, mins, NOW)],
  ['east variation, high field', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
] as const;

type Decide = Extract<Step, { kind: 'decide' }>;
const decide = (steps: Step[], id: string) => steps.find((s) => s.id === id && s.kind === 'decide') as Decide;
const best = (d: Decide) => Object.entries(d.grades).filter(([, g]) => g === 'best').map(([id]) => id);

describe('engine-out arithmetic', () => {
  it('works the glide from the airplane, and the wind scales the range', () => {
    // 65 kt at 9:1 is about 731 ft/min.
    expect(Math.round(glideSinkFpm(p))).toBe(731);
    expect(glideReachNm(p, 6076, 0, 0, 0)).toBe(9);
    expect(headwindOn(270, 270, 20)).toBeCloseTo(20);
    expect(headwindOn(90, 270, 20)).toBeCloseTo(-20);
    // A 13 kt headwind on a 65 kt glide leaves 80 percent of the range.
    expect(glideReachNm(p, 6076, 270, 270, 13)).toBe(7.2);
    expect(glideReachNm(p, 6076, 90, 270, 13)).toBe(10.8);
    const r = reach(p, 3000, 0, 2, 0, 0);
    expect(r.reachNm).toBe(3);
    expect(r.reachable).toBe(true);
    expect(reach(p, 3000, 0, 2, 0, 0, 2000).reachable).toBe(false);
  });

  it('finds the least height lost in a gliding turn near 45°', () => {
    const lost = [20, 30, 45, 60, 70].map((b) => glidingTurn(p, b, 180).altitudeLostFt);
    expect(Math.min(...lost)).toBe(lost[2]);
    const t = glidingTurn(p, 45, TURNBACK_DEG);
    expect(t.loadFactor).toBe(1.41);
    expect(t.stallRisePct).toBe(19);
    expect(t.speedKias).toBe(77);
    // AFH example: a standard-rate turn at 65 kt (about 10° of bank) takes a minute for 180°, on a 2,100 ft radius.
    const std = glidingTurn(p, 10, 180);
    expect(std.seconds).toBeGreaterThanOrEqual(58);
    expect(std.seconds).toBeLessThanOrEqual(62);
    expect(Math.abs(std.radiusFt - 2100)).toBeLessThan(100);
  });

  it('cannot turn back from below the height the turn costs', () => {
    const tb = turnback(p, { failureAglFt: 300, climbFpm: 640, headwindKt: 8 });
    expect(tb.turnCompletes).toBe(false);
    expect(tb.reactionLossFt).toBe(50);
    const high = turnback(p, { failureAglFt: 1500, climbFpm: 640, headwindKt: 8 });
    expect(high.turnCompletes).toBe(true);
    expect(high.outFt).toBeGreaterThan(tb.outFt);
  });

  it('checks a field for reach, wind, length and surface', () => {
    const base = { id: 'f', name: 'F', bearingTrue: 0, distanceNm: 0.5, lengthFt: 2000, landingTrue: 270, surface: 'mown' as const, obstacleFt: 0 };
    const o = { heightAglFt: 2000, elevationFt: 0, oatC: 15, windFromTrue: 270, windKt: 12 };
    const into = checkField(p, base, o);
    const down = checkField(p, { ...base, landingTrue: 90 }, o);
    expect(into.headwindKt).toBe(12);
    expect(down.headwindKt).toBe(-12);
    expect(down.needFt).toBeGreaterThan(into.needFt);
    expect(checkField(p, { ...base, obstacleFt: 50 }, o).needFt).toBeGreaterThan(into.needFt);
    expect(checkField(p, { ...base, lengthFt: 100 }, o).fits).toBe(false);
    expect(checkField(p, { ...base, surface: 'plowed' }, o).rough).toBe(true);
    expect(checkField(p, { ...base, distanceNm: 5 }, o).reach.reachable).toBe(false);
  });
});

describe('emergency grades', () => {
  it('lands ahead after takeoff, and never stays in the climb attitude', () => {
    expect(gradeAfterTakeoff({ turnCompletes: false, aheadReachable: true, sideReachable: false }))
      .toEqual({ 'land-ahead': 'best', 'turn-back': 'unsafe', 'side-field': 'unsafe', 'restart-first': 'unsafe' });
    expect(gradeAfterTakeoff({ turnCompletes: true, aheadReachable: true, sideReachable: true })['turn-back']).toBe('marginal');
  });
  it('picks the airport with the most margin, and a field when none is in reach', () => {
    const g = gradeGlideChoice([{ id: 'A', reachable: true, marginNm: 1 }, { id: 'B', reachable: true, marginNm: 2 }, { id: 'C', reachable: false, marginNm: -1 }]);
    expect(g).toMatchObject({ 'glide-a': 'acceptable', 'glide-b': 'best', 'glide-c': 'unsafe', 'off-airport': 'acceptable' });
    expect(gradeGlideChoice([{ id: 'A', reachable: false, marginNm: -1 }])['off-airport']).toBe('best');
  });
  it('takes the fuel or the power away from a fire, then lands', () => {
    expect(gradeFireResponse({ id: 'x', cutsSource: true, landsSoon: true })).toBe('best');
    expect(gradeFireResponse({ id: 'x', cutsSource: true, landsSoon: false })).toBe('marginal');
    expect(gradeFireResponse({ id: 'x', cutsSource: false, landsSoon: true })).toBe('unsafe');
    expect(gradeEngineFire([
      { id: 'a', cutsFuel: true, restarts: false, minutesToGround: 3 },
      { id: 'b', cutsFuel: true, restarts: false, minutesToGround: 5 },
      { id: 'c', cutsFuel: false, restarts: false, minutesToGround: 4 },
      { id: 'd', cutsFuel: true, restarts: true, minutesToGround: 4 },
      { id: 'e', cutsFuel: true, restarts: false, minutesToGround: null },
    ])).toEqual({ a: 'best', b: 'acceptable', c: 'unsafe', d: 'unsafe', e: 'unsafe' });
  });
  it('grades fields in the order you check them', () => {
    expect(gradeField({ reachable: false, fits: true, rough: false, headwindKt: 10 })).toBe('unsafe');
    expect(gradeField({ reachable: true, fits: false, rough: false, headwindKt: 10 })).toBe('unsafe');
    expect(gradeField({ reachable: true, fits: true, rough: true, headwindKt: 10 })).toBe('marginal');
    expect(gradeField({ reachable: true, fits: true, rough: false, headwindKt: -5 })).toBe('marginal');
    expect(gradeField({ reachable: true, fits: true, rough: false, headwindKt: 5 })).toBe('best');
  });
  it('diverts on partial power', () => {
    expect(gradePartialPower({ nearestInGlide: true, homeInGlide: false, homeIsNearest: false }))
      .toEqual({ nearest: 'best', 'press-home': 'unsafe', 'field-now': 'acceptable', circle: 'marginal' });
    expect(gradePartialPower({ nearestInGlide: false, homeInGlide: false, homeIsNearest: false })['field-now']).toBe('best');
  });
});

describe.each(contexts)('module 6 lessons: %s', (_name, ctx) => {
  it.each(emergencyLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, lesson) => {
    const steps = lesson.build(ctx);
    expect(steps.length).toBeGreaterThan(2);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps[0].kind).toBe('brief');
    for (const s of steps) {
      const text = JSON.stringify(s);
      expect(text).not.toMatch(/NaN|undefined|Infinity|—|!/);
      if (s.figure?.kind === 'perf') expect(s.figure.sample).toBe(true);
      if (s.figure?.kind === 'glide') {
        expect(s.figure.rangeNm).toBeGreaterThan(0);
        for (const f of s.figure.fields) expect(Number.isFinite(f.distanceNm)).toBe(true);
      }
      if (s.figure?.kind === 'chart') for (const id of s.figure.route ?? []) expect(chartAirport(id)).toBeDefined();
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
        expect(best(s).length).toBeGreaterThan(0);
      }
    }
    // Every label opens something.
    for (const r of lesson.refs) for (const l of resolveRef(r)) if (l.kind === 'text') expect(r).toMatch(/^POH\b/);
  });

  it('6.1 makes landing ahead best and the turn back unsafe', () => {
    const d = decide(emergencyLessons[0].build(ctx), 'd1');
    expect(d.grades).toMatchObject({ 'land-ahead': 'best', 'turn-back': 'unsafe', 'side-field': 'unsafe', 'restart-first': 'unsafe' });
  });

  it('6.2 lets the wind decide: the field behind is in reach, the one ahead is not', () => {
    const d = decide(emergencyLessons[1].build(ctx), 'd1');
    expect(d.grades).toMatchObject({ 'glide-kxyz': 'best', 'glide-2x5': 'unsafe', 'off-airport': 'acceptable', 'troubleshoot-first': 'marginal' });
    expect(d.figure?.kind === 'glide' && d.figure.fields.map((f) => f.reachable)).toEqual([false, true]);
  });

  it('6.3 cuts the source, then takes the fastest way down', () => {
    const steps = emergencyLessons[2].build(ctx);
    expect(best(decide(steps, 'd1'))).toEqual(['master-off']);
    const d2 = decide(steps, 'd2');
    expect(d2.grades).toEqual({ 'cutoff-descend': 'best', 'cutoff-glide': 'acceptable', 'keep-running': 'unsafe', restart: 'unsafe' });
  });

  it('6.4 has one field that passes all four tests', () => {
    const d = decide(emergencyLessons[3].build(ctx), 'd1');
    expect(d.grades).toEqual({ hayfield: 'best', pasture: 'marginal', plowed: 'marginal', 'sod-farm': 'unsafe' });
    expect(d.why).toMatch(/hayfield passes all four.*pasture fails wind.*plowed field fails surface.*sod farm fails reach/);
  });

  it('6.5 diverts to the nearest runway inside the glide', () => {
    const d = decide(emergencyLessons[4].build(ctx), 'd1');
    expect(d.grades).toEqual({ nearest: 'best', 'press-home': 'unsafe', 'field-now': 'acceptable', circle: 'marginal' });
  });
});

describe('module 6 follows the airplane', () => {
  it('reads the pilot\'s own performance and drops the sample label', () => {
    const own = { ...sampleTrainerPerformance(), glideRatio: 11, bestGlideKias: 70 };
    const ctx = lessonContext(KASH, { ...sampleC172K, performance: own, sampleValues: false }, mins, NOW);
    for (const l of emergencyLessons) {
      const text = JSON.stringify(l.build(ctx));
      expect(text).not.toMatch(/\*\*sample\*\*/);
    }
    const e1 = emergencyLessons[0].build(ctx).find((s) => s.id === 'e1');
    expect(JSON.stringify(e1)).toMatch(/70 knots with a glide ratio of 11 to 1/);
  });

  it('follows the engine when a better glide changes the answer', () => {
    // A very good glider reaches Mill Pond into the wind too; the copy and grades follow.
    const own = { ...sampleTrainerPerformance(), glideRatio: 16 };
    const ctx = lessonContext(KASH, { ...sampleC172K, performance: own, sampleValues: false }, mins, NOW);
    const d = decide(emergencyLessons[1].build(ctx), 'd1');
    expect(d.grades['glide-2x5']).not.toBe('unsafe');
    expect(d.consequence['glide-2x5']).toMatch(/to spare/);
  });

  it('scores a lesson and lists module 6 as written', () => {
    const steps = emergencyLessons[0].build(contexts[0][1]);
    const r = scoreLesson(steps, { blanks: {}, decisions: { d1: { choice: 'land-ahead' } } });
    expect(r.grade).toBe('best');
    const m6 = modules.find((m) => m.n === 6)!;
    expect(m6.lessons.map((l) => l.id)).toEqual(['6.1', '6.2', '6.3', '6.4', '6.5']);
    expect(m6.outline).toEqual([]);
  });
});

describe('module 6 situations', () => {
  const ctx = lessonContext(null, blankAircraft, defaultPilot.minimums, new Date(Date.UTC(2026, 9, 24, 16, 20)));
  const g = (id: string, variant: number) => (emergencyLessons.find((l) => l.id === id)!.build({ ...ctx, variant }).find((s) => s.kind === 'decide') as Extract<Step, { kind: 'decide' }>).grades;
  it('the best field follows what is really out there', () => {
    expect(g('6.1', 1)).toMatchObject({ 'side-field': 'best', 'land-ahead': 'marginal' });
    expect(g('6.2', 0)['glide-kxyz']).toBe('best');
    expect(g('6.2', 1)).toMatchObject({ 'glide-2x5': 'best', 'glide-kxyz': 'unsafe' });
    expect(g('6.4', 1).pasture).toBe('best');
    expect(g('6.5', 1)).toMatchObject({ 'press-home': 'best', 'field-now': 'acceptable' });
  });
});
