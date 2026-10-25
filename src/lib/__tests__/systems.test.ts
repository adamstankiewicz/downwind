import { describe, expect, it } from 'vitest';
import {
  CLASSIC_PANEL, affectedBy, batteryMinutes, blockedStatic, busLoadAmps, carbIceRisk, diagnose, gradeAlternatorFailure, gradeGpsLoss,
  gradeGyroFailure, gradeRoughEngine, gradeRpmLoss, relativeHumidity, sampleElectrical, shedLoads, stillGood, usableAh,
} from '../systems';

describe('electrical', () => {
  const sys = sampleElectrical();
  it('adds the loads that are on and counts battery minutes', () => {
    expect(busLoadAmps(sys, ['com', 'xpdr'])).toBe(3);
    expect(usableAh(sys)).toBe(12);
    expect(batteryMinutes(sys, 6)).toBe(120);
    expect(batteryMinutes(sys, 0)).toBe(Infinity);
  });
  it('sheds to the essentials that were on', () => {
    expect(shedLoads(sys, ['com', 'gps', 'landing'])).toEqual(['com']);
  });
  it('grades an alternator failure on battery minutes', () => {
    expect(gradeAlternatorFailure({ fullMin: 33, shedMin: 171, toHomeMin: 29, toNearestMin: 8 })).toEqual({ 'carry-on': 'unsafe', 'shed-home': 'best', 'shed-nearest': 'acceptable' });
    // A home field the shed battery cannot reach with margin makes the nearer field the call.
    expect(gradeAlternatorFailure({ fullMin: 20, shedMin: 35, toHomeMin: 30, toNearestMin: 8 })).toEqual({ 'carry-on': 'unsafe', 'shed-home': 'marginal', 'shed-nearest': 'best' });
    expect(gradeAlternatorFailure({ fullMin: 60, shedMin: 171, toHomeMin: 20, toNearestMin: 8 })['carry-on']).toBe('marginal');
  });
});

describe('instruments', () => {
  it('maps a failed source to the instruments it takes', () => {
    expect(affectedBy(CLASSIC_PANEL, 'vacuum')).toEqual(['ai', 'hi']);
    expect(affectedBy(CLASSIC_PANEL, 'static').sort()).toEqual(['alt', 'asi', 'vsi']);
    expect(affectedBy(CLASSIC_PANEL, 'pitot')).toEqual(['asi']);
    expect(stillGood(CLASSIC_PANEL, 'vacuum')).toContain('tc');
    expect(stillGood(CLASSIC_PANEL, 'vacuum')).toContain('compass');
  });
  it('diagnoses from the instruments that disagree', () => {
    expect(diagnose(CLASSIC_PANEL, ['hi', 'ai'])).toBe('vacuum');
    expect(diagnose(CLASSIC_PANEL, ['tc'])).toBe('electric');
    expect(diagnose(CLASSIC_PANEL, ['vsi', 'alt', 'asi'])).toBe('static');
    expect(diagnose(CLASSIC_PANEL, ['ai'])).toBeNull();
  });
  it('freezes the altimeter on a blocked static port, with airspeed high below and low above', () => {
    expect(blockedStatic(3500, 2500)).toEqual({ altimeterFt: 3500, vsiFpm: 0, airspeed: 'high' });
    expect(blockedStatic(2500, 4500).airspeed).toBe('low');
    expect(blockedStatic(2500, 2500).airspeed).toBe('right');
  });
  it('never rewards following a failed gyro', () => {
    for (const v of [2, 4, 10]) {
      const g = gradeGyroFailure({ visibilitySm: v, minimumSm: 5 });
      expect(g['trust-attitude']).toBe('unsafe');
      expect(g['cover-land']).toBe('best');
    }
    expect(gradeGyroFailure({ visibilitySm: 8, minimumSm: 5 })['cover-continue']).toBe('acceptable');
    expect(gradeGyroFailure({ visibilitySm: 4, minimumSm: 5 })['cover-continue']).toBe('marginal');
  });
});

describe('carburetor ice', () => {
  it('computes relative humidity from the spread', () => {
    expect(relativeHumidity(12, 12)).toBe(100);
    expect(relativeHumidity(12, 10)).toBeGreaterThanOrEqual(87);
    expect(relativeHumidity(12, 10)).toBeLessThanOrEqual(89);
    expect(relativeHumidity(30, 10)).toBeLessThan(30);
  });
  it('reads the PHAK chart', () => {
    expect(carbIceRisk(12, 10)).toBe('high');
    expect(carbIceRisk(30, 20)).toBe('possible');
    expect(carbIceRisk(25, 22)).toBe('possible');
    expect(carbIceRisk(30, 5)).toBe('unlikely');
    expect(carbIceRisk(-15, -16)).toBe('unlikely');
  });
  it('makes full heat the answer to a slow rpm loss', () => {
    for (const r of ['high', 'possible', 'unlikely'] as const) expect(gradeRpmLoss(r)['full-heat']).toBe('best');
    expect(gradeRpmLoss('high')['partial-heat']).toBe('unsafe');
  });
  it('makes the other tank the answer when the arithmetic says this one is dry', () => {
    expect(gradeRoughEngine({ tankLeftGal: 1 })['switch-tank']).toBe('best');
    expect(gradeRoughEngine({ tankLeftGal: 10 })['land-now']).toBe('best');
  });
});

describe('GPS loss', () => {
  it('finishes by pilotage when it can, and lands when the fuel says so', () => {
    expect(gradeGpsLoss({ visibilitySm: 8, minimumSm: 5, fuelMarginMin: 100, checkpointAhead: true })).toMatchObject({ pilotage: 'best', 'ask-atc': 'best' });
    expect(gradeGpsLoss({ visibilitySm: 4, minimumSm: 5, fuelMarginMin: 100, checkpointAhead: true })).toMatchObject({ pilotage: 'marginal', 'ask-atc': 'best' });
    expect(gradeGpsLoss({ visibilitySm: 8, minimumSm: 5, fuelMarginMin: -5, checkpointAhead: true })).toMatchObject({ pilotage: 'unsafe', nearest: 'best' });
  });
});
