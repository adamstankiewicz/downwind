import { describe, expect, it } from 'vitest';
import { defaultPilot } from '../../data/pilot';
import {
  adjustedMinimums, fitnessCheck, fitToFlyAt, mayCarryPassengers, medicationWaitH, nightCurrency, nightTimes, oxygenRequired, squeeze,
} from '../human';

const H = 3_600_000;
const T0 = new Date(Date.UTC(2026, 9, 24, 13));
const at = (h: number) => new Date(T0.getTime() + h * H);
const mins = defaultPilot.minimums;

describe('personal minimums, widened', () => {
  it('adds the RMH margin once, whatever the number of factors', () => {
    expect(adjustedMinimums(mins, [])).toBe(mins);
    const one = adjustedMinimums(mins, ['pressure']);
    expect(one).toEqual({ ceilingFt: mins.ceilingFt + 500, visibilitySm: mins.visibilitySm + 0.5, crosswindKt: mins.crosswindKt - 5, gustSpreadKt: mins.gustSpreadKt - 5 });
    expect(adjustedMinimums(mins, ['pressure', 'unwell', 'unfamiliar'])).toEqual(one);
    expect(adjustedMinimums({ ...mins, crosswindKt: 3 }, ['unwell']).crosswindKt).toBe(0);
  });
});

describe('fitness to fly', () => {
  it('holds alcohol to eight hours and medication to five maximal dosing intervals', () => {
    expect(medicationWaitH(6)).toBe(30);
    const items = fitnessCheck({ lastDrinkAt: at(-7.5), medication: { lastDoseAt: at(-10), maxDosingIntervalH: 6 }, sleepH: 8 }, T0);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.alcohol.severity).toBe('no-fly');
    expect(by.alcohol.clearAt).toEqual(at(0.5));
    expect(by.medication.severity).toBe('no-fly');
    expect(by.medication.clearAt).toEqual(at(20));
    expect(by.sleep.severity).toBe('ok');
    expect(fitToFlyAt(items)).toEqual(at(20));
  });
  it('clears at exactly the limit and flags a short night', () => {
    const items = fitnessCheck({ lastDrinkAt: at(-8), medication: null, sleepH: 6 }, T0);
    expect(items.map((i) => [i.id, i.severity])).toEqual([['alcohol', 'ok'], ['sleep', 'caution']]);
  });
});

describe('supplemental oxygen, 91.211', () => {
  it('follows the three bands', () => {
    expect(oxygenRequired(12500, 60).crewMinutes).toBe(0);
    expect(oxygenRequired(13500, 50).crewMinutes).toBe(20);
    expect(oxygenRequired(13500, 25).crewMinutes).toBe(0);
    expect(oxygenRequired(14500, 50)).toMatchObject({ crewMinutes: 50, occupantsProvided: false });
    expect(oxygenRequired(15500, 10)).toMatchObject({ crewMinutes: 10, occupantsProvided: true });
  });
});

describe('night', () => {
  const sunset = at(4);
  it('keeps the three nights apart', () => {
    const t = nightTimes(sunset, at(4.5));
    expect(t.lightsFrom).toEqual(sunset);
    expect(t.loggingFrom).toEqual(at(4.5));
    expect(t.currencyFrom).toEqual(at(5));
  });
  it('counts only full stops an hour after sunset in the last 90 days', () => {
    const day = 24;
    const landings = [
      { at: at(4.7 - 10 * day), sunset: at(4 - 10 * day), fullStop: true },
      { at: at(5.2 - 10 * day), sunset: at(4 - 10 * day), fullStop: false },
      { at: at(5.5 - 10 * day), sunset: at(4 - 10 * day), fullStop: true },
      { at: at(5.5 - 95 * day), sunset: at(4 - 95 * day), fullStop: true },
    ];
    const c = nightCurrency(landings, at(6));
    expect(c.reasons).toEqual(['too-early', 'touch-and-go', 'counts', 'too-old']);
    expect(c).toMatchObject({ counted: 1, needed: 2, current: false });
    expect(mayCarryPassengers(c, at(5), sunset)).toBe(true);
    expect(mayCarryPassengers(c, at(5.1), sunset)).toBe(false);
  });
});

describe('room under a lowering ceiling', () => {
  it('is legal low in Class G by day, but not inside a 3,000 ft minimum', () => {
    const s = squeeze({ cloudBaseMsl: 2400, highestMsl: 1600, groundMsl: 1600, visibilitySm: 4, night: false, mins }, () => 'G');
    expect(s).toMatchObject({ gapFt: 800, lowestMsl: 2100, legal: true, withinPersonal: false });
  });
  it('is not legal when the class needs 500 ft below clouds, or at night in G', () => {
    expect(squeeze({ cloudBaseMsl: 2400, highestMsl: 1600, groundMsl: 1600, visibilitySm: 4, night: false, mins }, () => 'E').legal).toBe(false);
    expect(squeeze({ cloudBaseMsl: 2400, highestMsl: 1600, groundMsl: 1600, visibilitySm: 4, night: true, mins }, () => 'G').legal).toBe(false);
    expect(squeeze({ cloudBaseMsl: 2400, highestMsl: 1600, groundMsl: 1600, visibilitySm: 0.5, night: false, mins }, () => 'G').legal).toBe(false);
    expect(squeeze({ cloudBaseMsl: 4800, highestMsl: 1600, groundMsl: 1600, visibilitySm: 6, night: false, mins }, () => 'E')).toMatchObject({ legal: true, withinPersonal: true });
  });
});
