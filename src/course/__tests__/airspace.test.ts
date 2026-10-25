import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { practiceRegion as R, withVolumes } from '../../chart/practiceRegion';
import { checkPlan, distanceToShape, gradePlans, profileAlong, replyPermits, type Plan } from '../../scenarios/airspacePlan';
import { destination } from '../../lib/nav';
import { airspaceLessons, callSign } from '../airspace';
import { lessonContext } from '../practice';
import { checkBlank, scoreLesson } from '../progress';
import { modules } from '../modules';
import type { Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, airspace: 'G', runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };

const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', lessonContext(KASH, sampleC172K, mins, NOW)],
  ['tight minimums, tail number set', lessonContext(highField, { ...sampleC172K, tailNumber: 'n4021q' }, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
] as const;

const decide = (steps: Step[]) => steps.find((s) => s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const ap = (id: string) => R.airports.find((a) => a.id === id)!.pos;
const at = (id: string) => R.checkpoints.find((c) => c.id === id)!.pos;

describe.each(contexts)('module 4 lessons: %s', (_name, ctx) => {
  it.each(airspaceLessons.map((l) => [l.id, l] as const))('%s builds valid steps', (_id, lesson) => {
    const steps = lesson.build(ctx);
    expect(steps.length).toBeGreaterThan(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps.map((s) => s.kind)).toEqual(expect.arrayContaining(['brief', 'example', 'turn', 'decide']));
    for (const s of steps) {
      if (s.kind === 'turn') {
        for (const b of s.blanks) {
          if (typeof b.answer === 'number') expect(Number.isFinite(b.answer)).toBe(true);
          else expect(b.choices).toContain(b.answer);
          expect(checkBlank(b, String(b.answer))).toBe(true);
          expect(b.explain).toBeTruthy();
        }
      }
      if (s.kind === 'decide') {
        expect(s.options.length).toBeGreaterThanOrEqual(3);
        expect(s.options.length).toBeLessThanOrEqual(4);
        for (const o of s.options) {
          expect(s.grades[o.id]).toBeTruthy();
          expect(s.consequence[o.id]).toBeTruthy();
        }
        expect(Object.values(s.grades)).toContain('best');
      }
      // House style: no em dashes or exclamation marks in what the instructor says.
      const text = JSON.stringify(s);
      expect(text).not.toMatch(/—/);
      expect(text).not.toMatch(/[a-z]!(\s|")/);
    }
  });

  it('never names the pilot\'s field as if it were on the practice chart', () => {
    for (const l of airspaceLessons) {
      const briefs = l.build(ctx).filter((s) => s.kind === 'brief');
      const text = JSON.stringify(briefs);
      if (ctx.practiceField) expect(text).not.toMatch(/your own sectional/);
      else expect(text).toContain(ctx.airport.icao);
    }
  });
});

describe('module 4 teaches what it says', () => {
  const ctx = contexts[0][1];
  const grades = (i: number) => decide(airspaceLessons[i].build(ctx)).grades;

  it('4.1 grades altitude by the maximum elevation figure and the cruising altitude rule', () => {
    expect(grades(0)).toEqual({ 'alt-2500': 'marginal', 'alt-3500': 'acceptable', 'alt-4500': 'best', 'alt-5500': 'unsafe' });
    const d = decide(airspaceLessons[0].build(ctx));
    expect(d.consequence['alt-5500']).toMatch(/91\.159/);
  });

  it('4.2 keeps you out of Class D until the tower says your call sign', () => {
    const g = grades(1);
    expect(g.continue).toBe('unsafe');
    expect(g.hold).toBe('best');
    expect(g.over).toBe('acceptable');
    expect(['best', 'acceptable']).toContain(g.around);
    expect(decide(airspaceLessons[1].build(ctx)).consequence.continue).toMatch(/91\.129/);
  });

  it('4.3 makes "remain outside" binding, and the inner ring unavoidable', () => {
    expect(grades(2)).toEqual({ continue: 'unsafe', hold: 'best', under: 'unsafe', elsewhere: 'acceptable' });
  });

  it('4.4 separates a squawk from a clearance and rewards a real margin under the shelf', () => {
    expect(grades(3)).toEqual({ continue: 'unsafe', ask: 'best', below: 'best', squeeze: 'marginal' });
    const t = airspaceLessons[3].build(ctx).find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
    expect(t.blanks.find((b) => b.id === 'floor')!.answer).toBe(3000);
    expect(t.blanks.find((b) => b.id === 'veil')!.answer).toBe('No');
  });

  it('4.5 routes around the TFR without running into the restricted area', () => {
    expect(grades(4)).toEqual({ direct: 'unsafe', west: 'best', east: 'unsafe', over: 'best' });
    const d = decide(airspaceLessons[4].build(ctx));
    expect(d.consequence.east).toMatch(/R-4101/);
    expect(d.figure?.kind === 'chart' && d.figure.extra?.[0].cls).toBe('TFR');
  });

  it('scores a lesson by its worst decision', () => {
    const steps = airspaceLessons[3].build(ctx);
    expect(scoreLesson(steps, { blanks: {}, decisions: { d1: { choice: 'continue' } } }).grade).toBe('unsafe');
    expect(scoreLesson(steps, { blanks: {}, decisions: { d1: { choice: 'below' } } }).grade).toBe('best');
  });

  it('uses the pilot\'s own tail number on the radio when there is one', () => {
    expect(callSign(contexts[0][1])).toBe('Practice 345');
    expect(callSign(contexts[2][1])).toBe('N4021Q');
    const text = JSON.stringify(airspaceLessons[1].build(contexts[2][1]));
    expect(text).toContain('N4021Q, stand by.');
  });

  it('lists module 4 as written', () => {
    const m = modules.find((x) => x.n === 4)!;
    expect(m.lessons.map((l) => l.id)).toEqual(['4.1', '4.2', '4.3', '4.4', '4.5']);
    expect(m.outline).toEqual([]);
  });
});

describe('radio replies', () => {
  it('needs your call sign for C and D, and "remain outside" overrides it', () => {
    expect(replyPermits('Practice 345, stand by.', 'Practice 345', 'D')).toBe(true);
    expect(replyPermits('Aircraft calling Practice field Tower, stand by.', 'Practice 345', 'D')).toBe(false);
    expect(replyPermits('Practice 345, Quarry Approach, remain outside the Class Charlie airspace and stand by.', 'Practice 345', 'C')).toBe(false);
  });
  it('needs the words "cleared into" for Class B', () => {
    expect(replyPermits('Practice 345, squawk 0412.', 'Practice 345', 'B')).toBe(false);
    expect(replyPermits('Practice 345, cleared into the Class Bravo airspace, maintain 3,500.', 'Practice 345', 'B')).toBe(true);
    expect(replyPermits('Practice 345, cleared into the Class Bravo airspace. Remain clear of the final.', 'Practice 345', 'B')).toBe(false);
  });
});

describe('plan check', () => {
  const plan = (p: Partial<Plan>): Plan => ({ id: 'p', start: ap('KXYZ'), startAltMsl: 3500, legs: [{ to: at('plant'), altMsl: 3500 }], cleared: ['xyz-d'], transponder: true, ...p });

  it('finds the Class B shelf on the way to the plant and cites 91.131', () => {
    const c = checkPlan(R, plan({}));
    expect(c.entered).toContain('xbb-b2');
    expect(c.violations[0]).toMatchObject({ ref: '14 CFR 91.131', volumeId: 'xbb-b2' });
  });

  it('measures the margin under a shelf', () => {
    const c = checkPlan(R, plan({ startAltMsl: 2500, legs: [{ to: at('plant'), altMsl: 2500 }] }));
    expect(c.violations).toEqual([]);
    expect(c.verticalMarginFt).toBe(500);
  });

  it('needs a transponder inside the veil', () => {
    const c = checkPlan(R, plan({ startAltMsl: 2500, legs: [{ to: at('plant'), altMsl: 2500 }], transponder: false }));
    expect(c.violations.map((v) => v.id)).toContain('veil');
  });

  it('treats a restricted area as cold unless it is active', () => {
    const r = R.airspace.find((v) => v.id === 'r-4101')!;
    const pts = r.shape.kind === 'polygon' ? r.shape.points : [];
    const p = plan({ start: pts[0], startAltMsl: 3000, legs: [{ to: pts[2], altMsl: 3000 }] });
    expect(checkPlan(R, p).violations).toEqual([]);
    expect(checkPlan(R, p, ['r-4101']).violations[0].ref).toBe('14 CFR 91.133');
    expect(checkPlan(R, { ...p, cleared: ['r-4101'] }, ['r-4101']).violations).toEqual([]);
  });

  it('applies the cruising altitude rule only above 3,000 ft AGL', () => {
    // Westbound from the field: 3,500 is under 3,000 AGL here, 5,500 is not and is an eastbound altitude.
    const west = destination(ap('KXYZ'), 270, 10);
    expect(checkPlan(R, plan({ legs: [{ to: west, altMsl: 3500 }] })).violations.map((v) => v.id)).not.toContain('hemispheric');
    expect(checkPlan(R, plan({ startAltMsl: 5500, legs: [{ to: west, altMsl: 5500 }] })).violations.map((v) => v.id)).toContain('hemispheric');
  });

  it('prefers the quicker of two sound plans and caps a plan that gives up the trip', () => {
    const quick = plan({ id: 'quick', startAltMsl: 2500, legs: [{ to: at('plant'), altMsl: 2500 }] });
    const slow = { ...quick, id: 'slow', delayMin: 30 };
    const quit = { ...quick, id: 'quit', reachesGoal: false };
    const { grades } = gradePlans(R, [quick, slow, quit]);
    expect(grades).toEqual({ quick: 'best', slow: 'acceptable', quit: 'acceptable' });
  });

  it('measures distance to the edge of each shape', () => {
    const d = R.airspace.find((v) => v.id === 'xyz-d')!;
    expect(distanceToShape(destination(ap('KXYZ'), 90, 6.3), d.shape)).toBeCloseTo(2, 1);
    expect(distanceToShape(ap('KXYZ'), d.shape)).toBe(0);
  });

  it('draws the side view with the shelves in order', () => {
    const p = profileAlong(R, plan({}));
    const b = p.bands.filter((x) => x.cls === 'B');
    expect(b.map((x) => x.volumeId)).toEqual(['xbb-b2', 'xbb-b3'].filter((id) => b.some((x) => x.volumeId === id)));
    const shelf = b.find((x) => x.volumeId === 'xbb-b2')!;
    expect(shelf.floorMsl).toBe(3000);
    expect(shelf.toNm).toBeCloseTo(p.distanceNm, 0);
    expect(p.bands.find((x) => x.volumeId === 'xyz-d')).toMatchObject({ fromNm: 0, surface: true, ceilingMsl: 3100 });
  });

  it('adds lesson volumes without changing the chart', () => {
    const extra = { ...R.airspace[0], id: 'x', cls: 'TFR' as const };
    expect(withVolumes(R, [extra]).airspace).toHaveLength(R.airspace.length + 1);
    expect(withVolumes(R).airspace).toBe(R.airspace);
  });

  it('levels the ground to each field\'s elevation', () => {
    for (const a of R.airports) expect(R.groundFt(a.pos)).toBe(a.elevationFt);
  });
});

describe.each(contexts)('module 4 situations: %s', (_name, ctx) => {
  const g = (id: string, variant: number) => decide(airspaceLessons.find((l) => l.id === id)!.build({ ...ctx, variant })).grades;
  it('the right altitude follows the direction and the ground', () => {
    expect(g('4.1', 0)['alt-4500']).toBe('best');
    expect(g('4.1', 1)).toMatchObject({ 'alt-4500': 'unsafe', 'alt-5500': 'best' });
    expect(g('4.1', 2)['alt-3500']).toBe('best');
  });
  it('the controller\'s exact words decide whether you go in', () => {
    expect(g('4.2', 0)).toMatchObject({ continue: 'unsafe', hold: 'best' });
    expect(g('4.2', 1)).toMatchObject({ continue: 'best', hold: 'acceptable' });
    expect(g('4.2', 2)).toMatchObject({ continue: 'unsafe', hold: 'acceptable', around: 'best' });
    expect(g('4.3', 0)).toMatchObject({ continue: 'unsafe', hold: 'best' });
    expect(g('4.3', 1)).toMatchObject({ continue: 'best', hold: 'acceptable' });
    expect(g('4.4', 0)).toMatchObject({ continue: 'unsafe', below: 'best' });
    expect(g('4.4', 1)).toMatchObject({ continue: 'best', below: 'unsafe', squeeze: 'unsafe' });
  });
  it('the briefing decides which way around', () => {
    expect(g('4.5', 0)).toMatchObject({ west: 'best', east: 'unsafe', over: 'best' });
    expect(g('4.5', 1)).toMatchObject({ west: 'best', east: 'best' });
    expect(g('4.5', 2)).toMatchObject({ west: 'best', over: 'unsafe' });
  });
});
