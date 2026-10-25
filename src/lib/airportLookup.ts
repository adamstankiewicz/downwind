// Looks up an airport for onboarding: elevation, runways and magnetic
// variation, so any home base can get live weather and runway winds.
// The aviationweather.gov airport product's shape isn't guaranteed, so this
// parses defensively and the onboarding flow always lets the pilot confirm
// or correct every value before saving.

import type { Airport } from '../data/airports';
import { airports } from '../data/airports';
import type { RunwayEnd } from './wind';

const BASE = (import.meta.env?.VITE_AWC_BASE as string | undefined) ?? '/api/awc';

export interface LookupResult {
  airport: Airport;
  /** 'bundled' is checked data shipped with the app; 'awc' came from the API. */
  source: 'bundled' | 'awc';
}

export function normalizeIdent(input: string): string {
  const s = input.trim().toUpperCase();
  // Three-letter US identifiers like "ASH" become "KASH".
  return /^[A-Z]{3}$/.test(s) ? `K${s}` : s;
}

/** "14W" or "-14" or -14 -> -14 (positive east). */
export function parseVariation(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([EW])?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]?.toUpperCase() === 'W' ? -Math.abs(n) : n;
}

/** Turns "14/32" with an alignment of 140 into two runway ends. */
export function runwayEnds(id: string, alignment: unknown): RunwayEnd[] {
  const [a, b] = id.split('/').map((s) => s.trim());
  if (!a || !b) return [];
  const numA = parseInt(a, 10);
  const numB = parseInt(b, 10);
  if (!Number.isFinite(numA) || !Number.isFinite(numB)) return [];
  const align = typeof alignment === 'number' ? alignment : parseFloat(String(alignment ?? ''));
  const headingA = Number.isFinite(align) && Math.abs(align - numA * 10) <= 20 ? align : numA * 10;
  return [
    { id: a, headingMag: Math.round(headingA) % 360 || 360 },
    { id: b, headingMag: Math.round(headingA + 180) % 360 || 360 },
  ];
}

export function fromAwc(json: unknown, ident: string): Airport | null {
  const list = Array.isArray(json) ? json : [json];
  const r = list.find((x) => x && typeof x === 'object' && ((x as Record<string, unknown>).icaoId === ident || (x as Record<string, unknown>).id === ident)) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  const elev = Number(r.elev);
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  const runways = (Array.isArray(r.runways) ? r.runways : [])
    .flatMap((rw: Record<string, unknown>) => runwayEnds(String(rw.id ?? ''), rw.alignment))
    .filter((e) => !/H/.test(e.id));
  return {
    icao: ident,
    name: String(r.name ?? ident),
    city: [r.city, r.state].filter(Boolean).join(', '),
    // The API reports elevation in meters.
    elevationFt: Number.isFinite(elev) ? Math.round(elev * 3.28084) : 0,
    magneticVariationDeg: parseVariation(r.magdec) ?? 0,
    airspace: 'D',
    runways,
    tafStations: [ident],
    ...(Number.isFinite(lat) && Number.isFinite(lon) && r.lat !== null && r.lon !== null ? { pos: { lat, lon } } : {}),
    verify: ['elevation', 'runway headings', 'magnetic variation', 'airspace class', 'TAF stations'],
  };
}

export async function lookupAirport(input: string, signal?: AbortSignal): Promise<LookupResult | null> {
  const ident = normalizeIdent(input);
  if (airports[ident]) return { airport: airports[ident], source: 'bundled' };
  try {
    const res = await fetch(`${BASE}/airport?ids=${ident}&format=json`, { signal });
    if (!res.ok) return null;
    const a = fromAwc(await res.json(), ident);
    return a ? { airport: a, source: 'awc' } : null;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return null;
  }
}

/** A blank airport for manual entry when lookup fails. */
export function manualAirport(input: string): Airport {
  const ident = normalizeIdent(input);
  return {
    icao: ident, name: ident, city: '', elevationFt: 0, magneticVariationDeg: 0, airspace: 'D',
    runways: [], tafStations: [ident], verify: ['everything'],
  };
}
