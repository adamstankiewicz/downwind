// The course model. A module is a group of lessons in ACS order; a lesson is a
// short flight the instructor briefs, works, then hands over. Lessons are
// built at run time from the pilot's own field, airplane and minimums, so the
// same lesson reads differently for every pilot and never assumes one.
//
// Text fields may contain **bold** spans. Everything that is scored is
// computed by code (lib/ and scenarios/), never written into the copy by hand.

import type { Airport } from '../data/airports';
import type { AircraftProfile } from '../data/aircraft';
import type { PersonalMinimums } from '../data/pilot';
import type { Brief, Grade } from '../scenarios/goNoGo';
import type { LatLon, NavLog } from '../lib/nav';
import type { Performance } from '../lib/perf';
import type { CarbIceRisk, InstrumentId, PowerSource } from '../lib/systems';
import type { Volume } from '../lib/airspace';
import type { PlanLeg } from '../scenarios/airspacePlan';
import type { Envelope, WbResult } from '../lib/wb';

export interface LessonContext {
  /** The pilot's home field, or the practice field when it can't be used. */
  airport: Airport;
  /** True when `airport` is the built-in practice field. */
  practiceField: boolean;
  aircraft: AircraftProfile;
  minimums: PersonalMinimums;
  now: Date;
  /** The pilot's last flight review (ISO date), when they have entered it. */
  lastFlightReview?: string | null;
  /**
   * Which of the lesson's situations to build, from 0 to `variants - 1`
   * (course/variant.ts picks one the pilot hasn't seen). Missing means 0.
   */
  variant?: number;
}

/** What the instructor says, at two levels. `short` is used once the pilot has the idea. */
export interface Coach {
  full: string;
  short: string;
}

export type Figure =
  | { kind: 'metar'; raw: string; /** Tokens to underline in the raw report. */ marks?: string[] }
  | { kind: 'taf'; raw: string; departure: Date; returnAt: Date }
  | { kind: 'wind'; airport: Airport; windMag: number; speedKt: number; gustKt: number | null; runwayId: string }
  /**
   * The practice sectional (chart/practiceRegion.ts). `route` and `highlight`
   * name airports, checkpoints or airspace volumes by id; `focus` centers and
   * zooms on one of them; `marker` drops an airplane at a position and altitude.
   * `extra` adds volumes that aren't printed on the chart, such as a TFR from a NOTAM.
   */
  | { kind: 'chart'; route?: string[]; highlight?: string[]; focus?: { id: string; radiusNm: number }; marker?: { pos: LatLon; altMsl: number; label?: string }; extra?: Volume[] }
  /**
   * The side view of a path across the practice sectional: ground, the planned
   * altitude, and the floors and ceilings overhead (scenarios/airspacePlan.ts,
   * profileAlong). `marks` label points along the path; `airplaneAtNm` puts the
   * airplane on it.
   */
  | { kind: 'profile'; start: LatLon; startAltMsl: number; legs: PlanLeg[]; marks?: { atNm: number; label: string }[]; airplaneAtNm?: number; extra?: Volume[] }
  /** A POH-style performance chart with the four corners used for the reading marked. */
  | { kind: 'perf'; chart: PerfChartId; performance: Performance; paFt: number; oatC: number; sample: boolean }
  | { kind: 'navlog'; log: NavLog; altitudeMsl?: number }
  /** The CG envelope with a loading plotted, and its zero-fuel point so the burn line shows. */
  | { kind: 'wb'; envelope: Envelope; maxGrossLb: number; loaded: WbResult; zeroFuel: WbResult; sample: boolean; practice: boolean }
  /** Glide range from a height, with candidate fields by bearing and distance. */
  | { kind: 'glide'; heightAglFt: number; rangeNm: number; windFromTrue?: number; windKt?: number; fields: { name: string; bearingTrue: number; distanceNm: number; reachable: boolean }[] }
  /**
   * The electrical bus: each load, what it draws, and whether it is on. With
   * the alternator failed, the battery carries `totalAmps` for `minutesLeft`.
   */
  | { kind: 'electrical'; volts: number; alternator: 'online' | 'failed'; loads: ElectricalLoad[]; totalAmps: number; usableAh: number; minutesLeft: number; sample: boolean }
  /** The six basic instruments and the compass, each with its source and what it shows now. */
  | { kind: 'panel'; instruments: PanelInstrument[] }
  /** The PHAK carburetor icing chart (figure 7-12) with today's air marked. */
  | { kind: 'carbIce'; tempC: number; dewC: number; rhPct: number; risk: CarbIceRisk }
  /**
   * A page of paperwork made up for the lesson: logbook lines, the documents
   * in the airplane, maintenance entries or a squawk list. `focus` rows are the
   * ones the step is about. Cells are plain text; the caption says it is made up.
   */
  | { kind: 'records'; variant: RecordsVariant; title: string; columns: RecordColumn[]; rows: RecordRow[]; caption: string };

export interface ElectricalLoad {
  id: string;
  name: string;
  amps: number;
  on: boolean;
  /** Stays on after a load shed. */
  essential: boolean;
}

export interface PanelInstrument {
  id: InstrumentId;
  sources: PowerSource[];
  /** `wrong` is telling a lie the pilot has to catch; `covered` has been covered over by the pilot. */
  state: 'ok' | 'wrong' | 'covered';
  /**
   * What the needle shows. asi: knots. ai: bank in degrees, right positive
   * (with `pitchDeg`). alt: feet. tc: turn rate in standard-rate units, right
   * positive. hi and compass: heading in degrees. vsi: feet per minute.
   */
  value: number;
  pitchDeg?: number;
}

export type RecordsVariant = 'logbook' | 'documents' | 'maintenance' | 'squawks';

export interface RecordColumn {
  label: string;
  /** Numbers and dates right-aligned in the mono face. */
  num?: boolean;
}

export interface RecordRow {
  cells: string[];
  focus?: boolean;
  /** A short line under the row, such as a remark or a placard. */
  note?: string;
}

export type PerfChartId = 'takeoff-roll' | 'takeoff-50' | 'landing-roll' | 'landing-50' | 'climb';

export interface WorkRow {
  label: string;
  value: string;
  note?: string;
}

export interface Blank {
  id: string;
  label: string;
  unit?: string;
  /** Number answers are checked within `tolerance`; string answers come from `choices`. */
  answer: number | string;
  tolerance?: number;
  choices?: string[];
  /** Shown after checking, right or wrong. */
  explain: string;
}

/**
 * A decision option id. Weather decisions use the go/no-go ids ('go',
 * 'go-plan', 'delay', 'cancel'); other lessons name their own ('land-ahead',
 * 'turn-back'). Grades always come from code, keyed by these ids.
 */
export type OptionId = string;

export interface Option {
  id: OptionId;
  label: string;
}

/** Shown only when an earlier decision went a certain way. */
export interface Condition {
  step: string;
  choices: OptionId[];
}

export type Step =
  | { kind: 'brief'; id: string; title: string; scene?: string; say: Coach; figure?: Figure; showIf?: Condition }
  | { kind: 'example'; id: string; title: string; say: Coach; figure?: Figure; work: WorkRow[]; showIf?: Condition }
  | { kind: 'turn'; id: string; title: string; prompt: string; figure?: Figure; blanks: Blank[]; showIf?: Condition }
  | {
      kind: 'decide';
      id: string;
      title: string;
      situation: string;
      figure?: Figure;
      options: Option[];
      grades: Record<OptionId, Grade>;
      /** What happened next, for the option chosen. */
      consequence: Record<OptionId, string>;
      /** The instructor's reasoning, shown in the debrief. */
      why: string;
      /** Engine brief behind the grades, when there is one. */
      brief?: Brief;
      /** Options read as a sequence (altitudes, times), so they are never shuffled. */
      keepOrder?: boolean;
      showIf?: Condition;
    };

export interface Lesson {
  id: string;
  module: number;
  title: string;
  /** One sentence for the course page. */
  summary: string;
  minutes: number;
  /** ACS task codes, FAA-S-ACS-6C. Element-level codes come with the ACS import. */
  acs: string[];
  refs: string[];
  /**
   * How many different situations `build` can write, chosen by `ctx.variant`.
   * Step ids stay the same in every situation so review cards can find them.
   */
  variants?: number;
  build(ctx: LessonContext): Step[];
}

export interface Module {
  n: number;
  title: string;
  summary: string;
  acsAreas: string[];
  /** Playable lessons. Empty while the module is being written. */
  lessons: Lesson[];
  /** Lesson titles planned for a module that isn't written yet. */
  outline: string[];
}
