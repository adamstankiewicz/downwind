// Scoring a radio flight and keeping a short record of the ones flown. A
// transmission is graded on the first try: the controller's correction and the
// second try are shown, but a call you had to be asked for twice was still
// missing something the first time.

import type { Grade } from '../scenarios/goNoGo';
import { load, save } from '../lib/storage';
import { gradeCall, type CallResult } from './grade';
import { checkCopy, type Event, type Mission, type RadioFlight } from './flights';

export interface RadioAnswers {
  /** ATIS copy pad, by field id. */
  copy: Record<string, string>;
  copyChecked: boolean;
  /** Each try at a transmission, in order. At most two. */
  calls: Record<string, string[]>;
  decisions: Record<string, string>;
}

export const emptyRadioAnswers = (): RadioAnswers => ({ copy: {}, copyChecked: false, calls: {}, decisions: {} });

/** The most tries a transmission gets: the call, and one more after the controller's correction. */
export const MAX_TRIES = 2;

type Transmit = Extract<Event, { kind: 'transmit' }>;

export function gradeTry(f: RadioFlight, e: Transmit, text: string): CallResult {
  return gradeCall(text, e.items, f.callsign);
}

/** Where a transmission stands: waiting for a call, waiting for a second try, or done. */
export function transmitState(f: RadioFlight, e: Transmit, tries: string[]): 'open' | 'retry' | 'done' {
  if (tries.length === 0) return 'open';
  const last = gradeTry(f, e, tries[tries.length - 1]);
  if (last.fix && tries.length < MAX_TRIES) return 'retry';
  return 'done';
}

/** True once the pilot has finished with an event and may go on. */
export function eventDone(f: RadioFlight, e: Event, a: RadioAnswers): boolean {
  if (e.kind === 'atis') return a.copyChecked;
  if (e.kind === 'decide') return Boolean(a.decisions[e.id]);
  return transmitState(f, e, a.calls[e.id] ?? []) === 'done';
}

export interface CallScore {
  id: string;
  title: string;
  grade: Grade;
  tries: number;
  first: CallResult;
  last: CallResult;
}

export interface RadioScore {
  grade: Grade;
  calls: CallScore[];
  /** Calls complete on the first try. */
  clean: number;
  decisions: { id: string; title: string; choice: string; grade: Grade }[];
  copyRight: number;
  copyTotal: number;
}

const RANK: Record<Grade, number> = { best: 0, acceptable: 1, marginal: 2, unsafe: 3 };

export function scoreRadio(f: RadioFlight, a: RadioAnswers): RadioScore {
  const calls: CallScore[] = [];
  const decisions: RadioScore['decisions'] = [];
  let copyRight = 0;
  let copyTotal = 0;
  for (const e of f.events) {
    if (e.kind === 'atis') {
      copyTotal = e.fields.length;
      copyRight = e.fields.filter((x) => checkCopy(x, f.atis, a.copy[x.id] ?? '')).length;
    } else if (e.kind === 'decide') {
      const choice = a.decisions[e.id];
      if (choice) decisions.push({ id: e.id, title: e.title, choice, grade: e.grades[choice] });
    } else {
      const tries = a.calls[e.id] ?? [];
      if (!tries.length) continue;
      const first = gradeTry(f, e, tries[0]);
      const last = gradeTry(f, e, tries[tries.length - 1]);
      calls.push({ id: e.id, title: e.title, grade: first.grade, tries: tries.length, first, last });
    }
  }
  const grades = [...calls.map((c) => c.grade), ...decisions.map((d) => d.grade)];
  const grade = grades.reduce<Grade>((g, x) => (RANK[x] > RANK[g] ? x : g), 'best');
  return { grade, calls, clean: calls.filter((c) => c.grade === 'best').length, decisions, copyRight, copyTotal };
}

export interface RadioLogEntry {
  at: string;
  mission: Mission;
  seed: number;
  grade: Grade;
  clean: number;
  calls: number;
}

const KEY = 'downwind.radio.v1';

export function loadRadioLog(): RadioLogEntry[] {
  return load<RadioLogEntry[]>(KEY, []);
}

export function recordRadio(f: RadioFlight, s: RadioScore, now = new Date()): RadioLogEntry[] {
  const entry: RadioLogEntry = { at: now.toISOString(), mission: f.mission, seed: f.seed, grade: s.grade, clean: s.clean, calls: s.calls.length };
  const next = [entry, ...loadRadioLog()].slice(0, 30);
  save(KEY, next);
  return next;
}
