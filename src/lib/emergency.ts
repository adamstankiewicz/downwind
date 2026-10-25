// Engine-out arithmetic: how fast you come down, how far you reach with the
// wind, what a turn costs, and whether a field is long enough. Everything is
// worked from the airplane's own performance (best glide speed, glide ratio,
// landing tables), so the numbers change with the airplane. These are simple
// models for teaching the shape of the decision, not certified data. Brief
// your own numbers with a CFI at a safe altitude.

import { landingDistance, type Performance } from './perf';
import { norm } from './wind';

/** Feet per minute in one knot. */
export const FPM_PER_KT = 6076 / 60;
const G_FPS2 = 32.17;
const rad = (d: number) => (d * Math.PI) / 180;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Wind along a track, positive on the nose. Directions are true, wind is FROM. */
export function headwindOn(trackTrue: number, windFromTrue: number, windKt: number): number {
  return windKt * Math.cos(rad(windFromTrue - trackTrue));
}

/** Descent rate at best glide in still air, ft per minute. */
export function glideSinkFpm(p: Performance): number {
  return (p.bestGlideKias * FPM_PER_KT) / p.glideRatio;
}

/**
 * Glide distance along a track, nm, from a height you are willing to spend.
 * The wind changes groundspeed, not the descent rate, so it scales the range.
 */
export function glideReachNm(p: Performance, heightFt: number, trackTrue: number, windFromTrue: number, windKt: number): number {
  const still = (Math.max(0, heightFt) * p.glideRatio) / 6076;
  const gs = Math.max(0, p.bestGlideKias - headwindOn(trackTrue, windFromTrue, windKt));
  return r1(still * (gs / p.bestGlideKias));
}

export interface Reach {
  distanceNm: number;
  bearingTrue: number;
  /** Glide reach toward the target, keeping `keepFt` in hand for the pattern. */
  reachNm: number;
  reachable: boolean;
  /** Minutes at best glide to get there, with the wind. */
  minutes: number;
}

export function reach(p: Performance, heightAglFt: number, bearingTrue: number, distanceNm: number, windFromTrue: number, windKt: number, keepFt = 1000): Reach {
  const reachNm = glideReachNm(p, heightAglFt - keepFt, bearingTrue, windFromTrue, windKt);
  const gs = Math.max(1, p.bestGlideKias - headwindOn(bearingTrue, windFromTrue, windKt));
  return { distanceNm: r1(distanceNm), bearingTrue: Math.round(norm(bearingTrue)), reachNm, reachable: reachNm >= distanceNm, minutes: r1((distanceNm / gs) * 60) };
}

export interface GlidingTurn {
  bankDeg: number;
  turnDeg: number;
  loadFactor: number;
  /** Airspeed flown in the turn: best glide raised by the square root of the load factor. */
  speedKias: number;
  /** Percent the stall speed rises in this bank. */
  stallRisePct: number;
  seconds: number;
  sinkFpm: number;
  altitudeLostFt: number;
  radiusFt: number;
}

/**
 * A coordinated gliding turn. Holding the same angle of attack as best glide
 * means flying √n faster, and the descent rate rises by n^1.5. Steeper banks
 * turn faster but sink faster; the product is least near 45°.
 */
export function glidingTurn(p: Performance, bankDeg: number, turnDeg: number): GlidingTurn {
  const n = 1 / Math.cos(rad(bankDeg));
  const v = p.bestGlideKias * Math.sqrt(n);
  const vFps = (v * 6076) / 3600;
  const omega = (G_FPS2 * Math.tan(rad(bankDeg))) / vFps;
  const seconds = rad(turnDeg) / omega;
  const sinkFpm = glideSinkFpm(p) * n ** 1.5;
  return {
    bankDeg,
    turnDeg,
    loadFactor: Math.round(n * 100) / 100,
    speedKias: Math.round(v),
    stallRisePct: Math.round((Math.sqrt(n) - 1) * 100),
    seconds: Math.round(seconds),
    sinkFpm: Math.round(sinkFpm),
    altitudeLostFt: Math.round((sinkFpm * seconds) / 60 / 10) * 10,
    radiusFt: Math.round((vFps * vFps) / (G_FPS2 * Math.tan(rad(bankDeg)))),
  };
}

/** Heading change to come back to the runway, as the AFH example counts it: 180°, then 45° to point at it. */
export const TURNBACK_DEG = 225;

export interface Turnback {
  turn: GlidingTurn;
  reactionSec: number;
  reactionLossFt: number;
  /** How far past the liftoff point you are when it quits, ft along the ground. */
  outFt: number;
  heightAfterTurnFt: number;
  /** Height needed to glide `outFt` back with the wind behind you. */
  glideBackNeedFt: number;
  /** False when the turn alone costs more height than you have. */
  turnCompletes: boolean;
}

/**
 * The turn back after an engine failure on the climb out. Measured back to
 * the point you lifted off, which leaves out the runway past it, so it errs
 * on the harsh side. The point it makes holds either way: below the height
 * the turn itself costs, there is no runway to turn back to.
 */
export function turnback(p: Performance, o: { failureAglFt: number; climbFpm: number; headwindKt: number; bankDeg?: number; reactionSec?: number }): Turnback {
  const turn = glidingTurn(p, o.bankDeg ?? 45, TURNBACK_DEG);
  const gsOut = Math.max(1, p.vyKias - o.headwindKt);
  const climbMin = o.failureAglFt / Math.max(1, o.climbFpm);
  const reactionSec = o.reactionSec ?? 4;
  const outFt = gsOut * FPM_PER_KT * (climbMin + reactionSec / 60);
  // The AFH counts the reaction time as descent too: the nose is coming down and the airplane is already sinking.
  const reactionLossFt = Math.round((glideSinkFpm(p) * reactionSec) / 60 / 10) * 10;
  const heightAfterTurnFt = o.failureAglFt - reactionLossFt - turn.altitudeLostFt;
  const gsBack = p.bestGlideKias + o.headwindKt;
  const glideBackNeedFt = Math.round(outFt / (p.glideRatio * (gsBack / p.bestGlideKias)) / 10) * 10;
  return {
    turn,
    reactionSec,
    reactionLossFt,
    outFt: Math.round(outFt / 10) * 10,
    heightAfterTurnFt,
    glideBackNeedFt,
    turnCompletes: heightAfterTurnFt > 0,
  };
}

export type FieldSurface = 'mown' | 'pasture' | 'plowed' | 'road' | 'water';

export interface Field {
  id: string;
  name: string;
  bearingTrue: number;
  distanceNm: number;
  lengthFt: number;
  /** Direction you would land, true. */
  landingTrue: number;
  surface: FieldSurface;
  /** Height of anything on the approach end (wires, trees), 0 if clear. */
  obstacleFt: number;
}

export interface FieldCheck {
  reach: Reach;
  headwindKt: number;
  crosswindKt: number;
  /** Landing distance from the airplane's tables: over 50 ft when the approach has an obstacle, else ground roll. */
  needFt: number;
  fits: boolean;
  /** Plowed ground, a road with wires and traffic, or water: you can land, but not without damage risk. */
  rough: boolean;
}

/** A forced landing field, checked the way you would in the air: reach, wind, length, surface. */
export function checkField(p: Performance, f: Field, o: { heightAglFt: number; elevationFt: number; oatC: number; windFromTrue: number; windKt: number; keepFt?: number }): FieldCheck {
  const r = reach(p, o.heightAglFt, f.bearingTrue, f.distanceNm, o.windFromTrue, o.windKt, o.keepFt ?? 1000);
  const head = headwindOn(f.landingTrue, o.windFromTrue, o.windKt);
  const cross = Math.abs(o.windKt * Math.sin(rad(o.windFromTrue - f.landingTrue)));
  const d = landingDistance(p, {
    fieldElevFt: o.elevationFt, altimeterInHg: 29.92, oatC: o.oatC, headwindKt: head,
    surface: f.surface === 'road' ? 'paved' : 'grass',
  });
  const needFt = f.obstacleFt > 0 ? d.over50Ft : d.groundRollFt;
  return {
    reach: r,
    headwindKt: Math.round(head),
    crosswindKt: Math.round(cross),
    needFt,
    fits: needFt <= f.lengthFt,
    rough: f.surface === 'plowed' || f.surface === 'road' || f.surface === 'water',
  };
}
