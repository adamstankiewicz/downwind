import { describe, expect, it } from 'vitest';
import { parseMetar } from '../../lib/metar';
import { parseTaf } from '../../lib/taf';
import { destination, type LatLon } from '../../lib/nav';
import { blankAircraft } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { xcAirplane } from '../crossCountry';
import {
  amendedCeiling, cruiseAltitude, DEFAULT_TRIP_PREFS, diversionScene, forecastAt, gradeDiversionChoices, kindOf, pickRunway,
  pickVaried, planTrip, recommend, stopper, weatherAt, type PlanOptions, type TripField, type TripInputs,
} from '../trip';

const HOME: LatLon = { lat: 42.8, lon: -71.9 };
// Mid-morning local on an October day, so daylight isn't the question unless a test makes it one.
const NOW = new Date('2026-10-25T13:00:00Z');
const DEP = new Date('2026-10-25T14:00:00Z');

function field(id: string, brg: number, nm: number, o: Partial<TripField> & { sky?: string; wind?: string; vis?: string; tafText?: string } = {}): TripField {
  const raw = `METAR ${id} 251253Z ${o.wind ?? '27008KT'} ${o.vis ?? '10SM'} ${o.sky ?? 'FEW050'} 12/02 A3010 RMK AO2`;
  return {
    id, name: `Field ${id}`, pos: nm ? destination(HOME, brg, nm) : HOME, elevationFt: 300, variationDeg: -14, towered: false,
    runways: [{ id: '09/27', ends: [{ id: '09', headingMag: 90 }, { id: '27', headingMag: 270 }], lengthFt: 4000, surface: 'paved' }],
    metar: parseMetar(raw), taf: o.tafText ? parseTaf(o.tafText) : null, ...o,
  };
}

function inputs(fields: TripField[], winds = true): TripInputs {
  return {
    source: 'live', home: field('KHOM', 0, 0), fields, fetchedAt: NOW,
    winds: winds ? [{ id: 'WND', pos: HOME, levels: [
      { altFt: 3000, dirTrue: 270, speedKt: 20, tempC: null },
      { altFt: 6000, dirTrue: 270, speedKt: 30, tempC: 0 },
    ] }] : [],
  };
}

const opts = (o: Partial<PlanOptions> = {}): PlanOptions => ({
  airplane: xcAirplane(blankAircraft), minimums: defaultPilot.minimums, prefs: DEFAULT_TRIP_PREFS,
  demonstratedCrosswindKt: 15, departure: DEP, history: [], ...o,
});

describe('weather at a time', () => {
  const taf = parseTaf('TAF KAAA 251120Z 2512/2612 27010KT P6SM SCT050 TEMPO 2516/2518 BKN020 FM252000 30012KT P6SM BKN012');
  it('reads the prevailing period and the temporary groups over it', () => {
    const a = forecastAt(taf, new Date('2026-10-25T17:00:00Z'))!;
    expect(a.period.ceilingFtAgl).toBeNull();
    expect(a.temporary.map((p) => p.ceilingFtAgl)).toEqual([2000]);
    expect(forecastAt(taf, new Date('2026-10-25T21:00:00Z'))!.period.ceilingFtAgl).toBe(1200);
    expect(forecastAt(taf, new Date('2026-10-27T21:00:00Z'))).toBeNull();
  });

  it('borrows a TAF within 25 nm, then falls back to the report with a time limit', () => {
    const a = field('KAAA', 90, 40, { tafText: taf.raw });
    const b = field('KBBB', 90, 50);
    const far = field('KCCC', 270, 60);
    const all = [a, b, far];
    const wb = weatherAt(b, all, new Date('2026-10-25T21:00:00Z'), NOW);
    expect(wb).toMatchObject({ source: 'taf', station: 'KAAA', ceilingFtAgl: 1200, covered: true });
    expect(wb.stationNm).toBeGreaterThan(0);
    expect(weatherAt(far, all, new Date('2026-10-25T13:30:00Z'), NOW)).toMatchObject({ source: 'metar', covered: true });
    expect(weatherAt(far, all, new Date('2026-10-25T18:00:00Z'), NOW).covered).toBe(false);
  });
});

describe('runway and altitude', () => {
  it('picks the most headwind among runways long enough', () => {
    const f = field('KAAA', 0, 30, { runways: [
      { id: '09/27', ends: [{ id: '09', headingMag: 90 }, { id: '27', headingMag: 270 }], lengthFt: 4000, surface: 'paved' },
      { id: '18/36', ends: [{ id: '18', headingMag: 180 }, { id: '36', headingMag: 360 }], lengthFt: 1800, surface: 'grass' },
    ] });
    // Wind from 346 true is 360 magnetic with 14° west.
    const w = parseMetar('METAR KAAA 251253Z 34612KT 10SM CLR 12/02 A3010').wind;
    expect(pickRunway(f, w, 2500)!.end.id).toMatch(/09|27/);
    expect(pickRunway(f, w, 0)!.end.id).toBe('36');
  });

  it('flies 91.159 altitudes, kept under the clouds', () => {
    expect(cruiseAltitude(90, 300, null)).toBe(3500);
    expect(cruiseAltitude(270, 300, null)).toBe(2500);
    expect(cruiseAltitude(270, 1200, null)).toBe(4500);
    expect(cruiseAltitude(90, 300, 4000)).toBe(3500);
    // A 3,000 ft ceiling leaves no 91.159 altitude; stay under 3,000 AGL, rounded down.
    expect(cruiseAltitude(90, 1200, 3500)).toBe(3000);
  });
});

describe('planning a trip', () => {
  it('works the wind both ways and holds the reserve', () => {
    const west = field('KWST', 270, 60);
    const p = planTrip(inputs([west]), west, opts());
    expect(p.out.groundspeedKt).toBeLessThan(p.back.groundspeedKt);
    expect(p.tags).toContain('wind-lesson');
    expect(p.tags).toContain('xc-credit');
    expect(p.fuel.reserveMin).toBe(60);
    expect(p.fuel.requiredGal).toBeCloseTo(p.fuel.outGal + p.fuel.backGal + p.fuel.reserveGal, 1);
    expect(p.filtered).toBe(false);
    expect(p.times.home.getTime()).toBeGreaterThan(p.times.arrive.getTime());
  });

  it('assumes still air without winds aloft and says so', () => {
    const f = field('KAAA', 90, 40);
    const p = planTrip(inputs([f], false), f, opts());
    expect(p.out.groundspeedKt).toBe(p.back.groundspeedKt);
    expect(p.findings.map((x) => x.id)).toContain('no-winds');
  });

  it.each([
    ['ceiling under the pilot', { sky: 'BKN025' }, 'arrive-ceiling-personal', 'personal'],
    ['ceiling under VFR', { sky: 'OVC008' }, 'arrive-vfr-ceiling', 'illegal'],
    ['visibility under VFR', { vis: '2SM' }, 'arrive-vfr-vis', 'illegal'],
    ['thunderstorm', { sky: 'FEW050CB', wind: '27008KT', vis: '10SM TS' }, 'arrive-convection', 'limit'],
    ['crosswind over the pilot', { wind: '17018KT' }, 'arrive-xw-personal', 'personal'],
    ['gust spread', { wind: '27010G25KT' }, 'arrive-gust-spread', 'personal'],
  ] as const)('filters a trip for %s', (_n, wx, id, sev) => {
    const f = field('KAAA', 90, 40, wx);
    const p = planTrip(inputs([f]), f, opts());
    expect(p.findings.find((x) => x.id === id)?.severity).toBe(sev);
    expect(p.filtered).toBe(true);
  });

  it('filters a short runway, past the radius, short fuel and a night return', () => {
    const short = field('KSHT', 90, 40, { runways: [{ id: '09/27', ends: [{ id: '09', headingMag: 90 }, { id: '27', headingMag: 270 }], lengthFt: 2000, surface: 'grass' }] });
    expect(stopper(planTrip(inputs([short]), short, opts()))?.id).toBe('runway-short');
    const far = field('KFAR', 90, 120);
    expect(stopper(planTrip(inputs([far]), far, opts()))?.id).toBe('range');
    const thirsty = field('KTHR', 270, 95);
    const tiny = { ...xcAirplane(blankAircraft), usableGal: 20 };
    expect(stopper(planTrip(inputs([thirsty]), thirsty, opts({ airplane: tiny })))?.id).toBe('fuel-legal');
    const ok = field('KAAA', 90, 60);
    const late = planTrip(inputs([ok]), ok, opts({ departure: new Date('2026-10-25T21:00:00Z') }));
    expect(late.findings.map((x) => x.id)).toContain('night');
    expect(late.filtered).toBe(true);
  });

  it('notes a field flown recently and scores it below a new one', () => {
    const a = field('KAAA', 90, 50);
    const b = field('KBBB', 100, 50);
    const history = [{ id: 'KAAA', at: '2026-10-20T14:00:00Z', distanceNm: 50 }];
    const rec = recommend(inputs([a, b]), opts({ history }));
    expect(rec.ranked[0].dest.id).toBe('KBBB');
    expect(rec.ranked.find((p) => p.dest.id === 'KAAA')!.tags).not.toContain('new');
  });
});

describe('recommending', () => {
  const fields = [
    field('KN1', 0, 50), field('KN2', 10, 55), field('KN3', 20, 52, { towered: true }),
    field('KS1', 180, 45, { runways: [{ id: '18/36', ends: [{ id: '18', headingMag: 180 }, { id: '36', headingMag: 360 }], lengthFt: 2600, surface: 'paved' }] }),
    field('KE1', 90, 60, { sky: 'BKN015' }), field('KCLOSE', 90, 5),
  ];

  it('leaves out what fails, ignores the pattern-distance field, and explains the rest', () => {
    const rec = recommend(inputs(fields), opts());
    expect(rec.considered.map((p) => p.dest.id)).not.toContain('KCLOSE');
    expect(rec.filtered.map((p) => p.dest.id)).toEqual(['KE1']);
    expect(rec.ranked.every((p) => !p.filtered)).toBe(true);
  });

  it('spreads the picks over directions and kinds of field', () => {
    const rec = recommend(inputs(fields), opts());
    const picks = pickVaried(rec.ranked, 3);
    expect(picks).toHaveLength(3);
    expect(picks.some((p) => p.dest.id === 'KS1')).toBe(true);
    expect(new Set(picks.map(kindOf)).size).toBeGreaterThan(1);
    const next = pickVaried(rec.ranked, 3, new Set(picks.map((p) => p.dest.id)));
    expect(next.every((p) => !picks.includes(p))).toBe(true);
  });
});

describe('the diversion', () => {
  it('puts the amended ceiling under the pilot and legal when it can', () => {
    expect(amendedCeiling({ ...defaultPilot.minimums, ceilingFt: 3000 })).toBe(2500);
    expect(amendedCeiling({ ...defaultPilot.minimums, ceilingFt: 1000 })).toBe(600);
  });

  it('grades pressing on marginal and the soonest good field best', () => {
    const dest = field('KDST', 270, 80);
    const alt = field('KALT', 275, 42);
    const bad = field('KBAD', 265, 38, { sky: 'OVC007' });
    const input = inputs([dest, alt, bad]);
    const o = opts();
    const plan = planTrip(input, dest, o);
    const scene = diversionScene(input, plan, o);
    expect(scene.choices.map((c) => c.id)).toEqual(['continue', 'home', 'KBAD', 'KALT']);
    const g = gradeDiversionChoices(scene, o);
    expect(g.continue).toBe('marginal');
    expect(g.KBAD).toBe('unsafe');
    expect(g.KALT).toBe('best');
    expect(g.home).toBe('acceptable');
  });

  it('calls a field short of the legal reserve unsafe', () => {
    const dest = field('KDST', 270, 80);
    const input = inputs([dest]);
    const o = opts({ airplane: { ...xcAirplane(blankAircraft), usableGal: 11 } });
    const scene = diversionScene(input, planTrip(input, dest, o), o);
    expect(gradeDiversionChoices(scene, o).home).toBe('unsafe');
  });
});
