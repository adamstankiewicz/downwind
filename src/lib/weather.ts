import { parseMetar, type Metar } from './metar';
import { parseTaf, type Taf } from './taf';
import { sampleMetarFor, sampleTafFor } from '../data/sampleWeather';

// Dev: Vite proxies /api/awc to aviationweather.gov/api/data.
// Prod: the edge worker in /worker serves the same path.
const BASE = (import.meta.env?.VITE_AWC_BASE as string | undefined) ?? '/api/awc';

export interface WeatherBundle {
  metar: Metar;
  taf: Taf | null;
  source: 'live' | 'sample';
  fetchedAt: Date;
  error?: string;
}

async function getText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  return res.text();
}

/** Raw reports come back one per line, newest first. */
function firstReport(text: string, station?: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!station) return lines[0] ?? null;
  return lines.find((l) => l.includes(` ${station} `) || l.startsWith(`${station} `)) ?? null;
}

/** TAF reports span lines; regroup them by the leading TAF keyword or station. */
function splitTafs(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    if (/^TAF\b/.test(l) || /^K[A-Z0-9]{3}\s\d{6}Z/.test(l) || out.length === 0) out.push(l);
    else out[out.length - 1] += ' ' + l;
  }
  return out;
}

export async function fetchWeather(station: string, tafStations: string[], signal?: AbortSignal): Promise<WeatherBundle> {
  try {
    const metarText = await getText(`/metar?ids=${station}&format=raw&hours=2`, signal);
    const rawMetar = firstReport(metarText, station);
    if (!rawMetar) throw new Error(`No current METAR for ${station}`);
    let taf: Taf | null = null;
    try {
      const tafText = await getText(`/taf?ids=${tafStations.join(',')}&format=raw`, signal);
      const tafs = splitTafs(tafText).map(parseTaf);
      taf = tafStations.map((s) => tafs.find((t) => t.station === s)).find(Boolean) ?? null;
    } catch {
      taf = null;
    }
    return { metar: parseMetar(rawMetar), taf, source: 'live', fetchedAt: new Date() };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return sampleWeather(station, (e as Error).message);
  }
}

/** Practice weather for a station. Never a real report; always source 'sample'. */
export function sampleWeather(station = '', error?: string): WeatherBundle {
  return { metar: parseMetar(sampleMetarFor(station)), taf: parseTaf(sampleTafFor(station)), source: 'sample', fetchedAt: new Date(), error };
}
