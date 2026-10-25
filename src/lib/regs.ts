// The pilot and airplane rules behind module 1: recent experience (61.57),
// the flight review (61.56), the medical (61.23), registration (47.40),
// inspections (91.409, 91.411, 91.413, 91.207) and inoperative equipment
// (91.205, 91.213). Pure functions over calendar days so a CFI can audit any
// date the course states.
//
// Days are 'YYYY-MM-DD' strings in UTC. "Calendar months" end on the last day
// of the month, as the FAA counts them.

export type Day = string;

const MS_DAY = 86_400_000;

function parse(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toDay(d: Date): Day {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
  return toDay(new Date(parse(day).getTime() + n * MS_DAY));
}

/** Whole days from `a` to `b`; positive when `b` is later. */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / MS_DAY);
}

/** The last day of the month `months` after the month `day` falls in. */
export function endOfCalendarMonth(day: Day, months: number): Day {
  const d = parse(day);
  return toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)));
}

/** The same day of the month, `months` later or earlier, clamped to the month's end. */
export function addMonths(day: Day, months: number): Day {
  const d = parse(day);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).getUTCDate();
  return toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, Math.min(d.getUTCDate(), last))));
}

/** "Mar 14, 2026". */
export function fmtDay(day: Day): string {
  return parse(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "Saturday". */
export function weekday(day: Day): string {
  return parse(day).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** Minutes after midnight as "7:12 PM". */
export function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------------------------------------------------------------- 61.57

export interface LandingSet {
  count: number;
  fullStop: boolean;
  /** Minutes after sunset the last of these landings was made, or null in daylight. */
  afterSunsetMin: number | null;
}

export interface LogLine {
  day: Day;
  landings: LandingSet[];
}

/** The 61.57(b) night period starts an hour after sunset. */
export const NIGHT_CURRENCY_START_MIN = 60;
export const CURRENCY_DAYS = 90;
export const CURRENCY_LANDINGS = 3;

export interface CurrencyStatus {
  /** Qualifying landings within the last 90 days. */
  qualifying: number;
  current: boolean;
  /** The last day the pilot stays current with no more landings, or null if not current. */
  currentThrough: Day | null;
  /** Days from today to `currentThrough`, or null. */
  daysLeft: number | null;
  /** The day of the third most recent qualifying landing, the one that sets the date. */
  thirdDay: Day | null;
}

/**
 * Whether a landing set counts. For day currency every takeoff and landing
 * counts (tailwheel airplanes need full stops, 61.57(a)(1)(ii)). For night,
 * only full stops in the period from an hour after sunset.
 */
export function qualifies(set: LandingSet, kind: 'day' | 'night', tailwheel = false): boolean {
  if (kind === 'night') return set.fullStop && set.afterSunsetMin !== null && set.afterSunsetMin >= NIGHT_CURRENCY_START_MIN;
  return !tailwheel || set.fullStop;
}

/**
 * Recent flight experience to carry passengers, 14 CFR 61.57(a) and (b): three
 * takeoffs and landings within the preceding 90 days. A landing on day D still
 * counts on day D + 90.
 */
export function passengerCurrency(lines: LogLine[], today: Day, kind: 'day' | 'night', tailwheel = false): CurrencyStatus {
  const days: Day[] = [];
  for (const line of lines) {
    const age = daysBetween(line.day, today);
    if (age < 0 || age > CURRENCY_DAYS) continue;
    for (const set of line.landings) if (qualifies(set, kind, tailwheel)) for (let i = 0; i < set.count; i++) days.push(line.day);
  }
  days.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const third = days.length >= CURRENCY_LANDINGS ? days[CURRENCY_LANDINGS - 1] : null;
  const through = third ? addDays(third, CURRENCY_DAYS) : null;
  return {
    qualifying: days.length,
    current: through !== null,
    currentThrough: through,
    daysLeft: through ? daysBetween(today, through) : null,
    thirdDay: third,
  };
}

/** True when a landing this many minutes after sunset needs night currency to carry passengers. */
export function needsNightCurrency(landingAfterSunsetMin: number): boolean {
  return landingAfterSunsetMin >= NIGHT_CURRENCY_START_MIN;
}

// ---------------------------------------------------------------- 61.56, 61.23, 47.40

export interface DueStatus {
  /** The last day it is good. */
  through: Day;
  current: boolean;
  /** Days from today to `through`; negative once it has lapsed. */
  daysLeft: number;
}

function due(through: Day, today: Day): DueStatus {
  const daysLeft = daysBetween(today, through);
  return { through, current: daysLeft >= 0, daysLeft };
}

/** 61.56(c): a flight review within the preceding 24 calendar months. A new certificate or rating (61.56(d)) or a WINGS phase (61.56(e)) counts too. */
export function flightReview(lastReview: Day, today: Day): DueStatus {
  return due(endOfCalendarMonth(lastReview, 24), today);
}

/**
 * 61.23(d): any class of medical, used for private pilot privileges, lasts 60
 * calendar months if the pilot was under 40 at the exam and 24 if 40 or older.
 */
export function medicalForPrivate(exam: Day, ageAtExam: number, today: Day): DueStatus {
  return due(endOfCalendarMonth(exam, ageAtExam < 40 ? 60 : 24), today);
}

/** 47.40(a): a registration expires seven years after the last day of the month it was issued. */
export function registration(issued: Day, today: Day): DueStatus {
  return due(endOfCalendarMonth(issued, 84), today);
}

// ---------------------------------------------------------------- inspections

export type InspectionId = 'annual' | 'hundred' | 'transponder' | 'pitot-static' | 'elt' | 'vor';

export interface InspectionRule {
  id: InspectionId;
  name: string;
  rule: string;
  /** Calendar months, or days for the VOR check. */
  months?: number;
  days?: number;
  /** Which flights need it. */
  appliesTo: 'all' | 'for-hire' | 'ifr' | 'transponder';
}

export const INSPECTIONS: Record<InspectionId, InspectionRule> = {
  annual: { id: 'annual', name: 'Annual inspection', rule: '14 CFR 91.409(a)', months: 12, appliesTo: 'all' },
  hundred: { id: 'hundred', name: '100-hour inspection', rule: '14 CFR 91.409(b)', appliesTo: 'for-hire' },
  transponder: { id: 'transponder', name: 'Transponder check', rule: '14 CFR 91.413', months: 24, appliesTo: 'transponder' },
  'pitot-static': { id: 'pitot-static', name: 'Altimeter and static system check', rule: '14 CFR 91.411', months: 24, appliesTo: 'ifr' },
  elt: { id: 'elt', name: 'ELT inspection', rule: '14 CFR 91.207(d)', months: 12, appliesTo: 'all' },
  vor: { id: 'vor', name: 'VOR check', rule: '14 CFR 91.171', days: 30, appliesTo: 'ifr' },
};

/** When a dated inspection runs out. */
export function inspectionDue(id: Exclude<InspectionId, 'hundred'>, done: Day, today: Day): DueStatus {
  const r = INSPECTIONS[id];
  return due(r.days ? addDays(done, r.days) : endOfCalendarMonth(done, r.months!), today);
}

export interface HundredHourStatus {
  dueAtTach: number;
  remaining: number;
}

/**
 * 91.409(b): the next 100-hour is due 100 hours after the last one. The 10
 * hour allowance is only to reach a place where it can be done, and any time
 * used comes off the next interval, so `overflownBy` shifts the due time back.
 */
export function hundredHour(lastAtTach: number, tachNow: number, overflownBy = 0): HundredHourStatus {
  const dueAtTach = round1(lastAtTach + 100 - overflownBy);
  return { dueAtTach, remaining: round1(dueAtTach - tachNow) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- 91.205, 91.213

export type FlightKind = 'day' | 'night';

export interface Equipment {
  id: string;
  name: string;
  /** 91.205 paragraphs that require it, and for which flights. */
  requiredBy91205: { para: string; flight: FlightKind | 'any'; forHireOnly?: boolean }[];
}

/** 91.205(b) is day VFR; (c) adds night, and (c)(1) carries all of (b) with it. */
export const EQUIPMENT: Record<string, Equipment> = {
  airspeed: { id: 'airspeed', name: 'Airspeed indicator', requiredBy91205: [{ para: '91.205(b)(1)', flight: 'any' }] },
  altimeter: { id: 'altimeter', name: 'Altimeter', requiredBy91205: [{ para: '91.205(b)(2)', flight: 'any' }] },
  compass: { id: 'compass', name: 'Magnetic compass', requiredBy91205: [{ para: '91.205(b)(3)', flight: 'any' }] },
  tach: { id: 'tach', name: 'Tachometer', requiredBy91205: [{ para: '91.205(b)(4)', flight: 'any' }] },
  'oil-press': { id: 'oil-press', name: 'Oil pressure gauge', requiredBy91205: [{ para: '91.205(b)(5)', flight: 'any' }] },
  'oil-temp': { id: 'oil-temp', name: 'Oil temperature gauge', requiredBy91205: [{ para: '91.205(b)(7)', flight: 'any' }] },
  'fuel-gauge': { id: 'fuel-gauge', name: 'Fuel gauge', requiredBy91205: [{ para: '91.205(b)(9)', flight: 'any' }] },
  belts: { id: 'belts', name: 'Seat belt', requiredBy91205: [{ para: '91.205(b)(13)', flight: 'any' }] },
  'position-lights': { id: 'position-lights', name: 'Position light', requiredBy91205: [{ para: '91.205(c)(2)', flight: 'night' }] },
  beacon: { id: 'beacon', name: 'Anticollision light', requiredBy91205: [{ para: '91.205(c)(3)', flight: 'night' }] },
  'landing-light': { id: 'landing-light', name: 'Landing light', requiredBy91205: [{ para: '91.205(c)(4)', flight: 'night', forHireOnly: true }] },
  clock: { id: 'clock', name: 'Panel clock', requiredBy91205: [] },
  'dome-light': { id: 'dome-light', name: 'Cabin dome light', requiredBy91205: [] },
  'pitot-heat': { id: 'pitot-heat', name: 'Pitot heat', requiredBy91205: [] },
  'com-2': { id: 'com-2', name: 'Second radio', requiredBy91205: [] },
  'stall-warning': { id: 'stall-warning', name: 'Stall warning horn', requiredBy91205: [] },
  autopilot: { id: 'autopilot', name: 'Autopilot', requiredBy91205: [] },
};

export interface Squawk {
  equipment: string;
  /** What the made-up equipment list says: required by the type certificate. */
  onEquipmentList: boolean;
  /** An airworthiness directive requires it working. */
  ad?: boolean;
}

export interface InopFlight {
  kind: FlightKind;
  forHire: boolean;
}

export interface InopResult {
  mayFly: boolean;
  /** Every rule that requires the item for this flight. Empty when 91.213(d) lets it go. */
  requiredBy: string[];
}

/**
 * 91.213(d) for an airplane without an MEL: an item may be inoperative only if
 * it is not on the equipment list, not required by 91.205 or another rule for
 * the flight, and not required by an AD. Then it must be removed or
 * deactivated and placarded, and a pilot or mechanic decides it is no hazard.
 */
export function inoperative(s: Squawk, flight: InopFlight): InopResult {
  const eq = EQUIPMENT[s.equipment];
  const requiredBy: string[] = [];
  if (s.onEquipmentList) requiredBy.push('the equipment list (91.213(d)(2)(ii))');
  for (const r of eq?.requiredBy91205 ?? []) {
    const applies = r.flight === 'any' || r.flight === flight.kind;
    if (applies && (!r.forHireOnly || flight.forHire)) requiredBy.push(`14 CFR ${r.para}`);
  }
  if (s.ad) requiredBy.push('an airworthiness directive (91.213(d)(2)(iv))');
  return { mayFly: requiredBy.length === 0, requiredBy };
}

// ---------------------------------------------------------------- grading

export type LegalGrade = 'best' | 'acceptable' | 'marginal' | 'unsafe';

export interface PlanCheck {
  legal: boolean;
  /** Does the plan still do what the pilot set out to do? */
  meetsGoal: boolean;
  /** Spare margin in the plan's own units (minutes, hours), when it has one. */
  margin?: number;
  /** Below this margin a legal plan is graded marginal. */
  tightBelow?: number;
}

/**
 * Module 1's decisions are about rules, so the grade follows them: a plan
 * that breaks one is unsafe, a legal plan with no room left is marginal, a
 * legal plan that gives up the goal is acceptable, and a legal plan that
 * keeps it is best.
 */
export function gradePlan(p: PlanCheck): LegalGrade {
  if (!p.legal) return 'unsafe';
  if (p.margin !== undefined && p.tightBelow !== undefined && p.margin < p.tightBelow) return 'marginal';
  return p.meetsGoal ? 'best' : 'acceptable';
}
