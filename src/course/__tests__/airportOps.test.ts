import { describe, expect, it } from 'vitest';
import { KASH } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { gradeLightOnFinal, gradeTaxi, gradeWake, LIGHT_MEANS, rightOfWay } from '../../lib/airportOps';
import { airportOpsLessons, wakeCase } from '../airportOps';
import { lessonContext } from '../practice';
import { checkBlank } from '../progress';
import { modules } from '../modules';
import type { Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const contexts = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field, sample airplane', lessonContext(KASH, sampleC172K, mins, NOW)],
] as const;
const decide = (steps: Step[]) => steps.find((s) => s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const lesson = (id: string) => airportOpsLessons.find((l) => l.id === id)!;

describe('airport operations rules', () => {
  it('needs an explicit clearance for every runway crossing (AIM 4-3-18)', () => {
    expect(gradeTaxi({ kind: 'runway-crossing', runway: '6-24', crossingCleared: false })).toMatchObject({ continue: 'unsafe', 'look-go': 'unsafe', 'stop-call': 'best' });
    expect(gradeTaxi({ kind: 'runway-crossing', runway: '6-24', crossingCleared: true })['look-go']).toBe('best');
    expect(gradeTaxi({ kind: 'ils-hold', toldToHold: false }).continue).toBe('best');
    expect(gradeTaxi({ kind: 'ils-hold', toldToHold: true }).continue).toBe('unsafe');
    expect(gradeTaxi({ kind: 'lost' })['stop-call']).toBe('best');
  });

  it('reads the light gun differently on the ground and in the air (91.125)', () => {
    expect(LIGHT_MEANS['flashing-green'].ground).toBe('Cleared to taxi');
    expect(LIGHT_MEANS['steady-red'].air).toMatch(/continue circling/);
    expect(gradeLightOnFinal('steady-green').land).toBe('best');
    expect(gradeLightOnFinal('steady-red')).toMatchObject({ land: 'unsafe', circle: 'best' });
    expect(gradeLightOnFinal('flashing-red')).toMatchObject({ land: 'unsafe', divert: 'best' });
  });

  it('applies 91.113 in order: distress, category, geometry', () => {
    expect(rightOfWay({ kind: 'converging', you: 'airplane', other: 'airplane', otherOn: 'right' }).has).toBe('other');
    expect(rightOfWay({ kind: 'converging', you: 'airplane', other: 'airplane', otherOn: 'left' }).has).toBe('you');
    expect(rightOfWay({ kind: 'converging', you: 'airplane', other: 'glider', otherOn: 'left' }).has).toBe('other');
    expect(rightOfWay({ kind: 'converging', you: 'glider', other: 'airplane', otherOn: 'right' }).has).toBe('you');
    expect(rightOfWay({ kind: 'head-on' }).has).toBe('both');
    expect(rightOfWay({ kind: 'overtaking', youAre: 'overtaking' }).has).toBe('other');
    expect(rightOfWay({ kind: 'landing', youLower: true, otherOnFinal: false }).has).toBe('you');
    expect(rightOfWay({ kind: 'distress', who: 'other' }).has).toBe('other');
  });

  it('keeps a light airplane out of the wake (AIM 7-4-6)', () => {
    const base = { runwayFt: 7000, yourDistanceFt: 2000, lingering: false };
    expect(gradeWake({ ...base, you: 'takeoff', leader: 'departed', leaderPointFt: 2500 }).wait).toBe('best');
    expect(gradeWake({ ...base, you: 'takeoff', leader: 'landed', leaderPointFt: 1800 })['past-point']).toBe('best');
    // Not enough runway past its touchdown point: wait.
    expect(gradeWake({ ...base, you: 'takeoff', leader: 'landed', leaderPointFt: 5500 })).toMatchObject({ 'past-point': 'unsafe', wait: 'best' });
    expect(gradeWake({ ...base, you: 'landing', leader: 'landed', leaderPointFt: 1500 })['past-point']).toBe('best');
    expect(gradeWake({ ...base, you: 'landing', leader: 'departed', leaderPointFt: 3800 })['before-point']).toBe('best');
  });
});

describe('module 9 lessons', () => {
  it('is module 9, written, with four lessons', () => {
    const m = modules.find((x) => x.n === 9)!;
    expect(m.title).toBe('Airport operations');
    expect(m.lessons.map((l) => l.id)).toEqual(['9.1', '9.2', '9.3', '9.4']);
  });

  for (const [name, ctx] of contexts) {
    for (const l of airportOpsLessons) {
      it(`${l.id} builds every situation (${name})`, () => {
        for (let v = 0; v < (l.variants ?? 1); v++) {
          const steps = l.build({ ...ctx, variant: v });
          expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
          for (const s of steps) {
            if (s.kind === 'turn') for (const b of s.blanks) expect(checkBlank(b, String(b.answer)), `${l.id} v${v} ${b.id}`).toBe(true);
            if (s.kind === 'decide') {
              for (const o of s.options) expect(s.consequence[o.id], `${l.id} v${v} ${o.id}`).toBeTruthy();
              expect(Object.values(s.grades)).toContain('best');
            }
          }
          const text = JSON.stringify(steps);
          expect(text).not.toMatch(/—|!|undefined|NaN/);
          expect(text).not.toMatch(/KASH|Cessna|C172|Skyhawk/);
        }
      });
    }
  }

  it('changes the right call with the situation', () => {
    const ctx = contexts[1][1];
    const best = (id: string, v: number) => Object.entries(decide(lesson(id).build({ ...ctx, variant: v })).grades).filter(([, g]) => g === 'best').map(([k]) => k);
    expect([0, 1, 2, 3].map((v) => best('9.1', v))).toEqual([['stop-call'], ['look-go'], ['continue'], ['stop-call']]);
    expect([0, 1, 2].map((v) => best('9.2', v))).toEqual([['land'], ['circle'], ['divert']]);
    expect([0, 1, 2, 3].map((v) => best('9.3', v))).toEqual([['behind'], ['behind'], ['behind'], ['hold']]);
    expect([0, 1, 2, 3].map((v) => best('9.4', v))).toEqual([['wait'], ['past-point'], ['past-point'], ['before-point']]);
    // The sample airplane fits past the jet's touchdown point on the 7,000 foot runway.
    const w = wakeCase(ctx, 1).s;
    expect(w.runwayFt - w.leaderPointFt).toBeGreaterThan(w.yourDistanceFt);
  });
});
