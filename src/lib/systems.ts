// Airplane systems: the electrical bus on battery alone, which instruments a
// failed source takes with it, what a blocked static port does to the
// pitot-static instruments, and carburetor icing from temperature and dew
// point. Rules follow the PHAK (FAA-H-8083-25C, ch. 7 and 8). Sample values
// are labeled; a pilot's own POH electrical load list replaces them.

import type { Grade } from '../scenarios/goNoGo';

/* ---------------------------------------------------------------- electrical */

export interface Load {
  id: string;
  name: string;
  /** Average draw in amps at bus voltage. */
  amps: number;
  /** Kept on after a load shed: what you need to fly, talk and be seen by radar. */
  essential: boolean;
}

export interface ElectricalSystem {
  volts: 14 | 28;
  batteryAh: number;
  /** The part of rated capacity to count on: an aging battery delivers less, and radios quit before it is flat. */
  usableFraction: number;
  loads: Load[];
  /** True until the pilot replaces these with their POH load list. */
  sample: boolean;
}

/**
 * A sample 14-volt bus for a four-seat trainer. Representative draws for
 * teaching the arithmetic; they are not any airplane's published values.
 */
export function sampleElectrical(): ElectricalSystem {
  return {
    volts: 14,
    batteryAh: 24,
    usableFraction: 0.5,
    sample: true,
    loads: [
      { id: 'com', name: 'Comm radio', amps: 1.5, essential: true },
      { id: 'xpdr', name: 'Transponder', amps: 1.5, essential: true },
      { id: 'att', name: 'Electric attitude display', amps: 1.2, essential: true },
      { id: 'gps', name: 'GPS navigator', amps: 2.5, essential: false },
      { id: 'hsi', name: 'Second display (heading)', amps: 1.2, essential: false },
      { id: 'audio', name: 'Audio panel and intercom', amps: 0.8, essential: false },
      { id: 'beacon', name: 'Beacon', amps: 1.5, essential: false },
      { id: 'strobe', name: 'Strobes', amps: 3.5, essential: false },
      { id: 'landing', name: 'Landing light', amps: 7.5, essential: false },
      { id: 'pitotheat', name: 'Pitot heat', amps: 9.0, essential: false },
    ],
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function busLoadAmps(sys: ElectricalSystem, on: readonly string[]): number {
  return r1(sys.loads.filter((l) => on.includes(l.id)).reduce((n, l) => n + l.amps, 0));
}

/** What stays on after shedding: the essentials that were already on. */
export function shedLoads(sys: ElectricalSystem, on: readonly string[]): string[] {
  return sys.loads.filter((l) => l.essential && on.includes(l.id)).map((l) => l.id);
}

export function usableAh(sys: ElectricalSystem): number {
  return r1(sys.batteryAh * sys.usableFraction);
}

/** Minutes of battery at a steady load, whole minutes, rounded down. */
export function batteryMinutes(sys: ElectricalSystem, loadAmps: number): number {
  if (loadAmps <= 0) return Infinity;
  return Math.floor((usableAh(sys) / loadAmps) * 60);
}

/** Minutes kept in hand on arrival: the call to the tower, the pattern and a go-around. */
export const ELECTRICAL_MARGIN_MIN = 10;

export type AlternatorChoice = 'carry-on' | 'shed-home' | 'shed-nearest';

/**
 * Grades for an alternator failure. Everything turns on battery minutes
 * against the minutes to a field plus a margin. Shedding and pressing on home
 * is the best call when the shed battery covers it; the nearer field is the
 * best call when it does not.
 */
export function gradeAlternatorFailure(o: { fullMin: number; shedMin: number; toHomeMin: number; toNearestMin: number }): Record<AlternatorChoice, Grade> {
  const homeOk = o.shedMin >= o.toHomeMin + ELECTRICAL_MARGIN_MIN;
  const nearestOk = o.shedMin >= o.toNearestMin + ELECTRICAL_MARGIN_MIN;
  return {
    'carry-on': o.fullMin >= o.toHomeMin + ELECTRICAL_MARGIN_MIN ? 'marginal' : 'unsafe',
    'shed-home': homeOk ? 'best' : o.shedMin >= o.toHomeMin ? 'marginal' : 'unsafe',
    'shed-nearest': nearestOk ? (homeOk ? 'acceptable' : 'best') : 'marginal',
  };
}

/* ---------------------------------------------------------------- instruments */

export type InstrumentId = 'asi' | 'ai' | 'alt' | 'tc' | 'hi' | 'vsi' | 'compass';
export type PowerSource = 'pitot' | 'static' | 'vacuum' | 'electric' | 'none';
export type SystemFailure = 'vacuum' | 'electric' | 'pitot' | 'static';

export const INSTRUMENT_NAME: Record<InstrumentId, string> = {
  asi: 'Airspeed indicator',
  ai: 'Attitude indicator',
  alt: 'Altimeter',
  tc: 'Turn coordinator',
  hi: 'Heading indicator',
  vsi: 'Vertical speed indicator',
  compass: 'Magnetic compass',
};

export const FAILURE_NAME: Record<SystemFailure, string> = {
  vacuum: 'Vacuum system',
  electric: 'Electrical power',
  pitot: 'Pitot tube',
  static: 'Static port',
};

/** What each instrument needs to work on a classic panel: vacuum gyros, an electric turn coordinator. */
export const CLASSIC_PANEL: Record<InstrumentId, PowerSource[]> = {
  asi: ['pitot', 'static'],
  ai: ['vacuum'],
  alt: ['static'],
  tc: ['electric'],
  hi: ['vacuum'],
  vsi: ['static'],
  compass: ['none'],
};

/** The instruments a failed source takes with it. */
export function affectedBy(panel: Record<InstrumentId, PowerSource[]>, failure: SystemFailure): InstrumentId[] {
  return (Object.keys(panel) as InstrumentId[]).filter((id) => panel[id].includes(failure));
}

/** The single failure that explains exactly the instruments that disagree, if one does. */
export function diagnose(panel: Record<InstrumentId, PowerSource[]>, wrong: InstrumentId[]): SystemFailure | null {
  const key = (ids: InstrumentId[]) => [...ids].sort().join(',');
  const target = key(wrong);
  return (['vacuum', 'electric', 'pitot', 'static'] as SystemFailure[]).find((f) => key(affectedBy(panel, f)) === target) ?? null;
}

/** The instruments that still tell the truth after a failure. */
export function stillGood(panel: Record<InstrumentId, PowerSource[]>, failure: SystemFailure): InstrumentId[] {
  const bad = affectedBy(panel, failure);
  return (Object.keys(panel) as InstrumentId[]).filter((id) => !bad.includes(id));
}

export interface StaticBlockReading {
  /** The altimeter freezes where the port blocked. */
  altimeterFt: number;
  /** The VSI shows zero. */
  vsiFpm: number;
  /** Below the blockage the airspeed reads high, above it low (PHAK ch. 8). */
  airspeed: 'high' | 'low' | 'right';
}

export function blockedStatic(blockedAtFt: number, nowFt: number): StaticBlockReading {
  return {
    altimeterFt: blockedAtFt,
    vsiFpm: 0,
    airspeed: nowFt < blockedAtFt ? 'high' : nowFt > blockedAtFt ? 'low' : 'right',
  };
}

export type InstrumentChoice = 'trust-attitude' | 'cover-land' | 'cover-continue' | 'climb-clear';

/**
 * Grades for a gyro failure in flight. Covering the failed instruments is
 * always the first move. With a clear horizon and your visibility minimum
 * met, finishing the trip is fine; in haze below it, land at the nearest good
 * field while you can still see.
 */
export function gradeGyroFailure(o: { visibilitySm: number; minimumSm: number; failure?: 'vacuum' | 'electric' }): Record<InstrumentChoice, Grade> {
  const clear = o.visibilitySm >= o.minimumSm;
  // With the electric turn coordinator the one lying, the vacuum gyros are the good ones:
  // the attitude indicator is right, and covering it to fly the dead instrument is the mistake.
  if (o.failure === 'electric') {
    return { 'trust-attitude': 'best', 'cover-land': 'unsafe', 'cover-continue': 'unsafe', 'climb-clear': clear ? 'acceptable' : 'marginal' };
  }
  return {
    'trust-attitude': 'unsafe',
    'cover-land': 'best',
    'cover-continue': clear ? 'acceptable' : 'marginal',
    'climb-clear': clear ? 'marginal' : 'unsafe',
  };
}

/* ---------------------------------------------------------------- carburetor ice */

/** Relative humidity, percent, from temperature and dew point (Magnus formula). */
export function relativeHumidity(tempC: number, dewC: number): number {
  const g = (t: number) => (17.625 * t) / (243.04 + t);
  return Math.min(100, Math.round(100 * Math.exp(g(dewC) - g(tempC))));
}

export type CarbIceRisk = 'high' | 'possible' | 'unlikely';

/**
 * The PHAK chart (FAA-H-8083-25C, figure 7-12): high carburetor icing
 * potential from -7 to 21 °C above 80 percent humidity, possible up to 38 °C
 * above 50 percent. Outside those, icing is less likely but still possible.
 */
export function carbIceRisk(tempC: number, dewC: number): CarbIceRisk {
  const rh = relativeHumidity(tempC, dewC);
  if (tempC >= -7 && tempC <= 21 && rh >= 80) return 'high';
  if (tempC >= -7 && tempC <= 38 && rh >= 50) return 'possible';
  return 'unlikely';
}

export const CARB_ICE_LABEL: Record<CarbIceRisk, string> = {
  high: 'High icing potential',
  possible: 'Icing possible',
  unlikely: 'Outside the chart',
};

export type RpmChoice = 'full-heat' | 'partial-heat' | 'more-throttle' | 'lean';

/**
 * Grades for a slow rpm loss in cruise in a carbureted engine. Full heat is
 * the test and the cure; partial heat can warm the air into the icing range
 * without melting anything (PHAK ch. 7).
 */
export function gradeRpmLoss(risk: CarbIceRisk): Record<RpmChoice, Grade> {
  return {
    'full-heat': 'best',
    'partial-heat': risk === 'unlikely' ? 'marginal' : 'unsafe',
    'more-throttle': risk === 'high' ? 'unsafe' : 'marginal',
    lean: 'marginal',
  };
}

export type RoughChoice = 'switch-tank' | 'heat-off' | 'land-now';

/** Grades for a rough engine on a tank the fuel arithmetic says is nearly dry. */
export function gradeRoughEngine(o: { tankLeftGal: number }): Record<RoughChoice, Grade> {
  const dry = o.tankLeftGal <= 2;
  return {
    'switch-tank': dry ? 'best' : 'acceptable',
    'heat-off': dry ? 'unsafe' : 'marginal',
    'land-now': dry ? 'marginal' : 'best',
  };
}

/* ---------------------------------------------------------------- GPS loss */

export type GpsChoice = 'pilotage' | 'ask-atc' | 'turn-back' | 'nearest';

/**
 * Grades for losing the GPS on a VFR cross-country. With your visibility
 * minimum met, a checkpoint ahead and fuel to spare, finishing by pilotage and
 * dead reckoning is the call, and asking ATC for help is just as sound. In
 * poor visibility, ATC's help comes first. Without the fuel margin, the
 * nearest field is.
 */
export function gradeGpsLoss(o: { visibilitySm: number; minimumSm: number; fuelMarginMin: number; checkpointAhead: boolean }): Record<GpsChoice, Grade> {
  const clear = o.visibilitySm >= o.minimumSm && o.checkpointAhead;
  if (o.fuelMarginMin < 0) return { pilotage: 'unsafe', 'ask-atc': 'marginal', 'turn-back': 'unsafe', nearest: 'best' };
  return {
    pilotage: clear ? 'best' : 'marginal',
    'ask-atc': 'best',
    'turn-back': clear ? 'acceptable' : 'marginal',
    nearest: 'acceptable',
  };
}
