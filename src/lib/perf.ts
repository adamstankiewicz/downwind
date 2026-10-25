// Airplane performance from the pilot's own tables: takeoff and landing
// distance, rate of climb, fuel and reserves, and glide. Tables are the shape
// a POH prints (pressure altitude by temperature, at max gross); this module
// only interpolates and applies the corrections the table notes ask for.
// Sample tables ship with the templates and are labeled as sample values.

import type { VSpeeds } from './aero';
import { densityAltitudeFt, isaTempC, pressureAltitudeFt } from './density';

/** A POH-style chart: rows by pressure altitude (ft), columns by OAT (°C). */
export interface PerfTable {
  pressureAltsFt: number[];
  tempsC: number[];
  /** values[row][col], in feet (distances) or feet per minute (climb). */
  values: number[][];
}

export interface DistanceTables {
  groundRoll: PerfTable;
  over50: PerfTable;
}

/** Corrections as POH table notes word them. */
export interface DistanceNotes {
  /** Percent shorter per `headwindStepKt` of headwind. */
  headwindPct: number;
  headwindStepKt: number;
  /** Percent longer per `tailwindStepKt` of tailwind. */
  tailwindPct: number;
  tailwindStepKt: number;
  /** Percent of ground roll added on dry grass. */
  grassPctOfGroundRoll: number;
}

export interface Performance {
  takeoff: DistanceTables & { notes: DistanceNotes };
  landing: DistanceTables & { notes: DistanceNotes };
  climbFpm: PerfTable;
  cruise: { tasKt: number; gph: number };
  climbGph: number;
  taxiFuelGal: number;
  bestGlideKias: number;
  /** Feet forward per foot of altitude, engine out, at best glide. */
  glideRatio: number;
  vxKias: number;
  vyKias: number;
  /** Stall, maneuvering and approach speeds (lib/aero.ts). Older profiles don't have them. */
  speeds?: VSpeeds;
}

/** Linear interpolation of y at x between sorted xs. Clamps outside the table and says so. */
function interp1(xs: number[], x: number): { i: number; t: number; clamped: boolean } {
  if (x <= xs[0]) return { i: 0, t: 0, clamped: x < xs[0] };
  const last = xs.length - 1;
  if (x >= xs[last]) return { i: last - 1, t: 1, clamped: x > xs[last] };
  let i = 0;
  while (xs[i + 1] < x) i++;
  return { i, t: (x - xs[i]) / (xs[i + 1] - xs[i]), clamped: false };
}

export interface TableRead {
  value: number;
  /** True when the conditions are off the edge of the chart; the value is then the edge, not an answer. */
  offChart: boolean;
  /** The four corners used, for showing the work. */
  corners: { paFt: number; tempC: number; value: number }[];
}

/** Bilinear read of a chart, the way you would interpolate by hand. */
export function readTable(t: PerfTable, paFt: number, tempC: number): TableRead {
  const r = interp1(t.pressureAltsFt, paFt);
  const c = interp1(t.tempsC, tempC);
  const v = (ri: number, ci: number) => t.values[ri][ci];
  const top = v(r.i, c.i) + (v(r.i, c.i + 1) - v(r.i, c.i)) * c.t;
  const bot = v(r.i + 1, c.i) + (v(r.i + 1, c.i + 1) - v(r.i + 1, c.i)) * c.t;
  const value = top + (bot - top) * r.t;
  const corners = [
    [r.i, c.i], [r.i, c.i + 1], [r.i + 1, c.i], [r.i + 1, c.i + 1],
  ].map(([ri, ci]) => ({ paFt: t.pressureAltsFt[ri], tempC: t.tempsC[ci], value: v(ri, ci) }));
  return { value, offChart: r.clamped || c.clamped, corners };
}

export interface RunwayConditions {
  fieldElevFt: number;
  altimeterInHg: number;
  oatC: number;
  /** Positive headwind, negative tailwind, along the runway. */
  headwindKt: number;
  surface: 'paved' | 'grass';
}

export interface DistanceResult {
  pressureAltFt: number;
  densityAltFt: number;
  groundRollFt: number;
  over50Ft: number;
  offChart: boolean;
  /** Each correction applied, in order, for the worked example. */
  steps: { label: string; groundRollFt: number; over50Ft: number }[];
}

function distance(tables: DistanceTables & { notes: DistanceNotes }, c: RunwayConditions): DistanceResult {
  const pa = pressureAltitudeFt(c.fieldElevFt, c.altimeterInHg);
  const da = densityAltitudeFt(c.fieldElevFt, c.altimeterInHg, c.oatC);
  const gr = readTable(tables.groundRoll, pa, c.oatC);
  const ob = readTable(tables.over50, pa, c.oatC);
  let g = gr.value;
  let o = ob.value;
  const steps = [{ label: 'From the chart', groundRollFt: g, over50Ft: o }];
  const n = tables.notes;
  if (c.headwindKt > 0) {
    const f = 1 - (n.headwindPct / 100) * (c.headwindKt / n.headwindStepKt);
    g *= f;
    o *= f;
    steps.push({ label: `Headwind ${Math.round(c.headwindKt)} kt`, groundRollFt: g, over50Ft: o });
  } else if (c.headwindKt < 0) {
    const f = 1 + (n.tailwindPct / 100) * (-c.headwindKt / n.tailwindStepKt);
    g *= f;
    o *= f;
    steps.push({ label: `Tailwind ${Math.round(-c.headwindKt)} kt`, groundRollFt: g, over50Ft: o });
  }
  if (c.surface === 'grass') {
    const add = g * (n.grassPctOfGroundRoll / 100);
    g += add;
    o += add;
    steps.push({ label: 'Dry grass', groundRollFt: g, over50Ft: o });
  }
  const r = (x: number) => Math.round(x / 5) * 5;
  return {
    pressureAltFt: Math.round(pa),
    densityAltFt: Math.round(da),
    groundRollFt: r(g),
    over50Ft: r(o),
    offChart: gr.offChart || ob.offChart,
    steps: steps.map((s) => ({ ...s, groundRollFt: r(s.groundRollFt), over50Ft: r(s.over50Ft) })),
  };
}

export const takeoffDistance = (p: Performance, c: RunwayConditions) => distance(p.takeoff, c);
export const landingDistance = (p: Performance, c: RunwayConditions) => distance(p.landing, c);

export function climbRate(p: Performance, paFt: number, oatC: number): TableRead {
  return readTable(p.climbFpm, paFt, oatC);
}

/** Temperature at altitude from the surface temperature, standard lapse (2 °C per 1,000 ft). */
export function tempAtAltitude(surfaceTempC: number, surfaceFt: number, altFt: number): number {
  return surfaceTempC - (2 * (altFt - surfaceFt)) / 1000;
}

export { isaTempC };

/** 14 CFR 91.151: 30 minutes by day, 45 at night, at normal cruise. */
export function vfrReserveMin(night: boolean): number {
  return night ? 45 : 30;
}

export interface FuelPlan {
  taxiGal: number;
  climbGal: number;
  cruiseGal: number;
  reserveGal: number;
  requiredGal: number;
  onBoardGal: number;
  /** Fuel left on landing minus the legal reserve. Negative means not legal. */
  marginGal: number;
  enduranceMin: number;
}

export function fuelPlan(p: Performance, opts: { climbMin: number; cruiseMin: number; night: boolean; onBoardGal: number; extraReserveMin?: number }): FuelPlan {
  const climbGal = (p.climbGph * opts.climbMin) / 60;
  const cruiseGal = (p.cruise.gph * opts.cruiseMin) / 60;
  const reserveGal = (p.cruise.gph * (vfrReserveMin(opts.night) + (opts.extraReserveMin ?? 0))) / 60;
  const requiredGal = p.taxiFuelGal + climbGal + cruiseGal + reserveGal;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    taxiGal: r1(p.taxiFuelGal),
    climbGal: r1(climbGal),
    cruiseGal: r1(cruiseGal),
    reserveGal: r1(reserveGal),
    requiredGal: r1(requiredGal),
    onBoardGal: opts.onBoardGal,
    marginGal: r1(opts.onBoardGal - requiredGal),
    enduranceMin: Math.round(((opts.onBoardGal - p.taxiFuelGal) / p.cruise.gph) * 60),
  };
}

/**
 * Still-air glide distance in nautical miles from height above the ground,
 * then adjusted for wind along the glide path at best glide speed.
 */
export function glideRangeNm(p: Performance, heightAglFt: number, headwindKt = 0): number {
  const stillNm = (heightAglFt * p.glideRatio) / 6076;
  const tas = p.bestGlideKias;
  const gs = Math.max(0, tas - headwindKt);
  return Math.round(stillNm * (gs / tas) * 10) / 10;
}

/** A field can be reached if it is inside the glide range with the margin you keep for the pattern. */
export function canReach(p: Performance, heightAglFt: number, distanceNm: number, headwindKt = 0, patternFt = 1000): boolean {
  return glideRangeNm(p, Math.max(0, heightAglFt - patternFt), headwindKt) >= distanceNm;
}

/**
 * A sample performance set for the trainer template. These are smooth,
 * representative numbers for a 150 hp four-seat trainer at max gross, for
 * teaching how to read the charts. They are not any manufacturer's published
 * data. Replace them from your POH before trusting a result.
 */
export function sampleTrainerPerformance(): Performance {
  const pas = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
  const temps = [0, 10, 20, 30, 40];
  // Distances grow with density altitude; the factor below gives roughly 10 to
  // 12 percent per 1,000 ft, the usual rule of thumb for normally aspirated singles.
  const daOf = (pa: number, t: number) => pa + 120 * (t - isaTempC(pa));
  const grow = (base: number, pa: number, t: number) => base * Math.exp(0.000115 * daOf(pa, t));
  const grid = (f: (pa: number, t: number) => number, step: number) =>
    pas.map((pa) => temps.map((t) => Math.round(f(pa, t) / step) * step));
  const climb = (pa: number, t: number) => Math.max(0, 700 - 0.075 * daOf(pa, t));
  const toNotes: DistanceNotes = { headwindPct: 10, headwindStepKt: 9, tailwindPct: 10, tailwindStepKt: 2, grassPctOfGroundRoll: 15 };
  const ldgNotes: DistanceNotes = { headwindPct: 10, headwindStepKt: 9, tailwindPct: 10, tailwindStepKt: 2, grassPctOfGroundRoll: 45 };
  return {
    takeoff: {
      groundRoll: { pressureAltsFt: pas, tempsC: temps, values: grid((pa, t) => grow(780, pa, t), 5) },
      over50: { pressureAltsFt: pas, tempsC: temps, values: grid((pa, t) => grow(1400, pa, t), 5) },
      notes: toNotes,
    },
    landing: {
      groundRoll: { pressureAltsFt: pas, tempsC: temps, values: grid((pa, t) => 500 * (1 + 0.000035 * daOf(pa, t)), 5) },
      over50: { pressureAltsFt: pas, tempsC: temps, values: grid((pa, t) => 1150 * (1 + 0.000035 * daOf(pa, t)), 5) },
      notes: ldgNotes,
    },
    climbFpm: { pressureAltsFt: pas, tempsC: temps, values: grid(climb, 5) },
    cruise: { tasKt: 110, gph: 8 },
    climbGph: 10,
    taxiFuelGal: 1.1,
    bestGlideKias: 65,
    glideRatio: 9,
    vxKias: 60,
    vyKias: 75,
  };
}
