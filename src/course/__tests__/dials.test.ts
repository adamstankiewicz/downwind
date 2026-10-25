import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { parseMetar } from '../../lib/metar';
import { buildBrief } from '../../scenarios/goNoGo';
import { weatherLessons } from '../weather';
import { performanceLessons } from '../performance';
import { lessonContext } from '../practice';
import { emptyAnswers, scoreLesson } from '../progress';
import { ceilingDials, ceilingMetar, initialValues, lowestGoCeiling, maxGustWithin, warmestWithMargin, windDials, type DialsStep } from '../dials';
import { lessonAirplane } from '../airplane';
import type { DialValues, Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };

const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', lessonContext(KASH, sampleC172K, mins, NOW)],
  ['east variation, high field', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
] as const;

const GRADES = ['best', 'acceptable', 'marginal', 'unsafe'];
const dialsOf = (steps: Step[]) => steps.filter((s): s is DialsStep => s.kind === 'dials');
const decideOf = (steps: Step[], id: string) => steps.find((s) => s.id === id && s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const lessons = [weatherLessons[1], weatherLessons[3], performanceLessons.find((l) => l.id === '3.3')!];

/** Every setting along each dial, the others held at the lesson's values. */
function sweep(step: DialsStep): DialValues[] {
  const start = initialValues(step);
  return step.dials.flatMap((d) => {
    const out: DialValues[] = [];
    for (let v = d.min; v <= d.max; v += d.step) out.push({ ...start, [d.id]: v });
    return out;
  });
}

describe.each(contexts)('dials: %s', (_name, ctx) => {
  it.each(lessons.map((l) => [l.id, l] as const))('%s has a dials step the engine can evaluate anywhere', (_id, lesson) => {
    const steps = lesson.build(ctx);
    const [step] = dialsOf(steps);
    expect(step).toBeTruthy();
    for (const d of step.dials) {
      expect(d.initial).toBeGreaterThanOrEqual(d.min);
      expect(d.initial).toBeLessThanOrEqual(d.max);
    }
    for (const v of sweep(step)) {
      const s = step.evaluate(v);
      expect(s.figures.length).toBeGreaterThan(0);
      for (const r of s.readouts) expect(r.value).not.toMatch(/NaN|undefined|Infinity/);
      for (const l of s.lines) expect(l.say).not.toMatch(/NaN|undefined/);
      for (const o of s.verdict.options) expect(GRADES).toContain(s.verdict.grades[o.id]);
      expect(s.clear).not.toMatch(/NaN|undefined/);
    }
  });

  it.each(lessons.map((l) => [l.id, l] as const))('%s task has an engine answer that checks right', (_id, lesson) => {
    const step = dialsOf(lesson.build(ctx))[0];
    expect(step.task).toBeTruthy();
    const right = sweep(step).filter((v) => step.task!.check(v).right);
    expect(right.length).toBeGreaterThan(0);
    expect(right.length).toBeLessThan(sweep(step).length);
  });

  it('2.2 dials start on the lesson report and grade it as the decision does', () => {
    const steps = weatherLessons[1].build(ctx);
    const step = dialsOf(steps)[0];
    const s = step.evaluate(initialValues(step));
    expect(s.verdict.grades).toEqual(decideOf(steps, 'd1').grades);
    // The lesson sets the gust just over the pilot's line, so the line is crossed at the start.
    expect(s.lines.map((l) => l.id)).toContain('xw-personal');
  });

  it('2.2 the gust task answer is the last gust inside the minimum', () => {
    const step = dialsOf(weatherLessons[1].build(ctx))[0];
    const v = initialValues(step);
    const g = maxGustWithin(ctx, v.dir, v.speed, 40);
    if (g === null) return;
    expect(step.task!.check({ ...v, gust: g > v.speed ? g : 0 }).right).toBe(true);
    if (g < 40) expect(step.task!.check({ ...v, gust: g + 1 }).right).toBe(false);
    const at = step.evaluate({ ...v, gust: g + 1 });
    if (g < 40) expect(at.lines.map((l) => l.id)).toContain('xw-personal');
  });

  it('2.2 turning the wind past the beam picks the other runway and says so', () => {
    const step = dialsOf(weatherLessons[1].build(ctx))[0];
    const v = initialValues(step);
    const s = step.evaluate({ ...v, dir: ((v.dir + 180 - 1) % 360) + 1 });
    expect(s.readouts.find((r) => r.id === 'runway')!.value).not.toBe(ctx.airport.runways[0].id);
    expect(s.lines.map((l) => l.id)).toContain('runway-flip');
  });

  it('2.4 dials grade like the decision at the start, and illegal beats everything', () => {
    const steps = weatherLessons[3].build(ctx);
    const step = dialsOf(steps)[0];
    expect(step.evaluate(initialValues(step)).verdict.grades).toEqual(decideOf(steps, 'd1').grades);
    const low = step.evaluate({ ...initialValues(step), ceiling: 900 });
    if (ctx.airport.airspace !== 'G') {
      expect(low.verdict.grades.go).toBe('unsafe');
      expect(low.verdict.grades['go-plan']).toBe('unsafe');
      expect(low.lines[0].severity).toBe('illegal');
    }
  });

  it('2.4 the lowest go ceiling is the highest of the legal, pattern and personal lines', () => {
    const c = lowestGoCeiling(ctx, 10, { min: 300, max: 5000, step: 100 });
    expect(c).toBe(Math.max(1500, Math.ceil(ctx.minimums.ceilingFt / 100) * 100));
    // A squeezed pattern under a low personal minimum is still not a go.
    const b = buildBrief({ airport: ctx.airport, aircraft: ctx.aircraft, wb: null, minimums: { ...ctx.minimums, ceilingFt: 1000 }, metar: parseMetar(ceilingMetar(ctx, 1200, 10)), taf: null, departure: NOW, tripHours: 1 });
    expect(b.findings.some((f) => f.severity === 'personal' || f.severity === 'illegal')).toBe(false);
    const low = ceilingDials({ ...ctx, minimums: { ...ctx.minimums, ceilingFt: 1000 } }, { ceilingFt: 1200, visSm: 10 });
    const s = low.evaluate({ ceiling: 1200, vis: 10 });
    expect(s.lines.map((l) => l.id)).toContain('pattern-squeeze');
    expect(s.verdict.grades.go).toBe('marginal');
  });

  it('3.3 the warmest temperature with margin checks right, one degree warmer does not', () => {
    const steps = performanceLessons.find((l) => l.id === '3.3')!.build(ctx);
    const step = dialsOf(steps)[0];
    const ap = lessonAirplane(ctx.aircraft);
    const temps = ap.perf.takeoff.over50.tempsC;
    const v = initialValues(step);
    const s = step.evaluate(v);
    const runway = Number(s.readouts.find((r) => r.id === 'runway')!.value.replace(/[^\d]/g, ''));
    const t = warmestWithMargin({ perf: ap.perf, fieldElevFt: ctx.airport.elevationFt + 200, runwayFt: runway, surface: 'grass', sample: ap.samplePerf }, { min: temps[0], max: temps[temps.length - 1] });
    expect(t).not.toBeNull();
    expect(step.task!.check({ ...v, oat: t! }).right).toBe(true);
    if (t! < temps[temps.length - 1]) {
      expect(step.task!.check({ ...v, oat: t! + 1 }).right).toBe(false);
      expect(step.evaluate({ oat: t! + 1, wind: 0 }).verdict.grades.go).not.toBe('best');
    }
    expect(step.evaluate({ oat: t!, wind: 0 }).verdict.grades.go).toBe('best');
  });
});

describe('dials in scoring', () => {
  const ctx = contexts[0][1];
  it('a dials task counts as one of the lesson numbers', () => {
    const steps = weatherLessons[1].build(ctx);
    const step = dialsOf(steps)[0];
    const v = initialValues(step);
    const g = maxGustWithin(ctx, v.dir, v.speed, 40)!;
    const base = { ...emptyAnswers(), decisions: { d1: { choice: 'cancel' } } };
    const none = scoreLesson(steps, base);
    const right = scoreLesson(steps, { ...base, dialChecks: { [step.id]: { ...v, gust: g > v.speed ? g : 0 } } });
    expect(right.blanksTotal).toBe(none.blanksTotal);
    expect(right.blanksRight).toBe(none.blanksRight + 1);
  });

  it('wind dials need no lesson around them', () => {
    const d = windDials(ctx, { dirTrue: 90, speedKt: 10, gustKt: 0 });
    const s = d.evaluate({ dir: 90, speed: 10, gust: 0 });
    expect(s.readouts.find((r) => r.id === 'xwg')!.value).toBe('no gust');
  });
});
