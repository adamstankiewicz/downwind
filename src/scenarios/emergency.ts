// Grades for the emergency decisions in module 6. Each takes what the engine
// worked out (lib/emergency.ts) and returns a grade for every option, so the
// lesson copy, the debrief and the unit tests all read the same answer.
//
// The ordering behind every grade is the AFH's: fly the airplane first, then
// pick a place you can actually reach, then get on the ground soon enough.

import type { Grade } from './goNoGo';

/** 6.1: the engine quits on the climb out. */
export type AfterTakeoffChoice = 'land-ahead' | 'turn-back' | 'side-field' | 'restart-first';

export function gradeAfterTakeoff(o: { turnCompletes: boolean; aheadReachable: boolean; sideReachable: boolean; aheadBuiltUp?: boolean }): Record<AfterTakeoffChoice, Grade> {
  // Straight ahead into houses is still controlled, but it is no longer the lowest risk when an open field is in reach off to the side.
  const aheadOk = o.aheadReachable && !o.aheadBuiltUp;
  return {
    'land-ahead': aheadOk ? 'best' : o.aheadBuiltUp && o.sideReachable ? 'marginal' : 'acceptable',
    // Even a turn that completes is only for a pilot who has trained it in this airplane.
    'turn-back': o.turnCompletes ? 'marginal' : 'unsafe',
    'side-field': !o.sideReachable ? 'unsafe' : aheadOk ? 'acceptable' : 'best',
    // Holding the climb attitude without power bleeds the airspeed toward a stall.
    'restart-first': 'unsafe',
  };
}

/** 6.2: a glide from altitude. Airports by id, plus a field below and a delay. */
export function gradeGlideChoice(airports: { id: string; reachable: boolean; marginNm: number }[]): Record<string, Grade> {
  const reachable = airports.filter((a) => a.reachable);
  const bestMargin = Math.max(...reachable.map((a) => a.marginNm), -Infinity);
  const out: Record<string, Grade> = {};
  for (const a of airports) out[`glide-${a.id.toLowerCase()}`] = !a.reachable ? 'unsafe' : a.marginNm === bestMargin ? 'best' : 'acceptable';
  out['off-airport'] = reachable.length ? 'acceptable' : 'best';
  // Restart attempts belong on the way to a field, not instead of choosing one.
  out['troubleshoot-first'] = 'marginal';
  return out;
}

/** 6.3, electrical: what each response does to the source and to the time in the air. */
export interface FireResponse {
  id: string;
  cutsSource: boolean;
  landsSoon: boolean;
}

export function gradeFireResponse(r: FireResponse): Grade {
  if (!r.cutsSource) return 'unsafe';
  return r.landsSoon ? 'best' : 'marginal';
}

/** 6.3, engine fire: fuel first, then the quickest way to the ground you can reach. */
export interface EngineFireOption {
  id: string;
  cutsFuel: boolean;
  /** Minutes until the wheels are on the ground, or null if the place cannot be reached. */
  minutesToGround: number | null;
  restarts: boolean;
}

export function gradeEngineFire(options: EngineFireOption[]): Record<string, Grade> {
  const viable = options.filter((o) => o.cutsFuel && !o.restarts && o.minutesToGround !== null);
  const fastest = Math.min(...viable.map((o) => o.minutesToGround!), Infinity);
  const out: Record<string, Grade> = {};
  for (const o of options) {
    out[o.id] = !o.cutsFuel || o.restarts || o.minutesToGround === null ? 'unsafe' : o.minutesToGround === fastest ? 'best' : 'acceptable';
  }
  return out;
}

/** 6.4: a forced landing field, from the field check. */
export function gradeField(c: { reachable: boolean; fits: boolean; rough: boolean; headwindKt: number }): Grade {
  if (!c.reachable || !c.fits) return 'unsafe';
  if (c.rough || c.headwindKt < 0) return 'marginal';
  return 'best';
}

/** 6.5: partial power. Nearest suitable airport, or a field while power lasts. */
export type PartialPowerChoice = 'nearest' | 'press-home' | 'field-now' | 'circle';

export function gradePartialPower(o: { nearestInGlide: boolean; homeInGlide: boolean; homeIsNearest: boolean }): Record<PartialPowerChoice, Grade> {
  return {
    nearest: o.nearestInGlide ? 'best' : 'acceptable',
    'press-home': o.homeIsNearest ? 'best' : o.homeInGlide ? 'acceptable' : 'unsafe',
    // A precautionary landing while power remains beats a forced one later, but trades a runway for a field.
    'field-now': o.nearestInGlide || (o.homeIsNearest && o.homeInGlide) ? 'acceptable' : 'best',
    // Circling spends the power you have over a place you have not chosen.
    circle: 'marginal',
  };
}
