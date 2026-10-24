import { parseConditions, flightCategory, type Conditions, type FlightCategory } from './metar';

export type PeriodKind = 'BASE' | 'FM' | 'TEMPO' | 'BECMG' | 'PROB';

/** UTC day of month and hour; minutes only appear in FM groups. */
export interface TafTime {
  day: number;
  hour: number;
  minute: number;
}

export interface TafPeriod extends Conditions {
  kind: PeriodKind;
  probability: number | null;
  from: TafTime | null;
  to: TafTime | null;
  raw: string;
  category: FlightCategory | null;
}

export interface Taf {
  raw: string;
  station: string;
  validFrom: TafTime | null;
  validTo: TafTime | null;
  periods: TafPeriod[];
}

const dh = (s: string): TafTime => ({ day: Number(s.slice(0, 2)), hour: Number(s.slice(2, 4)), minute: 0 });

function parseRange(tok: string | undefined): [TafTime, TafTime] | null {
  const m = /^(\d{4})\/(\d{4})$/.exec(tok ?? '');
  return m ? [dh(m[1]), dh(m[2])] : null;
}

/**
 * Splits a raw TAF into its base forecast and change groups. Change groups
 * carry only what changes, so TEMPO and PROB periods are left partial on
 * purpose; consumers decide how to combine them.
 */
export function parseTaf(raw: string): Taf {
  const clean = raw.trim().replace(/\s+/g, ' ').replace(/=$/, '');
  const tokens = clean.split(' ').filter((t) => !/^RMK$/.test(t));
  let i = 0;
  if (tokens[i] === 'TAF') i++;
  while (tokens[i] === 'AMD' || tokens[i] === 'COR') i++;
  const station = tokens[i++] ?? '';
  if (/^\d{6}Z$/.test(tokens[i] ?? '')) i++;
  const valid = parseRange(tokens[i]);
  if (valid) i++;

  const groups: { kind: PeriodKind; probability: number | null; head: string[]; body: string[] }[] = [
    { kind: 'BASE', probability: null, head: [], body: [] },
  ];
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^FM\d{6}$/.test(t)) {
      groups.push({ kind: 'FM', probability: null, head: [t], body: [] });
    } else if (t === 'TEMPO' || t === 'BECMG') {
      groups.push({ kind: t, probability: null, head: [t], body: [] });
    } else if (/^PROB\d{2}$/.test(t)) {
      const g = { kind: 'PROB' as PeriodKind, probability: Number(t.slice(4)), head: [t], body: [] as string[] };
      if (tokens[i + 1] === 'TEMPO') {
        g.head.push(tokens[++i]);
      }
      groups.push(g);
    } else {
      groups[groups.length - 1].body.push(t);
    }
  }

  const periods: TafPeriod[] = groups.map((g, gi) => {
    let from: TafTime | null = null;
    let to: TafTime | null = null;
    let body = g.body;
    if (g.kind === 'BASE') {
      from = valid?.[0] ?? null;
    } else if (g.kind === 'FM') {
      const s = g.head[0].slice(2);
      from = { day: Number(s.slice(0, 2)), hour: Number(s.slice(2, 4)), minute: Number(s.slice(4, 6)) };
    } else {
      const range = parseRange(body[0]);
      if (range) {
        [from, to] = range;
        body = body.slice(1);
      }
    }
    if (to === null && (g.kind === 'BASE' || g.kind === 'FM')) {
      const nextFm = groups.slice(gi + 1).find((n) => n.kind === 'FM');
      to = nextFm ? parseTafFmTime(nextFm.head[0]) : valid?.[1] ?? null;
    }
    const cond = parseConditions([...body]);
    return {
      kind: g.kind,
      probability: g.probability,
      from,
      to,
      raw: [...g.head, ...g.body].join(' '),
      ...cond,
      category: flightCategory(cond.ceilingFtAgl, cond.visibilitySm),
    };
  });

  return { raw: clean, station, validFrom: valid?.[0] ?? null, validTo: valid?.[1] ?? null, periods };
}

function parseTafFmTime(head: string): TafTime {
  const s = head.slice(2);
  return { day: Number(s.slice(0, 2)), hour: Number(s.slice(2, 4)), minute: Number(s.slice(4, 6)) };
}

/** Hours from a reference UTC date to a TAF time, handling month rollover. */
export function hoursFrom(ref: Date, t: TafTime): number {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), t.day, t.hour, t.minute));
  // A TAF day smaller than today by a lot means next month.
  if (t.day < ref.getUTCDate() - 15) d.setUTCMonth(d.getUTCMonth() + 1);
  if (t.day > ref.getUTCDate() + 15) d.setUTCMonth(d.getUTCMonth() - 1);
  return (d.getTime() - ref.getTime()) / 3_600_000;
}
