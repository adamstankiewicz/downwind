// Human factors as rules a pilot can check: personal minimums adjusted for the
// day, fitness to fly (alcohol, medication, sleep), supplemental oxygen, night
// currency and the three nights of the regulations, and whether a VFR flight
// can keep going under a lowering ceiling. Every rule names its source; the
// numbers are the regulation's or the handbook's, never estimates of risk.

import type { PersonalMinimums } from '../data/pilot';
import { vfrMinimums, type AirspaceClass, type VfrMinimums } from './airspace';

const HOUR = 3_600_000;
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / HOUR;
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);

// ---------------------------------------------------------------- personal minimums

/** The situations the Risk Management Handbook (figure 2-9) says call for a wider margin. */
export type MarginFactor = 'unwell' | 'not-current' | 'unfamiliar' | 'pressure';

export const MARGIN_FACTORS: Record<MarginFactor, string> = {
  unwell: 'Illness, medication, stress or fatigue',
  'not-current': 'Lack of currency, such as not having flown for 30 days',
  unfamiliar: 'An unfamiliar airplane, airport, airspace or terrain',
  pressure: '"Must meet" deadlines or pressure from passengers',
};

/** RMH figure 2-9: add at least 500 ft of ceiling and half a mile, take at least 5 kt off the wind. */
export const MARGIN = { ceilingFt: 500, visibilitySm: 0.5, windKt: 5 } as const;

/**
 * Baseline minimums widened once when any factor applies, the way the
 * handbook's worksheet does it. The adjustment is "at least": a pilot may add
 * more, never less.
 */
export function adjustedMinimums(base: PersonalMinimums, factors: MarginFactor[]): PersonalMinimums {
  if (factors.length === 0) return base;
  return {
    ceilingFt: base.ceilingFt + MARGIN.ceilingFt,
    visibilitySm: base.visibilitySm + MARGIN.visibilitySm,
    crosswindKt: Math.max(0, base.crosswindKt - MARGIN.windKt),
    gustSpreadKt: Math.max(0, base.gustSpreadKt - MARGIN.windKt),
  };
}

// ---------------------------------------------------------------- fitness to fly

/** 14 CFR 91.17(a)(1): eight hours from the last drink to acting as a crewmember. */
export const BOTTLE_TO_THROTTLE_H = 8;
/** PHAK ch. 17: wait at least five maximal dosing intervals after a medication with adverse side effects. */
export const DOSING_INTERVALS_TO_WAIT = 5;
/** PHAK ch. 17: eight hours of sound sleep ordinarily cures acute fatigue. */
export const SOUND_SLEEP_H = 8;

export interface FitnessInput {
  lastDrinkAt: Date | null;
  /** A medication with potential adverse side effects (drowsiness, dizziness). */
  medication: { lastDoseAt: Date; maxDosingIntervalH: number } | null;
  sleepH: number;
}

export type FitnessSeverity = 'no-fly' | 'caution' | 'ok';

export interface FitnessItem {
  id: 'alcohol' | 'medication' | 'sleep';
  severity: FitnessSeverity;
  /** Hours since the drink or dose, or hours slept. */
  hours: number;
  /** When the item stops being a no-fly item, if it is one. */
  clearAt: Date | null;
  ref: string;
}

export function fitnessCheck(input: FitnessInput, departure: Date): FitnessItem[] {
  const out: FitnessItem[] = [];
  if (input.lastDrinkAt) {
    const h = hoursBetween(input.lastDrinkAt, departure);
    const clearAt = addHours(input.lastDrinkAt, BOTTLE_TO_THROTTLE_H);
    out.push({ id: 'alcohol', severity: h < BOTTLE_TO_THROTTLE_H ? 'no-fly' : 'ok', hours: h, clearAt, ref: '14 CFR 91.17' });
  }
  if (input.medication) {
    const h = hoursBetween(input.medication.lastDoseAt, departure);
    const wait = medicationWaitH(input.medication.maxDosingIntervalH);
    const clearAt = addHours(input.medication.lastDoseAt, wait);
    out.push({ id: 'medication', severity: h < wait ? 'no-fly' : 'ok', hours: h, clearAt, ref: '14 CFR 61.53' });
  }
  out.push({ id: 'sleep', severity: input.sleepH < SOUND_SLEEP_H ? 'caution' : 'ok', hours: input.sleepH, clearAt: null, ref: 'PHAK, fatigue' });
  return out;
}

export function medicationWaitH(maxDosingIntervalH: number): number {
  return DOSING_INTERVALS_TO_WAIT * maxDosingIntervalH;
}

/** The first moment every no-fly item has cleared. */
export function fitToFlyAt(items: FitnessItem[]): Date | null {
  const times = items.filter((i) => i.clearAt).map((i) => i.clearAt!.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

// ---------------------------------------------------------------- oxygen

export interface OxygenRule {
  /** Minutes the required crew must be on oxygen. */
  crewMinutes: number;
  /** Each occupant must be provided with oxygen (above 15,000 ft cabin altitude). */
  occupantsProvided: boolean;
  ref: string;
}

/**
 * 14 CFR 91.211(a) for a stretch flown at one cabin pressure altitude. Above
 * 12,500 up to 14,000 the crew uses oxygen for the part over 30 minutes; above
 * 14,000 for all of it; above 15,000 everyone aboard must be offered it.
 */
export function oxygenRequired(cabinAltMsl: number, minutes: number): OxygenRule {
  const ref = '14 CFR 91.211';
  if (cabinAltMsl > 14000) return { crewMinutes: minutes, occupantsProvided: cabinAltMsl > 15000, ref };
  if (cabinAltMsl > 12500) return { crewMinutes: Math.max(0, minutes - 30), occupantsProvided: false, ref };
  return { crewMinutes: 0, occupantsProvided: false, ref };
}

// ---------------------------------------------------------------- night

export interface NightTimes {
  /** 91.209: position lights on from sunset to sunrise. */
  lightsFrom: Date;
  /** 14 CFR 1.1: night time you log starts at the end of evening civil twilight. */
  loggingFrom: Date;
  /** 61.57(b): passenger currency counts from one hour after sunset. */
  currencyFrom: Date;
}

export function nightTimes(sunset: Date, civilTwilightEnd: Date): NightTimes {
  return { lightsFrom: sunset, loggingFrom: civilTwilightEnd, currencyFrom: addHours(sunset, 1) };
}

export interface NightLanding {
  at: Date;
  /** Sunset on that day, to judge "one hour after sunset". */
  sunset: Date;
  fullStop: boolean;
}

/** 61.57(b): three takeoffs and three landings to a full stop, an hour or more after sunset, in the last 90 days. */
export const NIGHT_LANDINGS_REQUIRED = 3;
export const CURRENCY_DAYS = 90;

export interface NightCurrency {
  counted: number;
  needed: number;
  current: boolean;
  /** Why each landing did or did not count, in the order given. */
  reasons: ('counts' | 'touch-and-go' | 'too-early' | 'too-old')[];
}

export function nightCurrency(landings: NightLanding[], now: Date): NightCurrency {
  const reasons = landings.map((l) => {
    if (hoursBetween(l.at, now) > CURRENCY_DAYS * 24) return 'too-old' as const;
    if (hoursBetween(l.sunset, l.at) < 1) return 'too-early' as const;
    if (!l.fullStop) return 'touch-and-go' as const;
    return 'counts' as const;
  });
  const counted = reasons.filter((r) => r === 'counts').length;
  return { counted, needed: Math.max(0, NIGHT_LANDINGS_REQUIRED - counted), current: counted >= NIGHT_LANDINGS_REQUIRED, reasons };
}

/** Passengers may be carried on a flight unless it lands after currency-night begins and the pilot isn't current. */
export function mayCarryPassengers(currency: NightCurrency, landingAt: Date, sunset: Date): boolean {
  return currency.current || landingAt.getTime() <= addHours(sunset, 1).getTime();
}

// ---------------------------------------------------------------- continuing under a lowering ceiling

/** 91.119(c): away from congested areas, no closer than 500 ft to any person, vessel, vehicle or structure. */
export const ABOVE_SURFACE_FT = 500;

export interface Squeeze {
  /** Cloud base minus the highest ground or obstacle under the route. */
  gapFt: number;
  /** The lowest you may fly over that point (91.119(c)), and the class you would be in there. */
  lowestMsl: number;
  cls: AirspaceClass;
  minimums: VfrMinimums;
  /** Basic VFR can still be flown at the lowest altitude: under the cloud clearance, with the visibility. */
  legal: boolean;
  /** The gap meets the pilot's own ceiling minimum, measured above that ground. */
  withinPersonal: boolean;
}

/**
 * Whether a VFR flight still fits between a cloud base and the highest point
 * under it. `classAt` says which class the lowest altitude falls in (from the
 * chart). Low over the ground in Class G by day the law asks only for clear of
 * clouds and a mile, which is why the pilot's own minimum has to do the work.
 */
export function squeeze(
  o: { cloudBaseMsl: number; highestMsl: number; groundMsl: number; visibilitySm: number; night: boolean; mins: PersonalMinimums },
  classAt: (altMsl: number) => AirspaceClass,
): Squeeze {
  const gapFt = o.cloudBaseMsl - o.highestMsl;
  const lowestMsl = o.highestMsl + ABOVE_SURFACE_FT;
  const cls = classAt(lowestMsl);
  const minimums = vfrMinimums(cls, lowestMsl, o.groundMsl, o.night);
  const top = o.cloudBaseMsl - (minimums.clouds?.belowFt ?? 0);
  const legal = lowestMsl < top && o.visibilitySm >= minimums.visibilitySm;
  return { gapFt, lowestMsl, cls, minimums, legal, withinPersonal: gapFt >= o.mins.ceilingFt };
}
