import { describe, expect, it } from 'vitest';
import { canReach, climbRate, fuelPlan, glideRangeNm, landingDistance, readTable, sampleTrainerPerformance, takeoffDistance, vfrReserveMin } from '../perf';
import { destination, distanceNm, isLegalVfrAltitude, navLog, tasFromIas, trueCourse, vfrCruisingAltitudes, windTriangle } from '../nav';
import { positionAt, requirements, vfrMinimums } from '../airspace';
import { chartAirport, maxElevationFigure, practiceRegion as R } from '../../chart/practiceRegion';

const P = sampleTrainerPerformance();

describe('performance charts', () => {
  it('interpolates between rows and columns like you would by hand', () => {
    const t = { pressureAltsFt: [0, 1000], tempsC: [0, 10], values: [[100, 200], [300, 400]] };
    expect(readTable(t, 500, 5).value).toBe(250);
    expect(readTable(t, 0, 10).value).toBe(200);
    expect(readTable(t, 2000, 5).offChart).toBe(true);
  });
  it('takes longer on a hot high day and shortens with headwind', () => {
    const cool = takeoffDistance(P, { fieldElevFt: 600, altimeterInHg: 29.92, oatC: 10, headwindKt: 0, surface: 'paved' });
    const hot = takeoffDistance(P, { fieldElevFt: 4500, altimeterInHg: 29.92, oatC: 32, headwindKt: 0, surface: 'paved' });
    expect(hot.densityAltFt).toBeGreaterThan(7000);
    expect(hot.over50Ft).toBeGreaterThan(cool.over50Ft * 1.8);
    const wind = takeoffDistance(P, { fieldElevFt: 600, altimeterInHg: 29.92, oatC: 10, headwindKt: 9, surface: 'paved' });
    expect(wind.groundRollFt).toBe(Math.round((cool.groundRollFt * 0.9) / 5) * 5);
    const tail = takeoffDistance(P, { fieldElevFt: 600, altimeterInHg: 29.92, oatC: 10, headwindKt: -4, surface: 'paved' });
    expect(tail.groundRollFt).toBeGreaterThan(cool.groundRollFt * 1.19);
  });
  it('adds grass to the ground roll, and to the obstacle distance by the same feet', () => {
    const paved = landingDistance(P, { fieldElevFt: 820, altimeterInHg: 30.0, oatC: 20, headwindKt: 0, surface: 'paved' });
    const grass = landingDistance(P, { fieldElevFt: 820, altimeterInHg: 30.0, oatC: 20, headwindKt: 0, surface: 'grass' });
    expect(Math.abs((grass.groundRollFt - paved.groundRollFt) - (grass.over50Ft - paved.over50Ft))).toBeLessThanOrEqual(5);
    expect(grass.steps.map((s) => s.label)).toEqual(['From the chart', 'Dry grass']);
  });
  it('loses climb with density altitude', () => {
    expect(climbRate(P, 0, 15).value).toBeGreaterThan(climbRate(P, 6000, 30).value + 300);
  });
  it('plans fuel with the 91.151 reserve', () => {
    expect(vfrReserveMin(false)).toBe(30);
    expect(vfrReserveMin(true)).toBe(45);
    const f = fuelPlan(P, { climbMin: 10, cruiseMin: 60, night: false, onBoardGal: 20 });
    expect(f.requiredGal).toBeCloseTo(1.1 + 10 / 6 + 8 + 4, 1);
    expect(f.marginGal).toBeCloseTo(20 - f.requiredGal, 1);
  });
  it('glides about 1.5 nm per 1,000 ft at 9:1, less into the wind', () => {
    expect(glideRangeNm(P, 1000)).toBeCloseTo(1.5, 1);
    expect(glideRangeNm(P, 3000, 20)).toBeLessThan(glideRangeNm(P, 3000));
    expect(canReach(P, 3000, 2.5)).toBe(true);
    expect(canReach(P, 1500, 2.5)).toBe(false);
  });
});

describe('navigation', () => {
  it('measures distance and course', () => {
    const a = { lat: 42.8, lon: -71.95 };
    const b = destination(a, 90, 60);
    expect(distanceNm(a, b)).toBeCloseTo(60, 1);
    expect(trueCourse(a, b)).toBeCloseTo(90, 0);
  });
  it('solves the wind triangle like an E6B', () => {
    // Course 360, TAS 100, wind from 090 at 20: correct right about 12°, groundspeed about 98.
    const w = windTriangle(360, 100, 90, 20);
    expect(w.wcaDeg).toBe(12);
    expect(w.trueHeading).toBe(12);
    expect(w.groundspeedKt).toBe(98);
    expect(windTriangle(90, 100, 90, 20).groundspeedKt).toBe(80);
    expect(windTriangle(90, 100, 270, 20).groundspeedKt).toBe(120);
  });
  it('gives TAS from IAS by the 2 percent rule', () => {
    expect(tasFromIas(100, 5000)).toBe(110);
  });
  it('picks VFR cruising altitudes by magnetic course', () => {
    expect(vfrCruisingAltitudes(90, 3000, 8000)).toEqual([3500, 5500, 7500]);
    expect(vfrCruisingAltitudes(270, 3000, 8000)).toEqual([4500, 6500]);
    expect(isLegalVfrAltitude(270, 5500, 600)).toBe(false);
    expect(isLegalVfrAltitude(270, 3000, 600)).toBe(true);
  });
  it('builds a nav log with magnetic headings and fuel', () => {
    const home = chartAirport('KXYZ')!;
    const dest = chartAirport('KXQA')!;
    const log = navLog([{ ...home.pos, id: home.id, name: home.name }, { ...dest.pos, id: dest.id, name: dest.name }], { tasKt: 110, windFromTrue: 270, windKt: 20, variationDeg: -14, gph: 8 });
    expect(log.totalNm).toBeCloseTo(62, 0);
    const leg = log.legs[0];
    expect(leg.magCourse).toBe((leg.trueCourse + 14) % 360);
    expect(leg.groundspeedKt).toBeLessThan(110);
    expect(log.totalFuelGal).toBeCloseTo((leg.minutes * 8) / 60, 1);
  });
});

describe('airspace and the practice chart', () => {
  const home = chartAirport('KXYZ')!;
  const bb = chartAirport('KXBB')!;
  const qc = chartAirport('KXQC')!;
  it('puts the practice field in Class D up to 2,500 AGL', () => {
    expect(positionAt(R.airspace, home.pos, 1500, 600).cls).toBe('D');
    expect(positionAt(R.airspace, home.pos, 3500, 600).cls).toBe('E');
  });
  it('reads the Class B shelves by altitude', () => {
    const under = destination(bb.pos, 290, 15);
    expect(positionAt(R.airspace, under, 1000, 100, R.veils).cls).toBe('G');
    expect(positionAt(R.airspace, under, 2500, 100, R.veils).cls).toBe('E');
    const p = positionAt(R.airspace, under, 3500, 100, R.veils);
    expect(p.cls).toBe('B');
    expect(requirements(p, 3500).map((r) => r.id)).toContain('b-clearance');
    expect(positionAt(R.airspace, under, 2500, 100, R.veils).modeCVeil).toBe(true);
  });
  it('requires two-way communication for Class C, not a clearance', () => {
    const p = positionAt(R.airspace, destination(qc.pos, 0, 7), 2500, 500);
    expect(p.cls).toBe('C');
    const ids = requirements(p, 2500).map((r) => r.id);
    expect(ids).toContain('c-comm');
    expect(ids).not.toContain('b-clearance');
  });
  it('knows class G under the 700 ft E and 1,200 ft elsewhere', () => {
    const xrb = chartAirport('KXRB')!;
    expect(positionAt(R.airspace, xrb.pos, xrb.elevationFt + 500, xrb.elevationFt).cls).toBe('G');
    expect(positionAt(R.airspace, xrb.pos, xrb.elevationFt + 800, xrb.elevationFt).cls).toBe('E');
    const mill = chartAirport('2X5')!;
    expect(positionAt(R.airspace, mill.pos, mill.elevationFt + 800, mill.elevationFt).cls).toBe('G');
  });
  it('flags special use airspace', () => {
    const r = R.airspace.find((v) => v.id === 'r-4101')!;
    const c = r.shape.kind === 'polygon' ? r.shape.points[0] : home.pos;
    const inside = { lat: c.lat - 0.02, lon: c.lon + 0.02 };
    const p = positionAt(R.airspace, inside, 3000, 500);
    expect(p.special.map((s) => s.id)).toContain('r-4101');
  });
  it('gives basic VFR minimums by class, altitude and night', () => {
    expect(vfrMinimums('B', 3000, 0, false)).toMatchObject({ visibilitySm: 3, clouds: null });
    expect(vfrMinimums('D', 2000, 600, false).clouds).toMatchObject({ belowFt: 500, aboveFt: 1000 });
    expect(vfrMinimums('E', 11500, 500, false)).toMatchObject({ visibilitySm: 5 });
    expect(vfrMinimums('G', 1400, 600, false)).toMatchObject({ visibilitySm: 1, clouds: null });
    expect(vfrMinimums('G', 1400, 600, true).visibilitySm).toBe(3);
    expect(vfrMinimums('G', 3000, 600, false)).toMatchObject({ visibilitySm: 1, clouds: { belowFt: 500 } });
  });
  it('computes a maximum elevation figure above the tallest thing', () => {
    const sw = destination(home.pos, 235, 40);
    const ne = destination(home.pos, 45, 5);
    expect(maxElevationFigure(R, sw, ne)).toBeGreaterThanOrEqual(1849);
  });
});
