// Reads the winds and temperatures aloft forecast (FB, still headed FD on the
// wire) as aviationweather.gov serves it in text. Columns are right-aligned
// under the altitude header and a level a station doesn't forecast is left
// blank, so values are cut by column, not split on spaces.

import type { WindAloft } from '../scenarios/crossCountry';

export interface FbStation {
  /** Three-letter FB station id, such as "BOS". */
  id: string;
  levels: WindAloft[];
}

export interface FbForecast {
  /** Hours of the UTC day the forecast is for use: "FOR USE 1400-2100Z". */
  useFrom: { hour: number; minute: number } | null;
  useTo: { hour: number; minute: number } | null;
  /** The VALID time, day of month and UTC hour. */
  valid: { day: number; hour: number } | null;
  stations: FbStation[];
}

/**
 * One FB group to a wind: "3008" is 300° at 8, "9900" light and variable,
 * and a direction code of 51 to 86 means 100 knots or more ("7315" is 230° at
 * 115). Temperatures follow the wind; above 24,000 ft they are always below
 * zero and carry no sign.
 */
export function parseFbGroup(group: string, altFt: number): WindAloft | null {
  const m = /^(\d{2})(\d{2})([+-]?\d{2})?$/.exec(group.trim());
  if (!m) return null;
  let dir = Number(m[1]);
  let spd = Number(m[2]);
  const temp = m[3] === undefined ? null : altFt > 24000 && !/^[+-]/.test(m[3]) ? -Number(m[3]) : Number(m[3]);
  if (dir === 99 && spd === 0) return { altFt, dirTrue: 0, speedKt: 0, tempC: temp };
  if (dir >= 51 && dir <= 86) {
    dir -= 50;
    spd += 100;
  }
  return { altFt, dirTrue: dir * 10 === 0 ? 360 : dir * 10, speedKt: spd, tempC: temp };
}

export function parseFb(text: string): FbForecast {
  const lines = text.split('\n');
  const use = /FOR USE (\d{2})(\d{2})-(\d{2})(\d{2})Z/.exec(text);
  const valid = /VALID (\d{2})(\d{2})\d{2}Z/.exec(text);
  const out: FbForecast = {
    useFrom: use ? { hour: Number(use[1]), minute: Number(use[2]) } : null,
    useTo: use ? { hour: Number(use[3]), minute: Number(use[4]) } : null,
    valid: valid ? { day: Number(valid[1]), hour: Number(valid[2]) } : null,
    stations: [],
  };
  // A bulletin can carry more than one table; each FT header sets the columns for the lines under it.
  let cols: { altFt: number; end: number }[] = [];
  for (const line of lines) {
    if (/^FT\s+\d/.test(line)) {
      cols = [];
      const re = /\d+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) cols.push({ altFt: Number(m[0]), end: m.index + m[0].length });
      continue;
    }
    const id = cols.length ? /^([A-Z0-9]{3})\s/.exec(line)?.[1] : undefined;
    if (!id) continue;
    const levels: WindAloft[] = [];
    cols.forEach((c, i) => {
      const start = i === 0 ? 4 : cols[i - 1].end;
      const w = parseFbGroup(line.slice(start, c.end), c.altFt);
      if (w) levels.push(w);
    });
    if (levels.length) out.stations.push({ id, levels });
  }
  return out;
}

/**
 * The forecast's VALID time as a date, taking the month and year from `ref`
 * (the time it was fetched) and rolling over a month end.
 */
export function validDate(f: FbForecast, ref: Date): Date | null {
  if (!f.valid) return null;
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), f.valid.day, f.valid.hour));
  if (f.valid.day < ref.getUTCDate() - 15) d.setUTCMonth(d.getUTCMonth() + 1);
  if (f.valid.day > ref.getUTCDate() + 15) d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}
