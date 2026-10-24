export interface PersonalMinimums {
  ceilingFt: number;
  visibilitySm: number;
  crosswindKt: number;
  /** Largest gust spread (gust minus steady) you accept. */
  gustSpreadKt: number;
}

export interface PilotProfile {
  name: string;
  homeBase: string;
  minimums: PersonalMinimums;
  /** ISO date of the last flight review (14 CFR 61.56). */
  lastFlightReview: string | null;
}

export const defaultPilot: PilotProfile = {
  name: 'Adam',
  homeBase: 'KASH',
  minimums: { ceilingFt: 3000, visibilitySm: 5, crosswindKt: 12, gustSpreadKt: 10 },
  lastFlightReview: null,
};
