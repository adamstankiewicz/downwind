import { describe, expect, it } from 'vitest';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import { xcAirplane } from '../../scenarios/crossCountry';
import { DEFAULT_TRIP_PREFS, pickVaried, recommend, type PlanOptions } from '../../scenarios/trip';
import { resolveRef } from '../../refs/resolve';
import { practiceTripInputs } from '../tripPractice';
import { tripLead, tripLesson, tripPitch } from '../trip';
import { checkBlank } from '../progress';

const mins = defaultPilot.minimums;
const pilots = [
  ['no airplane, default minimums', blankAircraft, mins],
  ['sample airplane', sampleC172K, mins],
  ['tight minimums', sampleC172K, { ...mins, ceilingFt: 5000, crosswindKt: 8, visibilitySm: 6 }],
] as const;
const DAYS = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 9, 20 + i, 13, 10)));

const BAD = /NaN|undefined|Infinity|null|—|!/;

describe.each(pilots)('trip lessons: %s', (_n, aircraft, minimums) => {
  it.each(DAYS.map((d) => [d.toISOString().slice(0, 10), d] as const))('%s builds and grades', (_d, now) => {
    const input = practiceTripInputs(now);
    const o: PlanOptions = {
      airplane: xcAirplane(aircraft), minimums, prefs: DEFAULT_TRIP_PREFS, demonstratedCrosswindKt: aircraft.demonstratedCrosswindKt,
      departure: new Date(now.getTime() + 50 * 60_000), history: [],
    };
    const rec = recommend(input, o);
    expect(tripLead(rec, o)).not.toMatch(BAD);
    for (const p of rec.considered) {
      expect(Number.isFinite(p.fuel.requiredGal)).toBe(true);
      expect(p.out.altitudeMsl).toBeGreaterThan(p.dest.elevationFt);
    }
    for (const plan of pickVaried(rec.ranked, 3)) {
      expect(tripPitch(plan, o)).not.toMatch(BAD);
      const lesson = tripLesson(input, plan, o);
      const steps = lesson.build({} as never);
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const s of steps) {
        const text = JSON.stringify(s, (k, v) => (k === 'figure' ? undefined : v));
        expect(text, `${plan.dest.id} ${s.id}`).not.toMatch(BAD);
        if (s.kind === 'turn') for (const b of s.blanks) expect(checkBlank(b, String(b.answer))).toBe(true);
        if (s.kind === 'decide') {
          expect(s.options.length).toBeGreaterThanOrEqual(2);
          expect(s.options.length).toBeLessThanOrEqual(4);
          for (const opt of s.options) {
            expect(s.grades[opt.id]).toBeDefined();
            expect(s.consequence[opt.id]).toBeTruthy();
          }
          // Pressing on under the pilot's own line is never the best call.
          expect(['marginal', 'unsafe']).toContain(s.grades.continue);
          expect(Object.values(s.grades).some((g) => g === 'best' || g === 'acceptable')).toBe(true);
        }
      }
      // The leg home in the lesson is the engine's leg home.
      const back = steps.find((s) => s.id === 'back');
      expect(back?.kind === 'turn' && back.blanks.find((b) => b.id === 'gs')?.answer).toBe(plan.back.groundspeedKt);
    }
  });
});

describe('practice trips', () => {
  it('hold still through a day and change between days', () => {
    const a = practiceTripInputs(new Date(Date.UTC(2026, 9, 25, 13)));
    const b = practiceTripInputs(new Date(Date.UTC(2026, 9, 25, 15)));
    const days = DAYS.map((d) => practiceTripInputs(d).home.metar!.wind!.dirTrue);
    expect(a.fields.map((f) => f.metar!.raw.split(' ').slice(3).join(' '))).toEqual(b.fields.map((f) => f.metar!.raw.split(' ').slice(3).join(' ')));
    expect(new Set(days).size).toBeGreaterThan(3);
  });

  it('use only made-up fields', () => {
    const ids = [practiceTripInputs(new Date()).home.id, ...practiceTripInputs(new Date()).fields.map((f) => f.id)];
    for (const id of ids) expect(id).toMatch(/X|^2X5$/);
  });

  it('cite references that resolve', () => {
    const input = practiceTripInputs(DAYS[0]);
    const o: PlanOptions = { airplane: xcAirplane(blankAircraft), minimums: mins, prefs: DEFAULT_TRIP_PREFS, demonstratedCrosswindKt: 0, departure: DAYS[0], history: [] };
    const plan = recommend(input, o).considered[0];
    for (const r of tripLesson(input, plan, o).refs) for (const l of resolveRef(r)) expect(l.kind).not.toBe('text');
  });
});
