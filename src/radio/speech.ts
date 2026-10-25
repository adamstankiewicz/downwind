// Turning a written transmission into the words a controller says. The copy
// is written the way a pilot writes it down ("runway 24", "Cessna 2XY",
// "Ground 121.8", "altimeter 30.08"); a voice reading that aloud would say
// "twenty-four" and "two X Y". Controllers say digits one at a time, letters
// phonetically and nine as "niner", and give altitudes in thousands and
// hundreds. The written text stays the source; this is only how it sounds.

import { SAY_LETTER } from './phrase';

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

/** One digit at a time: 24 is "two four", 121.8 is "one two one point eight". */
export function digits(s: string): string {
  return [...s].map((c) => (c === '.' ? 'point' : DIGIT[Number(c)] ?? '')).filter(Boolean).join(' ');
}

/** An altitude in thousands and hundreds: 6100 is "six thousand one hundred", 2500 "two thousand five hundred". */
export function altitude(n: number): string {
  const th = Math.floor(n / 1000);
  const hu = Math.round((n % 1000) / 100);
  return [th ? `${th >= 10 ? digits(String(th)) : DIGIT[th]} thousand` : '', hu ? `${DIGIT[hu]} hundred` : ''].filter(Boolean).join(' ');
}

const letter = (c: string) => SAY_LETTER[c.toLowerCase()] ?? c;

/**
 * The spoken form of a transmission. Call signs and other letter-digit
 * groups ("2XY", "N52XY", "A4") are spelled out, numbers with a comma or
 * that follow "at" in a cloud or altitude are said as altitudes, and every
 * other number is said a digit at a time.
 */
export function spoken(text: string): string {
  return text
    // An altimeter setting drops its point: "30.08" is "three zero zero eight".
    .replace(/\b(altimeter )(\d\d)\.(\d\d)\b/gi, (_, w: string, a: string, b: string) => `${w}${digits(a + b)}`)
    // Altitudes written with a comma: "6,100", "2,500".
    .replace(/\b(\d{1,2}),(\d00)\b/g, (_, a: string, b: string) => altitude(Number(a + b)))
    // Call signs and mixed groups: "2XY", "N52XY". A capital letter on its own after digits.
    .replace(/\b([0-9]+[A-Z]+|N[0-9]+[A-Z]*)\b/g, (m: string) => [...m].map((c) => (/\d/.test(c) ? DIGIT[Number(c)] : letter(c))).join(' '))
    // Numbers, decimals included: "121.8", "30.08", "24", "1353".
    .replace(/\b\d+(?:\.\d+)?\b/g, (m: string) => digits(m))
    .replace(/\bZulu\b/g, 'zulu');
}
