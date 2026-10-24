// Deterministic METAR/TAF token parsing. Everything a scenario scores is
// computed from these parsed values, never from model output.

export type CloudCover = 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';
export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export interface Wind {
  /** Degrees true, or null when variable (VRB) or calm. */
  dirTrue: number | null;
  speedKt: number;
  gustKt: number | null;
  variable: boolean;
  /** Variable-direction range, e.g. 280V340. */
  rangeTrue: [number, number] | null;
}

export interface CloudLayer {
  cover: CloudCover;
  baseFtAgl: number;
  type: 'CB' | 'TCU' | null;
}

export interface Conditions {
  wind: Wind | null;
  visibilitySm: number | null;
  /** True when visibility was reported as P6SM or "greater than". */
  visibilityPlus: boolean;
  weather: string[];
  clouds: CloudLayer[];
  /** Lowest BKN, OVC or VV layer. Null means no ceiling. */
  ceilingFtAgl: number | null;
}

export interface Metar extends Conditions {
  raw: string;
  station: string;
  /** Day of month and UTC time, e.g. { day: 24, hour: 16, minute: 53 }. */
  issued: { day: number; hour: number; minute: number } | null;
  auto: boolean;
  tempC: number | null;
  dewpointC: number | null;
  altimeterInHg: number | null;
  remarks: string | null;
  category: FlightCategory | null;
}

const WIND_RE = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/;
const WIND_RANGE_RE = /^(\d{3})V(\d{3})$/;
const CLOUD_RE = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/;
const WX_RE = /^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$|^(TS|SH)$/;

function parseFraction(s: string): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) / Number(m[2]);
  return /^\d+$/.test(s) ? Number(s) : null;
}

/**
 * Parses the weather groups shared by METARs and TAF periods. Consumes tokens
 * from the array it is given and ignores anything it does not recognize.
 */
export function parseConditions(tokens: string[]): Conditions {
  const out: Conditions = {
    wind: null,
    visibilitySm: null,
    visibilityPlus: false,
    weather: [],
    clouds: [],
    ceilingFtAgl: null,
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const w = WIND_RE.exec(t);
    if (w) {
      const toKt = w[4] === 'MPS' ? 1.94384 : 1;
      const speed = Math.round(Number(w[2]) * toKt);
      const calm = w[1] === '000' && speed === 0;
      out.wind = {
        dirTrue: w[1] === 'VRB' || calm ? null : Number(w[1]),
        speedKt: speed,
        gustKt: w[3] ? Math.round(Number(w[3]) * toKt) : null,
        variable: w[1] === 'VRB',
        rangeTrue: null,
      };
      continue;
    }
    const r = WIND_RANGE_RE.exec(t);
    if (r && out.wind) {
      out.wind.rangeTrue = [Number(r[1]), Number(r[2])];
      continue;
    }
    // Visibility: "10SM", "P6SM", "M1/4SM", "1/2SM", or "1 1/2SM" across two tokens.
    if (/SM$/.test(t)) {
      let body = t.slice(0, -2);
      if (body.startsWith('P')) {
        out.visibilityPlus = true;
        body = body.slice(1);
      }
      if (body.startsWith('M')) body = body.slice(1);
      let v = parseFraction(body);
      if (v !== null && i > 0 && /^\d+$/.test(tokens[i - 1]) && body.includes('/')) {
        v += Number(tokens[i - 1]);
      }
      if (v !== null) out.visibilitySm = v;
      continue;
    }
    if (t === 'CAVOK') {
      out.visibilitySm = 6;
      out.visibilityPlus = true;
      continue;
    }
    const c = CLOUD_RE.exec(t);
    if (c) {
      if (c[2] === '///') continue;
      out.clouds.push({
        cover: c[1] as CloudCover,
        baseFtAgl: Number(c[2]) * 100,
        type: (c[3] as 'CB' | 'TCU' | undefined) ?? null,
      });
      continue;
    }
    if (WX_RE.test(t)) out.weather.push(t);
  }
  const ceilings = out.clouds
    .filter((l) => l.cover === 'BKN' || l.cover === 'OVC' || l.cover === 'VV')
    .map((l) => l.baseFtAgl);
  out.ceilingFtAgl = ceilings.length ? Math.min(...ceilings) : null;
  return out;
}

/** FAA flight category from ceiling and visibility (AIM 7-1-7 / AWC definitions). */
export function flightCategory(ceilingFtAgl: number | null, visibilitySm: number | null): FlightCategory | null {
  if (visibilitySm === null && ceilingFtAgl === null) return null;
  const ceil = ceilingFtAgl ?? Infinity;
  const vis = visibilitySm ?? Infinity;
  if (ceil < 500 || vis < 1) return 'LIFR';
  if (ceil < 1000 || vis < 3) return 'IFR';
  if (ceil <= 3000 || vis <= 5) return 'MVFR';
  return 'VFR';
}

export function parseMetar(raw: string): Metar {
  const clean = raw.trim().replace(/\s+/g, ' ').replace(/=$/, '');
  const [body, remarks] = clean.split(/ RMK /);
  const tokens = body.split(' ');
  let idx = 0;
  if (tokens[idx] === 'METAR' || tokens[idx] === 'SPECI') idx++;
  const station = tokens[idx++] ?? '';
  let issued: Metar['issued'] = null;
  const time = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[idx] ?? '');
  if (time) {
    issued = { day: Number(time[1]), hour: Number(time[2]), minute: Number(time[3]) };
    idx++;
  }
  let auto = false;
  while (tokens[idx] === 'AUTO' || tokens[idx] === 'COR') {
    if (tokens[idx] === 'AUTO') auto = true;
    idx++;
  }
  const rest = tokens.slice(idx);
  const cond = parseConditions(rest);

  let tempC: number | null = null;
  let dewpointC: number | null = null;
  let altimeterInHg: number | null = null;
  for (const t of rest) {
    const td = /^(M?\d{2})\/(M?\d{2})?$/.exec(t);
    if (td) {
      const n = (s: string) => (s.startsWith('M') ? -Number(s.slice(1)) : Number(s));
      tempC = n(td[1]);
      dewpointC = td[2] ? n(td[2]) : null;
    }
    const a = /^A(\d{4})$/.exec(t);
    if (a) altimeterInHg = Number(a[1]) / 100;
    const q = /^Q(\d{4})$/.exec(t);
    if (q) altimeterInHg = Math.round((Number(q[1]) / 33.8639) * 100) / 100;
  }

  return {
    raw: clean,
    station,
    issued,
    auto,
    ...cond,
    tempC,
    dewpointC,
    altimeterInHg,
    remarks: remarks ?? null,
    category: flightCategory(cond.ceilingFtAgl, cond.visibilitySm),
  };
}
