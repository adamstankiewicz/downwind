// The checks behind module 9's decisions. Each one takes the numbers a lesson
// built and returns a grade per option, so a test can hold the grade against
// the rule it comes from: weight and fuel (91.9, 91.151), the forecast over
// the flight (91.103, 91.155), inoperative equipment (91.213, 91.205) and the
// runway with a margin on the book number.

import { isConfigured, sampleC172K, type AircraftProfile } from '../data/aircraft';
import type { PersonalMinimums } from '../data/pilot';
import { fuelPlan, sampleTrainerPerformance, type FuelPlan, type Performance } from '../lib/perf';
import { hoursFrom, type Taf } from '../lib/taf';
import { computeWb, FUEL_LB_PER_GAL, type LoadItem, type WbResult } from '../lib/wb';
import type { Grade } from '../scenarios/goNoGo';
import type { CalendarStatus } from './calendar';

// ---------------------------------------------------------------- the airplane

export interface OralAirplane {
  aircraft: AircraftProfile;
  performance: Performance;
  /** True when any number used is a sample rather than the pilot's own. */
  sample: boolean;
  /** True when the pilot's own profile couldn't be used and the sample trainer stands in. */
  standIn: boolean;
}

/**
 * The pilot's own airplane when its loading stations are filled in, otherwise
 * the sample trainer. Either way, performance falls back to the labeled sample
 * charts when the profile has none.
 */
export function oralAirplane(a: AircraftProfile): OralAirplane {
  const has = (id: string) => a.stations.some((s) => s.id === id && s.armIn > 0);
  const usable = isConfigured(a) && has('front') && has('rear') && has('fuel') && a.usableFuelGal > 0;
  const aircraft = usable ? a : sampleC172K;
  return {
    aircraft,
    performance: aircraft.performance ?? sampleTrainerPerformance(),
    sample: aircraft.sampleValues || !aircraft.performance,
    standIn: !usable,
  };
}

// ---------------------------------------------------------------- weight and fuel

export interface TripLoad {
  /** Pounds by station: front seats, rear seats, baggage. Fuel is set per option. */
  frontLb: number;
  rearLb: number;
  bagsLb: number;
  /** Where the bags go: the baggage station if there is one, otherwise the rear seats. */
  bagStation: string;
}

export function loadItems(load: TripLoad, fuelGal: number, bags = true): LoadItem[] {
  const items: LoadItem[] = [
    { stationId: 'front', weightLb: load.frontLb },
    { stationId: 'rear', weightLb: load.rearLb },
    { stationId: 'fuel', weightLb: fuelGal * FUEL_LB_PER_GAL },
  ];
  if (bags && load.bagsLb > 0) {
    if (load.bagStation === 'rear') items[1] = { stationId: 'rear', weightLb: load.rearLb + load.bagsLb };
    else items.push({ stationId: load.bagStation, weightLb: load.bagsLb });
  }
  return items;
}

export function weighTrip(plane: AircraftProfile, load: TripLoad, fuelGal: number, bags = true): WbResult {
  return computeWb(plane.emptyWeightLb, plane.emptyArmIn, plane.stations, loadItems(load, fuelGal, bags), plane.envelope, plane.maxGrossLb);
}

const legalWb = (w: WbResult) => !w.overGross && w.withinEnvelope && w.stationsOverMax.length === 0;

/** The most whole gallons that keep the loading inside gross weight and the envelope, or null if none do. */
export function maxFuelThatFits(plane: AircraftProfile, load: TripLoad, bags = true): number | null {
  for (let g = Math.floor(plane.usableFuelGal); g >= 0; g--) {
    if (legalWb(weighTrip(plane, load, g, bags))) return g;
  }
  return null;
}

/**
 * Rear-seat weight that puts full tanks `overLb` past maximum gross with the
 * front seats and bags given, kept to what the rear seats can hold. Lessons
 * use it so the loading problem lands the same way in any airplane.
 */
export function rearForOverload(plane: AircraftProfile, frontLb: number, bagsLb: number, overLb: number): number {
  const full = plane.emptyWeightLb + frontLb + bagsLb + plane.usableFuelGal * FUEL_LB_PER_GAL;
  const max = plane.stations.find((s) => s.id === 'rear')?.maxLb ?? 400;
  return Math.max(0, Math.min(max, Math.round((plane.maxGrossLb - full + overLb) / 10) * 10));
}

export type LoadOption = 'full-tanks' | 'leave-bags' | 'fuel-to-fit' | 'cancel';

export interface LoadCase {
  id: LoadOption;
  fuelGal: number;
  bags: boolean;
  wb: WbResult;
  fuel: FuelPlan;
}

/**
 * Grades for the loading decision. Flying options are unsafe when the airplane
 * is over gross, out of its envelope, or lands with less than the legal
 * reserve; best when it lands with at least `extraMin` more than that.
 * Calling the trip off is only best when no flying option is legal.
 */
export function gradeLoading(
  plane: OralAirplane,
  load: TripLoad,
  trip: { climbMin: number; cruiseMin: number; night: boolean },
  extraMin = 30,
): { cases: LoadCase[]; grades: Record<LoadOption, Grade> } {
  const a = plane.aircraft;
  const fit = maxFuelThatFits(a, load);
  const make = (id: LoadOption, fuelGal: number, bags: boolean): LoadCase => ({
    id, fuelGal, bags,
    wb: weighTrip(a, load, fuelGal, bags),
    fuel: fuelPlan(plane.performance, { ...trip, onBoardGal: fuelGal }),
  });
  const cases = [
    make('full-tanks', a.usableFuelGal, true),
    make('leave-bags', a.usableFuelGal, false),
    make('fuel-to-fit', fit ?? 0, true),
  ];
  const grade = (c: LoadCase): Grade => {
    if (!legalWb(c.wb) || c.fuel.marginGal < 0) return 'unsafe';
    return c.fuel.marginGal >= (plane.performance.cruise.gph * extraMin) / 60 ? 'best' : 'acceptable';
  };
  const g = Object.fromEntries(cases.map((c) => [c.id, fit === null && c.id === 'fuel-to-fit' ? 'unsafe' : grade(c)])) as Record<LoadOption, Grade>;
  const anyFlies = cases.some((c) => g[c.id] !== 'unsafe');
  g.cancel = anyFlies ? 'acceptable' : 'best';
  return { cases, grades: g };
}

export type BagOption = 'all-in' | 'less-fuel' | 'trim-bags' | 'cancel';

export interface BagCase {
  id: Exclude<BagOption, 'cancel'>;
  fuelGal: number;
  bagsLb: number;
  wb: WbResult;
  fuel: FuelPlan;
}

/** The most whole gallons that keep the loading under gross and inside the envelope, ignoring station limits. */
function fuelUnderGross(plane: AircraftProfile, load: TripLoad): number {
  for (let g = Math.floor(plane.usableFuelGal); g >= 0; g--) {
    const w = weighTrip(plane, load, g);
    if (!w.overGross && w.withinEnvelope) return g;
  }
  return 0;
}

/**
 * Bags over the baggage area's placarded limit. Gross weight and the
 * compartment limit are separate limits (91.9): taking less fuel can fix the
 * first and never the second. Leaving gear behind fixes both.
 */
export function gradeBags(
  plane: OralAirplane,
  load: TripLoad,
  limitLb: number,
  trip: { climbMin: number; cruiseMin: number; night: boolean },
  extraMin = 30,
): { cases: BagCase[]; grades: Record<BagOption, Grade> } {
  const a = plane.aircraft;
  const make = (id: BagCase['id'], fuelGal: number, bagsLb: number): BagCase => ({
    id, fuelGal, bagsLb,
    wb: weighTrip(a, { ...load, bagsLb }, fuelGal),
    fuel: fuelPlan(plane.performance, { ...trip, onBoardGal: fuelGal }),
  });
  const cases = [
    make('all-in', a.usableFuelGal, load.bagsLb),
    make('less-fuel', fuelUnderGross(a, load), load.bagsLb),
    make('trim-bags', a.usableFuelGal, Math.min(load.bagsLb, limitLb)),
  ];
  const grade = (c: BagCase): Grade => {
    if (!legalWb(c.wb) || c.fuel.marginGal < 0) return 'unsafe';
    return c.fuel.marginGal >= (plane.performance.cruise.gph * extraMin) / 60 ? 'best' : 'acceptable';
  };
  const g = Object.fromEntries(cases.map((c) => [c.id, grade(c)])) as Record<BagOption, Grade>;
  g.cancel = cases.some((c) => g[c.id] !== 'unsafe') ? 'acceptable' : 'best';
  return { cases, grades: g };
}

// ---------------------------------------------------------------- the forecast over the flight

export interface ForecastWindow {
  /** Lowest ceiling forecast for any part of the flight, null for none. */
  ceilingFt: number | null;
  /** Lowest visibility forecast for any part of the flight, null if never stated. */
  visibilitySm: number | null;
  /** Raw groups that touch the flight, in order. */
  groups: string[];
}

/** Every forecast group that overlaps the flight, taken at its worst (TEMPO and PROB included). */
export function forecastFor(taf: Taf, start: Date, hours: number): ForecastWindow {
  let ceilingFt: number | null = null;
  let visibilitySm: number | null = null;
  const groups: string[] = [];
  for (const p of taf.periods) {
    if (!p.from) continue;
    const a = hoursFrom(start, p.from);
    const b = p.to ? hoursFrom(start, p.to) : a + 24;
    if (b <= 0 || a >= hours) continue;
    groups.push(p.raw);
    if (p.ceilingFtAgl !== null) ceilingFt = ceilingFt === null ? p.ceilingFtAgl : Math.min(ceilingFt, p.ceilingFtAgl);
    if (p.visibilitySm !== null) visibilitySm = visibilitySm === null ? p.visibilitySm : Math.min(visibilitySm, p.visibilitySm);
  }
  return { ceilingFt, visibilitySm, groups };
}

/**
 * A flight inside the forecast: unsafe if any part is forecast below basic VFR
 * in a surface area (1,000 and 3), marginal if below the pilot's minimums,
 * best when the whole flight plus `bufferHours` after it stays inside them.
 */
export function gradeForecastWindow(taf: Taf, start: Date, hours: number, mins: PersonalMinimums, bufferHours = 1): Grade {
  const w = forecastFor(taf, start, hours);
  const below = (f: ForecastWindow, ceil: number, vis: number) =>
    (f.ceilingFt !== null && f.ceilingFt < ceil) || (f.visibilitySm !== null && f.visibilitySm < vis);
  if (below(w, 1000, 3)) return 'unsafe';
  if (below(w, mins.ceilingFt, mins.visibilitySm)) return 'marginal';
  return below(forecastFor(taf, start, hours + bufferHours), mins.ceilingFt, mins.visibilitySm) ? 'acceptable' : 'best';
}

export type ReturnOption = 'leave-now' | 'leave-late' | 'under-it' | 'stay';

/**
 * Sunday's trip home. Leaving at a time is graded by the forecast over that
 * flight; planning to fly under a low ceiling is never better than marginal;
 * staying over is best when no departure today is, and acceptable otherwise.
 */
export function gradeReturn(taf: Taf, early: Date, late: Date, hours: number, mins: PersonalMinimums): Record<ReturnOption, Grade> {
  const now = gradeForecastWindow(taf, early, hours, mins);
  const later = gradeForecastWindow(taf, late, hours, mins);
  return {
    'leave-now': now,
    'leave-late': later,
    'under-it': later === 'unsafe' ? 'unsafe' : 'marginal',
    stay: now === 'best' || later === 'best' ? 'acceptable' : 'best',
  };
}

// ---------------------------------------------------------------- inoperative equipment

export interface InopItem {
  id: string;
  name: string;
  /** 14 CFR 91.205 paragraph that requires it for the flight, if any. */
  required91205: { day: string | null; night: string | null };
  /** True if the type certificate, equipment list, KOEL or an AD requires it. */
  requiredByAirplane: boolean;
}

export type InopOption = 'fly-as-is' | 'placard-fly' | 'fix-first' | 'cancel';

export function inopRequired(item: InopItem, night: boolean): string | null {
  if (item.requiredByAirplane) return 'the airplane\'s equipment list';
  return night ? item.required91205.night ?? item.required91205.day : item.required91205.day;
}

/**
 * 14 CFR 91.213(d): without an MEL, an inoperative item may be flown with
 * only if nothing requires it for this flight, and it is removed or
 * deactivated and placarded "Inoperative". Required equipment means it gets
 * fixed (or a special flight permit) before the airplane goes anywhere.
 */
export function gradeInop(item: InopItem, night: boolean): Record<InopOption, Grade> {
  if (inopRequired(item, night)) return { 'fly-as-is': 'unsafe', 'placard-fly': 'unsafe', 'fix-first': 'best', cancel: 'acceptable' };
  return { 'fly-as-is': 'marginal', 'placard-fly': 'best', 'fix-first': 'acceptable', cancel: 'acceptable' };
}

export const INOP_LANDING_LIGHT: InopItem = {
  id: 'landing-light', name: 'landing light',
  // 91.205(c)(4) asks for a landing light only when the flight is for hire.
  required91205: { day: null, night: null },
  requiredByAirplane: false,
};

export const INOP_FUEL_GAUGE: InopItem = {
  id: 'fuel-gauge', name: 'left fuel quantity gauge',
  required91205: { day: '14 CFR 91.205(b)(9)', night: '14 CFR 91.205(b)(9)' },
  requiredByAirplane: false,
};

export const INOP_POSITION_LIGHTS: InopItem = {
  id: 'position-lights', name: 'position lights',
  required91205: { day: null, night: '14 CFR 91.205(c)(2)' },
  requiredByAirplane: false,
};

// ---------------------------------------------------------------- preventive maintenance

export type BulbOption = 'swap-fly' | 'swap-log' | 'placard-fly' | 'wait-mechanic';

/**
 * A burnt-out landing light bulb. Replacing landing light bulbs is preventive
 * maintenance (Part 43 appendix A(c)), which a certificated pilot may do on an
 * airplane they own or operate, not used for hire (43.3(g)), as long as it is
 * entered in the maintenance records (43.9). Flying without the light by day,
 * not for hire, is legal once it is placarded (91.213(d)).
 */
export function gradeBulb(o: { pilotOwns: boolean; forHire: boolean }): Record<BulbOption, Grade> {
  const mayDoIt = o.pilotOwns && !o.forHire;
  return {
    'swap-fly': mayDoIt ? 'marginal' : 'unsafe',
    'swap-log': mayDoIt ? 'best' : 'unsafe',
    'placard-fly': o.forHire ? 'unsafe' : 'acceptable',
    'wait-mechanic': mayDoIt ? 'acceptable' : 'best',
  };
}

// ---------------------------------------------------------------- the runway

/** Margin many instructors add to a book takeoff distance for an older airplane and an average pilot. */
export const RUNWAY_MARGIN = 1.5;

/** Unsafe if the book distance over 50 ft is longer than the runway; marginal without the margin; best with it. */
export function gradeRunway(over50Ft: number, runwayFt: number, margin = RUNWAY_MARGIN): Grade {
  if (over50Ft > runwayFt) return 'unsafe';
  return over50Ft * margin > runwayFt ? 'marginal' : 'best';
}

// ---------------------------------------------------------------- the flight review

export type ReviewOption = 'fly-friend' | 'fly-solo' | 'review-first' | 'wait';

/**
 * 14 CFR 61.56(c): no acting as pilot in command, with passengers or alone,
 * without a flight review in the preceding 24 calendar months. A review with a
 * CFI as pilot in command is the way back. A practical test for a certificate
 * or rating in the same 24 months counts instead (61.56(d)).
 */
export function gradeReviewLapse(s: CalendarStatus, checkrideCurrent = false): Record<ReviewOption, Grade> {
  if (checkrideCurrent) return { 'fly-friend': 'best', 'fly-solo': 'acceptable', 'review-first': 'acceptable', wait: 'marginal' };
  if (!s.current) return { 'fly-friend': 'unsafe', 'fly-solo': 'unsafe', 'review-first': 'best', wait: 'acceptable' };
  return { 'fly-friend': 'best', 'fly-solo': 'acceptable', 'review-first': 'acceptable', wait: 'acceptable' };
}
