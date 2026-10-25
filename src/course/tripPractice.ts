// Trip on the practice sectional: the made-up fields around KXYZ with
// made-up weather, for pilots without a home field or when live weather
// can't be reached. The weather is written as METAR, TAF and FB text and read
// back through the same parsers as live data. It changes from day to day
// (seeded by the local date) and holds still through the day, so the list
// doesn't reshuffle while the pilot looks at it. None of it is real.

import { practiceRegion as R, type ChartAirport } from '../chart/practiceRegion';
import { parseMetar } from '../lib/metar';
import { parseTaf } from '../lib/taf';
import { parseFb } from '../lib/windsAloft';
import { destination } from '../lib/nav';
import { norm } from '../lib/wind';
import type { TripField, TripInputs, TripRunway } from '../scenarios/trip';
import { addHours, metarText, observedAt, windGroup, zDayHour, zTime } from './practice';

/** A small, fast seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Surface airspace on the practice chart, as its volumes draw it. */
const AIRSPACE: Record<string, TripField['airspace']> = { KXYZ: 'D', KXBB: 'B', KXQC: 'C', KXQA: 'E', KXRB: 'E', '2X5': 'G' };

const pick = <T,>(rnd: () => number, xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

function runwaysOf(a: ChartAirport): TripRunway[] {
  const out: TripRunway[] = [];
  for (let i = 0; i + 1 < a.runways.length; i += 2) {
    const ends = [a.runways[i], a.runways[i + 1]].map((id) => ({ id, headingMag: (parseInt(id, 10) * 10) % 360 || 360 }));
    out.push({ id: `${ends[0].id}/${ends[1].id}`, ends, lengthFt: a.runwayFt, surface: a.surface });
  }
  return out;
}

/** Sky for a field: mostly good days, sometimes a layer, now and then one field under the pilot's line. */
const SKIES: string[][] = [['CLR'], ['FEW060'], ['SCT050'], ['FEW045', 'SCT080'], ['BKN065'], ['SCT035', 'BKN070']];
const LOW_SKIES: string[][] = [['BKN022'], ['OVC018'], ['BKN015', 'OVC030']];

/**
 * Practice trip inputs for the day `now` falls on. `lowFieldIndex` picks
 * which field gets a low ceiling, so most days at least one trip is left out
 * for weather and the pilot sees the filter work.
 */
export function practiceTripInputs(now: Date): TripInputs {
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const rnd = seeded(hash(day));
  const obs = observedAt(now);
  const issued = new Date(obs);
  issued.setUTCMinutes(20, 0, 0);
  if (issued > now) issued.setUTCHours(issued.getUTCHours() - 1);

  const aloftDir = pick(rnd, [240, 270, 290, 310, 340, 20, 60, 90, 120, 180, 210]);
  const aloftKt = 8 + Math.round(rnd() * 20);
  const surfaceKt = 3 + Math.round(rnd() * 9);
  const gust = rnd() < 0.25 ? surfaceKt + 7 + Math.round(rnd() * 6) : null;
  const fields = R.airports.filter((a) => a.id !== 'KXYZ');
  const lowFieldIndex = rnd() < 0.8 ? Math.floor(rnd() * fields.length) : -1;
  const temp = 4 + Math.round(rnd() * 20);

  const field = (a: ChartAirport, i: number): TripField => {
    const sky = i === lowFieldIndex ? pick(rnd, LOW_SKIES) : pick(rnd, SKIES);
    const dir = norm(aloftDir - 20 + Math.round(rnd() * 20));
    const raw = metarText({
      station: a.id, at: obs, wind: { dirTrue: dir, speedKt: surfaceKt + Math.round(rnd() * 3), gustKt: gust },
      vis: '10SM', sky, tempC: temp - Math.round(a.elevationFt / 500), dewC: temp - 8 - Math.round(rnd() * 6), altimeter: 30.02,
    });
    const towered = a.towered;
    let taf = null;
    if (towered) {
      // Towered fields issue a TAF: today's sky, then a change in the afternoon.
      const from = new Date(issued);
      from.setUTCMinutes(0, 0, 0);
      const to = addHours(from, 24);
      const fm = addHours(from, 6 + Math.floor(rnd() * 4));
      const later = i === lowFieldIndex ? pick(rnd, SKIES) : pick(rnd, [...SKIES, ...SKIES, ...LOW_SKIES]);
      const text = [
        'TAF', a.id, zTime(issued), `${zDayHour(from)}/${zDayHour(to)}`,
        windGroup({ dirTrue: dir, speedKt: surfaceKt, gustKt: gust }), 'P6SM', ...sky,
        `FM${zDayHour(fm)}00`, windGroup({ dirTrue: norm(dir + 20), speedKt: surfaceKt + 2 }), 'P6SM', ...later,
      ].join(' ');
      taf = parseTaf(text);
    }
    return {
      id: a.id, name: a.name, pos: a.pos, elevationFt: a.elevationFt, variationDeg: R.variationDeg,
      towered, airspace: AIRSPACE[a.id], runways: runwaysOf(a), metar: parseMetar(raw), taf,
    };
  };

  const homeAirport = R.airports.find((a) => a.id === 'KXYZ')!;
  // Home never gets the low sky: a practice day always lets you leave.
  const home = field(homeAirport, -2);
  const others = fields.map(field);

  // One winds aloft station a little south of home, in FB text.
  const fb = (alt: number, k: number) => ({ dir: norm(aloftDir + k * 10), kt: aloftKt + k * 6, alt });
  const levels = [fb(3000, 0), fb(6000, 1), fb(9000, 2)];
  const group = (l: { dir: number; kt: number; alt: number }, t: number | null) => {
    // FB direction is in tens of degrees, two digits, then two digits of speed.
    const body = `${String(Math.round(l.dir / 10) % 36 || 36).padStart(2, '0')}${String(l.kt).padStart(2, '0')}`;
    return t === null ? body : `${body}${t < 0 ? '-' : '+'}${String(Math.abs(t)).padStart(2, '0')}`;
  };
  const fbText = [
    `VALID ${zDayHour(addHours(issued, 6))}00Z FOR USE 0000-2400Z. PRACTICE DATA`,
    'FT  3000    6000    9000',
    `XYZ ${group(levels[0], null)} ${group(levels[1], temp - 12)} ${group(levels[2], temp - 18)}`,
  ].join('\n');
  const parsed = parseFb(fbText);

  return {
    source: 'practice',
    home,
    fields: others,
    winds: parsed.stations.map((s) => ({ id: s.id, pos: destination(homeAirport.pos, 180, 8), levels: s.levels })),
    fetchedAt: now,
    groundFt: R.groundFt,
  };
}
