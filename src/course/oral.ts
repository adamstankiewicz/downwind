// Module 9, the oral and the flight review. Two mock orals the way an
// examiner runs them, one scenario that pulls in every area, then the record
// a pilot takes to a 61.56 review. The trip flies on the practice sectional;
// the airplane is the pilot's own when its numbers are in, the sample trainer
// otherwise, and every grade comes from oralChecks.ts or the calendar rules.

import { chartAirport, maxElevationFigure, practiceRegion } from '../chart/practiceRegion';
import { positionAt } from '../lib/airspace';
import { climbRate, takeoffDistance } from '../lib/perf';
import { navLog, trueCourse, vfrCruisingAltitudes, type NavPoint } from '../lib/nav';
import { parseTaf } from '../lib/taf';
import { FUEL_LB_PER_GAL } from '../lib/wb';
import { trueToMagnetic } from '../lib/wind';
import type { Grade } from '../scenarios/goNoGo';
import { addDays, calendarStatus, dateOnly, daysBetween, endOfCalendarMonth, flightReviewStatus, longDate, passengerCurrency } from './calendar';
import {
  gradeBags, gradeBulb, gradeInop, gradeLoading, gradeReturn, gradeReviewLapse, gradeRunway, INOP_FUEL_GAUGE, inopRequired, oralAirplane,
  rearForOverload, RUNWAY_MARGIN, weighTrip, type InopItem, type InopOption, type LoadOption, type ReturnOption, type TripLoad,
} from './oralChecks';
import { addHours, cloud, wholeHourAfter, windGroup, zDayHour, zTime } from './practice';
import type { Lesson, LessonContext, OptionId, Step } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const gal = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const pad3 = (n: number) => String(Math.round(n)).padStart(3, '0');
const local = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hhmmZ = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Copy is written for the grade the lesson sets up. When the pilot's own
 * airplane or minimums move a grade, the written line is swapped for one that
 * follows the code's grade, so the story never contradicts the chip.
 */
function follow<T extends OptionId>(grades: Record<T, Grade>, intended: Partial<Record<T, Grade>>, written: Record<T, string>, why: (id: T) => string): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const id of Object.keys(written) as T[]) {
    out[id] = !intended[id] || grades[id] === intended[id] ? written[id] : `With your numbers this one grades differently. ${why(id)}`;
  }
  return out;
}

function sampleNote(ctx: LessonContext, sample: boolean, standIn: boolean): string {
  if (standIn) return ' Your airplane\'s loading numbers aren\'t filled in, so this uses the sample trainer: sample numbers for teaching, not any real airplane.';
  return sample ? ` These are the sample numbers in your ${ctx.aircraft.type || 'airplane'} profile, not your POH. Replace them before trusting a result.` : '';
}

// ---------------------------------------------------------------- 9.1

const TRIP_IDS = ['KXYZ', 'harlow', 'long-lake', 'pinecrest', 'KXQA'];
const WIND_ALOFT = { fromTrue: 300, kt: 20 };

function tripPoints(): NavPoint[] {
  return TRIP_IDS.map((id) => {
    const a = practiceRegion.airports.find((x) => x.id === id);
    const c = practiceRegion.checkpoints.find((x) => x.id === id);
    const e = (a ?? c)!;
    return { id, name: e.name, ...e.pos };
  });
}

/** The trip's numbers, shared by the turns and the decisions so they never disagree. */
export function weekendTrip(ctx: LessonContext) {
  const plane = oralAirplane(ctx.aircraft);
  const p = plane.performance;
  const home = chartAirport('KXYZ')!;
  const dest = chartAirport('KXQA')!;
  const pts = tripPoints();

  // Cruise: the lowest altitude that suits the course and clears the highest figure on the way by 1,000 ft.
  const lats = pts.map((x) => x.lat);
  const lons = pts.map((x) => x.lon);
  const mef = maxElevationFigure(practiceRegion, { lat: Math.min(...lats) - 0.1, lon: Math.min(...lons) - 0.1 }, { lat: Math.max(...lats) + 0.1, lon: Math.max(...lons) + 0.1 });
  const magCourse = Math.round(trueToMagnetic(trueCourse(pts[0], pts[pts.length - 1]), practiceRegion.variationDeg));
  const legal = vfrCruisingAltitudes(magCourse, 0, 17500);
  const cruiseMsl = legal.find((a) => a >= mef + 1000)!;

  const log = navLog(pts, { tasKt: p.cruise.tasKt, windFromTrue: WIND_ALOFT.fromTrue, windKt: WIND_ALOFT.kt, variationDeg: practiceRegion.variationDeg, gph: p.cruise.gph });
  const climbFpm = climbRate(p, home.elevationFt, 20).value;
  const climbMin = Math.ceil((cruiseMsl - home.elevationFt) / Math.max(climbFpm, 100));
  const trip = { climbMin, cruiseMin: log.totalMin, night: false };

  // Passengers: the pilot at 170 lb, a friend up front, two more in the back, and camping gear.
  // With a placarded baggage limit the gear comes to 30 lb over it, and trimming it to the
  // placard puts the airplane just under gross. Without one, 40 lb of bags and a weight problem.
  const frontLb = 170 + 190;
  const a = plane.aircraft;
  const bagStation = a.stations.some((s) => s.id === 'bag1' && s.armIn > 0) ? 'bag1' : 'rear';
  const bagLimit = bagStation === 'bag1' ? a.stations.find((s) => s.id === 'bag1')?.maxLb ?? null : null;
  const bagsLb = bagLimit !== null ? bagLimit + 30 : 40;
  const rearLb = bagLimit !== null ? rearForOverload(a, frontLb, bagLimit, -20) : rearForOverload(a, frontLb, bagsLb, 70);
  const load: TripLoad = { frontLb, rearLb, bagsLb, bagStation };
  const full = weighTrip(a, load, a.usableFuelGal);
  const loading = gradeLoading(plane, load, trip);
  const fit = loading.cases.find((c) => c.id === 'fuel-to-fit')!;
  const bags = bagLimit !== null ? { limitLb: bagLimit, ...gradeBags(plane, load, bagLimit, trip) } : null;

  const destPos = positionAt(practiceRegion.airspace, dest.pos, dest.tpaMsl, dest.elevationFt, practiceRegion.veils);
  return { plane, home, dest, pts, mef, magCourse, legal, cruiseMsl, log, climbFpm, climbMin, trip, load, full, loading, fit, bags, destCls: destPos.cls };
}

/** 9.1 d1 with a placarded baggage area: two limits, and only one of them trades with fuel. */
function bagDecision(t: ReturnType<typeof weekendTrip>, note: string): Step {
  const { plane, dest, load, full, fit } = t;
  const bags = t.bags!;
  const a = plane.aircraft;
  const extra = load.bagsLb - bags.limitLb;
  const lessFuel = bags.cases.find((c) => c.id === 'less-fuel')!;
  const trim = bags.cases.find((c) => c.id === 'trim-bags')!;
  const over = full.totalLb - a.maxGrossLb;
  return {
    kind: 'decide', id: 'd1', title: 'The camping gear',
    situation: `${fmt(load.bagsLb)} lb of gear against a baggage placard of ${bags.limitLb} lb, and ${fmt(full.totalLb)} lb with full tanks against a ${fmt(a.maxGrossLb)} lb maximum. The trip needs ${gal(fit.fuel.requiredGal)} gallons with the reserve, and ${dest.name} sells fuel.`,
    options: [
      { id: 'all-in', label: over > 0 ? `Load it all with full tanks. ${fmt(over)} pounds over is nothing.` : 'Load it all with full tanks. You are under gross.' },
      { id: 'less-fuel', label: `Load it all and take ${gal(lessFuel.fuelGal)} gallons, so the total is under gross.` },
      { id: 'trim-bags', label: `Leave ${extra} lb of gear behind and keep full tanks.` },
      { id: 'cancel', label: 'Call the trip off. The airplane can\'t carry it.' },
    ],
    grades: bags.grades,
    consequence: follow(bags.grades, { 'all-in': 'unsafe', 'less-fuel': 'unsafe', 'trim-bags': 'best', cancel: 'acceptable' }, {
      'all-in': `Two limits broken at once. The baggage floor and its tie-downs are rated for ${bags.limitLb} lb, and a bump that loads them at 2 g asks them to hold twice the gear. The examiner stops you here.`,
      'less-fuel': `Under gross now, at ${fmt(lessFuel.wb.totalLb)} lb, but the baggage area still holds ${fmt(load.bagsLb)} lb against a ${bags.limitLb} lb placard. Fuel trades against gross weight, never against a compartment limit.`,
      'trim-bags': `${fmt(trim.wb.totalLb)} lb at a CG of ${trim.wb.cgIn} in, the gear at its placard, and full tanks leave ${gal(trim.fuel.marginGal)} gallons over the reserve. The tent stays in the car. Next time, ask everyone to weigh their bags at home and pack soft bags.`,
      cancel: 'Safe, but leaving one bag behind made the trip work. Knowing which limit you are up against is the skill this question is after.',
    }, (id) => (id === 'cancel'
      ? (bags.grades.cancel === 'best' ? 'No loading in the options is legal, so staying home is the call.' : 'One of the loadings is legal with fuel to spare, so the trip can still go.')
      : `That loading grades ${bags.grades[id]} against gross weight, the envelope, the baggage placard and the fuel reserve.`)),
    why: `Maximum gross weight and the baggage compartment limit are separate limits in the POH, and 91.9 makes both law. Fuel is the load you trade against gross weight; only the gear itself fixes the compartment. Trimming ${extra} lb fixes both and keeps full tanks.${note}`,
  };
}

const weekendOral: Lesson = {
  id: '9.1', module: 9, minutes: 30,
  title: 'Mock oral: a weekend trip',
  summary: 'An examiner hands you a weekend trip with three friends and asks you to plan it out loud: currency, route, fuel, airspace, loading and the weather home.',
  acs: ['PA.I.A', 'PA.I.C', 'PA.I.D', 'PA.I.E', 'PA.I.F'],
  refs: ['14 CFR 61.57(a)', '14 CFR 91.103, preflight action', '14 CFR 91.151', '14 CFR 91.159', '14 CFR 91.9', 'PHAK ch. 10', 'Aviation Weather Handbook (FAA-H-8083-28), TAF'],
  build(ctx) {
    const t = weekendTrip(ctx);
    const { plane, home, dest, log, load, full, loading, fit, bags } = t;
    const a = plane.aircraft;
    const p = plane.performance;
    const note = sampleNote(ctx, plane.sample, plane.standIn);
    const legs = log.legs;

    // Currency: the trip is three days out. Two laps a couple of months ago, one landing before that.
    const tripDay = addDays(dateOnly(ctx.now), 3);
    const landings = [addDays(tripDay, -93), addDays(tripDay, -61), addDays(tripDay, -61)];
    const cur = passengerCurrency(landings, tripDay);
    const lost = landings.filter((l) => l.getTime() < cur.windowStart.getTime());

    // Altitude choices: one too low for the terrain, the right one, one for the other direction.
    const i = t.legal.indexOf(t.cruiseMsl);
    const altChoices = [i > 0 ? t.legal[i - 1] : null, t.cruiseMsl, t.cruiseMsl + 1000].filter((x): x is number => x !== null).map(fmt);

    // Day two: the trip home and a forecast that turns.
    const early = wholeHourAfter(ctx.now, 1);
    const late = addHours(early, 4.5);
    const hours = (log.totalMin + t.climbMin) / 60;
    const fm1 = addHours(early, 2.5);
    const fm2 = addHours(early, 4);
    const validFrom = wholeHourAfter(addHours(ctx.now, -1), 0);
    const rawTaf = [
      'TAF', home.id, zTime(addHours(validFrom, -0.67)), `${zDayHour(validFrom)}/${zDayHour(addHours(validFrom, 24))}`,
      windGroup({ dirTrue: 220, speedKt: 8 }), 'P6SM', cloud('SCT', 5000),
      `FM${zDayHour(fm1)}00`, windGroup({ dirTrue: 180, speedKt: 10 }), '5SM', '-RA', cloud('BKN', 2500),
      `FM${zDayHour(fm2)}00`, windGroup({ dirTrue: 160, speedKt: 9 }), '3SM', '-RA', 'BR', cloud('OVC', 800),
    ].join(' ');
    const taf = parseTaf(rawTaf);
    const ret = gradeReturn(taf, early, late, hours, ctx.minimums);

    const loadWhy = (id: LoadOption) => {
      const c = loading.cases.find((x) => x.id === id);
      if (!c) return loading.grades.cancel === 'best' ? 'No loading in the options is legal, so staying home is the call.' : 'One of the loadings is legal with fuel to spare, so the trip can still go.';
      if (c.wb.overGross) return `That loading weighs ${fmt(c.wb.totalLb)} lb against ${fmt(a.maxGrossLb)}.`;
      if (!c.wb.withinEnvelope) return `The CG lands at ${c.wb.cgIn} in, outside the envelope.`;
      if (c.fuel.marginGal < 0) return `${gal(c.fuelGal)} gallons doesn't cover the trip and the legal reserve.`;
      return `${fmt(c.wb.totalLb)} lb, CG ${c.wb.cgIn} in, and ${gal(c.fuel.marginGal)} gallons over the legal reserve at the far end.`;
    };
    const retWhy = (id: ReturnOption) => `The forecast for that flight grades ${ret[id]}.`;

    const steps: Step[] = [
      {
        kind: 'brief', id: 'b1', title: 'The examiner sets the scene',
        scene: `"Let's plan a trip. You and three friends, ${home.name} to ${dest.name}, ${fmt(log.totalNm)} miles west on the practice sectional. Out Saturday, home Sunday. Talk me through it."`,
        say: {
          full: 'A scenario oral is a conversation, not a quiz. The examiner wants to hear you **reason from the rule to the decision**: what the regulation says, what your numbers say, and what you will do about it. When you don\'t know something, say where you would look it up. That is an acceptable answer; guessing is not. We will take it in the order a real plan goes: you, the route, the airplane, then the weather.',
          short: 'Reason from the rule to the decision. Say where you would look it up.',
        },
        figure: { kind: 'chart', route: TRIP_IDS, highlight: ['xqa-e', 'xyz-d'] },
      },
      {
        kind: 'turn', id: 't1', title: 'Are you current?',
        prompt: `"First, you. Your last landings were on ${shortDate(landings[0])}, and two on ${shortDate(landings[1])}. The trip is ${shortDate(tripDay)}. Can you take passengers?"`,
        blanks: [
          { id: 'count', label: 'Takeoffs and landings in the 90 days before the trip', answer: cur.inWindow, tolerance: 0,
            explain: `The 90 days run back to ${shortDate(cur.windowStart)}.${lost.length ? ` The landing on ${shortDate(lost[0])} fell outside them.` : ''}` },
          { id: 'current', label: 'Current to carry passengers?', answer: cur.current ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: `61.57(a) needs three takeoffs and landings in the same category and class in the preceding 90 days.${cur.current ? '' : ` You have ${cur.inWindow}. Fly ${3 - cur.inWindow} more before Saturday, solo or with an instructor, and you're legal.`}` },
        ],
      },
      {
        kind: 'example', id: 'e1', title: 'The first leg, worked',
        say: {
          full: `"Now the route." Winds aloft are from ${pad3(WIND_ALOFT.fromTrue)} true at ${WIND_ALOFT.kt} knots, and the airplane trues out at ${p.cruise.tasKt} knots burning ${p.cruise.gph} gallons an hour. Measure the course **true**, correct for wind to get a true heading, then apply the variation (here ${Math.abs(practiceRegion.variationDeg)}° west, so add it) to get the heading you fly. Here is the first leg to ${legs[0].to.name}.${note}`,
          short: 'True course, wind correction, then variation.',
        },
        figure: { kind: 'navlog', log, altitudeMsl: t.cruiseMsl },
        work: [
          { label: 'True course', value: `${pad3(legs[0].trueCourse)}°`, note: `${home.id} to ${legs[0].to.name}` },
          { label: 'Wind correction', value: `${legs[0].wcaDeg > 0 ? '+' : ''}${legs[0].wcaDeg}°`, note: `Wind from ${pad3(WIND_ALOFT.fromTrue)} pushes you ${legs[0].wcaDeg < 0 ? 'right, so turn left into it' : 'left, so turn right into it'}` },
          { label: 'Magnetic heading', value: `${pad3(legs[0].magHeading)}°`, note: `True heading ${pad3(legs[0].trueHeading)} plus ${Math.abs(practiceRegion.variationDeg)} west` },
          { label: 'Groundspeed', value: `${legs[0].groundspeedKt} kt`, note: `${legs[0].distanceNm} nm in ${legs[0].minutes} minutes` },
        ],
      },
      {
        kind: 'turn', id: 't2', title: 'The rest of the route',
        prompt: '"Finish the log for me. How far, how long, and how much fuel does the law say you need?"',
        figure: { kind: 'navlog', log, altitudeMsl: t.cruiseMsl },
        blanks: [
          { id: 'nm', label: 'Total distance', unit: 'nm', answer: log.totalNm, tolerance: 1, explain: `${legs.map((l) => l.distanceNm).join(' + ')} = ${log.totalNm} nm.` },
          { id: 'min', label: 'Time en route, cruise', unit: 'min', answer: log.totalMin, tolerance: 2, explain: `The legs add up to ${log.totalMin} minutes at the groundspeeds on the log.` },
          { id: 'fuel', label: 'Fuel required, with the day VFR reserve', unit: 'gal', answer: fit.fuel.requiredGal, tolerance: 0.6,
            explain: `Taxi ${gal(fit.fuel.taxiGal)}, climb ${gal(fit.fuel.climbGal)} (${t.climbMin} minutes), cruise ${gal(fit.fuel.cruiseGal)}, and 30 minutes of reserve at cruise, ${gal(fit.fuel.reserveGal)}: ${gal(fit.fuel.requiredGal)} gallons. 91.151 sets the 30 minutes by day; it is a floor, not a plan.` },
        ],
      },
      {
        kind: 'turn', id: 't3', title: 'Altitude and airspace',
        prompt: `"The highest figure along the route is ${fmt(t.mef)}. What do you cruise at, and what airspace are you in on the downwind at ${dest.name}?"`,
        figure: { kind: 'chart', route: TRIP_IDS, highlight: ['xqa-e'], focus: { id: 'KXQA', radiusNm: 12 } },
        blanks: [
          { id: 'alt', label: 'Cruising altitude, ft MSL', answer: fmt(t.cruiseMsl), choices: altChoices,
            explain: `The magnetic course is about ${pad3(t.magCourse)}°, westbound, so above 3,000 AGL you fly even thousands plus 500 (91.159). ${fmt(t.cruiseMsl)} is the lowest of those that clears ${fmt(t.mef)} by 1,000 feet.` },
          { id: 'cls', label: `Airspace at ${fmt(dest.tpaMsl)} MSL over ${dest.id}`, answer: t.destCls, choices: ['B', 'C', 'D', 'E', 'G'],
            explain: `The dashed magenta circle is Class E from 700 feet AGL. Pattern altitude, ${fmt(dest.tpaMsl - dest.elevationFt)} above the field, is inside it; below 700 it is Class G. No tower: you self-announce on CTAF ${dest.freq}.` },
        ],
      },
      {
        kind: 'turn', id: 't4', title: 'Weigh it',
        prompt: bags
          ? `"Loading. You're 170 for today, your friend up front is 190, the two in back come to ${fmt(load.rearLb)}. Everyone brought camping gear: you put it on the ramp scale and it comes to ${load.bagsLb} pounds. Full tanks, ${a.usableFuelGal} gallons. Where does that put you?"`
          : `"Loading. You're 170 for today, your friend up front is 190, the two in back come to ${fmt(load.rearLb)}, and there are ${load.bagsLb} pounds of bags. Full tanks, ${a.usableFuelGal} gallons. Where does that put you?"`,
        blanks: [
          { id: 'total', label: 'Takeoff weight, full tanks', unit: 'lb', answer: full.totalLb, tolerance: 5,
            explain: `Empty ${fmt(a.emptyWeightLb)} + people ${fmt(load.frontLb + load.rearLb)} + bags ${load.bagsLb} + fuel ${fmt(a.usableFuelGal * FUEL_LB_PER_GAL)} (${a.usableFuelGal} gallons at 6 lb) = ${fmt(full.totalLb)} lb.${note}` },
          { id: 'over', label: 'Over maximum gross by', unit: 'lb', answer: Math.max(0, full.totalLb - a.maxGrossLb), tolerance: 5,
            explain: `Maximum gross is ${fmt(a.maxGrossLb)} lb. ${full.overGross ? `You're ${fmt(full.totalLb - a.maxGrossLb)} over. 91.9 makes the POH limit the law, and the airplane climbs and stalls like it knows.` : 'You are under it, so the question is the CG.'}` },
          ...(bags ? [{ id: 'bagover', label: 'Over the baggage area placard by', unit: 'lb', answer: load.bagsLb - bags.limitLb, tolerance: 0,
            explain: `The placard on the baggage door says ${bags.limitLb} lb, and the POH weight and balance section says the same. ${load.bagsLb} − ${bags.limitLb} = ${load.bagsLb - bags.limitLb} lb too much, whatever the airplane weighs in total.` }] : []),
        ],
      },
      bags ? bagDecision(t, note) : {
        kind: 'decide', id: 'd1', title: 'Make it fit',
        situation: `${fmt(full.totalLb)} lb with full tanks against a ${fmt(a.maxGrossLb)} lb maximum. The trip needs ${gal(fit.fuel.requiredGal)} gallons with the reserve, and ${dest.name} sells fuel.`,
        options: [
          { id: 'full-tanks', label: 'Go with full tanks. A few pounds over is inside the safety factor.' },
          { id: 'leave-bags', label: 'Leave the bags behind and keep full tanks.' },
          { id: 'fuel-to-fit', label: `Take off with ${gal(fit.fuelGal)} gallons, the most that fits, and fill up at ${dest.name}.` },
          { id: 'cancel', label: 'Call the trip off. The airplane can\'t carry everyone.' },
        ],
        grades: loading.grades,
        consequence: follow(loading.grades, { 'full-tanks': 'unsafe', 'leave-bags': 'unsafe', 'fuel-to-fit': 'best', cancel: 'acceptable' }, {
          'full-tanks': 'There is no safety factor you get to spend. Over gross the airplane needs more runway, climbs worse and stalls faster, and the certification testing never covered it. The examiner stops you here.',
          'leave-bags': loading.cases[1].wb.overGross
            ? `Better, but still ${fmt(loading.cases[1].wb.totalLb - a.maxGrossLb)} lb over. Bags are the easy thing to drop and not enough on their own.`
            : `Under gross now, but the CG lands at ${loading.cases[1].wb.cgIn} in, outside the envelope.`,
          'fuel-to-fit': `${fmt(fit.wb.totalLb)} lb at a CG of ${fit.wb.cgIn} in, inside the envelope, and you land with ${gal(fit.fuel.marginGal)} gallons over the legal reserve. You top off at ${dest.name} for the trip home, when two of you weigh the same and the fuel is the variable.`,
          cancel: 'Safe, and nobody would fault you, but trading fuel for people solved it. Knowing how far you can trade is the skill this question is after.',
        }, loadWhy),
        why: `Gross weight and the CG envelope are limits (91.9), and the legal reserve is a floor (91.151). Fuel is the load you can trade: ${gal(fit.fuelGal)} gallons fits, covers the trip with ${gal(fit.fuel.marginGal)} to spare over the reserve, and a fuel stop fixes the rest.${note}`,
      },
      {
        kind: 'brief', id: 'b2', title: 'Sunday afternoon',
        scene: `"It's Sunday, ${local(early)}. Everyone wants to stay for dinner and leave at ${local(late)}. One of your friends has to be at work at seven tomorrow. Here's the forecast for home."`,
        say: {
          full: `Lay the forecast against **your** flight, departure to landing, both ways you might fly it. The trip home is about ${Math.round(hours * 60)} minutes. Then notice the pressure in the scene: a dinner, a job, three people waiting on you. That is the hazardous part, not the rain. Your minimums are a ${fmt(ctx.minimums.ceilingFt)} foot ceiling and ${ctx.minimums.visibilitySm} miles.`,
          short: 'Your flight against the forecast, both departures. Name the pressure.',
        },
        figure: { kind: 'taf', raw: rawTaf, departure: late, returnAt: addHours(late, hours) },
      },
      {
        kind: 'decide', id: 'd2', title: 'When do you leave?',
        situation: `The TAF goes to ${cloud('BKN', 2500)} in rain at ${hhmmZ(fm1)} and ${cloud('OVC', 800)}, 3 miles at ${hhmmZ(fm2)}. Leave now and you're home by ${hhmmZ(addHours(early, hours))}. Leave after dinner and you take off at ${hhmmZ(late)}.`,
        figure: { kind: 'taf', raw: rawTaf, departure: early, returnAt: addHours(early, hours) },
        options: [
          { id: 'leave-now', label: 'Leave now, ahead of the rain. Dinner another time.' },
          { id: 'leave-late', label: `Stay for dinner and leave at ${local(late)} as planned.` },
          { id: 'under-it', label: 'Stay for dinner. If it\'s low, fly home under it at a thousand feet.' },
          { id: 'stay', label: 'Stay the night and fly home in the morning.' },
        ],
        grades: ret,
        consequence: follow(ret, { 'leave-now': 'best', 'leave-late': 'unsafe', 'under-it': 'unsafe', stay: 'acceptable' }, {
          'leave-now': `You're on the ground at home before ${hhmmZ(fm1)}, with the whole flight inside the opening forecast and an hour to spare. The dinner was the price, and it was cheap.`,
          'leave-late': `At ${hhmmZ(late)} home is forecast ${cloud('OVC', 800)} in rain and mist: below the 1,000 and 3 you need in the surface area, before you've even started. The plan got made at dinner.`,
          'under-it': 'Scud running is how VFR pilots fly into the ground. Under an 800 foot overcast in rain, the towers on the chart are taller than the space you have.',
          stay: 'Safe, and the examiner will accept it. Your friend calls in late. But the forecast gave you a clean window right now, and seeing it is the point.',
        }, retWhy),
        why: `Read the forecast against each departure you might make, not against the one you want. Leaving now keeps the whole flight inside the opening forecast; leaving after dinner puts it below basic VFR (91.155). The friend's job and the dinner are external pressure; name them out loud and they lose their grip.`,
      },
    ];
    return steps;
  },
};

// ---------------------------------------------------------------- 9.2

/** The inspection dates in 9.2, set from today so one has always just lapsed. */
export function inspectionDates(now: Date) {
  const today = dateOnly(now);
  const monthsAgo = (m: number, day: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, day));
  const annual = monthsAgo(10, 14);
  const elt = monthsAgo(13, 20);
  const xpdr = monthsAgo(20, 5);
  return {
    today,
    annual, annualStatus: calendarStatus(annual, 12, today),
    elt, eltStatus: calendarStatus(elt, 12, today),
    xpdr, xpdrStatus: calendarStatus(xpdr, 24, today),
  };
}

function inopDecision(id: string, title: string, item: InopItem, situation: string, night: boolean, written: Record<InopOption, string>, intended: Partial<Record<InopOption, Grade>>): Step {
  const grades = gradeInop(item, night);
  const rule = inopRequired(item, night);
  return {
    kind: 'decide', id, title, situation,
    options: [
      { id: 'fly-as-is', label: 'Fly as it is. You can manage without it.' },
      { id: 'placard-fly', label: 'Placard it "INOPERATIVE", note it, and fly.' },
      { id: 'fix-first', label: 'Get it fixed, or a special flight permit, before the airplane goes anywhere.' },
      { id: 'cancel', label: 'Cancel and think about it.' },
    ],
    grades,
    consequence: follow(grades, intended, written, () => (rule ? `It is required by ${rule}, so it has to work.` : 'Nothing requires it for this flight, so 91.213(d) lets you placard it and go.')),
    why: rule
      ? `Without an MEL, 91.213(d) lets you fly with inoperative equipment only if nothing requires it. The ${item.name} is required by ${rule}. Fix it, or ask the FSDO for a special flight permit to ferry it to the shop.`
      : `Without an MEL, 91.213(d) asks four questions: is it required by the type certificate or equipment list, by 91.205 for this kind of flight, or by an AD? If none, deactivate or remove it, placard it "Inoperative", and you may fly. The ${item.name} passes all four for a day flight not for hire.`,
  };
}

/** Wet short grass against dry, from the UK CAA's SafetySense leaflet 9 (x1.3 against x1.2 on paved): about 10 percent more. */
export const WET_GRASS_FACTOR = 1.1;
/** A 2 percent upslope, same source: about 10 percent more. Downslope gets no credit. */
export const UPSLOPE_FACTOR = 1.1;

/**
 * The morning after at a short grass strip: wet grass, runway 27 rising 2
 * percent, wind straight down the slope. Two aboard, so the book number at
 * maximum gross comes down with the square of the weight (PHAK ch. 11).
 */
export function grassStrip(ctx: LessonContext) {
  const plane = oralAirplane(ctx.aircraft);
  const a = plane.aircraft;
  const strip = chartAirport('2X5')!;
  const altimeter = 30.02;
  const morning = 8;
  const noon = 22;
  const windKt = 8;
  const bagStation = a.stations.some((x) => x.id === 'bag1' && x.armIn > 0) ? 'bag1' : 'rear';
  const weightLb = weighTrip(a, { frontLb: 170 + 190, rearLb: 0, bagsLb: 20, bagStation }, a.usableFuelGal).totalLb;
  const weightFactor = Math.min(1, (weightLb / a.maxGrossLb) ** 2);
  const at = (oatC: number, headwindKt: number) =>
    takeoffDistance(plane.performance, { fieldElevFt: strip.elevationFt, altimeterInHg: altimeter, oatC, headwindKt, surface: 'grass' });
  const r5 = (x: number) => Math.round(x / 5) * 5;
  const up = at(morning, windKt);
  const down = at(morning, -windKt);
  const dry = at(noon, windKt);
  const upFt = r5(up.over50Ft * WET_GRASS_FACTOR * UPSLOPE_FACTOR * weightFactor);
  const downFt = r5(down.over50Ft * WET_GRASS_FACTOR * weightFactor);
  const dryFt = r5(dry.over50Ft * UPSLOPE_FACTOR * weightFactor);
  const grades: Record<'up-wind' | 'down-slope' | 'wait-dry' | 'leave-it', Grade> = {
    'up-wind': gradeRunway(upFt, strip.runwayFt),
    'down-slope': gradeRunway(downFt, strip.runwayFt),
    'wait-dry': gradeRunway(dryFt, strip.runwayFt),
    'leave-it': 'acceptable',
  };
  if (!Object.values(grades).includes('best')) grades['leave-it'] = 'best';
  return { plane, strip, altimeter, morning, noon, windKt, weightLb, weightFactor, up, down, dry, upFt, downFt, dryFt, grades };
}

const airplaneOral: Lesson = {
  id: '9.2', module: 9, minutes: 25,
  title: 'Mock oral: the airplane',
  summary: 'The examiner walks around your airplane: the documents, the inspections, a burnt-out bulb you may fix yourself, a gauge you may not, and which way to leave a wet, sloping grass strip.',
  acs: ['PA.I.B', 'PA.I.F', 'PA.I.G'],
  refs: ['14 CFR 91.203', '14 CFR 91.409', '14 CFR 91.207', '14 CFR 91.413', '14 CFR 43.3(g)', '14 CFR 43 appendix A', '14 CFR 43.9', '14 CFR 91.213', '14 CFR 91.205', 'PHAK ch. 11', 'UK CAA SafetySense 9, weight, balance and performance'],
  build(ctx) {
    const d = inspectionDates(ctx.now);
    const s = grassStrip(ctx);
    const bulb = gradeBulb({ pilotOwns: true, forHire: false });
    const note = sampleNote(ctx, s.plane.sample, s.plane.standIn);
    const eltWrong = [d.eltStatus.dueEnd, new Date(Date.UTC(d.elt.getUTCFullYear() + 1, d.elt.getUTCMonth(), d.elt.getUTCDate())), endOfCalendarMonth(d.elt, 13)];
    const xpdrWrong = [d.xpdrStatus.dueEnd, endOfCalendarMonth(d.xpdr, 12), new Date(Date.UTC(d.xpdr.getUTCFullYear() + 2, d.xpdr.getUTCMonth(), d.xpdr.getUTCDate()))];
    const sorted = (ds: Date[]) => [...new Set(ds.map((x) => x.getTime()))].sort((x, y) => x - y).map((x) => longDate(new Date(x)));

    return [
      {
        kind: 'brief', id: 'b1', title: 'At the airplane',
        scene: `"Show me this airplane is airworthy." The examiner is standing by the door with a coffee.`,
        say: {
          full: 'Two lists carry this whole conversation. The documents on board, **ARROW**: airworthiness certificate, registration, radio station license if you fly abroad, operating limitations (the POH and placards), and weight and balance (91.203, 91.9). The inspections, **AV1ATE**: ADs, VOR check for IFR, 100-hour if it is used for hire, annual, transponder every 24 calendar months, ELT every 12. **Calendar months** run to the end of the month, so a date in the logbook is good longer than it looks.',
          short: 'ARROW on board, AV1ATE in the logbooks. Calendar months end at month end.',
        },
      },
      {
        kind: 'example', id: 'e1', title: 'The annual, worked',
        say: {
          full: `The last annual was signed off on ${longDate(d.annual)}. 91.409 wants one in the preceding 12 calendar months, so count 12 months from the month it was done and go to the **last day** of that month.`,
          short: 'Twelve calendar months, to the end of the month.',
        },
        work: [
          { label: 'Signed off', value: longDate(d.annual) },
          { label: '12 calendar months', value: `End of ${d.annualStatus.dueEnd.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}` },
          { label: 'Good through', value: longDate(d.annualStatus.dueEnd) },
          { label: 'Today', value: longDate(d.today), note: d.annualStatus.current ? `${d.annualStatus.daysLeft} days left` : 'Lapsed' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn: the logbooks',
        prompt: `The ELT was inspected on ${longDate(d.elt)}. The transponder was checked on ${longDate(d.xpdr)}. Today is ${longDate(d.today)}.`,
        blanks: [
          { id: 'elt', label: 'ELT inspection good through', answer: longDate(d.eltStatus.dueEnd), choices: sorted(eltWrong),
            explain: `91.207(d): within 12 calendar months, so through ${longDate(d.eltStatus.dueEnd)}.` },
          { id: 'eltok', label: 'ELT current today?', answer: d.eltStatus.current ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: d.eltStatus.current ? 'Still inside the 12 months.' : `It lapsed ${-d.eltStatus.daysLeft} days ago. The airplane isn't legal to fly until it is inspected, except to ferry it to where it can be (91.207(b)).` },
          { id: 'xpdr', label: 'Transponder check good through', answer: longDate(d.xpdrStatus.dueEnd), choices: sorted(xpdrWrong),
            explain: `91.413: within 24 calendar months, so through ${longDate(d.xpdrStatus.dueEnd)}.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'The landing light',
        situation: 'The ELT is sorted. On the walkaround the landing light doesn\'t come on: the bulb is burnt out. It is your airplane, today\'s flight is not for hire, and there is a spare bulb with the right part number in the hangar.',
        options: [
          { id: 'swap-fly', label: 'Swap the bulb yourself and go.' },
          { id: 'swap-log', label: 'Swap the bulb yourself, then write it up in the maintenance records and sign it.' },
          { id: 'placard-fly', label: 'Placard it "INOPERATIVE" and fly. Swap it another day.' },
          { id: 'wait-mechanic', label: 'Leave it for a mechanic. Pilots don\'t work on airplanes.' },
        ],
        grades: bulb,
        consequence: follow(bulb, { 'swap-fly': 'marginal', 'swap-log': 'best', 'placard-fly': 'acceptable', 'wait-mechanic': 'acceptable' }, {
          'swap-fly': 'The swap was yours to do, but preventive maintenance isn\'t finished until it is in the records (43.9). Without the entry, the next person to read the logbook can\'t know what was done or by whom.',
          'swap-log': 'Right. Replacing landing light bulbs is on the preventive maintenance list in part 43 appendix A, and 43.3(g) lets a certificated pilot do it on an airplane they own or operate, not for hire. The entry gets what you did, the date, your signature, and your certificate number and kind.',
          'placard-fly': 'Legal for a day flight not for hire: 91.213(d) lets you placard it and go. But the fix was ten minutes and yours to make.',
          'wait-mechanic': 'Nothing wrong with it, but the rules let you do this one. Owners who know appendix A save days of downtime.',
        }, (id) => `That choice grades ${bulb[id]} under 43.3(g) and 91.213(d).`),
        why: 'Part 43 appendix A lists the preventive maintenance a pilot may do: oil changes, tire servicing, bulbs, and a few dozen more simple jobs with no complex assembly. 43.3(g) allows it on an airplane you own or operate, not used under part 121, 129 or 135, and 43.9 requires the record entry. Anything not on the list goes to a mechanic.',
      },
      inopDecision('d2', 'The fuel gauge', INOP_FUEL_GAUGE,
        'The left fuel gauge reads empty. You dip the tank and it is full. "You know how much fuel you have. Can we go?"',
        false,
        {
          'fly-as-is': 'Knowing the fuel at start doesn\'t make the gauge optional. 91.205(b)(9) requires a gauge for each tank on every flight.',
          'placard-fly': 'A placard doesn\'t help here. 91.213(d) only covers equipment nothing requires, and 91.205 requires this one.',
          'fix-first': 'Right. Required equipment gets fixed, or the FSDO issues a special flight permit to get the airplane to the shop.',
          cancel: 'Safe, but the rule already decided it. The examiner wants to hear 91.205(b)(9).',
        },
        { 'fix-first': 'best' },
      ),
      {
        kind: 'turn', id: 't2', title: 'The morning after',
        prompt: `"Last one. You flew into ${s.strip.name} yesterday with a friend, ${fmt(s.strip.runwayFt)} feet of grass at ${fmt(s.strip.elevationFt)} feet. It rained overnight. This morning it is ${s.morning}°C, altimeter ${s.altimeter.toFixed(2)}, wind 270 at ${s.windKt}, and runway 27 rises 2 percent toward its far end. You two and the bags weigh ${fmt(s.weightLb)} lb with full tanks."`,
        figure: { kind: 'perf', chart: 'takeoff-50', performance: s.plane.performance, paFt: s.up.pressureAltFt, oatC: s.morning, sample: s.plane.sample },
        blanks: [
          { id: 'pa', label: 'Pressure altitude', unit: 'ft', answer: s.up.pressureAltFt, tolerance: 20,
            explain: `${fmt(s.strip.elevationFt)} + (29.92 − ${s.altimeter.toFixed(2)}) × 1,000 = ${fmt(s.up.pressureAltFt)} ft.` },
          { id: 'over50', label: 'Book distance over 50 ft, grass, runway 27', unit: 'ft', answer: s.up.over50Ft, tolerance: 60,
            explain: `The chart at maximum gross, less ${s.windKt} knots of headwind, plus the grass note: ${fmt(s.up.over50Ft)} ft.${note}` },
          { id: 'adjusted', label: 'With wet grass, the slope and your weight', unit: 'ft', answer: s.upFt, tolerance: 60,
            explain: `Wet grass about +10 percent, a 2 percent upslope about +10 percent (UK CAA SafetySense leaflet 9), and the weight below gross, (${fmt(s.weightLb)} ÷ ${fmt(s.plane.aircraft.maxGrossLb)})² = ${s.weightFactor.toFixed(2)}: ${fmt(s.up.over50Ft)} × 1.1 × 1.1 × ${s.weightFactor.toFixed(2)} ≈ ${fmt(s.upFt)} ft.` },
        ],
      },
      {
        kind: 'decide', id: 'd3', title: 'Which way out?',
        situation: `Runway 27, uphill into the wind: ${fmt(s.upFt)} feet to clear 50 feet. Runway 09, downhill with ${s.windKt} knots behind you: ${fmt(s.downFt)}. Wait until noon for the grass to dry, ${s.noon}°C, runway 27: ${fmt(s.dryFt)}. The strip is ${fmt(s.strip.runwayFt)} feet, and the book assumes a new airplane and a test pilot, so add ${Math.round((RUNWAY_MARGIN - 1) * 100)} percent.`,
        figure: { kind: 'chart', highlight: ['2X5'] },
        options: [
          { id: 'up-wind', label: 'Runway 27 now: uphill, into the wind.' },
          { id: 'down-slope', label: 'Runway 09 now: going downhill helps you accelerate.' },
          { id: 'wait-dry', label: 'Wait for the grass to dry and leave at noon.' },
          { id: 'leave-it', label: 'Leave the airplane and come back another day.' },
        ],
        grades: s.grades,
        consequence: follow(s.grades, { 'up-wind': 'best', 'down-slope': 'marginal', 'wait-dry': 'marginal', 'leave-it': 'acceptable' }, {
          'up-wind': `${fmt(s.upFt)} feet, ${fmt(s.upFt * RUNWAY_MARGIN)} with the margin, inside ${fmt(s.strip.runwayFt)}. Walk the strip first for soft spots, and pick an abort point: if you aren't at 70 percent of liftoff speed by the halfway mark, close the throttle while there is grass left to stop on.`,
          'down-slope': `The slope helps, but ${s.windKt} knots behind you costs more: ${fmt(s.downFt)} feet, ${fmt(s.downFt * RUNWAY_MARGIN)} with the margin. On a sloped strip the wind usually wins.`,
          'wait-dry': `Dry grass helps, but by noon it is ${s.noon}°C and the density altitude has climbed: ${fmt(s.dryFt)} feet, no better than now. The sun took back what it gave.`,
          'leave-it': 'Safe, and sometimes right, but runway 27 this morning fit with the margin.',
        }, (id) => (id === 'leave-it' ? 'No way out fits with the margin, so the airplane waits.' : `That way out grades ${s.grades[id]} against the strip with the margin.`)),
        why: `Wet grass and an upslope each add about 10 percent, weight below gross takes some back, and a tailwind adds about 10 percent for every 2 knots. Work out each way out with its factors, hold each to the margin, and choose before you start the engine, along with the point where you abort.${note}`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 9.3

/** A review signed on the 3rd, 24 months back from this month: still good, but only through month end. */
export function exampleReview(now: Date) {
  const today = dateOnly(now);
  const signed = new Date(Date.UTC(today.getUTCFullYear() - 2, today.getUTCMonth(), 3));
  return { today, signed, status: calendarStatus(signed, 24, today) };
}

const reviewLesson: Lesson = {
  id: '9.3', module: 9, minutes: 12,
  title: 'Your flight review summary',
  summary: 'What 61.56 asks for, when yours runs out, what to do when it has, and the record to bring your CFI.',
  acs: ['PA.I.A'],
  refs: ['14 CFR 61.56', '14 CFR 61.57(a)'],
  build(ctx) {
    const today = dateOnly(ctx.now);
    const mine = flightReviewStatus(ctx.lastFlightReview ?? null, today);
    const ex = exampleReview(ctx.now);
    const wrongDay = new Date(Date.UTC(ex.signed.getUTCFullYear() + 2, ex.signed.getUTCMonth(), ex.signed.getUTCDate()));
    const prevEnd = endOfCalendarMonth(ex.signed, 23);
    const lapsedEnd = endOfCalendarMonth(today, -1);
    const lapsed = calendarStatus(endOfCalendarMonth(today, -25), 24, today);
    const daysLapsed = daysBetween(lapsedEnd, today);
    const checkride = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 4, 12));
    const ride = calendarStatus(checkride, 24, today);
    const grades = gradeReviewLapse(lapsed, ride.current);

    const shown = mine
      ? { signed: dateOnly(ctx.lastFlightReview!), status: mine, yours: true }
      : { signed: ex.signed, status: ex.status, yours: false };

    return [
      {
        kind: 'brief', id: 'b1', title: 'What the review is',
        scene: 'Every 24 calendar months, a CFI signs your logbook or you stop acting as pilot in command.',
        say: {
          full: 'A flight review (61.56) is at least **one hour of ground** and **one hour of flight** with an instructor. The ground part covers the current general operating and flight rules of part 91; the flight part is whatever maneuvers the CFI decides show you are safe. It is not a checkride and there is no pass or fail, only a logbook endorsement or "let\'s fly again." A checkride for a new certificate or rating, or a phase of the FAA WINGS program, counts instead. The best reviews start with an honest record of where you are weak.',
          short: 'One hour ground, one hour flight, every 24 calendar months.',
        },
      },
      {
        kind: 'example', id: 'e1', title: shown.yours ? 'Your date' : 'An example date',
        say: {
          full: shown.yours
            ? `From the date on your Pilot screen. Count 24 months from the month it was signed, then go to the end of that month.`
            : 'You haven\'t entered your last review on the Pilot screen, so here is an example. Count 24 months from the month it was signed, then go to the end of that month.',
          short: '24 months, then month end.',
        },
        work: [
          { label: 'Signed', value: longDate(shown.signed), note: shown.yours ? 'Your last flight review' : 'Example, not your date' },
          { label: 'Good through', value: longDate(shown.status.dueEnd) },
          { label: 'Today', value: longDate(today), note: shown.status.current ? `${shown.status.daysLeft} days left` : `Lapsed ${-shown.status.daysLeft} days ago` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `A review was signed on ${longDate(ex.signed)}. Today is ${longDate(today)}.`,
        blanks: [
          { id: 'end', label: 'Last day to act as PIC on it', answer: longDate(ex.status.dueEnd), choices: [prevEnd, wrongDay, ex.status.dueEnd].map(longDate),
            explain: `24 calendar months from ${shortDate(ex.signed)} ends on ${longDate(ex.status.dueEnd)}, not on the same date two years on.` },
          { id: 'ok', label: 'Still good today?', answer: ex.status.current ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: ex.status.current ? `Yes, for ${ex.status.daysLeft} more day${ex.status.daysLeft === 1 ? '' : 's'}. Book the CFI now.` : 'No. It has lapsed.' },
          { id: 'ground', label: 'Minimum ground instruction', unit: 'hours', answer: 1, tolerance: 0, explain: '61.56(a)(1): at least 1 hour of ground training.' },
          { id: 'flight', label: 'Minimum flight instruction', unit: 'hours', answer: 1, tolerance: 0, explain: '61.56(a)(2): at least 1 hour of flight training.' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'It ran out, or did it?',
        situation: `Your last flight review ran out on ${longDate(lapsedEnd)}, ${daysLapsed} day${daysLapsed === 1 ? '' : 's'} ago. On ${longDate(checkride)} you passed the practical test for your instrument rating. You flew last week, and a friend wants to go up on Saturday.`,
        options: [
          { id: 'fly-friend', label: 'Take your friend on Saturday.' },
          { id: 'fly-solo', label: 'Fly solo only, until a CFI signs a review.' },
          { id: 'review-first', label: 'Book a CFI for a flight review, then take your friend.' },
          { id: 'wait', label: 'Stop flying until you get a review signed.' },
        ],
        grades,
        consequence: follow(grades, { 'fly-friend': 'best', 'fly-solo': 'acceptable', 'review-first': 'acceptable', wait: 'marginal' }, {
          'fly-friend': `Right. 61.56(d): passing a practical test for a certificate or rating in the 24 calendar months stands in for the review, so you are good through ${longDate(ride.dueEnd)}. Passenger currency under 61.57 is a separate check, and last week's landings cover it.`,
          'fly-solo': 'Legal, and so is the trip with your friend. The checkride already counts as your review.',
          'review-first': 'Never wasted, but not required. The checkride reset the clock, and the CFI\'s hour is better spent on what you want to sharpen.',
          wait: 'You would be grounding yourself for a rule you already meet. Know what counts before you cancel.',
        }, () => (ride.current ? 'The checkride inside 24 calendar months decides it.' : 'The review status decides it.')),
        why: `61.56(c) is about acting as pilot in command, solo or not, so without the checkride every option but the review would be off the table. But 61.56(d) counts a practical test for a certificate or rating, and 61.56(e) a phase of the FAA WINGS program, in place of the review. Your logbook shows the endorsement or the temporary certificate, and that is what you show if asked.`,
      },
      {
        kind: 'brief', id: 'b2', title: 'What to bring',
        scene: mine
          ? `Your review is good through ${longDate(mine.dueEnd)}.${mine.current ? ` That is ${mine.daysLeft} days from today.` : ' It has lapsed.'}`
          : 'Add your last review date on the Pilot screen and the summary counts the days for you.',
        say: {
          full: 'The **Flight review summary** in your Logbook is the record to bring. It lists every lesson you have flown and how it went, the lessons worth flying again, the ACS tasks you have covered and the ones still open, and what your filed briefings kept flagging. Print it or hand over the screen. Ask the CFI to spend the hour on the top of that list, not on what you already do well.',
          short: 'Bring the Flight review summary from your Logbook. Start with the top of the list.',
        },
      },
    ];
  },
};

export const oralLessons: Lesson[] = [weekendOral, airplaneOral, reviewLesson];
