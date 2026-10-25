// The airplane a lesson flies. Module 3 works from the pilot's own weight and
// balance and performance tables when they have entered them, and from a
// made-up practice trainer when they haven't. Every grade in the module comes
// from the functions here, so the copy can never disagree with the numbers.

import { isConfigured, type AircraftProfile } from '../data/aircraft';
import { computeWb, FUEL_LB_PER_GAL, type LoadItem, type Station, type WbResult } from '../lib/wb';
import { climbRate, fuelPlan, sampleTrainerPerformance, tempAtAltitude, type FuelPlan, type Performance } from '../lib/perf';
import { densityAltitudeFt, pressureAltitudeFt } from '../lib/density';
import { tasFromIas } from '../lib/nav';
import type { Grade } from '../scenarios/goNoGo';

/**
 * A four-seat trainer that doesn't exist, for pilots who haven't entered an
 * airplane. Shaped like a typical 150 to 160 hp trainer so the lessons read
 * true, but it is no manufacturer's airplane and the UI says so.
 */
export const PRACTICE_TRAINER: AircraftProfile = {
  id: 'practice-trainer',
  tailNumber: '',
  type: 'Practice trainer',
  panel: [],
  emptyWeightLb: 1480,
  emptyArmIn: 39.2,
  maxGrossLb: 2400,
  usableFuelGal: 40,
  demonstratedCrosswindKt: 15,
  stations: [
    { id: 'front', label: 'Pilot and front passenger', armIn: 37 },
    { id: 'rear', label: 'Rear passengers', armIn: 73 },
    { id: 'fuel', label: 'Fuel', armIn: 48 },
    { id: 'bag1', label: 'Baggage', armIn: 95, maxLb: 120 },
  ],
  envelope: [
    [35.0, 1500],
    [35.0, 1950],
    [38.5, 2400],
    [47.3, 2400],
    [47.3, 1500],
  ],
  performance: sampleTrainerPerformance(),
  sampleValues: true,
};

export interface LessonAirplane {
  profile: AircraftProfile;
  perf: Performance;
  /** True when the pilot has no usable airplane and the practice trainer stands in. */
  practice: boolean;
  /** Weight and balance numbers are sample values, not the pilot's own record. */
  sampleWb: boolean;
  /** Performance tables are the labeled sample charts. */
  samplePerf: boolean;
  /** How the copy names it: "the practice trainer", "your Cessna 172K". */
  name: string;
  front: Station;
  rear: Station;
  fuel: Station;
  bag: Station | null;
}

const station = (a: AircraftProfile, id: string) => a.stations.find((s) => s.id === id && s.armIn > 0);

export function lessonAirplane(a: AircraftProfile): LessonAirplane {
  const own = isConfigured(a) && a.usableFuelGal > 0 && station(a, 'front') && station(a, 'rear') && station(a, 'fuel');
  const p = own ? a : PRACTICE_TRAINER;
  const bag = p.stations.find((s) => /^bag/.test(s.id) && s.armIn > 0) ?? null;
  return {
    profile: p,
    perf: p.performance ?? sampleTrainerPerformance(),
    practice: !own,
    sampleWb: p.sampleValues,
    samplePerf: !p.performance || p.sampleValues,
    name: own ? (a.type ? `your ${a.type}` : 'your airplane') : 'the practice trainer',
    front: station(p, 'front')!,
    rear: station(p, 'rear')!,
    fuel: station(p, 'fuel')!,
    bag,
  };
}

// ---------------------------------------------------------------- loading

export interface Loading {
  frontLb: number;
  rearLb: number;
  bagLb: number;
  fuelGal: number;
}

function items(ap: LessonAirplane, l: Loading, withFuel: boolean): LoadItem[] {
  const out: LoadItem[] = [
    { stationId: ap.front.id, weightLb: l.frontLb },
    { stationId: ap.rear.id, weightLb: l.rearLb },
  ];
  if (ap.bag && l.bagLb > 0) out.push({ stationId: ap.bag.id, weightLb: l.bagLb });
  if (withFuel) out.push({ stationId: ap.fuel.id, weightLb: l.fuelGal * FUEL_LB_PER_GAL });
  return out;
}

export function loadWb(ap: LessonAirplane, l: Loading): WbResult {
  const a = ap.profile;
  return computeWb(a.emptyWeightLb, a.emptyArmIn, a.stations, items(ap, l, true), a.envelope, a.maxGrossLb);
}

export function zeroFuelWb(ap: LessonAirplane, l: Loading): WbResult {
  const a = ap.profile;
  return computeWb(a.emptyWeightLb, a.emptyArmIn, a.stations, items(ap, l, false), a.envelope, a.maxGrossLb);
}

/** The most fuel that keeps this load at or under max gross, in whole gallons, capped at usable. */
export function fuelToGross(ap: LessonAirplane, l: Omit<Loading, 'fuelGal'>): number {
  const zfw = zeroFuelWb(ap, { ...l, fuelGal: 0 }).totalLb;
  return Math.max(0, Math.min(ap.profile.usableFuelGal, Math.floor((ap.profile.maxGrossLb - zfw) / FUEL_LB_PER_GAL)));
}

// ---------------------------------------------------------------- fuel

/**
 * The reserve this course plans to land with: an hour at cruise. 91.151 asks
 * for 30 minutes by day and 45 at night; that is the legal floor, not a plan.
 * Pilots set their own; this is the number the lessons use.
 */
export const REAL_RESERVE_MIN = 60;

export interface TripFuel {
  legal: FuelPlan;
  real: FuelPlan;
}

export function tripFuel(perf: Performance, o: { climbMin: number; cruiseMin: number; night: boolean; onBoardGal: number }): TripFuel {
  const legal = fuelPlan(perf, o);
  const legalMin = o.night ? 45 : 30;
  const real = fuelPlan(perf, { ...o, extraReserveMin: Math.max(0, REAL_RESERVE_MIN - legalMin) });
  return { legal, real };
}

/** Fuel against the plan: under the legal reserve is unsafe, under the real reserve is marginal. */
export function fuelGrade(t: TripFuel): Grade {
  if (t.legal.marginGal < 0) return 'unsafe';
  if (t.real.marginGal < 0) return 'marginal';
  return 'best';
}

/** Fuel left on landing, and how many minutes of cruise that is. */
export function landingFuel(perf: Performance, onBoardGal: number, burnedGal: number): { gal: number; min: number } {
  const gal = Math.round((onBoardGal - burnedGal) * 10) / 10;
  return { gal, min: Math.round((gal / perf.cruise.gph) * 60) };
}

/** Landing fuel in minutes against the legal and real reserves. */
export function reserveGrade(minutesLeft: number, night = false): Grade {
  if (minutesLeft < (night ? 45 : 30)) return 'unsafe';
  if (minutesLeft < REAL_RESERVE_MIN) return 'marginal';
  return 'best';
}

/**
 * A loading against the limits and the trip: over gross, outside the
 * envelope, over a station limit, more fuel than the tanks hold or less than
 * the legal reserve is unsafe. Legal but short of the real reserve is
 * marginal.
 */
export function loadingGrade(ap: LessonAirplane, l: Loading, trip: { climbMin: number; cruiseMin: number; night: boolean }): Grade {
  const wb = loadWb(ap, l);
  if (wb.overGross || !wb.withinEnvelope || wb.stationsOverMax.length > 0 || l.fuelGal > ap.profile.usableFuelGal) return 'unsafe';
  return fuelGrade(tripFuel(ap.perf, { ...trip, onBoardGal: l.fuelGal }));
}

const RANK: Grade[] = ['unsafe', 'marginal', 'acceptable', 'best'];

/** A safe choice that gives up the trip is at most acceptable: the best call keeps the flight and the margins. */
export function capGrade(g: Grade, cap: Grade): Grade {
  return RANK.indexOf(g) > RANK.indexOf(cap) ? cap : g;
}

// ---------------------------------------------------------------- runway and climb

/** The margin this course adds to book takeoff and landing distances: half again. */
export const RUNWAY_MARGIN = 1.5;

/** Book distance over the obstacle against the runway: past the end is unsafe, inside but under the margin is marginal. */
export function runwayGrade(over50Ft: number, runwayFt: number): Grade {
  if (over50Ft > runwayFt) return 'unsafe';
  if (over50Ft * RUNWAY_MARGIN > runwayFt) return 'marginal';
  return 'best';
}

export interface Air {
  fieldElevFt: number;
  altimeterInHg: number;
  oatC: number;
}

export function airAt(a: Air): { paFt: number; daFt: number } {
  return {
    paFt: Math.round(pressureAltitudeFt(a.fieldElevFt, a.altimeterInHg)),
    daFt: Math.round(densityAltitudeFt(a.fieldElevFt, a.altimeterInHg, a.oatC)),
  };
}

/**
 * Height gained climbing at Vy from the field over `distanceNm` of ground,
 * in still air. Steps a minute at a time, reading the climb chart at the
 * altitude reached and the temperature there (standard lapse), and flying Vy
 * as true airspeed from the density altitude.
 */
export function climbGainFt(perf: Performance, a: Air, distanceNm: number): number {
  const pa0 = pressureAltitudeFt(a.fieldElevFt, a.altimeterInHg);
  let gained = 0;
  let nm = 0;
  for (let min = 0; min < 60 && nm < distanceNm; min++) {
    const pa = pa0 + gained;
    const t = tempAtAltitude(a.oatC, a.fieldElevFt, a.fieldElevFt + gained);
    const da = pa + 120 * (t - (15 - (2 * pa) / 1000));
    const gs = tasFromIas(perf.vyKias, da);
    const frac = Math.min(1, ((distanceNm - nm) / gs) * 60);
    gained += climbRate(perf, pa, t).value * frac;
    nm += (gs / 60) * frac;
  }
  return Math.round(gained);
}
