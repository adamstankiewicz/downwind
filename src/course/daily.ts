// The daily flight: today's real conditions at the pilot's field, laid out as
// a briefing sheet. Each line belongs to the lesson that teaches it. Lines the
// course has covered ask for the pilot's reading before showing the app's;
// lines it hasn't are filled in and marked "not covered yet". The grade always
// uses every finding: safety doesn't wait for the syllabus.

import type { PersonalMinimums } from '../data/pilot';
import type { Brief, ChoiceId, Finding, Grade } from '../scenarios/goNoGo';
import type { CourseProgress } from './progress';
import { isDone } from './progress';
import type { Blank } from './types';

export type SectionId = 'report' | 'wind' | 'forecast' | 'ceiling' | 'trend' | 'airplane';

export interface SheetSection {
  id: SectionId;
  title: string;
  /** The lesson that teaches this line, or the module that will. */
  taughtBy: string;
  covered: boolean;
  /** The pilot's reading, asked before the app's. Only on covered lines. */
  prompt: Blank | null;
  findings: Finding[];
}

const SECTIONS: { id: SectionId; title: string; lesson: string | null; taughtBy: string }[] = [
  { id: 'report', title: 'The report', lesson: '2.1', taughtBy: 'Lesson 2.1' },
  { id: 'wind', title: 'Wind on the runway', lesson: '2.2', taughtBy: 'Lesson 2.2' },
  { id: 'forecast', title: 'Forecast through your return', lesson: '2.3', taughtBy: 'Lesson 2.3' },
  { id: 'ceiling', title: 'Ceiling and visibility', lesson: '2.4', taughtBy: 'Lesson 2.4' },
  { id: 'trend', title: 'Fog and trend', lesson: '2.5', taughtBy: 'Lesson 2.5' },
  { id: 'airplane', title: 'Airplane', lesson: null, taughtBy: 'Module 3' },
];

const FINDING_SECTION: Record<string, SectionId> = {
  'vfr-ceiling': 'ceiling',
  'vfr-vis': 'ceiling',
  'ceiling-personal': 'ceiling',
  'vis-personal': 'ceiling',
  'xw-demo': 'wind',
  'xw-personal': 'wind',
  'gust-spread': 'wind',
  tailwind: 'wind',
  convection: 'trend',
  fog: 'trend',
  'taf-worse': 'forecast',
  'no-taf': 'forecast',
  improving: 'forecast',
  da: 'airplane',
  'wb-gross': 'airplane',
  'wb-cg': 'airplane',
};

export function sectionFor(f: Finding): SectionId {
  return FINDING_SECTION[f.id] ?? 'report';
}

function promptFor(id: SectionId, brief: Brief, mins: PersonalMinimums): Blank | null {
  const { facts } = brief;
  switch (id) {
    case 'report':
      return facts.category
        ? { id: 'cat', label: 'Flight category', answer: facts.category, choices: ['VFR', 'MVFR', 'IFR', 'LIFR'],
            explain: 'From the ceiling and visibility: VFR above 3,000 and 5, MVFR 1,000 to 3,000 or 3 to 5.' }
        : null;
    case 'wind': {
      const rw = facts.runwayWind;
      if (!rw?.steady) return null;
      const x = Math.round(rw.gust?.crosswindKt ?? rw.steady.crosswindKt);
      return { id: 'xw', label: `Crosswind on ${rw.runway.id}${rw.gust ? ', in gusts' : ''}`, unit: 'kt', answer: x, tolerance: 2,
        explain: `${rw.steady.angleDeg}° off runway ${rw.runway.id}: about ${x} knots across.` };
    }
    case 'forecast': {
      if (brief.findings.some((f) => f.id === 'no-taf')) return null;
      const changes = facts.tafWindow.some((p) => p.kind !== 'BASE');
      return { id: 'change', label: 'Does the forecast change before you are back?', answer: changes ? 'Yes' : 'No', choices: ['Yes', 'No'],
        explain: changes ? 'A change group starts inside your flight window.' : 'Only one group covers your flight.' };
    }
    case 'ceiling': {
      const ok = (facts.ceilingFtAgl === null || facts.ceilingFtAgl >= mins.ceilingFt) && (facts.visibilitySm === null || facts.visibilitySm >= mins.visibilitySm);
      return { id: 'mins', label: 'Inside your ceiling and visibility minimums?', answer: ok ? 'Yes' : 'No', choices: ['Yes', 'No'],
        explain: `Ceiling ${facts.ceilingFtAgl === null ? 'none' : `${facts.ceilingFtAgl.toLocaleString('en-US')} ft`} against your ${mins.ceilingFt.toLocaleString('en-US')}; visibility ${facts.visibilitySm ?? '?'} SM against your ${mins.visibilitySm}.` };
    }
    case 'trend':
      return facts.tempDewSpreadC === null
        ? null
        : { id: 'spread', label: 'Temperature and dew point spread', unit: '°C', answer: facts.tempDewSpreadC, tolerance: 0,
            explain: `${facts.tempDewSpreadC}°C. Within about 3, watch for fog as it cools.` };
    default:
      return null;
  }
}

export function dailySheet(brief: Brief, progress: CourseProgress, mins: PersonalMinimums): SheetSection[] {
  return SECTIONS.map((s) => {
    const covered = s.lesson ? isDone(progress, s.lesson) : false;
    return {
      id: s.id,
      title: s.title,
      taughtBy: s.taughtBy,
      covered,
      prompt: covered ? promptFor(s.id, brief, mins) : null,
      findings: brief.findings.filter((f) => sectionFor(f) === s.id),
    };
  });
}

// ---------------------------------------------------------------- logbook

export const LOGBOOK_KEY = 'downwind.logbook.v1';

export interface FiledSheet {
  id: string;
  filedAt: string;
  station: string;
  source: 'live' | 'sample';
  departure: string;
  choice: ChoiceId;
  grade: Grade;
  readingsRight: number;
  readingsTotal: number;
  findings: { title: string; severity: Finding['severity'] }[];
}

export function fileSheet(log: FiledSheet[], entry: Omit<FiledSheet, 'id' | 'filedAt'>, now = new Date()): FiledSheet[] {
  return [{ ...entry, id: `${now.getTime()}`, filedAt: now.toISOString() }, ...log].slice(0, 200);
}
