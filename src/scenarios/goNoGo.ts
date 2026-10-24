// "Today": a go/no-go decision at the pilot's home field, built from live weather, the pilot's
// aircraft and loading, and their personal minimums. All facts and grades are
// deterministic so a CFI can audit why a choice scored the way it did.

import type { Airport } from '../data/airports';
import type { AircraftProfile } from '../data/aircraft';
import type { PersonalMinimums } from '../data/pilot';
import type { Metar, FlightCategory, Wind } from '../lib/metar';
import { hoursFrom, type Taf, type TafPeriod } from '../lib/taf';
import { components, bestRunway, trueToMagnetic, type Components, type RunwayEnd } from '../lib/wind';
import { densityAltitudeFt } from '../lib/density';
import type { WbResult } from '../lib/wb';

export type Severity = 'illegal' | 'limit' | 'personal' | 'caution' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** ACS task codes, FAA-S-ACS-6C. Element-level codes come with the ACS import. */
  acs: string[];
  refs: string[];
}

export interface RunwayWind {
  runway: RunwayEnd;
  windMag: number | null;
  steady: Components | null;
  gust: Components | null;
}

export interface Facts {
  category: FlightCategory | null;
  ceilingFtAgl: number | null;
  visibilitySm: number | null;
  densityAltitudeFt: number | null;
  tempDewSpreadC: number | null;
  runwayWind: RunwayWind | null;
  tafWindow: TafPeriod[];
  improvingAt: TafPeriod | null;
}

export type ChoiceId = 'go' | 'go-plan' | 'delay' | 'cancel';
export type Grade = 'best' | 'acceptable' | 'marginal' | 'unsafe';

export interface Choice {
  id: ChoiceId;
  label: string;
}

export interface Brief {
  airport: Airport;
  facts: Facts;
  findings: Finding[];
  choices: Choice[];
  grades: Record<ChoiceId, Grade>;
  /** One line on why the best choice is best. */
  rationale: string;
}

export interface GoNoGoInput {
  airport: Airport;
  aircraft: AircraftProfile;
  /** Null when the pilot hasn't entered their airplane's numbers yet. */
  wb: WbResult | null;
  minimums: PersonalMinimums;
  metar: Metar;
  taf: Taf | null;
  departure: Date;
  /** Planned time away, for checking the forecast through the return. */
  tripHours: number;
}

const ORDER: Record<FlightCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };

export function runwayWind(airport: Airport, wind: Wind | null): RunwayWind | null {
  if (!wind) return null;
  if (wind.dirTrue === null) {
    // Calm or variable: every runway gets the full speed as a possible crosswind.
    const rwy = airport.runways[0];
    const worst: Components = { headwindKt: 0, crosswindKt: wind.speedKt, from: 'none', angleDeg: 90 };
    const gust = wind.gustKt ? { ...worst, crosswindKt: wind.gustKt } : null;
    return { runway: rwy, windMag: null, steady: worst, gust };
  }
  const mag = trueToMagnetic(wind.dirTrue, airport.magneticVariationDeg);
  const rwy = bestRunway(airport.runways, mag, wind.speedKt);
  return {
    runway: rwy,
    windMag: mag,
    steady: components(mag, wind.speedKt, rwy.headingMag),
    gust: wind.gustKt ? components(mag, wind.gustKt, rwy.headingMag) : null,
  };
}

function periodsInWindow(taf: Taf | null, start: Date, hours: number): TafPeriod[] {
  if (!taf) return [];
  return taf.periods.filter((p) => {
    if (!p.from) return false;
    const a = hoursFrom(start, p.from);
    const b = p.to ? hoursFrom(start, p.to) : a + 24;
    return b > 0 && a < hours;
  });
}

function findImprovement(taf: Taf | null, start: Date, current: Facts, airport: Airport): TafPeriod | null {
  if (!taf) return null;
  const now = current.runwayWind?.gust?.crosswindKt ?? current.runwayWind?.steady?.crosswindKt ?? 0;
  for (const p of taf.periods) {
    if ((p.kind !== 'FM' && p.kind !== 'BECMG') || !p.from) continue;
    const h = hoursFrom(start, p.from);
    if (h <= 0 || h > 8) continue;
    const rw = runwayWind(airport, p.wind);
    const xw = rw?.gust?.crosswindKt ?? rw?.steady?.crosswindKt ?? 0;
    const catBetter = p.category ? ORDER[p.category] <= ORDER[current.category ?? 'VFR'] : true;
    if (catBetter && p.category === 'VFR' && xw < now - 3 && !p.wind?.gustKt) return p;
  }
  return null;
}

export function buildBrief(input: GoNoGoInput): Brief {
  const { airport, aircraft, wb, minimums: mins, metar, taf, departure, tripHours } = input;
  const rw = runwayWind(airport, metar.wind);
  const da =
    metar.altimeterInHg !== null && metar.tempC !== null
      ? Math.round(densityAltitudeFt(airport.elevationFt, metar.altimeterInHg, metar.tempC))
      : null;

  const facts: Facts = {
    category: metar.category,
    ceilingFtAgl: metar.ceilingFtAgl,
    visibilitySm: metar.visibilitySm,
    densityAltitudeFt: da,
    tempDewSpreadC: metar.tempC !== null && metar.dewpointC !== null ? metar.tempC - metar.dewpointC : null,
    runwayWind: rw,
    tafWindow: periodsInWindow(taf, departure, tripHours),
    improvingAt: null,
  };
  facts.improvingAt = findImprovement(taf, departure, facts, airport);

  const f: Finding[] = [];
  const add = (x: Finding) => f.push(x);

  // Legal: basic VFR weather minimums in surface-area airspace (91.155(c),(d)).
  if (airport.airspace !== 'G') {
    if (metar.ceilingFtAgl !== null && metar.ceilingFtAgl < 1000) {
      add({ id: 'vfr-ceiling', severity: 'illegal', title: 'Ceiling below 1,000 ft',
        detail: `Ceiling ${metar.ceilingFtAgl} ft. VFR in the ${airport.icao} surface area needs at least 1,000 ft without a special VFR clearance.`,
        acs: ['PA.I.E', 'PA.I.C'], refs: ['14 CFR 91.155(c)'] });
    }
    if (metar.visibilitySm !== null && metar.visibilitySm < 3) {
      add({ id: 'vfr-vis', severity: 'illegal', title: 'Visibility below 3 SM',
        detail: `Visibility ${metar.visibilitySm} SM. VFR in the surface area needs 3 SM without a special VFR clearance.`,
        acs: ['PA.I.E', 'PA.I.C'], refs: ['14 CFR 91.155(d)'] });
    }
  }

  // Legal: operating limitations (91.9).
  if (wb?.overGross) {
    add({ id: 'wb-gross', severity: 'illegal', title: 'Over maximum gross weight',
      detail: `${wb.totalLb} lb against a maximum of ${aircraft.maxGrossLb} lb.`,
      acs: ['PA.I.F'], refs: ['14 CFR 91.9', 'PHAK ch. 10'] });
  } else if (wb && !wb.withinEnvelope) {
    add({ id: 'wb-cg', severity: 'illegal', title: 'CG outside the envelope',
      detail: `CG ${wb.cgIn} in at ${wb.totalLb} lb falls outside the POH envelope.`,
      acs: ['PA.I.F'], refs: ['14 CFR 91.9', 'PHAK ch. 10'] });
  }

  // Crosswind against the airplane and the pilot.
  if (rw?.steady) {
    const steadyX = rw.steady.crosswindKt;
    const gustX = rw.gust?.crosswindKt ?? null;
    const worstX = gustX ?? steadyX;
    // A demonstrated crosswind of 0 means it hasn't been entered.
    if (aircraft.demonstratedCrosswindKt > 0 && worstX > aircraft.demonstratedCrosswindKt) {
      add({ id: 'xw-demo', severity: 'limit', title: 'Crosswind beyond the demonstrated value',
        detail: `Runway ${rw.runway.id}: ${Math.round(steadyX)} kt crosswind${gustX !== null ? `, ${Math.round(gustX)} kt in gusts` : ''}. The demonstrated crosswind is ${aircraft.demonstratedCrosswindKt} kt. That isn't a legal limit, but nobody tested the airplane past it.`,
        acs: ['PA.I.F', 'PA.IV.A'], refs: ['POH section 4 or 5', 'AFH, crosswind takeoff and landing'] });
    }
    if (worstX > mins.crosswindKt) {
      add({ id: 'xw-personal', severity: 'personal', title: 'Crosswind above your personal minimum',
        detail: `${Math.round(worstX)} kt against your ${mins.crosswindKt} kt minimum.`,
        acs: ['PA.I.C', 'PA.IV.A'], refs: ['Risk Management Handbook, personal minimums'] });
    }
    if (rw.steady.headwindKt < -1) {
      add({ id: 'tailwind', severity: 'caution', title: 'Tailwind on every runway',
        detail: `Best runway ${rw.runway.id} still has a ${Math.abs(Math.round(rw.steady.headwindKt))} kt tailwind.`,
        acs: ['PA.I.F'], refs: ['PHAK ch. 11'] });
    }
  }
  const w = metar.wind;
  if (w?.gustKt && w.gustKt - w.speedKt > mins.gustSpreadKt) {
    add({ id: 'gust-spread', severity: 'personal', title: 'Gust spread above your minimum',
      detail: `Gusting ${w.gustKt - w.speedKt} kt over the steady wind, against your ${mins.gustSpreadKt} kt limit.`,
      acs: ['PA.I.C'], refs: ['Risk Management Handbook, personal minimums'] });
  }

  // Ceiling and visibility against personal minimums.
  if (metar.ceilingFtAgl !== null && metar.ceilingFtAgl >= 1000 && metar.ceilingFtAgl < mins.ceilingFt) {
    add({ id: 'ceiling-personal', severity: 'personal', title: 'Ceiling below your personal minimum',
      detail: `${metar.ceilingFtAgl} ft against your ${mins.ceilingFt} ft minimum.`,
      acs: ['PA.I.C'], refs: ['Risk Management Handbook, personal minimums'] });
  }
  if (metar.visibilitySm !== null && metar.visibilitySm >= 3 && metar.visibilitySm < mins.visibilitySm) {
    add({ id: 'vis-personal', severity: 'personal', title: 'Visibility below your personal minimum',
      detail: `${metar.visibilitySm} SM against your ${mins.visibilitySm} SM minimum.`,
      acs: ['PA.I.C'], refs: ['Risk Management Handbook, personal minimums'] });
  }

  // Hazards and trends.
  if (metar.weather.some((x) => x.includes('TS')) || metar.clouds.some((c) => c.type === 'CB')) {
    add({ id: 'convection', severity: 'limit', title: 'Thunderstorms reported',
      detail: 'Thunderstorm or cumulonimbus in the report. Stay at least 20 miles from a strong storm.',
      acs: ['PA.I.C'], refs: ['AIM ch. 7, thunderstorm flying', 'PHAK ch. 12'] });
  }
  if (facts.tempDewSpreadC !== null && facts.tempDewSpreadC <= 3) {
    add({ id: 'fog', severity: 'caution', title: 'Temperature and dew point are close',
      detail: `A ${facts.tempDewSpreadC}°C spread. Fog or low clouds can form quickly, especially as it cools.`,
      acs: ['PA.I.C'], refs: ['PHAK ch. 12'] });
  }
  if (da !== null && da > 2000) {
    add({ id: 'da', severity: 'caution', title: 'High density altitude',
      detail: `${da.toLocaleString()} ft. Expect longer takeoff rolls and weaker climb.`,
      acs: ['PA.I.F'], refs: ['PHAK ch. 4 and 11'] });
  }
  const worse = facts.tafWindow.find(
    (p) => (p.category && metar.category && ORDER[p.category] > ORDER[metar.category]) || p.weather.some((x) => x.includes('TS')),
  );
  if (worse) {
    add({ id: 'taf-worse', severity: 'caution', title: 'Forecast gets worse during the trip',
      detail: `The TAF calls for ${worse.category ?? 'thunderstorms'} conditions (${worse.raw}) before you'd be back.`,
      acs: ['PA.I.C'], refs: ['14 CFR 91.103', 'Aviation Weather Handbook, TAF section'] });
  }
  if (!taf) {
    add({ id: 'no-taf', severity: 'info', title: 'No nearby TAF',
      detail: 'Without a forecast you are relying on current conditions only. Check the GFA and area forecasts.',
      acs: ['PA.I.C'], refs: ['14 CFR 91.103'] });
  }
  if (facts.improvingAt) {
    add({ id: 'improving', severity: 'info', title: 'Forecast improves later',
      detail: `The TAF shows ${facts.improvingAt.raw}.`,
      acs: ['PA.I.C'], refs: ['Aviation Weather Handbook, TAF section'] });
  }

  const choices: Choice[] = [
    { id: 'go', label: 'Go as planned.' },
    { id: 'go-plan', label: 'Go, with a specific plan: a set alternate, an earlier return, a firm abort point.' },
    { id: 'delay', label: 'Delay and reassess against the forecast.' },
    { id: 'cancel', label: 'Cancel the flight.' },
  ];

  const has = (s: Severity) => f.some((x) => x.severity === s);
  const improving = facts.improvingAt !== null;
  let grades: Record<ChoiceId, Grade>;
  let rationale: string;
  if (has('illegal')) {
    grades = { go: 'unsafe', 'go-plan': 'unsafe', delay: improving ? 'best' : 'acceptable', cancel: improving ? 'acceptable' : 'best' };
    rationale = 'The flight as planned is not legal. Fix the problem or don\'t go.';
  } else if (has('limit') || has('personal')) {
    grades = { go: 'unsafe', 'go-plan': 'marginal', delay: improving ? 'best' : 'acceptable', cancel: improving ? 'acceptable' : 'best' };
    rationale = improving
      ? 'Conditions exceed your limits now, but the forecast improves. Waiting keeps the trip and the margin.'
      : 'Conditions exceed your limits and the forecast doesn\'t help. Personal minimums only work if you honor them.';
  } else if (has('caution')) {
    grades = { go: 'acceptable', 'go-plan': 'best', delay: 'acceptable', cancel: 'acceptable' };
    rationale = 'Legal and within your limits, with something to watch. Going with a concrete plan handles it.';
  } else {
    grades = { go: 'best', 'go-plan': 'acceptable', delay: 'acceptable', cancel: 'acceptable' };
    rationale = 'Everything checks out. A good day to fly.';
  }

  return { airport, facts, findings: f, choices, grades, rationale };
}

export interface Debrief {
  grade: Grade;
  rationale: string;
  /** Learner-centered grading level this attempt demonstrates. */
  lcg: 'Explain' | 'Practice' | 'Perform' | 'Manage/Decide';
  confidentlyWrong: boolean;
  keyFindings: Finding[];
}

export function debrief(brief: Brief, choice: ChoiceId, confidencePct: number): Debrief {
  const grade = brief.grades[choice];
  const lcg = grade === 'best' ? 'Manage/Decide' : grade === 'acceptable' ? 'Perform' : grade === 'marginal' ? 'Practice' : 'Explain';
  const rank: Severity[] = ['illegal', 'limit', 'personal', 'caution', 'info'];
  const keyFindings = [...brief.findings].sort((a, b) => rank.indexOf(a.severity) - rank.indexOf(b.severity)).slice(0, 3);
  return {
    grade,
    rationale: brief.rationale,
    lcg,
    confidentlyWrong: (grade === 'unsafe' || grade === 'marginal') && confidencePct >= 70,
    keyFindings,
  };
}
