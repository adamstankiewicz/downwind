// Airspace: which class you are in at a point and altitude, what it takes to
// be there, and the basic VFR weather minimums that apply (14 CFR 91.155).
// The shapes are simplified to circles, rings and polygons, which is how a
// sectional draws them; the rules are the regulations, not a simplification.

import { distanceNm, type LatLon } from './nav';

export type AirspaceClass = 'B' | 'C' | 'D' | 'E' | 'G';
export type SpecialUse = 'MOA' | 'Restricted' | 'Prohibited' | 'Alert' | 'Warning' | 'TFR';

export type Shape =
  | { kind: 'circle'; center: LatLon; radiusNm: number }
  | { kind: 'ring'; center: LatLon; innerNm: number; outerNm: number }
  | { kind: 'polygon'; points: LatLon[] };

/** A floor or ceiling. `agl` floors follow the ground; `sfc` is the surface. */
export type Limit = { ft: number; ref: 'msl' | 'agl' } | 'sfc';

export interface Volume {
  id: string;
  name: string;
  /** Controlled airspace class, or a special use area. */
  cls: AirspaceClass | SpecialUse;
  /** For class E: a surface area, a 700 ft AGL transition area, or the default. */
  eKind?: 'surface' | '700';
  shape: Shape;
  floor: Limit;
  ceiling: Limit;
  /** Words from the chart: hours, controlling agency, frequency. */
  note?: string;
}

export function inShape(p: LatLon, s: Shape): boolean {
  if (s.kind === 'circle') return distanceNm(p, s.center) <= s.radiusNm;
  if (s.kind === 'ring') {
    const d = distanceNm(p, s.center);
    return d > s.innerNm && d <= s.outerNm;
  }
  // Ray casting on lat/lon is fine over the size of a practice area.
  let inside = false;
  const pts = s.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

export function limitMsl(l: Limit, groundFt: number): number {
  if (l === 'sfc') return groundFt;
  return l.ref === 'agl' ? groundFt + l.ft : l.ft;
}

/** True when the altitude is at or above the floor and at or below the ceiling. */
export function inVolume(v: Volume, p: LatLon, altMsl: number, groundFt: number): boolean {
  if (!inShape(p, v.shape)) return false;
  return altMsl >= limitMsl(v.floor, groundFt) && altMsl <= limitMsl(v.ceiling, groundFt);
}

export interface Position {
  /** The controlled class you are in. */
  cls: AirspaceClass;
  /** The volume that makes it that class, if one is charted. */
  volume?: Volume;
  /** Special use areas you are inside. */
  special: Volume[];
  /** Inside a Mode C veil (30 nm of a Class B primary airport). */
  modeCVeil: boolean;
}

const RANK: AirspaceClass[] = ['B', 'C', 'D', 'E'];

/**
 * Class at a point. Charted B, C and D win in that order; charted E surface
 * and 700 ft areas come next; above 1,200 ft AGL or at 14,500 MSL and up it is
 * E anyway; everything else is G.
 */
export function positionAt(volumes: Volume[], p: LatLon, altMsl: number, groundFt: number, veils: { center: LatLon }[] = []): Position {
  const inside = volumes.filter((v) => inVolume(v, p, altMsl, groundFt));
  const special = inside.filter((v) => !RANK.includes(v.cls as AirspaceClass));
  const modeCVeil = veils.some((v) => distanceNm(p, v.center) <= 30) && altMsl <= 10000;
  for (const c of RANK) {
    const v = inside.find((x) => x.cls === c);
    if (v) return { cls: c, volume: v, special, modeCVeil };
  }
  if (altMsl - groundFt >= 1200 || altMsl >= 14500) return { cls: 'E', special, modeCVeil };
  return { cls: 'G', special, modeCVeil };
}

export interface Requirement {
  id: string;
  text: string;
  ref: string;
}

/** What it takes to be in this airspace in a VFR airplane. */
export function requirements(pos: Position, altMsl: number): Requirement[] {
  const out: Requirement[] = [];
  switch (pos.cls) {
    case 'B':
      out.push({ id: 'b-clearance', text: 'An ATC clearance before you enter ("cleared into the Class Bravo")', ref: '14 CFR 91.131' });
      out.push({ id: 'b-cert', text: 'A private pilot certificate, or a student with the specific endorsements', ref: '14 CFR 91.131' });
      out.push({ id: 'xpdr', text: 'A Mode C transponder and ADS-B Out', ref: '14 CFR 91.215, 91.225' });
      out.push({ id: 'radio', text: 'Two-way radio', ref: '14 CFR 91.131' });
      break;
    case 'C':
      out.push({ id: 'c-comm', text: 'Two-way radio communication established before you enter: ATC says your call sign back', ref: '14 CFR 91.130' });
      out.push({ id: 'xpdr', text: 'A Mode C transponder and ADS-B Out', ref: '14 CFR 91.215, 91.225' });
      break;
    case 'D':
      out.push({ id: 'd-comm', text: 'Two-way radio communication established with the tower before you enter', ref: '14 CFR 91.129' });
      break;
    default:
      break;
  }
  if (pos.cls !== 'B' && pos.cls !== 'C' && (pos.modeCVeil || altMsl >= 10000)) {
    out.push({ id: 'xpdr', text: pos.modeCVeil ? 'A Mode C transponder and ADS-B Out inside the 30 nm veil' : 'A Mode C transponder and ADS-B Out at 10,000 MSL and above', ref: '14 CFR 91.215, 91.225' });
  }
  for (const s of pos.special) {
    if (s.cls === 'Restricted') out.push({ id: `sua-${s.id}`, text: `${s.name}: stay out while it is active unless the controlling agency clears you`, ref: '14 CFR 91.133' });
    if (s.cls === 'Prohibited') out.push({ id: `sua-${s.id}`, text: `${s.name}: prohibited, no entry`, ref: '14 CFR 91.133' });
    if (s.cls === 'TFR') out.push({ id: `sua-${s.id}`, text: `${s.name}: temporary flight restriction, entry only as the NOTAM allows`, ref: '14 CFR 91.137' });
    if (s.cls === 'MOA') out.push({ id: `sua-${s.id}`, text: `${s.name}: legal to cross VFR, but call for traffic while it is active`, ref: 'AIM 3-4-5' });
  }
  return out;
}

export interface VfrMinimums {
  visibilitySm: number;
  /** Feet below, above, and nm horizontal from clouds; null means clear of clouds. */
  clouds: { belowFt: number; aboveFt: number; horizontal: string } | null;
  ref: string;
}

const STD = { belowFt: 500, aboveFt: 1000, horizontal: '2,000 ft' };
const HIGH = { belowFt: 1000, aboveFt: 1000, horizontal: '1 SM' };

/** Basic VFR weather minimums, 14 CFR 91.155(a). */
export function vfrMinimums(cls: AirspaceClass, altMsl: number, groundFt: number, night: boolean): VfrMinimums {
  const agl = altMsl - groundFt;
  const ref = '14 CFR 91.155(a)';
  if (cls === 'B') return { visibilitySm: 3, clouds: null, ref };
  if (cls === 'C' || cls === 'D') return { visibilitySm: 3, clouds: STD, ref };
  if (cls === 'E') return altMsl >= 10000 ? { visibilitySm: 5, clouds: HIGH, ref } : { visibilitySm: 3, clouds: STD, ref };
  // Class G.
  if (altMsl >= 10000 && agl > 1200) return { visibilitySm: 5, clouds: HIGH, ref };
  if (agl <= 1200) return night ? { visibilitySm: 3, clouds: STD, ref } : { visibilitySm: 1, clouds: null, ref };
  return night ? { visibilitySm: 3, clouds: STD, ref } : { visibilitySm: 1, clouds: STD, ref };
}
