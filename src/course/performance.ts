// Module 3, Performance and loading: four flights. Weight and balance and
// performance come from the pilot's own airplane when they have entered it,
// and from the practice trainer when they haven't; the sample charts are
// labeled sample wherever they appear. Every number and every grade below is
// computed (course/airplane.ts and lib/), and the copy reads them back.

import { isaTempC, pressureAltitudeFt } from '../lib/density';
import { climbRate, takeoffDistance, type DistanceResult, type RunwayConditions } from '../lib/perf';
import { destination, distanceNm, navLog, trueCourse, windTriangle, type NavPoint } from '../lib/nav';
import { norm } from '../lib/wind';
import { chartAirport, practiceRegion } from '../chart/practiceRegion';
import type { Grade } from '../scenarios/goNoGo';
import {
  airAt, capGrade, climbGainFt, fuelGrade, fuelToGross, landingFuel, lessonAirplane, loadingGrade, loadWb, reserveGrade, runwayGrade, tripFuel, zeroFuelWb,
  REAL_RESERVE_MIN, RUNWAY_MARGIN, type Air, type LessonAirplane, type Loading,
} from './airplane';
import { addHours, cloud, mainRunway, metarText, nextLocalHour, observedAt, windAcross } from './practice';
import type { Figure, Lesson, LessonContext, Option, Step, WorkRow } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const r1 = (n: number) => Math.round(n * 10) / 10;
const round5 = (n: number) => Math.round(n / 5) * 5;
const ceil100 = (n: number) => Math.ceil(n / 100) * 100;
const round100 = (n: number) => Math.round(n / 100) * 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const local = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fromStandard = (d: number) => (Math.abs(d) < 0.5 ? 'about standard' : `${d > 0 ? '+' : '−'}${r1(Math.abs(d))}° from standard`);

function fieldName(ctx: LessonContext): string {
  return ctx.practiceField ? 'the practice field' : ctx.airport.icao;
}

/** One line naming the airplane and where its numbers come from. */
function airplaneNote(ap: LessonAirplane): string {
  if (ap.practice) return 'You haven\'t entered an airplane yet, so this lesson flies the **practice trainer**: a made-up four-seater with sample numbers, not any real airplane.';
  if (ap.sampleWb || ap.samplePerf) return `This lesson uses ${ap.name}'s profile. Some of its numbers are still the **sample values** from the template, so treat the answers as practice until you replace them from your POH.`;
  return `This lesson uses ${ap.name}'s numbers as you entered them from the POH.`;
}

function perfNote(ap: LessonAirplane): string {
  return ap.samplePerf
    ? 'The performance charts here are **sample charts** for teaching, not any manufacturer\'s data.'
    : `The charts are ${ap.name}'s, as you entered them.`;
}

const RANK: Grade[] = ['unsafe', 'marginal', 'acceptable', 'best'];
const bestOf = (grades: Record<string, Grade>) => {
  const top = RANK.slice().reverse().find((g) => Object.values(grades).includes(g))!;
  return Object.keys(grades).filter((id) => grades[id] === top);
};

// ---------------------------------------------------------------- 3.1

/** Pilot and front passenger together. A scenario, not anyone's real weight. */
const FRONT_LB = 340;
const LUNCH_TRIP = { climbMin: 10, cruiseMin: 40, night: false };

function wbFigure(ap: LessonAirplane, l: Loading): Extract<Figure, { kind: 'wb' }> {
  const a = ap.profile;
  return { kind: 'wb', envelope: a.envelope, maxGrossLb: a.maxGrossLb, loaded: loadWb(ap, l), zeroFuel: zeroFuelWb(ap, l), sample: ap.sampleWb, practice: ap.practice };
}

function wbRows(ap: LessonAirplane, l: Loading): WorkRow[] {
  const a = ap.profile;
  const lines: [string, number, number][] = [
    ['Empty weight', a.emptyWeightLb, a.emptyArmIn],
    [ap.front.label, l.frontLb, ap.front.armIn],
  ];
  if (l.rearLb > 0) lines.push([ap.rear.label, l.rearLb, ap.rear.armIn]);
  if (ap.bag && l.bagLb > 0) lines.push([ap.bag.label, l.bagLb, ap.bag.armIn]);
  lines.push([`Fuel, ${l.fuelGal} gal × 6`, l.fuelGal * 6, ap.fuel.armIn]);
  const wb = loadWb(ap, l);
  return [
    ...lines.map(([label, w, arm]) => ({ label, value: `${fmt(w)} lb`, note: `× ${arm} in = ${fmt(w * arm)} lb-in` })),
    { label: 'Total', value: `${fmt(wb.totalLb)} lb`, note: `${fmt(wb.momentLbIn)} lb-in. Max gross ${fmt(a.maxGrossLb)} lb.` },
    { label: 'CG', value: `${wb.cgIn} in`, note: `${fmt(wb.momentLbIn)} ÷ ${fmt(wb.totalLb)}, ${wb.withinEnvelope ? 'inside' : 'outside'} the envelope` },
  ];
}

/** Where a loading leaves you: weight, CG and the fuel you land with. */
function loadStatus(ap: LessonAirplane, l: Loading): string {
  const wb = loadWb(ap, l);
  const max = ap.profile.maxGrossLb;
  const t = tripFuel(ap.perf, { ...LUNCH_TRIP, onBoardGal: l.fuelGal });
  const land = landingFuel(ap.perf, l.fuelGal, t.legal.taxiGal + t.legal.climbGal + t.legal.cruiseGal);
  const weight = wb.overGross
    ? `${fmt(wb.totalLb)} lb, ${fmt(wb.totalLb - max)} over max gross`
    : wb.totalLb === max ? `${fmt(wb.totalLb)} lb, right at max gross` : `${fmt(wb.totalLb)} lb, ${fmt(max - wb.totalLb)} under max gross`;
  // Over gross is off the top of the envelope whatever the CG; say the CG plainly then.
  const cg = wb.overGross ? `CG ${wb.cgIn} in` : `CG ${wb.cgIn} in, ${wb.withinEnvelope ? 'inside' : 'outside'} the envelope`;
  const bag = wb.stationsOverMax.length ? ' The baggage is over its placard limit.' : '';
  return `${weight}; ${cg}; you land with ${r1(land.gal)} gal, about ${land.min} minutes.${bag}`;
}

const passengers: Lesson = {
  id: '3.1', module: 3, minutes: 18,
  title: 'Weight and balance with real passengers',
  summary: 'Load the airplane with two friends and a bag, find the weight and CG, and decide what stays on the ground.',
  acs: ['PA.I.F'],
  refs: ['PHAK ch. 10', '14 CFR 91.9, 91.103', 'POH section 6, weight and balance'],
  build(ctx) {
    const ap = lessonAirplane(ctx.aircraft);
    const a = ap.profile;
    const full = a.usableFuelGal;
    const bag = ap.bag ? Math.min(40, ap.bag.maxLb ?? 40) : 0;
    // Two friends in the back, sized so full tanks land a little over gross.
    const rear = clamp(round5(a.maxGrossLb + 80 - a.emptyWeightLb - FRONT_LB - bag - full * 6), 150, 400);
    const pair: Loading = { frontLb: FRONT_LB, rearLb: 0, bagLb: 0, fuelGal: full };
    const asked: Loading = { frontLb: FRONT_LB, rearLb: rear, bagLb: bag, fuelGal: full };
    const lessFuel = fuelToGross(ap, asked);
    const loads: Record<string, Loading> = {
      'as-loaded': asked,
      ...(bag > 0 ? { 'bag-out': { ...asked, bagLb: 0 } } : {}),
      'less-fuel': { ...asked, fuelGal: lessFuel },
      'one-friend': { ...asked, rearLb: round5(rear / 2) },
    };
    const grades: Record<string, Grade> = {};
    for (const [id, l] of Object.entries(loads)) {
      const g = loadingGrade(ap, l, LUNCH_TRIP);
      grades[id] = id === 'one-friend' ? capGrade(g, 'acceptable') : g;
    }
    const wbPair = loadWb(ap, pair);
    const wb = loadWb(ap, asked);
    const diff = wb.totalLb - a.maxGrossLb;
    const fuelLb = full * 6;

    const options: Option[] = [
      { id: 'as-loaded', label: diff > 0 ? `Go as loaded. ${fmt(diff)} pounds is a few percent, and the airplane will fly.` : 'Go as loaded.' },
      ...(bag > 0 ? [{ id: 'bag-out', label: `Leave the ${bag} lb bag in the car.` }] : []),
      { id: 'less-fuel', label: `Take ${lessFuel} gallons instead of full tanks.` },
      { id: 'one-friend', label: 'Take one friend now and come back for the other.' },
    ];
    const label = (id: string) => options.find((o) => o.id === id)!.label;
    const lead: Record<Grade, Record<string, string>> = {
      unsafe: {
        'as-loaded': 'The airplane flies, but slower to climb, with a higher stall speed, at a weight the POH never tested, and 91.9 makes the limit the law.',
        'bag-out': 'Forty pounds was never going to cover it.',
        'less-fuel': 'Less fuel was the right lever, but not enough of it, or too much.',
        'one-friend': 'Even with one friend the numbers don\'t work.',
      },
      marginal: {
        'as-loaded': 'Legal on weight, but short on fuel for the reserve you plan to land with.',
        'bag-out': 'Legal, but short on fuel for the reserve you plan to land with.',
        'less-fuel': 'Legal, but you have traded away the reserve you plan to land with.',
        'one-friend': 'Legal, but short on fuel for the reserve you plan to land with.',
      },
      acceptable: {
        'one-friend': 'Safe and legal, at the cost of a second trip and a friend waiting.',
      },
      best: {
        'as-loaded': 'Inside every limit as loaded.',
        'bag-out': 'Inside every limit with the bag left behind.',
        'less-fuel': 'Fuel is the one load you can trade without leaving anyone behind, and they sell it where you\'re going.',
        'one-friend': 'Safe and legal.',
      },
    };
    const consequence: Record<string, string> = {};
    for (const id of Object.keys(loads)) consequence[id] = `${lead[grades[id]][id] ?? ''} ${loadStatus(ap, loads[id])}`.trim();
    const best = bestOf(grades);

    return [
      {
        kind: 'brief', id: 'b1', title: 'Four seats, not four people',
        scene: `Saturday. You've offered two friends a ride to lunch, about ${LUNCH_TRIP.climbMin + LUNCH_TRIP.cruiseMin} minutes from ${fieldName(ctx)}, at a field that sells fuel. They arrive with a bag. ${airplaneNote(ap)}`,
        say: {
          full: 'Four seats and full tanks is not a load most trainers can carry. Two limits matter: **maximum gross weight** and the **CG envelope**. For each item, weight times its **arm** (inches from the datum) is its **moment**. Add the weights, add the moments, then divide: total moment over total weight is the **CG**. If the weight is under gross and the CG falls inside the envelope at that weight, the airplane is loaded the way it was certified to fly.',
          short: 'Weight times arm is moment. Total moment over total weight is the CG.',
        },
        figure: wbFigure(ap, pair),
      },
      {
        kind: 'example', id: 'e1', title: 'Just the two of you first',
        say: {
          full: `Here is the airplane with the front seats filled (${FRONT_LB} lb together) and full tanks, ${full} gallons at 6 pounds a gallon. Every line is weight times arm. The total is ${fmt(wbPair.totalLb)} lb, ${fmt(a.maxGrossLb - wbPair.totalLb)} under gross: that is all the back seat and the bag can weigh.`,
          short: 'Front seats and full fuel first. What is left is what the back seat and bag can be.',
        },
        figure: wbFigure(ap, pair),
        work: wbRows(ap, pair),
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now add your friends in the back, ${fmt(rear)} lb together at ${ap.rear.armIn} in${bag > 0 && ap.bag ? `, and their ${bag} lb bag at ${ap.bag.armIn} in` : ''}. What is the total weight, where is the CG, and how far ${diff > 0 ? 'over' : 'under'} max gross are you?`,
        blanks: [
          { id: 'total', label: 'Total weight', unit: 'lb', answer: wb.totalLb, tolerance: 5,
            explain: `${fmt(wbPair.totalLb)} lb from the example, plus ${fmt(rear)}${bag > 0 ? ` and ${bag}` : ''}: ${fmt(wb.totalLb)} lb.` },
          { id: 'cg', label: 'CG', unit: 'in', answer: wb.cgIn, tolerance: 0.3,
            explain: `Total moment ${fmt(wb.momentLbIn)} lb-in divided by ${fmt(wb.totalLb)} lb is ${wb.cgIn} in. The back seat moves the CG aft.` },
          { id: 'over', label: diff > 0 ? 'Over max gross by' : 'Under max gross by', unit: 'lb', answer: Math.abs(diff), tolerance: 5,
            explain: `${fmt(wb.totalLb)} against ${fmt(a.maxGrossLb)}: ${fmt(Math.abs(diff))} lb ${diff > 0 ? 'over' : 'under'}. Full fuel alone is ${fmt(fuelLb)} lb.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Who and what goes',
        situation: `Everyone, the bag and full tanks: ${fmt(wb.totalLb)} lb against a ${fmt(a.maxGrossLb)} lb maximum. Lunch is ${LUNCH_TRIP.climbMin + LUNCH_TRIP.cruiseMin} minutes away and they sell fuel there. This course plans to land with an hour of fuel, ${REAL_RESERVE_MIN} minutes, not just the legal 30.`,
        figure: wbFigure(ap, asked),
        options,
        grades,
        consequence,
        why: `${label(best[0])} ${loadStatus(ap, loads[best[0]])} Gross weight and the envelope are limits, not suggestions: over them the airplane climbs and stalls differently than the book says.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 3.2

const RIDGE_NM = 3;
const RIDGE_CLEAR_FT = 500;

const hotAfternoon: Lesson = {
  id: '3.2', module: 3, minutes: 16,
  title: 'Density altitude on a hot afternoon',
  summary: 'Work pressure and density altitude from the report, see what the heat takes from the climb, and plan a departure that respects it.',
  acs: ['PA.I.F', 'PA.I.C'],
  refs: ['PHAK ch. 4 and 11', 'POH section 5, performance'],
  build(ctx) {
    const f = ctx.airport;
    const rwy = mainRunway(f);
    const ap = lessonAirplane(ctx.aircraft);
    const p = ap.perf;
    const elev = f.elevationFt;

    const pmAt = nextLocalHour(ctx.now, 15);
    const amAt = addHours(pmAt, -7);
    const amAlt = 30.1;
    const pmAlt = 29.82;
    const amT = Math.round(isaTempC(pressureAltitudeFt(elev, amAlt)));
    const pmT = Math.round(isaTempC(pressureAltitudeFt(elev, pmAlt)) + 20);
    const am: Air = { fieldElevFt: elev, altimeterInHg: amAlt, oatC: amT };
    const pm: Air = { fieldElevFt: elev, altimeterInHg: pmAlt, oatC: pmT };
    const amA = airAt(am);
    const pmA = airAt(pm);
    const pmPa = pressureAltitudeFt(elev, pmAlt);
    const pmIsa = r1(isaTempC(pmPa));
    const amIsa = r1(isaTempC(pressureAltitudeFt(elev, amAlt)));

    const wind = { dirTrue: windAcross(f, rwy.headingMag, 0), speedKt: 4 };
    const amRaw = metarText({ station: f.icao, at: observedAt(amAt), wind, vis: '10SM', sky: [], tempC: amT, dewC: amT - 3, altimeter: amAlt });
    const pmRaw = metarText({ station: f.icao, at: observedAt(pmAt), wind, vis: '10SM', sky: [cloud('FEW', 6000)], tempC: pmT, dewC: pmT - 14, altimeter: pmAlt });
    const tempGroup = (t: number, d: number) => `${t < 0 ? `M${String(-t).padStart(2, '0')}` : String(t).padStart(2, '0')}/${d < 0 ? `M${String(-d).padStart(2, '0')}` : String(d).padStart(2, '0')}`;

    const climbAm = Math.round(climbRate(p, amA.paFt, amT).value);
    const climbPm = Math.round(climbRate(p, pmA.paFt, pmT).value);
    const rc = (a: Air): RunwayConditions => ({ ...a, headwindKt: 0, surface: 'paved' });
    const toAm = takeoffDistance(p, rc(am));
    const toPm = takeoffDistance(p, rc(pm));
    const gainAm = climbGainFt(p, am, RIDGE_NM);
    const gainPm = climbGainFt(p, pm, RIDGE_NM);
    // The ridge sits where the morning climb clears it and the afternoon one does not.
    const need = Math.max(round100((gainAm + gainPm) / 2), RIDGE_CLEAR_FT + 200);
    const ridge = need - RIDGE_CLEAR_FT;
    const topMsl = Math.ceil((elev + need) / 100) * 100;
    const topPa = pmA.paFt + need;
    const topT = pmT - (2 * need) / 1000;
    const climbTop = Math.round(climbRate(p, topPa, topT).value);
    const circleMin = Math.round(need / Math.max(1, (climbPm + climbTop) / 2));
    const pct = (a: number, b: number) => Math.round((b / a - 1) * 100);

    const grades: Record<string, Grade> = {
      'straight-out': gainPm >= need ? 'acceptable' : 'unsafe',
      'climb-overhead': climbTop >= 100 ? 'best' : 'marginal',
      'wait-morning': capGrade(gainAm >= need ? 'best' : 'marginal', 'acceptable'),
    };
    const consequence: Record<string, string> = {
      'straight-out': gainPm >= need
        ? `By the chart you cross the ridge about ${fmt(gainPm - ridge)} feet over it, ${fmt(need - gainPm)} feet inside the margin you wanted. It works, with nothing left for a downdraft on the lee side.`
        : `At the ridge you are about ${fmt(gainPm)} feet above the field: ${gainPm < ridge ? `${fmt(ridge - gainPm)} feet below the ridge line` : `only ${fmt(gainPm - ridge)} feet over it`}. You turn away late, in a climb that has nothing left to give, with trees filling the windscreen.`,
      'climb-overhead': climbTop >= 100
        ? `Circling over the field takes about ${circleMin} minutes, every one of them within reach of a runway. You cross the ridge at ${fmt(topMsl)} feet with the margin you planned.`
        : `The climb nearly stops near the top: about ${climbTop} feet per minute at ${fmt(topMsl)} feet. You get there, slowly, with a hot engine. On a day like this the honest answer might be a lighter airplane or a cooler hour.`,
      'wait-morning': gainAm >= need
        ? `In the morning air you would gain about ${fmt(gainAm)} feet by the ridge and cross it with room. Safe, though climbing over the field would have got you there today.`
        : `Even the morning air only gives about ${fmt(gainAm)} feet by the ridge. Waiting helps, but you would still want to climb over the field first.`,
    };

    return [
      {
        kind: 'brief', id: 'b1', title: 'The same field, a different airplane',
        scene: `A hot afternoon at ${fieldName(ctx)}. You flew this morning and the airplane leapt off. ${airplaneNote(ap)}`,
        say: {
          full: 'The airplane doesn\'t know the field elevation. It feels the **density altitude**: how high the air acts, given its pressure and temperature. Start with **pressure altitude**: field elevation plus 1,000 feet for every inch the altimeter setting is below 29.92. Then compare the temperature with **standard** at that altitude, 15°C at sea level minus 2° per 1,000 feet. Every degree above standard adds about **120 feet**. Hot, high and low pressure all push it up, and the wing, the propeller and the engine all feel it.',
          short: 'Pressure altitude first, then 120 feet per degree above standard.',
        },
        figure: { kind: 'metar', raw: pmRaw, marks: [tempGroup(pmT, pmT - 14), `A${Math.round(pmAlt * 100)}`] },
      },
      {
        kind: 'example', id: 'e1', title: 'This morning\'s numbers',
        say: {
          full: `Here is this morning's report worked through. The altimeter was ${amAlt.toFixed(2)}, above standard, so pressure altitude is a little below the field. The temperature was about standard, so density altitude lands close to pressure altitude.`,
          short: 'Altimeter, then temperature against standard.',
        },
        figure: { kind: 'metar', raw: amRaw, marks: [tempGroup(amT, amT - 3), `A${Math.round(amAlt * 100)}`] },
        work: [
          { label: 'Field elevation', value: `${fmt(elev)} ft` },
          { label: 'Pressure altitude', value: `${fmt(amA.paFt)} ft`, note: `${fmt(elev)} + (29.92 − ${amAlt.toFixed(2)}) × 1,000` },
          { label: 'Standard temperature', value: `${amIsa}°C`, note: `15 − 2 × ${r1(amA.paFt / 1000)}` },
          { label: 'Temperature', value: `${amT}°C`, note: fromStandard(amT - amIsa) },
          { label: 'Density altitude', value: `${fmt(amA.daFt)} ft`, note: `${fmt(amA.paFt)} + 120 × (${amT} − ${amIsa})` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now the afternoon report: ${pmT}°C and an altimeter of ${pmAlt.toFixed(2)} at a ${fmt(elev)} foot field. Work the pressure altitude, the standard temperature there, and the density altitude.`,
        figure: { kind: 'metar', raw: pmRaw, marks: [tempGroup(pmT, pmT - 14), `A${Math.round(pmAlt * 100)}`] },
        blanks: [
          { id: 'pa', label: 'Pressure altitude', unit: 'ft', answer: Math.round(pmPa), tolerance: 10,
            explain: `${fmt(elev)} + (29.92 − ${pmAlt.toFixed(2)}) × 1,000 = ${fmt(pmPa)} ft. Low pressure adds altitude.` },
          { id: 'isa', label: 'Standard temperature there', unit: '°C', answer: pmIsa, tolerance: 1,
            explain: `15 − 2 × ${r1(pmPa / 1000)} = ${pmIsa}°C.` },
          { id: 'da', label: 'Density altitude', unit: 'ft', answer: pmA.daFt, tolerance: 150,
            explain: `${fmt(pmPa)} + 120 × (${pmT} − ${pmIsa}) = about ${fmt(pmA.daFt)} ft, ${fmt(pmA.daFt - amA.daFt)} feet higher than this morning.` },
        ],
      },
      {
        kind: 'example', id: 'e2', title: 'What the airplane feels',
        say: {
          full: `Here is ${ap.name}'s climb chart, read at this afternoon's pressure altitude and temperature. ${perfNote(ap)} The climb rate is down by ${Math.abs(pct(climbAm, climbPm))} percent from this morning, and the takeoff over a 50 foot obstacle is ${pct(toAm.over50Ft, toPm.over50Ft)} percent longer. The worst of it is the climb: over the first ${RIDGE_NM} miles you gain far less height.`,
          short: `Climb down ${Math.abs(pct(climbAm, climbPm))} percent, takeoff ${pct(toAm.over50Ft, toPm.over50Ft)} percent longer.`,
        },
        figure: { kind: 'perf', chart: 'climb', performance: p, paFt: pmA.paFt, oatC: pmT, sample: ap.samplePerf },
        work: [
          { label: 'Density altitude', value: `${fmt(amA.daFt)} → ${fmt(pmA.daFt)} ft` },
          { label: 'Climb at Vy', value: `${fmt(climbAm)} → ${fmt(climbPm)} fpm`, note: 'Read from the climb chart at each pressure altitude and temperature' },
          { label: 'Takeoff over 50 ft', value: `${fmt(toAm.over50Ft)} → ${fmt(toPm.over50Ft)} ft`, note: 'Paved runway, no wind' },
          { label: `Height gained in ${RIDGE_NM} nm`, value: `${fmt(gainAm)} → ${fmt(gainPm)} ft`, note: `Climbing at Vy, ${p.vyKias} knots indicated, in still air` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Toward the ridge',
        situation: `It's ${local(pmAt)} and ${pmT}°C. For this lesson, picture a ridge ${RIDGE_NM} miles off the end of runway ${rwy.id}, ${fmt(ridge)} feet above the field, right on your course. You want ${RIDGE_CLEAR_FT} feet over it.`,
        options: [
          { id: 'straight-out', label: 'Take off and climb straight out on course at Vy.' },
          { id: 'climb-overhead', label: `Climb over the field to ${fmt(topMsl)} feet, then head for the ridge.` },
          { id: 'wait-morning', label: 'Put it off to tomorrow morning, when it is cool.' },
        ],
        grades,
        consequence,
        why: `You need ${fmt(need)} feet by the ridge. This afternoon the chart gives about ${fmt(gainPm)} in ${RIDGE_NM} miles, this morning it gave ${fmt(gainAm)}. Climbing over the field turns a race with the terrain into a climb with a runway underneath.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 3.3

const STRIP_HEADWIND_KT = 4;

function distanceRows(d: DistanceResult): WorkRow[] {
  return d.steps.map((s) => ({ label: s.label, value: `${fmt(s.over50Ft)} ft`, note: `Ground roll ${fmt(s.groundRollFt)} ft` }));
}

const shortStrip: Lesson = {
  id: '3.3', module: 3, minutes: 18,
  title: 'Takeoff distance and the 50 foot obstacle',
  summary: 'Read the takeoff chart for a short grass strip, apply the wind and surface notes, add a margin, and pick the hour you leave.',
  acs: ['PA.I.F', 'PA.IV.C'],
  refs: ['PHAK ch. 11', 'POH section 5, performance', 'AFH, crosswind takeoff and landing'],
  build(ctx) {
    const ap = lessonAirplane(ctx.aircraft);
    const p = ap.perf;
    const n = p.takeoff.notes;
    const elev = ctx.airport.elevationFt + 200;
    const pa = pressureAltitudeFt(elev, 29.92);
    const isa = isaTempC(pa);
    const amT = Math.round(isa - 5);
    const evT = Math.round(isa + 8);
    const pmT = Math.round(isa + 20);
    const cond = (oatC: number, headwindKt: number): RunwayConditions => ({ fieldElevFt: elev, altimeterInHg: 29.92, oatC, headwindKt, surface: 'grass' });
    const am = takeoffDistance(p, cond(amT, 0));
    const ev = takeoffDistance(p, cond(evT, 0));
    const pm = takeoffDistance(p, cond(pmT, STRIP_HEADWIND_KT));
    // The strip is as long as the cool-morning departure needs with the margin.
    const runway = ceil100(am.over50Ft * RUNWAY_MARGIN);
    const needed = round5(pm.over50Ft * RUNWAY_MARGIN);
    const chartPm = pm.steps[0];
    const evAt = nextLocalHour(ctx.now, 19);

    const grades: Record<string, Grade> = {
      'go-now': runwayGrade(pm.over50Ft, runway),
      'go-evening': runwayGrade(ev.over50Ft, runway),
      'go-morning': runwayGrade(am.over50Ft, runway),
    };
    const outcome = (d: DistanceResult, g: Grade) =>
      g === 'unsafe'
        ? `The book puts you over the 50 foot trees at ${fmt(d.over50Ft)} feet, past the end of a ${fmt(runway)} foot strip. There is no technique that makes that up.`
        : g === 'marginal'
          ? `The book clears the trees at ${fmt(d.over50Ft)} feet with ${fmt(runway - d.over50Ft)} feet to spare. That spare is all there is for a soft spot, a tired engine or a technique that isn't perfect, and you'd want ${fmt(round5(d.over50Ft * RUNWAY_MARGIN))}.`
          : `The book clears the trees at ${fmt(d.over50Ft)} feet, inside the margin, with ${fmt(runway - d.over50Ft)} feet to spare.`;
    const consequence: Record<string, string> = {
      'go-now': outcome(pm, grades['go-now']),
      'go-evening': `At ${evT}°C: ${outcome(ev, grades['go-evening'])}`,
      'go-morning': `At ${amT}°C: ${outcome(am, grades['go-morning'])}${grades['go-morning'] === 'best' ? ' A night away from home, and a departure the numbers are happy with.' : ''}`,
    };

    return [
      {
        kind: 'brief', id: 'b1', title: 'A strip with trees at the end',
        scene: `You flew into a grass strip this morning for breakfast: a made-up field for this lesson, ${fmt(runway)} feet of dry grass at ${fmt(elev)} feet, with 50 foot trees past the far end. It's mid-afternoon now and ${pmT}°C. ${airplaneNote(ap)}`,
        say: {
          full: 'The POH takeoff chart gives two numbers: the **ground roll**, and the **total distance to clear a 50 foot obstacle**. The second is the one that matters with trees at the end. Read the chart at your **pressure altitude and temperature**, then apply the **notes** under it: so many percent less for each few knots of headwind, much more for a tailwind, and a share of the ground roll added on grass. The chart assumes a new airplane, a perfect technique and a test pilot, so add a margin. This course adds half again.',
          short: 'Chart, then the notes, then half again.',
        },
        figure: { kind: 'perf', chart: 'takeoff-50', performance: p, paFt: am.pressureAltFt, oatC: amT, sample: ap.samplePerf },
      },
      {
        kind: 'example', id: 'e1', title: 'If you had left at sunrise',
        say: {
          full: `Here is the same takeoff at ${amT}°C, no wind, the way it would have been at sunrise. The chart gives the paved number. Grass adds ${n.grassPctOfGroundRoll} percent of the **ground roll** to both distances, because the extra is all spent on the ground. ${perfNote(ap)}`,
          short: `Grass adds ${n.grassPctOfGroundRoll} percent of the ground roll.`,
        },
        figure: { kind: 'perf', chart: 'takeoff-50', performance: p, paFt: am.pressureAltFt, oatC: amT, sample: ap.samplePerf },
        work: [
          { label: 'Pressure altitude', value: `${fmt(am.pressureAltFt)} ft`, note: `Altimeter 29.92, so the field elevation. Density altitude ${fmt(am.densityAltFt)} ft.` },
          ...distanceRows(am),
          { label: 'With half again', value: `${fmt(round5(am.over50Ft * RUNWAY_MARGIN))} ft`, note: `Against ${fmt(runway)} ft of runway` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now, at ${pmT}°C with ${STRIP_HEADWIND_KT} knots straight down the runway. The chart reads ${fmt(chartPm.groundRollFt)} feet of ground roll and ${fmt(chartPm.over50Ft)} feet over 50 feet. The notes: ${n.headwindPct} percent less for each ${n.headwindStepKt} knots of headwind, then ${n.grassPctOfGroundRoll} percent of the ground roll added on dry grass. What are the two distances, and how much runway would you want with half again?`,
        figure: { kind: 'perf', chart: 'takeoff-50', performance: p, paFt: pm.pressureAltFt, oatC: pmT, sample: ap.samplePerf },
        blanks: [
          { id: 'roll', label: 'Ground roll', unit: 'ft', answer: pm.groundRollFt, tolerance: 30,
            explain: `${fmt(chartPm.groundRollFt)} less ${r1((n.headwindPct * STRIP_HEADWIND_KT) / n.headwindStepKt)} percent for the wind, then ${n.grassPctOfGroundRoll} percent more for the grass: about ${fmt(pm.groundRollFt)} ft.` },
          { id: 'over50', label: 'Over a 50 ft obstacle', unit: 'ft', answer: pm.over50Ft, tolerance: 40,
            explain: `${fmt(chartPm.over50Ft)} less the wind share, plus the same feet of grass as the ground roll gained: about ${fmt(pm.over50Ft)} ft.` },
          { id: 'margin', label: 'Runway you want, with half again', unit: 'ft', answer: needed, tolerance: 60,
            explain: `${fmt(pm.over50Ft)} × ${RUNWAY_MARGIN} = about ${fmt(needed)} ft, against ${fmt(runway)} ft of grass.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'When do you leave?',
        situation: `${fmt(runway)} feet of grass and trees at the end. Now it's ${pmT}°C with ${STRIP_HEADWIND_KT} knots on the nose. The forecast has ${evT}°C and calm by ${local(evAt)}, and ${amT}°C at sunrise tomorrow.`,
        figure: { kind: 'perf', chart: 'takeoff-50', performance: p, paFt: pm.pressureAltFt, oatC: pmT, sample: ap.samplePerf },
        options: [
          { id: 'go-now', label: 'Go now. The book says you clear the trees.' },
          { id: 'go-evening', label: `Wait until ${local(evAt)}, when it has cooled off.` },
          { id: 'go-morning', label: 'Tie down for the night and leave at sunrise.' },
        ],
        grades,
        consequence,
        why: `With half again on the book distance you want ${fmt(needed)} feet now, ${fmt(round5(ev.over50Ft * RUNWAY_MARGIN))} this evening and ${fmt(round5(am.over50Ft * RUNWAY_MARGIN))} at sunrise, against ${fmt(runway)} feet. The book number is what a new airplane does on a good day; the margin is for yours.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 3.4

const FORECAST_WIND_KT = 20;
const ACTUAL_WIND_KT = 35;
const CLIMB_MIN = 10;

const navPoint = (id: string): NavPoint => {
  const a = chartAirport(id)!;
  return { id: a.id, name: a.name, ...a.pos };
};

const fuelReserve: Lesson = {
  id: '3.4', module: 3, minutes: 18,
  title: 'Fuel: legal reserve and real reserve',
  summary: 'Plan the fuel for a cross-country into a headwind, see the gap between the legal reserve and a real one, and act on it in the air.',
  acs: ['PA.I.D', 'PA.I.F', 'PA.VI.B'],
  refs: ['14 CFR 91.151, 91.103', 'PHAK ch. 11', 'POH section 5, performance'],
  build(ctx) {
    const ap = lessonAirplane(ctx.aircraft);
    const p = ap.perf;
    const R = practiceRegion;
    const from = navPoint('KXYZ');
    const to = navPoint('KXQA');
    const tc = Math.round(trueCourse(from, to));
    const windFrom = Math.round(norm(tc + 20) / 10) * 10 || 360;
    const log = (kt: number) => navLog([from, to], { tasKt: p.cruise.tasKt, windFromTrue: windFrom, windKt: kt, variationDeg: R.variationDeg, gph: p.cruise.gph });
    const still = log(0);
    const fc = log(FORECAST_WIND_KT);
    const leg = fc.legs[0];
    const plan = (cruiseMin: number, onBoardGal: number) => tripFuel(p, { climbMin: CLIMB_MIN, cruiseMin, night: false, onBoardGal });
    const stillPlan = plan(still.totalMin, 0).legal;
    const req = plan(fc.totalMin, 0);
    const onBoard = Math.min(ap.profile.usableFuelGal, Math.ceil(req.legal.requiredGal + 1.5));
    const t = plan(fc.totalMin, onBoard);

    // d1: go as is, top off, or not today.
    const topOff: Loading = { frontLb: FRONT_LB, rearLb: 0, bagLb: 0, fuelGal: ap.profile.usableFuelGal };
    const grades1: Record<string, Grade> = {
      go: fuelGrade(t),
      'top-off': loadingGrade(ap, topOff, { climbMin: CLIMB_MIN, cruiseMin: fc.totalMin, night: false }),
      cancel: 'acceptable',
    };
    const plannedLand = landingFuel(p, onBoard, req.legal.taxiGal + req.legal.climbGal + req.legal.cruiseGal);
    const fullLand = landingFuel(p, ap.profile.usableFuelGal, req.legal.taxiGal + req.legal.climbGal + req.legal.cruiseGal);

    // d2: halfway, the wind is stronger than forecast.
    const half = leg.distanceNm / 2;
    const midpoint = { id: 'half', name: 'Halfway', ...destination(from, tc, half) };
    const gs2 = windTriangle(tc, p.cruise.tasKt, windFrom, ACTUAL_WIND_KT).groundspeedKt;
    const burnedHalf = req.legal.taxiGal + req.legal.climbGal + ((half / gs2) * p.cruise.gph);
    const leftHalf = r1(onBoard - burnedHalf);
    const legTo = (id: string) => {
      const dest = navPoint(id);
      const nm = r1(distanceNm(midpoint, dest));
      const gs = windTriangle(Math.round(trueCourse(midpoint, dest)), p.cruise.tasKt, windFrom, ACTUAL_WIND_KT).groundspeedKt;
      const min = Math.round((nm / gs) * 60);
      const land = landingFuel(p, leftHalf, (min * p.cruise.gph) / 60);
      return { id, name: dest.name, nm, gs, min, land };
    };
    const onward = legTo('KXQA');
    const fuelStop = ['KXYZ', 'KXQC'].map(legTo).sort((a, b) => a.min - b.min)[0];
    const noFuel = legTo('KXRB');
    const stopName = fuelStop.id === from.id ? from.id : fuelStop.name;
    const grades2: Record<string, Grade> = {
      continue: reserveGrade(onward.land.min),
      // Once the fuel is behind plan, landing for more is the call, as long as you get there legal.
      divert: fuelStop.land.min >= 30 ? 'best' : 'marginal',
      'land-near': capGrade(reserveGrade(noFuel.land.min), 'acceptable'),
    };
    const landLine = (x: { land: { gal: number; min: number } }) => `${r1(x.land.gal)} gallons, about ${x.land.min} minutes`;

    const steps: Step[] = [
      {
        kind: 'brief', id: 'b1', title: 'Two reserves',
        scene: `A cross-country on the practice sectional, ${from.id} to ${to.id} (${to.name}), ${leg.distanceNm} nm. The winds aloft give ${FORECAST_WIND_KT} knots, nearly on the nose. ${airplaneNote(ap)}`,
        say: {
          full: `14 CFR 91.151 says a VFR flight must be able to reach its first point of intended landing with **30 minutes** of fuel left by day, **45** at night, at normal cruise. That is the **legal** reserve: the least you may plan to land with. It assumes the forecast wind, the book fuel burn and a straight-in landing. Pilots who run out of fuel were almost always legal on paper. This course plans to land with **${REAL_RESERVE_MIN} minutes**, a **real** reserve, and checks the fuel against the clock in the air.`,
          short: `Legal is 30 minutes by day. Plan to land with ${REAL_RESERVE_MIN}.`,
        },
        figure: { kind: 'chart', route: [from.id, to.id], highlight: [to.id] },
      },
      {
        kind: 'example', id: 'e1', title: 'Fuel in still air',
        say: {
          full: `First the trip with no wind at all, at ${p.cruise.tasKt} knots true and ${p.cruise.gph} gallons an hour. Fuel is planned in pieces: taxi and run-up, the climb at its higher burn, the cruise, then the reserve on top. ${perfNote(ap)}`,
          short: 'Taxi, climb, cruise, then the reserve on top.',
        },
        figure: { kind: 'navlog', log: still },
        work: [
          { label: 'Taxi and run-up', value: `${stillPlan.taxiGal} gal` },
          { label: `Climb, ${CLIMB_MIN} min`, value: `${stillPlan.climbGal} gal`, note: `At ${p.climbGph} gph` },
          { label: `Cruise, ${still.totalMin} min`, value: `${stillPlan.cruiseGal} gal`, note: `${leg.distanceNm} nm at ${p.cruise.tasKt} kt, ${p.cruise.gph} gph` },
          { label: 'Legal reserve, 30 min', value: `${stillPlan.reserveGal} gal` },
          { label: 'Required', value: `${stillPlan.requiredGal} gal` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now with the forecast wind: from ${String(windFrom).padStart(3, '0')}° true at ${FORECAST_WIND_KT} knots, on a true course of ${String(tc).padStart(3, '0')}°, at ${p.cruise.tasKt} knots true. What is the groundspeed, how long is the leg, and how much fuel does the trip need with the legal reserve?`,
        figure: { kind: 'chart', route: [from.id, to.id], highlight: [to.id] },
        blanks: [
          { id: 'gs', label: 'Groundspeed', unit: 'kt', answer: leg.groundspeedKt, tolerance: 3,
            explain: `A ${Math.abs(windTriangle(tc, p.cruise.tasKt, windFrom, FORECAST_WIND_KT).headwindKt)} knot headwind component and a small correction angle: about ${leg.groundspeedKt} knots.` },
          { id: 'min', label: 'Time en route', unit: 'min', answer: leg.minutes, tolerance: 3,
            explain: `${leg.distanceNm} nm at ${leg.groundspeedKt} knots is about ${leg.minutes} minutes, ${leg.minutes - still.totalMin} more than in still air.` },
          { id: 'fuel', label: 'Fuel required, legal reserve', unit: 'gal', answer: req.legal.requiredGal, tolerance: 0.6,
            explain: `${req.legal.taxiGal} taxi + ${req.legal.climbGal} climb + ${req.legal.cruiseGal} cruise + ${req.legal.reserveGal} reserve = ${req.legal.requiredGal} gallons. A real reserve of ${REAL_RESERVE_MIN} minutes makes it ${req.real.requiredGal}.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'At the fuel truck',
        situation: `You and one passenger. The tanks dip at ${onBoard} gallons. The trip needs ${req.legal.requiredGal} with the legal reserve, ${req.real.requiredGal} with an hour. The fuel truck is right there, and you're already a little late.`,
        figure: { kind: 'navlog', log: fc },
        options: [
          { id: 'go', label: `Go with ${onBoard} gallons. It's legal.` },
          { id: 'top-off', label: 'Wait for the truck and top off.' },
          { id: 'cancel', label: 'Call it off for today.' },
        ],
        grades: grades1,
        consequence: {
          go: grades1.go === 'unsafe'
            ? `${onBoard} gallons doesn't cover the legal reserve. You land with ${landLine({ land: plannedLand })} if the forecast holds, which is less than the law allows you to plan.`
            : `Legal on paper: you'd land with ${landLine({ land: plannedLand })} if the forecast wind and the book burn both hold. Neither has to.`,
          'top-off': grades1['top-off'] === 'best'
            ? `Fifteen minutes for the truck. You land with ${landLine({ land: fullLand })}, more than the hour you plan for, and you're inside gross with two aboard.`
            : `Full tanks with two aboard doesn't work in ${ap.name}: ${loadStatus(ap, topOff)}`,
          cancel: 'Safe, but the fix was fifteen minutes and a fuel truck. Canceling a trip you could make well teaches the wrong lesson about what a reserve is for.',
        },
        why: `Legal needs ${req.legal.requiredGal} gallons and you have ${onBoard}. A real reserve needs ${req.real.requiredGal}. The gap between them is the margin for a stronger wind, a richer mixture or a go-around, and it costs only a wait for the truck.`,
      },
      {
        kind: 'brief', id: 'b2', title: 'Halfway',
        showIf: { step: 'd1', choices: ['go'] },
        scene: `Halfway, ${r1(half)} nm out. The GPS shows ${gs2} knots over the ground, not the ${leg.groundspeedKt} you planned: the wind up here is closer to ${ACTUAL_WIND_KT} knots than ${FORECAST_WIND_KT}.`,
        say: {
          full: `This is why you check fuel against the clock, not just the gauges. You have burned about ${r1(burnedHalf)} gallons and have about ${leftHalf} left. At this groundspeed the rest of the leg takes ${onward.min} minutes, and you'd land at ${to.name} with ${landLine(onward)}. Do the arithmetic before you decide, not after.`,
          short: `About ${leftHalf} gallons left, ${onward.min} minutes to go.`,
        },
        figure: { kind: 'chart', route: [from.id, to.id], marker: { pos: midpoint, altMsl: 4500, label: 'You' } },
      },
      {
        kind: 'decide', id: 'd2', title: 'Continue or land for fuel?',
        showIf: { step: 'd1', choices: ['go'] },
        situation: `About ${leftHalf} gallons aboard. ${to.name}: ${onward.nm} nm, ${onward.min} minutes, landing with ${landLine(onward)}. ${stopName}, which sells fuel: ${fuelStop.nm} nm, ${fuelStop.min} minutes. ${noFuel.name}, which has no fuel: ${noFuel.nm} nm, ${noFuel.min} minutes.`,
        figure: { kind: 'chart', route: [from.id, to.id], highlight: [fuelStop.id, noFuel.id], marker: { pos: midpoint, altMsl: 4500, label: 'You' } },
        options: [
          { id: 'continue', label: `Continue to ${to.name}. The gauges still show fuel.` },
          { id: 'divert', label: `${fuelStop.id === from.id ? 'Turn back' : 'Divert'} to ${stopName} and buy fuel.` },
          { id: 'land-near', label: `Land at ${noFuel.name} and sort it out on the ground.` },
        ],
        grades: grades2,
        consequence: {
          continue: grades2.continue === 'unsafe'
            ? `You land at ${to.name} with ${landLine(onward)}, under the legal reserve, and only if nothing else goes wrong. A go-around or a busy pattern and it is a forced landing.`
            : `You land at ${to.name} with ${landLine(onward)}. It worked, with less than you planned to keep.`,
          divert: `${fuelStop.id === from.id ? 'You turn back with the wind behind you' : 'You divert'} and land at ${stopName} with ${landLine(fuelStop)}. Fill up, call ahead, and try again with the real wind in the plan.`,
          'land-near': `You land at ${noFuel.name} with ${landLine(noFuel)}. Safe on the ground, but with no fuel there the airplane stays until someone brings some.`,
        },
        why: `At ${gs2} knots the destination leaves you ${onward.land.min} minutes of fuel; ${fuelStop.id} leaves ${fuelStop.land.min}. The decision is made with arithmetic at the halfway point, while there are still choices.`,
      },
    ];
    return steps;
  },
};

export const performanceLessons: Lesson[] = [passengers, hotAfternoon, shortStrip, fuelReserve];
