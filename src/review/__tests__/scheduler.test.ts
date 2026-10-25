import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { ratingFor, thinkingSeconds, wordsIn } from '../scheduler';
import { reviewItems } from '../items';

describe('review rating from the answer', () => {
  const base = { correct: true, seconds: 10, words: 20 };
  it('takes off reading time before judging speed', () => {
    expect(thinkingSeconds(base)).toBe(5);
  });
  it('rates a quick right answer Easy, a normal one Good, a slow one Hard', () => {
    expect(ratingFor(base)).toBe(Rating.Easy);
    expect(ratingFor({ ...base, seconds: 20 })).toBe(Rating.Good);
    expect(ratingFor({ ...base, seconds: 40 })).toBe(Rating.Hard);
  });
  it('rates a right answer that needed help Hard', () => {
    expect(ratingFor({ ...base, usedHelp: true })).toBe(Rating.Hard);
  });
  it('rates any miss Again', () => {
    expect(ratingFor({ ...base, correct: false })).toBe(Rating.Again);
    expect(ratingFor({ ...base, correct: false, unsafe: true })).toBe(Rating.Again);
  });
  it('never marks the right answer as an unsafe option', () => {
    for (const i of reviewItems) {
      expect(i.unsafeOptions?.includes(i.answer) ?? false, i.id).toBe(false);
      for (const o of i.unsafeOptions ?? []) expect(o, i.id).toBeLessThan(i.options.length);
      expect(wordsIn(i)).toBeGreaterThan(5);
    }
  });
});
