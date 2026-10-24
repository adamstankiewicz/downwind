import type { RunwayEnd } from '../lib/wind';

export interface Airport {
  icao: string;
  name: string;
  city: string;
  elevationFt: number;
  /** Degrees, positive east. */
  magneticVariationDeg: number;
  airspace: 'B' | 'C' | 'D' | 'E' | 'G';
  runways: RunwayEnd[];
  /** Stations to try for a TAF, in order. Not every field issues one. */
  tafStations: string[];
  /** Fields still to confirm against the current Chart Supplement / NASR. */
  verify: string[];
}

// Airports bundled with the app so lookup works offline. This is not a
// default home base: onboarding asks every pilot for theirs. Phase 1 replaces
// this with NASR data.
export const KASH: Airport = {
  icao: 'KASH',
  name: 'Boire Field',
  city: 'Nashua, NH',
  elevationFt: 199,
  magneticVariationDeg: -14,
  airspace: 'D',
  runways: [
    { id: '14', headingMag: 140 },
    { id: '32', headingMag: 320 },
  ],
  tafStations: ['KASH', 'KMHT', 'KBED'],
  verify: ['runway headings', 'magnetic variation'],
};

export const airports: Record<string, Airport> = { KASH };
