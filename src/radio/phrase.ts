// Reading a typed radio call. Pilots type calls the way they say them
// ("November five two x-ray yankee, runway two four, cleared for takeoff") or
// the way they write them ("N52XY rwy 24 cleared for takeoff"), so both are
// folded into one form before anything is graded: phonetic letters become
// letters, spoken numbers become digits, and runs of letters and digits that
// were spoken one at a time are joined back together ("2 4" is "24",
// "alpha 4" is "a4"). Grading then reads that form, never the raw text.

const PHONETIC: Record<string, string> = {
  alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h',
  india: 'i', juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p',
  quebec: 'q', romeo: 'r', sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', xray: 'x',
  yankee: 'y', zulu: 'z',
};

/** The phonetic word for a letter, as written in a transmission. */
export const SAY_LETTER: Record<string, string> = Object.fromEntries(
  Object.entries(PHONETIC).filter(([w]) => !['alfa', 'juliett'].includes(w)).map(([w, l]) => [l, w === 'xray' ? 'X-ray' : w[0].toUpperCase() + w.slice(1)]),
);

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, tree: 3, four: 4, five: 5, fife: 5, six: 6, seven: 7, eight: 8, nine: 9, niner: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };
const isNumberWord = (w: string) => w in UNITS || w in TEENS || w in TENS || w in SCALES;

type Tok = { kind: 'word'; w: string } | { kind: 'ch'; c: string };

/**
 * Digits for a run of spoken number words. Digits said one at a time are
 * strung together ("two four" is 24, "one two one point eight" is 121.8); a
 * group with "hundred" or "thousand" is added up ("two thousand five hundred"
 * is 2500); "twenty four" is 24.
 */
function numberWords(ws: string[]): string {
  if (ws.some((w) => w in SCALES)) {
    let total = 0;
    let cur = 0;
    for (const w of ws) {
      if (w in UNITS) cur += UNITS[w];
      else if (w in TEENS) cur += TEENS[w];
      else if (w in TENS) cur += TENS[w];
      else if (w === 'hundred') cur = (cur || 1) * 100;
      else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
    }
    return String(total + cur);
  }
  let out = '';
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w in UNITS) out += UNITS[w];
    else if (w in TEENS) out += TEENS[w];
    else if (w in TENS) {
      const next = ws[i + 1];
      if (next !== undefined && next in UNITS && UNITS[next] > 0) { out += TENS[w] + UNITS[next]; i++; } else out += TENS[w];
    }
  }
  return out;
}

function tokenize(raw: string): Tok[] {
  const text = raw
    .replace(/x-ray/gi, 'xray')
    .replace(/(\d),(\d{3})/g, '$1$2')
    // A capital A on its own is a taxiway or a letter; a lower-case a is an article.
    .replace(/(^|[^A-Za-z0-9])A(?=$|[^A-Za-z0-9])/g, '$1alpha')
    .toLowerCase();
  const words = text.split(/[^a-z0-9.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  const out: Tok[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (isNumberWord(w)) {
      const group: string[] = [];
      while (i < words.length && (isNumberWord(words[i]) || ((words[i] === 'point' || words[i] === 'decimal') && group.length > 0 && i + 1 < words.length && isNumberWord(words[i + 1])))) {
        group.push(words[i]);
        i++;
      }
      i--;
      // "point" splits the group: one two one point eight.
      const parts: string[][] = [[]];
      for (const g of group) {
        if (g === 'point' || g === 'decimal') parts.push([]);
        else parts[parts.length - 1].push(g);
      }
      const digits = parts.map(numberWords).join('.');
      for (const c of digits) out.push({ kind: 'ch', c });
    } else if ((w === 'point' || w === 'decimal') && i + 1 < words.length && (isNumberWord(words[i + 1]) || /^\d/.test(words[i + 1]))) {
      // "point eight" on its own, as a frequency is often given.
      out.push({ kind: 'ch', c: '.' });
    } else if (w in PHONETIC) {
      out.push({ kind: 'ch', c: PHONETIC[w] });
    } else if (/\d/.test(w) || (w.length === 1 && w !== 'a' && w !== 'i')) {
      for (const c of w) out.push({ kind: 'ch', c });
    } else {
      out.push({ kind: 'word', w });
    }
  }
  return out;
}

export interface Heard {
  /** The call in folded form: words, with spelled-out runs joined ("ready to taxi with information e"). */
  text: string;
  /** Joined runs of letters and digits, as typed or spoken one at a time ("n52xy", "24", "a4", "121.8"). */
  runs: string[];
  /** Number of words the pilot used, for brevity. */
  words: number;
}

export function hear(raw: string): Heard {
  const toks = tokenize(raw);
  const parts: string[] = [];
  const runs: string[] = [];
  let run = '';
  const flush = () => {
    if (run) { parts.push(run); runs.push(run); run = ''; }
  };
  for (const t of toks) {
    if (t.kind === 'ch') run += t.c;
    else { flush(); parts.push(t.w); }
  }
  flush();
  return { text: parts.join(' '), runs, words: raw.trim() ? raw.trim().split(/\s+/).length : 0 };
}

/**
 * Splits a run into the pieces a controller would hear: numbers (with a
 * decimal point, if any) and letters, each letter keeping the digits that
 * follow it ("24a4" is "24" and "a4").
 */
export function pieces(run: string): string[] {
  return run.match(/[a-z]\d*|\d+(?:\.\d+)?|\.\d+/g) ?? [];
}

/** True when `text` has any of the phrases as whole words. */
export function hasPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => new RegExp(`(^| )${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($| )`).test(text));
}

/** The digits of a number said the way a controller says it: 24 is "two four", 2500 is "two thousand five hundred". */
export function sayDigits(s: string): string {
  const names = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  return [...s].map((c) => (c === '.' ? 'point' : names[Number(c)] ?? c)).join(' ');
}
