import { describe, expect, it } from 'vitest';
import { distanceNm } from '../../lib/nav';
import { fitProjection, focusProjection, makeProjection, placeLabel, placeLabelLoose } from '../projection';

describe('chart projection', () => {
  const c = { lat: 42.8, lon: -71.95 };
  it('puts the center in the middle and round-trips a point', () => {
    const p = makeProjection(c, 5, 800, 600);
    expect(p.toXY(c)).toEqual({ x: 400, y: 300 });
    const q = { lat: 43.1, lon: -72.6 };
    const back = p.toLatLon(p.toXY(q));
    expect(back.lat).toBeCloseTo(q.lat, 9);
    expect(back.lon).toBeCloseTo(q.lon, 9);
  });
  it('keeps a mile the same length north-south and east-west', () => {
    const p = makeProjection(c, 5, 800, 600);
    const n = p.toXY({ lat: c.lat + 1 / 60, lon: c.lon });
    const e = p.toXY({ lat: c.lat, lon: c.lon + 1 / (60 * Math.cos((c.lat * Math.PI) / 180)) });
    expect(n.y).toBeCloseTo(300 - 5, 6);
    expect(e.x).toBeCloseTo(400 + 5, 6);
    // and that eastward step really is about one nautical mile on the sphere
    expect(distanceNm(c, p.toLatLon(e))).toBeCloseTo(1, 2);
  });
  it('fits a box inside the frame without stretching', () => {
    const b = { north: 43.45, south: 42.15, east: -71.0, west: -73.25 };
    const p = fitProjection(b, 1000, 500);
    const nw = p.toXY({ lat: b.north, lon: b.west });
    const se = p.toXY({ lat: b.south, lon: b.east });
    expect(nw.x).toBeGreaterThanOrEqual(-1e-6);
    expect(nw.y).toBeGreaterThanOrEqual(-1e-6);
    expect(se.x).toBeLessThanOrEqual(1000 + 1e-6);
    expect(se.y).toBeLessThanOrEqual(500 + 1e-6);
    // the limiting axis touches both edges
    expect(Math.min(nw.x, nw.y)).toBeCloseTo(0, 6);
  });
  it('focus shows the radius asked for on the short side', () => {
    const p = focusProjection(c, 10, 400, 300);
    expect(p.pxPerNm).toBeCloseTo(15, 9);
    expect(p.extent().north - p.extent().south).toBeCloseTo(20 / 60, 9);
  });
});

describe('label placement', () => {
  const frame = { x: 0, y: 0, w: 100, h: 100 };
  it('takes the first free candidate and skips ones that collide', () => {
    const placed = [{ x: 10, y: 10, w: 30, h: 10 }];
    const out = placeLabel(placed, [{ x: 12, y: 12, w: 20, h: 10 }, { x: 50, y: 50, w: 20, h: 10 }], frame);
    expect(out).toEqual({ x: 50, y: 50, w: 20, h: 10 });
  });
  it('keeps labels inside the frame and reports when nothing fits', () => {
    expect(placeLabel([], [{ x: 95, y: 0, w: 20, h: 10 }], frame)).toBeNull();
    expect(placeLabel([{ x: 0, y: 0, w: 100, h: 100 }], [{ x: 1, y: 1, w: 5, h: 5 }], frame)).toBeNull();
  });
  it('falls back to the least-covered spot, pushed inside the frame', () => {
    const placed = [{ x: 0, y: 0, w: 60, h: 60 }];
    const loose = placeLabelLoose(placed, [{ x: 10, y: 10, w: 20, h: 10 }, { x: 55, y: 95, w: 20, h: 10 }], frame);
    expect(loose).toEqual({ x: 55, y: 90, w: 20, h: 10 });
    const only = placeLabelLoose(placed, [{ x: 120, y: 5, w: 20, h: 10 }], frame);
    expect(only).toEqual({ x: 80, y: 5, w: 20, h: 10 });
  });
});
