import type { Envelope, Station } from '../lib/wb';

export interface AircraftProfile {
  id: string;
  tailNumber: string;
  type: string;
  panel: string[];
  emptyWeightLb: number;
  emptyArmIn: number;
  maxGrossLb: number;
  usableFuelGal: number;
  demonstratedCrosswindKt: number;
  stations: Station[];
  envelope: Envelope;
  /**
   * True until the owner replaces the sample numbers with values from their
   * own POH and weight and balance record. The UI says so on every screen
   * that uses them.
   */
  sampleValues: boolean;
}

/**
 * A C172K-shaped starting point. These are typical 1970s Skyhawk values for
 * illustration only. Replace every number with your POH and your airplane's
 * current weight and balance record before trusting a result.
 */
export const sampleC172K: AircraftProfile = {
  id: 'c172k',
  tailNumber: 'N____',
  type: 'Cessna 172K',
  panel: ['GI 275-style attitude', 'GI 275-style HSI', 'GTN-style GPS/NAV/COM'],
  emptyWeightLb: 1430,
  emptyArmIn: 39.5,
  maxGrossLb: 2300,
  usableFuelGal: 38,
  demonstratedCrosswindKt: 15,
  stations: [
    { id: 'front', label: 'Pilot and front passenger', armIn: 37 },
    { id: 'rear', label: 'Rear passengers', armIn: 73 },
    { id: 'fuel', label: 'Fuel', armIn: 48 },
    { id: 'bag1', label: 'Baggage area', armIn: 95, maxLb: 120 },
  ],
  envelope: [
    [35.0, 1500],
    [35.0, 1950],
    [38.5, 2300],
    [47.3, 2300],
    [47.3, 1500],
  ],
  sampleValues: true,
};
