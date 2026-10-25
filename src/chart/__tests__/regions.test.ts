import { describe, expect, it } from 'vitest';
import { blankAircraft } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { positionAt } from '../../lib/airspace';
import { allLessons } from '../../course/modules';
import { lessonContext } from '../../course/practice';
import { variantCount } from '../../course/variant';
import { lakesRegion } from '../lakesRegion';
import { anyChartAirport, regionById, regions } from '../regions';

describe('the practice sectionals', () => {
  it('keeps every id unique across charts, so a figure can name any of them', () => {
    const ids = regions.flatMap((r) => [...r.airports.map((a) => a.id), ...r.checkpoints.map((c) => c.id), ...r.airspace.map((v) => v.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(anyChartAirport('KWVA')?.name).toBe('Westvale Regional');
    expect(regionById(undefined).id).toBe('practice');
  });

  it('levels the ground to each field on the lake country chart', () => {
    for (const a of lakesRegion.airports) expect(lakesRegion.groundFt(a.pos), a.id).toBe(a.elevationFt);
  });

  it('puts the right airspace over the lake country fields', () => {
    const at = (id: string, alt: number) => {
      const a = lakesRegion.airports.find((x) => x.id === id)!;
      return positionAt(lakesRegion.airspace, a.pos, alt, a.elevationFt, lakesRegion.veils).cls;
    };
    expect(at('KWVA', 2000)).toBe('D');
    expect(at('KWCP', 2000)).toBe('C');
    expect(at('KWLN', 500)).toBe('E');
    expect(at('KWFB', 1200)).toBe('G');
    expect(at('KWFB', 1600)).toBe('E');
  });

  it('flies some lesson situations on the second chart', () => {
    const ctx = lessonContext(null, blankAircraft, defaultPilot.minimums, new Date(Date.UTC(2026, 9, 24, 16)));
    const onLakes = allLessons.flatMap((l) => Array.from({ length: variantCount(l) }, (_, v) => ({ l, v })))
      .filter(({ l, v }) => l.build({ ...ctx, variant: v }).some((s) => 'figure' in s && s.figure && 'region' in s.figure && s.figure.region === 'lakes'))
      .map(({ l, v }) => `${l.id} v${v}`);
    expect(onLakes).toEqual(expect.arrayContaining(['4.1 v3', '4.1 v4', '5.1 v2']));
  });
});
