// Aerodynamics a pilot uses: load factor in a turn and the stall speed that
// comes with it, maneuvering speed and how it falls with weight, and what
// ground effect does near the runway. The relations are the PHAK's (ch. 5);
// the speeds are the airplane's own when its POH numbers are in, otherwise a
// labeled sample, never a particular manufacturer's.

import type { Grade } from '../scenarios/goNoGo';

export interface VSpeeds {
  /** Stall, landing configuration. */
  vs0Kias: number;
  /** Stall, clean. */
  vs1Kias: number;
  /** Design maneuvering speed at maximum gross weight. */
  vaKias: number;
  /** Maximum structural cruising speed: top of the green arc. */
  vnoKias: number;
  /** Normal approach speed, landing flaps. */
  approachKias: number;
}

/** Sample trainer speeds for teaching, used when the profile has none. */
export const SAMPLE_SPEEDS: VSpeeds = { vs0Kias: 40, vs1Kias: 48, vaKias: 105, vnoKias: 127, approachKias: 65 };

const rad = (d: number) => (d * Math.PI) / 180;

/** PHAK ch. 5: in a level, coordinated turn the load factor is 1 / cos(bank). 60° is 2 g. */
export function loadFactor(bankDeg: number): number {
  return 1 / Math.cos(rad(bankDeg));
}

/** PHAK ch. 5: stall speed rises with the square root of the load factor. */
export function stallSpeedAt(vsKias: number, loadFactorG: number): number {
  return vsKias * Math.sqrt(loadFactorG);
}

/** The bank angle at which a level turn stalls at this airspeed. */
export function stallBankAt(vsKias: number, kias: number): number {
  if (kias <= vsKias) return 0;
  return (Math.acos((vsKias / kias) ** 2) * 180) / Math.PI;
}

/**
 * PHAK ch. 5: maneuvering speed falls with the square root of weight. Lighter,
 * the airplane reaches its limit load at a lower speed, so the placarded Va,
 * set at maximum gross, is too fast.
 */
export function maneuveringSpeed(vaAtGrossKias: number, weightLb: number, maxGrossLb: number): number {
  return vaAtGrossKias * Math.sqrt(Math.min(1, weightLb / maxGrossLb));
}

// ---------------------------------------------------------------- an overshooting turn to final

export type OvershootOption = 'rudder' | 'steepen' | 'through' | 'go-around';

/**
 * The base to final turn that overshoots. Tightening it with rudder skids the
 * airplane, the classic setup for a cross-control stall and spin at pattern
 * altitude (AFH ch. 4). Steepening the bank, coordinated, is only as good as
 * the stall margin it leaves: approach speed over the stall speed at that
 * bank, against 1.3, the margin an approach is flown at.
 */
export function gradeOvershoot(speeds: VSpeeds, bankNeededDeg: number): { stallKias: number; margin: number; grades: Record<OvershootOption, Grade> } {
  const stallKias = stallSpeedAt(speeds.vs0Kias, loadFactor(bankNeededDeg));
  const margin = speeds.approachKias / stallKias;
  const steepen: Grade = bankNeededDeg <= 30 && margin >= 1.3 ? 'best' : margin >= 1.2 ? 'marginal' : 'unsafe';
  return {
    stallKias, margin,
    grades: {
      rudder: 'unsafe',
      steepen,
      through: 'acceptable',
      'go-around': steepen === 'best' ? 'acceptable' : 'best',
    },
  };
}

// ---------------------------------------------------------------- turbulence

export type TurbulenceOption = 'cruise' | 'placard-va' | 'weight-va' | 'well-below' | 'climb-out';

/**
 * Turbulence that is more than light. Below maneuvering speed for the weight
 * you are at, a gust stalls the wing before it can overstress it. The
 * placarded Va is for maximum gross; at a lighter weight it is too fast.
 * Much slower than Va buys no more strength and leaves less room above the
 * stall when a gust takes some airspeed away: under 1.5 times the clean
 * stall speed, that room is thin.
 */
export function gradeTurbulence(speeds: VSpeeds, weightLb: number, maxGrossLb: number, wellBelowKias = speeds.vs1Kias * 1.4): { vaKias: number; grades: Record<TurbulenceOption, Grade> } {
  const va = maneuveringSpeed(speeds.vaKias, weightLb, maxGrossLb);
  const placardOk = speeds.vaKias - va <= 3;
  return {
    vaKias: va,
    grades: {
      cruise: 'unsafe',
      'placard-va': placardOk ? 'best' : 'marginal',
      'weight-va': 'best',
      'well-below': wellBelowKias >= speeds.vs1Kias * 1.5 ? 'acceptable' : 'marginal',
      'climb-out': 'marginal',
    },
  };
}

// ---------------------------------------------------------------- stalls

export type StallPhase = 'stall' | 'incipient-spin' | 'secondary';
export type StallOption = 'aileron' | 'reduce-aoa' | 'power-pull' | 'pare';

/**
 * Stall recovery (AFH ch. 5): reduce the angle of attack first, then level
 * the wings with coordinated aileron and rudder, then power. A spin that has
 * started (AFH ch. 5, the PARE checklist): power idle, ailerons neutral,
 * rudder opposite the rotation, elevator briskly forward. Picking up a
 * dropped wing with aileron at the stall deepens it on that side.
 */
export function gradeStallRecovery(phase: StallPhase): Record<StallOption, Grade> {
  if (phase === 'incipient-spin') return { aileron: 'unsafe', 'reduce-aoa': 'marginal', 'power-pull': 'unsafe', pare: 'best' };
  if (phase === 'secondary') return { aileron: 'unsafe', 'reduce-aoa': 'best', 'power-pull': 'unsafe', pare: 'marginal' };
  return { aileron: 'unsafe', 'reduce-aoa': 'best', 'power-pull': 'unsafe', pare: 'acceptable' };
}

// ---------------------------------------------------------------- ground effect

/**
 * Ground effect (PHAK ch. 5): within about one wingspan of the ground, induced
 * drag drops and the airplane flies at a lower speed than it can climb at.
 * Landing fast, it floats; the extra landing distance grows with the square of
 * the speed over the planned one (AFH ch. 8).
 */
export function floatDistance(bookOver50Ft: number, plannedKias: number, actualKias: number): number {
  return bookOver50Ft * ((actualKias / plannedKias) ** 2 - 1);
}

export type FloatOption = 'force' | 'hold-off' | 'go-around' | 'dive';

export function gradeFloat(remainingFt: number, neededFt: number): Record<FloatOption, Grade> {
  const fits = remainingFt >= neededFt;
  return { force: 'unsafe', 'hold-off': fits ? 'best' : 'unsafe', 'go-around': fits ? 'acceptable' : 'best', dive: 'unsafe' };
}
