// Sunrise and sunset from a position and a date, by the NOAA solar
// calculator's equations. Good to a minute or two in the latitudes most
// pilots fly, which is plenty for "home before sunset", and never a
// substitute for the official times in a briefing.

import type { LatLon } from './nav';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Zenith of the sun's center at sunrise and sunset, allowing for refraction and the disc. */
const SUNSET_ZENITH = 90.833;

export interface SunTimes {
  /** Null in polar day or night. */
  sunrise: Date | null;
  sunset: Date | null;
}

/** Julian day at 0000 UTC of a UTC calendar day. */
function julianDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / 86_400_000 + 2440587.5;
}

/** Equation of time (minutes) and solar declination (degrees) at a Julian day. */
function solar(jd: number): { eqTimeMin: number; declDeg: number } {
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const declDeg = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = y * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(m)) + 4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0))
    - 0.5 * y * y * Math.sin(4 * rad(l0)) - 1.25 * e * e * Math.sin(2 * rad(m));
  return { eqTimeMin: 4 * deg(eqTime), declDeg };
}

/** Minutes after 0000 UTC of the event, or null if the sun doesn't cross the horizon. */
function eventMin(jd: number, p: LatLon, rising: boolean): number | null {
  // Two passes: the second evaluates the sun at the first estimate's time.
  let est = 720;
  for (let i = 0; i < 2; i++) {
    const { eqTimeMin, declDeg } = solar(jd + est / 1440);
    const cosH = (Math.cos(rad(SUNSET_ZENITH)) - Math.sin(rad(p.lat)) * Math.sin(rad(declDeg))) / (Math.cos(rad(p.lat)) * Math.cos(rad(declDeg)));
    if (cosH > 1 || cosH < -1) return null;
    const ha = deg(Math.acos(cosH)) * (rising ? 1 : -1);
    est = 720 - 4 * (p.lon + ha) - eqTimeMin;
  }
  return est;
}

/**
 * Sunrise and sunset for the solar day nearest `day` at `p`. The UTC date is
 * taken at local solar noon, so a western-hemisphere evening still gets its
 * own sunset rather than the next day's.
 */
export function sunTimes(p: LatLon, day: Date): SunTimes {
  const solarNoon = new Date(day.getTime() + (p.lon / 15) * 3_600_000);
  const y = solarNoon.getUTCFullYear();
  const m = solarNoon.getUTCMonth() + 1;
  const d = solarNoon.getUTCDate();
  const jd = julianDay(y, m, d);
  const at = (min: number | null) => (min === null ? null : new Date(Date.UTC(y, m - 1, d) + Math.round(min * 60_000)));
  return { sunrise: at(eventMin(jd, p, true)), sunset: at(eventMin(jd, p, false)) };
}
