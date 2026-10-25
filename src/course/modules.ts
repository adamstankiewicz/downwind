// The syllabus: nine modules in ACS order (FAA-S-ACS-6C, Private Pilot
// Airplane). Written modules carry their lessons; the rest show their planned
// lessons so the pilot can see the whole course from day one.

import type { Lesson, Module } from './types';
import { pilotAirplaneLessons } from './pilotAirplane';
import { systemsLessons } from './systems';
import { weatherLessons } from './weather';

export const modules: Module[] = [
  {
    n: 1, title: 'Pilot and airplane', acsAreas: ['I.A', 'I.B'],
    summary: 'Certificates, currency, documents and airworthiness: what has to be true before the airplane moves.',
    lessons: pilotAirplaneLessons,
    outline: [],
  },
  {
    n: 2, title: 'Weather', acsAreas: ['I.C'],
    summary: 'Reports, forecasts and the decisions they feed, read against your own field and your own minimums.',
    lessons: weatherLessons,
    outline: [],
  },
  {
    n: 3, title: 'Performance and loading', acsAreas: ['I.F'],
    summary: 'Weight and balance, density altitude and runway performance for your airplane on today\'s day.',
    lessons: [],
    outline: ['Weight and balance with real passengers', 'Density altitude on a hot afternoon', 'Takeoff distance and the 50 foot obstacle', 'Fuel: legal reserve and real reserve'],
  },
  {
    n: 4, title: 'Airspace and the chart', acsAreas: ['I.E', 'III.A'],
    summary: 'Read the sectional around your field, and know who to talk to before you cross a line.',
    lessons: [],
    outline: ['Reading the chart around your field', 'The Class D next door', 'Class C: rings and radar', 'Class B shelves and Mode C', 'TFRs and special use airspace'],
  },
  {
    n: 5, title: 'Cross-country and diversion', acsAreas: ['I.D', 'VI'],
    summary: 'Plan a cross-country, fly it on the chart, and divert when the plan stops working.',
    lessons: [],
    outline: ['Building a nav log', 'Winds aloft and groundspeed', 'Checkpoints and pilotage', 'The diversion, done in the air', 'Lost procedures'],
  },
  {
    n: 6, title: 'Emergencies', acsAreas: ['IX'],
    summary: 'Engine failures, fires and forced landings, decided in the seconds you actually have.',
    lessons: [],
    outline: ['Engine failure after takeoff', 'Engine failure at altitude', 'Fire in flight', 'Forced landing field selection', 'Partial power'],
  },
  {
    n: 7, title: 'Systems and the panel', acsAreas: ['I.G', 'IX.C'],
    summary: 'Your airplane\'s systems, its avionics, and what to do when one of them quits.',
    lessons: systemsLessons,
    outline: [],
  },
  {
    n: 8, title: 'Human factors and risk', acsAreas: ['I.H', 'II'],
    summary: 'IMSAFE, PAVE, the hazardous attitudes and external pressure, applied to your own flying.',
    lessons: [],
    outline: ['Minimums under pressure', 'Fatigue, hypoxia and medication', 'Get-there-itis', 'Night: what changes'],
  },
  {
    n: 9, title: 'The oral and the flight review', acsAreas: ['I', 'XI'],
    summary: 'A scenario-based oral across the whole course, and a record your CFI can use for the 61.56 review.',
    lessons: [],
    outline: ['Mock oral: a weekend trip', 'Mock oral: the airplane', 'Your flight review summary'],
  },
];

export const allLessons: Lesson[] = modules.flatMap((m) => m.lessons);

export function lessonById(id: string): Lesson | undefined {
  return allLessons.find((l) => l.id === id);
}

export function moduleOf(lesson: Lesson): Module {
  return modules.find((m) => m.n === lesson.module)!;
}
