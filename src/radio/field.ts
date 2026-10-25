// The practice field on the radio. KXYZ is the towered field on the practice
// sectional (chart/practiceRegion.ts): one runway, 06 and 24, a parallel
// taxiway on each side, and a taxiway, Charlie, that crosses the runway at
// midfield. The main ramp, with the tower and the fuel, is on the north side;
// the flight school ramp is on the south side. None of it is a real airport.
//
// Positions are in feet in a frame laid along the runway: x runs from the
// runway 06 threshold (0) to the runway 24 threshold (5,500), y is positive on
// the north side. Taxi routes are worked out from this layout, so a closed
// taxiway or a ramp on the far side changes the route the controller gives.

import { chartAirport } from '../chart/practiceRegion';
import { norm } from '../lib/wind';

const chart = chartAirport('KXYZ')!;

export type Side = 'north' | 'south';
export type RunwayId = '06' | '24';
export type RampId = 'main' | 'south';

export const FIELD = {
  id: chart.id,
  /** The facility name a pilot calls: "Practice Ground", "Practice Tower". */
  facility: 'Practice',
  elevationFt: chart.elevationFt,
  tpaMsl: chart.tpaMsl,
  lengthFt: chart.runwayFt,
  tower: chart.freq,
  atis: chart.atis ?? '119.45',
  /** Not printed on the practice chart; the practice airport diagram gives it. */
  ground: '121.80',
  /** Class D radius, nm, and ceiling, MSL. */
  classDRadiusNm: 4.3,
  classDCeilingMsl: 3100,
  runways: [
    { id: '06' as RunwayId, headingMag: 60, thresholdX: 0 },
    { id: '24' as RunwayId, headingMag: 240, thresholdX: chart.runwayFt },
  ],
};

export const TAXI_Y = 420;

/** Connectors to the runway, by name. `x` along the runway; `side` the parallel it joins. */
export interface Connector {
  id: string;
  x: number;
  side: Side | 'both';
}

export const CONNECTORS: Connector[] = [
  { id: 'A1', x: 0, side: 'north' },
  { id: 'A2', x: 1800, side: 'north' },
  { id: 'A3', x: 3900, side: 'north' },
  { id: 'A4', x: 5500, side: 'north' },
  { id: 'B1', x: 0, side: 'south' },
  { id: 'B2', x: 1800, side: 'south' },
  { id: 'B3', x: 3900, side: 'south' },
  { id: 'B4', x: 5500, side: 'south' },
  { id: 'C', x: 2750, side: 'both' },
];

export interface Ramp {
  id: RampId;
  /** How the controller names it. */
  name: string;
  /** What a pilot may call it. */
  aliases: string[];
  side: Side;
  x: number;
  /** What is there, for the scene. */
  scene: string;
}

export const RAMPS: Record<RampId, Ramp> = {
  main: {
    id: 'main', name: 'the main ramp', side: 'north', x: 2200,
    aliases: ['main ramp', 'north ramp', 'fbo', 'terminal', 'transient parking', 'fuel pumps', 'self serve', 'tower ramp'],
    scene: 'tied down on the main ramp, north side, in front of the FBO',
  },
  south: {
    id: 'south', name: 'the south ramp', side: 'south', x: 3300,
    aliases: ['south ramp', 'flight school', 'school ramp', 'south tie downs', 'south tiedowns', 'south side'],
    scene: 'on the flight school ramp, south side of the field',
  },
};

export const parallelOf = (side: Side) => (side === 'north' ? 'A' : 'B');
export const otherSide = (side: Side): Side => (side === 'north' ? 'south' : 'north');

/** A closed stretch of a parallel taxiway, as an ATIS or NOTAM gives it. */
export interface Closure {
  side: Side;
  fromX: number;
  toX: number;
  /** "Taxiway Alpha between Alpha 1 and Alpha 2". */
  text: string;
}

export const CLOSURES: Closure[] = [
  { side: 'north', fromX: 0, toX: 1800, text: 'Taxiway Alpha between Alpha 1 and Alpha 2 closed' },
  { side: 'north', fromX: 3900, toX: 5500, text: 'Taxiway Alpha between Alpha 3 and Alpha 4 closed' },
  { side: 'south', fromX: 0, toX: 1800, text: 'Taxiway Bravo between Bravo 1 and Bravo 2 closed' },
  { side: 'south', fromX: 3900, toX: 5500, text: 'Taxiway Bravo between Bravo 3 and Bravo 4 closed' },
];

const overlaps = (c: Closure | null, side: Side, a: number, b: number) =>
  Boolean(c && c.side === side && Math.min(a, b) < c.toX && Math.max(a, b) > c.fromX);

export interface TaxiRoute {
  /** Taxiways in order: ['A'] or ['A', 'C', 'B']. */
  via: string[];
  /** The runway crossed on the way, if any, and where. */
  cross: { runway: RunwayId; at: string } | null;
  /** Where to stop: the hold short point for a departure. */
  holdAt: string | null;
  /** True when the route goes the long way round a closure. */
  aroundClosure: boolean;
}

export const runwayById = (id: RunwayId) => FIELD.runways.find((r) => r.id === id)!;
const endConnector = (side: Side, rwy: RunwayId) => `${parallelOf(side)}${runwayById(rwy).thresholdX === 0 ? 1 : 4}`;

/**
 * The route from a ramp to the departure end of a runway. Down the parallel
 * on the ramp's side; if that stretch is closed, across the runway at Charlie
 * and down the other parallel.
 */
export function departureRoute(ramp: Ramp, rwy: RunwayId, closure: Closure | null): TaxiRoute {
  const end = runwayById(rwy).thresholdX;
  if (!overlaps(closure, ramp.side, ramp.x, end)) {
    return { via: [parallelOf(ramp.side)], cross: null, holdAt: endConnector(ramp.side, rwy), aroundClosure: false };
  }
  const far = otherSide(ramp.side);
  return {
    via: [parallelOf(ramp.side), 'C', parallelOf(far)],
    cross: { runway: rwy, at: 'C' },
    holdAt: endConnector(far, rwy),
    aroundClosure: true,
  };
}

/** Where the airplane turns off after landing. */
export interface Exit {
  connector: string;
  side: Side;
  /** "left" or "right", as the tower says it from the landing direction. */
  turn: 'left' | 'right';
  /** Feet of rollout to get there. */
  rollFt: number;
}

/** Turn direction off a runway toward a side. Landing 24 (westbound), north is to the right. */
export function turnToward(rwy: RunwayId, side: Side): 'left' | 'right' {
  return (rwy === '24') === (side === 'north') ? 'right' : 'left';
}

/** Exits with at least `minRollFt` of rollout, nearest first. */
export function exitsFor(rwy: RunwayId, minRollFt = 2000): Exit[] {
  const start = runwayById(rwy).thresholdX;
  const out: Exit[] = [];
  for (const c of CONNECTORS) {
    const roll = Math.abs(c.x - start);
    if (roll < minRollFt || c.x === 0 || c.x === FIELD.lengthFt) continue;
    const sides: Side[] = c.side === 'both' ? ['north', 'south'] : [c.side];
    for (const side of sides) out.push({ connector: c.id, side, turn: turnToward(rwy, side), rollFt: roll });
  }
  return out.sort((a, b) => a.rollFt - b.rollFt);
}

/** The route from an exit back to a ramp: crosses the runway at Charlie when the ramp is on the far side. */
export function taxiInRoute(exit: Exit, ramp: Ramp, landed: RunwayId): TaxiRoute {
  if (exit.side === ramp.side) return { via: [parallelOf(ramp.side)], cross: null, holdAt: null, aroundClosure: false };
  if (exit.connector === 'C') return { via: ['C', parallelOf(ramp.side)], cross: { runway: landed, at: 'C' }, holdAt: null, aroundClosure: false };
  return { via: [parallelOf(exit.side), 'C', parallelOf(ramp.side)], cross: { runway: landed, at: 'C' }, holdAt: null, aroundClosure: false };
}

/** Taxiway ids a controller might say at this field, in folded form ("a", "a4", "c"). */
export const TAXIWAY_IDS = ['a', 'b', 'c', ...CONNECTORS.map((c) => c.id.toLowerCase())];

/** "A4" as a controller says it: "Alpha 4". */
export function sayTaxiway(id: string): string {
  const names: Record<string, string> = { A: 'Alpha', B: 'Bravo', C: 'Charlie' };
  return `${names[id[0]]}${id.length > 1 ? ` ${id.slice(1)}` : ''}`;
}

export type Compass = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
export const COMPASS: Compass[] = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compassDeg = (c: Compass) => COMPASS.indexOf(c) * 45;

export type Entry = { kind: 'downwind'; side: 'left' | 'right' } | { kind: 'straight-in' };

/**
 * The pattern entry for an airplane arriving from a direction: straight in
 * when it is within 30 degrees of the final approach course, otherwise the
 * downwind on its side of the runway, so it never has to cross over the field.
 */
export function entryFrom(from: Compass, rwy: RunwayId): Entry {
  const h = runwayById(rwy).headingMag;
  const b = compassDeg(from);
  const offFinal = Math.abs(((norm(b - (h + 180)) + 180) % 360) - 180);
  if (offFinal <= 30) return { kind: 'straight-in' };
  // Left traffic flies its downwind on the left of the landing direction.
  return { kind: 'downwind', side: norm(b - h) > 180 ? 'left' : 'right' };
}
