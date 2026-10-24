import { describe, expect, it } from 'vitest';
import { fromAwc, normalizeIdent, parseVariation, runwayEnds } from '../airportLookup';

describe('airport lookup', () => {
  it('normalizes identifiers', () => {
    expect(normalizeIdent(' ash ')).toBe('KASH');
    expect(normalizeIdent('kpsm')).toBe('KPSM');
    expect(normalizeIdent('3B3')).toBe('3B3');
  });
  it('parses magnetic variation', () => {
    expect(parseVariation('14W')).toBe(-14);
    expect(parseVariation('3E')).toBe(3);
    expect(parseVariation(-15.5)).toBe(-15.5);
    expect(parseVariation('n/a')).toBeNull();
  });
  it('builds runway ends', () => {
    expect(runwayEnds('14/32', 140)).toEqual([{ id: '14', headingMag: 140 }, { id: '32', headingMag: 320 }]);
    expect(runwayEnds('18/36', null)).toEqual([{ id: '18', headingMag: 180 }, { id: '36', headingMag: 360 }]);
    expect(runwayEnds('H1', 0)).toEqual([]);
  });
  it('reads an AWC airport record', () => {
    const a = fromAwc([{ icaoId: 'KPSM', name: 'PORTSMOUTH INTL AT PEASE', state: 'NH', elev: 30, magdec: '15W', runways: [{ id: '16/34', alignment: '160' }] }], 'KPSM');
    expect(a).toMatchObject({ icao: 'KPSM', elevationFt: 98, magneticVariationDeg: -15 });
    expect(a?.runways.map((r) => r.id)).toEqual(['16', '34']);
  });
});
