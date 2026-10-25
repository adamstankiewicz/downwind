// Illusions that lead to spatial disorientation and landing errors (AIM
// 8-1-5, PHAK ch. 17). Each one says what it makes you feel and what you
// then tend to do, so a lesson can ask for the tendency and grade the fix
// against the source rather than against its own copy.

import type { Grade } from '../scenarios/goNoGo';

export type ApproachIllusion = 'narrow' | 'wide' | 'upslope' | 'downslope' | 'featureless' | 'rain' | 'haze';

/** What you think, and the approach you fly because of it. */
export const APPROACH_ILLUSIONS: Record<ApproachIllusion, { name: string; feels: string; tendency: 'low' | 'high' }> = {
  narrow: { name: 'A narrower runway than you are used to', feels: 'higher than you are', tendency: 'low' },
  wide: { name: 'A wider runway than you are used to', feels: 'lower than you are', tendency: 'high' },
  upslope: { name: 'An upsloping runway or terrain', feels: 'higher than you are', tendency: 'low' },
  downslope: { name: 'A downsloping runway or terrain', feels: 'lower than you are', tendency: 'high' },
  featureless: { name: 'Water, snow or dark ground short of the runway', feels: 'higher than you are', tendency: 'low' },
  rain: { name: 'Rain on the windscreen', feels: 'higher than you are', tendency: 'low' },
  haze: { name: 'Haze', feels: 'farther from the runway than you are', tendency: 'low' },
};

export type VestibularIllusion = 'leans' | 'graveyard-spiral' | 'somatogravic' | 'coriolis' | 'inversion';

export const VESTIBULAR_ILLUSIONS: Record<VestibularIllusion, { name: string; cause: string; feels: string }> = {
  leans: { name: 'The leans', cause: 'Rolling level after a bank too slow for the inner ear to sense', feels: 'Banked the other way, so you lean or roll back into the old bank' },
  'graveyard-spiral': { name: 'Graveyard spiral', cause: 'A prolonged turn the inner ear stops sensing', feels: 'Wings level while the airplane descends; pulling back tightens the spiral' },
  somatogravic: { name: 'Somatogravic illusion', cause: 'Rapid acceleration, such as a takeoff into a dark night', feels: 'Nose high, so you push the nose down toward the ground' },
  coriolis: { name: 'Coriolis illusion', cause: 'Moving your head sharply in a prolonged turn', feels: 'Tumbling or rotating on an axis that isn\'t there' },
  inversion: { name: 'Inversion illusion', cause: 'An abrupt change from climb to level flight', feels: 'Tumbling backward, so you push the nose down' },
};

/** The situation on approach or departure where an illusion is at work. */
export type IllusionCase =
  | { kind: 'black-hole'; vgsi: boolean; litAlternateNm: number | null }
  | { kind: 'sloped'; slope: 'upslope' | 'downslope'; papiReds: 0 | 1 | 2 | 3 | 4 }
  | { kind: 'dark-takeoff' };

export type IllusionOption = 'picture' | 'numbers' | 'flat' | 'go-around' | 'divert' | 'papi' | 'push' | 'instruments' | 'turn-back' | 'outside';

/**
 * Grades for what to do. The fix for every visual illusion is the same idea:
 * fly numbers the illusion can't bend. On a dark approach, the pattern
 * altitude, a normal key position and the altimeter (about 300 feet a mile on
 * a 3° path), or a VGSI when there is one. On a sloped runway, the PAPI. On a
 * dark departure, the attitude indicator and a positive rate of climb.
 */
export function gradeIllusion(c: IllusionCase): Partial<Record<IllusionOption, Grade>> {
  if (c.kind === 'black-hole') {
    return {
      picture: 'unsafe',
      numbers: c.vgsi ? 'acceptable' : 'best',
      papi: c.vgsi ? 'best' : 'unsafe',
      // A long, shallow straight-in over the dark is the black hole's favorite setup, even flown with care.
      flat: 'marginal',
      divert: c.litAlternateNm !== null && c.litAlternateNm <= 25 ? 'acceptable' : 'marginal',
    };
  }
  if (c.kind === 'sloped') {
    // PHAK ch. 8 PAPI: two red and two white is on the path; more red is low, more white is high.
    const off = Math.abs(c.papiReds - 2) >= 2;
    const lowNow = c.papiReds >= 3;
    return {
      picture: lowNow || off ? 'unsafe' : 'marginal',
      papi: 'best',
      'go-around': off ? 'acceptable' : 'marginal',
      numbers: 'acceptable',
    };
  }
  return { push: 'unsafe', instruments: 'best', 'turn-back': 'marginal', outside: 'marginal' };
}
