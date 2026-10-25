// The practice sectional: a made-up piece of country around the practice
// field, KXYZ, with one of everything a private pilot has to read and fly
// around. None of it is a real place. Lessons on the chart, airspace and
// cross-country use it so the geometry is always the same and always labeled
// as practice. Positions are built from bearings and distances so the layout
// reads like a story: Class B to the east, Class C to the north, hills and a
// MOA to the west, a restricted area to the south.

import { destination, distanceNm, type LatLon } from '../lib/nav';
import type { Volume } from '../lib/airspace';

export interface ChartAirport {
  id: string;
  name: string;
  pos: LatLon;
  elevationFt: number;
  towered: boolean;
  /** Longest runway, feet. */
  runwayFt: number;
  surface: 'paved' | 'grass';
  /** Runway ends, magnetic. */
  runways: string[];
  /** Tower, or CTAF for untowered fields. */
  freq: string;
  freqKind: 'Tower' | 'CTAF';
  atis?: string;
  fuel: boolean;
  /** Pattern altitude, MSL. */
  tpaMsl: number;
}

export interface Checkpoint {
  id: string;
  name: string;
  pos: LatLon;
  kind: 'town' | 'lake' | 'highway' | 'river' | 'tower' | 'dam' | 'plant';
  /** What you see from 3,000 ft. */
  looksLike: string;
}

export interface Obstacle {
  id: string;
  pos: LatLon;
  mslFt: number;
  aglFt: number;
  lighted: boolean;
}

export interface Region {
  /** Stable id a figure names the chart by. */
  id: string;
  name: string;
  /** Degrees, positive east. */
  variationDeg: number;
  bounds: { north: number; south: number; east: number; west: number };
  airports: ChartAirport[];
  airspace: Volume[];
  /** Class B primary airports, for the 30 nm Mode C veil. */
  veils: { id: string; center: LatLon }[];
  checkpoints: Checkpoint[];
  obstacles: Obstacle[];
  /** Ground elevation, MSL, at a point. */
  groundFt(p: LatLon): number;
}

const HOME: LatLon = { lat: 42.8, lon: -71.95 };
const at = (brgTrue: number, nm: number, from: LatLon = HOME) => destination(from, brgTrue, nm);

const XBB = at(110, 32);
const XQC = at(340, 25);
const XQA = at(255, 62);
const XRB = at(200, 38);
const MILL = at(290, 14);

/** Hills rise to the west: about 400 ft along the coast plain, 2,600 ft on the ridge. */
function terrainFt(p: LatLon): number {
  const west = Math.min(1, Math.max(0, (-71.75 - p.lon) / 1.1));
  const ridge = Math.exp(-(((p.lat - 42.95) / 0.35) ** 2)) * west;
  return Math.round(350 + 900 * west + 1350 * ridge);
}

/**
 * The terrain, levelled to each field's charted elevation within a mile and
 * blended back over the next two, so heights above the ground agree with the
 * airport data blocks (a Class C shelf 1,200 ft above its field, a pattern
 * 1,000 ft above the runway).
 */
export function levelledGround(terrain: (p: LatLon) => number, fields: ChartAirport[]) {
  return (p: LatLon): number => {
    let g = terrain(p);
    for (const a of fields) {
      const d = distanceNm(p, a.pos);
      if (d >= 3) continue;
      const w = d <= 1 ? 1 : 1 - (d - 1) / 2;
      g = g * (1 - w) + a.elevationFt * w;
    }
    return Math.round(g);
  };
}

/** A box of ±dNs by ±dEw nautical miles around a point, for special use areas. */
export const boxAround = (c: LatLon, dNs: number, dEw: number): LatLon[] => [
  destination(destination(c, 270, dEw), 0, dNs), destination(destination(c, 90, dEw), 0, dNs),
  destination(destination(c, 90, dEw), 180, dNs), destination(destination(c, 270, dEw), 180, dNs),
];
const box = boxAround;

const FIELDS: ChartAirport[] = [
  { id: 'KXYZ', name: 'Practice field', pos: HOME, elevationFt: 600, towered: true, runwayFt: 5500, surface: 'paved', runways: ['06', '24'], freq: '125.10', freqKind: 'Tower', atis: '119.45', fuel: true, tpaMsl: 1600 },
  { id: 'KXBB', name: 'Bayport Intl', pos: XBB, elevationFt: 20, towered: true, runwayFt: 10000, surface: 'paved', runways: ['04L', '22R', '15', '33'], freq: '119.10', freqKind: 'Tower', atis: '135.00', fuel: true, tpaMsl: 1520 },
  { id: 'KXQC', name: 'Quarry County', pos: XQC, elevationFt: 400, towered: true, runwayFt: 7000, surface: 'paved', runways: ['17', '35', '06', '24'], freq: '120.30', freqKind: 'Tower', atis: '128.20', fuel: true, tpaMsl: 1400 },
  { id: 'KXQA', name: 'Quill Valley', pos: XQA, elevationFt: 450, towered: false, runwayFt: 4200, surface: 'paved', runways: ['02', '20'], freq: '122.80', freqKind: 'CTAF', fuel: true, tpaMsl: 1450 },
  { id: 'KXRB', name: 'Ridgeback', pos: XRB, elevationFt: 1100, towered: false, runwayFt: 3400, surface: 'paved', runways: ['14', '32'], freq: '123.00', freqKind: 'CTAF', fuel: false, tpaMsl: 2100 },
  { id: '2X5', name: 'Mill Pond', pos: MILL, elevationFt: 820, towered: false, runwayFt: 2100, surface: 'grass', runways: ['09', '27'], freq: '122.90', freqKind: 'CTAF', fuel: false, tpaMsl: 1820 },
];

export const practiceRegion: Region = {
  id: 'practice',
  name: 'Practice sectional (not a real chart)',
  variationDeg: -14,
  bounds: { north: 43.45, south: 42.15, east: -71.0, west: -73.55 },
  airports: FIELDS,
  airspace: [
    { id: 'xyz-d', name: 'KXYZ Class D', cls: 'D', shape: { kind: 'circle', center: HOME, radiusNm: 4.3 }, floor: 'sfc', ceiling: { ft: 3100, ref: 'msl' }, note: 'Tower 125.10, 0600 to 2200 local. Class E when the tower is closed.' },
    { id: 'xbb-b1', name: 'Bayport Class B, surface area', cls: 'B', shape: { kind: 'circle', center: XBB, radiusNm: 10 }, floor: 'sfc', ceiling: { ft: 10000, ref: 'msl' }, note: 'Bayport Approach 124.75.' },
    { id: 'xbb-b2', name: 'Bayport Class B, 3,000 ft shelf', cls: 'B', shape: { kind: 'ring', center: XBB, innerNm: 10, outerNm: 20 }, floor: { ft: 3000, ref: 'msl' }, ceiling: { ft: 10000, ref: 'msl' } },
    { id: 'xbb-b3', name: 'Bayport Class B, 5,000 ft shelf', cls: 'B', shape: { kind: 'ring', center: XBB, innerNm: 20, outerNm: 27 }, floor: { ft: 5000, ref: 'msl' }, ceiling: { ft: 10000, ref: 'msl' } },
    { id: 'xqc-c1', name: 'Quarry County Class C, surface area', cls: 'C', shape: { kind: 'circle', center: XQC, radiusNm: 5 }, floor: 'sfc', ceiling: { ft: 4400, ref: 'msl' }, note: 'Quarry Approach 118.65.' },
    { id: 'xqc-c2', name: 'Quarry County Class C, shelf', cls: 'C', shape: { kind: 'ring', center: XQC, innerNm: 5, outerNm: 10 }, floor: { ft: 1600, ref: 'msl' }, ceiling: { ft: 4400, ref: 'msl' } },
    { id: 'xqa-e', name: 'Quill Valley Class E from 700 ft', cls: 'E', eKind: '700', shape: { kind: 'circle', center: XQA, radiusNm: 6 }, floor: { ft: 700, ref: 'agl' }, ceiling: { ft: 17999, ref: 'msl' } },
    { id: 'xrb-e', name: 'Ridgeback Class E from 700 ft', cls: 'E', eKind: '700', shape: { kind: 'circle', center: XRB, radiusNm: 5 }, floor: { ft: 700, ref: 'agl' }, ceiling: { ft: 17999, ref: 'msl' } },
    { id: 'granite-moa', name: 'Granite MOA', cls: 'MOA', shape: { kind: 'polygon', points: box(at(300, 45), 10, 12) }, floor: { ft: 7000, ref: 'msl' }, ceiling: { ft: 17999, ref: 'msl' }, note: 'Active 0800 to 2200 local, Monday to Friday. Contact Bayport Center 132.55.' },
    { id: 'r-4101', name: 'R-4101', cls: 'Restricted', shape: { kind: 'polygon', points: box(at(165, 22), 5, 6) }, floor: 'sfc', ceiling: { ft: 6000, ref: 'msl' }, note: 'Active 0700 to 1900 local by NOTAM. Controlling agency Bayport Approach.' },
  ],
  veils: [{ id: 'KXBB', center: XBB }],
  checkpoints: [
    { id: 'harlow', name: 'Harlow', pos: at(255, 18), kind: 'town', looksLike: 'A small town where the highway crosses the river, white church steeple on the east side.' },
    { id: 'long-lake', name: 'Long Lake', pos: at(255, 33), kind: 'lake', looksLike: 'A narrow lake about 4 nm long running north to south, a dam at the south end.' },
    { id: 'pinecrest', name: 'Pinecrest', pos: at(250, 48), kind: 'town', looksLike: 'A town on the ridge with a racetrack oval to the north.' },
    { id: 'tower-1749', name: 'Lighted tower', pos: at(240, 26), kind: 'tower', looksLike: 'A lighted tower 1,749 MSL, 1,150 AGL, two miles south of the course.' },
    { id: 'rt9-river', name: 'Highway 9 bridge', pos: at(200, 15), kind: 'highway', looksLike: 'Where Highway 9 crosses the river on a long bridge.' },
    { id: 'plant', name: 'Power plant', pos: at(120, 14), kind: 'plant', looksLike: 'Two tall stacks on the river, visible from 20 miles.' },
    { id: 'dam', name: 'Quarry dam', pos: at(330, 15), kind: 'dam', looksLike: 'A dam and a reservoir with a quarry pit on the west shore.' },
  ],
  obstacles: [
    { id: 'tower-1749', pos: at(240, 26), mslFt: 1749, aglFt: 1150, lighted: true },
    { id: 'stack-1', pos: at(120, 14), mslFt: 980, aglFt: 610, lighted: true },
  ],
  groundFt: levelledGround(terrainFt, FIELDS),
};

/** The region with volumes added for one lesson, such as a TFR from a NOTAM. */
export function withVolumes(r: Region, extra: Volume[] = []): Region {
  return extra.length ? { ...r, airspace: [...r.airspace, ...extra] } : r;
}

export const chartAirport = (id: string) => practiceRegion.airports.find((a) => a.id === id);

/** Highest ground plus obstacle in a box, rounded up like a maximum elevation figure (MEF). */
export function maxElevationFigure(r: Region, sw: LatLon, ne: LatLon): number {
  let hi = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = { lat: sw.lat + ((ne.lat - sw.lat) * i) / 10, lon: sw.lon + ((ne.lon - sw.lon) * j) / 10 };
      hi = Math.max(hi, r.groundFt(p));
    }
  }
  for (const o of r.obstacles) {
    if (o.pos.lat >= sw.lat && o.pos.lat <= ne.lat && o.pos.lon >= sw.lon && o.pos.lon <= ne.lon) hi = Math.max(hi, o.mslFt);
  }
  // Add 100 ft for unknown obstacles, then round up to the next 100.
  return Math.ceil((hi + 100) / 100) * 100;
}
