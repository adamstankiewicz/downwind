import { describe, expect, it } from 'vitest';
import { parseMetar, flightCategory } from '../metar';
import { parseTaf, hoursFrom } from '../taf';
import { components, trueToMagnetic, bestRunway } from '../wind';
import { densityAltitudeFt, pressureAltitudeFt } from '../density';
import { computeWb } from '../wb';
import { sampleC172K } from '../../data/aircraft';
import { KASH } from '../../data/airports';
import { defaultPilot } from '../../data/pilot';
import { buildBrief, debrief } from '../../scenarios/goNoGo';
import { sampleMetar, sampleTaf, sampleMetarFor } from '../../data/sampleWeather';
import { sampleWeather } from '../weather';
import { blankAircraft, isConfigured } from '../../data/aircraft';
import { reviewItems } from '../../review/items';

describe('METAR', () => {
  it('parses the common groups', () => {
    const m = parseMetar('METAR KASH 241653Z 27014G22KT 7SM BKN028 14/04 A3002 RMK AO2');
    expect(m.station).toBe('KASH');
    expect(m.issued).toEqual({ day: 24, hour: 16, minute: 53 });
    expect(m.wind).toMatchObject({ dirTrue: 270, speedKt: 14, gustKt: 22 });
    expect(m.visibilitySm).toBe(7);
    expect(m.ceilingFtAgl).toBe(2800);
    expect(m.tempC).toBe(14);
    expect(m.dewpointC).toBe(4);
    expect(m.altimeterInHg).toBe(30.02);
    expect(m.category).toBe('MVFR');
    expect(m.remarks).toBe('AO2');
  });
  it('handles fractions, negatives, VRB, variable range, and vertical visibility', () => {
    const m = parseMetar('KMHT 010252Z AUTO VRB03KT 1 1/2SM -SN BR VV008 M05/M07 A2990');
    expect(m.auto).toBe(true);
    expect(m.wind).toMatchObject({ dirTrue: null, variable: true, speedKt: 3 });
    expect(m.visibilitySm).toBe(1.5);
    expect(m.weather).toEqual(['-SN', 'BR']);
    expect(m.ceilingFtAgl).toBe(800);
    expect(m.tempC).toBe(-5);
    expect(m.dewpointC).toBe(-7);
    expect(m.category).toBe('IFR');
    const r = parseMetar('KBED 011153Z 31012KT 280V340 10SM FEW050 SCT120CB 22/10 A2995');
    expect(r.wind?.rangeTrue).toEqual([280, 340]);
    expect(r.ceilingFtAgl).toBeNull();
    expect(r.clouds[1].type).toBe('CB');
  });
  it('treats calm wind as no direction', () => {
    expect(parseMetar('KASH 011153Z 00000KT 10SM CLR 10/05 A3010').wind).toMatchObject({ dirTrue: null, speedKt: 0, variable: false });
  });
  it('assigns flight categories at the boundaries', () => {
    expect(flightCategory(3000, 10)).toBe('MVFR');
    expect(flightCategory(3100, 6)).toBe('VFR');
    expect(flightCategory(999, 10)).toBe('IFR');
    expect(flightCategory(null, 0.75)).toBe('LIFR');
  });
});

describe('TAF', () => {
  it('splits base and FM groups with end times', () => {
    const t = parseTaf(sampleTaf);
    expect(t.station).toBe('KXYZ');
    expect(t.periods.map((p) => p.kind)).toEqual(['BASE', 'FM', 'FM']);
    expect(t.periods[0].wind).toMatchObject({ dirTrue: 280, speedKt: 12, gustKt: 20 });
    expect(t.periods[0].to).toEqual({ day: 24, hour: 22, minute: 0 });
    expect(t.periods[1].from).toEqual({ day: 24, hour: 22, minute: 0 });
    expect(t.periods[2].wind?.variable).toBe(true);
  });
  it('parses TEMPO and PROB ranges', () => {
    const t = parseTaf('TAF AMD KBED 241740Z 2418/2518 30010KT P6SM BKN040 TEMPO 2420/2422 3SM -SHRA BKN020 PROB30 2502/2506 1SM BR');
    const tempo = t.periods[1];
    expect(tempo.kind).toBe('TEMPO');
    expect(tempo.from).toEqual({ day: 24, hour: 20, minute: 0 });
    expect(tempo.to).toEqual({ day: 24, hour: 22, minute: 0 });
    expect(tempo.category).toBe('MVFR');
    expect(t.periods[2]).toMatchObject({ kind: 'PROB', probability: 30, visibilitySm: 1 });
  });
  it('computes hours across a month boundary', () => {
    expect(hoursFrom(new Date(Date.UTC(2026, 9, 31, 22)), { day: 1, hour: 2, minute: 0 })).toBe(4);
  });
});

describe('wind', () => {
  it('converts true to magnetic with west variation', () => {
    expect(trueToMagnetic(270, -14)).toBe(284);
    expect(trueToMagnetic(350, -14)).toBe(4);
  });
  it('computes components and side', () => {
    const c = components(284, 14, 320);
    expect(c.angleDeg).toBe(36);
    expect(c.crosswindKt).toBeCloseTo(8.2, 1);
    expect(c.headwindKt).toBeCloseTo(11.3, 1);
    expect(c.from).toBe('left');
    expect(components(140, 10, 320).headwindKt).toBe(-10);
  });
  it('picks the runway with the most headwind', () => {
    expect(bestRunway(KASH.runways, 284, 14).id).toBe('32');
    expect(bestRunway(KASH.runways, 120, 10).id).toBe('14');
  });
});

describe('density altitude', () => {
  it('follows the PHAK rule of thumb', () => {
    expect(pressureAltitudeFt(199, 29.72)).toBeCloseTo(399, 0);
    // KASH, 30.02, 14C: PA 99, ISA 14.8, DA about 3 ft
    expect(Math.round(densityAltitudeFt(199, 30.02, 14))).toBe(3);
    expect(Math.round(densityAltitudeFt(199, 29.92, 32))).toBe(2287);
  });
});

describe('weight and balance', () => {
  const ac = sampleC172K;
  const wb = (front: number, rear: number, fuelGal: number, bag: number) =>
    computeWb(ac.emptyWeightLb, ac.emptyArmIn, ac.stations, [
      { stationId: 'front', weightLb: front },
      { stationId: 'rear', weightLb: rear },
      { stationId: 'fuel', weightLb: fuelGal * 6 },
      { stationId: 'bag1', weightLb: bag },
    ], ac.envelope, ac.maxGrossLb);
  it('computes CG and checks the envelope', () => {
    const r = wb(340, 170, 38, 20);
    expect(r.totalLb).toBe(2188);
    expect(r.cgIn).toBeCloseTo(43.11, 1);
    expect(r.withinEnvelope).toBe(true);
    expect(r.overGross).toBe(false);
  });
  it('flags over gross and baggage over max', () => {
    const r = wb(400, 340, 38, 130);
    expect(r.overGross).toBe(true);
    expect(r.stationsOverMax).toEqual(['bag1']);
  });
});

describe('go/no-go', () => {
  const base = {
    airport: KASH,
    aircraft: sampleC172K,
    minimums: defaultPilot.minimums,
    departure: new Date(Date.UTC(2026, 9, 24, 17, 0)),
    tripHours: 4,
    wb: computeWb(1430, 39.5, sampleC172K.stations, [{ stationId: 'front', weightLb: 340 }, { stationId: 'fuel', weightLb: 228 }], sampleC172K.envelope, 2300),
  };
  it('grades the sample day as over personal minimums, improving later', () => {
    const b = buildBrief({ ...base, metar: parseMetar(sampleMetar), taf: parseTaf(sampleTaf) });
    const ids = b.findings.map((f) => f.id);
    expect(ids).toContain('ceiling-personal');
    expect(ids).toContain('improving');
    expect(b.facts.runwayWind?.runway.id).toBe('32');
    expect(b.grades.go).toBe('unsafe');
    expect(b.grades.delay).toBe('best');
    const d = debrief(b, 'go', 90);
    expect(d.confidentlyWrong).toBe(true);
    expect(d.lcg).toBe('Explain');
  });
  it('calls a sub-1,000 ceiling illegal', () => {
    const b = buildBrief({ ...base, metar: parseMetar('KASH 241653Z 31005KT 4SM BR OVC008 10/09 A3002'), taf: null });
    expect(b.findings.find((f) => f.id === 'vfr-ceiling')?.severity).toBe('illegal');
    expect(b.grades.cancel).toBe('best');
  });
  it('says go on a clear calm day', () => {
    const b = buildBrief({ ...base, metar: parseMetar('KASH 241653Z 33006KT 10SM FEW060 18/02 A3005'), taf: null });
    expect(b.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    expect(b.grades.go).toBe('best');
  });
});

describe('review items', () => {
  it('are well formed and unique', () => {
    const ids = new Set(reviewItems.map((i) => i.id));
    expect(ids.size).toBe(reviewItems.length);
    for (const i of reviewItems) {
      expect(i.answer).toBeGreaterThanOrEqual(0);
      expect(i.answer).toBeLessThan(i.options.length);
      expect(i.ref.length).toBeGreaterThan(0);
    }
  });
});

describe('no built-in home base or airplane', () => {
  it('starts with an empty pilot profile', () => {
    expect(defaultPilot.homeBase).toBe('');
    expect(defaultPilot.name).toBe('');
  });
  it('labels practice weather with the pilot\'s own station', () => {
    expect(parseMetar(sampleMetarFor('KPSM')).station).toBe('KPSM');
    expect(sampleWeather('KBVY').source).toBe('sample');
    expect(sampleWeather('KBVY').taf?.station).toBe('KBVY');
  });
  it('knows when an aircraft profile is usable', () => {
    expect(isConfigured(blankAircraft)).toBe(false);
    expect(isConfigured(sampleC172K)).toBe(true);
  });
});
