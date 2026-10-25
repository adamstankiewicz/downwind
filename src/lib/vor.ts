// The VOR as the pilot reads it: the course set on the OBS, the needle, and
// the TO/FROM flag (PHAK ch. 16). The indicator doesn't know which way the
// airplane is pointed, only where it is: on which radial, that is, which
// magnetic bearing from the station. Everything a pilot gets wrong with a VOR
// comes from forgetting that, so the heading is a separate input here.

import type { Grade } from '../scenarios/goNoGo';

/** Degrees in 0..359. */
export const norm360 = (d: number) => ((Math.round(d) % 360) + 360) % 360;
/** Degrees in -180..180. */
export const norm180 = (d: number) => { const x = norm360(d); return x > 180 ? x - 360 : x; };

/** Full-scale needle deflection on a VOR: 10° either side, 2° a dot, five dots. */
export const FULL_SCALE_DEG = 10;
export const DEG_PER_DOT = 2;

export interface VorIndication {
  /** OFF when the airplane is close to abeam the selected course, where the flag can't tell. */
  flag: 'TO' | 'FROM' | 'OFF';
  /** Where the needle sits, in degrees: positive is right of center. Clamped to full scale. */
  needleDeg: number;
  /** How far off the course line the airplane is, in degrees, before clamping. */
  offDeg: number;
}

/**
 * The indication on radial `radial` with `obs` set. With a FROM flag the
 * course line is the radial `obs` itself; with TO, it is the reciprocal.
 * The needle shows where the course line is, as seen flying the OBS course.
 */
export function vorIndication(radial: number, obs: number): VorIndication {
  const d = norm180(radial - obs);
  if (Math.abs(Math.abs(d) - 90) < 3) return { flag: 'OFF', needleDeg: 0, offDeg: 90 };
  const from = Math.abs(d) < 90;
  const off = from ? d : norm180(radial - (obs + 180));
  // FROM: on a radial clockwise of the course you are right of it, so the needle swings left.
  // TO: on a radial clockwise of the reciprocal you are left of it, so the needle swings right.
  const needle = from ? 0 - off : off;
  return { flag: from ? 'FROM' : 'TO', needleDeg: Math.max(-FULL_SCALE_DEG, Math.min(FULL_SCALE_DEG, needle)), offDeg: Math.abs(off) };
}

/** The OBS setting that centers the needle with a TO flag: the course direct to the station. */
export const courseToStation = (radial: number) => norm360(radial + 180);

/**
 * Reverse sensing: flown on a heading roughly opposite the OBS course, the
 * needle points away from the course line. The fix is to set the course you
 * are actually flying.
 */
export function reverseSensing(headingMag: number, obs: number): boolean {
  return Math.abs(norm180(headingMag - obs)) > 90;
}

export type VorTurnOption = 'left' | 'right' | 'hold' | 'reset';

/** Which way to turn to get back to the course line, from where the airplane is pointed. */
export function turnToCourse(radial: number, obs: number, headingMag: number): 'left' | 'right' | 'on' {
  const ind = vorIndication(radial, obs);
  if (Math.abs(ind.needleDeg) < 1) return 'on';
  const needleRight = ind.needleDeg > 0;
  const towardNeedle = reverseSensing(headingMag, obs) ? !needleRight : needleRight;
  return towardNeedle ? 'right' : 'left';
}

/**
 * Grades for the turn back to the course. With normal sensing, turn toward
 * the needle; resetting the OBS to center it and flying the new course also
 * works, it just gives up the course you planned. With reverse sensing the
 * best fix is to set the OBS to the course being flown, so the needle reads
 * normally again; turning away from the needle is right but fragile.
 */
export function gradeVorTurn(radial: number, obs: number, headingMag: number): { turn: 'left' | 'right' | 'on'; reverse: boolean; grades: Record<VorTurnOption, Grade> } {
  const turn = turnToCourse(radial, obs, headingMag);
  const reverse = reverseSensing(headingMag, obs);
  if (turn === 'on') return { turn, reverse, grades: { left: 'marginal', right: 'marginal', hold: 'best', reset: 'acceptable' } };
  const wrong = turn === 'left' ? 'right' : 'left';
  const grades = { hold: 'marginal', [wrong]: 'marginal' } as Record<VorTurnOption, Grade>;
  grades[turn] = reverse ? 'acceptable' : 'best';
  grades.reset = reverse ? 'best' : 'acceptable';
  return { turn, reverse, grades };
}

export type IdentHeard = 'station' | 'test' | 'none';
export type IdentOption = 'fly-it' | 'pilotage' | 'other-vor' | 'turn-back';

/**
 * AIM 1-1-3 and 1-1-11: identify a VOR by its Morse code before using it. A station
 * under maintenance either drops its ident or sends T-E-S-T, and may give
 * wrong indications while it does. A centered needle proves nothing then.
 */
export function gradeIdent(heard: IdentHeard): Record<IdentOption, Grade> {
  if (heard === 'station') return { 'fly-it': 'best', pilotage: 'acceptable', 'other-vor': 'acceptable', 'turn-back': 'marginal' };
  return { 'fly-it': 'unsafe', pilotage: 'best', 'other-vor': 'acceptable', 'turn-back': 'acceptable' };
}

/** International Morse for the letters used in idents. */
const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
};

export const morse = (ident: string) => ident.toUpperCase().split('').map((c) => MORSE[c] ?? '').join('  ');
