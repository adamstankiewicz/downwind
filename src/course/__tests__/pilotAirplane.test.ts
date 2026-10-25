import { describe, expect, it } from 'vitest';
import { KASH, type Airport } from '../../data/airports';
import { blankAircraft, sampleC172K } from '../../data/aircraft';
import { defaultPilot } from '../../data/pilot';
import {
  addMonths, endOfCalendarMonth, flightReview, gradePlan, hundredHour, inoperative, inspectionDue, medicalForPrivate,
  passengerCurrency, registration, toDay,
} from '../../lib/regs';
import { lessonContext } from '../practice';
import { checkBlank } from '../progress';
import { modules } from '../modules';
import { currencyLog, pilotAirplaneLessons, PRACTICE_TAIL, SQUAWK_BOARD } from '../pilotAirplane';
import type { LessonContext, Step } from '../types';

const NOW = new Date(Date.UTC(2026, 9, 24, 16, 20));
const mins = defaultPilot.minimums;
const highField: Airport = { ...KASH, icao: 'KHIG', elevationFt: 5400, magneticVariationDeg: 8, runways: [{ id: '17', headingMag: 170 }, { id: '35', headingMag: 350 }] };

const contexts: [string, LessonContext][] = [
  ['practice field, no airplane', lessonContext(null, blankAircraft, mins, NOW)],
  ['home field with runways', { ...lessonContext(KASH, sampleC172K, mins, NOW), lastFlightReview: '2025-03-14' }],
  ['tight minimums, high field', lessonContext(highField, sampleC172K, { ...mins, crosswindKt: 8, ceilingFt: 1500 }, NOW)],
];
// Month ends and leap days are where calendar-month arithmetic breaks.
const dates = [NOW, new Date(Date.UTC(2027, 0, 31, 12)), new Date(Date.UTC(2028, 1, 29, 12)), new Date(Date.UTC(2026, 11, 1, 9))];

const decide = (steps: Step[], id = 'd1') => steps.find((s) => s.id === id && s.kind === 'decide') as Extract<Step, { kind: 'decide' }>;
const turn = (steps: Step[]) => steps.find((s) => s.kind === 'turn') as Extract<Step, { kind: 'turn' }>;
const lesson = (id: string) => pilotAirplaneLessons.find((l) => l.id === id)!;

describe('calendar arithmetic', () => {
  it('counts calendar months to the end of the month', () => {
    expect(endOfCalendarMonth('2026-03-14', 24)).toBe('2028-03-31');
    expect(endOfCalendarMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(endOfCalendarMonth('2027-02-10', 12)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('runs the flight review, medical and registration to the month end', () => {
    expect(flightReview('2024-10-02', '2026-10-31')).toMatchObject({ through: '2026-10-31', current: true, daysLeft: 0 });
    expect(flightReview('2024-10-02', '2026-11-01').current).toBe(false);
    expect(medicalForPrivate('2025-05-20', 39, '2026-01-01').through).toBe('2030-05-31');
    expect(medicalForPrivate('2025-05-20', 40, '2026-01-01').through).toBe('2027-05-31');
    expect(registration('2019-06-03', '2026-06-30')).toMatchObject({ through: '2026-06-30', current: true });
  });
  it('dates inspections', () => {
    expect(inspectionDue('annual', '2026-04-09', '2027-04-30')).toMatchObject({ through: '2027-04-30', current: true });
    expect(inspectionDue('vor', '2026-04-09', '2026-05-10')).toMatchObject({ through: '2026-05-09', current: false });
    expect(hundredHour(4418.6, 4512.3)).toEqual({ dueAtTach: 4518.6, remaining: 6.3 });
    expect(hundredHour(4418.6, 4512.3, 4)).toEqual({ dueAtTach: 4514.6, remaining: 2.3 });
  });
});

describe('61.57 currency', () => {
  const today = '2026-10-24';
  it('counts every landing for day and only full stops an hour after sunset for night', () => {
    const log = currencyLog(today);
    const day = passengerCurrency(log, today, 'day');
    expect(day.qualifying).toBe(7);
    expect(day.thirdDay).toBe('2026-09-30');
    expect(day.currentThrough).toBe('2026-12-29');
    const night = passengerCurrency(log, today, 'night');
    expect(night).toMatchObject({ qualifying: 2, current: false, currentThrough: null });
  });
  it('lets a landing count through day 90, and tailwheel needs full stops', () => {
    const log = [{ day: '2026-01-01', landings: [{ count: 3, fullStop: false, afterSunsetMin: null }] }];
    expect(passengerCurrency(log, '2026-04-01', 'day').current).toBe(true);
    expect(passengerCurrency(log, '2026-04-02', 'day').current).toBe(false);
    expect(passengerCurrency(log, '2026-01-02', 'day', true).current).toBe(false);
  });
});

describe('91.213(d)', () => {
  it('grounds an item on the equipment list or in 91.205 for the flight, and passes the rest', () => {
    const day = { kind: 'day' as const, forHire: false };
    expect(inoperative({ equipment: 'clock', onEquipmentList: false }, day).mayFly).toBe(true);
    expect(inoperative({ equipment: 'fuel-gauge', onEquipmentList: false }, day).requiredBy).toEqual(['14 CFR 91.205(b)(9)']);
    expect(inoperative({ equipment: 'stall-warning', onEquipmentList: true }, day).mayFly).toBe(false);
    expect(inoperative({ equipment: 'position-lights', onEquipmentList: false }, day).mayFly).toBe(true);
    expect(inoperative({ equipment: 'position-lights', onEquipmentList: false }, { kind: 'night', forHire: false }).mayFly).toBe(false);
    expect(inoperative({ equipment: 'landing-light', onEquipmentList: false }, { kind: 'night', forHire: false }).mayFly).toBe(true);
    expect(inoperative({ equipment: 'landing-light', onEquipmentList: false }, { kind: 'night', forHire: true }).mayFly).toBe(false);
    expect(inoperative({ equipment: 'clock', onEquipmentList: false, ad: true }, day).mayFly).toBe(false);
    expect(SQUAWK_BOARD.map((c) => inoperative(c.squawk, day).mayFly)).toEqual([true, false, false]);
  });
  it('grades plans by the rules first', () => {
    expect(gradePlan({ legal: false, meetsGoal: true })).toBe('unsafe');
    expect(gradePlan({ legal: true, meetsGoal: true, margin: 5, tightBelow: 15 })).toBe('marginal');
    expect(gradePlan({ legal: true, meetsGoal: false })).toBe('acceptable');
    expect(gradePlan({ legal: true, meetsGoal: true, margin: 30, tightBelow: 15 })).toBe('best');
  });
});

describe.each(contexts)('module 1 lessons: %s', (_name, base) => {
  for (const now of dates) {
    const ctx = { ...base, now };
    it.each(pilotAirplaneLessons.flatMap((l) => [...Array(l.variants ?? 1).keys()].map((v) => [`${l.id} situation ${v}`, l, v] as const)))(`%s builds valid steps on ${toDay(now)}`, (_id, l, variant) => {
      const steps = l.build({ ...ctx, variant });
      expect(steps.length).toBeGreaterThan(2);
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const s of steps) {
        if (s.kind === 'turn') {
          for (const b of s.blanks) {
            if (typeof b.answer === 'number') expect(Number.isFinite(b.answer)).toBe(true);
            else expect(b.choices).toContain(b.answer);
            if (b.choices) expect(new Set(b.choices).size).toBe(b.choices.length);
            expect(checkBlank(b, String(b.answer))).toBe(true);
            expect(b.explain).toBeTruthy();
          }
        }
        if (s.kind === 'decide') {
          expect(s.options.length).toBeGreaterThanOrEqual(3);
          for (const o of s.options) {
            expect(s.consequence[o.id]).toBeTruthy();
            expect(s.grades[o.id]).toBeTruthy();
          }
        }
        if (s.figure?.kind === 'records') {
          for (const r of s.figure.rows) expect(r.cells.length).toBe(s.figure.columns.length);
          expect(s.figure.caption).toMatch(/made-up/i);
        }
        const text = JSON.stringify(s);
        expect(text).not.toMatch(/—|!/);
        expect(text).not.toMatch(/NaN|undefined|Invalid Date/);
        expect(text).not.toMatch(/KASH|Nashua/);
        if (ctx.practiceField) expect(text).not.toMatch(/C172|Cessna/);
      }
    });

    it(`teaches what each lesson says on ${toDay(now)}`, () => {
      const g = (id: string) => decide(lesson(id).build(ctx)).grades;
      expect(g('1.1')).toEqual({ go: 'unsafe', 'leave-early': 'best', 'get-current': 'best', cancel: 'acceptable' });
      expect(g('1.2')).toEqual({ go: 'unsafe', 'with-cfi': 'unsafe', swap: 'best', cancel: 'acceptable' });
      expect(g('1.3')).toEqual({ go: 'unsafe', tight: 'marginal', local: 'acceptable', swap: 'best' });
      expect(g('1.4')).toEqual({ go: 'unsafe', squeeze: 'marginal', early: 'best', fix: 'best' });
      expect(g('1.5')).toEqual({ go: 'unsafe', solo: 'unsafe', review: 'best', wings: 'best' });
      // The turn answers that set the decisions up.
      expect(turn(lesson('1.1').build(ctx)).blanks.find((b) => b.id === 'current')!.answer).toBe('No');
      expect(turn(lesson('1.2').build(ctx)).blanks.find((b) => b.id === 'today')!.answer).toBe('No');
      expect(turn(lesson('1.3').build(ctx)).blanks.find((b) => b.id === 'hours')!.answer).toBe(2.3);
      expect(turn(lesson('1.5').build(ctx)).blanks.find((b) => b.id === 'trip')!.answer).toBe('No');
    });

    it(`changes the right call with the situation on ${toDay(now)}`, () => {
      const g = (id: string, variant: number) => decide(lesson(id).build({ ...ctx, variant })).grades;
      // Night current today, not on the day: the same trap as situation 0.
      expect(g('1.1', 1).go).toBe('unsafe');
      expect(turn(lesson('1.1').build({ ...ctx, variant: 2 })).blanks.find((b) => b.id === 'current')!.answer).toBe('Yes');
      expect(g('1.1', 2)).toMatchObject({ go: 'best', cancel: 'marginal' });
      expect(g('1.1', 3)).toMatchObject({ go: 'best', 'get-current': 'acceptable', cancel: 'marginal' });
      expect(g('1.2', 1)).toEqual({ go: 'unsafe', solo: 'unsafe', cfi: 'best', cancel: 'acceptable' });
      expect(g('1.2', 2)).toEqual({ go: 'unsafe', photo: 'unsafe', fetch: 'best', cancel: 'acceptable' });
      expect(g('1.3', 1)).toMatchObject({ go: 'unsafe', 'with-ap': 'unsafe', swap: 'best' });
      expect(g('1.3', 2)).toMatchObject({ go: 'best', cancel: 'marginal' });
      expect(g('1.4', 1)).toMatchObject({ go: 'unsafe', placard: 'unsafe', fix: 'best' });
      expect(g('1.4', 2)).toEqual({ go: 'unsafe', placard: 'best', wait: 'acceptable', cancel: 'marginal' });
      expect(g('1.5', 1)).toMatchObject({ go: 'best', cancel: 'marginal' });
      expect(g('1.5', 2)).toMatchObject({ go: 'unsafe', cfi: 'best', solo: 'best' });
    });
  }
});

describe('module 1 in the course', () => {
  it('is written, in course order, with the outline cleared', () => {
    expect(modules[0].lessons.map((l) => l.id)).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5']);
    expect(modules[0].outline).toEqual([]);
  });
  it('uses a tail number that cannot be real', () => {
    expect(PRACTICE_TAIL).toMatch(/^N0/);
  });
  it('works out the pilot\'s own flight review when it is set', () => {
    const steps = lesson('1.5').build(contexts[1][1]);
    const own = steps.find((s) => s.id === 'b2')!;
    expect(own.kind === 'brief' && own.say.full).toMatch(/Mar 31, 2027/);
    const none = lesson('1.5').build(contexts[0][1]).find((s) => s.id === 'b2')!;
    expect(none.kind === 'brief' && none.say.full).toMatch(/Pilot screen/);
  });
});
