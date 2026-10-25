// Module 8, Human factors and risk: four flights about the pilot rather than
// the airplane or the sky. The rules behind them (adjusted minimums, fitness
// to fly, oxygen, night currency, room under a lowering ceiling) live in
// lib/human.ts; every number in the copy and every grade comes from there or
// from the go/no-go engine, built around the pilot's own minimums.

import { buildBrief, type Brief, type ChoiceId, type Grade } from '../scenarios/goNoGo';
import { parseMetar } from '../lib/metar';
import { vfrReserveMin, fuelPlan, sampleTrainerPerformance } from '../lib/perf';
import { destination, distanceNm, trueCourse, type LatLon } from '../lib/nav';
import { positionAt, vfrMinimums } from '../lib/airspace';
import {
  adjustedMinimums, fitnessCheck, fitToFlyAt, mayCarryPassengers, medicationWaitH, nightCurrency, nightTimes, oxygenRequired, squeeze,
  BOTTLE_TO_THROTTLE_H, DOSING_INTERVALS_TO_WAIT, MARGIN, MARGIN_FACTORS, NIGHT_LANDINGS_REQUIRED, SOUND_SLEEP_H,
  type FitnessInput, type FitnessItem, type MarginFactor, type NightLanding, type Squeeze,
} from '../lib/human';
import { chartAirport, practiceRegion } from '../chart/practiceRegion';
import { addHours, cloud, mainRunway, metarText, nextLocalHour, observedAt, wholeHourAfter, windAcross } from './practice';
import type { Lesson, LessonContext, Option } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const local = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const day = (d: Date) => d.toLocaleDateString([], { weekday: 'long' });
const round100 = (n: number) => Math.round(n / 100) * 100;
const sm = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function fieldName(ctx: LessonContext): string {
  return ctx.practiceField ? 'the practice field' : ctx.airport.icao;
}

/**
 * Like module 2: copy is written for the conditions the lesson sets up. When
 * the pilot's own numbers make the engine grade an option differently, that
 * option's consequence follows the engine instead.
 */
function engineConsequences(brief: Brief, intended: Partial<Record<ChoiceId, Grade>>, written: Record<ChoiceId, string>): Record<ChoiceId, string> {
  const out = {} as Record<ChoiceId, string>;
  for (const id of Object.keys(written) as ChoiceId[]) {
    if (!intended[id] || brief.grades[id] === intended[id]) out[id] = written[id];
    else {
      const top = brief.findings.find((f) => f.severity !== 'info');
      out[id] = top
        ? `With your numbers this plays out differently: ${top.title.toLowerCase()}. ${brief.rationale}`
        : `With your numbers nothing on this report binds, even with the wider margin. ${brief.rationale}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 8.1

/** The factors 8.1 sets up: five weeks without flying, and a friend with a dinner booking. */
export const PRESSURE_FACTORS: MarginFactor[] = ['not-current', 'pressure'];

const minimumsUnderPressure: Lesson = {
  id: '8.1', module: 8, minutes: 14,
  title: 'Minimums under pressure',
  summary: 'Widen your personal minimums for the day you are actually having, then hold the line when a passenger is counting on you.',
  acs: ['PA.I.H', 'PA.II.A', 'PA.I.C'],
  refs: ['Risk Management Handbook (FAA-H-8083-2), personal minimums', 'PHAK, the PAVE checklist', 'PHAK, hazardous attitudes'],
  build(ctx) {
    const f = ctx.airport;
    const rwy = mainRunway(f);
    const base = ctx.minimums;
    const adj = adjustedMinimums(base, PRESSURE_FACTORS);
    const obs = observedAt(ctx.now);
    const dep = wholeHourAfter(ctx.now, 1);
    // Above the baseline ceiling, under the adjusted one; visibility clears both.
    const ceiling = Math.max(1100, round100(base.ceilingFt + MARGIN.ceilingFt / 2 + 50));
    const vis = Math.ceil(adj.visibilitySm + 1);
    const raw = metarText({
      station: f.icao, at: obs, wind: { dirTrue: windAcross(f, rwy.headingMag, 10), speedKt: 6 }, vis: `${vis}SM`,
      sky: [cloud('SCT', round100(ceiling * 0.6)), cloud('BKN', ceiling)], tempC: 15, dewC: 7, altimeter: 30.04,
    });
    const metar = parseMetar(raw);
    const input = { airport: f, aircraft: ctx.aircraft, wb: null, metar, taf: null, departure: dep, tripHours: 2 };
    const baseline = buildBrief({ ...input, minimums: base });
    const brief = buildBrief({ ...input, minimums: adj });
    const figure = { kind: 'metar' as const, raw, marks: [cloud('BKN', ceiling)] };
    const meets = (m: typeof base) => ceiling >= m.ceilingFt && vis >= m.visibilitySm;

    return [
      {
        kind: 'brief', id: 'b1', title: 'A number written on a calm day',
        scene: `${day(dep)}. You haven't flown in five weeks. A friend is coming along for a two-hour flight from ${fieldName(ctx)}, off around ${local(dep)}, with a dinner booked at the other end.`,
        say: {
          full: `Personal minimums are written at a desk, on a good day, for a pilot who is current and rested. The Risk Management Handbook says to **widen them** when the day is not that day: illness or fatigue, not having flown recently, somewhere unfamiliar, or pressure to get there. The rule is simple: add at least **${fmt(MARGIN.ceilingFt)} feet** to the ceiling, at least **half a mile** to the visibility, and take at least **${MARGIN.windKt} knots** off the wind. Today has two of those factors. Count them before you look at the weather.`,
          short: `Widen for the day: +${fmt(MARGIN.ceilingFt)} ft, +½ mile, −${MARGIN.windKt} kt.`,
        },
        figure,
      },
      {
        kind: 'example', id: 'e1', title: 'Your numbers, widened',
        say: {
          full: `Here are your minimums as you wrote them, and as they stand today. Notice that the margin is added **once**, whether one factor applies or four. It is a floor for the adjustment, not a scoring system: you can always add more.`,
          short: 'Added once, at least. More is always allowed.',
        },
        work: [
          { label: 'Factors today', value: PRESSURE_FACTORS.map((x) => MARGIN_FACTORS[x].split(',')[0]).join('; '), note: 'Five weeks without flying. A passenger and a dinner booking.' },
          { label: 'Ceiling', value: `${fmt(base.ceilingFt)} → ${fmt(adj.ceilingFt)} ft`, note: `Plus ${fmt(MARGIN.ceilingFt)}` },
          { label: 'Visibility', value: `${sm(base.visibilitySm)} → ${sm(adj.visibilitySm)} SM`, note: 'Plus half a mile' },
          { label: 'Crosswind', value: `${base.crosswindKt} → ${adj.crosswindKt} kt`, note: `Minus ${MARGIN.windKt}` },
          { label: 'Gust spread', value: `${base.gustSpreadKt} → ${adj.gustSpreadKt} kt`, note: `Minus ${MARGIN.windKt}` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Here is the report. Against today's widened minimums, what ceiling and visibility do you need, and how much ceiling is the field short by? Then name the pressures.`,
        figure,
        blanks: [
          { id: 'ceil', label: 'Ceiling you need today', unit: 'ft', answer: adj.ceilingFt, tolerance: 0,
            explain: `${fmt(base.ceilingFt)} plus ${fmt(MARGIN.ceilingFt)} is ${fmt(adj.ceilingFt)} feet.` },
          { id: 'vis', label: 'Visibility you need today', unit: 'SM', answer: adj.visibilitySm, tolerance: 0,
            explain: `${sm(base.visibilitySm)} plus a half is ${sm(adj.visibilitySm)} miles. The report has ${vis}, so visibility is not today's problem.` },
          { id: 'short', label: 'Ceiling short by', unit: 'ft', answer: Math.max(0, adj.ceilingFt - ceiling), tolerance: 0,
            explain: `The ceiling is the broken layer at ${fmt(ceiling)}. ${fmt(adj.ceilingFt)} minus ${fmt(ceiling)} is ${fmt(Math.max(0, adj.ceilingFt - ceiling))} feet. On your written minimum it would have been ${fmt(ceiling - base.ceilingFt)} feet **over**.` },
          { id: 'pave', label: 'The dinner booking is', answer: 'External pressures', choices: ['Pilot', 'Aircraft', 'enVironment', 'External pressures'],
            explain: 'PAVE: **P**ilot, **A**ircraft, en**V**ironment, **E**xternal pressures. A plan someone is waiting on is the E, and it is the one that quietly argues with the other three.' },
          { id: 'attitude', label: 'Your own thought, "I can handle a little low cloud," is', answer: 'Macho', choices: ['Anti-authority', 'Impulsivity', 'Invulnerability', 'Macho', 'Resignation'],
            explain: 'Macho is "I can do it," the urge to prove something. Its antidote in the PHAK: **taking chances is foolish.** Invulnerability is the cousin, "it won\'t happen to me."' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Your friend is already at the airport',
        situation: `${fmt(ceiling)} broken, ${vis} miles. That clears the ${fmt(base.ceilingFt)} foot minimum you wrote down, but not the ${fmt(adj.ceilingFt)} you need today. Your friend says, "It's legal, isn't it? People fly in worse all the time."`,
        brief,
        options: [
          { id: 'go', label: 'Go. It is above the minimums you wrote down.' },
          { id: 'go-plan', label: 'Go, and turn back if the bases look lower than reported.' },
          { id: 'delay', label: 'Wait for the next report and tell your friend why.' },
          { id: 'cancel', label: 'Call it for today, and offer another day.' },
        ],
        grades: brief.grades,
        consequence: engineConsequences(brief, { go: 'unsafe', 'go-plan': 'marginal' }, {
          go: `You go on the written number. Twenty minutes out the bases are ragged, rusty hands are busy holding altitude, and the conversation turns quiet. You make it, but you flew the day on a minimum written for a pilot you weren't today.`,
          'go-plan': 'A turn-back point is a good habit, but it moves the decision into the air, where the same pressure is sitting in the right seat and a rusty pilot has less attention to spare.',
          delay: `Reasonable. Say why out loud: "I widen my minimums when I haven't flown in a while." Without a forecast, though, the next report may say the same, and then you face the same choice an hour hungrier.`,
          cancel: 'The clean call. Your friend is disappointed for an hour; the dinner moves to next week. Saying no to someone you like is the hardest part of personal minimums, and the part that makes them work.',
        }),
        why: `${meets(base) ? 'The report clears your written minimums' : 'The report is under even your written minimums'}${meets(adj) ? ' and the widened ones.' : `, but ${meets(base) ? 'not' : 'nor'} the ${fmt(adj.ceilingFt)} foot ceiling you need with today's factors.`} The friend's "it's legal" answers a question your minimums never asked, and the dinner is an external pressure. ${baseline.grades.go === 'best' ? 'On a day without those factors this would have been a go, which is exactly why the adjustment exists.' : ''} ${brief.rationale}`.replace(/\s+/g, ' ').trim(),
      },
    ];
  },
};

// ---------------------------------------------------------------- 8.2

/** 8.2's night before: one beer at nine, an antihistamine at eleven, six hours of sleep. */
export function nightBefore(departure: Date): FitnessInput {
  return {
    lastDrinkAt: addHours(departure, -12),
    medication: { lastDoseAt: addHours(departure, -10), maxDosingIntervalH: 6 },
    sleepH: 6,
  };
}

/** A grade for flying at a given time: any no-fly item is unsafe; a short night is a caution. */
export function fitnessGrade(items: FitnessItem[]): Grade {
  if (items.some((i) => i.severity === 'no-fly')) return 'unsafe';
  if (items.some((i) => i.severity === 'caution')) return 'acceptable';
  return 'best';
}

/** The ridge trip 8.2 mentions: cabin altitude and minutes there. */
export const HIGH_LEG = { altMsl: 13500, minutes: 50 };

const fitness: Lesson = {
  id: '8.2', module: 8, minutes: 16,
  title: 'Fatigue, hypoxia and medication',
  summary: 'Run IMSAFE on yourself with real times: the last drink, the last dose, the hours slept, and the altitude your brain stops noticing.',
  acs: ['PA.I.H', 'PA.II.A'],
  refs: ['14 CFR 91.17, alcohol', '14 CFR 61.53, medical deficiency', 'PHAK, drugs', 'PHAK, fatigue', 'PHAK, hypoxia', '14 CFR 91.211, supplemental oxygen', 'AIM 8-1, fitness for flight'],
  build(ctx) {
    const dep = nextLocalHour(ctx.now, 9);
    const night = nightBefore(dep);
    const med = night.medication!;
    const wait = medicationWaitH(med.maxDosingIntervalH);
    const items = fitnessCheck(night, dep);
    const byId = Object.fromEntries(items.map((i) => [i.id, i])) as Record<FitnessItem['id'], FitnessItem>;
    const clearAt = fitToFlyAt(items)!;
    const stillToWait = Math.max(0, Math.round((clearAt.getTime() - dep.getTime()) / 3_600_000));
    const o2 = oxygenRequired(HIGH_LEG.altMsl, HIGH_LEG.minutes);
    const o2High = oxygenRequired(14500, HIGH_LEG.minutes);
    const o2Low = oxygenRequired(12500, HIGH_LEG.minutes);

    // Each option is a departure time, graded by the same check.
    const when: Record<string, { at: Date; sleepH: number }> = {
      fly: { at: dep, sleepH: night.sleepH },
      'fly-local': { at: dep, sleepH: night.sleepH },
      afternoon: { at: addHours(dep, 6), sleepH: night.sleepH + 1.5 },
      tomorrow: { at: addHours(dep, 24), sleepH: SOUND_SLEEP_H },
    };
    const grades = Object.fromEntries(Object.entries(when).map(([id, w]) => [id, fitnessGrade(fitnessCheck({ ...night, sleepH: w.sleepH }, w.at))])) as Record<string, Grade>;
    const clearBy = (id: string) => when[id].at.getTime() >= clearAt.getTime();

    return [
      {
        kind: 'brief', id: 'b1', title: 'The night before',
        scene: `You're flying from ${fieldName(ctx)} at ${local(dep)} on ${day(dep)}. The evening before, you had one beer with dinner at ${local(night.lastDrinkAt!)}, then took an antihistamine for a stuffy nose at ${local(med.lastDoseAt)}. The box says "every 4 to ${med.maxDosingIntervalH} hours" and "may cause drowsiness". You slept about ${night.sleepH} hours.`,
        say: {
          full: `**IMSAFE** is the check on the pilot: **I**llness, **M**edication, **S**tress, **A**lcohol, **F**atigue, **E**motion (or eating). Most of it is judgment, but two items have hard numbers. Alcohol: 91.17 says **${BOTTLE_TO_THROTTLE_H} hours** from the last drink, and under 0.04 percent. Medication: 61.53 says don't fly with a condition or a treatment that makes you unsafe, and the PHAK gives the yardstick: wait at least **${DOSING_INTERVALS_TO_WAIT} maximal dosing intervals** after anything sedating. The maximum interval is the longer number on the label.`,
          short: `Alcohol ${BOTTLE_TO_THROTTLE_H} hours. Sedating medication: ${DOSING_INTERVALS_TO_WAIT} times the longest dosing interval.`,
        },
      },
      {
        kind: 'example', id: 'e1', title: 'Hypoxia, before it matters',
        say: {
          full: `One more limit you can't feel: oxygen. Hypoxia is sneaky because the first thing it takes is your ability to notice it, and fatigue, alcohol and antihistamines all make it worse. The rule in 91.211 is about the cabin altitude. Here it is for a ${HIGH_LEG.minutes} minute stretch over high ground, worked at three altitudes.`,
          short: 'Above 12,500: over 30 minutes. Above 14,000: all of it. Above 15,000: everyone offered it.',
        },
        work: [
          { label: '12,500 ft', value: `${o2Low.crewMinutes} min`, note: 'At or below 12,500 there is no requirement' },
          { label: `${fmt(HIGH_LEG.altMsl)} ft`, value: `${o2.crewMinutes} min for the crew`, note: `Up to 14,000: the part beyond 30 minutes. ${HIGH_LEG.minutes} minus 30.` },
          { label: '14,500 ft', value: `${o2High.crewMinutes} min for the crew`, note: 'Above 14,000: the whole time' },
          { label: 'Above 15,000', value: 'Everyone aboard', note: 'Oxygen must be provided to each occupant' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Work out the night before against your ${local(dep)} departure.`,
        blanks: [
          { id: 'drink', label: 'Hours since the beer', unit: 'h', answer: Math.round(byId.alcohol.hours), tolerance: 0,
            explain: `${local(night.lastDrinkAt!)} to ${local(dep)} is ${Math.round(byId.alcohol.hours)} hours, past the ${BOTTLE_TO_THROTTLE_H} hour rule. One beer twelve hours ago is not today's problem.` },
          { id: 'wait', label: 'Wait after the antihistamine', unit: 'h', answer: wait, tolerance: 0,
            explain: `The longest interval on the label is ${med.maxDosingIntervalH} hours. ${DOSING_INTERVALS_TO_WAIT} times ${med.maxDosingIntervalH} is ${wait}.` },
          { id: 'left', label: 'Hours still to wait at departure', unit: 'h', answer: stillToWait, tolerance: 0,
            explain: `The dose was ${Math.round(byId.medication.hours)} hours before departure; ${wait} minus ${Math.round(byId.medication.hours)} is ${stillToWait}. You are clear at ${local(clearAt)} on ${day(clearAt)}.` },
          { id: 'o2', label: `Crew oxygen, ${HIGH_LEG.minutes} min at ${fmt(HIGH_LEG.altMsl)} ft`, unit: 'min', answer: o2.crewMinutes, tolerance: 0,
            explain: `Between 12,500 and 14,000 the crew uses oxygen for the part beyond 30 minutes: ${o2.crewMinutes} minutes.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'You feel fine',
        situation: `It is ${local(addHours(dep, -1.5))}. You feel mostly fine, a little foggy, and the weather is beautiful. The medication clears at ${local(clearAt)} on ${day(clearAt)}.`,
        options: [
          { id: 'fly', label: 'Fly as planned. You feel fine.' },
          { id: 'fly-local', label: 'Stay in the pattern instead, close to the field.' },
          { id: 'afternoon', label: `Have a coffee and a nap and go at ${local(when.afternoon.at)}.` },
          { id: 'tomorrow', label: `Move it to ${local(when.tomorrow.at)} ${day(when.tomorrow.at)}.` },
        ] satisfies Option[],
        grades,
        consequence: {
          fly: clearBy('fly') ? 'You go, and it is fine.' : `"Feeling fine" is the one symptom sedating antihistamines are known for. Reaction time and judgment are slowed in a way you don't notice, and you are still ${stillToWait} hours short of the wait.`,
          'fly-local': 'The pattern is the busiest, lowest, most decision-dense part of any flight. The medication does not scale down with the length of the trip.',
          afternoon: clearBy('afternoon') ? 'By the afternoon you are clear and a little more rested.' : `Coffee covers the drowsiness, not the slowed reactions. At ${local(when.afternoon.at)} you are still ${Math.round((clearAt.getTime() - when.afternoon.at.getTime()) / 3_600_000)} hours short of the wait.`,
          tomorrow: `Clear of the medication and after a full night's sleep. Same airplane, same sky, a pilot who is all there.`,
        },
        why: `Alcohol is past its ${BOTTLE_TO_THROTTLE_H} hours, but the antihistamine needs ${wait}, and a ${night.sleepH} hour night stacks fatigue on top. The rule does not care how you feel, because the drug works on the part of you that would notice. ${grades.tomorrow === 'best' ? `Only ${day(when.tomorrow.at)} clears every item.` : ''}`.trim(),
      },
    ];
  },
};

// ---------------------------------------------------------------- 8.3

const R = practiceRegion;
const pt = (id: string): LatLon => (chartAirport(id)?.pos ?? R.checkpoints.find((c) => c.id === id)!.pos);

/** The highest ground or charted obstacle within `corridorNm` of a route, sampled every half mile. */
export function highestAlong(route: LatLon[], corridorNm = 2): { msl: number; groundFt: number; at: LatLon } {
  let best = { msl: -Infinity, groundFt: 0, at: route[0] };
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const d = distanceNm(a, b);
    const tc = trueCourse(a, b);
    for (let s = 0; s <= d; s += 0.5) {
      const p = destination(a, tc, s);
      const g = R.groundFt(p);
      if (g > best.msl) best = { msl: g, groundFt: g, at: p };
      for (const o of R.obstacles) {
        if (distanceNm(p, o.pos) <= corridorNm && o.mslFt > best.msl) best = { msl: o.mslFt, groundFt: R.groundFt(o.pos), at: o.pos };
      }
    }
  }
  return best;
}

const legsNm = (ids: string[]) => ids.slice(1).reduce((n, id, i) => n + distanceNm(pt(ids[i]), pt(id)), 0);

/** 8.3's trip on the practice chart, and where the decision comes. */
export const TRIP = { flown: ['KXYZ', 'harlow', 'long-lake'], ahead: ['long-lake', 'pinecrest', 'KXQA'], climbMin: 8 };

export interface ContinuationInput {
  ahead: Squeeze;
  /** Cover of the layer you would have to climb over. */
  layer: 'SCT' | 'BKN' | 'OVC';
  /** Fuel left over the reserve after flying home, or after holding first. */
  marginHomeGal: number;
  marginAfterHoldGal: number;
  /** The weather behind you is inside your minimums. */
  homeWithinMinimums: boolean;
}

/** Grades for pressing on, climbing over, holding, or turning back. */
export function continuationGrades(c: ContinuationInput): Record<'press-on' | 'climb-over' | 'hold' | 'turn-back', Grade> {
  const back = c.homeWithinMinimums && c.marginHomeGal >= 0;
  return {
    'press-on': !c.ahead.legal || !c.ahead.withinPersonal ? 'unsafe' : 'acceptable',
    'climb-over': c.layer === 'SCT' ? 'marginal' : 'unsafe',
    hold: c.marginAfterHoldGal < 0 ? 'unsafe' : 'marginal',
    'turn-back': back ? 'best' : 'marginal',
  };
}

const getThereItis: Lesson = {
  id: '8.3', module: 8, minutes: 18,
  title: 'Get-there-itis',
  summary: 'Halfway to lunch under a lowering ceiling: measure the room between the clouds and the hills, and turn around while turning around is easy.',
  acs: ['PA.I.H', 'PA.VI.C', 'PA.I.C'],
  refs: ['PHAK, operational pitfalls', '14 CFR 91.155, basic VFR weather minimums', '14 CFR 91.119(c)', 'Risk Management Handbook, personal minimums'],
  build(ctx) {
    const mins = ctx.minimums;
    const dest = chartAirport('KXQA')!;
    const home = chartAirport('KXYZ')!;
    const here = pt('long-lake');
    const groundHere = R.groundFt(here);
    const hi = highestAlong(TRIP.ahead.map(pt));
    // The base ahead leaves 800 ft over the high ground: legal low in Class G by day, under any sensible minimum.
    // Reports give the base in hundreds above the field, so the base ahead is built from the destination's report.
    const destCeiling = round100(hi.msl + 800 - dest.elevationFt);
    const baseAhead = destCeiling + dest.elevationFt;
    const baseHere = baseAhead + 700;
    const visAhead = 4;
    const classAt = (alt: number) => positionAt(R.airspace, hi.at, alt, hi.groundFt, R.veils).cls;
    const sq = squeeze({ cloudBaseMsl: baseAhead, highestMsl: hi.msl, groundMsl: hi.groundFt, visibilitySm: visAhead, night: false, mins }, classAt);

    const perf = ctx.aircraft.performance ?? sampleTrainerPerformance();
    const sample = !ctx.aircraft.performance || ctx.aircraft.sampleValues || ctx.aircraft.usableFuelGal <= 0;
    const onBoard = ctx.aircraft.usableFuelGal > 0 ? ctx.aircraft.usableFuelGal : 40;
    const tas = perf.cruise.tasKt;
    const flownNm = legsNm(TRIP.flown);
    const aheadNm = legsNm(TRIP.ahead);
    const backNm = distanceNm(here, home.pos);
    const flownMin = (flownNm / tas) * 60;
    const out = fuelPlan(perf, { climbMin: TRIP.climbMin, cruiseMin: Math.max(0, flownMin - TRIP.climbMin), night: false, onBoardGal: onBoard });
    const burned = out.taxiGal + out.climbGal + out.cruiseGal;
    const left = Math.round((onBoard - burned) * 10) / 10;
    const backMin = Math.round((backNm / tas) * 60);
    const aheadMin = Math.round((aheadNm / tas) * 60);
    const homePlan = fuelPlan(perf, { climbMin: 0, cruiseMin: backMin, night: false, onBoardGal: left });
    const holdPlan = fuelPlan(perf, { climbMin: 0, cruiseMin: backMin + 30, night: false, onBoardGal: left });
    const homeCeiling = Math.max(round100(mins.ceilingFt + 1500), 4500);

    const grades = continuationGrades({
      ahead: sq, layer: 'BKN', marginHomeGal: homePlan.marginGal, marginAfterHoldGal: holdPlan.marginGal, homeWithinMinimums: homeCeiling >= mins.ceilingFt,
    });

    const destMetar = metarText({
      station: dest.id, at: observedAt(ctx.now), wind: { dirTrue: 200, speedKt: 6 }, vis: `${visAhead}SM`, weather: ['-RA', 'BR'],
      sky: [cloud('BKN', destCeiling), cloud('OVC', destCeiling + 1200)], tempC: 11, dewC: 8, altimeter: 29.92,
    });
    const chart = (marks: string[]) => ({ kind: 'chart' as const, route: [...TRIP.flown, ...TRIP.ahead.slice(1)], highlight: marks, marker: { pos: here, altMsl: baseHere - 500, label: 'You' } });
    const legal = sq.legal
      ? `Down there it is Class ${sq.cls}${sq.cls === 'G' && !sq.minimums.clouds ? ', where by day the law asks only for a mile and clear of clouds' : ''}. **Legal.** That is the trap.`
      : 'Not even legal: you can\'t keep the cloud clearance and the height above the ground at the same time.';

    return [
      {
        kind: 'brief', id: 'b1', title: 'Halfway to lunch',
        scene: `On the practice chart: ${home.id} to ${dest.name} (${dest.id}), ${fmt(flownNm + aheadNm)} miles west for lunch with friends who are already there. You are over Long Lake, ${fmt(flownNm)} miles out and ${fmt(aheadNm)} to go. The bases have been coming down since Harlow; you've stepped down twice to stay under them.`,
        say: {
          full: `The PHAK lists **operational pitfalls**, and two of them are sitting in the cockpit with you. **Get-there-itis**: the destination, the people waiting and the miles already flown start making the decision. And its tool, **scud running**: pushing lower and lower under a ceiling to keep the ground in sight. Neither feels like a decision. Each step down is small. So swap the feeling for a number: how much room is left between the clouds and the highest thing under your route?`,
          short: 'Swap the feeling for a number: cloud base minus the highest ground ahead.',
        },
        figure: chart(['long-lake', 'pinecrest']),
      },
      {
        kind: 'example', id: 'e1', title: 'Measuring the room',
        say: {
          full: `Here it is where you are now, and the fuel to go home, worked the same way you'd do it on a kneeboard. ${sample ? 'The fuel uses sample performance numbers, not your POH.' : 'The fuel uses your airplane\'s numbers.'} Assume still air.`,
          short: 'Base minus ground, then fuel home.',
        },
        figure: chart(['long-lake']),
        work: [
          { label: 'Base here', value: `${fmt(baseHere)} ft MSL`, note: 'From your altimeter at the bottom of the layer' },
          { label: 'Ground here', value: `${fmt(groundHere)} ft MSL`, note: 'Long Lake, from the chart' },
          { label: 'Room here', value: `${fmt(baseHere - groundHere)} ft`, note: baseHere - groundHere >= mins.ceilingFt ? `Inside your ${fmt(mins.ceilingFt)} foot minimum, for now` : `Already under your ${fmt(mins.ceilingFt)} foot minimum. That is how the step-downs add up.` },
          { label: 'Fuel left', value: `${left} gal`, note: `${onBoard} on board${sample ? ' (sample)' : ''}, ${Math.round(flownMin)} minutes flown at ${perf.cruise.gph} gph, plus taxi and climb` },
          { label: `Home, ${fmt(backNm)} nm`, value: `${backMin} min`, note: `${homePlan.marginGal >= 0 ? `${homePlan.marginGal} gal over the 30 minute reserve` : `${-homePlan.marginGal} gal short of the reserve`}` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `${dest.id} is reporting. The highest ground on the rest of the route is ${fmt(hi.msl)} feet MSL, on the slope toward Pinecrest. Assume the base ahead sits where the ${dest.id} report puts it. How much room is left?`,
        figure: { kind: 'metar', raw: destMetar, marks: [cloud('BKN', destCeiling)] },
        blanks: [
          { id: 'base', label: 'Cloud base ahead', unit: 'ft MSL', answer: baseAhead, tolerance: 50,
            explain: `The report is above the field: ${fmt(destCeiling)} feet over ${dest.id}'s ${fmt(dest.elevationFt)} foot elevation is ${fmt(baseAhead)} MSL. The destination is legal VFR; the problem is between here and there.` },
          { id: 'gap', label: 'Room over the high ground', unit: 'ft', answer: sq.gapFt, tolerance: 50,
            explain: `${fmt(baseAhead)} minus ${fmt(hi.msl)} is ${fmt(sq.gapFt)} feet, against your ${fmt(mins.ceilingFt)} foot minimum. Flying 500 feet over the ground (91.119(c)) leaves you ${fmt(baseAhead - sq.lowestMsl)} feet under the clouds.` },
          { id: 'pitfall', label: 'Pushing on under it is called', answer: 'Scud running', choices: ['Scud running', 'Duck-under syndrome', 'Peer pressure', 'Mind set'],
            explain: 'Scud running is pushing on below the clouds to keep the ground in sight. Duck-under is the approach version: going below minimums to find the runway.' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Over Long Lake',
        situation: `${fmt(sq.gapFt)} feet of room ahead over rising ground, ${visAhead} miles in light rain. ${legal.replace(/\*\*/g, '')} Home is ${backMin} minutes behind you under a ${fmt(homeCeiling)} foot ceiling. Your friends just texted a photo of the table.`,
        figure: chart(['pinecrest']),
        options: [
          { id: 'press-on', label: `Press on low. It's only ${aheadMin} minutes${sq.legal ? ', and it is legal' : ''}.` },
          { id: 'climb-over', label: 'Climb through a gap and go over the top.' },
          { id: 'hold', label: 'Circle over the lake for half an hour and see if it lifts.' },
          { id: 'turn-back', label: 'Turn around now, and call your friends from the ground.' },
        ],
        grades,
        consequence: {
          'press-on': sq.withinPersonal
            ? 'You make it with room to spare.'
            : `Over Pinecrest the bases are lower than reported and the hills are higher than they looked. In rain you lose the horizon, then the ground. This is how VFR into IMC usually starts: not with a decision, but with the last of several small ones.`,
          'climb-over': 'Over a broken layer, with overcast above it at the destination, the gap you climbed through may not be there when you need to come down. Without an instrument rating, on top is a trap with a nice view.',
          hold: holdPlan.marginGal < 0
            ? 'Thirty minutes of circling leaves you short of the reserve on the way home, and the weather behind you is not promised either.'
            : 'You burn half an hour of fuel waiting for weather that is coming down, not going up. Holding only makes sense with a reason to expect better, and you have none.',
          'turn-back': `Home in ${backMin} minutes under a ${fmt(homeCeiling)} foot ceiling with ${homePlan.marginGal} gallons over the reserve. You miss lunch. Turning around is easiest right now, while there is room to turn, fuel to spare and good weather behind you.`,
        },
        why: `The destination report is legal VFR. The ${fmt(sq.gapFt)} feet over the high ground in between is under your ${fmt(mins.ceilingFt)} foot minimum, and the law allowing it is the reason your minimum exists. The miles already flown are not a reason to fly more. The best decision comes while the options are still all open.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 8.4

/** 8.4's evening: sunset, twilight, and the pilot's night landings in the logbook. */
export function nightScenario(now: Date) {
  const sunset = new Date(nextLocalHour(now, 17).getTime() + 35 * 60_000);
  const twilightEnd = new Date(sunset.getTime() + 29 * 60_000);
  const entry = (days: number, minAfterSunset: number, fullStop: boolean) => {
    const s = new Date(sunset.getTime() - days * 86_400_000);
    return { at: new Date(s.getTime() + minAfterSunset * 60_000), sunset: s, fullStop, days, minAfterSunset };
  };
  const log: (NightLanding & { days: number; minAfterSunset: number })[] = [
    entry(41, 40, true), entry(41, 75, false), entry(41, 90, true), entry(63, 70, true), entry(118, 80, true),
  ];
  // You're at the airport 50 minutes before sunset. The plan is an hour aloft starting half an hour after sunset.
  const atField = new Date(sunset.getTime() - 50 * 60_000);
  return { sunset, twilightEnd, log, atField, plannedOff: new Date(sunset.getTime() + 30 * 60_000), flightH: 1 };
}

type NightOption = 'go' | 'land-first' | 'early' | 'cancel';

/** Each option as a plan: when the passenger flight lands, and solo full-stop landings flown first. */
export function nightPlans(s: ReturnType<typeof nightScenario>): Record<NightOption, { landsAt: Date | null; soloFirst: number }> {
  const t = nightTimes(s.sunset, s.twilightEnd);
  return {
    go: { landsAt: addHours(s.plannedOff, s.flightH), soloFirst: 0 },
    // Three solo full stops after currency-night begins, then the flight.
    'land-first': { landsAt: addHours(t.currencyFrom, 0.75 + s.flightH), soloFirst: NIGHT_LANDINGS_REQUIRED },
    early: { landsAt: addHours(s.atField, 0.25 + s.flightH), soloFirst: 0 },
    cancel: { landsAt: null, soloFirst: 0 },
  };
}

export function nightGrades(s: ReturnType<typeof nightScenario>): Record<NightOption, Grade> {
  const plans = nightPlans(s);
  const out = {} as Record<NightOption, Grade>;
  for (const [id, p] of Object.entries(plans) as [NightOption, (typeof plans)[NightOption]][]) {
    if (!p.landsAt) { out[id] = 'acceptable'; continue; }
    const solo: NightLanding[] = Array.from({ length: p.soloFirst }, (_, i) => ({ at: addHours(nightTimes(s.sunset, s.twilightEnd).currencyFrom, 0.1 + i * 0.2), sunset: s.sunset, fullStop: true }));
    const cur = nightCurrency([...s.log, ...solo], p.landsAt);
    const legal = mayCarryPassengers(cur, p.landsAt, s.sunset);
    // Legal and freshly practiced beats legal by the clock.
    out[id] = !legal ? 'unsafe' : p.soloFirst > 0 ? 'best' : 'acceptable';
  }
  return out;
}

const night: Lesson = {
  id: '8.4', module: 8, minutes: 15,
  title: 'Night: what changes',
  summary: 'Three different nights in the regulations, night landings that count and ones that don\'t, and what a dark evening does to fuel, weather and your eyes.',
  acs: ['PA.XI.A', 'PA.I.A', 'PA.I.H'],
  refs: ['14 CFR 61.57(b), night takeoff and landing experience', '14 CFR 1.1, night', '14 CFR 91.209, aircraft lights', '14 CFR 91.151, fuel requirements', 'PHAK, night vision'],
  build(ctx) {
    const s = nightScenario(ctx.now);
    const t = nightTimes(s.sunset, s.twilightEnd);
    const cur = nightCurrency(s.log, addHours(s.plannedOff, s.flightH));
    const plans = nightPlans(s);
    const grades = nightGrades(s);
    const reserve = vfrReserveMin(true);
    const g = 1000;
    const gNight = vfrMinimums('G', g + 1000, g, true);
    const gDay = vfrMinimums('G', g + 1000, g, false);
    const clearance = (m: typeof gNight) => `${m.visibilitySm} SM, ${m.clouds ? `${m.clouds.belowFt} below clouds` : 'clear of clouds'}`;
    const why = (r: (typeof cur.reasons)[number]) =>
      r === 'counts' ? 'counts' : r === 'touch-and-go' ? 'does not count, not a full stop' : r === 'too-early' ? 'does not count, less than an hour after sunset' : 'too old, more than 90 days';

    return [
      {
        kind: 'brief', id: 'b1', title: 'Three nights',
        scene: `A clear evening at ${fieldName(ctx)}. Sunset is ${local(s.sunset)}. A friend wants to see the lights from the air, an hour aloft starting around ${local(s.plannedOff)}. You arrive at ${local(s.atField)}.`,
        say: {
          full: `The regulations have **three different nights**, and each one asks a different question. **Lights**: position lights from **sunset** to sunrise (91.209). **Logging**: night time you write in your logbook starts at the **end of evening civil twilight** (the definition in 1.1). **Passengers**: to carry anyone between **one hour after sunset** and one hour before sunrise, you need ${NIGHT_LANDINGS_REQUIRED} takeoffs and ${NIGHT_LANDINGS_REQUIRED} landings **to a full stop** in that same period within the last 90 days (61.57(b)).`,
          short: 'Lights at sunset, logging at end of twilight, passengers from an hour after sunset.',
        },
      },
      {
        kind: 'example', id: 'e1', title: 'Tonight, by the clock',
        say: {
          full: `Here is tonight laid out, and the other things that change after dark: a longer legal fuel reserve, wider cloud clearance in Class G, and eyes that take about half an hour to adapt and still miss things in the center of your vision.`,
          short: 'Tonight by the clock.',
        },
        work: [
          { label: 'Lights on', value: local(t.lightsFrom), note: 'Sunset' },
          { label: 'Night to log', value: local(t.loggingFrom), note: 'End of civil twilight, from the almanac for today' },
          { label: 'Passenger currency', value: local(t.currencyFrom), note: 'One hour after sunset' },
          { label: 'Fuel reserve', value: `${reserve} min`, note: `Instead of ${vfrReserveMin(false)} by day (91.151)` },
          { label: 'Class G, low', value: clearance(gNight), note: `At night under 1,200 ft AGL, instead of ${clearance(gDay)} by day` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Your logbook. ${[...new Set(s.log.map((l) => l.days))].map((d) => `${d} days ago: ${s.log.filter((l) => l.days === d).map((l) => `${l.fullStop ? 'a full stop' : 'a touch and go'} ${l.minAfterSunset} minutes after sunset`).join(', ')}.`).join(' ')} Tonight's flight lands after ${local(t.currencyFrom)}. How many count, how many more do you need, and what fuel reserve do you plan?`,
        blanks: [
          { id: 'count', label: 'Night landings that count', answer: cur.counted, tolerance: 0,
            explain: `${s.log.map((l, i) => `${l.days} days ago, ${l.fullStop ? 'full stop' : 'touch and go'} at ${l.minAfterSunset} minutes: ${why(cur.reasons[i])}`).join('. ')}.` },
          { id: 'need', label: 'More needed for a passenger', answer: cur.needed, tolerance: 0,
            explain: `${NIGHT_LANDINGS_REQUIRED} required, ${cur.counted} counted. Touch and goes and landings in the first hour after sunset build skill, but not this currency.` },
          { id: 'reserve', label: 'Night VFR fuel reserve', unit: 'min', answer: reserve, tolerance: 0,
            explain: `91.151: ${reserve} minutes at normal cruise at night, against ${vfrReserveMin(false)} by day.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Your friend is excited',
        situation: `${cur.current ? 'You are night current.' : `You are ${cur.needed} full-stop landing${cur.needed === 1 ? '' : 's'} short of carrying a passenger after ${local(t.currencyFrom)}.`} Your friend has been looking forward to this all week.`,
        options: [
          { id: 'go', label: `Go as planned, off at ${local(s.plannedOff)}. It's only one landing short.` },
          { id: 'land-first', label: `Fly ${plans['land-first'].soloFirst} full-stop landings alone after ${local(t.currencyFrom)}, then take your friend up.` },
          { id: 'early', label: `Leave now with your friend and land by ${local(plans.early.landsAt!)}.` },
          { id: 'cancel', label: 'Make it a daytime flight another weekend.' },
        ],
        grades,
        consequence: {
          go: grades.go === 'unsafe'
            ? `You land at ${local(plans.go.landsAt!)}, after ${local(t.currencyFrom)}, with a passenger and ${cur.counted} qualifying landings. That is not legal, and the rule is there so your first night landing in a while isn't flown with someone aboard.`
            : 'You are current, so this is legal.',
          'land-first': `Your friend watches from the ramp while you fly ${plans['land-first'].soloFirst} full-stop landings in the dark. Now you're current and your eyes and hands are tuned to night, and the passenger flight lands at ${local(plans['land-first'].landsAt!)}. The best of both.`,
          early: `Legal: you land at ${local(plans.early.landsAt!)}, before passenger currency kicks in at ${local(t.currencyFrom)}. Your friend sees the sunset rather than the city lights, and you still have to do something about the landings soon.`,
          cancel: 'Safe, and nothing wrong with it. But the problem is fixable tonight, in half an hour, with your friend on the ramp.',
        },
        why: `61.57(b) counts only full-stop landings flown an hour or more after sunset in the last 90 days. You have ${cur.counted}. Getting current first, with the passenger watching, turns a legal problem into practice.`,
      },
    ];
  },
};

export const humanFactorsLessons: Lesson[] = [minimumsUnderPressure, fitness, getThereItis, night];
