import { describe, expect, it } from 'vitest';
import { migrateCourse, migrateReview, renumberCardId, renumberLessonId } from '../migrate';

describe('moving the oral from module 9 to 11', () => {
  it('renumbers lesson and card ids, and nothing else', () => {
    expect(renumberLessonId('9.2')).toBe('11.2');
    expect(renumberLessonId('1.9')).toBe('1.9');
    expect(renumberLessonId('19.1')).toBe('19.1');
    expect(renumberCardId('L:9.1:d1')).toBe('L:11.1:d1');
    expect(renumberCardId('L:4.9:d1')).toBe('L:4.9:d1');
    expect(renumberCardId('wx-ceiling')).toBe('wx-ceiling');
  });

  it('carries progress and review history across', () => {
    expect(migrateCourse({ '9.1': { a: 1 }, '2.1': { a: 2 } })).toEqual({ '11.1': { a: 1 }, '2.1': { a: 2 } });
    const r = migrateReview({ cards: { 'L:9.3:d1': { s: 1 } }, history: [{ id: 'L:9.3:d1' }, { id: 'q1' }] });
    expect(r).toEqual({ cards: { 'L:11.3:d1': { s: 1 } }, history: [{ id: 'L:11.3:d1' }, { id: 'q1' }] });
  });
});
