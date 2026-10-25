// Radio practice flights at the practice field. A flight is a short story told
// on the radio: the ATIS, the call to Ground, the taxi readback, the call to
// Tower, the pattern, and home again. Each flight is built from a seed, so the
// ATIS code, the wind and the runway, the ramp, a closed taxiway, the traffic
// and what the controller says all change from one flight to the next, while
// every transmission and every grade is worked out by code from the same
// facts (field.ts, grade.ts). Nothing here is a real airport, controller or
// aircraft; the pilot's own tail number is used when they have entered one.

import type { AircraftProfile } from '../data/aircraft';
import type { Grade } from '../scenarios/goNoGo';
import { bestRunway, norm } from '../lib/wind';
import { SAY_LETTER } from './phrase';
import {
  CLOSURES, COMPASS, FIELD, RAMPS, compassDeg, departureRoute, entryFrom, exitsFor, runwayById, sayTaxiway, taxiInRoute,
  type Closure, type Compass, type Entry, type Exit, type Ramp, type RunwayId, type TaxiRoute,
} from './field';
import type { Item } from './grade';

export type Mission = 'pattern' | 'depart' | 'arrive';

export const MISSIONS: { id: Mission; title: string; summary: string }[] = [
  { id: 'pattern', title: 'Pattern work', summary: 'Ramp to runway, takeoff, closed traffic, a full stop and the taxi back.' },
  { id: 'depart', title: 'Depart the area', summary: 'Ramp to runway, takeoff with a turn on course, and leaving the tower frequency.' },
  { id: 'arrive', title: 'Come home', summary: 'Call the tower from outside the Class D, enter the pattern, land and taxi in.' },
];

export interface Callsign {
  /** Folded, without the N: "52xy". */
  full: string;
  /** The last three, as a controller shortens it: "2xy". */
  short: string;
  /** As written in a transmission: "Cessna 52XY". */
  sayFull: string;
  sayShort: string;
  /** True when it is the made-up practice tail, not the pilot's own. */
  practice: boolean;
}

export interface Freq {
  name: string;
  mhz: string;
}

export interface Atis {
  letter: string;
  /** "Echo". */
  word: string;
  timeZ: string;
  windMag: number | null;
  windKt: number;
  gustKt: number | null;
  visSm: number;
  sky: string;
  tempC: number;
  dewC: number;
  /** "30.08". */
  altimeter: string;
  runway: RunwayId;
  closure: Closure | null;
  notice: string | null;
  /** The broadcast, as heard. */
  text: string;
}

/** A line on the ATIS copy pad. Checked by `checkCopy`. */
export interface CopyField {
  id: 'letter' | 'runway' | 'altimeter' | 'wind';
  label: string;
  /** What a right answer looks like, shown after checking. */
  answer: string;
  choices?: string[];
  placeholder?: string;
}

export type Event =
  | { kind: 'atis'; id: string; title: string; situation: string; freq: Freq; atis: Atis; fields: CopyField[] }
  | {
      kind: 'transmit';
      id: string;
      title: string;
      /** What is happening now, in the instructor's words. */
      situation: string;
      freq: Freq;
      /** What the controller just said, when this is a readback or an answer. */
      atc: string | null;
      items: Item[];
      /** A good call, built from the same facts. */
      model: string;
      /** The instructor's note on this call, for the debrief. */
      why: string;
    }
  | {
      kind: 'decide';
      id: string;
      title: string;
      situation: string;
      options: { id: string; label: string }[];
      grades: Record<string, Grade>;
      consequence: Record<string, string>;
      why: string;
    };

export interface RadioFlight {
  seed: number;
  mission: Mission;
  title: string;
  callsign: Callsign;
  atis: Atis;
  ramp: Ramp;
  events: Event[];
  /** Where the pilot can read more. Labels resolve through refs/resolve.ts. */
  refs: string[];
  acs: string[];
}

/** A small seeded generator, so a flight can be flown again exactly. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

/** The pilot's own tail number when it is a valid N-number, otherwise a practice one. */
export function callsignFor(aircraft: AircraftProfile | null): Callsign {
  const tail = (aircraft?.tailNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = tail.match(/^N?([1-9][0-9A-Z]{1,4})$/);
  const body = m ? m[1] : '52XY';
  const word = (aircraft?.type ?? '').trim().split(/\s+/)[0] ?? '';
  const prefix = /^[A-Za-z]{3,}$/.test(word) ? word[0].toUpperCase() + word.slice(1) : 'November';
  const short = body.length > 3 ? body.slice(-3) : body;
  return { full: body.toLowerCase(), short: short.toLowerCase(), sayFull: `${prefix} ${body}`, sayShort: `${prefix} ${short}`, practice: !m };
}

const NOTICES = [
  'Bird activity in the vicinity of the airport',
  'Crane 200 feet above ground level one mile northeast of the field',
  'Parachute jumping 10 miles west of the field, surface to 10,000',
  'Read back all runway hold short instructions',
];
const ABBREV: Partial<Record<Compass, string>> = { northeast: 'ne', southeast: 'se', southwest: 'sw', northwest: 'nw' };
const TRAFFIC = ['a Cherokee', 'a Skylane', 'a Bonanza', 'a Diamond', 'an Archer', 'a Mooney'];

const p2 = (n: number) => String(n).padStart(2, '0');
const say3 = (deg: number) => String(deg || 360).padStart(3, '0');

export function buildAtis(r: Rng, now: Date, ramp: Ramp): Atis {
  const runway: RunwayId = r.pick(['06', '24'] as const);
  const calm = r.chance(0.12);
  const windKt = calm ? 0 : r.int(4, 14);
  const gustKt = !calm && windKt >= 9 && r.chance(0.35) ? windKt + r.int(6, 9) : null;
  // A wind that favors the runway in use, from up to 60 degrees either side of it.
  const h = runwayById(runway).headingMag;
  const windMag = calm ? null : Math.round(norm(h + r.int(-6, 6) * 10) / 10) * 10 || 360;
  // The engine agrees on the runway; a calm wind uses the calm wind runway, 24.
  const inUse: RunwayId = windMag === null ? '24' : bestRunway(FIELD.runways, windMag, windKt).id;
  const letter = r.pick('DEFGHIJKLMOPQRSTUVW'.split('')).toLowerCase();
  const word = SAY_LETTER[letter];
  const tempC = r.int(2, 26);
  const dewC = tempC - r.int(2, 14);
  const altimeter = (29.8 + r.int(0, 45) / 100).toFixed(2);
  const sky = r.pick(['Sky clear', `Few clouds at ${(r.int(35, 70) * 100).toLocaleString('en-US')}`, `Scattered clouds at ${(r.int(40, 65) * 100).toLocaleString('en-US')}`, `Ceiling ${(r.int(45, 80) * 100).toLocaleString('en-US')} broken`]);
  const visSm = r.pick([10, 10, 10, 8, 7]);
  // About a third of flights have a closed stretch of taxiway, often on the pilot's way.
  const onTheWay = CLOSURES.filter((c) => departureRoute(ramp, inUse, c).aroundClosure);
  const closure = r.chance(0.35) ? (onTheWay.length && r.chance(0.7) ? r.pick(onTheWay) : r.pick(CLOSURES)) : null;
  const notice = r.chance(0.5) ? r.pick(NOTICES) : null;
  const obs = new Date(now);
  if (obs.getUTCMinutes() < 53) obs.setUTCHours(obs.getUTCHours() - 1);
  const timeZ = `${p2(obs.getUTCHours())}53`;
  const windText = windMag === null ? 'Wind calm' : `Wind ${say3(windMag)} at ${windKt}${gustKt ? ` gust ${gustKt}` : ''}`;
  const text = [
    `Practice field information ${word}, ${timeZ} Zulu.`,
    `${windText}.`,
    `Visibility ${visSm}.`,
    `${sky}.`,
    `Temperature ${tempC}, dew point ${dewC}.`,
    `Altimeter ${altimeter}.`,
    `Landing and departing runway ${inUse}.`,
    closure ? `Notice to air missions: ${closure.text}.` : '',
    notice ? `${notice}.` : '',
    `Advise on initial contact you have information ${word}.`,
  ].filter(Boolean).join(' ');
  return { letter, word, timeZ, windMag, windKt, gustKt, visSm, sky, tempC, dewC, altimeter, runway: inUse, closure, notice, text };
}

/** Checks one line of the ATIS copy pad. Letters may be typed as the letter or the word. */
export function checkCopy(f: CopyField, atis: Atis, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  switch (f.id) {
    case 'letter': return v === atis.letter || v === atis.word.toLowerCase();
    case 'runway': return v.replace(/^0/, '') === atis.runway.replace(/^0/, '');
    case 'altimeter': {
      const n = Number(v.replace(/[^\d.]/g, ''));
      return n === Number(atis.altimeter) || n === Number(atis.altimeter) * 100;
    }
    case 'wind': {
      if (atis.windMag === null) return /calm|^0+$/.test(v);
      const m = v.match(/(\d{2,3})\D+(\d{1,2})/) ?? v.match(/^(\d{3})(\d{2})/);
      if (!m) return false;
      const d = Math.abs(((Number(m[1]) - atis.windMag + 540) % 360) - 180);
      return d <= 10 && Math.abs(Number(m[2]) - atis.windKt) <= 2;
    }
  }
}

function copyFields(atis: Atis): CopyField[] {
  return [
    { id: 'letter', label: 'Information', answer: atis.word, placeholder: 'Letter' },
    { id: 'wind', label: 'Wind', answer: atis.windMag === null ? 'Calm' : `${say3(atis.windMag)} at ${atis.windKt}${atis.gustKt ? ` gust ${atis.gustKt}` : ''}`, placeholder: 'ddd at kt' },
    { id: 'altimeter', label: 'Altimeter', answer: atis.altimeter, placeholder: '29.92' },
    { id: 'runway', label: 'Runway in use', answer: atis.runway, choices: ['06', '24'] },
  ];
}

// --- Items. Each builder returns what a controller needs to hear. ---

const T = (c: Callsign, allowShort: boolean, fixTo: string): Item => ({
  id: 'callsign', part: 'who', need: 'must', label: allowShort ? 'Your call sign' : 'Your full call sign',
  check: { k: 'callsign', full: c.full, short: c.short, allowShort },
  fix: `Aircraft calling ${fixTo}, say again your call sign.`,
});
const facility = (which: 'ground' | 'tower', need: 'must' | 'should' = 'must'): Item => ({
  id: 'facility', part: 'who', need, label: `Who you are calling: ${FIELD.facility} ${which === 'ground' ? 'Ground' : 'Tower'}`,
  check: { k: 'facility', facility: which, other: which === 'ground' ? 'tower' : 'ground' },
});
const atisItem = (a: Atis, cs: Callsign): Item => ({
  id: 'atis', part: 'what', need: 'must', label: `That you have information ${a.word}`,
  check: { k: 'atis', letter: a.letter }, mild: true,
  fix: `${cs.sayFull}, information ${a.word} is current, altimeter ${a.altimeter}. Say again your request.`,
});
const runwayItem = (rwy: RunwayId, cs: Callsign, label = `Runway ${rwy}`): Item => ({
  id: `runway-${rwy}`, part: 'what', need: 'must', label,
  check: { k: 'runway', rwy, others: FIELD.runways.map((x) => x.id).filter((x) => x !== rwy) },
  fix: `${cs.sayShort}, negative, runway ${rwy}. Read back.`,
});
const holdShortItem = (rwy: RunwayId, cs: Callsign): Item => ({
  id: 'hold-short', part: 'what', need: 'must', label: `Hold short of runway ${rwy}`,
  check: { k: 'holdShort', rwy }, fix: `${cs.sayShort}, read back hold short instructions.`,
});
const crossItem = (rwy: RunwayId, cs: Callsign): Item => ({
  id: 'cross', part: 'what', need: 'must', label: `Cross runway ${rwy}`,
  check: { k: 'cross', rwy }, fix: `${cs.sayShort}, read back the runway crossing.`,
});
const routeItem = (route: TaxiRoute, extra: string[] = []): Item => ({
  id: 'route', part: 'where', need: 'should', label: `The route: ${route.via.map(sayTaxiway).join(', ')}`,
  check: { k: 'route', taxiways: route.via, allowed: [...extra, ...(route.holdAt ? [route.holdAt] : []), ...(route.cross ? [route.cross.at] : [])] },
});
const phrase = (id: string, part: Item['part'], need: Item['need'], label: string, any: string[], wrong?: string[], fix?: string): Item => ({
  id, part, need, label, check: { k: 'phrase', any, wrong }, fix,
});
const never = (id: string, label: string, any: string[], fix: string): Item => ({ id, part: 'what', need: 'must', label, check: { k: 'never', any }, fix });

const READY_TAXI = ['ready to taxi', 'ready for taxi', 'request taxi', 'taxi'];
const CLOSED = ['closed traffic', 'pattern', 'touch and go', 'touch and goes', 'touch and go s', 'closed pattern', 'stay in the pattern', 'remain in the pattern', 'pattern work'];
const CLEARED_TAKEOFF = ['cleared for takeoff', 'cleared takeoff', 'cleared for take off', 'cleared take off', 'clear for takeoff', 'clear for take off'];
const CLEARED_LAND = ['cleared to land', 'clear to land', 'cleared land'];
const CLEARED_TG = ['cleared touch and go', 'cleared for touch and go', 'cleared for the touch and go', 'cleared for the option', 'cleared option', 'clear touch and go', 'clear for touch and go'];
const FULL_STOP = ['full stop', 'to land', 'landing', 'full stop landing'];

/** Which way to turn off the runway heading for a departure direction, or straight out. */
export function departureTurn(rwy: RunwayId, dir: Compass): 'left' | 'right' | 'straight' {
  const d = norm(compassDeg(dir) - runwayById(rwy).headingMag);
  if (d <= 30 || d >= 330) return 'straight';
  return d < 180 ? 'right' : 'left';
}

function routeSay(route: TaxiRoute, holdRwy: RunwayId | null): string {
  const parts: string[] = [];
  route.via.forEach((t) => {
    parts.push(sayTaxiway(t));
    if (route.cross && t === route.cross.at) parts.push(`cross runway ${route.cross.runway}`);
  });
  const hold = holdRwy && route.holdAt ? `, hold short runway ${holdRwy} at ${sayTaxiway(route.holdAt)}` : '';
  return `via ${parts.join(', ')}${hold}`;
}

function routeReadback(route: TaxiRoute, holdRwy: RunwayId | null): string {
  return routeSay(route, holdRwy).replace(/^via /, '');
}

interface Built {
  cs: Callsign;
  atis: Atis;
  ramp: Ramp;
  r: Rng;
  ground: Freq;
  tower: Freq;
  atisFreq: Freq;
  events: Event[];
  /** The airplane ahead in the pattern, once the tower has named one. */
  ahead?: string;
}

function atisEvent(b: Built, situation: string): Event {
  return { kind: 'atis', id: 'atis', title: 'Get the ATIS', situation, freq: b.atisFreq, atis: b.atis, fields: copyFields(b.atis) };
}

function groundOut(b: Built, intent: { say: string; items: Item[] }) {
  const { cs, atis, ramp, ground } = b;
  b.events.push({
    kind: 'transmit', id: 'ground-call', title: 'Call Ground for taxi',
    situation: `Engine running, ${ramp.scene}. Avionics on, ${ground.name} tuned to ${ground.mhz}. Listen first, then call for taxi.`,
    freq: ground, atc: null,
    items: [
      facility('ground'),
      T(cs, false, ground.name),
      phrase('where', 'where', 'must', `Where you are: ${ramp.name}`, ramp.aliases, undefined, `${cs.sayFull}, ${ground.name}, say your position on the field.`),
      atisItem(atis, cs),
      ...intent.items,
      phrase('request', 'what', 'must', 'What you want: taxi', READY_TAXI, undefined, `${cs.sayFull}, ${ground.name}, say request.`),
    ],
    model: `${ground.name}, ${cs.sayFull}, at ${ramp.name} with information ${atis.word}, ${intent.say}, ready to taxi.`,
    why: 'Who you are calling, who you are, where you are, what you want. On the ground "where" is the ramp or the spot you are parked, so the controller can find you, and the ATIS code saves them reading you the weather.',
  });
}

function taxiOut(b: Built) {
  const { cs, atis, ramp, ground } = b;
  const route = departureRoute(ramp, atis.runway, atis.closure);
  const items: Item[] = [runwayItem(atis.runway, cs), routeItem(route)];
  if (route.cross) items.push(crossItem(route.cross.runway, cs));
  items.push(holdShortItem(atis.runway, cs));
  items.push({ id: 'hold-at', part: 'where', need: 'should', label: `Where to hold: ${sayTaxiway(route.holdAt!)}`, check: { k: 'taxiway', id: route.holdAt! } });
  items.push(T(cs, true, ground.name));
  const closureNote = route.aroundClosure && atis.closure
    ? ` The ATIS told you why: ${atis.closure.text.toLowerCase().replace(/^taxiway/, 'taxiway')}, so the route goes across the runway at Charlie.`
    : '';
  b.events.push({
    kind: 'transmit', id: 'taxi-readback', title: 'Read back the taxi clearance',
    situation: `Ground answers. Write it down as you hear it, then read it back.${route.cross ? ' This one crosses the runway.' : ''}`,
    freq: ground,
    atc: `${cs.sayShort}, ${ground.name}, runway ${atis.runway}, taxi ${routeSay(route, atis.runway)}.`,
    items,
    model: `Runway ${atis.runway}, ${routeReadback(route, atis.runway)}, ${cs.sayShort}.`,
    why: `A runway assignment, a runway crossing and a hold short instruction are the parts you must read back word for word. The route is good practice, and it is how you catch your own mistake before you roll.${closureNote}`,
  });
  return route;
}

function holdingShortDecide(b: Built, holdAt: string) {
  b.events.push({
    kind: 'decide', id: 'run-up', title: 'At the hold short line',
    situation: `Run-up done at ${sayTaxiway(holdAt)}, short of runway ${b.atis.runway}. Ground told you to hold short and has said nothing since.`,
    options: [
      { id: 'tower', label: `Switch to Tower on ${b.tower.mhz} and call ready` },
      { id: 'ground', label: 'Ask Ground for a takeoff clearance' },
      { id: 'wait', label: 'Stay on Ground and wait to be called' },
      { id: 'go', label: 'Look both ways, and taxi onto the runway when it is clear' },
    ],
    grades: { tower: 'best', ground: 'marginal', wait: 'marginal', go: 'unsafe' },
    consequence: {
      tower: 'Tower answers in a few seconds. That is the handoff most fields expect: Ground gets you to the line, you go to Tower when you are ready.',
      ground: '"Contact Tower one two five point one." Ground cannot clear you onto a runway, so you used a call to learn that.',
      wait: 'Nobody calls. Ground thinks you are still doing your run-up and Tower does not know you exist. After a while Ground asks if you are ready, and tells you to call Tower.',
      go: 'Crossing a hold short line without a clearance is a runway incursion, the thing towers worry about most. A clear runway can have someone on short final you never saw.',
    },
    why: 'Ground clears you to the hold short line. Only Tower clears you onto the runway. When the run-up is done, switch to Tower and call ready from the line. Hold short means stay behind the yellow lines until a controller says otherwise (14 CFR 91.123).',
  });
}

function towerReady(b: Built, holdAt: string, intent: { say: string; items: Item[] }) {
  const { cs, atis, tower } = b;
  b.events.push({
    kind: 'transmit', id: 'tower-ready', title: 'Call Tower ready',
    situation: `${tower.name} on ${tower.mhz}. You are at the hold short line at ${sayTaxiway(holdAt)}, run-up done, checklist done.`,
    freq: tower, atc: null,
    items: [
      facility('tower'),
      T(cs, false, tower.name),
      {
        id: 'where', part: 'where', need: 'must', label: `Where you are: holding short runway ${atis.runway}${holdAt ? ` at ${sayTaxiway(holdAt)}` : ''}`,
        check: { k: 'any', of: [{ k: 'holdShort', rwy: atis.runway }, { k: 'all', of: [{ k: 'taxiway', id: holdAt }, { k: 'runway', rwy: atis.runway, others: [] }] }] },
        fix: `${cs.sayFull}, ${tower.name}, say your position.`,
      },
      phrase('ready', 'what', 'must', 'That you are ready', ['ready', 'ready for departure', 'ready for takeoff', 'ready to go'], undefined, `${cs.sayFull}, ${tower.name}, say intentions.`),
      ...intent.items,
    ],
    model: `${tower.name}, ${cs.sayFull}, holding short runway ${atis.runway} at ${sayTaxiway(holdAt)}, ready for departure, ${intent.say}.`,
    why: 'A new controller gets your full call sign. "Holding short runway 24 at Alpha 4" tells Tower which end and which taxiway, because two airplanes can be waiting at different spots.',
  });
}

/** Takeoff, with traffic in the way on some flights: line up and wait, or hold short for an arrival. */
function takeoff(b: Built, after: string, afterReadback: string[], afterLabel: string, modelAfter: string) {
  const { cs, atis, tower, r } = b;
  const rwy = atis.runway;
  const kind = r.pick(['clear', 'clear', 'luaw', 'hold'] as const);
  const traffic = r.pick(TRAFFIC);
  const afterItem = afterReadback.length ? [phrase('after', 'what', 'should', afterLabel, afterReadback, undefined)] : [];
  const neverTakeoff = (then: string) => never('not-takeoff', 'Not "cleared for takeoff"', CLEARED_TAKEOFF, `${cs.sayShort}, negative, you are not cleared for takeoff. ${then}`);
  if (kind === 'luaw') {
    b.events.push({
      kind: 'transmit', id: 'luaw', title: 'Line up and wait', situation: 'Tower answers, with traffic still on the runway.',
      freq: tower, atc: `${cs.sayShort}, ${tower.name}, runway ${rwy}, line up and wait, traffic ${traffic} departing ahead.`,
      items: [runwayItem(rwy, cs), phrase('luaw', 'what', 'must', 'Line up and wait', ['line up and wait', 'lineup and wait', 'line up wait'], undefined, `${cs.sayShort}, read back, line up and wait.`), neverTakeoff(`Runway ${rwy}, line up and wait.`), T(cs, true, tower.name)],
      model: `Runway ${rwy}, line up and wait, ${cs.sayShort}.`,
      why: 'Line up and wait puts you on the runway, not in the air. Read it back as it was said and never with the word "takeoff" in it. On the runway, keep looking at the far end and listen: if the clearance does not come within a minute or so, ask.',
    });
  } else if (kind === 'hold') {
    b.events.push({
      kind: 'transmit', id: 'hold-traffic', title: 'Hold short for landing traffic', situation: 'Tower answers, with an arrival on final.',
      freq: tower, atc: `${cs.sayShort}, ${tower.name}, hold short runway ${rwy}, traffic ${traffic} on a two mile final.`,
      items: [holdShortItem(rwy, cs), neverTakeoff(`Hold short runway ${rwy}.`), phrase('traffic', 'what', 'should', 'The traffic: in sight or looking', ['traffic in sight', 'in sight', 'looking', 'have the traffic', 'got the traffic', 'negative contact'], undefined), T(cs, true, tower.name)],
      model: `Holding short runway ${rwy}, traffic in sight, ${cs.sayShort}.`,
      why: 'Look up the final approach course and find the traffic before you answer. "Traffic in sight" or "looking" tells Tower whether you can be part of the plan.',
    });
  }
  b.events.push({
    kind: 'transmit', id: 'takeoff', title: 'Read back the takeoff clearance',
    situation: kind === 'clear' ? 'Tower answers.' : kind === 'luaw' ? 'On the centerline. The traffic ahead lifts off and turns away.' : 'The arrival lands and turns off.',
    freq: tower,
    atc: `${cs.sayShort}, ${kind === 'clear' ? `${tower.name}, ` : ''}runway ${rwy}, cleared for takeoff, ${after}.`,
    items: [runwayItem(rwy, cs), phrase('cleared', 'what', 'must', 'Cleared for takeoff', CLEARED_TAKEOFF, undefined, `${cs.sayShort}, read back the takeoff clearance.`), ...afterItem, T(cs, true, tower.name)],
    model: `Runway ${rwy}, cleared for takeoff, ${modelAfter}, ${cs.sayShort}.`,
    why: 'Read back the runway with the clearance. Before you roll, glance at the heading indicator against the runway number: the runway you read back is the runway you are on.',
  });
}

function landingSequence(b: Built, side: 'left' | 'right' | null, closed: boolean) {
  const { cs, atis, tower, r } = b;
  const rwy = atis.runway;
  const clearance = closed ? CLEARED_TG : CLEARED_LAND;
  const clearLabel = closed ? 'Cleared touch and go' : 'Cleared to land';
  const clearSay = closed ? 'cleared touch and go' : 'cleared to land';
  const wrongClear = closed ? CLEARED_LAND : CLEARED_TG;
  const kind = r.pick(['follow', 'plain', 'extend'] as const);
  const traffic = r.pick(TRAFFIC);
  const clearItems = [
    runwayItem(rwy, cs),
    phrase('cleared', 'what', 'must', clearLabel, clearance, wrongClear, `${cs.sayShort}, read back, runway ${rwy} ${clearSay}.`),
  ];
  if (kind === 'extend' && side) {
    b.events.push({
      kind: 'transmit', id: 'extend', title: 'Extend your downwind', situation: 'Tower answers, with someone on a long final.',
      freq: tower, atc: `${cs.sayShort}, extend downwind, I will call your base, traffic ${traffic} on a four mile straight-in.`,
      items: [phrase('extend', 'what', 'must', 'Extend downwind', ['extend downwind', 'extending downwind', 'extend', 'extending'], undefined, `${cs.sayShort}, read back, extend downwind.`), phrase('traffic', 'what', 'should', 'The traffic: in sight or looking', ['traffic in sight', 'in sight', 'looking', 'have the traffic', 'negative contact'], undefined), T(cs, true, tower.name)],
      model: `Extend downwind, looking for the traffic, ${cs.sayShort}.`,
      why: 'Extending means keep flying the downwind past where you would turn, and do not turn base until Tower calls it. Keep the pattern altitude, keep the airplane slow and configured, and watch the runway get further behind you.',
    });
    b.events.push({
      kind: 'transmit', id: 'clearance', title: `Read back: ${clearLabel.toLowerCase()}`, situation: 'The straight-in traffic passes abeam you on final.',
      freq: tower, atc: `${cs.sayShort}, turn base now, runway ${rwy}, ${clearSay}.`,
      items: [...clearItems, phrase('base', 'what', 'should', 'Turning base', ['base', 'turning base', 'turn base'], undefined), T(cs, true, tower.name)],
      model: `Turning base, runway ${rwy}, ${clearSay}, ${cs.sayShort}.`,
      why: 'You are a long way out now, so plan the base and final with power. Read back the runway and the clearance.',
    });
    return;
  }
  if (kind === 'follow') {
    b.ahead = traffic;
    const leg = side ? `${side} base` : 'a three mile final';
    b.events.push({
      kind: 'transmit', id: 'clearance', title: `Read back: ${clearLabel.toLowerCase()}`, situation: 'Tower answers, with another airplane ahead of you.',
      freq: tower, atc: `${cs.sayShort}, number two, follow ${traffic} on ${leg}, runway ${rwy}, ${clearSay}.`,
      items: [phrase('sequence', 'what', 'should', `Your sequence: number two, following ${traffic}`, ['number 2', 'number two', 'follow', 'following', 'traffic in sight', 'in sight'], undefined), ...clearItems, T(cs, true, tower.name)],
      model: `Number two, traffic in sight, runway ${rwy}, ${clearSay}, ${cs.sayShort}.`,
      why: 'Being cleared with traffic ahead means you are cleared to land behind it, not on top of it. Find the traffic before you turn base, and if it is not off the runway when you get to the flare, go around.',
    });
    return;
  }
  b.events.push({
    kind: 'transmit', id: 'clearance', title: `Read back: ${clearLabel.toLowerCase()}`, situation: 'Tower answers.',
    freq: tower, atc: `${cs.sayShort}, runway ${rwy}, ${clearSay}.`,
    items: [...clearItems, T(cs, true, tower.name)],
    model: `Runway ${rwy}, ${clearSay}, ${cs.sayShort}.`,
    why: 'Short and complete: the runway, the clearance, your call sign. Then look at the runway and check it is the one you read back.',
  });
}

function goAround(b: Built, side: 'left' | 'right', thenLand: boolean) {
  const { cs, tower, r } = b;
  const traffic = b.ahead ?? r.pick(TRAFFIC);
  b.events.push({
    kind: 'decide', id: 'short-final', title: 'Short final',
    situation: `Short final, about 200 feet, cleared. ${traffic[0].toUpperCase()}${traffic.slice(1)} that landed ahead of you is still on the runway, slowing, and has not turned off. The tower frequency is busy.`,
    options: [
      { id: 'go-around', label: 'Go around now, and tell Tower when you can' },
      { id: 'ask', label: 'Ask Tower if the runway will be clear' },
      { id: 'slow', label: 'Slow down and float to give it time' },
      { id: 'land', label: 'Continue: you are cleared to land' },
    ],
    grades: { 'go-around': 'best', ask: 'marginal', slow: 'unsafe', land: 'unsafe' },
    consequence: {
      'go-around': 'Full power, pitch for the climb, flaps up in stages, and you sidestep to the right to keep the other airplane in sight. Aviate first, then talk.',
      ask: 'By the time you get a word in, you are over the numbers with the decision made for you. A question on short final is a go-around in slow motion.',
      slow: 'Slow and low behind another airplane is how stalls on final happen. The runway does not clear any faster.',
      land: 'A landing clearance does not clear the runway. You are the one who can see it, so you are the one who has to act.',
    },
    why: 'A clearance is permission, not an instruction to land on whatever is on the runway (14 CFR 91.3). If the runway is not clear by the time you need it, go around. Fly the airplane first, then tell Tower in three words.',
  });
  b.events.push({
    kind: 'transmit', id: 'going-around', title: 'Tell Tower you are going around',
    situation: 'Climbing, flaps coming up, offset to the right of the runway. Now tell Tower.',
    freq: tower, atc: null,
    items: [T(cs, true, tower.name), phrase('go-around', 'what', 'must', 'Going around', ['going around', 'go around', 'go-around', 'missed', 'going missed'], undefined)],
    model: `${cs.sayShort}, going around.`,
    why: 'Short and in this order: your call sign, "going around". Tower will tell you what to do next. If they do not, fly the pattern you were in.',
  });
  const rwy = b.atis.runway;
  const then = thenLand ? `runway ${rwy}, cleared to land` : 'report midfield downwind';
  const pattern = `${side} ${thenLand ? 'traffic' : 'closed traffic'}`;
  b.events.push({
    kind: 'transmit', id: 'after-go-around', title: 'Read back the new plan', situation: 'Tower answers, and the airplane on the runway turns off.',
    freq: tower, atc: `${cs.sayShort}, roger, make ${pattern}, ${then}.`,
    items: [
      phrase('pattern', 'what', 'should', `Make ${pattern}`, [pattern, `${side} traffic`, `${side} closed`, `make ${side}`], [`${side === 'left' ? 'right' : 'left'} traffic`, `${side === 'left' ? 'right' : 'left'} closed`]),
      ...(thenLand ? [runwayItem(rwy, cs), phrase('cleared', 'what', 'must', 'Cleared to land', CLEARED_LAND, CLEARED_TG, `${cs.sayShort}, read back, runway ${rwy} cleared to land.`)] : []),
      T(cs, true, tower.name),
    ],
    model: `${pattern[0].toUpperCase()}${pattern.slice(1)}${thenLand ? `, runway ${rwy}, cleared to land` : ''}, ${cs.sayShort}.`,
    why: thenLand ? 'You are cleared to land on this trip around. Fly a normal pattern and read back the runway and the clearance.' : 'Back into the pattern as if nothing happened. The go-around was the right call, not a failure.',
  });
}

function downwindReport(b: Built, side: 'left' | 'right', closed: boolean, id = 'downwind') {
  const { cs, atis, tower } = b;
  const other = side === 'left' ? 'right' : 'left';
  b.events.push({
    kind: 'transmit', id, title: 'Report midfield downwind',
    situation: `Level at pattern altitude, ${FIELD.tpaMsl.toLocaleString('en-US')} feet MSL, abeam the middle of runway ${atis.runway} on the ${side} downwind. Tower asked you to report here.`,
    freq: tower, atc: null,
    items: [
      facility('tower', 'should'),
      T(cs, true, tower.name),
      phrase('where', 'where', 'must', `Where you are: ${side} downwind`, [`${side} downwind`, `${side} down wind`], [`${other} downwind`, `${other} down wind`], `${cs.sayShort}, say position.`),
      phrase('midfield', 'where', 'should', 'Midfield', ['midfield', 'mid field', 'abeam']),
      phrase('intent', 'what', 'should', closed ? 'What next: touch and go' : 'What next: full stop', closed ? ['touch and go', 'option', 'touch and goes'] : FULL_STOP, closed ? FULL_STOP.filter((p) => p !== 'landing') : ['touch and go']),
    ],
    model: `${tower.name}, ${cs.sayShort}, midfield ${side} downwind, ${closed ? 'touch and go' : 'full stop'}.`,
    why: 'In the pattern, the abbreviated call sign is fine once Tower has used it. Say the side of the pattern you are on: left and right downwind are on opposite sides of the field, and that is the first thing a controller looks for.',
  });
}

function afterLanding(b: Built) {
  const { cs, atis, ramp, ground, tower, r } = b;
  const exits = exitsFor(atis.runway);
  const exit: Exit = r.pick(exits.slice(0, 3));
  b.events.push({
    kind: 'transmit', id: 'exit', title: 'Turn off and change to Ground', situation: 'Rolling out on the centerline, slowing through 30 knots.',
    freq: tower, atc: `${cs.sayShort}, turn ${exit.turn} at ${sayTaxiway(exit.connector)}, contact Ground ${FIELD.ground.replace(/0+$/, '')}.`,
    items: [
      phrase('turn', 'where', 'should', `Turn ${exit.turn} at ${sayTaxiway(exit.connector)}`, [`${exit.turn}`, `turn ${exit.turn}`], [exit.turn === 'left' ? 'right' : 'left']),
      { id: 'freq', part: 'what', need: 'should', label: `Ground on ${FIELD.ground.replace(/0+$/, '')}`, check: { k: 'frequency', mhz: FIELD.ground } },
      T(cs, true, tower.name),
    ],
    model: `${exit.turn[0].toUpperCase()}${exit.turn.slice(1)} at ${sayTaxiway(exit.connector)}, Ground ${FIELD.ground.replace(/0+$/, '')}, ${cs.sayShort}.`,
    why: 'Exit where Tower says, and do not stop until the whole airplane is past the hold short line on the taxiway. Only then change to Ground, unless Tower tells you to stay.',
  });
  const route = taxiInRoute(exit, ramp, atis.runway);
  b.events.push({
    kind: 'transmit', id: 'ground-in', title: 'Call Ground to taxi in',
    situation: `Clear of runway ${atis.runway} at ${sayTaxiway(exit.connector)}, past the hold short line, stopped. ${ground.name} is on ${ground.mhz}. Your parking is ${ramp.name}.`,
    freq: ground, atc: null,
    items: [
      facility('ground'),
      T(cs, true, ground.name),
      {
        id: 'where', part: 'where', need: 'must', label: `Where you are: clear of runway ${atis.runway} at ${sayTaxiway(exit.connector)}`,
        check: { k: 'any', of: [{ k: 'taxiway', id: exit.connector }, { k: 'all', of: [{ k: 'phrase', any: ['clear', 'clear of'] }, { k: 'runway', rwy: atis.runway, others: [] }] }] },
        fix: `${cs.sayShort}, ${ground.name}, say position.`,
      },
      phrase('request', 'what', 'must', `What you want: taxi to ${ramp.name}`, ramp.aliases, undefined, `${cs.sayShort}, ${ground.name}, say parking.`),
    ],
    model: `${ground.name}, ${cs.sayShort}, clear of runway ${atis.runway} at ${sayTaxiway(exit.connector)}, taxi to ${ramp.name}.`,
    why: 'Where you are and where you want to go. Ground does not know where you park unless you say.',
  });
  const holdFirst = route.cross !== null && r.chance(0.5);
  const traffic = r.pick(TRAFFIC);
  if (route.cross && holdFirst) {
    const holdRoute: TaxiRoute = { ...route, cross: null, holdAt: 'C' };
    const via = route.via.slice(0, route.via.indexOf('C') + 1);
    b.events.push({
      kind: 'transmit', id: 'taxi-in', title: 'Read back the taxi in',
      situation: 'Ground answers. Your ramp is on the other side of the runway.',
      freq: ground, atc: `${cs.sayShort}, taxi to ${ramp.name} via ${via.map(sayTaxiway).join(', ')}, hold short runway ${atis.runway} at Charlie.`,
      items: [routeItem({ ...holdRoute, via }), holdShortItem(atis.runway, cs), never('no-cross', 'Not "cross"', ['cross', 'crossing', 'cleared to cross'], `${cs.sayShort}, negative, hold short runway ${atis.runway} at Charlie.`), T(cs, true, ground.name)],
      model: `${via.map(sayTaxiway).join(', ')}, hold short runway ${atis.runway} at Charlie, ${cs.sayShort}.`,
      why: 'You will be cleared to cross when the runway is free. Until then the hold short line at Charlie is the end of your clearance, even on the way in.',
    });
    b.events.push({
      kind: 'transmit', id: 'cross-in', title: 'Read back the crossing',
      situation: `Holding short at Charlie. ${traffic[0].toUpperCase()}${traffic.slice(1)} lands and rolls past.`,
      freq: ground, atc: `${cs.sayShort}, cross runway ${atis.runway} at Charlie, continue to ${ramp.name} via ${route.via.slice(route.via.indexOf('C') + 1).map(sayTaxiway).join(', ')}.`,
      items: [crossItem(atis.runway, cs), T(cs, true, ground.name)],
      model: `Cross runway ${atis.runway} at Charlie, ${cs.sayShort}.`,
      why: 'Look both ways down the runway before you cross, even with the clearance, and cross without stopping.',
    });
    return;
  }
  const items: Item[] = [routeItem(route)];
  if (route.cross) items.push(crossItem(route.cross.runway, cs));
  items.push(T(cs, true, ground.name));
  b.events.push({
    kind: 'transmit', id: 'taxi-in', title: 'Read back the taxi in', situation: route.cross ? 'Ground answers. Your ramp is on the other side of the runway.' : 'Ground answers.',
    freq: ground, atc: `${cs.sayShort}, taxi to ${ramp.name} ${routeSay(route, null)}.`,
    items,
    model: `${routeReadback(route, null)}, ${cs.sayShort}.`,
    why: route.cross ? 'A runway crossing is always read back, on the way in as much as on the way out.' : 'The route is short, so is the readback.',
  });
}

const INTENT_CLOSED = { say: 'closed traffic', items: [phrase('intent', 'what', 'should', 'Your intentions: closed traffic', CLOSED)] };

function buildPattern(b: Built) {
  const { atis, r, cs } = b;
  b.events.push(atisEvent(b, `${b.ramp.scene[0].toUpperCase()}${b.ramp.scene.slice(1)}, master on. Before you call anyone, listen to the ATIS on ${b.atisFreq.mhz} and copy it down.`));
  groundOut(b, INTENT_CLOSED);
  const route = taxiOut(b);
  if (r.chance(0.5)) holdingShortDecide(b, route.holdAt!);
  towerReady(b, route.holdAt!, INTENT_CLOSED);
  const side = r.pick(['left', 'right'] as const);
  takeoff(b, `make ${side} closed traffic, report midfield downwind`, [`${side} closed traffic`, `${side} traffic`, `${side} closed`, `make ${side}`], `${side[0].toUpperCase()}${side.slice(1)} closed traffic`, `${side} closed traffic`);
  downwindReport(b, side, true);
  landingSequence(b, side, true);
  if (r.chance(0.4)) goAround(b, side, false);
  downwindReport(b, side, false, 'downwind-2');
  b.events.push({
    kind: 'transmit', id: 'land', title: 'Read back: cleared to land', situation: 'Tower answers.',
    freq: b.tower, atc: `${cs.sayShort}, runway ${atis.runway}, cleared to land.`,
    items: [runwayItem(atis.runway, cs), phrase('cleared', 'what', 'must', 'Cleared to land', CLEARED_LAND, CLEARED_TG, `${cs.sayShort}, read back, runway ${atis.runway} cleared to land.`), T(cs, true, b.tower.name)],
    model: `Runway ${atis.runway}, cleared to land, ${cs.sayShort}.`,
    why: 'Listen for the word that changed: last time it was "touch and go", this time it is "to land". Reading back the clearance you expected instead of the one you got is the classic slip.',
  });
  afterLanding(b);
}

function buildDepart(b: Built) {
  const { atis, r, cs, tower } = b;
  const dir: Compass = r.pick(COMPASS.filter((_, i) => i % 2 === 0));
  const turn = departureTurn(atis.runway, dir);
  const intent = {
    say: `departing to the ${dir}`,
    items: [phrase('intent', 'what', 'should', `Your intentions: departing to the ${dir}`, [dir, `${dir}bound`, `${dir} bound`, `to the ${dir}`])],
  };
  b.events.push(atisEvent(b, `${b.ramp.scene[0].toUpperCase()}${b.ramp.scene.slice(1)}. You are going ${dir}, out of the area. Listen to the ATIS on ${b.atisFreq.mhz} and copy it down.`));
  groundOut(b, intent);
  const route = taxiOut(b);
  if (r.chance(0.5)) holdingShortDecide(b, route.holdAt!);
  towerReady(b, route.holdAt!, intent);
  const after = turn === 'straight' ? 'straight out departure approved' : `${turn} turn ${dir}bound approved`;
  takeoff(b, after, turn === 'straight' ? ['straight out'] : [`${turn} turn`, `${turn} ${dir}bound`, `${dir}bound`], turn === 'straight' ? 'Straight out' : `${turn[0].toUpperCase()}${turn.slice(1)} turn ${dir}bound`, turn === 'straight' ? 'straight out' : `${turn} turn ${dir}bound`);
  // When to leave: the Class D is a circle around the field; leave it before you leave Tower.
  const r1 = Math.max(2, Math.floor(FIELD.classDRadiusNm) - 1);
  const r2 = Math.ceil(FIELD.classDRadiusNm) + 1;
  b.events.push({
    kind: 'decide', id: 'leave', title: 'When to leave the frequency',
    situation: `Climbing ${dir}bound. The Class D around the field reaches ${FIELD.classDRadiusNm} nm and up to ${FIELD.classDCeilingMsl.toLocaleString('en-US')} feet MSL. Tower has not said anything since your takeoff.`,
    options: [
      { id: 'now', label: `At ${r1} nm, switch to your next frequency` },
      { id: 'outside', label: `At ${r2} nm, clear of the Class D, ask Tower for a frequency change` },
      { id: 'silent', label: `At ${r2} nm, just switch: you are outside` },
      { id: 'stay', label: 'Stay on Tower for the rest of the flight' },
    ],
    grades: { now: 'marginal', outside: 'best', silent: 'acceptable', stay: 'marginal' },
    consequence: {
      now: 'You are still inside Tower\'s airspace. If Tower needs to turn you for traffic, you will not hear it.',
      outside: 'Tower approves it in a word, and knows you are gone. Now you can talk to whoever you need next.',
      silent: 'Legal once you are clear of the Class D, and some towers expect it. Asking costs three seconds and keeps Tower from calling an airplane that has left.',
      stay: 'Tower\'s traffic is not your traffic out here. Monitor a frequency that serves where you are going.',
    },
    why: `Stay with Tower until you are clear of the Class D: ${FIELD.classDRadiusNm} nm and below ${FIELD.classDCeilingMsl.toLocaleString('en-US')} feet MSL at the practice field (14 CFR 91.129). A frequency change request is the polite way out.`,
  });
  b.events.push({
    kind: 'transmit', id: 'freq-change', title: 'Ask for a frequency change',
    situation: `${r2} miles ${dir} of the field, outside the Class D, still climbing.`,
    freq: tower, atc: null,
    items: [facility('tower', 'should'), T(cs, true, tower.name), phrase('request', 'what', 'must', 'What you want: a frequency change', ['frequency change', 'freq change', 'leave the frequency', 'leaving the frequency', 'change frequency'], undefined, `${cs.sayShort}, say again.`)],
    model: `${tower.name}, ${cs.sayShort}, request frequency change.`,
    why: 'Short call, one request. You are outside the Class D now, so Tower can let you go.',
  });
  b.events.push({
    kind: 'transmit', id: 'freq-approved', title: 'Acknowledge', situation: 'Tower answers.',
    freq: tower, atc: `${cs.sayShort}, frequency change approved.`,
    items: [T(cs, true, tower.name), phrase('ack', 'what', 'should', 'An acknowledgment', ['frequency change approved', 'freq change approved', 'good day', 'so long', 'thanks', 'thank you', 'roger', 'see you', 'changing'])],
    model: `Frequency change approved, ${cs.sayShort}. Good day.`,
    why: 'Acknowledge with your call sign, then change.',
  });
}

function buildArrive(b: Built) {
  const { atis, r, cs, tower } = b;
  const from: Compass = r.pick(COMPASS);
  const nm = r.int(8, 12);
  const alt = r.pick([2500, 3000, 3500]);
  const entry: Entry = entryFrom(from, atis.runway);
  const rwy = atis.runway;
  b.events.push({
    kind: 'atis', id: 'atis', title: 'Get the ATIS',
    situation: `${nm + 6} miles ${from} of the field at ${alt.toLocaleString('en-US')} feet, coming home. Get the ATIS on ${b.atisFreq.mhz} before you call Tower.`,
    freq: b.atisFreq, atis, fields: copyFields(atis),
  });
  b.events.push({
    kind: 'transmit', id: 'tower-call', title: 'Call Tower inbound',
    situation: `${nm} miles ${from} of the field at ${alt.toLocaleString('en-US')} feet MSL, outside the Class D. ${tower.name} on ${tower.mhz}. You want to land.`,
    freq: tower, atc: null,
    items: [
      facility('tower'),
      T(cs, false, tower.name),
      {
        id: 'where', part: 'where', need: 'must', label: `Where you are: ${nm} miles ${from}`,
        check: { k: 'all', of: [{ k: 'number', value: String(nm) }, { k: 'phrase', any: [from, ...(ABBREV[from] ? [ABBREV[from]] : [])] }] },
        fix: `${cs.sayFull}, ${tower.name}, say position.`,
      },
      { id: 'alt', part: 'where', need: 'should', label: `Your altitude: ${alt.toLocaleString('en-US')}`, check: { k: 'number', value: String(alt) } },
      atisItem(atis, cs),
      phrase('intent', 'what', 'must', 'What you want: to land', ['landing', 'to land', 'full stop', 'inbound for landing', 'inbound to land', 'touch and go'], undefined, `${cs.sayFull}, ${tower.name}, say intentions.`),
    ],
    model: `${tower.name}, ${cs.sayFull}, ${nm} miles ${from}, ${alt.toLocaleString('en-US')}, with information ${atis.word}, landing.`,
    why: 'You need two-way radio contact before you enter the Class D (14 CFR 91.129): call well outside it. Who, who, where (distance and direction from the field, and altitude), and what. Hearing your own call sign back from Tower is the two-way contact.',
  });
  const entrySay = entry.kind === 'straight-in' ? `make straight-in runway ${rwy}, report three mile final` : `enter ${entry.side} downwind runway ${rwy}, report midfield`;
  const entryItem: Item = entry.kind === 'straight-in'
    ? phrase('entry', 'what', 'must', 'Straight in', ['straight in', 'straight-in', 'straightin'], ['downwind'], `${cs.sayShort}, negative, make straight-in runway ${rwy}.`)
    : phrase('entry', 'what', 'must', `Enter ${entry.side} downwind`, [`${entry.side} downwind`, `${entry.side} down wind`], [`${entry.side === 'left' ? 'right' : 'left'} downwind`, 'straight in'], `${cs.sayShort}, negative, enter ${entry.side} downwind runway ${rwy}.`);
  b.events.push({
    kind: 'transmit', id: 'entry', title: 'Read back the pattern entry', situation: 'Tower answers.',
    freq: tower, atc: `${cs.sayShort}, ${tower.name}, ${entrySay}.`,
    items: [entryItem, runwayItem(rwy, cs), phrase('report', 'what', 'should', entry.kind === 'straight-in' ? 'Report three mile final' : 'Report midfield', ['report', 'will report', 'wilco', 'midfield', 'three mile', '3 mile']), T(cs, true, tower.name)],
    model: `${entry.kind === 'straight-in' ? `Straight-in runway ${rwy}` : `${entry.side[0].toUpperCase()}${entry.side.slice(1)} downwind runway ${rwy}`}, will report ${entry.kind === 'straight-in' ? 'three mile final' : 'midfield'}, ${cs.sayShort}.`,
    why: `From the ${from}, the ${entry.kind === 'straight-in' ? 'final approach course for runway ' + rwy + ' is right in front of you' : `${entry.side} downwind for runway ${rwy} is on your side of the field, so you never cross over it`}. Picture it before you answer: where is the runway, and which way do you turn to join?`,
  });
  if (entry.kind === 'downwind') {
    downwindReport(b, entry.side, false);
    landingSequence(b, entry.side, false);
  } else {
    b.events.push({
      kind: 'transmit', id: 'final', title: 'Report three mile final',
      situation: `Three miles out on the extended centerline of runway ${rwy}, descending through about 1,500 feet above the field.`,
      freq: tower, atc: null,
      items: [facility('tower', 'should'), T(cs, true, tower.name), phrase('where', 'where', 'must', `Where you are: three mile final runway ${rwy}`, ['3 mile final', 'three mile final', '3 mile', 'final', 'mile final'], ['downwind', 'base'], `${cs.sayShort}, say position.`)],
      model: `${tower.name}, ${cs.sayShort}, three mile final runway ${rwy}.`,
      why: 'A straight-in has no downwind to report from, so the distance on final is the position report.',
    });
    landingSequence(b, null, false);
  }
  if (r.chance(0.35)) goAround(b, entry.kind === 'downwind' ? entry.side : 'left', true);
  afterLanding(b);
}

/** A flight for a mission. The same seed builds the same flight. */
export function buildRadioFlight(mission: Mission, seed: number, aircraft: AircraftProfile | null, now = new Date()): RadioFlight {
  const r = rng(seed);
  const ramp = mission === 'arrive' ? r.pick([RAMPS.main, RAMPS.south]) : r.pick([RAMPS.main, RAMPS.main, RAMPS.south]);
  const atis = buildAtis(r, now, ramp);
  const cs = callsignFor(aircraft);
  const b: Built = {
    cs, atis, ramp, r, events: [],
    ground: { name: `${FIELD.facility} Ground`, mhz: FIELD.ground },
    tower: { name: `${FIELD.facility} Tower`, mhz: FIELD.tower },
    atisFreq: { name: 'ATIS', mhz: FIELD.atis },
  };
  if (mission === 'pattern') buildPattern(b);
  else if (mission === 'depart') buildDepart(b);
  else buildArrive(b);
  return {
    seed, mission, title: MISSIONS.find((m) => m.id === mission)!.title, callsign: cs, atis, ramp, events: b.events,
    refs: ['AIM 4-2-3', 'AIM 4-3-18', 'AIM 4-3-2', '14 CFR 91.129', '14 CFR 91.123'],
    acs: ['PA.III.A', 'PA.III.B', 'PA.II.D'],
  };
}

export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
