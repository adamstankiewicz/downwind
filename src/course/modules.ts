// The syllabus: the modules in ACS order, with the oral last (FAA-S-ACS-6C, Private Pilot
// Airplane). Written modules carry their lessons; the rest show their planned
// lessons so the pilot can see the whole course from day one.

import type { Lesson, Module } from './types';
import { pilotAirplaneLessons } from './pilotAirplane';
import { systemsLessons } from './systems';
import { emergencyLessons } from './emergencies';
import { oralLessons } from './oral';
import { weatherLessons } from './weather';
import { crossCountryLessons } from './crossCountry';
import { humanFactorsLessons } from './human';
import { airspaceLessons } from './airspace';
import { performanceLessons } from './performance';
import { airportOpsLessons } from './airportOps';
import { aeroLessons } from './aero';
import { hazardsLesson } from './hazards';
import { illusionsLesson } from './illusions';
import { vorLesson } from './vor';

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
    lessons: [...weatherLessons, hazardsLesson],
    outline: [],
  },
  {
    n: 3, title: 'Performance and loading', acsAreas: ['I.F'],
    summary: 'Weight and balance, density altitude and runway performance for your airplane on today\'s day.',
    lessons: performanceLessons,
    outline: [],
  },
  {
    n: 4, title: 'Airspace and the chart', acsAreas: ['I.E', 'III.A'],
    summary: 'Read the sectional around your field, and know who to talk to before you cross a line.',
    lessons: airspaceLessons,
    outline: [],
  },
  {
    n: 5, title: 'Cross-country and diversion', acsAreas: ['I.D', 'VI'],
    summary: 'Plan a cross-country, fly it on the chart, and divert when the plan stops working.',
    lessons: [...crossCountryLessons, vorLesson],
    outline: [],
  },
  {
    n: 6, title: 'Emergencies', acsAreas: ['IX'],
    summary: 'Engine failures, fires and forced landings, decided in the seconds you actually have.',
    lessons: emergencyLessons,
    outline: [],
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
    lessons: [...humanFactorsLessons, illusionsLesson],
    outline: [],
  },
  {
    n: 9, title: 'Airport operations', acsAreas: ['II.D', 'III', 'IV'],
    summary: 'Signs, runway crossings, the light gun, right of way and wake turbulence: the ground and the pattern, where it gets crowded.',
    lessons: airportOpsLessons,
    outline: [],
  },
  {
    n: 10, title: 'Aerodynamics', acsAreas: ['IV', 'V', 'VII'],
    summary: 'Load factor, maneuvering speed, stalls, spins and ground effect, where they show up: the turn to final, rough air and the ends of the runway.',
    lessons: aeroLessons,
    outline: [],
  },
  {
    n: 11, title: 'The oral and the flight review', acsAreas: ['I', 'XI'],
    summary: 'A scenario-based oral across the whole course, and a record your CFI can use for the 61.56 review.',
    lessons: oralLessons,
    outline: [],
  },
];

export const allLessons: Lesson[] = modules.flatMap((m) => m.lessons);

export function lessonById(id: string): Lesson | undefined {
  return allLessons.find((l) => l.id === id);
}

export function moduleOf(lesson: Lesson): Module {
  return modules.find((m) => m.n === lesson.module)!;
}
