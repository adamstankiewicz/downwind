// En route weather hazards as the advisories describe them (AIM 7-1-6): what
// each AIRMET and SIGMET covers, and how a pilot report changes the picture.
// An advisory is a forecast over a big area; a PIREP is what one airplane
// actually met at one place and time, and its intensity is relative to that
// airplane. Grades come from here, never from lesson copy.

import type { Grade } from '../scenarios/goNoGo';

export type Advisory = 'airmet-sierra' | 'airmet-tango' | 'airmet-zulu' | 'sigmet' | 'convective-sigmet';

export const ADVISORY_NAMES: Record<Advisory, string> = {
  'airmet-sierra': 'AIRMET Sierra',
  'airmet-tango': 'AIRMET Tango',
  'airmet-zulu': 'AIRMET Zulu',
  sigmet: 'SIGMET',
  'convective-sigmet': 'Convective SIGMET',
};

/** AIM 7-1-6: what each one is issued for. */
export const ADVISORY_COVERS: Record<Advisory, string> = {
  'airmet-sierra': 'IFR conditions and mountain obscuration',
  'airmet-tango': 'Moderate turbulence, sustained surface winds of 30 knots or more, low-level wind shear',
  'airmet-zulu': 'Moderate icing and freezing levels',
  sigmet: 'Severe icing, severe or extreme turbulence, dust storms, sandstorms, volcanic ash',
  'convective-sigmet': 'Thunderstorms: embedded, lines, large areas, or severe, with hail or strong surface winds',
};

export type Intensity = 'light' | 'moderate' | 'severe';

export interface Pirep {
  intensity: Intensity;
  /** A light airplane like yours, or a large one that rides it out better. */
  aircraft: 'light' | 'large';
  altFt: number;
}

/** A large airplane's "moderate" is felt a step harder in a light one. */
export function feltInLight(p: Pirep): Intensity {
  if (p.aircraft === 'light' || p.intensity === 'severe') return p.intensity;
  return p.intensity === 'light' ? 'moderate' : 'severe';
}

export interface HazardCase {
  advisory: Advisory;
  /** Pilot reports near the route at the altitudes you would fly. */
  pireps: Pirep[];
  /** A route around it that keeps 20 nm from a storm, or VFR clear of the area, exists within your fuel and daylight. */
  avoidable: boolean;
}

export type HazardOption = 'go' | 'deviate' | 'delay' | 'cancel';

/** The worst a light airplane can expect from the reports. Without any, assume the advisory is right. */
export function expectedIntensity(c: HazardCase): Intensity {
  const order: Intensity[] = ['light', 'moderate', 'severe'];
  if (c.pireps.length === 0) return c.advisory === 'sigmet' ? 'severe' : 'moderate';
  return c.pireps.map(feltInLight).reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), 'light' as Intensity);
}

/**
 * Grades for the trip. Convective SIGMETs: avoid by at least 20 miles a
 * severe storm (AIM 7-1-27) and never try to beat a line to a gap; the line
 * moves and builds, so waiting it out is the answer. AIRMET Sierra: VFR
 * into IFR is the one to avoid at any cost. AIRMET Tango and SIGMETs for
 * turbulence: what the reports say a light airplane meets decides it.
 */
export function gradeHazard(c: HazardCase): Record<HazardOption, Grade> {
  if (c.advisory === 'convective-sigmet') {
    return { go: 'unsafe', deviate: c.avoidable ? 'acceptable' : 'unsafe', delay: 'best', cancel: 'acceptable' };
  }
  if (c.advisory === 'airmet-sierra') {
    return { go: 'unsafe', deviate: c.avoidable ? 'best' : 'unsafe', delay: c.avoidable ? 'acceptable' : 'best', cancel: 'acceptable' };
  }
  const felt = expectedIntensity(c);
  if (felt === 'severe') return { go: 'unsafe', deviate: c.avoidable ? 'acceptable' : 'marginal', delay: 'best', cancel: 'acceptable' };
  if (felt === 'moderate') return { go: 'marginal', deviate: c.avoidable ? 'best' : 'marginal', delay: c.avoidable ? 'acceptable' : 'best', cancel: 'acceptable' };
  return { go: 'best', deviate: 'acceptable', delay: 'acceptable', cancel: 'marginal' };
}
