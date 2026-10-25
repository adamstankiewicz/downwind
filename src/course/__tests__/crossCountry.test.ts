import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K, type AircraftProfile } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { practiceRegion as R } from '../../chart/practiceRegion';
import { destination, distanceNm } from '../../lib/nav';
import { fuelPlan, sampleTrainerPerformance } from '../../lib/perf';
import {
  alongTrack, deadReckon, diversionFacts, fbGroup, fitsTheClock, gradeCruiseAltitudes, gradeDiversion, gradeFuelPlan, gradeLost, gradeSighting,
  legTo, lineCrosses, minutesToClearanceAirspace, navPoint, windAt, xcAirplane, type DiversionFacts,
} from '../../scenarios/crossCountry';
import { crossCountryLessons, lostSituation, routePlan } from '../crossCountry';
import { lessonContext } from '../practice';
import { checkBlank } from '../progress';
import { modules } from '../modules';
import type { Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };
// A pilot's own airplane, entered from their POH: faster, thirstier, bigger tanks.
const ownAirplane: AircraftProfile = {
  ...sampleC172K, type: 'Test single', sampleValues: false, usableFuelGal: 50,
  performance: { ...sampleTrainerPerformance(), cruise: { tasKt: 135, gph: 10.5 } },
};

const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', lessonContext(KASH, sampleC172K, mins, NOW)],
  ['east variation, high field, tight minimums', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
  ['own airplane', lessonContext(KASH, ownAirplane, mins, NOW)],
] as const;

const decide = (steps: Step[], id = 'd1') => steps.find((s) => s.id === id && s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const lesson = (id: string) => crossCountryLessons.find((l) => l.id === id)!;
const P = sampleTrainerPerformance();

function texts(s: Step): string[] {
  const out: string[] = [s.title];
  if (s.kind === 'brief') out.push(s.scene ?? '', s.say.full, s.say.short);
  if (s.kind === 'example') out.push(s.say.full, s.say.short, ...s.work.flatMap((w) => [w.label, w.value, w.note ?? '']));
  if (s.kind === 'turn') out.push(s.prompt, ...s.blanks.flatMap((b) => [b.label, b.explain]));
  if (s.kind === 'decide') out.push(s.situation, s.why, ...s.options.map((o) => o.label), ...Object.values(s.consequence));
  return out;
}

describe('cross-country engine', () => {
  it('names the airplane and labels sample numbers', () => {
    expect(xcAirplane(blankAircraft)).toMatchObject({ sample: true, name: 'the sample trainer', usableGal: 38 });
    expect(xcAirplane(sampleC172K).sample).toBe(true);
    expect(xcAirplane(ownAirplane)).toMatchObject({ sample: false, name: 'your Test single', usableGal: 50 });
  });

  it('grades the fuel plan against the legal and a half-hour-more reserve', () => {
    const plan = (onBoardGal: number) => fuelPlan(P, { climbMin: 10, cruiseMin: 60, night: false, onBoardGal });
    const need = plan(0).requiredGal;
    const g = (on: number, hasFuel = true) => gradeFuelPlan({ plan: plan(on), fullPlan: plan(38), gph: 8, destinationHasFuel: hasFuel });
    expect(g(need - 1).nonstop).toBe('unsafe');
    expect(g(need + 2).nonstop).toBe('marginal');
    expect(g(need + 5).nonstop).toBe('best');
    expect(g(need + 2)['top-off']).toBe('best');
    expect(g(need + 2, false)['fuel-stop']).toBe('unsafe');
  });

  it('writes and interpolates winds aloft', () => {
    expect(fbGroup({ altFt: 3000, dirTrue: 280, speedKt: 10, tempC: null })).toBe('2810');
    expect(fbGroup({ altFt: 6000, dirTrue: 290, speedKt: 22, tempC: 4 })).toBe('2922+04');
    expect(fbGroup({ altFt: 9000, dirTrue: 290, speedKt: 30, tempC: -1 })).toBe('2930-01');
    const levels = [{ altFt: 3000, dirTrue: 350, speedKt: 10, tempC: null }, { altFt: 6000, dirTrue: 10, speedKt: 20, tempC: 0 }];
    expect(windAt(levels, 4500)).toEqual({ dirTrue: 0, speedKt: 15 });
    expect(windAt(levels, 2000)).toEqual({ dirTrue: 350, speedKt: 10 });
    expect(windAt(levels, 9000)).toEqual({ dirTrue: 10, speedKt: 20 });
  });

  it('grades cruising altitudes: legal, then terrain, then time', () => {
    const g = gradeCruiseAltitudes({
      options: [{ altFt: 3500, minutes: 30 }, { altFt: 4500, minutes: 32 }, { altFt: 5500, minutes: 31 }, { altFt: 6500, minutes: 35 }],
      magCourses: [270, 265], lowestGroundFt: 700, mefFt: 2700,
    });
    expect(g).toEqual({ 3500: 'marginal', 4500: 'best', 5500: 'unsafe', 6500: 'acceptable' });
  });

  it('checks a landmark against the clock', () => {
    expect(fitsTheClock({ gsKt: 90, minutes: 10, checkpointAlongNm: 15 })).toMatchObject({ expectedNm: 15, fits: true });
    expect(fitsTheClock({ gsKt: 90, minutes: 4, checkpointAlongNm: 15 }).fits).toBe(false);
    expect(gradeSighting(false)).toEqual({ 'turn-now': 'marginal', 'hold-heading': 'best', circle: 'acceptable' });
    expect(gradeSighting(true)['turn-now']).toBe('best');
    const a = { lat: 42, lon: -72 };
    const b = destination(a, 90, 20);
    const right = destination(destination(a, 90, 10), 180, 2);
    const t = alongTrack(a, b, right);
    expect(t.alongNm).toBeCloseTo(10, 0);
    expect(t.crossNm).toBeCloseTo(2, 0);
  });

  it('works a leg the same way the nav log does', () => {
    const a = navPoint(R, 'KXYZ');
    const b = navPoint(R, 'harlow');
    const leg = legTo(a, b, { tasKt: 110, windFromTrue: 0, windKt: 0, variationDeg: -14, gph: 8 });
    expect(leg.magCourse).toBe(norm360(leg.trueCourse + 14));
    expect(leg.groundspeedKt).toBe(110);
    expect(leg.minutes).toBe(Math.round((leg.distanceNm / 110) * 60));
  });

  it('flags a line through weather', () => {
    const a = { lat: 42, lon: -72 };
    expect(lineCrosses(a, destination(a, 90, 30), destination(a, 90, 15), 3)).toBe(true);
    expect(lineCrosses(a, destination(a, 90, 30), destination(a, 0, 15), 3)).toBe(false);
  });

  it('grades a diversion: weather, fuel and runway first, then time', () => {
    const f = (id: string, minutes: number, more: Partial<DiversionFacts> = {}): DiversionFacts => ({
      field: { id, name: id, pos: { lat: 0, lon: 0 }, elevationFt: 0, runwayFt: 4000, surface: 'paved', fuel: true },
      leg: { trueCourse: 0, magCourse: 0, magHeading: 0, distanceNm: 10, groundspeedKt: 100, minutes, fuelGal: 1 },
      intoWeather: false, fuelMarginGal: 10, landingOver50Ft: 1200, runwayFactor: 3, ...more,
    });
    expect(gradeDiversion([
      f('a', 10, { intoWeather: true }), f('b', 12, { runwayFactor: 1.2 }), f('c', 14), f('d', 16), f('e', 5, { fuelMarginGal: -1 }), f('g', 5, { runwayFactor: 0.9 }),
    ])).toEqual({ a: 'unsafe', b: 'marginal', c: 'best', d: 'acceptable', e: 'unsafe', g: 'unsafe' });
  });

  it('computes the runway factor from the landing distance at the field', () => {
    const from = navPoint(R, 'KXYZ');
    const grass = { id: 'g', name: 'g', pos: destination(from, 0, 10), elevationFt: 820, runwayFt: 2100, surface: 'grass' as const, fuel: false };
    const [g] = diversionFacts({ from, fields: [grass], weather: { center: destination(from, 180, 50), radiusNm: 1 }, perf: P, tasKt: 110, windFromTrue: 0, windKt: 0, variationDeg: -14, fuelOnBoardGal: 20, surfaceTempC: 18, altimeterInHg: 29.92 });
    expect(g.runwayFactor).toBeCloseTo(2100 / g.landingOver50Ft, 2);
    expect(g.intoWeather).toBe(false);
    expect(g.fuelMarginGal).toBeCloseTo(20 - g.leg.fuelGal - 4, 1);
  });

  it('dead reckons with the wind', () => {
    const a = { lat: 42, lon: -72 };
    const still = deadReckon(a, 90, 120, 0, 0, 30);
    expect(distanceNm(a, still)).toBeCloseTo(60, 0);
    // A 20 knot wind from the north for half an hour moves you 10 nm south.
    const blown = deadReckon(a, 90, 120, 0, 20, 30);
    expect(distanceNm(still, blown)).toBeCloseTo(10, 0);
    expect(blown.lat).toBeLessThan(still.lat);
  });

  it('finds Class B and restricted airspace ahead', () => {
    const xbb = R.airports.find((a) => a.id === 'KXBB')!.pos;
    const outside = destination(xbb, 270, 30);
    expect(minutesToClearanceAirspace(R, outside, 90, 120, 5500)?.minutes).toBe(2);
    expect(minutesToClearanceAirspace(R, outside, 270, 120, 5500)).toBeNull();
    const r4101 = R.airspace.find((v) => v.id === 'r-4101')!;
    const pts = r4101.shape.kind === 'polygon' ? r4101.shape.points : [];
    const center = { lat: pts.reduce((n, q) => n + q.lat, 0) / pts.length, lon: pts.reduce((n, q) => n + q.lon, 0) / pts.length };
    expect(minutesToClearanceAirspace(R, destination(center, 270, 10), 90, 120, 2500)).toEqual({ minutes: 2, name: 'R-4101' });
    expect(gradeLost({ enduranceAfterReserveMin: 60, minutesBackToFix: 20, minutesToClearanceAirspace: 10, obstacleWithin5NmAboveDescentAlt: false }))
      .toEqual({ 'climb-call': 'best', reverse: 'acceptable', 'descend-look': 'marginal', 'press-on': 'unsafe' });
    expect(gradeLost({ enduranceAfterReserveMin: 10, minutesBackToFix: 20, minutesToClearanceAirspace: null, obstacleWithin5NmAboveDescentAlt: true }))
      .toMatchObject({ reverse: 'marginal', 'descend-look': 'unsafe', 'press-on': 'marginal' });
  });
});

function norm360(n: number) {
  return ((n % 360) + 360) % 360;
}

describe.each(contexts)('module 5 lessons: %s', (_name, ctx) => {
  it.each(crossCountryLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, l) => {
    const steps = l.build(ctx);
    expect(steps.length).toBeGreaterThan(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    const plane = xcAirplane(ctx.aircraft);
    for (const s of steps) {
      for (const t of texts(s)) {
        expect(t, `${l.id} ${s.id}`).not.toMatch(/NaN|undefined|Infinity|null|—|!/);
      }
      if (s.kind === 'example') expect(new Set(s.work.map((w) => w.label)).size).toBe(s.work.length);
      if (s.kind === 'turn') {
        for (const b of s.blanks) {
          if (typeof b.answer === 'number') expect(Number.isFinite(b.answer)).toBe(true);
          else expect(b.choices).toContain(b.answer);
          expect(checkBlank(b, String(b.answer))).toBe(true);
        }
      }
      if (s.kind === 'decide') {
        expect(s.options.length).toBeGreaterThanOrEqual(3);
        expect(s.options.length).toBeLessThanOrEqual(4);
        for (const o of s.options) {
          expect(['best', 'acceptable', 'marginal', 'unsafe']).toContain(s.grades[o.id]);
          expect(s.consequence[o.id]).toBeTruthy();
        }
        expect(s.options.some((o) => s.grades[o.id] === 'best')).toBe(true);
      }
      if (s.showIf) expect(steps.some((x) => x.id === s.showIf!.step)).toBe(true);
      if (s.figure?.kind === 'chart') {
        for (const id of [...(s.figure.route ?? []), ...(s.figure.highlight ?? [])]) {
          expect([...R.airports, ...R.checkpoints, ...R.airspace, ...R.obstacles].some((x) => x.id === id), id).toBe(true);
        }
      }
    }
    // Sample numbers are labeled where they are used.
    expect(steps[0].kind === 'brief' && /sample values/.test(steps[0].scene ?? '')).toBe(plane.sample);
  });
});

describe('module 5 teaches what it says', () => {
  for (const [name, ctx] of contexts.slice(0, 3)) {
    it(`5.1 makes nonstop legal but thin (${name})`, () => {
      const d = decide(lesson('5.1').build(ctx));
      expect(d.grades).toMatchObject({ nonstop: 'marginal', 'top-off': 'best', 'fuel-stop': 'best', shorter: 'acceptable' });
    });
    it(`5.2 picks the legal altitude with terrain margin (${name})`, () => {
      const steps = lesson('5.2').build(ctx);
      expect(decide(steps).grades).toMatchObject({ 'alt-3500': 'marginal', 'alt-4500': 'best', 'alt-5500': 'unsafe', 'alt-6500': 'acceptable' });
      const turn = steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
      expect(turn.blanks.find((b) => b.id === 'wspd')!.answer).toBe(23);
    });
    it(`5.3 sights a lake that does not fit the clock (${name})`, () => {
      const steps = lesson('5.3').build(ctx);
      expect(decide(steps).grades['hold-heading']).toBe('best');
      expect(decide(steps).grades['turn-now']).toBe('marginal');
      const turn = steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
      // The stronger wind costs time on the first leg.
      expect(turn.blanks.find((b) => b.id === 'gs')!.answer).toBeLessThan(100);
    });
    it(`5.4 diverts to a field that is really there (${name})`, () => {
      const d = decide(lesson('5.4').build(ctx));
      expect(d.grades['press-on']).toBe('unsafe');
      expect(d.grades['mill-pond']).toBe('marginal');
      expect(d.grades.ridgeback).toBe('best');
      expect(d.grades.home).toBe('acceptable');
    });
    it(`5.5 climbs and calls, and pressing on runs into the Class B (${name})`, () => {
      const steps = lesson('5.5').build(ctx);
      const d = decide(steps);
      expect(d.grades['climb-call']).toBe('best');
      expect(d.grades['press-on']).toBe('unsafe');
      expect(steps.find((s) => s.id === 'b2')?.figure?.kind).toBe('chart');
    });
  }

  it('plans the route a thousand feet over the maximum elevation figure on the correct side', () => {
    const p = routePlan(xcAirplane(blankAircraft));
    expect(p.cruiseFt).toBeGreaterThanOrEqual(p.mefFt + 1000);
    expect(p.cruiseFt % 2000).toBe(500);
    expect(p.climbMin).toBeGreaterThan(0);
  });

  it('puts the lost airplane right of course and inside fuel', () => {
    const s = lostSituation(xcAirplane(blankAircraft));
    expect(s.off.crossNm).toBeGreaterThan(3);
    expect(s.ahead?.name).toMatch(/Class B/);
    expect(s.enduranceAfterReserve).toBeGreaterThan(s.back.minutes);
  });

  it('is written and listed in the course', () => {
    const m = modules.find((x) => x.n === 5)!;
    expect(m.lessons.map((l) => l.id)).toEqual(['5.1', '5.2', '5.3', '5.4', '5.5']);
    expect(m.outline).toEqual([]);
    for (const l of m.lessons) expect(l.acs.every((a) => /^PA\.[IVX]+\.[A-Z]$/.test(a))).toBe(true);
  });
});
