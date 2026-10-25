// Cross-country decisions: the fuel plan, the cruising altitude, a checkpoint
// that doesn't fit the clock, the diversion and the lost-pilot call. Every
// grade comes from facts computed here with the nav and performance engine,
// so a lesson's copy can follow the grade instead of asserting it.

import type { AircraftProfile } from '../data/aircraft';
import type { Region } from '../chart/practiceRegion';
import { positionAt } from '../lib/airspace';
import { isLegalVfrAltitude, destination, distanceNm, trueCourse, windTriangle, type LatLon, type NavPoint } from '../lib/nav';
import { landingDistance, sampleTrainerPerformance, vfrReserveMin, type FuelPlan, type Performance } from '../lib/perf';
import { norm, trueToMagnetic } from '../lib/wind';
import type { Grade } from './goNoGo';

/** Usable fuel assumed when the pilot hasn't entered their airplane. Sample, and labeled as such. */
export const SAMPLE_USABLE_GAL = 38;

export interface XcAirplane {
  perf: Performance;
  usableGal: number;
  /** True when any number comes from sample data rather than the pilot's POH. */
  sample: boolean;
  /** How the copy names the airplane: the pilot's type, or "the sample trainer". */
  name: string;
}

export function xcAirplane(a: AircraftProfile): XcAirplane {
  const own = a.performance && !a.sampleValues;
  return {
    perf: a.performance ?? sampleTrainerPerformance(),
    usableGal: a.usableFuelGal > 0 ? a.usableFuelGal : SAMPLE_USABLE_GAL,
    sample: !own || a.usableFuelGal <= 0,
    name: a.type ? `your ${a.type}` : 'the sample trainer',
  };
}

export function navPoint(r: Region, id: string): NavPoint {
  const a = r.airports.find((x) => x.id === id);
  if (a) return { id: a.id, name: a.name, ...a.pos };
  const c = r.checkpoints.find((x) => x.id === id);
  if (c) return { id: c.id, name: c.name, ...c.pos };
  throw new Error(`No airport or checkpoint ${id} on ${r.name}`);
}

/* ---------------------------------------------------------------- fuel */

export type FuelChoice = 'nonstop' | 'top-off' | 'fuel-stop' | 'shorter';

/**
 * The out-and-back fuel call. Legal is the 91.151 reserve; a plan that lands
 * with less than another half hour on top of it is legal but thin, because
 * one stronger headwind than forecast eats it.
 */
export function gradeFuelPlan(o: { plan: FuelPlan; fullPlan: FuelPlan; gph: number; destinationHasFuel: boolean }): Record<FuelChoice, Grade> {
  const thin = (o.gph * 30) / 60;
  const onFuel = (p: FuelPlan): Grade => (p.marginGal < 0 ? 'unsafe' : p.marginGal < thin ? 'marginal' : 'best');
  return {
    nonstop: onFuel(o.plan),
    'top-off': onFuel(o.fullPlan),
    'fuel-stop': o.destinationHasFuel ? 'best' : 'unsafe',
    shorter: 'acceptable',
  };
}

/* ---------------------------------------------------------------- winds aloft */

export interface WindAloft {
  altFt: number;
  dirTrue: number;
  speedKt: number;
  /** Null at 3,000 ft, where the forecast gives no temperature. */
  tempC: number | null;
}

/** One station's line of a winds and temperatures aloft forecast (FB), e.g. "2810 2822+04 2830-01". */
export function fbGroup(w: WindAloft): string {
  const dir = String(Math.round(norm(w.dirTrue) / 10)).padStart(2, '0');
  const spd = String(Math.round(w.speedKt)).padStart(2, '0');
  if (w.tempC === null) return `${dir}${spd}`;
  const t = String(Math.abs(Math.round(w.tempC))).padStart(2, '0');
  return `${dir}${spd}${w.altFt > 24000 ? '' : w.tempC < 0 ? '-' : '+'}${t}`;
}

/** Linear interpolation between the forecast levels, the way you would do it on paper. */
export function windAt(levels: WindAloft[], altFt: number): { dirTrue: number; speedKt: number } {
  const ls = [...levels].sort((a, b) => a.altFt - b.altFt);
  if (altFt <= ls[0].altFt) return { dirTrue: ls[0].dirTrue, speedKt: ls[0].speedKt };
  const last = ls[ls.length - 1];
  if (altFt >= last.altFt) return { dirTrue: last.dirTrue, speedKt: last.speedKt };
  let i = 0;
  while (ls[i + 1].altFt < altFt) i++;
  const a = ls[i];
  const b = ls[i + 1];
  const t = (altFt - a.altFt) / (b.altFt - a.altFt);
  // Direction the short way round.
  const dd = ((b.dirTrue - a.dirTrue + 540) % 360) - 180;
  return { dirTrue: Math.round(norm(a.dirTrue + dd * t)), speedKt: Math.round(a.speedKt + (b.speedKt - a.speedKt) * t) };
}

export interface AltitudeOption {
  altFt: number;
  /** Total en route minutes at this altitude with its wind. */
  minutes: number;
}

/**
 * 91.159 above 3,000 AGL decides legality; an altitude within 1,000 ft of
 * the highest terrain or obstacle on the route is thin. Of the rest, the one
 * that gets there soonest is best.
 */
export function gradeCruiseAltitudes(o: { options: AltitudeOption[]; magCourses: number[]; lowestGroundFt: number; mefFt: number }): Record<number, Grade> {
  const out: Record<number, Grade> = {};
  const ok: AltitudeOption[] = [];
  for (const opt of o.options) {
    const legal = o.magCourses.every((mc) => isLegalVfrAltitude(mc, opt.altFt, o.lowestGroundFt));
    if (!legal) out[opt.altFt] = 'unsafe';
    else if (opt.altFt < o.mefFt + 1000) out[opt.altFt] = 'marginal';
    else ok.push(opt);
  }
  const fastest = Math.min(...ok.map((x) => x.minutes));
  for (const opt of ok) out[opt.altFt] = opt.minutes === fastest ? 'best' : 'acceptable';
  return out;
}

/* ---------------------------------------------------------------- checkpoints */

/** Distance along the course from `a` to `b` to the point abeam `p`, and how far off the course it is (right positive). */
export function alongTrack(a: LatLon, b: LatLon, p: LatLon): { alongNm: number; crossNm: number } {
  const d = distanceNm(a, p);
  const diff = ((trueCourse(a, p) - trueCourse(a, b)) * Math.PI) / 180;
  return { alongNm: d * Math.cos(diff), crossNm: d * Math.sin(diff) };
}

/**
 * Could a feature seen `minutes` after the last fix be the checkpoint? Dead
 * reckoning puts you at groundspeed times time; a checkpoint more than a
 * couple of miles (or 15 percent of the distance flown) from there is not the
 * one you are looking at.
 */
export function fitsTheClock(o: { gsKt: number; minutes: number; checkpointAlongNm: number }): { expectedNm: number; offByNm: number; fits: boolean } {
  const expectedNm = (o.gsKt * o.minutes) / 60;
  const offByNm = Math.abs(expectedNm - o.checkpointAlongNm);
  return { expectedNm, offByNm, fits: offByNm <= Math.max(2, 0.15 * expectedNm) };
}

export type SightingChoice = 'turn-now' | 'hold-heading' | 'circle';

/**
 * Turning at a feature that doesn't fit the clock is how a small error turns
 * into lost. Holding heading and time keeps dead reckoning intact. Circling
 * to study the feature costs time and fuel but isn't wrong.
 */
export function gradeSighting(fits: boolean): Record<SightingChoice, Grade> {
  return fits
    ? { 'turn-now': 'best', 'hold-heading': 'acceptable', circle: 'acceptable' }
    : { 'turn-now': 'marginal', 'hold-heading': 'best', circle: 'acceptable' };
}

/* ---------------------------------------------------------------- diversion */

export interface DiversionField {
  id: string;
  name: string;
  pos: LatLon;
  elevationFt: number;
  runwayFt: number;
  surface: 'paved' | 'grass';
  fuel: boolean;
}

export interface Leg {
  trueCourse: number;
  magCourse: number;
  magHeading: number;
  distanceNm: number;
  groundspeedKt: number;
  minutes: number;
  fuelGal: number;
}

export function legTo(from: LatLon, to: LatLon, o: { tasKt: number; windFromTrue: number; windKt: number; variationDeg: number; gph: number }): Leg {
  const tc = Math.round(trueCourse(from, to));
  const w = windTriangle(tc, o.tasKt, o.windFromTrue, o.windKt);
  const nm = Math.round(distanceNm(from, to) * 10) / 10;
  const minutes = w.groundspeedKt > 0 ? Math.round((nm / w.groundspeedKt) * 60) : Infinity;
  return {
    trueCourse: tc,
    magCourse: Math.round(trueToMagnetic(tc, o.variationDeg)),
    magHeading: Math.round(trueToMagnetic(w.trueHeading, o.variationDeg)),
    distanceNm: nm,
    groundspeedKt: w.groundspeedKt,
    minutes,
    fuelGal: Math.round(((minutes * o.gph) / 60) * 10) / 10,
  };
}

/** Does the straight line from a to b pass within `radiusNm` of `center`? */
export function lineCrosses(a: LatLon, b: LatLon, center: LatLon, radiusNm: number): boolean {
  const n = 40;
  const tc = trueCourse(a, b);
  const d = distanceNm(a, b);
  for (let i = 0; i <= n; i++) if (distanceNm(destination(a, tc, (d * i) / n), center) <= radiusNm) return true;
  return false;
}

export interface DiversionFacts {
  field: DiversionField;
  leg: Leg;
  intoWeather: boolean;
  /** Fuel on landing minus the legal reserve. */
  fuelMarginGal: number;
  /** Landing distance over a 50 ft obstacle at the field, ft. */
  landingOver50Ft: number;
  /** Runway available over landing distance needed. */
  runwayFactor: number;
}

/** A runway with less than half again the landing distance over 50 ft is thin for a diversion field you've never seen. */
export const RUNWAY_FACTOR = 1.5;

export function diversionFacts(o: {
  from: LatLon; fields: DiversionField[]; weather: { center: LatLon; radiusNm: number };
  perf: Performance; tasKt: number; windFromTrue: number; windKt: number; variationDeg: number;
  fuelOnBoardGal: number; surfaceTempC: number; altimeterInHg: number;
}): DiversionFacts[] {
  const reserve = (o.perf.cruise.gph * vfrReserveMin(false)) / 60;
  return o.fields.map((field) => {
    const leg = legTo(o.from, field.pos, { tasKt: o.tasKt, windFromTrue: o.windFromTrue, windKt: o.windKt, variationDeg: o.variationDeg, gph: o.perf.cruise.gph });
    const oat = o.surfaceTempC - (2 * field.elevationFt) / 1000;
    const ldg = landingDistance(o.perf, { fieldElevFt: field.elevationFt, altimeterInHg: o.altimeterInHg, oatC: oat, headwindKt: 0, surface: field.surface });
    return {
      field, leg,
      intoWeather: lineCrosses(o.from, field.pos, o.weather.center, o.weather.radiusNm),
      fuelMarginGal: Math.round((o.fuelOnBoardGal - leg.fuelGal - reserve) * 10) / 10,
      landingOver50Ft: ldg.over50Ft,
      runwayFactor: Math.round((field.runwayFt / ldg.over50Ft) * 100) / 100,
    };
  });
}

/**
 * Into the weather, short of fuel, or a runway shorter than the landing
 * distance: unsafe. A runway under the 1.5 factor: marginal. Of the fields
 * that pass, the soonest on the ground is best and the rest acceptable.
 */
export function gradeDiversion(facts: DiversionFacts[]): Record<string, Grade> {
  const out: Record<string, Grade> = {};
  const ok: DiversionFacts[] = [];
  for (const f of facts) {
    if (f.intoWeather || f.fuelMarginGal < 0 || f.runwayFactor < 1) out[f.field.id] = 'unsafe';
    else if (f.runwayFactor < RUNWAY_FACTOR) out[f.field.id] = 'marginal';
    else ok.push(f);
  }
  const soonest = Math.min(...ok.map((f) => f.leg.minutes));
  for (const f of ok) out[f.field.id] = f.leg.minutes === soonest ? 'best' : 'acceptable';
  return out;
}

/* ---------------------------------------------------------------- lost */

/** Where you really are after flying a heading at TAS for some minutes in a wind. */
export function deadReckon(from: LatLon, headingTrue: number, tasKt: number, windFromTrue: number, windKt: number, minutes: number): LatLon {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = minutes / 60;
  // Air vector plus wind vector (the wind blows toward windFrom + 180), in nm north and east.
  const n = tasKt * Math.cos(r(headingTrue)) * h - windKt * Math.cos(r(windFromTrue)) * h;
  const e = tasKt * Math.sin(r(headingTrue)) * h - windKt * Math.sin(r(windFromTrue)) * h;
  const d = Math.hypot(n, e);
  if (d === 0) return from;
  return destination(from, norm((Math.atan2(e, n) * 180) / Math.PI), d);
}

/**
 * Minutes until a track first enters airspace you may not fly into without
 * a clearance (Class B, restricted, prohibited), and which, or null if not
 * within `lookMin`.
 */
export function minutesToClearanceAirspace(r: Region, from: LatLon, trackTrue: number, gsKt: number, altMsl: number, lookMin = 30): { minutes: number; name: string } | null {
  for (let m = 0; m <= lookMin; m++) {
    const p = destination(from, trackTrue, (gsKt * m) / 60);
    const pos = positionAt(r.airspace, p, altMsl, r.groundFt(p));
    if (pos.cls === 'B' && pos.volume) return { minutes: m, name: pos.volume.name };
    const sua = pos.special.find((v) => v.cls === 'Restricted' || v.cls === 'Prohibited');
    if (sua) return { minutes: m, name: sua.name };
  }
  return null;
}

export type LostChoice = 'climb-call' | 'reverse' | 'descend-look' | 'press-on';

/**
 * Climb, communicate, confess, comply, conserve is always the best answer.
 * Retracing to the last fix is fine if the fuel allows it. Descending to read
 * a sign puts you near towers and terrain; pressing on is unsafe when the
 * track leads into airspace that needs a clearance within 15 minutes.
 */
export function gradeLost(o: { enduranceAfterReserveMin: number; minutesBackToFix: number; minutesToClearanceAirspace: number | null; obstacleWithin5NmAboveDescentAlt: boolean }): Record<LostChoice, Grade> {
  return {
    'climb-call': 'best',
    reverse: o.minutesBackToFix <= o.enduranceAfterReserveMin ? 'acceptable' : 'marginal',
    'descend-look': o.obstacleWithin5NmAboveDescentAlt ? 'unsafe' : 'marginal',
    'press-on': o.minutesToClearanceAirspace !== null && o.minutesToClearanceAirspace <= 15 ? 'unsafe' : 'marginal',
  };
}
