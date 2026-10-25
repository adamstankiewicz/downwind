import { describe, expect, it } from 'vitest';
import { sunTimes } from '../sun';
import { parseFb, parseFbGroup, validDate } from '../windsAloft';
import { bbox, fieldFromAwc, pickFb, runwaysFromAwc } from '../tripData';
import { fromAwc } from '../airportLookup';

const FB = `(Extracted from FBUS31 KWNO 251359)
FD1US1
DATA BASED ON 251200Z
VALID 251800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000

FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
BDL 3008 2911+08 2505+05 9900-02 0811-17 0822-30 062943 053248 042852
PSB      9900+10 9900+06 9900+00 0513-16 0442-25 025139 015248 014454
CAR 2725 2725+09 7315+04 2723+00 2724-13 2616-26 260841 280950 350958
`;

describe('sunrise and sunset', () => {
  it('lands within a few minutes of the published times', () => {
    // A mid-latitude summer day: sunrise about 1211Z, sunset about 0411Z the next UTC day.
    const t = sunTimes({ lat: 47.6, lon: -122.3 }, new Date('2026-06-21T20:00:00Z'));
    expect(Math.abs(t.sunrise!.getTime() - Date.parse('2026-06-21T12:11:00Z'))).toBeLessThan(5 * 60_000);
    expect(Math.abs(t.sunset!.getTime() - Date.parse('2026-06-22T04:11:00Z'))).toBeLessThan(5 * 60_000);
  });

  it('gives a western evening its own sunset, not the next day', () => {
    const p = { lat: 42.8, lon: -71.5 };
    const morning = sunTimes(p, new Date('2026-10-25T13:00:00Z'));
    const evening = sunTimes(p, new Date('2026-10-25T23:30:00Z'));
    expect(evening.sunset).toEqual(morning.sunset);
    expect(morning.sunset!.getTime()).toBeGreaterThan(morning.sunrise!.getTime());
  });

  it('returns null in polar night', () => {
    expect(sunTimes({ lat: 78, lon: 15 }, new Date('2026-12-21T12:00:00Z')).sunrise).toBeNull();
  });
});

describe('winds aloft', () => {
  it('reads groups, light and variable, and 100 knots or more', () => {
    expect(parseFbGroup('2911+08', 6000)).toEqual({ altFt: 6000, dirTrue: 290, speedKt: 11, tempC: 8 });
    expect(parseFbGroup('9900', 3000)).toEqual({ altFt: 3000, dirTrue: 0, speedKt: 0, tempC: null });
    expect(parseFbGroup('7315+04', 9000)).toMatchObject({ dirTrue: 230, speedKt: 115 });
    expect(parseFbGroup('062943', 30000)).toEqual({ altFt: 30000, dirTrue: 60, speedKt: 29, tempC: -43 });
  });

  it('cuts by column, so a blank level stays blank', () => {
    const f = parseFb(FB);
    expect(f.stations.map((s) => s.id)).toEqual(['BDL', 'PSB', 'CAR']);
    const psb = f.stations[1];
    expect(psb.levels[0].altFt).toBe(6000);
    expect(f.stations[0].levels[0]).toEqual({ altFt: 3000, dirTrue: 300, speedKt: 8, tempC: null });
    expect(f.useFrom).toEqual({ hour: 14, minute: 0 });
    expect(validDate(f, new Date('2026-10-25T14:00:00Z'))?.toISOString()).toBe('2026-10-25T18:00:00.000Z');
  });

  it('picks the forecast valid nearest the departure', () => {
    const a = parseFb(FB);
    const b = parseFb(FB.replace('VALID 251800Z', 'VALID 260000Z'));
    const ref = new Date('2026-10-25T14:00:00Z');
    expect(pickFb([a, b], new Date('2026-10-25T23:00:00Z'), ref)).toBe(b);
    expect(pickFb([a, b], new Date('2026-10-28T23:00:00Z'), ref)).toBeNull();
  });
});

describe('airport data', () => {
  const rec = {
    icaoId: 'KTST', name: 'SOMETOWN/SOMETOWN MUNI ', lat: 42.5, lon: -72.1, elev: 100, magdec: '15W', tower: 'T',
    runways: [
      { id: '14/32', dimension: '5001x100', surface: 'A', alignment: 130 },
      { id: '02/20', dimension: '2200x60', surface: 'T', alignment: 18 },
      { id: 'H1', dimension: '60x60', surface: 'C' },
      { id: '18W/36W', dimension: '3000x200', surface: 'W' },
    ],
  };

  it('keeps real runways, longest first, with grass marked', () => {
    const r = runwaysFromAwc(rec);
    expect(r.map((x) => x.id)).toEqual(['14/32', '02/20']);
    expect(r[0].ends).toEqual([{ id: '14', headingMag: 130 }, { id: '32', headingMag: 310 }]);
    expect(r[1].surface).toBe('grass');
  });

  it('builds a field with position, feet and west variation', () => {
    const f = fieldFromAwc(rec)!;
    expect(f).toMatchObject({ id: 'KTST', name: 'Sometown Muni', elevationFt: 328, variationDeg: -15, towered: true, pos: { lat: 42.5, lon: -72.1 } });
    expect(fieldFromAwc({ ...rec, lat: null })).toBeNull();
    expect(fieldFromAwc({ ...rec, runways: [] })).toBeNull();
  });

  it('keeps the position from an onboarding lookup', () => {
    expect(fromAwc([rec], 'KTST')?.pos).toEqual({ lat: 42.5, lon: -72.1 });
  });

  it('draws a box the right size', () => {
    expect(bbox({ lat: 0, lon: 0 }, 60)).toBe('-1.00,-1.00,1.00,1.00');
  });
});
