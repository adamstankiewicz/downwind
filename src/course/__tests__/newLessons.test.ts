import { describe, expect, it } from 'vitest';
import { KASH } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { expectedIntensity, feltInLight, gradeHazard } from '../../lib/hazards';
import { APPROACH_ILLUSIONS, gradeIllusion } from '../../lib/illusions';
import { courseToStation, gradeIdent, gradeVorTurn, morse, reverseSensing, turnToCourse, vorIndication } from '../../lib/vor';
import { hazardsLesson, routeHazard } from '../hazards';
import { illusionScene, illusionsLesson } from '../illusions';
import { lessonContext } from '../practice';
import { checkBlank } from '../progress';
import { variantCount } from '../variant';
import { DIAL_RADIAL, vorCase, vorLesson } from '../vor';
import { initialValues } from '../dials';
import type { Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field, sample airplane', lessonContext(KASH, sampleC172K, mins, NOW)],
] as const;
const decide = (steps: Step[]) => steps.find((s) => s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;

describe('the VOR', () => {
  it('reads TO and FROM from where the airplane is, not where it points', () => {
    expect(vorIndication(210, 30)).toMatchObject({ flag: 'TO', needleDeg: 0 });
    expect(vorIndication(210, 210)).toMatchObject({ flag: 'FROM', needleDeg: 0 });
    expect(vorIndication(210, 120).flag).toBe('OFF');
    expect(courseToStation(205)).toBe(25);
  });

  it('swings the needle toward the course line', () => {
    // On the 190 radial with 360 TO set, you are west of the inbound course: it is to your right.
    expect(vorIndication(190, 360).needleDeg).toBe(10);
    // On the 010 radial with 360 FROM set, you are east of the outbound course: it is to your left.
    expect(vorIndication(10, 360).needleDeg).toBe(-10);
    expect(vorIndication(205, 20)).toMatchObject({ flag: 'TO', needleDeg: 5 });
  });

  it('knows reverse sensing and which way to turn', () => {
    expect(reverseSensing(20, 200)).toBe(true);
    expect(reverseSensing(20, 20)).toBe(false);
    expect(turnToCourse(205, 20, 20)).toBe('right');
    // Same place, OBS set to the radial, flying inbound: the needle says left, the course is right.
    expect(vorIndication(205, 200).needleDeg).toBeLessThan(0);
    expect(turnToCourse(205, 200, 20)).toBe('right');
    expect(gradeVorTurn(205, 200, 20).grades).toMatchObject({ reset: 'best', right: 'acceptable', left: 'marginal' });
    expect(gradeVorTurn(205, 20, 20).grades).toMatchObject({ right: 'best', reset: 'acceptable' });
  });

  it('never trusts a station that does not identify (AIM 1-1-11)', () => {
    expect(gradeIdent('test')['fly-it']).toBe('unsafe');
    expect(gradeIdent('none')['fly-it']).toBe('unsafe');
    expect(gradeIdent('station')['fly-it']).toBe('best');
    expect(morse('TEST')).toBe('-  .  ...  -');
  });

  it('writes each situation for the grade the engine gives', () => {
    for (let v = 0; v < variantCount(vorLesson); v++) {
      const c = vorCase(v);
      const g = c.kind === 'turn' ? gradeVorTurn(c.radial, c.obs, c.heading).grades : gradeIdent('test');
      expect(g, `v${v}`).toEqual(c.intended);
    }
  });

  it('has an OBS dial whose task is the course to the station', () => {
    const steps = vorLesson.build(contexts[0][1]);
    const w = steps.find((s) => s.kind === 'dials') as Extract<Step, { kind: 'dials' }>;
    expect(w.task!.check({ obs: courseToStation(DIAL_RADIAL) }).right).toBe(true);
    expect(w.task!.check({ obs: DIAL_RADIAL }).right).toBe(false);
    expect(w.evaluate(initialValues(w)).verdict.grades.fly).toBe('marginal');
    expect(w.evaluate({ obs: 25 }).verdict.grades.fly).toBe('best');
    expect(w.evaluate({ obs: 205 }).lines[0].id).toBe('from');
  });
});

describe('en route hazards', () => {
  it('reads a large airplane\'s intensity a step harder in a light one (AIM 7-1-21)', () => {
    expect(feltInLight({ intensity: 'moderate', aircraft: 'large', altFt: 6000 })).toBe('severe');
    expect(feltInLight({ intensity: 'light', aircraft: 'large', altFt: 6000 })).toBe('moderate');
    expect(feltInLight({ intensity: 'moderate', aircraft: 'light', altFt: 6000 })).toBe('moderate');
    expect(expectedIntensity({ advisory: 'airmet-tango', pireps: [], avoidable: true })).toBe('moderate');
  });

  it('never lets a pilot beat a line of storms', () => {
    expect(gradeHazard({ advisory: 'convective-sigmet', pireps: [], avoidable: false })).toMatchObject({ go: 'unsafe', deviate: 'unsafe', delay: 'best' });
    expect(gradeHazard({ advisory: 'airmet-sierra', pireps: [], avoidable: false })).toMatchObject({ go: 'unsafe', delay: 'best' });
  });

  it('writes each situation for the grade the engine gives', () => {
    for (let v = 0; v < variantCount(hazardsLesson); v++) {
      const rh = routeHazard(v);
      expect(gradeHazard(rh.hazard), `v${v}`).toEqual(rh.intended);
    }
  });

  it('has a different best call across its situations', () => {
    const best = Array.from({ length: variantCount(hazardsLesson) }, (_, v) => {
      const g = gradeHazard(routeHazard(v).hazard);
      return Object.keys(g).find((k) => g[k as keyof typeof g] === 'best');
    });
    expect(new Set(best).size).toBeGreaterThanOrEqual(3);
  });
});

describe('illusions', () => {
  it('follows AIM 8-1-5 on which way each one pushes', () => {
    expect(APPROACH_ILLUSIONS.narrow.tendency).toBe('low');
    expect(APPROACH_ILLUSIONS.upslope.tendency).toBe('low');
    expect(APPROACH_ILLUSIONS.featureless.tendency).toBe('low');
    expect(APPROACH_ILLUSIONS.haze.tendency).toBe('low');
    expect(APPROACH_ILLUSIONS.wide.tendency).toBe('high');
    expect(APPROACH_ILLUSIONS.downslope.tendency).toBe('high');
  });

  it('grades the fix, not the feeling', () => {
    expect(gradeIllusion({ kind: 'black-hole', vgsi: true, litAlternateNm: null })).toMatchObject({ papi: 'best', picture: 'unsafe' });
    expect(gradeIllusion({ kind: 'dark-takeoff' })).toMatchObject({ push: 'unsafe', instruments: 'best' });
  });

  it('writes each situation for the grade the engine gives', () => {
    for (let v = 0; v < variantCount(illusionsLesson); v++) {
      const sc = illusionScene(v);
      const g = gradeIllusion(sc.ill);
      for (const id of Object.keys(sc.labels)) expect(g[id as keyof typeof g], `v${v} ${id}`).toBe(sc.intended[id as keyof typeof sc.intended]);
    }
  });
});

describe('the new lessons build cleanly', () => {
  for (const l of [hazardsLesson, vorLesson, illusionsLesson]) {
    for (const [name, ctx] of contexts) {
      it(`${l.id} for ${name}`, () => {
        for (let v = 0; v < variantCount(l); v++) {
          const steps = l.build({ ...ctx, variant: v });
          expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
          for (const s of steps) {
            if (s.kind === 'turn') for (const b of s.blanks) expect(checkBlank(b, String(b.answer)), `${l.id} v${v} ${b.id}`).toBe(true);
          }
          const d = decide(steps);
          for (const o of d.options) {
            expect(d.consequence[o.id], `${l.id} v${v} ${o.id}`).toBeTruthy();
            expect(d.grades[o.id], `${l.id} v${v} ${o.id}`).toBeTruthy();
          }
          expect(Object.values(d.grades)).toContain('best');
          const text = JSON.stringify(steps);
          expect(text).not.toMatch(/—|!|undefined|NaN/);
          expect(text).not.toMatch(/KASH|Cessna|C172|Skyhawk/);
        }
      });
    }
  }
});
