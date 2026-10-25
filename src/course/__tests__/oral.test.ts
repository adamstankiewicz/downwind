import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K, type AircraftProfile } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { parseTaf } from '../../lib/taf';
import { calendarStatus, dateOnly, daysBetween, endOfCalendarMonth, flightReviewStatus, passengerCurrency } from '../calendar';
import { reviewSummary } from '../flightReview';
import { exampleReview, grassStrip, inspectionDates, oralLessons, weekendTrip } from '../oral';
import {
  forecastFor, gradeForecastWindow, gradeInop, gradeLoading, gradeReviewLapse, gradeRunway, INOP_FUEL_GAUGE, INOP_LANDING_LIGHT, INOP_POSITION_LIGHTS,
  maxFuelThatFits, oralAirplane, weighTrip,
} from '../oralChecks';
import { lessonContext } from '../practice';
import { checkBlank, scoreLesson } from '../progress';
import { modules } from '../modules';
import type { LessonContext, Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };

const contexts: [string, LessonContext][] = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', { ...lessonContext(KASH, sampleC172K, mins, NOW), lastFlightReview: '2025-03-09' }],
  ['east variation, high field', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
];

const decide = (steps: Step[], id: string) => steps.find((s) => s.id === id && s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const turn = (steps: Step[], id: string) => steps.find((s) => s.id === id && s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
const blank = (steps: Step[], t: string, b: string) => turn(steps, t).blanks.find((x) => x.id === b)!;
const d = (iso: string) => dateOnly(iso);

describe('calendar rules', () => {
  it('runs calendar months to the end of the month', () => {
    expect(endOfCalendarMonth(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(endOfCalendarMonth(d('2024-03-03'), 24).toISOString().slice(0, 10)).toBe('2026-03-31');
    const s = calendarStatus(d('2025-10-14'), 12, d('2026-10-31'));
    expect(s.current).toBe(true);
    expect(s.daysLeft).toBe(0);
    expect(calendarStatus(d('2025-10-14'), 12, d('2026-11-01')).current).toBe(false);
  });

  it('reads the flight review date from the pilot profile', () => {
    expect(flightReviewStatus(null, NOW)).toBeNull();
    expect(flightReviewStatus('not a date', NOW)).toBeNull();
    const s = flightReviewStatus('2024-10-03', d('2026-10-24'))!;
    expect(s.dueEnd.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(s.daysLeft).toBe(7);
  });

  it('counts passenger currency over the preceding 90 days', () => {
    const on = d('2026-10-24');
    expect(daysBetween(d('2026-07-26'), on)).toBe(90);
    expect(passengerCurrency([d('2026-07-26'), d('2026-08-01'), d('2026-09-01')], on)).toMatchObject({ inWindow: 3, current: true });
    expect(passengerCurrency([d('2026-07-25'), d('2026-08-01'), d('2026-09-01')], on)).toMatchObject({ inWindow: 2, current: false });
  });
});

describe('module 9 checks', () => {
  const plane = oralAirplane(sampleC172K);
  const trip = { climbMin: 8, cruiseMin: 40, night: false };

  it('falls back to the sample trainer when the airplane has no numbers, and says so', () => {
    expect(oralAirplane(blankAircraft)).toMatchObject({ standIn: true, sample: true });
    expect(oralAirplane(sampleC172K)).toMatchObject({ standIn: false, sample: true });
    const own: AircraftProfile = { ...sampleC172K, sampleValues: false };
    expect(oralAirplane(own).sample).toBe(false);
    expect(oralAirplane({ ...own, performance: undefined }).sample).toBe(true);
  });

  it('finds the most fuel that fits and grades the loading by the limits', () => {
    const load = { frontLb: 360, rearLb: 310, bagsLb: 40, bagStation: 'bag1' };
    const fit = maxFuelThatFits(sampleC172K, load)!;
    expect(weighTrip(sampleC172K, load, fit).overGross).toBe(false);
    expect(weighTrip(sampleC172K, load, fit + 1).overGross).toBe(true);
    const g = gradeLoading(plane, load, trip);
    expect(g.grades).toEqual({ 'full-tanks': 'unsafe', 'leave-bags': 'unsafe', 'fuel-to-fit': 'best', cancel: 'acceptable' });
    // Nobody in the back: everything fits, full tanks is the best answer.
    expect(gradeLoading(plane, { ...load, rearLb: 0 }, trip).grades['full-tanks']).toBe('best');
    // Too heavy even with empty tanks: staying home is the only answer.
    const heavy = gradeLoading(plane, { ...load, frontLb: 400, rearLb: 400 }, trip);
    expect(heavy.grades.cancel).toBe('best');
    expect(heavy.grades['fuel-to-fit']).toBe('unsafe');
  });

  it('reads the forecast over the whole flight, change groups at their worst', () => {
    const taf = parseTaf('TAF KXYZ 241720Z 2418/2518 22008KT P6SM SCT050 FM242100 18010KT 5SM -RA BKN025 TEMPO 2422/2424 2SM BR OVC008');
    const start = new Date(Date.UTC(2026, 9, 24, 18));
    expect(forecastFor(taf, start, 1)).toMatchObject({ ceilingFt: null });
    expect(forecastFor(taf, start, 3.5)).toMatchObject({ ceilingFt: 2500, visibilitySm: 5 });
    expect(gradeForecastWindow(taf, start, 1, mins)).toBe('best');
    expect(gradeForecastWindow(taf, start, 2.5, mins)).toBe('acceptable');
    expect(gradeForecastWindow(taf, start, 3.5, mins)).toBe('marginal');
    expect(gradeForecastWindow(taf, start, 3.5, { ...mins, ceilingFt: 2000 })).toBe('acceptable');
    expect(gradeForecastWindow(taf, start, 3, { ...mins, ceilingFt: 2000 })).toBe('best');
    expect(gradeForecastWindow(taf, new Date(Date.UTC(2026, 9, 24, 22)), 1, mins)).toBe('unsafe');
  });

  it('applies 91.213(d) and 91.205 to inoperative equipment', () => {
    expect(gradeInop(INOP_LANDING_LIGHT, false)['placard-fly']).toBe('best');
    expect(gradeInop(INOP_LANDING_LIGHT, true)['placard-fly']).toBe('best');
    expect(gradeInop(INOP_FUEL_GAUGE, false)).toMatchObject({ 'placard-fly': 'unsafe', 'fix-first': 'best' });
    expect(gradeInop(INOP_POSITION_LIGHTS, false)['placard-fly']).toBe('best');
    expect(gradeInop(INOP_POSITION_LIGHTS, true)['placard-fly']).toBe('unsafe');
    expect(gradeInop({ ...INOP_LANDING_LIGHT, requiredByAirplane: true }, false)['fly-as-is']).toBe('unsafe');
  });

  it('grades a runway against the book number and the margin', () => {
    expect(gradeRunway(2200, 2100)).toBe('unsafe');
    expect(gradeRunway(1800, 2100)).toBe('marginal');
    expect(gradeRunway(1400, 2100)).toBe('best');
  });

  it('grades a lapsed review', () => {
    expect(gradeReviewLapse(calendarStatus(d('2024-08-10'), 24, d('2026-10-24')))).toMatchObject({ 'fly-solo': 'unsafe', 'review-first': 'best' });
    expect(gradeReviewLapse(calendarStatus(d('2025-08-10'), 24, d('2026-10-24')))['fly-friend']).toBe('best');
  });
});

describe.each(contexts)('module 9 lessons: %s', (_name, ctx) => {
  it.each(oralLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, lesson) => {
    const steps = lesson.build(ctx);
    expect(steps.length).toBeGreaterThan(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      if (s.kind === 'turn') {
        for (const b of s.blanks) {
          if (typeof b.answer === 'number') expect(Number.isFinite(b.answer), `${s.id}.${b.id}`).toBe(true);
          else expect(b.choices, `${s.id}.${b.id}`).toContain(b.answer);
          if (b.choices) expect(new Set(b.choices).size, `${s.id}.${b.id} choices`).toBe(b.choices.length);
          expect(checkBlank(b, String(b.answer))).toBe(true);
        }
      }
      if (s.kind === 'decide') {
        expect(s.options.length).toBeGreaterThanOrEqual(3);
        for (const o of s.options) {
          expect(s.grades[o.id], `${s.id}.${o.id}`).toBeTruthy();
          expect(s.consequence[o.id], `${s.id}.${o.id}`).toBeTruthy();
        }
        expect(Object.values(s.grades)).toContain('best');
      }
      if (s.figure?.kind === 'perf') expect(s.figure.sample).toBe(true);
      if (s.figure?.kind === 'navlog') expect(s.figure.log.legs.every((l) => Number.isFinite(l.minutes))).toBe(true);
    }
    // No real airport or airplane is assumed: copy only names them when the pilot picked them.
    const text = JSON.stringify(steps);
    expect(text).not.toMatch(/—|!/);
    if (ctx.practiceField && ctx.aircraft === blankAircraft) expect(text).not.toMatch(/KASH|Cessna|C172|Skyhawk/);
  });
});

describe('module 9 teaches what it says', () => {
  for (const [name, ctx] of contexts) {
    it(`9.1 needs one more landing, trades fuel for people, and leaves before the rain (${name})`, () => {
      const steps = oralLessons[0].build(ctx);
      expect(blank(steps, 't1', 'count').answer).toBe(2);
      expect(blank(steps, 't1', 'current').answer).toBe('No');
      const t = weekendTrip(ctx);
      expect(t.full.overGross).toBe(true);
      expect(blank(steps, 't4', 'over').answer).toBe(t.full.totalLb - t.plane.aircraft.maxGrossLb);
      expect(decide(steps, 'd1').grades).toEqual({ 'full-tanks': 'unsafe', 'leave-bags': 'unsafe', 'fuel-to-fit': 'best', cancel: 'acceptable' });
      expect(t.fit.fuel.marginGal).toBeGreaterThan(0);
      expect(blank(steps, 't3', 'alt').answer).toBe(t.cruiseMsl.toLocaleString('en-US'));
      expect(t.cruiseMsl).toBeGreaterThanOrEqual(t.mef + 1000);
      expect(t.cruiseMsl % 2000).toBe(500);
      expect(blank(steps, 't3', 'cls').answer).toBe('E');
      expect(decide(steps, 'd2').grades).toMatchObject({ 'leave-now': 'best', 'leave-late': 'unsafe', 'under-it': 'unsafe', stay: 'acceptable' });
    });

    it(`9.2 lapses the ELT, grounds the gauge, and moves lunch to the paved field (${name})`, () => {
      const steps = oralLessons[1].build(ctx);
      const dates = inspectionDates(ctx.now);
      expect(dates.annualStatus.current).toBe(true);
      expect(dates.eltStatus.current).toBe(false);
      expect(dates.xpdrStatus.current).toBe(true);
      expect(blank(steps, 't1', 'eltok').answer).toBe('No');
      expect(decide(steps, 'd1').grades['placard-fly']).toBe('best');
      expect(decide(steps, 'd2').grades['fix-first']).toBe('best');
      const s = grassStrip(ctx);
      expect(s.hot.over50Ft).toBeGreaterThan(s.strip.runwayFt);
      expect(decide(steps, 'd3').grades).toMatchObject({ 'go-afternoon': 'unsafe', 'go-morning': 'marginal', 'other-field': 'best' });
    });

    it(`9.3 counts the review to month end (${name})`, () => {
      const steps = oralLessons[2].build(ctx);
      const ex = exampleReview(ctx.now);
      expect(ex.status.current).toBe(true);
      expect(ex.status.dueEnd.getUTCMonth()).toBe(ctx.now.getUTCMonth());
      expect(decide(steps, 'd1').grades['fly-solo']).toBe('unsafe');
      const e1 = steps.find((x) => x.id === 'e1')!;
      expect(e1.title).toBe(ctx.lastFlightReview ? 'Your date' : 'An example date');
    });
  }

  it('scores a full run of 9.1 by the worst decision', () => {
    const ctx = contexts[0][1];
    const steps = oralLessons[0].build(ctx);
    const answers = { blanks: {}, decisions: { d1: { choice: 'fuel-to-fit' }, d2: { choice: 'leave-late' } } };
    expect(scoreLesson(steps, answers).grade).toBe('unsafe');
    expect(scoreLesson(steps, { blanks: {}, decisions: { d1: { choice: 'fuel-to-fit' }, d2: { choice: 'leave-now' } } }).grade).toBe('best');
  });

  it('writes module 9 with no outline left', () => {
    const m = modules.find((x) => x.n === 9)!;
    expect(m.lessons.map((l) => l.id)).toEqual(['9.1', '9.2', '9.3']);
    expect(m.outline).toEqual([]);
  });
});

describe('flight review summary', () => {
  const done = (grade: 'best' | 'marginal' | 'unsafe') => ({ attempts: 1, completedAt: NOW.toISOString(), lastAt: NOW.toISOString(), lastGrade: grade, bestGrade: grade, lcg: 'Practice' as const });

  it('is empty but honest before anything is flown', () => {
    const s = reviewSummary({}, [], null, NOW);
    expect(s.review).toBeNull();
    expect(s.lessonsFlown).toBe(0);
    expect(s.tasksFlown).toEqual([]);
    expect(s.tasksOpen).toContain('PA.I.C');
    expect(s.briefings).toBe(0);
  });

  it('lists what was flown, what to refly, and what briefings flagged', () => {
    const log = [
      { id: '1', filedAt: NOW.toISOString(), station: 'KXYZ', source: 'sample' as const, departure: NOW.toISOString(), choice: 'go' as const, grade: 'unsafe' as const, readingsRight: 1, readingsTotal: 2,
        findings: [{ title: 'Crosswind above your personal minimum', severity: 'personal' as const }, { title: 'No nearby TAF', severity: 'info' as const }] },
      { id: '2', filedAt: NOW.toISOString(), station: 'KXYZ', source: 'sample' as const, departure: NOW.toISOString(), choice: 'cancel' as const, grade: 'best' as const, readingsRight: 1, readingsTotal: 1,
        findings: [{ title: 'Crosswind above your personal minimum', severity: 'personal' as const }] },
    ];
    const s = reviewSummary({ '2.1': done('best'), '2.2': done('unsafe'), '9.1': done('marginal') }, log, '2024-10-03', NOW);
    expect(s.review?.daysLeft).toBe(7);
    expect(s.lessonsFlown).toBe(3);
    expect(s.modules.find((m) => m.n === 2)!.toRefly.map((r) => r.id)).toEqual(['2.2']);
    expect(s.tasksFlown).toContain('PA.I.C');
    expect(s.flaggedOnBriefings).toEqual([{ title: 'Crosswind above your personal minimum', count: 2 }]);
    expect(s.askFor[0]).toMatch(/^2\.2 /);
    expect(s.askFor.some((a) => /Crosswind/.test(a))).toBe(true);
  });
});
