// Live inputs for Trip, from aviationweather.gov (US government data, free
// to use commercially): the fields that report weather within reach of home,
// their runways, their current reports and forecasts, and the winds aloft.
// Fields without a weather report aren't candidates, because the engine
// won't recommend a landing it can't check. Every value is parsed
// defensively; a field with anything missing is left out rather than guessed.

import type { Airport } from '../data/airports';
import type { LatLon } from './nav';
import { parseMetar } from './metar';
import { parseTaf, type Taf } from './taf';
import { parseVariation } from './airportLookup';
import { parseFb, validDate, type FbForecast } from './windsAloft';
import type { TripField, TripInputs, TripRunway, WindsStation } from '../scenarios/trip';

const BASE = (import.meta.env?.VITE_AWC_BASE as string | undefined) ?? '/api/awc';
/** Winds aloft stations are farther apart than airports; look this much past the radius for them. */
const WINDS_MARGIN_NM = 120;

type Json = Record<string, unknown>;

async function getJson(path: string, signal?: AbortSignal): Promise<Json[]> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const text = await res.text();
  if (!text.trim()) return [];
  const v = JSON.parse(text);
  return Array.isArray(v) ? v : [];
}

async function getText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.text();
}

/** lat0,lon0,lat1,lon1 around a point, `nm` each way. */
export function bbox(p: LatLon, nm: number): string {
  const dLat = nm / 60;
  const dLon = nm / (60 * Math.cos((p.lat * Math.PI) / 180));
  const f = (n: number) => n.toFixed(2);
  return `${f(p.lat - dLat)},${f(p.lon - dLon)},${f(p.lat + dLat)},${f(p.lon + dLon)}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

/** One aviationweather.gov airport record to runways, longest first. Helipads and water lanes are left out. */
export function runwaysFromAwc(r: Json): TripRunway[] {
  const list = Array.isArray(r.runways) ? (r.runways as Json[]) : [];
  const out: TripRunway[] = [];
  for (const rw of list) {
    const id = String(rw.id ?? '');
    if (!/^\d{1,2}[LCR]?\/\d{1,2}[LCR]?$/.test(id)) continue;
    const surface = String(rw.surface ?? '').toUpperCase();
    if (surface === 'W') continue;
    const length = num(String(rw.dimension ?? '').split('x')[0]);
    if (!length) continue;
    const [a, b] = id.split('/');
    const align = num(rw.alignment);
    const na = parseInt(a, 10) * 10;
    const ha = align !== null && Math.abs(align - na) <= 20 ? align : na;
    out.push({
      id,
      ends: [
        { id: a, headingMag: Math.round(ha) % 360 || 360 },
        { id: b, headingMag: Math.round(ha + 180) % 360 || 360 },
      ],
      lengthFt: length,
      surface: surface === 'G' || surface === 'T' ? 'grass' : 'paved',
    });
  }
  return out.sort((x, y) => y.lengthFt - x.lengthFt);
}

/** An airport record to a field, or null when it lacks a position or runways. */
export function fieldFromAwc(r: Json): TripField | null {
  const id = String(r.icaoId ?? '');
  const lat = num(r.lat);
  const lon = num(r.lon);
  const elevM = num(r.elev);
  if (!id || lat === null || lon === null || elevM === null) return null;
  const runways = runwaysFromAwc(r);
  if (!runways.length) return null;
  // Names come as "CITY/FIELD NAME"; the field part reads better.
  const name = String(r.name ?? id).split('/').pop()!.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return {
    id, name, pos: { lat, lon },
    // The API reports elevation in meters.
    elevationFt: Math.round(elevM * 3.28084),
    variationDeg: parseVariation(r.magdec) ?? 0,
    towered: r.tower === 'T',
    runways, metar: null, taf: null,
  };
}

async function airportsByIds(ids: string[], signal?: AbortSignal): Promise<Json[]> {
  const out: Json[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    out.push(...(await getJson(`/airport?ids=${ids.slice(i, i + 40).join(',')}&format=json`, signal)));
  }
  return out;
}

/** The FB forecast whose valid time is nearest the departure, within nine hours. */
export function pickFb(forecasts: FbForecast[], departure: Date, ref: Date): FbForecast | null {
  let best: FbForecast | null = null;
  let bestH = 9;
  for (const f of forecasts) {
    const v = validDate(f, ref);
    if (!v) continue;
    const h = Math.abs(v.getTime() - departure.getTime()) / 3_600_000;
    if (h <= bestH) {
      best = f;
      bestH = h;
    }
  }
  return best;
}

/**
 * Everything Trip needs from the network for one home field and radius.
 * Throws when the home field itself can't be found; anything else missing
 * (a TAF, the winds aloft) comes back empty and the engine says so.
 */
export async function fetchTripInputs(home: Airport, radiusNm: number, departure: Date, signal?: AbortSignal): Promise<TripInputs> {
  const homeRec = (await airportsByIds([home.icao], signal)).find((r) => r.icaoId === home.icao);
  const homeField = homeRec ? fieldFromAwc(homeRec) : null;
  if (!homeField) throw new Error(`Couldn't find ${home.icao} in the FAA airport data`);
  // The pilot's confirmed numbers win over the API's.
  homeField.elevationFt = home.elevationFt || homeField.elevationFt;
  homeField.variationDeg = home.magneticVariationDeg || homeField.variationDeg;

  const reach = Math.ceil(radiusNm * 1.3);
  const [stations, metars, tafs, ...fbTexts] = await Promise.all([
    getJson(`/stationinfo?bbox=${bbox(homeField.pos, reach + WINDS_MARGIN_NM)}&format=json`, signal),
    getJson(`/metar?bbox=${bbox(homeField.pos, reach)}&format=json`, signal),
    getJson(`/taf?bbox=${bbox(homeField.pos, reach)}&format=json`, signal).catch(() => [] as Json[]),
    ...['06', '12', '24'].map((h) => getText(`/windtemp?region=all&level=low&fcst=${h}`, signal).catch(() => '')),
  ]);

  const metarBy = new Map<string, string>();
  for (const m of metars) if (typeof m.icaoId === 'string' && typeof m.rawOb === 'string') metarBy.set(m.icaoId, m.rawOb);
  const tafBy = new Map<string, Taf>();
  for (const t of tafs) if (typeof t.icaoId === 'string' && typeof t.rawTAF === 'string') tafBy.set(t.icaoId, parseTaf(t.rawTAF));

  const ids = [...metarBy.keys()].filter((id) => id !== home.icao);
  const fields = (await airportsByIds(ids, signal))
    .map(fieldFromAwc)
    .filter((f): f is TripField => f !== null)
    .map((f) => ({ ...f, metar: parseMetar(metarBy.get(f.id)!), taf: tafBy.get(f.id) ?? null }));
  homeField.metar = metarBy.has(home.icao) ? parseMetar(metarBy.get(home.icao)!) : null;
  homeField.taf = tafBy.get(home.icao) ?? null;

  // FB stations are three-letter ids; most are an airport's ICAO id without the K.
  const now = new Date();
  const fb = pickFb(fbTexts.filter(Boolean).map(parseFb), departure, now);
  const posBy = new Map<string, LatLon>();
  for (const s of stations) {
    const id = String(s.icaoId ?? '');
    const lat = num(s.lat);
    const lon = num(s.lon);
    if (/^K[A-Z0-9]{3}$/.test(id) && lat !== null && lon !== null) posBy.set(id.slice(1), { lat, lon });
  }
  const winds: WindsStation[] = (fb?.stations ?? [])
    .filter((s) => posBy.has(s.id))
    .map((s) => ({ id: s.id, pos: posBy.get(s.id)!, levels: s.levels }));

  return { source: 'live', home: homeField, fields, winds, fetchedAt: now };
}
