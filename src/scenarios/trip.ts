// Trip: cross-country flights worth planning from the pilot's home field.
// The engine takes every field in range, works each round trip with the
// winds aloft, the airplane's fuel and the daylight, checks the weather at
// both ends and along the line against the rules and the pilot's own
// minimums, filters out anything that fails, and ranks the rest with an eye
// to variety. Everything here is computed; the copy in course/trip.ts only
// reads it.

import type { PersonalMinimums } from '../data/pilot';
import { flightCategory, type FlightCategory, type Metar, type Wind } from '../lib/metar';
import { hoursFrom, type Taf, type TafPeriod } from '../lib/taf';
import { destination, distanceNm, trueCourse, vfrCruisingAltitudes, type LatLon } from '../lib/nav';
import { climbRate, landingDistance, vfrReserveMin } from '../lib/perf';
import { isaTempC } from '../lib/density';
import { sunTimes } from '../lib/sun';
import { components, norm, trueToMagnetic, type RunwayEnd } from '../lib/wind';
import { alongTrack, legTo, windAt, type Leg, type WindAloft, type XcAirplane } from './crossCountry';
import type { Finding, Grade, Severity } from './goNoGo';

/* ---------------------------------------------------------------- inputs */

export interface TripRunway {
  /** "14/32". */
  id: string;
  ends: RunwayEnd[];
  lengthFt: number;
  surface: 'paved' | 'grass';
}

export interface TripField {
  id: string;
  name: string;
  pos: LatLon;
  elevationFt: number;
  /** Degrees, positive east. */
  variationDeg: number;
  towered: boolean;
  /** Surface airspace class, when the data says (the practice chart does; the live airport data doesn't). */
  airspace?: 'B' | 'C' | 'D' | 'E' | 'G';
  runways: TripRunway[];
  /** The latest report from the field, when it has one. */
  metar: Metar | null;
  /** The field's own TAF, when it issues one. */
  taf: Taf | null;
}

/** One winds aloft station and its forecast levels. */
export interface WindsStation {
  id: string;
  pos: LatLon;
  levels: WindAloft[];
}

export interface TripInputs {
  /** 'practice' is the made-up region and its made-up weather. */
  source: 'live' | 'practice';
  home: TripField;
  /** Every field the engine may consider, home excluded. */
  fields: TripField[];
  winds: WindsStation[];
  /** When the reports were fetched (live) or made up (practice). */
  fetchedAt: Date;
  /** Ground elevation along the route, when the engine knows it (the practice region). */
  groundFt?: (p: LatLon) => number;
}

/** The pilot's own lines for a trip, kept with the trip screen. */
export interface TripPrefs {
  /** Farthest the pilot wants to fly one way, nm. */
  maxLegNm: number;
  /** Shortest runway the pilot will plan to, ft. */
  minRunwayFt: number;
  /** Fuel the pilot wants on landing, minutes at cruise. Never planned below the legal 30. */
  reserveMin: number;
}

export const DEFAULT_TRIP_PREFS: TripPrefs = { maxLegNm: 100, minRunwayFt: 2500, reserveMin: 60 };

/** A trip the pilot planned before, for variety. */
export interface TripHistoryEntry {
  id: string;
  /** ISO time it was planned. */
  at: string;
  distanceNm: number;
  grade?: Grade;
}

export interface PlanOptions {
  airplane: XcAirplane;
  minimums: PersonalMinimums;
  prefs: TripPrefs;
  /** 0 when the pilot hasn't entered it. */
  demonstratedCrosswindKt: number;
  departure: Date;
  history: TripHistoryEntry[];
}

/** Fields closer than this aren't a trip, they're the practice area. */
export const MIN_TRIP_NM = 10;
/** Planning time on the ground at the far end: tie down, walk in, walk out, preflight. */
export const GROUND_MIN = 45;
/** A report counts as weather "along the line" within this many miles of the course. */
export const ENROUTE_NM = 10;
/** A field without its own TAF borrows the nearest one this close. */
export const TAF_BORROW_NM = 25;
/** A current report stands in for a forecast this many hours ahead, no more. */
export const METAR_HOLDS_HOURS = 1.5;
/** Cloud clearance below a ceiling in Class E below 10,000 ft (91.155). */
const CLOUD_CLEARANCE_FT = 500;

/* ---------------------------------------------------------------- weather at a time */

export interface WxAt {
  /** Where the conditions come from: a forecast period, or the current report. */
  source: 'taf' | 'metar' | 'none';
  /** The station that issued it, which may be a nearby one. */
  station: string;
  /** How far that station is from the field, nm. 0 for the field's own. */
  stationNm: number;
  /** The raw text of the period or report used. */
  raw: string;
  ceilingFtAgl: number | null;
  visibilitySm: number | null;
  wind: Wind | null;
  weather: string[];
  category: FlightCategory | null;
  /** TEMPO and PROB groups over the time, which say what might happen instead. */
  temporary: TafPeriod[];
  /** False when the current report is being used further ahead than it can stand for. */
  covered: boolean;
}

const NO_WX: WxAt = {
  source: 'none', station: '', stationNm: 0, raw: '', ceilingFtAgl: null, visibilitySm: null, wind: null,
  weather: [], category: null, temporary: [], covered: false,
};

/** The prevailing TAF conditions at a time, with BECMG changes that have begun laid over them. */
export function forecastAt(taf: Taf, at: Date): { period: TafPeriod; temporary: TafPeriod[] } | null {
  if (taf.validFrom && hoursFrom(at, taf.validFrom) > 0) return null;
  if (taf.validTo && hoursFrom(at, taf.validTo) <= 0) return null;
  let base: TafPeriod | null = null;
  const temporary: TafPeriod[] = [];
  for (const p of taf.periods) {
    if (!p.from) continue;
    const started = hoursFrom(at, p.from) <= 0;
    const ended = p.to ? hoursFrom(at, p.to) <= 0 : false;
    if (p.kind === 'BASE' || p.kind === 'FM') {
      if (started) base = p;
    } else if (p.kind === 'BECMG') {
      if (started && base) {
        const b: TafPeriod = base;
        base = {
          ...b,
          wind: p.wind ?? b.wind,
          visibilitySm: p.visibilitySm ?? b.visibilitySm,
          clouds: p.clouds.length ? p.clouds : b.clouds,
          ceilingFtAgl: p.clouds.length ? p.ceilingFtAgl : b.ceilingFtAgl,
          weather: p.weather.length ? p.weather : b.weather,
          raw: `${b.raw} ${p.raw}`,
          category: flightCategory(p.clouds.length ? p.ceilingFtAgl : b.ceilingFtAgl, p.visibilitySm ?? b.visibilitySm),
        };
      }
    } else if (started && !ended) {
      temporary.push(p);
    }
  }
  return base ? { period: base, temporary } : null;
}

/**
 * The weather the pilot should plan on at a field at a time: its own TAF,
 * else the nearest TAF within 25 nm, else its current report if the time is
 * close enough for a report to stand for it.
 */
export function weatherAt(field: TripField, all: TripField[], at: Date, now: Date): WxAt {
  const tafs: { taf: Taf; nm: number }[] = [];
  if (field.taf) tafs.push({ taf: field.taf, nm: 0 });
  for (const f of all) {
    if (!f.taf || f.id === field.id) continue;
    const nm = distanceNm(field.pos, f.pos);
    if (nm <= TAF_BORROW_NM) tafs.push({ taf: f.taf, nm });
  }
  tafs.sort((a, b) => a.nm - b.nm);
  for (const t of tafs) {
    const fc = forecastAt(t.taf, at);
    if (!fc) continue;
    const p = fc.period;
    return {
      source: 'taf', station: t.taf.station, stationNm: Math.round(t.nm), raw: p.raw,
      ceilingFtAgl: p.ceilingFtAgl, visibilitySm: p.visibilitySm, wind: p.wind, weather: p.weather,
      category: p.category, temporary: fc.temporary, covered: true,
    };
  }
  const m = field.metar;
  if (!m) return { ...NO_WX, station: field.id };
  const ahead = (at.getTime() - now.getTime()) / 3_600_000;
  return {
    source: 'metar', station: m.station || field.id, stationNm: 0, raw: m.raw,
    ceilingFtAgl: m.ceilingFtAgl, visibilitySm: m.visibilitySm, wind: m.wind, weather: m.weather,
    category: m.category, temporary: [], covered: ahead <= METAR_HOLDS_HOURS,
  };
}

/* ---------------------------------------------------------------- runway */

export interface RunwayPick {
  runway: TripRunway;
  end: RunwayEnd;
  headwindKt: number;
  crosswindKt: number;
  /** Crosswind in the gusts, when it gusts. */
  gustCrosswindKt: number | null;
}

/**
 * The runway end with the most headwind, then the least crosswind, of the
 * runways at least `minFt` long (all of them, if none is). Calm or variable
 * wind counts its full speed across, as the go/no-go brief does.
 */
export function pickRunway(field: TripField, wind: Wind | null, minFt: number): RunwayPick | null {
  const long = field.runways.filter((r) => r.lengthFt >= minFt);
  const pool = (long.length ? long : field.runways).flatMap((r) => r.ends.map((end) => ({ runway: r, end })));
  if (!pool.length) return null;
  if (!wind || wind.speedKt === 0) {
    const longest = [...pool].sort((a, b) => b.runway.lengthFt - a.runway.lengthFt)[0];
    return { ...longest, headwindKt: 0, crosswindKt: 0, gustCrosswindKt: null };
  }
  if (wind.dirTrue === null) {
    const longest = [...pool].sort((a, b) => b.runway.lengthFt - a.runway.lengthFt)[0];
    return { ...longest, headwindKt: 0, crosswindKt: wind.speedKt, gustCrosswindKt: wind.gustKt };
  }
  const mag = trueToMagnetic(wind.dirTrue, field.variationDeg);
  const scored = pool.map((p) => ({ p, c: components(mag, wind.speedKt, p.end.headingMag) }));
  scored.sort((a, b) => b.c.headwindKt - a.c.headwindKt || a.c.crosswindKt - b.c.crosswindKt);
  const best = scored[0];
  const gust = wind.gustKt ? components(mag, wind.gustKt, best.p.end.headingMag).crosswindKt : null;
  return { ...best.p, headwindKt: best.c.headwindKt, crosswindKt: best.c.crosswindKt, gustCrosswindKt: gust };
}

export const longestRunwayFt = (f: TripField) => Math.max(0, ...f.runways.map((r) => r.lengthFt));
export const hasGrass = (f: TripField) => f.runways.length > 0 && f.runways.every((r) => r.surface === 'grass');

/* ---------------------------------------------------------------- the plan */

export type TripTag =
  | 'new' | 'towered' | 'xc-credit' | 'short-runway' | 'grass' | 'longest' | 'crosswind' | 'wind-lesson' | 'stale';

export interface TripLeg extends Leg {
  altitudeMsl: number;
  wind: { dirTrue: number; speedKt: number } | null;
  climbMin: number;
  /** Taxi, climb and cruise. */
  totalFuelGal: number;
  /** Climb and cruise. */
  totalMin: number;
}

export interface TripFuel {
  outGal: number;
  backGal: number;
  /** The reserve the plan holds: the pilot's, or the legal 30 minutes if that is more. */
  reserveMin: number;
  reserveGal: number;
  legalReserveGal: number;
  requiredGal: number;
  usableGal: number;
  /** Usable minus required. Negative means the pilot's reserve isn't there. */
  marginGal: number;
}

export interface TripTimes {
  depart: Date;
  arrive: Date;
  leave: Date;
  home: Date;
  sunrise: Date | null;
  sunset: Date | null;
  /** Minutes between landing at home and sunset. Negative is after sunset. */
  sunsetMarginMin: number | null;
}

export interface TripPlan {
  dest: TripField;
  distanceNm: number;
  /** Magnetic course out, rounded; for "62 nm, 240°". */
  magCourse: number;
  out: TripLeg;
  back: TripLeg;
  fuel: TripFuel;
  times: TripTimes;
  /** Conditions at the far end at arrival, and at home at the return. */
  arrivalWx: WxAt;
  returnWx: WxAt;
  departWx: WxAt;
  /** The worst report within 10 nm of the line, if any lie along it. */
  enroute: { field: TripField; wx: WxAt } | null;
  runway: RunwayPick | null;
  /** Landing distance over a 50 ft obstacle on the runway picked, ft. */
  landingOver50Ft: number | null;
  windsStation: string | null;
  findings: Finding[];
  /** True when a finding is not legal, an airplane limit or under a personal minimum. */
  filtered: boolean;
  tags: TripTag[];
  /** For ordering only; never shown. */
  score: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const RANK: Severity[] = ['illegal', 'limit', 'personal', 'caution', 'info'];
const STOPS: Severity[] = ['illegal', 'limit', 'personal'];
const fmtFt = (n: number) => Math.round(n).toLocaleString('en-US');

/** The winds aloft station nearest a point, within 150 nm. */
export function nearestWinds(winds: WindsStation[], p: LatLon): WindsStation | null {
  let best: WindsStation | null = null;
  let bestNm = 150;
  for (const w of winds) {
    const nm = distanceNm(w.pos, p);
    if (nm <= bestNm) {
      best = w;
      bestNm = nm;
    }
  }
  return best;
}

/**
 * The cruising altitude for one leg: the lowest 91.159 altitude at least
 * 2,000 ft over the highest ground the engine knows, kept 500 ft under the
 * lowest ceiling on the route. When the ceiling won't allow a 91.159
 * altitude, the leg stays at or below 3,000 ft above the ground, where any
 * altitude is legal, rounded down to 500 ft.
 */
export function cruiseAltitude(magCourse: number, highestGroundFt: number, lowestCeilingMsl: number | null): number {
  const cap = lowestCeilingMsl === null ? 17500 : lowestCeilingMsl - CLOUD_CLEARANCE_FT;
  const legal = vfrCruisingAltitudes(magCourse, highestGroundFt + 2000, Math.min(cap, 17500));
  if (legal.length) return legal[0];
  return Math.floor(Math.min(cap, highestGroundFt + 3000) / 500) * 500;
}

function leg(from: TripField, to: TripField, input: TripInputs, o: PlanOptions, lowestCeilingMsl: number | null, highestGroundFt: number): { leg: TripLeg; station: string | null } {
  const p = o.airplane.perf;
  const variation = Math.round((from.variationDeg + to.variationDeg) / 2);
  const tc = Math.round(trueCourse(from.pos, to.pos));
  const mc = Math.round(trueToMagnetic(tc, variation));
  const alt = cruiseAltitude(mc, highestGroundFt, lowestCeilingMsl);
  const mid = destination(from.pos, tc, distanceNm(from.pos, to.pos) / 2);
  const station = nearestWinds(input.winds, mid);
  const wind = station ? windAt(station.levels, alt) : null;
  const l = legTo(from.pos, to.pos, { tasKt: p.cruise.tasKt, windFromTrue: wind?.dirTrue ?? 0, windKt: wind?.speedKt ?? 0, variationDeg: variation, gph: p.cruise.gph });
  // Climb at the rate the chart gives at the field, in standard air.
  const fpm = Math.max(200, climbRate(p, from.elevationFt, isaTempC(from.elevationFt)).value);
  const climbMin = Math.max(0, Math.ceil((alt - from.elevationFt) / fpm));
  // The climb is counted on top of the cruise time over the whole distance, a small overcount on the safe side.
  const totalFuelGal = r1(p.taxiFuelGal + (p.climbGph * climbMin) / 60 + l.fuelGal);
  return {
    leg: { ...l, altitudeMsl: alt, wind, climbMin, totalFuelGal, totalMin: l.minutes + climbMin },
    station: station?.id ?? null,
  };
}

function wxFindings(wx: WxAt, where: string, prefix: string, o: PlanOptions, rwy: RunwayPick | null): Finding[] {
  const f: Finding[] = [];
  const mins = o.minimums;
  const id = (s: string) => `${prefix}-${s}`;
  const acs = ['PA.I.C'];
  if (wx.source === 'none') {
    f.push({ id: id('no-report'), severity: 'caution', title: `No weather for ${where}`,
      detail: `Nothing reports or forecasts weather for ${where} at that time. Plan on what the nearest reports say and have an alternate ready.`,
      acs, refs: ['14 CFR 91.103'] });
    return f;
  }
  const ceil = wx.ceilingFtAgl;
  const vis = wx.visibilitySm;
  if (ceil !== null && ceil < 1000) {
    f.push({ id: id('vfr-ceiling'), severity: 'illegal', title: `Ceiling below VFR at ${where}`,
      detail: `${fmtFt(ceil)} ft. VFR in a surface area needs 1,000 ft without a special VFR clearance.`, acs, refs: ['14 CFR 91.155(c)'] });
  } else if (ceil !== null && ceil < mins.ceilingFt) {
    f.push({ id: id('ceiling-personal'), severity: 'personal', title: `Ceiling under your minimum at ${where}`,
      detail: `${fmtFt(ceil)} ft against your ${fmtFt(mins.ceilingFt)} ft.`, acs, refs: ['Risk Management Handbook, personal minimums'] });
  }
  if (vis !== null && vis < 3) {
    f.push({ id: id('vfr-vis'), severity: 'illegal', title: `Visibility below VFR at ${where}`,
      detail: `${vis} SM. VFR in a surface area needs 3 SM without a special VFR clearance.`, acs, refs: ['14 CFR 91.155(d)'] });
  } else if (vis !== null && vis < mins.visibilitySm) {
    f.push({ id: id('vis-personal'), severity: 'personal', title: `Visibility under your minimum at ${where}`,
      detail: `${vis} SM against your ${mins.visibilitySm} SM.`, acs, refs: ['Risk Management Handbook, personal minimums'] });
  }
  if (wx.weather.some((x) => x.includes('TS')) || wx.temporary.some((p) => p.weather.some((x) => x.includes('TS')))) {
    f.push({ id: id('convection'), severity: 'limit', title: `Thunderstorms at ${where}`,
      detail: 'Thunderstorms in the report or the forecast. Stay at least 20 miles from a strong storm.', acs, refs: ['AIM ch. 7, thunderstorm flying'] });
  }
  const w = wx.wind;
  if (w?.gustKt && w.gustKt - w.speedKt > mins.gustSpreadKt) {
    f.push({ id: id('gust-spread'), severity: 'personal', title: `Gust spread over your minimum at ${where}`,
      detail: `Gusting ${w.gustKt - w.speedKt} kt over the steady wind, against your ${mins.gustSpreadKt} kt.`, acs, refs: ['Risk Management Handbook, personal minimums'] });
  }
  if (rwy) {
    const worst = rwy.gustCrosswindKt ?? rwy.crosswindKt;
    if (o.demonstratedCrosswindKt > 0 && worst > o.demonstratedCrosswindKt) {
      f.push({ id: id('xw-demo'), severity: 'limit', title: `Crosswind past the demonstrated value at ${where}`,
        detail: `Runway ${rwy.end.id}: ${Math.round(worst)} kt across against a demonstrated ${o.demonstratedCrosswindKt} kt.`, acs: ['PA.I.F'], refs: ['POH section 4 or 5'] });
    }
    if (worst > mins.crosswindKt) {
      f.push({ id: id('xw-personal'), severity: 'personal', title: `Crosswind over your minimum at ${where}`,
        detail: `Runway ${rwy.end.id}: ${Math.round(worst)} kt across against your ${mins.crosswindKt} kt.`, acs: ['PA.I.C', 'PA.IV.A'], refs: ['Risk Management Handbook, personal minimums'] });
    }
  }
  const worse = wx.temporary.find((p) => (p.ceilingFtAgl !== null && p.ceilingFtAgl < mins.ceilingFt) || (p.visibilitySm !== null && p.visibilitySm < mins.visibilitySm));
  if (worse) {
    f.push({ id: id('tempo'), severity: 'caution', title: `The forecast allows worse at ${where}`,
      detail: `${wx.station} carries ${worse.raw}. Know where you'd go if that's what you find.`, acs, refs: ['Aviation Weather Handbook, TAF section'] });
  }
  if (!wx.covered) {
    f.push({ id: id('no-forecast'), severity: 'caution', title: `No forecast for ${where} at that time`,
      detail: `No TAF within ${TAF_BORROW_NM} nm covers it, so this is the current report standing in for a forecast hours away.`, acs, refs: ['14 CFR 91.103'] });
  }
  return f;
}

/** Ceiling MSL of a report, for keeping the cruise altitude under it. */
function ceilingMsl(field: TripField, wx: WxAt): number | null {
  return wx.ceilingFtAgl === null ? null : wx.ceilingFtAgl + field.elevationFt;
}

/** Reports within 10 nm of the line, not at either end, ordered by how bad they are. */
export function alongTheLine(input: TripInputs, dest: TripField): TripField[] {
  const dist = distanceNm(input.home.pos, dest.pos);
  return input.fields.filter((f) => {
    if (f.id === dest.id || !f.metar) return false;
    const t = alongTrack(input.home.pos, dest.pos, f.pos);
    return t.alongNm > 5 && t.alongNm < dist - 5 && Math.abs(t.crossNm) <= ENROUTE_NM;
  });
}

const minutes = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** Works one round trip from home to `dest` and back. */
export function planTrip(input: TripInputs, dest: TripField, o: PlanOptions): TripPlan {
  const { home } = input;
  const now = input.fetchedAt;
  const perf = o.airplane.perf;
  const distance = r1(distanceNm(home.pos, dest.pos));
  const all = [input.home, ...input.fields];

  // Weather first, at the times the first pass at the legs gives, so the
  // ceilings can cap the cruise altitude; then the legs again under that cap.
  const departWx = weatherAt(home, all, o.departure, now);
  const roughArrive = addMin(o.departure, (distance / perf.cruise.tasKt) * 60 + 10);
  const roughHome = addMin(roughArrive, GROUND_MIN + (distance / perf.cruise.tasKt) * 60 + 10);
  const line = alongTheLine(input, dest).map((field) => ({ field, wx: weatherAt(field, all, addMin(o.departure, (distance / perf.cruise.tasKt) * 30), now) }));
  let arrivalWx = weatherAt(dest, all, roughArrive, now);
  let returnWx = weatherAt(home, all, roughHome, now);
  const ceilings = [ceilingMsl(home, departWx), ceilingMsl(dest, arrivalWx), ceilingMsl(home, returnWx), ...line.map((x) => ceilingMsl(x.field, x.wx))]
    .filter((x): x is number => x !== null);
  const lowestCeiling = ceilings.length ? Math.min(...ceilings) : null;
  let highestGround = Math.max(home.elevationFt, dest.elevationFt);
  if (input.groundFt) {
    const tc = trueCourse(home.pos, dest.pos);
    for (let i = 0; i <= 20; i++) highestGround = Math.max(highestGround, input.groundFt(destination(home.pos, tc, (distance * i) / 20)));
  }

  const outLeg = leg(home, dest, input, o, lowestCeiling, highestGround);
  const backLeg = leg(dest, home, input, o, lowestCeiling, highestGround);
  const out = outLeg.leg;
  const back = backLeg.leg;

  const arrive = addMin(o.departure, out.totalMin);
  const leave = addMin(arrive, GROUND_MIN);
  const homeAt = addMin(leave, back.totalMin);
  arrivalWx = weatherAt(dest, all, arrive, now);
  returnWx = weatherAt(home, all, homeAt, now);
  const sunHome = sunTimes(home.pos, homeAt);
  const sunDepart = sunTimes(home.pos, o.departure);
  const times: TripTimes = {
    depart: o.departure, arrive, leave, home: homeAt,
    sunrise: sunDepart.sunrise, sunset: sunHome.sunset,
    sunsetMarginMin: sunHome.sunset ? minutes(homeAt, sunHome.sunset) : null,
  };

  const reserveMin = Math.max(o.prefs.reserveMin, vfrReserveMin(false));
  const reserveGal = r1((perf.cruise.gph * reserveMin) / 60);
  const legalReserveGal = r1((perf.cruise.gph * vfrReserveMin(false)) / 60);
  const requiredGal = r1(out.totalFuelGal + back.totalFuelGal + reserveGal);
  const fuel: TripFuel = {
    outGal: out.totalFuelGal, backGal: back.totalFuelGal, reserveMin, reserveGal, legalReserveGal, requiredGal,
    usableGal: o.airplane.usableGal, marginGal: r1(o.airplane.usableGal - requiredGal),
  };

  const runway = pickRunway(dest, arrivalWx.wind, o.prefs.minRunwayFt);
  const homeRunway = pickRunway(home, returnWx.wind, 0);
  const temp = dest.metar?.tempC ?? null;
  const landingOver50Ft = runway
    ? landingDistance(perf, {
      fieldElevFt: dest.elevationFt, altimeterInHg: dest.metar?.altimeterInHg ?? 29.92,
      oatC: temp ?? isaTempC(dest.elevationFt), headwindKt: runway.headwindKt, surface: runway.runway.surface,
    }).over50Ft
    : null;

  const findings: Finding[] = [];
  const add = (x: Finding) => findings.push(x);
  if (distance > o.prefs.maxLegNm) {
    add({ id: 'range', severity: 'personal', title: 'Past your radius',
      detail: `${Math.round(distance)} nm against the ${o.prefs.maxLegNm} nm you set.`, acs: ['PA.VI.A'], refs: ['PHAK, flight planning'] });
  }
  if (o.airplane.usableGal - out.totalFuelGal - back.totalFuelGal - legalReserveGal < 0) {
    add({ id: 'fuel-legal', severity: 'illegal', title: 'Not enough fuel for the round trip',
      detail: `${r1(out.totalFuelGal + back.totalFuelGal)} gal there and back plus the legal ${legalReserveGal} gal reserve, against ${o.airplane.usableGal} gal usable.`,
      acs: ['PA.I.D', 'PA.VI.A'], refs: ['14 CFR 91.151'] });
  } else if (fuel.marginGal < 0) {
    add({ id: 'fuel-personal', severity: 'personal', title: 'Your reserve isn\'t there without a fuel stop',
      detail: `${requiredGal} gal with your ${reserveMin} minute reserve, against ${o.airplane.usableGal} gal usable. The engine plans without a fuel stop because it can't confirm fuel at the far end.`,
      acs: ['PA.I.D'], refs: ['14 CFR 91.151'] });
  }
  if (out.groundspeedKt === 0 || back.groundspeedKt === 0) {
    add({ id: 'wind-strong', severity: 'limit', title: 'Wind aloft too strong to make good the course',
      detail: 'The forecast wind is more than the airplane can correct for.', acs: ['PA.VI.A'], refs: ['PHAK, wind triangle'] });
  }
  if (times.sunrise && o.departure < times.sunrise) {
    add({ id: 'before-sunrise', severity: 'personal', title: 'Departure before sunrise',
      detail: 'These are day trips. Leave after sunrise.', acs: ['PA.I.C'], refs: ['14 CFR 91.151'] });
  }
  if (times.sunsetMarginMin !== null && times.sunsetMarginMin < 0) {
    add({ id: 'night', severity: 'personal', title: 'Home after sunset',
      detail: `Planned home ${-times.sunsetMarginMin} minutes after sunset. These are day trips; leave earlier or pick a shorter one.`,
      acs: ['PA.I.C'], refs: ['14 CFR 91.151'] });
  } else if (times.sunsetMarginMin !== null && times.sunsetMarginMin < 60) {
    add({ id: 'sunset-close', severity: 'caution', title: 'Home close to sunset',
      detail: `${times.sunsetMarginMin} minutes of daylight to spare. A slow fuel stop or a long taxi uses it.`, acs: ['PA.I.C'], refs: ['14 CFR 91.151'] });
  }
  const longest = longestRunwayFt(dest);
  if (longest > 0 && longest < o.prefs.minRunwayFt) {
    add({ id: 'runway-short', severity: 'personal', title: 'Runway under your minimum',
      detail: `${fmtFt(longest)} ft against the ${fmtFt(o.prefs.minRunwayFt)} ft you set.`, acs: ['PA.I.F'], refs: ['Risk Management Handbook, personal minimums'] });
  }
  if (dest.airspace === 'B') {
    add({ id: 'class-b', severity: 'caution', title: 'Class B at the far end',
      detail: `${dest.id} sits in Class B. You need a clearance to enter, and a plan for when you don't get one.`, acs: ['PA.I.E'], refs: ['14 CFR 91.131'] });
  } else if (dest.airspace === 'C') {
    add({ id: 'class-c', severity: 'info', title: 'Class C at the far end',
      detail: `Two-way radio contact with approach before you enter the outer ring around ${dest.id}.`, acs: ['PA.I.E'], refs: ['14 CFR 91.130'] });
  }
  if (!dest.runways.length) {
    add({ id: 'runway-unknown', severity: 'caution', title: 'Runway data missing',
      detail: 'The airport data has no runways for this field. Check the Chart Supplement before planning it.', acs: ['PA.I.F'], refs: ['14 CFR 91.103'] });
  }
  if (runway && landingOver50Ft !== null && landingOver50Ft > runway.runway.lengthFt) {
    add({ id: 'landing-distance', severity: 'limit', title: 'Landing distance longer than the runway',
      detail: `${fmtFt(landingOver50Ft)} ft over a 50 ft obstacle against ${fmtFt(runway.runway.lengthFt)} ft of runway.`, acs: ['PA.I.F'], refs: ['PHAK ch. 11'] });
  }
  findings.push(...wxFindings(departWx, `${home.id} at departure`, 'depart', o, null));
  findings.push(...wxFindings(arrivalWx, `${dest.id} at arrival`, 'arrive', o, runway));
  findings.push(...wxFindings(returnWx, `${home.id} on the return`, 'return', o, homeRunway));
  const enrouteChecked = line.map((x) => ({ ...x, f: wxFindings(x.wx, `${x.field.id}, along the line`, `enroute-${x.field.id}`, o, null).filter((y) => y.severity !== 'caution') }));
  enrouteChecked.sort((a, b) => worstRank(a.f) - worstRank(b.f));
  findings.push(...(enrouteChecked[0]?.f ?? []));
  if (!input.winds.length || !outLeg.station) {
    add({ id: 'no-winds', severity: 'info', title: 'No winds aloft',
      detail: 'No winds aloft forecast was in reach, so times and fuel assume still air. Expect them to be off.', acs: ['PA.I.C'], refs: ['Aviation Weather Handbook, winds aloft'] });
  }
  if (out.altitudeMsl - highestGround < 1500) {
    add({ id: 'low-cruise', severity: 'caution', title: 'Low cruise under the clouds',
      detail: `The ceiling holds the cruise to ${fmtFt(out.altitudeMsl)} ft, ${fmtFt(out.altitudeMsl - highestGround)} ft over the highest ground the engine knows. Check the chart for towers and terrain.`,
      acs: ['PA.VI.A'], refs: ['14 CFR 91.119'] });
  }
  findings.sort((a, b) => RANK.indexOf(a.severity) - RANK.indexOf(b.severity));

  const plan: TripPlan = {
    dest, distanceNm: distance, magCourse: out.magCourse, out, back, fuel, times,
    arrivalWx, returnWx, departWx,
    enroute: enrouteChecked[0] ? { field: enrouteChecked[0].field, wx: enrouteChecked[0].wx } : null,
    runway, landingOver50Ft, windsStation: outLeg.station,
    findings, filtered: findings.some((x) => STOPS.includes(x.severity)), tags: [], score: 0,
  };
  plan.tags = tagsFor(plan, o);
  plan.score = scoreOf(plan, o);
  return plan;
}

function worstRank(f: Finding[]): number {
  return f.length ? Math.min(...f.map((x) => RANK.indexOf(x.severity))) : RANK.length;
}

/* ---------------------------------------------------------------- goals and variety */

const DAY_MS = 86_400_000;

export function tagsFor(p: TripPlan, o: PlanOptions): TripTag[] {
  const tags: TripTag[] = [];
  const past = o.history.filter((h) => h.id === p.dest.id);
  const last = past.map((h) => Date.parse(h.at)).sort((a, b) => b - a)[0];
  if (!past.length) tags.push('new');
  else if (o.departure.getTime() - last > 180 * DAY_MS) tags.push('stale');
  if (p.dest.towered) tags.push('towered');
  // 14 CFR 61.1: cross-country time for a private certificate lands more than 50 nm straight-line from the start.
  if (p.distanceNm > 50) tags.push('xc-credit');
  const longest = longestRunwayFt(p.dest);
  if (hasGrass(p.dest)) tags.push('grass');
  else if (longest > 0 && longest < 3000) tags.push('short-runway');
  const farthest = Math.max(0, ...o.history.map((h) => h.distanceNm));
  if (o.history.length && p.distanceNm > farthest) tags.push('longest');
  const xw = p.runway ? p.runway.gustCrosswindKt ?? p.runway.crosswindKt : 0;
  if (xw >= o.minimums.crosswindKt / 2 && xw <= o.minimums.crosswindKt) tags.push('crosswind');
  if (Math.abs(p.out.groundspeedKt - p.back.groundspeedKt) >= 15) tags.push('wind-lesson');
  return tags;
}

const TAG_WEIGHT: Record<TripTag, number> = {
  new: 4, stale: 2, towered: 2, 'xc-credit': 3, 'short-runway': 2, grass: 2, longest: 2, crosswind: 1, 'wind-lesson': 1,
};

/**
 * An ordering, not a measure: goals the trip serves, margin on the weather
 * and the daylight, a distance that suits the pilot's radius, less for each
 * caution and for a field flown in the last month.
 */
export function scoreOf(p: TripPlan, o: PlanOptions): number {
  let s = 10;
  for (const t of p.tags) s += TAG_WEIGHT[t];
  const recent = o.history.some((h) => h.id === p.dest.id && o.departure.getTime() - Date.parse(h.at) < 30 * DAY_MS);
  if (recent) s -= 6;
  s -= 2 * p.findings.filter((f) => f.severity === 'caution').length;
  const ceil = Math.min(p.arrivalWx.ceilingFtAgl ?? 12000, p.returnWx.ceilingFtAgl ?? 12000);
  s += Math.min(3, Math.max(0, (ceil - o.minimums.ceilingFt) / 1000));
  if (p.times.sunsetMarginMin !== null) s += Math.min(2, Math.max(0, p.times.sunsetMarginMin / 120));
  const sweet = 0.6 * o.prefs.maxLegNm;
  s -= Math.abs(p.distanceNm - sweet) / (0.3 * o.prefs.maxLegNm);
  return Math.round(s * 100) / 100;
}

/** What sort of landing a trip ends in, so a set of picks doesn't land at three of the same. */
export function kindOf(p: TripPlan): 'towered' | 'grass' | 'short' | 'open' {
  if (hasGrass(p.dest)) return 'grass';
  if (p.dest.towered) return 'towered';
  return longestRunwayFt(p.dest) < 3000 ? 'short' : 'open';
}

/**
 * Up to `n` trips, best first, each one paying for sharing a direction (within
 * 45°) or a kind of field with a trip already picked. Trips in `skip` are
 * left out, which is how "show me others" finds the next set.
 */
export function pickVaried(ranked: TripPlan[], n: number, skip: Set<string> = new Set()): TripPlan[] {
  const pool = ranked.filter((p) => !skip.has(p.dest.id));
  const out: TripPlan[] = [];
  while (out.length < n && pool.length) {
    let bestI = 0;
    let bestS = -Infinity;
    pool.forEach((p, i) => {
      let s = p.score;
      for (const q of out) {
        const dBrg = Math.abs(((p.magCourse - q.magCourse + 540) % 360) - 180);
        if (dBrg < 45) s -= 4;
        if (kindOf(p) === kindOf(q)) s -= 3;
      }
      if (s > bestS) {
        bestS = s;
        bestI = i;
      }
    });
    out.push(pool.splice(bestI, 1)[0]);
  }
  return out;
}

export interface Recommendation {
  /** Every field in range, worked. */
  considered: TripPlan[];
  /** Those that passed, best first. */
  ranked: TripPlan[];
  /** Those that didn't, with the finding that stopped each. */
  filtered: TripPlan[];
}

export function recommend(input: TripInputs, o: PlanOptions): Recommendation {
  const considered = input.fields
    .filter((f) => {
      const nm = distanceNm(input.home.pos, f.pos);
      // A little past the radius still gets worked, so the pilot sees why it was left out.
      return nm >= MIN_TRIP_NM && nm <= o.prefs.maxLegNm * 1.3;
    })
    .map((f) => planTrip(input, f, o));
  const ranked = considered.filter((p) => !p.filtered).sort((a, b) => b.score - a.score);
  const filtered = considered.filter((p) => p.filtered).sort((a, b) => a.distanceNm - b.distanceNm);
  return { considered, ranked, filtered };
}

/** The finding that kept a trip off the list. */
export function stopper(p: TripPlan): Finding | null {
  return p.findings.find((f) => STOPS.includes(f.severity)) ?? null;
}

/* ---------------------------------------------------------------- the diversion */

export interface DiversionChoice {
  /** 'continue', 'home', or the alternate's id. */
  id: string;
  field: TripField;
  leg: Leg;
  wx: WxAt;
  /** Fuel on board after landing there. */
  fuelOnLandingGal: number;
  /** Fuel on landing minus the legal reserve. */
  legalMarginGal: number;
  runwayFt: number;
  landingOver50Ft: number | null;
}

export interface DiversionScene {
  /** Halfway out, on the course. */
  pos: LatLon;
  at: Date;
  fuelOnBoardGal: number;
  /** Ceiling the destination amends to: under the pilot's minimum, legal when the minimum allows. */
  amendedCeilingFt: number;
  choices: DiversionChoice[];
}

/** The ceiling a mid-flight amendment brings: 500 ft under the pilot's line, never under 600 ft. */
export function amendedCeiling(mins: PersonalMinimums): number {
  return Math.max(600, Math.round((mins.ceilingFt - 500) / 100) * 100);
}

/**
 * Halfway to the destination, its forecast amends to a ceiling under the
 * pilot's minimum. The choices are pressing on, turning for home, and the
 * two fields nearest the airplane with a runway it can land on, each worked
 * from where the airplane is with the same wind.
 */
export function diversionScene(input: TripInputs, plan: TripPlan, o: PlanOptions): DiversionScene {
  const perf = o.airplane.perf;
  const { home } = input;
  const tc = trueCourse(home.pos, plan.dest.pos);
  const pos = destination(home.pos, tc, plan.distanceNm / 2);
  const at = addMin(plan.times.depart, plan.out.climbMin + plan.out.minutes / 2);
  const used = perf.taxiFuelGal + (perf.climbGph * plan.out.climbMin) / 60 + plan.out.fuelGal / 2;
  const fuelOnBoardGal = r1(o.airplane.usableGal - used);
  const legalReserve = (perf.cruise.gph * vfrReserveMin(false)) / 60;
  const wind = plan.out.wind ?? { dirTrue: 0, speedKt: 0 };
  const all = [home, ...input.fields];
  const amendedCeilingFt = amendedCeiling(o.minimums);

  const choice = (id: string, field: TripField, wx: WxAt): DiversionChoice => {
    const l = legTo(pos, field.pos, { tasKt: perf.cruise.tasKt, windFromTrue: wind.dirTrue, windKt: wind.speedKt, variationDeg: field.variationDeg, gph: perf.cruise.gph });
    const rwy = pickRunway(field, wx.wind, 0);
    const ldg = rwy ? landingDistance(perf, {
      fieldElevFt: field.elevationFt, altimeterInHg: field.metar?.altimeterInHg ?? 29.92,
      oatC: field.metar?.tempC ?? isaTempC(field.elevationFt), headwindKt: rwy.headwindKt, surface: rwy.runway.surface,
    }).over50Ft : null;
    const onLanding = r1(fuelOnBoardGal - l.fuelGal);
    return { id, field, leg: l, wx, fuelOnLandingGal: onLanding, legalMarginGal: r1(onLanding - legalReserve), runwayFt: longestRunwayFt(field), landingOver50Ft: ldg };
  };

  const destWx: WxAt = { ...plan.arrivalWx, ceilingFtAgl: amendedCeilingFt, category: flightCategory(amendedCeilingFt, plan.arrivalWx.visibilitySm), covered: true };
  const choices = [choice('continue', plan.dest, destWx), choice('home', home, weatherAt(home, all, at, input.fetchedAt))];
  const alternates = input.fields
    .filter((f) => f.id !== plan.dest.id && f.runways.length > 0)
    .map((f) => ({ f, nm: distanceNm(pos, f.pos) }))
    .sort((a, b) => a.nm - b.nm)
    .slice(0, 2);
  for (const { f } of alternates) choices.push(choice(f.id, f, weatherAt(f, all, at, input.fetchedAt)));
  return { pos, at, fuelOnBoardGal, amendedCeilingFt, choices };
}

/**
 * Short of the legal reserve, under VFR, or a runway shorter than the landing
 * distance: unsafe. Under a personal minimum, a runway under the pilot's own
 * line, or no weather at all: marginal. Of the rest, the soonest on the
 * ground is best and the others sound.
 */
export function gradeDiversionChoices(scene: DiversionScene, o: PlanOptions): Record<string, Grade> {
  const out: Record<string, Grade> = {};
  const ok: DiversionChoice[] = [];
  const mins = o.minimums;
  for (const c of scene.choices) {
    const ceil = c.wx.ceilingFtAgl;
    const vis = c.wx.visibilitySm;
    const illegalWx = (ceil !== null && ceil < 1000) || (vis !== null && vis < 3);
    const tooShort = c.landingOver50Ft !== null && c.runwayFt > 0 && c.landingOver50Ft > c.runwayFt;
    if (c.legalMarginGal < 0 || illegalWx || tooShort || c.leg.groundspeedKt === 0) out[c.id] = 'unsafe';
    else if ((ceil !== null && ceil < mins.ceilingFt) || (vis !== null && vis < mins.visibilitySm) || c.runwayFt < o.prefs.minRunwayFt || c.wx.source === 'none') out[c.id] = 'marginal';
    else ok.push(c);
  }
  const soonest = Math.min(...ok.map((c) => c.leg.minutes));
  for (const c of ok) out[c.id] = c.leg.minutes === soonest ? 'best' : 'acceptable';
  return out;
}

/** Degrees as a pilot writes them: 005, 240, 360. */
export const deg3 = (n: number) => String(Math.round(norm(n)) || 360).padStart(3, '0');
