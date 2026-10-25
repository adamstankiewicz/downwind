// Cross-country arithmetic: distance and course between points, the wind
// triangle, VFR cruising altitudes and a nav log. Everything a plotter and
// an E6B would give you, done the same way so the worked example matches.

import { norm, trueToMagnetic } from './wind';

export interface LatLon {
  lat: number;
  lon: number;
}

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in nautical miles. */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true course from a to b, degrees 0 to 359. */
export function trueCourse(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return norm(deg(Math.atan2(y, x)));
}

/** The point `nm` along a true course from `a`. */
export function destination(a: LatLon, courseTrue: number, nm: number): LatLon {
  const d = nm / R_NM;
  const lat1 = rad(a.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(rad(courseTrue)));
  const lon2 = rad(a.lon) + Math.atan2(Math.sin(rad(courseTrue)) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

export interface WindTriangle {
  /** Wind correction angle, degrees; positive is a correction to the right. */
  wcaDeg: number;
  trueHeading: number;
  groundspeedKt: number;
  /** Headwind along the course, negative for a tailwind. */
  headwindKt: number;
  crosswindKt: number;
}

/**
 * The E6B wind side: true course, TAS, and wind FROM (true) and speed give
 * heading and groundspeed. Returns groundspeed 0 if the wind is stronger than
 * the airplane can correct for.
 */
export function windTriangle(courseTrue: number, tasKt: number, windFromTrue: number, windKt: number): WindTriangle {
  const angle = rad(windFromTrue - courseTrue);
  const cross = windKt * Math.sin(angle);
  const head = windKt * Math.cos(angle);
  const ratio = cross / tasKt;
  if (Math.abs(ratio) >= 1) return { wcaDeg: 0, trueHeading: courseTrue, groundspeedKt: 0, headwindKt: head, crosswindKt: cross };
  const wca = deg(Math.asin(ratio));
  const gs = tasKt * Math.cos(rad(wca)) - head;
  return {
    wcaDeg: Math.round(wca),
    trueHeading: Math.round(norm(courseTrue + wca)),
    groundspeedKt: Math.round(gs),
    headwindKt: Math.round(head),
    crosswindKt: Math.round(cross),
  };
}

/** True airspeed from indicated, using the 2 percent per 1,000 ft rule of thumb on density altitude. */
export function tasFromIas(iasKt: number, densityAltFt: number): number {
  return Math.round(iasKt * (1 + (0.02 * densityAltFt) / 1000));
}

/**
 * 14 CFR 91.159: above 3,000 ft AGL, magnetic course 0 to 179 flies odd
 * thousands plus 500, 180 to 359 flies even thousands plus 500. Returns the
 * legal VFR cruising altitudes (MSL) between `minMsl` and `maxMsl`.
 */
export function vfrCruisingAltitudes(magCourse: number, minMsl: number, maxMsl: number): number[] {
  const east = norm(magCourse) < 180;
  const out: number[] = [];
  for (let k = 1; k <= 17; k++) {
    const alt = k * 1000 + 500;
    if (alt > 17500) break;
    if ((k % 2 === 1) === east && alt >= minMsl && alt <= maxMsl) out.push(alt);
  }
  return out;
}

/** Is a cruising altitude legal for the course? Below 3,000 AGL any altitude is. */
export function isLegalVfrAltitude(magCourse: number, altMsl: number, groundFt: number): boolean {
  if (altMsl - groundFt <= 3000) return true;
  return vfrCruisingAltitudes(magCourse, altMsl, altMsl).length === 1;
}

export interface NavPoint extends LatLon {
  id: string;
  name: string;
}

export interface NavLeg {
  from: NavPoint;
  to: NavPoint;
  distanceNm: number;
  trueCourse: number;
  magCourse: number;
  trueHeading: number;
  magHeading: number;
  wcaDeg: number;
  groundspeedKt: number;
  minutes: number;
  fuelGal: number;
}

export interface NavLog {
  legs: NavLeg[];
  totalNm: number;
  totalMin: number;
  totalFuelGal: number;
}

/**
 * A nav log for a route at one cruise TAS and wind. `variationDeg` is
 * positive east (east is least, west is best: west variation is added).
 */
export function navLog(points: NavPoint[], o: { tasKt: number; windFromTrue: number; windKt: number; variationDeg: number; gph: number }): NavLog {
  const legs: NavLeg[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const tc = Math.round(trueCourse(a, b));
    const w = windTriangle(tc, o.tasKt, o.windFromTrue, o.windKt);
    const nm = Math.round(distanceNm(a, b) * 10) / 10;
    const minutes = w.groundspeedKt > 0 ? Math.round((nm / w.groundspeedKt) * 60) : Infinity;
    legs.push({
      from: a, to: b, distanceNm: nm, trueCourse: tc,
      magCourse: Math.round(trueToMagnetic(tc, o.variationDeg)),
      trueHeading: w.trueHeading,
      magHeading: Math.round(trueToMagnetic(w.trueHeading, o.variationDeg)),
      wcaDeg: w.wcaDeg, groundspeedKt: w.groundspeedKt, minutes,
      fuelGal: Math.round(((minutes * o.gph) / 60) * 10) / 10,
    });
  }
  const sum = (f: (l: NavLeg) => number) => legs.reduce((n, l) => n + f(l), 0);
  return {
    legs,
    totalNm: Math.round(sum((l) => l.distanceNm) * 10) / 10,
    totalMin: sum((l) => l.minutes),
    totalFuelGal: Math.round(sum((l) => l.fuelGal) * 10) / 10,
  };
}
