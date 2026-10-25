// Airport operations as rules a pilot can check: what a taxi clearance does
// and doesn't cover, what the tower's light gun means, who has the right of
// way, and where a big airplane's wake goes. Every rule names its source in
// 14 CFR part 91 or the AIM; grades come from these functions, never from the
// lesson copy.

import type { Grade } from '../scenarios/goNoGo';

// ---------------------------------------------------------------- taxi and signs

/**
 * Airport signs by the job they do (AIM 2-3-7 to 2-3-11). Mandatory instruction signs
 * are white on red and mean "do not go past without a clearance". Location
 * signs are yellow on black and say where you are. Direction and destination
 * signs are black on yellow and say where a taxiway goes.
 */
export type SignKind = 'mandatory' | 'location' | 'direction' | 'destination' | 'ils' | 'no-entry';

export interface AirportSign {
  kind: SignKind;
  text: string;
  /** Direction signs carry an arrow, in degrees from straight ahead. */
  arrowDeg?: number;
}

export const SIGN_MEANS: Record<SignKind, string> = {
  mandatory: 'A runway holding position: stop here unless cleared onto or across the runway (AIM 2-3-8).',
  location: 'The taxiway or runway you are on (AIM 2-3-9).',
  direction: 'Where the intersecting taxiways go, with arrows (AIM 2-3-10).',
  destination: 'The way to a place on the field, such as a runway or the ramp (AIM 2-3-11).',
  ils: 'The ILS critical area boundary: hold here only when ATC tells you to (AIM 2-3-8).',
  'no-entry': 'Aircraft may not enter this area (AIM 2-3-8).',
};

/** What happens on the way to the runway, and so what the pilot has to do. */
export type TaxiSituation =
  /** A runway on the route. `crossingCleared` is an explicit "cross runway ..." in the clearance. */
  | { kind: 'runway-crossing'; runway: string; crossingCleared: boolean }
  /** The ILS critical area sign before the departure runway. */
  | { kind: 'ils-hold'; toldToHold: boolean }
  /** The sign says something other than where you meant to be. */
  | { kind: 'lost' };

export type TaxiOption = 'continue' | 'stop-call' | 'stop-wait' | 'look-go';

/**
 * Grades for the choice at a sign. A taxi clearance to a runway does not
 * authorize crossing any runway on the way: each crossing needs its own
 * explicit clearance (AIM 4-3-18, 91.129(i)). The ILS critical area is
 * only a holding point when ATC says so. A pilot who is unsure where they are
 * stops and says so, and asks for progressive taxi (AIM 4-3-18).
 */
export function gradeTaxi(s: TaxiSituation): Record<TaxiOption, Grade> {
  if (s.kind === 'runway-crossing') {
    // Cleared across, the best crossing still starts with a look both ways and down the final approach.
    return s.crossingCleared
      ? { continue: 'acceptable', 'stop-call': 'acceptable', 'stop-wait': 'marginal', 'look-go': 'best' }
      : { continue: 'unsafe', 'stop-call': 'best', 'stop-wait': 'acceptable', 'look-go': 'unsafe' };
  }
  if (s.kind === 'ils-hold') {
    return s.toldToHold
      ? { continue: 'unsafe', 'stop-call': 'acceptable', 'stop-wait': 'best', 'look-go': 'unsafe' }
      : { continue: 'best', 'stop-call': 'marginal', 'stop-wait': 'marginal', 'look-go': 'acceptable' };
  }
  return { continue: 'unsafe', 'stop-call': 'best', 'stop-wait': 'acceptable', 'look-go': 'unsafe' };
}

// ---------------------------------------------------------------- light gun signals

export type LightSignal = 'steady-green' | 'flashing-green' | 'steady-red' | 'flashing-red' | 'flashing-white' | 'alternating';

export const LIGHT_NAMES: Record<LightSignal, string> = {
  'steady-green': 'Steady green',
  'flashing-green': 'Flashing green',
  'steady-red': 'Steady red',
  'flashing-red': 'Flashing red',
  'flashing-white': 'Flashing white',
  alternating: 'Alternating red and green',
};

/** 14 CFR 91.125 and AIM 4-3-13: the meaning depends on whether you are on the ground or in the air. */
export const LIGHT_MEANS: Record<LightSignal, { ground: string; air: string }> = {
  'steady-green': { ground: 'Cleared for takeoff', air: 'Cleared to land' },
  'flashing-green': { ground: 'Cleared to taxi', air: 'Return for landing (to be followed by steady green at the proper time)' },
  'steady-red': { ground: 'Stop', air: 'Give way to other aircraft and continue circling' },
  'flashing-red': { ground: 'Taxi clear of the runway in use', air: 'Airport unsafe, do not land' },
  'flashing-white': { ground: 'Return to starting point on airport', air: 'Not used in flight' },
  alternating: { ground: 'Exercise extreme caution', air: 'Exercise extreme caution' },
};

export type LightOption = 'land' | 'circle' | 'divert' | 'radio';

/**
 * Grades for what to do on final with the radio dead and the tower showing a
 * light. Fiddling with the radio on short final instead of flying the
 * airplane is never the answer: the light already said what to do.
 */
export function gradeLightOnFinal(signal: LightSignal): Record<LightOption, Grade> {
  switch (signal) {
    case 'steady-green':
      return { land: 'best', circle: 'marginal', divert: 'marginal', radio: 'marginal' };
    case 'steady-red':
      return { land: 'unsafe', circle: 'best', divert: 'acceptable', radio: 'marginal' };
    case 'flashing-red':
      return { land: 'unsafe', circle: 'marginal', divert: 'best', radio: 'marginal' };
    case 'flashing-green':
      return { land: 'marginal', circle: 'best', divert: 'marginal', radio: 'marginal' };
    case 'alternating':
      return { land: 'acceptable', circle: 'best', divert: 'acceptable', radio: 'marginal' };
    default:
      return { land: 'unsafe', circle: 'best', divert: 'acceptable', radio: 'marginal' };
  }
}

// ---------------------------------------------------------------- right of way

/** Categories in 91.113(d), least maneuverable first. */
export type Craft = 'balloon' | 'glider' | 'towing' | 'airship' | 'airplane' | 'rotorcraft';

const RANK: Record<Craft, number> = { balloon: 0, glider: 1, towing: 2, airship: 3, airplane: 4, rotorcraft: 4 };

export type Encounter =
  | { kind: 'converging'; you: Craft; other: Craft; otherOn: 'left' | 'right' }
  | { kind: 'head-on' }
  | { kind: 'overtaking'; youAre: 'overtaking' | 'overtaken' }
  | { kind: 'landing'; youLower: boolean; otherOnFinal: boolean }
  | { kind: 'distress'; who: 'you' | 'other' };

export interface RightOfWay {
  /** Who has it. `both` means both give way, as head-on. */
  has: 'you' | 'other' | 'both';
  rule: string;
  /** What the pilot without it does. */
  action: string;
}

/** 14 CFR 91.113, in the order it applies: distress, category, then geometry. */
export function rightOfWay(e: Encounter): RightOfWay {
  switch (e.kind) {
    case 'distress':
      return { has: e.who, rule: '91.113(c): an aircraft in distress has the right of way over all other traffic.', action: 'Give it all the room it needs.' };
    case 'head-on':
      return { has: 'both', rule: '91.113(e): approaching head-on, each pilot alters course to the right.', action: 'Turn right.' };
    case 'overtaking':
      return e.youAre === 'overtaken'
        ? { has: 'you', rule: '91.113(f): the aircraft being overtaken has the right of way.', action: 'Hold your course; the other pilot passes well clear on your right.' }
        : { has: 'other', rule: '91.113(f): the aircraft being overtaken has the right of way, and the one overtaking alters course to the right to pass well clear.', action: 'Pass well clear, on its right.' };
    case 'landing':
      if (e.otherOnFinal) {
        return { has: 'other', rule: '91.113(g): aircraft on final approach to land, or landing, have the right of way over aircraft in flight or on the surface.', action: 'Extend and follow it; don\'t cut in front.' };
      }
      return e.youLower
        ? { has: 'you', rule: '91.113(g): when two aircraft approach to land, the lower one has the right of way, but may not take advantage of it to cut in front of one on final or to overtake it.', action: 'Land, without cutting in front of anyone on final.' }
        : { has: 'other', rule: '91.113(g): when two aircraft approach to land, the lower one has the right of way.', action: 'Give way to the lower aircraft.' };
    case 'converging': {
      if (RANK[e.you] !== RANK[e.other]) {
        const you = RANK[e.you] < RANK[e.other];
        return {
          has: you ? 'you' : 'other',
          rule: '91.113(d): converging aircraft of different categories: balloons, then gliders, then aircraft towing or refueling, then airships, then airplanes and rotorcraft. The less maneuverable one has the right of way, whichever side it is on.',
          action: you ? 'Hold your course and keep watching.' : 'Give way: pass behind it, well clear.',
        };
      }
      return e.otherOn === 'right'
        ? { has: 'other', rule: '91.113(d): converging aircraft of the same category: the aircraft to the other\'s right has the right of way.', action: 'Give way: pass behind it, well clear. Don\'t pass over, under or ahead unless well clear (91.113(b)).' }
        : { has: 'you', rule: '91.113(d): converging aircraft of the same category: the aircraft to the other\'s right has the right of way.', action: 'Hold your course, and keep watching in case they haven\'t seen you.' };
    }
  }
}

// ---------------------------------------------------------------- wake turbulence

/** What the large airplane ahead is doing on the same runway. */
export type WakeLeader = 'departed' | 'landed';

export interface WakeSituation {
  /** You are taking off or landing behind it. */
  you: 'takeoff' | 'landing';
  leader: WakeLeader;
  /** Feet from the threshold where it lifted off, or touched down. */
  leaderPointFt: number;
  runwayFt: number;
  /** Your takeoff distance over 50 ft, or landing distance over 50 ft, from the book with a margin. */
  yourDistanceFt: number;
  /** Light quartering tailwind or light crosswind, when vortices linger on the runway. */
  lingering: boolean;
}

export type WakeOption = 'go-now' | 'past-point' | 'wait' | 'before-point';

/**
 * AIM 7-4-6. Vortices begin at rotation and end at touchdown, and they sink
 * and drift with the wind. Taking off behind a departure: lift off before its
 * rotation point and climb above its path, which a light trainer can't do
 * behind a jet, so wait. Taking off behind a landing: lift off past its
 * touchdown point, if the runway beyond it is long enough. Landing behind a
 * landing: stay above its path and touch down beyond its touchdown point.
 * Landing behind a departure: touch down well before its rotation point.
 * A light quartering tailwind or light crosswind keeps them on the runway.
 */
export function gradeWake(s: WakeSituation): Record<WakeOption, Grade> {
  const beyond = s.runwayFt - s.leaderPointFt;
  const fitsBeyond = beyond >= s.yourDistanceFt;
  const fitsBefore = s.leaderPointFt >= s.yourDistanceFt;
  if (s.you === 'takeoff' && s.leader === 'departed') {
    // A light airplane can't out-climb a jet's path, so rotating early is the textbook answer for large airplanes, not this one.
    return { 'go-now': 'unsafe', 'past-point': 'unsafe', wait: 'best', 'before-point': 'marginal' };
  }
  if (s.you === 'takeoff' && s.leader === 'landed') {
    return { 'go-now': 'unsafe', 'past-point': fitsBeyond ? 'best' : 'unsafe', wait: fitsBeyond ? 'acceptable' : 'best', 'before-point': 'unsafe' };
  }
  if (s.you === 'landing' && s.leader === 'landed') {
    return { 'go-now': 'unsafe', 'past-point': fitsBeyond ? 'best' : 'unsafe', wait: fitsBeyond ? 'acceptable' : 'best', 'before-point': 'unsafe' };
  }
  // Landing behind a departure.
  return { 'go-now': s.lingering ? 'marginal' : 'acceptable', 'past-point': 'unsafe', wait: 'acceptable', 'before-point': fitsBefore ? 'best' : 'unsafe' };
}
