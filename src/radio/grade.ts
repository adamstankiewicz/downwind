// Grading a typed call. Every transmission expects a short list of items: who
// you are calling, who you are, where you are, what you want, and for a
// readback the parts of the instruction a controller needs to hear back. Each
// item is checked against the folded call (phrase.ts) and comes out heard,
// missing or wrong. Content only: spelling, order and voice are never graded.
//
// A "must" item is one the controller cannot do without (the call sign, a
// runway assignment, a hold short, a clearance). A "should" item is good
// practice that a busy controller would let go. Saying something wrong is
// worse than leaving it out: reading back "cleared for takeoff" when told to
// line up and wait is the most dangerous call in the set.

import type { Grade } from '../scenarios/goNoGo';
import { hasPhrase, hear, pieces, type Heard } from './phrase';
import { TAXIWAY_IDS } from './field';

export type Part = 'who' | 'where' | 'what';
export type Need = 'must' | 'should';

export type Check =
  /** The pilot's call sign: the full one, or the abbreviated one once the controller has used it. */
  | { k: 'callsign'; full: string; short: string; allowShort: boolean }
  /** "Ground" or "Tower" in a call that opens contact. */
  | { k: 'facility'; facility: 'ground' | 'tower'; other: 'ground' | 'tower' }
  /** Any of the phrases. `wrong` phrases count as saying it wrong. */
  | { k: 'phrase'; any: string[]; wrong?: string[] }
  /** The ATIS code, "with information Echo". */
  | { k: 'atis'; letter: string }
  /** A runway number. `others` are the field's other runway numbers, to catch the wrong one. */
  | { k: 'runway'; rwy: string; others: string[] }
  /** "Hold short" with the runway. */
  | { k: 'holdShort'; rwy: string }
  /** "Cross runway 24". */
  | { k: 'cross'; rwy: string }
  /** The taxi route: every taxiway named, and none outside `allowed` (the route plus where to hold or cross). */
  | { k: 'route'; taxiways: string[]; allowed?: string[] }
  /** One taxiway or connector named, such as the hold short point. */
  | { k: 'taxiway'; id: string }
  /** A number heard in the call, such as an altitude, a distance or an altimeter setting. */
  | { k: 'number'; value: string; /** Also accept the number without its decimal point. */ loose?: boolean }
  /** A frequency: "121.8", "one two one point eight" or just "point eight". */
  | { k: 'frequency'; mhz: string }
  /** Both checks must pass. */
  | { k: 'all'; of: Check[] }
  /** Any check passes. */
  | { k: 'any'; of: Check[] }
  /** Saying any of these is wrong, and the item is heard when they are absent. */
  | { k: 'never'; any: string[] };

export interface Item {
  id: string;
  part: Part;
  need: Need;
  /** What the item is, in the pilot's words: "Hold short of runway 24". */
  label: string;
  check: Check;
  /** What the controller says when the item is missing or wrong, if they would stop you. */
  fix?: string;
  /** Saying it wrong is no worse than leaving it out, such as an old ATIS code. */
  mild?: boolean;
}

export type Outcome = 'heard' | 'missing' | 'wrong';

export interface ItemResult {
  item: Item;
  outcome: Outcome;
}

export interface CallResult {
  items: ItemResult[];
  grade: Grade;
  /** The controller's correction, when an item they would not let go is missing or wrong. */
  fix: string | null;
  heard: Heard;
  /** Words in the call, for a note on brevity. */
  words: number;
}

/** Runs with the call sign taken out, so its digits are never read as a runway or an altitude. */
function withoutCallsign(h: Heard, full: string, short: string): string[] {
  return h.runs.map((r) => r.replace(new RegExp(`n?${full}`), ' ').replace(new RegExp(short), ' ')).flatMap((r) => r.split(' ')).filter(Boolean);
}

interface Ctx {
  h: Heard;
  /** Pieces of every run after the call sign is removed ("24", "a4", "e"). */
  bits: string[];
  /** The same runs, unsplit. */
  runs: string[];
}

function evaluate(c: Check, x: Ctx): Outcome {
  const { h, bits } = x;
  switch (c.k) {
    case 'callsign': {
      const full = h.runs.some((r) => r.includes(c.full));
      if (full) return 'heard';
      const short = h.runs.some((r) => r.includes(c.short));
      return short && c.allowShort ? 'heard' : 'missing';
    }
    case 'facility':
      if (hasPhrase(h.text, [c.facility])) return 'heard';
      return hasPhrase(h.text, [c.other]) ? 'wrong' : 'missing';
    case 'phrase':
      if (c.wrong && hasPhrase(h.text, c.wrong)) return 'wrong';
      return hasPhrase(h.text, c.any) ? 'heard' : 'missing';
    case 'atis': {
      const m = h.text.match(/(?:^| )(?:information|info|with|have|got) (?:information )?([a-z])(?= |$)/);
      if (!m) return 'missing';
      return m[1] === c.letter ? 'heard' : 'wrong';
    }
    case 'runway': {
      const forms = (r: string) => [r, r.replace(/^0/, '')];
      if (bits.some((b) => forms(c.rwy).includes(b))) return 'heard';
      return c.others.some((o) => bits.some((b) => forms(o).includes(b))) ? 'wrong' : 'missing';
    }
    case 'holdShort': {
      if (!hasPhrase(h.text, ['hold short', 'holding short', 'hold short of', 'holding short of'])) return 'missing';
      return evaluate({ k: 'runway', rwy: c.rwy, others: [] }, x) === 'heard' ? 'heard' : 'missing';
    }
    case 'cross': {
      if (!hasPhrase(h.text, ['cross', 'crossing', 'cleared to cross'])) return 'missing';
      return evaluate({ k: 'runway', rwy: c.rwy, others: [] }, x) === 'heard' ? 'heard' : 'missing';
    }
    case 'route': {
      const want = c.taxiways.map((t) => t.toLowerCase());
      const ok = [...want, ...(c.allowed ?? []).map((t) => t.toLowerCase())];
      const said = bits.filter((b) => TAXIWAY_IDS.includes(b));
      if (said.some((s) => !ok.includes(s))) return 'wrong';
      return want.every((w) => said.includes(w)) ? 'heard' : 'missing';
    }
    case 'taxiway':
      return bits.includes(c.id.toLowerCase()) ? 'heard' : 'missing';
    case 'number': {
      const v = c.value;
      return bits.some((b) => b === v || (c.loose && b.replace('.', '') === v.replace('.', ''))) ? 'heard' : 'missing';
    }
    case 'frequency': {
      const tail = c.mhz.replace(/0+$/, '').slice(c.mhz.indexOf('.'));
      const full = c.mhz.replace(/0+$/, '');
      return x.runs.some((r) => r.includes(full) || r.includes(full.replace('.', '')) || r.endsWith(tail)) ? 'heard' : 'missing';
    }
    case 'all': {
      const rs = c.of.map((o) => evaluate(o, x));
      return rs.includes('wrong') ? 'wrong' : rs.every((r) => r === 'heard') ? 'heard' : 'missing';
    }
    case 'any': {
      const rs = c.of.map((o) => evaluate(o, x));
      return rs.includes('heard') ? 'heard' : rs.includes('wrong') ? 'wrong' : 'missing';
    }
    case 'never':
      return hasPhrase(h.text, c.any) ? 'wrong' : 'heard';
  }
}

const RANK: Record<Grade, number> = { best: 0, acceptable: 1, marginal: 2, unsafe: 3 };
const worse = (a: Grade, b: Grade) => (RANK[a] >= RANK[b] ? a : b);

/** One item's effect on the grade: a must left out is marginal, a must said wrong is unsafe. */
export function itemGrade(r: ItemResult): Grade {
  if (r.outcome === 'heard') return 'best';
  if (r.item.need === 'must') return r.outcome === 'wrong' && !r.item.mild ? 'unsafe' : 'marginal';
  return r.outcome === 'wrong' ? 'marginal' : 'acceptable';
}

export function gradeCall(raw: string, items: Item[], callsign: { full: string; short: string }): CallResult {
  const h = hear(raw);
  const runs = withoutCallsign(h, callsign.full, callsign.short);
  const x: Ctx = { h, runs, bits: runs.flatMap(pieces) };
  const results = items.map((item) => ({ item, outcome: evaluate(item.check, x) }));
  const grade = results.reduce<Grade>((g, r) => worse(g, itemGrade(r)), 'best');
  // The controller stops you for the first wrong must, else the first missing must with a fix.
  const stop = results.find((r) => r.outcome === 'wrong' && r.item.need === 'must' && r.item.fix)
    ?? results.find((r) => r.outcome === 'missing' && r.item.need === 'must' && r.item.fix);
  return { items: results, grade, fix: stop?.item.fix ?? null, heard: h, words: h.words };
}

/** True when a call runs well past the model call: worth a word on brevity, never graded. */
export function wordy(r: CallResult, modelWords: number): boolean {
  return modelWords > 0 && r.heard.words > modelWords * 1.8 + 4;
}
