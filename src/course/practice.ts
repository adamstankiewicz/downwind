// Lesson weather. Lessons build their own reports around the pilot's field so
// the numbers land where the lesson needs them (a crosswind just over the
// pilot's own minimum, a ceiling just under it). They are written as real
// METAR and TAF text and read back through the same parsers as live data.
// None of it is a real report, and the UI labels it as practice weather.

import type { Airport } from '../data/airports';
import type { AircraftProfile } from '../data/aircraft';
import type { PersonalMinimums } from '../data/pilot';
import { norm } from '../lib/wind';
import type { LessonContext } from './types';

/** A made-up field for pilots who haven't set a home field with runways. */
export const PRACTICE_FIELD: Airport = {
  icao: 'KXYZ',
  name: 'Practice field',
  city: 'Not a real airport',
  elevationFt: 600,
  magneticVariationDeg: -10,
  airspace: 'D',
  runways: [
    { id: '06', headingMag: 60 },
    { id: '24', headingMag: 240 },
  ],
  tafStations: [],
  verify: [],
};

export function lessonContext(
  home: Airport | null,
  aircraft: AircraftProfile,
  minimums: PersonalMinimums,
  now = new Date(),
): LessonContext {
  const usable = home && home.runways.length > 0;
  return { airport: usable ? home : PRACTICE_FIELD, practiceField: !usable, aircraft, minimums, now };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** ddhhmmZ for a date. */
export function zTime(d: Date): string {
  return `${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z`;
}

/** ddhh for a date, as TAF validity and FM groups use. */
export function zDayHour(d: Date): string {
  return `${p2(d.getUTCDate())}${p2(d.getUTCHours())}`;
}

export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}

/** The top of the next UTC hour at least `minHours` away. */
export function wholeHourAfter(d: Date, minHours: number): Date {
  const t = addHours(d, minHours);
  t.setUTCMinutes(0, 0, 0);
  return t.getTime() < addHours(d, minHours).getTime() ? addHours(t, 1) : t;
}

/** The next time it is `hour`:00 on the pilot's clock, at least an hour away. */
export function nextLocalHour(d: Date, hour: number): Date {
  const t = new Date(d);
  t.setHours(hour, 0, 0, 0);
  if (t.getTime() < addHours(d, 1).getTime()) t.setDate(t.getDate() + 1);
  return t;
}

export interface WindSpec {
  dirTrue: number | null;
  speedKt: number;
  gustKt?: number | null;
}

export function windGroup(w: WindSpec): string {
  const dir = w.dirTrue === null ? 'VRB' : String(Math.round(norm(w.dirTrue) / 10) * 10 || 360).padStart(3, '0');
  const g = w.gustKt ? `G${p2(Math.round(w.gustKt))}` : '';
  return `${dir}${p2(Math.round(w.speedKt))}${g}KT`;
}

/** Cloud group, e.g. ('BKN', 2800) -> BKN028. */
export function cloud(cover: 'FEW' | 'SCT' | 'BKN' | 'OVC', baseFt: number): string {
  return `${cover}${String(Math.round(baseFt / 100)).padStart(3, '0')}`;
}

function tempGroup(c: number): string {
  return c < 0 ? `M${p2(-c)}` : p2(c);
}

export interface MetarSpec {
  station: string;
  at: Date;
  wind: WindSpec;
  vis: string;
  weather?: string[];
  sky: string[];
  tempC: number;
  dewC: number;
  altimeter: number;
  speci?: boolean;
}

export function metarText(s: MetarSpec): string {
  return [
    s.speci ? 'SPECI' : 'METAR',
    s.station,
    zTime(s.at),
    windGroup(s.wind),
    s.vis,
    ...(s.weather ?? []),
    ...(s.sky.length ? s.sky : ['CLR']),
    `${tempGroup(s.tempC)}/${tempGroup(s.dewC)}`,
    `A${Math.round(s.altimeter * 100)}`,
    'RMK AO2',
  ].join(' ');
}

/** The last routine observation time (hh:53) at or before `d`. */
export function observedAt(d: Date): Date {
  const t = new Date(d);
  if (t.getUTCMinutes() < 53) t.setUTCHours(t.getUTCHours() - 1);
  t.setUTCMinutes(53, 0, 0);
  return t;
}

/** Magnetic heading to a true direction at this field. */
export function magToTrue(airport: Airport, mag: number): number {
  return norm(mag + airport.magneticVariationDeg);
}

/** True wind direction, rounded to tens as reported, for a wind `offsetDeg` right of a runway. */
export function windAcross(airport: Airport, runwayHeadingMag: number, offsetDeg: number): number {
  return Math.round(magToTrue(airport, runwayHeadingMag + offsetDeg) / 10) * 10 || 360;
}

/** The runway a lesson is built around: the first end listed. Lengths come with NASR. */
export function mainRunway(airport: Airport) {
  return airport.runways[0];
}

/** A gust that lands `over` knots above the pilot's crosswind minimum at this angle. */
export function gustForCrosswind(mins: PersonalMinimums, angleDeg: number, over: number): number {
  return Math.ceil((mins.crosswindKt + over) / Math.sin((angleDeg * Math.PI) / 180));
}
