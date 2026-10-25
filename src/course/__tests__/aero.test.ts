import { describe, expect, it } from 'vitest';
import { KASH } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { floatDistance, gradeOvershoot, gradeStallRecovery, gradeTurbulence, loadFactor, maneuveringSpeed, SAMPLE_SPEEDS, stallBankAt, stallSpeedAt } from '../../lib/aero';
import { aeroLessons, floatCase, steepestApproachBank } from '../aero';
import { initialValues } from '../dials';
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
const lesson = (id: string) => aeroLessons.find((l) => l.id === id)!;
const S = SAMPLE_SPEEDS;

describe('aerodynamics rules (PHAK ch. 5)', () => {
  it('turns bank into load factor and stall speed', () => {
    expect(loadFactor(0)).toBe(1);
    expect(loadFactor(60)).toBeCloseTo(2, 6);
    expect(stallSpeedAt(48, 2)).toBeCloseTo(67.9, 1);
    expect(stallBankAt(48, stallSpeedAt(48, loadFactor(45)))).toBeCloseTo(45, 6);
    expect(stallBankAt(48, 40)).toBe(0);
  });

  it('lowers Va with the square root of weight, never raises it', () => {
    expect(maneuveringSpeed(105, 2300, 2300)).toBe(105);
    expect(maneuveringSpeed(105, 2300 * 0.81, 2300)).toBeCloseTo(94.5, 1);
    expect(maneuveringSpeed(105, 2500, 2300)).toBe(105);
  });

  it('grades the overshoot by the stall margin at the bank it needs', () => {
    expect(gradeOvershoot(S, 30).grades).toMatchObject({ rudder: 'unsafe', steepen: 'best' });
    expect(gradeOvershoot(S, 45).grades).toMatchObject({ steepen: 'marginal', 'go-around': 'best' });
    expect(gradeOvershoot(S, 60).grades).toMatchObject({ steepen: 'unsafe', 'go-around': 'best' });
    expect(steepestApproachBank(S)).toBe(50);
  });

  it('flies Va for the weight in turbulence, not the placard', () => {
    expect(gradeTurbulence(S, 1830, 2300).grades['placard-va']).toBe('marginal');
    expect(gradeTurbulence(S, 2300, 2300).grades['placard-va']).toBe('best');
    expect(gradeTurbulence(S, 2300, 2300, 67).grades['well-below']).toBe('marginal');
  });

  it('unloads the wing first, and spins get PARE', () => {
    expect(gradeStallRecovery('stall')).toMatchObject({ aileron: 'unsafe', 'reduce-aoa': 'best', 'power-pull': 'unsafe' });
    expect(gradeStallRecovery('incipient-spin').pare).toBe('best');
  });

  it('floats further with the square of the extra speed', () => {
    expect(floatDistance(1000, 65, 65)).toBe(0);
    expect(floatDistance(1000, 65, 75)).toBeCloseTo(331, 0);
  });
});

describe('module 10 lessons', () => {
  it('is module 10, written, with four lessons', () => {
    const m = modules.find((x) => x.n === 10)!;
    expect(m.title).toBe('Aerodynamics');
    expect(m.lessons.map((l) => l.id)).toEqual(['10.1', '10.2', '10.3', '10.4']);
  });

  for (const [name, ctx] of contexts) {
    for (const l of aeroLessons) {
      it(`${l.id} builds every situation (${name})`, () => {
        for (let v = 0; v < (l.variants ?? 1); v++) {
          const steps = l.build({ ...ctx, variant: v });
          expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
          for (const s of steps) {
            if (s.kind === 'turn') for (const b of s.blanks) expect(checkBlank(b, String(b.answer)), `${l.id} v${v} ${b.id}`).toBe(true);
            if (s.kind === 'decide') {
              for (const o of s.options) {
                expect(s.grades[o.id], `${l.id} v${v} ${o.id}`).toBeTruthy();
                expect(s.consequence[o.id], `${l.id} v${v} ${o.id}`).toBeTruthy();
              }
              expect(Object.values(s.grades)).toContain('best');
            }
            if (s.kind === 'dials') {
              const st = s.evaluate(initialValues(s));
              expect(st.readouts.every((r) => !/NaN|undefined/.test(r.value))).toBe(true);
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
    expect([0, 1, 2].map((v) => best('10.1', v))).toEqual([['steepen'], ['go-around'], ['go-around']]);
    expect([0, 1].map((v) => best('10.2', v))).toEqual([['weight-va'], ['placard-va']]);
    expect([0, 1].map((v) => best('10.3', v))).toEqual([['reduce-aoa'], ['pare']]);
    expect([0, 1, 2].map((v) => best('10.4', v))).toEqual([['accelerate'], ['hold-off'], ['go-around']]);
    expect(floatCase(ctx, 1).remainingFt).toBeGreaterThan(floatCase(ctx, 1).neededFt);
    expect(floatCase(ctx, 2).remainingFt).toBeLessThan(floatCase(ctx, 2).neededFt);
  });

  it('checks the dial task against the engine', () => {
    const steps = lesson('10.1').build(contexts[1][1]);
    const dials = steps.find((s) => s.kind === 'dials') as Extract<Step, { kind: 'dials' }>;
    expect(dials.task!.check({ bank: 50 }).right).toBe(true);
    expect(dials.task!.check({ bank: 55 }).right).toBe(false);
  });
});
