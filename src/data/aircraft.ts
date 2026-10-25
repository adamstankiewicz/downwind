import type { Envelope, Station } from '../lib/wb';
import { sampleTrainerPerformance, type Performance } from '../lib/perf';

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
  /** POH performance charts. Lessons fall back to labeled sample charts without them. */
  performance?: Performance;
  /**
   * True until the owner replaces the sample numbers with values from their
   * own POH and weight and balance record. The UI says so on every screen
   * that uses them.
   */
  sampleValues: boolean;
}

/** A starting profile with nothing filled in, for any airplane. */
export const blankAircraft: AircraftProfile = {
  id: 'custom',
  tailNumber: '',
  type: '',
  panel: [],
  emptyWeightLb: 0,
  emptyArmIn: 0,
  maxGrossLb: 0,
  usableFuelGal: 0,
  demonstratedCrosswindKt: 0,
  stations: [
    { id: 'front', label: 'Pilot and front passenger', armIn: 0 },
    { id: 'rear', label: 'Rear passengers', armIn: 0 },
    { id: 'fuel', label: 'Fuel', armIn: 0 },
    { id: 'bag1', label: 'Baggage', armIn: 0 },
  ],
  envelope: [],
  sampleValues: false,
};

/** True once the profile has enough numbers to run weight and balance. */
export function isConfigured(a: AircraftProfile): boolean {
  return a.emptyWeightLb > 0 && a.maxGrossLb > 0 && a.envelope.length >= 3;
}

/**
 * A C172K-shaped starting point. These are typical 1970s Skyhawk values for
 * illustration only. Replace every number with your POH and your airplane's
 * current weight and balance record before trusting a result.
 */
export const sampleC172K: AircraftProfile = {
  id: 'c172k',
  tailNumber: '',
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
  performance: sampleTrainerPerformance(),
  sampleValues: true,
};

export interface AircraftTemplate {
  id: string;
  label: string;
  profile: AircraftProfile;
}

/**
 * Starting points pilots can pick in onboarding. Every template is sample data
 * until the pilot replaces it from their own POH. Add more types here.
 */
export const aircraftTemplates: AircraftTemplate[] = [
  { id: 'c172-150hp', label: 'Cessna 172 (150 hp, 1968 to 1976)', profile: sampleC172K },
];
