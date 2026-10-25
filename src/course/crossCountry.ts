// Module 5, Cross-country and diversion: five flights on the practice
// sectional (chart/practiceRegion.ts), so the geometry is the same for every
// pilot and never a real place. The airplane is the pilot's own when they
// have entered it, otherwise the labeled sample trainer. Every number in the
// copy comes from the nav and performance engine, and every grade from
// scenarios/crossCountry.ts.

import { practiceRegion as R, maxElevationFigure, type Region } from '../chart/practiceRegion';
import { lakesRegion } from '../chart/lakesRegion';
import type { RegionId } from '../chart/regions';
import { climbRate, fuelPlan, tempAtAltitude, vfrReserveMin } from '../lib/perf';
import { destination, distanceNm, navLog, trueCourse, vfrCruisingAltitudes, type NavLog } from '../lib/nav';
import { norm } from '../lib/wind';
import {
  alongTrack, deadReckon, diversionFacts, fbGroup, fitsTheClock, gradeCruiseAltitudes, gradeDiversion, gradeFuelPlan, gradeLost, gradeSighting,
  legTo, minutesToClearanceAirspace, navPoint, windAt, xcAirplane, RUNWAY_FACTOR,
  type DiversionFacts, type DiversionField, type WindAloft, type XcAirplane,
} from '../scenarios/crossCountry';
import type { Grade } from '../scenarios/goNoGo';
import { addHours, wholeHourAfter } from './practice';
import type { Lesson, LessonContext, Option } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const deg = (n: number) => String(Math.round(norm(n)) || 360).padStart(3, '0');
const local = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const round100 = (n: number) => Math.round(n / 100) * 100;
const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

const VAR = R.variationDeg;
const varText = (v: number) => `${Math.abs(v)}° ${v < 0 ? 'west' : 'east'}`;
/** Practice altimeter and surface temperature for the whole module. */
const ALTIMETER = 29.92;
const SURFACE_C = 18;

const HOME = 'KXYZ';
const DEST = 'KXQA';
const ROUTE = [HOME, 'harlow', 'long-lake', 'pinecrest', DEST];
const point = (id: string, region: Region = R) => navPoint(region, id);
const chartAirport = (id: string, region: Region = R) => region.airports.find((a) => a.id === id);
/** How copy names a place: the practice field by what it is, everything else by its chart name. */
const nameOf = (id: string) => (id === HOME ? 'the practice field' : point(id).name);
const NameOf = (id: string) => nameOf(id).replace(/^the /, 'The ');

/** Winds aloft at the practice station, as an FB forecast gives them. Practice data. */
const WINDS: WindAloft[] = [
  { altFt: 3000, dirTrue: 280, speedKt: 10, tempC: null },
  { altFt: 6000, dirTrue: 290, speedKt: 22, tempC: 4 },
  { altFt: 9000, dirTrue: 290, speedKt: 30, tempC: -1 },
];
/** A different day: an easterly flow aloft, a tailwind for the westbound trip. Practice data. */
const WINDS_EAST: WindAloft[] = [
  { altFt: 3000, dirTrue: 80, speedKt: 8, tempC: null },
  { altFt: 6000, dirTrue: 90, speedKt: 18, tempC: 6 },
  { altFt: 9000, dirTrue: 100, speedKt: 26, tempC: 1 },
];
/** What the wind actually does on the day: the same direction, fifteen knots more than forecast. */
const surprise = (w: { dirTrue: number; speedKt: number }) => ({ dirTrue: w.dirTrue, speedKt: w.speedKt + 15 });

function sampleLine(p: XcAirplane): string {
  return p.sample ? ` The airplane numbers are **sample values** (${fmt(p.perf.cruise.tasKt)} knots, ${fmt1(p.perf.cruise.gph)} gallons an hour, ${fmt(p.usableGal)} gallons usable), not your POH.` : '';
}

function chartLine(ctx: LessonContext): string {
  return ctx.practiceField
    ? 'This flight is on the practice sectional, a made-up chart around the practice field.'
    : 'This module flies on the practice sectional, a made-up chart, so the route is the same for everyone. Your own numbers fly it.';
}

function log(p: XcAirplane, wind: { dirTrue: number; speedKt: number }, route = ROUTE, region: Region = R): NavLog {
  return navLog(route.map((id) => point(id, region)), { tasKt: p.perf.cruise.tasKt, windFromTrue: wind.dirTrue, windKt: wind.speedKt, variationDeg: region.variationDeg, gph: p.perf.cruise.gph });
}

/** Box around a route, a few miles wide, for the maximum elevation figure and the lowest ground. */
function routeBox(route: string[], region: Region = R) {
  const pts = route.map((id) => point(id, region));
  const pad = 0.08;
  return {
    sw: { lat: Math.min(...pts.map((p) => p.lat)) - pad, lon: Math.min(...pts.map((p) => p.lon)) - pad },
    ne: { lat: Math.max(...pts.map((p) => p.lat)) + pad, lon: Math.max(...pts.map((p) => p.lon)) + pad },
  };
}

/** Lowest ground under the route en route, leaving out the climb and descent near each end. */
function lowestGround(route: string[], endsNm = 5, region: Region = R): number {
  const pts = route.map((id) => point(id, region));
  const total = pts.slice(1).reduce((n, q, i) => n + distanceNm(pts[i], q), 0);
  let low = Infinity;
  let flown = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const tc = trueCourse(pts[i], pts[i + 1]);
    const d = distanceNm(pts[i], pts[i + 1]);
    for (let k = 0; k <= 10; k++) {
      const at = flown + (d * k) / 10;
      if (at >= endsNm && at <= total - endsNm) low = Math.min(low, region.groundFt(destination(pts[i], tc, (d * k) / 10)));
    }
    flown += d;
  }
  return low;
}

export interface RoutePlan {
  mefFt: number;
  /** The lowest legal cruising altitude at least 1,000 ft over the MEF. */
  cruiseFt: number;
  climbMin: number;
}

export function routePlan(p: XcAirplane, route = ROUTE, region: Region = R): RoutePlan {
  const { sw, ne } = routeBox(route, region);
  const mefFt = maxElevationFigure(region, sw, ne);
  const still = log(p, { dirTrue: 0, speedKt: 0 }, route, region);
  const westbound = still.legs.every((l) => l.magCourse >= 180);
  const cruiseFt = vfrCruisingAltitudes(westbound ? 270 : 90, mefFt + 1000, 17500)[0];
  const field = chartAirport(route[0], region)!.elevationFt;
  const midFt = (field + cruiseFt) / 2;
  const fpm = climbRate(p.perf, midFt, tempAtAltitude(SURFACE_C, field, midFt)).value;
  return { mefFt, cruiseFt, climbMin: Math.ceil((cruiseFt - field) / Math.max(fpm, 100)) };
}

const option = (id: string, label: string): Option => ({ id, label });

/** The nav log trip: the first chart out west to Quill Valley, or the lake country north into the mountains. */
function navTrip(v: number): { region: Region; regionId: RegionId; home: string; dest: string; route: string[] } {
  if (v === 2) return { region: lakesRegion, regionId: 'lakes', home: 'KWVA', dest: 'KWSL', route: ['KWVA', 'ashby', 'sable-lake', 'notch', 'KWSL'] };
  return { region: R, regionId: 'practice', home: HOME, dest: DEST, route: ROUTE };
}

// ---------------------------------------------------------------- 5.1

const navLogLesson: Lesson = {
  id: '5.1', module: 5, minutes: 18,
  title: 'Building a nav log',
  summary: 'Measure a route on the chart, turn true courses into magnetic, work time and fuel for each leg, and plan the fuel for the trip home.',
  acs: ['PA.I.D'],
  refs: ['PHAK, flight planning', '14 CFR 91.159', '14 CFR 91.151'],
  variants: 3,
  build(ctx) {
    // The second situation: the destination's self-serve pump is out by NOTAM.
    const pumpOut = ctx.variant === 1;
    // The third flies the second practice sectional, into the mountains to a field with no fuel.
    const t = navTrip(ctx.variant ?? 0);
    const G = t.region;
    const VAR = G.variationDeg;
    const VAR_TEXT = varText(VAR);
    const p = xcAirplane(ctx.aircraft);
    const still = log(p, { dirTrue: 0, speedKt: 0 }, t.route, G);
    const [l1, l2] = still.legs;
    const plan = routePlan(p, t.route, G);
    const dep = wholeHourAfter(ctx.now, 1);
    const dest = chartAirport(t.dest, G)!;
    const gph = p.perf.cruise.gph;
    const tas = p.perf.cruise.tasKt;

    // Out and back without refueling, climb counted at climb fuel flow on top of the cruise time.
    const trip = { climbMin: 2 * plan.climbMin, cruiseMin: 2 * still.totalMin, night: false };
    const need = fuelPlan(p.perf, { ...trip, onBoardGal: 0 }).requiredGal;
    const onBoard = Math.min(p.usableGal, Math.ceil(need + gph * 0.15));
    const tanks = fuelPlan(p.perf, { ...trip, onBoardGal: onBoard });
    const full = fuelPlan(p.perf, { ...trip, onBoardGal: p.usableGal });
    const fuelThere = dest.fuel && !pumpOut;
    const grades = gradeFuelPlan({ plan: tanks, fullPlan: full, gph, destinationHasFuel: fuelThere });
    const reserveMin = vfrReserveMin(false);
    // The trip home with ten knots more headwind than planned.
    const homeHead = Math.round((still.totalNm / Math.max(tas - 10, 1)) * 60);
    const extraGal = Math.round((((homeHead - still.totalMin) * gph) / 60) * 10) / 10;
    const leftMin = Math.round(((tanks.marginGal + tanks.reserveGal - extraGal) / gph) * 60);
    const westbound = l2.magCourse >= 180;
    const hemisphere = westbound ? 'Even thousands plus 500' : 'Odd thousands plus 500';
    const chart = { kind: 'chart' as const, region: t.regionId, route: t.route };

    const fuelText = (g: Grade) =>
      g === 'unsafe' ? `Out and back on ${fmt(onBoard)} gallons lands you below the ${reserveMin} minute reserve. Not legal.`
        : g === 'marginal' ? `Legal on paper: ${fmt1(tanks.marginGal)} gallons over the reserve. On the way home the headwind is ten knots stronger than forecast, the trip takes ${homeHead - still.totalMin} minutes longer, and you land with about ${Math.max(leftMin, 0)} minutes of fuel. Inside the rule, outside any margin you would choose.`
          : `With ${fmt(onBoard)} gallons you land with ${fmt1(tanks.marginGal)} gallons over the reserve, enough to absorb a stronger headwind.`;

    return [
      {
        kind: 'brief', id: 'b1', title: `A trip to ${dest.name}`,
        scene: `${chartLine(ctx)} You're taking ${p.name} from ${t.home} to ${dest.name} (${t.dest}) and back, wheels up around ${local(dep)}.${sampleLine(p)}`,
        say: {
          full: `A nav log is the flight flown once on paper. Draw the course line, pick **checkpoints** you will recognize from the air (here ${t.route.slice(1, -1).map((id) => point(id, G).name).join(', ')}), then for each leg write down the **true course** from the chart, turn it into a **magnetic course**, and work **distance**, **time** and **fuel**. This lesson does it in still air. The next lesson adds the wind.`,
          short: 'True course, magnetic course, distance, time, fuel, leg by leg.',
        },
        figure: chart,
      },
      {
        kind: 'example', id: 'e1', title: `Leg 1: ${t.home} to ${l1.to.name}`,
        say: {
          full: `The plotter gives the true course against a meridian. Variation on this chart is ${VAR_TEXT}, so magnetic is ${VAR < 0 ? '**more**' : '**less**'} than true: "east is least, west is best." Distance comes off the plotter's scale. With no wind, time is distance over true airspeed, and fuel is time times fuel flow.`,
          short: `Variation ${VAR_TEXT}. Time is distance over speed.`,
        },
        figure: { kind: 'navlog', log: { ...still, legs: [l1], totalNm: l1.distanceNm, totalMin: l1.minutes, totalFuelGal: l1.fuelGal } },
        work: [
          { label: 'True course', value: `${deg(l1.trueCourse)}°`, note: 'Measured on the chart' },
          { label: 'Variation', value: VAR_TEXT, note: `${deg(l1.trueCourse)} ${VAR < 0 ? '+' : '−'} ${Math.abs(VAR)}` },
          { label: 'Magnetic course', value: `${deg(l1.magCourse)}°` },
          { label: 'Distance', value: `${fmt1(l1.distanceNm)} nm` },
          { label: 'Time', value: `${l1.minutes} min`, note: `${fmt1(l1.distanceNm)} nm at ${fmt(tas)} knots` },
          { label: 'Fuel', value: `${fmt1(l1.fuelGal)} gal`, note: `${l1.minutes} minutes at ${fmt1(gph)} gallons an hour` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Leg 2, ${l2.from.name} to ${l2.to.name}: the true course measures ${deg(l2.trueCourse)}° and the distance ${fmt1(l2.distanceNm)} nm. What is the magnetic course, how long does it take at ${fmt(tas)} knots, and which cruising altitudes does that course fly above 3,000 feet AGL?`,
        figure: chart,
        blanks: [
          { id: 'mc', label: 'Magnetic course', unit: '°', answer: l2.magCourse, tolerance: 1,
            explain: `${deg(l2.trueCourse)}° true with ${VAR_TEXT} variation is ${deg(l2.magCourse)}° magnetic.` },
          { id: 'min', label: 'Time', unit: 'min', answer: l2.minutes, tolerance: 1,
            explain: `${fmt1(l2.distanceNm)} nm at ${fmt(tas)} knots is ${l2.minutes} minutes.` },
          { id: 'alt', label: 'Cruising altitudes', answer: hemisphere, choices: ['Odd thousands plus 500', 'Even thousands plus 500'],
            explain: `91.159 goes by **magnetic course**: 0 to 179 flies odd thousands plus 500, 180 to 359 even. ${deg(l2.magCourse)}° is ${westbound ? 'westbound: even' : 'eastbound: odd'}. Over this route that makes ${fmt(plan.cruiseFt)} feet the lowest one a thousand feet clear of the ${fmt(plan.mefFt)} foot maximum elevation figure.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Fuel for the trip home',
        situation: `The whole log: ${fmt1(still.totalNm)} nm and ${still.totalMin} minutes each way, ${plan.climbMin} minutes of climb each time you depart. Out and back nonstop needs ${fmt1(tanks.requiredGal)} gallons including the ${reserveMin} minute day reserve. There are ${fmt(onBoard)} gallons in the tanks, ${fmt(p.usableGal)} when full. ${pumpOut ? `${dest.name} usually sells fuel, but the NOTAMs say: SELF SERVE FUEL UNAVBL.` : `${dest.name} ${dest.fuel ? 'sells fuel' : 'has no fuel'}.`}`,
        figure: { kind: 'navlog', log: still, altitudeMsl: plan.cruiseFt },
        options: [
          option('nonstop', 'Go as fueled and fly home nonstop. It is legal.'),
          option('top-off', 'Top off before leaving.'),
          option('fuel-stop', `Go as fueled and buy fuel at ${dest.name} before the trip home.`),
          option('shorter', 'Pick a shorter trip today.'),
        ],
        grades,
        consequence: {
          nonstop: fuelText(grades.nonstop),
          'top-off': grades['top-off'] === 'unsafe' || grades['top-off'] === 'marginal'
            ? `Full tanks still leave only ${fmt1(full.marginGal)} gallons over the reserve for the round trip. This trip needs a fuel stop.`
            : `Full tanks give ${fmt1(full.marginGal)} gallons over the reserve for the round trip. Check the weight and balance with full fuel and you're done.`,
          'fuel-stop': fuelThere
            ? `You land at ${dest.name} with plenty, buy fuel, and fly home with a full reserve and then some. A fuel stop is part of the plan, not an admission.`
            : pumpOut
              ? `You land at ${dest.name} and the pump has a bag over it, as the NOTAM said. Now the trip home is on what is left in the tanks. Plan around the NOTAMs, not around what the field usually has.`
              : `${dest.name} has no fuel. Check the chart supplement before you plan a stop.`,
          shorter: 'Safe, but the trip worked. Fixing the fuel was the skill here.',
        },
        why: `${pumpOut ? 'A fuel stop only counts if the fuel is really there: the NOTAMs, a call to the FBO, or the chart supplement\'s hours tell you. ' : ''}${reserveMin} minutes is the legal floor for day VFR (91.151), at normal cruise. A plan that lands with less than another half hour on top is legal but has nowhere to put a stronger headwind, a vector or a go-around.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 5.2

const ALT_OPTIONS = [3500, 4500, 5500, 6500];

const windsAloft: Lesson = {
  id: '5.2', module: 5, minutes: 18,
  title: 'Winds aloft and groundspeed',
  summary: 'Read a winds aloft forecast, interpolate to your altitude, solve the wind triangle, and choose the altitude that gets you there legally and soonest.',
  acs: ['PA.I.D', 'PA.I.C'],
  refs: ['Aviation Weather Handbook, winds aloft', 'PHAK, wind triangle', '14 CFR 91.159'],
  variants: 2,
  build(ctx) {
    // The usual westerly headwind, or a day the flow aloft turns easterly and helps.
    const winds = ctx.variant === 1 ? WINDS_EAST : WINDS;
    const p = xcAirplane(ctx.aircraft);
    const tas = p.perf.cruise.tasKt;
    const plan = routePlan(p);
    const fb = `XYZ ${winds.map(fbGroup).join(' ')}`;
    const at = (alt: number) => windAt(winds, alt);
    const w45 = at(plan.cruiseFt);
    const leg45 = log(p, w45).legs[0];
    const turnAlt = plan.cruiseFt + 2000;
    const wT = at(turnAlt);
    const legT = log(p, wT).legs[0];
    const options = ALT_OPTIONS.map((alt) => ({ altFt: alt, minutes: log(p, at(alt)).totalMin }));
    const grades = gradeCruiseAltitudes({ options, magCourses: log(p, w45).legs.map((l) => l.magCourse), lowestGroundFt: lowestGround(ROUTE), mefFt: plan.mefFt });
    const byAlt = Object.fromEntries(options.map((o) => [o.altFt, o.minutes]));
    const id = (alt: number) => `alt-${alt}`;
    const below = (alt: number) => winds.filter((w) => w.altFt <= alt).slice(-1)[0] ?? winds[0];
    const above = (alt: number) => winds.find((w) => w.altFt > alt) ?? winds[winds.length - 1];
    const headwind = Math.round(wT.speedKt * Math.cos(((wT.dirTrue - legT.trueCourse) * Math.PI) / 180));
    const [lo, hi] = [below(turnAlt), above(turnAlt)];
    const [loEx, hiEx] = [below(plan.cruiseFt), above(plan.cruiseFt)];

    const consequence: Record<string, string> = {};
    for (const o of options) {
      const g = grades[o.altFt];
      const legal = g !== 'unsafe';
      consequence[id(o.altFt)] = !legal
        ? `${fmt(o.altFt)} is a wrong-way altitude: your magnetic courses are westbound, which fly even thousands plus 500 more than 3,000 feet above the ground. Eastbound traffic is at odd thousands plus 500, coming the other way at your altitude.`
        : g === 'marginal'
          ? `Quick, ${mins(o.minutes)}, but ${fmt(o.altFt)} is less than 1,000 feet over the ${fmt(plan.mefFt)} foot maximum elevation figure. Over the hills and past the lighted tower that leaves no room for a downdraft, a lower ceiling, or an engine problem.`
          : g === 'best'
            ? `${o.minutes} minutes en route, legal for the course, and at least 1,000 feet over everything on the route. The best mix of time and margin today.`
            : `Legal and clear of the terrain, but the wind at ${fmt(o.altFt)} makes it ${o.minutes} minutes, ${o.minutes - Math.min(...options.filter((x) => grades[x.altFt] === 'best').map((x) => x.minutes))} more than the best choice.`;
    }

    return [
      {
        kind: 'brief', id: 'b1', title: 'The wind up there',
        scene: `Same trip to ${nameOf(DEST)}. The practice winds aloft forecast for the area reads: **${fb}** (3,000, 6,000 and 9,000 feet).${sampleLine(p)}`,
        say: {
          full: 'Winds aloft come in four digits per altitude: the first two are the direction in tens of degrees **true**, the next two the speed in knots, then the temperature from 6,000 feet up. There is no 3,000 foot temperature, and no wind at all for a level within 1,500 feet of the station. Your altitude is usually between two levels, so you **interpolate**: a straight line between them. Your share of the way is how far you are above the lower level over the gap to the next: 500 feet above 6,000 is 500 of 3,000, one sixth. Then the wind triangle starts from the **true course** and true airspeed.',
          short: 'Direction true in tens, speed in knots, temperature. Interpolate between levels.',
        },
      },
      {
        kind: 'example', id: 'e1', title: `Leg 1 at ${fmt(plan.cruiseFt)}`,
        say: {
          full: `${fmt(plan.cruiseFt)} sits ${Math.round(((plan.cruiseFt - loEx.altFt) / (hiEx.altFt - loEx.altFt)) * 100)} percent of the way from ${fmt(loEx.altFt)} to ${fmt(hiEx.altFt)}, so take that share of the change in direction and speed. Then the wind triangle: the wind correction angle turns the nose into the wind, and the headwind part of it comes off the groundspeed.`,
          short: 'Interpolate, then the wind triangle.',
        },
        figure: { kind: 'navlog', log: { ...log(p, w45), legs: [leg45], totalNm: leg45.distanceNm, totalMin: leg45.minutes, totalFuelGal: leg45.fuelGal }, altitudeMsl: plan.cruiseFt },
        work: [
          { label: `${fmt(loEx.altFt)} ft`, value: fbGroup(loEx), note: `${deg(loEx.dirTrue)}° true at ${loEx.speedKt} kt` },
          { label: `${fmt(hiEx.altFt)} ft`, value: fbGroup(hiEx), note: `${deg(hiEx.dirTrue)}° true at ${hiEx.speedKt} kt${hiEx.tempC !== null ? `, ${hiEx.tempC}°C` : ''}` },
          { label: `${fmt(plan.cruiseFt)} ft`, value: `${deg(w45.dirTrue)}° at ${w45.speedKt} kt`, note: 'Interpolated' },
          { label: 'True course', value: `${deg(leg45.trueCourse)}°` },
          { label: 'Wind correction', value: `${signed(leg45.wcaDeg)}°`, note: leg45.wcaDeg === 0 ? 'Wind on the nose or tail' : `Into the wind, to the ${leg45.wcaDeg > 0 ? 'right' : 'left'}` },
          { label: 'Magnetic heading', value: `${deg(leg45.magHeading)}°`, note: `True heading ${deg(leg45.trueHeading)}°, plus variation` },
          { label: 'Groundspeed', value: `${leg45.groundspeedKt} kt`, note: `True airspeed ${fmt(tas)}` },
          { label: 'Time', value: `${leg45.minutes} min`, note: `${fmt1(leg45.distanceNm)} nm` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now the same leg at ${fmt(turnAlt)}. What wind do you interpolate, and what magnetic heading and groundspeed does it give? Use an E6B or the wind side of your flight computer app.`,
        blanks: [
          { id: 'wdir', label: `Wind direction at ${fmt(turnAlt)}`, unit: '° true', answer: wT.dirTrue, tolerance: 5,
            explain: `${fmt(turnAlt)} is between ${fmt(lo.altFt)} (${deg(lo.dirTrue)}°) and ${fmt(hi.altFt)} (${deg(hi.dirTrue)}°): about ${deg(wT.dirTrue)}°.` },
          { id: 'wspd', label: `Wind speed at ${fmt(turnAlt)}`, unit: 'kt', answer: wT.speedKt, tolerance: 1,
            explain: `From ${lo.speedKt} to ${hi.speedKt} knots over ${fmt(hi.altFt - lo.altFt)} feet; at ${fmt(turnAlt)} about ${wT.speedKt}.` },
          { id: 'mh', label: 'Magnetic heading', unit: '°', answer: legT.magHeading, tolerance: 2,
            explain: `True course ${deg(legT.trueCourse)}°, wind correction ${signed(legT.wcaDeg)}°, true heading ${deg(legT.trueHeading)}°, plus ${Math.abs(VAR)}° west: ${deg(legT.magHeading)}°.` },
          { id: 'gs', label: 'Groundspeed', unit: 'kt', answer: legT.groundspeedKt, tolerance: 3,
            explain: headwind >= 0
              ? `${fmt(tas)} knots true into a ${headwind} knot headwind component is about ${legT.groundspeedKt} over the ground.`
              : `${fmt(tas)} knots true with a ${-headwind} knot tailwind component is about ${legT.groundspeedKt} over the ground.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Which altitude?',
        situation: `Your nav log, worked at each altitude with its interpolated wind: ${options.map((o) => `${fmt(o.altFt)} takes ${o.minutes} minutes`).join(', ')}. The maximum elevation figure along the route is ${fmt(plan.mefFt)} feet.`,
        figure: { kind: 'chart', route: ROUTE, highlight: [...ROUTE, 'tower-1749'] },
        options: options.map((o) => option(id(o.altFt), `${fmt(o.altFt)} feet, ${byAlt[o.altFt]} minutes`)),
        grades: Object.fromEntries(options.map((o) => [id(o.altFt), grades[o.altFt]])),
        consequence,
        keepOrder: true,
        why: `Three things pick a cruising altitude: the hemispheric rule (91.159) when you are more than 3,000 feet above the ground, a margin over the highest terrain and obstacles, and then the wind. Legal and clear come before fast.${ctx.variant === 1 ? ' With the wind behind you and growing with height, the higher legal altitude pays for its climb.' : ' Into a wind that grows with height, the lowest altitude with margin is usually quickest.'}`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 5.3

/** The flight as it actually goes: planned with the forecast, flown in a stronger wind. */
function flownPlan(p: XcAirplane) {
  const plan = routePlan(p);
  const forecast = windAt(WINDS, plan.cruiseFt);
  const actual = surprise(forecast);
  const planned = log(p, forecast);
  const real = log(p, actual);
  return { plan, forecast, actual, planned, real };
}

const checkpoints: Lesson = {
  id: '5.3', module: 5, minutes: 15,
  title: 'Checkpoints and pilotage',
  summary: 'Time each checkpoint, work out the groundspeed you are really getting, and refuse a landmark that does not fit the clock.',
  acs: ['PA.VI.A'],
  refs: ['PHAK, pilotage and dead reckoning'],
  variants: 2,
  build(ctx) {
    // The lake under the wing: a pond a third of the way along, or the real one, on time.
    const onTime = ctx.variant === 1;
    const p = xcAirplane(ctx.aircraft);
    const { plan, planned, real } = flownPlan(p);
    const dep = wholeHourAfter(ctx.now, 1);
    const [p1, p2, p3] = planned.legs;
    const r1 = real.legs[0];
    // You leave the overhead at departure time; time over Harlow is what the stronger wind gives.
    const overHarlow = addHours(dep, r1.minutes / 60);
    const gsMeasured = Math.round((r1.distanceNm / r1.minutes) * 60);
    const toLake = Math.round((p2.distanceNm / gsMeasured) * 60);
    const remainingNm = planned.legs.slice(1).reduce((n, l) => n + l.distanceNm, 0);
    const toDest = Math.round((remainingNm / gsMeasured) * 60);
    // The lake that isn't Long Lake: under the wing a third of the way along the leg.
    const sightMin = onTime ? toLake : Math.max(2, Math.round(toLake / 3));
    const clock = fitsTheClock({ gsKt: gsMeasured, minutes: sightMin, checkpointAlongNm: p2.distanceNm });
    const grades = gradeSighting(clock.fits);
    const tower = R.obstacles.find((o) => o.id === 'tower-1749')!;
    const tw = alongTrack(p2.from, p2.to, tower.pos);
    const towerMin = Math.round((tw.alongNm / gsMeasured) * 60);
    const turnAngle = Math.abs(((p3.trueCourse - p2.trueCourse + 540) % 360) - 180);
    const offsetNm = Math.round((p2.distanceNm - clock.expectedNm) * Math.sin((turnAngle * Math.PI) / 180) * 10) / 10;
    let eta = dep;
    const etas = planned.legs.map((l) => (eta = addHours(eta, l.minutes / 60)));

    return [
      {
        kind: 'brief', id: 'b1', title: 'The clock is a checkpoint too',
        scene: `${chartLine(ctx)} You're level at ${fmt(plan.cruiseFt)} on the way to ${nameOf(DEST)}, over the field at ${local(dep)} with the nav log from the last lesson.${sampleLine(p)}`,
        say: {
          full: '**Pilotage** is flying by what you see: the chart in your lap, the ground out the window. **Dead reckoning** is flying by heading, speed and time. They check each other. Write down the time over every checkpoint, compare it with the log, and you know your real groundspeed and when the next checkpoint is due. A landmark that shows up at the wrong time is probably the wrong landmark.',
          short: 'Time every checkpoint. The clock says where to look.',
        },
        figure: { kind: 'chart', route: ROUTE, highlight: ROUTE },
      },
      {
        kind: 'example', id: 'e1', title: 'Planned times over each checkpoint',
        say: {
          full: `From the departure time, add each leg's minutes to get the time you expect over each checkpoint. These go in the log before you start the engine, so in the air you only compare.`,
          short: 'Departure plus each leg.',
        },
        figure: { kind: 'navlog', log: planned, altitudeMsl: plan.cruiseFt },
        work: [
          { label: 'Overhead', value: local(dep), note: `${HOME}, setting course` },
          ...planned.legs.map((l, i) => ({ label: l.to.name, value: local(etas[i]), note: `${l.minutes} minutes at ${l.groundspeedKt} knots` })),
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `You cross ${p1.to.name} at ${local(overHarlow)}, ${mins(r1.minutes - p1.minutes)} later than planned. The leg was ${fmt1(r1.distanceNm)} nm. What groundspeed are you really getting, and at that speed how many minutes to ${p2.to.name} (${fmt1(p2.distanceNm)} nm) and to ${nameOf(DEST)} (${fmt1(remainingNm)} nm)?`,
        figure: { kind: 'chart', route: ROUTE, highlight: [p1.to.id, p2.to.id] },
        blanks: [
          { id: 'gs', label: 'Groundspeed', unit: 'kt', answer: gsMeasured, tolerance: 3,
            explain: `${fmt1(r1.distanceNm)} nm in ${r1.minutes} minutes is ${gsMeasured} knots, not the ${p1.groundspeedKt} you planned. The wind is stronger than forecast.` },
          { id: 'lake', label: `Minutes to ${p2.to.name}`, unit: 'min', answer: toLake, tolerance: 1,
            explain: `${fmt1(p2.distanceNm)} nm at ${gsMeasured} knots: ${toLake} minutes.` },
          { id: 'dest', label: `Minutes to ${nameOf(DEST)}`, unit: 'min', answer: toDest, tolerance: 2,
            explain: `${fmt1(remainingNm)} nm at ${gsMeasured} knots: ${toDest} minutes. Check that against the fuel too.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'A lake under the wing',
        situation: `${mins(sightMin)} past ${p1.to.name} a narrow lake slides under the left wing${onTime ? ', with a dam at its south end' : ''}. The next line on your log is the turn to ${p3.to.name}.`,
        figure: { kind: 'chart', route: ROUTE, focus: { id: p2.to.id, radiusNm: 14 }, marker: { pos: destination(p2.from, p2.trueCourse, clock.expectedNm), altMsl: plan.cruiseFt, label: 'Dead reckoning' } },
        options: [
          option('turn-now', `It's ${p2.to.name}. Turn to the ${p3.to.name} heading.`),
          option('hold-heading', toLake > sightMin ? `Hold heading. ${p2.to.name} isn't due for another ${mins(toLake - sightMin)}.` : `Hold heading a little longer, in case it's another lake.`),
          option('circle', 'Circle the lake and compare its shape with the chart.'),
        ],
        grades,
        consequence: {
          'turn-now': clock.fits
            ? `It fits: ${fmt1(clock.expectedNm)} nm flown and ${p2.to.name} is ${fmt1(p2.distanceNm)} along. You note the time, turn to the ${p3.to.name} heading, and work the next ETA from the groundspeed you measured.`
            : `You turn ${fmt1(p2.distanceNm - clock.expectedNm)} nm early, onto a line about ${fmt1(offsetNm)} nm off the one on your chart. ${p3.to.name} doesn't show up on time, nothing else matches either, and the next lesson but one starts here.`,
          'hold-heading': clock.fits
            ? `The lake fit the chart and the clock, and the dam was where it should be. Every minute you hold heading now carries you further past the turn, and you will have to find your way back to the line. Refusing a good fix costs time, just as taking a wrong one does.`
            : `At ${mins(towerMin)} past ${p1.to.name} the lighted tower passes off your ${tw.crossNm < 0 ? 'left' : 'right'}, where the chart puts it, and ${p2.to.name}, with the dam at its south end, slides under you right on the new time. The first lake was a pond the chart doesn't bother with.`,
          circle: 'You learn it is the wrong lake, which is useful, at the cost of a few minutes and some fuel, with your heading and time to rebuild afterwards. Holding heading would have told you the same thing for free.',
        },
        why: clock.fits
          ? `At ${gsMeasured} knots, ${mins(sightMin)} puts you ${fmt1(clock.expectedNm)} nm past ${p1.to.name}, and ${p2.to.name} is ${fmt1(p2.distanceNm)} nm along. Chart and clock agree, and the dam confirms it. Take the fix and turn on time.`
          : `At ${gsMeasured} knots, ${mins(sightMin)} puts you ${fmt1(clock.expectedNm)} nm past ${p1.to.name}. ${p2.to.name} is ${fmt1(p2.distanceNm)} nm along: ${fmt1(clock.offByNm)} nm from where you are. A checkpoint has to match the chart **and** the clock.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 5.4

const DIVERT_IDS: { field: string; option: string }[] = [
  { field: HOME, option: 'home' },
  { field: 'KXRB', option: 'ridgeback' },
  { field: '2X5', option: 'mill-pond' },
  { field: DEST, option: 'press-on' },
];

function divertField(id: string): DiversionField {
  const a = chartAirport(id)!;
  return { id: a.id, name: a.name, pos: a.pos, elevationFt: a.elevationFt, runwayFt: a.runwayFt, surface: a.surface, fuel: a.fuel };
}

/** Where the showers are on the day, by situation: on the ridge ahead, or building over Ridgeback to the south. */
const DIVERT_WEATHER = [
  { from: 'pinecrest', bearing: 260, nm: 3, radiusNm: 8 },
  { from: 'KXRB', bearing: 0, nm: 0, radiusNm: 7 },
];

function divertSituation(p: XcAirplane, variant = 0) {
  const { plan, actual, real } = flownPlan(p);
  const [r1, r2, r3] = real.legs;
  const past = 4;
  const pos = destination(r3.from, r3.trueCourse, past);
  const elapsedMin = plan.climbMin + r1.minutes + r2.minutes + Math.round((past / r3.groundspeedKt) * 60);
  const fuelGal = Math.round((p.usableGal - p.perf.taxiFuelGal - (elapsedMin * p.perf.cruise.gph) / 60) * 10) / 10;
  const w = DIVERT_WEATHER[variant] ?? DIVERT_WEATHER[0];
  const weather = { center: destination(point(w.from), w.bearing, w.nm), radiusNm: w.radiusNm };
  const facts = diversionFacts({
    from: pos, fields: DIVERT_IDS.map((d) => divertField(d.field)), weather, perf: p.perf,
    tasKt: p.perf.cruise.tasKt, windFromTrue: actual.dirTrue, windKt: actual.speedKt, variationDeg: VAR,
    fuelOnBoardGal: fuelGal, surfaceTempC: SURFACE_C, altimeterInHg: ALTIMETER,
  });
  return { plan, actual, pos, fuelGal, weather, facts, grades: gradeDiversion(facts) };
}

function divertConsequence(f: DiversionFacts, g: Grade, all: DiversionFacts[], grades: Record<string, Grade>): string {
  const best = all.filter((x) => grades[x.field.id] === 'best');
  const where = `${NameOf(f.field.id)}: ${fmt1(f.leg.distanceNm)} nm, heading ${deg(f.leg.magHeading)}°, ${f.leg.minutes} minutes.`;
  if (f.intoWeather) return `${where} The line there runs through the showers. A diversion that flies into the reason for diverting isn't one.`;
  if (f.fuelMarginGal < 0) return `${where} You would land below the legal reserve.`;
  if (f.runwayFactor < 1) return `${where} Its ${fmt(f.field.runwayFt)} feet is shorter than the ${fmt(f.landingOver50Ft)} feet you need over a 50 foot obstacle.`;
  if (g === 'marginal') return `${where} Closest, but ${fmt(f.field.runwayFt)} feet of ${f.field.surface} against a ${fmt(f.landingOver50Ft)} foot landing over a 50 foot obstacle is only ${f.runwayFactor} times what you need, on a field you have never seen. Keep it in your pocket for an emergency, not a weather diversion.`;
  const after = `You land with ${fmt1(f.fuelMarginGal)} gallons over the reserve and ${fmt(f.field.runwayFt)} feet of ${f.field.surface} runway, ${f.runwayFactor} times your landing distance.${f.field.fuel ? '' : ' No fuel there, so you wait out the showers and fly home on what you have.'}`;
  if (g === 'best') return `${where} ${after}`;
  return `${where} A sound choice. ${best.length ? `${NameOf(best[0].field.id)} had you on the ground ${mins(f.leg.minutes - best[0].leg.minutes)} sooner.` : ''} ${after}`.trim();
}

const diversion: Lesson = {
  id: '5.4', module: 5, minutes: 18,
  title: 'The diversion, done in the air',
  summary: 'Turn away from weather ahead, estimate heading, distance and time to the fields around you, and pick the one that is really there for you.',
  acs: ['PA.VI.C'],
  refs: ['PHAK, flight diversion', '14 CFR 91.103, preflight action', '14 CFR 91.151'],
  variants: 2,
  build(ctx) {
    const p = xcAirplane(ctx.aircraft);
    const south = ctx.variant === 1;
    const { plan, actual, pos, fuelGal, facts, grades } = divertSituation(p, ctx.variant ?? 0);
    const by = (id: string) => facts.find((f) => f.field.id === id)!;
    const home = by(HOME);
    const turn = by('KXRB');
    const bases = Math.max(500, round100(ctx.minimums.ceilingFt - 1500));
    const marker = { pos, altMsl: plan.cruiseFt, label: 'You' };
    const ids = DIVERT_IDS.map((d) => d.field);
    const chart = { kind: 'chart' as const, highlight: [...ids, south ? 'KXRB' : 'pinecrest'], marker };
    const sky = south
      ? `a line of showers is building over ${nameOf('KXRB')}, south of your course, bases about ${fmt(bases)} feet and spreading your way. The ridge ahead is still clear, for now.`
      : `the ridge ahead around ${nameOf('pinecrest')} is going into cloud: rain showers, bases about ${fmt(bases)} feet over the hills and lowering.`;

    return [
      {
        kind: 'brief', id: 'b1', title: south ? 'Showers to the south' : 'The hills ahead go grey',
        scene: `${chartLine(ctx)} ${Math.round(distanceNm(point('long-lake'), pos))} miles past ${nameOf('long-lake')} at ${fmt(plan.cruiseFt)}, ${sky} Your ceiling minimum is ${fmt(ctx.minimums.ceilingFt)} feet. You left with full tanks and have ${fmt1(fuelGal)} gallons now.${sampleLine(p)}`,
        say: {
          full: 'Decide to divert **early**, while you have altitude, fuel and options. Then fly toward the new field **first** and refine on the way: turn to a rough heading, note the time, then work the numbers. In the air you estimate. A heading within 10 degrees and a time within a few minutes is a good start, and the first checkpoint on the new line corrects the rest.',
          short: 'Turn first, then refine. Note the time.',
        },
        figure: chart,
      },
      {
        kind: 'example', id: 'e1', title: `Back to ${nameOf(HOME)}`,
        say: {
          full: `The easy one first: home. The course back is roughly the reciprocal of the way you came, and the wind that slowed you down now pushes you home. Here are the numbers worked properly, with the ${deg(actual.dirTrue)}° at ${actual.speedKt} knot wind you have been measuring.`,
          short: 'Reciprocal course, wind now behind you.',
        },
        figure: chart,
        work: [
          { label: 'True course', value: `${deg(home.leg.trueCourse)}°` },
          { label: 'Magnetic heading', value: `${deg(home.leg.magHeading)}°`, note: `Magnetic course ${deg(home.leg.magCourse)}°, corrected for wind` },
          { label: 'Distance', value: `${fmt1(home.leg.distanceNm)} nm` },
          { label: 'Groundspeed', value: `${home.leg.groundspeedKt} kt` },
          { label: 'Time', value: `${home.leg.minutes} min` },
          { label: 'Fuel', value: `${fmt1(home.leg.fuelGal)} gal`, note: `Leaves ${fmt1(home.fuelMarginGal)} over the reserve` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `${turn.field.name} (${turn.field.id}): the plotter gives ${deg(turn.leg.trueCourse)}° true and ${fmt1(turn.leg.distanceNm)} nm from where you are. With the wind from ${deg(actual.dirTrue)}° at ${actual.speedKt} knots, what heading, groundspeed and time?`,
        figure: chart,
        blanks: [
          { id: 'mh', label: 'Magnetic heading', unit: '°', answer: turn.leg.magHeading, tolerance: 5,
            explain: `${deg(turn.leg.trueCourse)}° true, the wind correction, then ${Math.abs(VAR)}° west: ${deg(turn.leg.magHeading)}°. Within 5 degrees is a good diversion heading.` },
          { id: 'gs', label: 'Groundspeed', unit: 'kt', answer: turn.leg.groundspeedKt, tolerance: 5,
            explain: `The wind is ${Math.abs(((actual.dirTrue - turn.leg.trueCourse + 540) % 360) - 180) > 90 ? 'mostly behind you' : 'mostly ahead of you'} on this course: about ${turn.leg.groundspeedKt} knots.` },
          { id: 'min', label: 'Time', unit: 'min', answer: turn.leg.minutes, tolerance: 2,
            explain: `${fmt1(turn.leg.distanceNm)} nm at ${turn.leg.groundspeedKt} knots: ${turn.leg.minutes} minutes.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Where do you go?',
        situation: facts.map((f) => `${NameOf(f.field.id)}: ${fmt1(f.leg.distanceNm)} nm, ${f.leg.minutes} min, ${fmt(f.field.runwayFt)} ft ${f.field.surface}${f.field.fuel ? ', fuel' : ', no fuel'}.`).join(' '),
        figure: chart,
        options: DIVERT_IDS.map((d) => {
          const f = by(d.field);
          return option(d.option, d.option === 'press-on'
            ? (south ? `Press on to ${f.field.name} and stay ahead of the showers.` : `Press on to ${f.field.name} and get under it.`)
            : d.option === 'home' ? `Turn around for ${nameOf(HOME)}.` : `Divert to ${f.field.name}.`);
        }),
        grades: Object.fromEntries(DIVERT_IDS.map((d) => [d.option, grades[d.field]])),
        consequence: Object.fromEntries(DIVERT_IDS.map((d) => [d.option, divertConsequence(by(d.field), grades[d.field], facts, grades)])),
        why: `A diversion field has to be reachable without the weather, with the legal reserve, and with a runway that gives you margin: here at least ${RUNWAY_FACTOR} times the landing distance over a 50 foot obstacle, computed for its elevation. Of the fields that pass, the one that has you on the ground soonest wins.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 5.5

// Home from Quill Valley, eastbound at 5,500, with a north wind far stronger
// than forecast pushing the airplane south of course toward Bayport's Class B
// (or, in the second situation, a south wind pushing it north toward Quarry's Class C).
const LOST_FROM = DEST;
const LOST_TO = HOME;
const LOST_ALT = 5500;
const LOST_FIX = 'long-lake';
/** By situation: a north wind pushing you south toward Bayport, or a south wind and a lower tank pushing you north toward Quarry. */
const LOST_DAYS = [
  { forecast: { dirTrue: 340, speedKt: 5 }, actual: { dirTrue: 340, speedKt: 25 }, startShare: 0.6 },
  { forecast: { dirTrue: 170, speedKt: 5 }, actual: { dirTrue: 170, speedKt: 25 }, startShare: 0.45 },
];
const LOST_LATE_MIN = 6;

/** The radar facility printed beside a Class B or C: Bayport's by default. */
function approachFreq(cls: 'B' | 'C' = 'B'): { name: string; freq: string } {
  const b = R.airspace.find((v) => v.cls === cls && v.note)!;
  const m = b.note!.match(/^(.*?) (\d{3}\.\d{2,3})/);
  return { name: m ? m[1] : 'Approach', freq: m ? m[2] : '' };
}

export function lostSituation(p: XcAirplane, variant = 0) {
  const day = LOST_DAYS[variant] ?? LOST_DAYS[0];
  const LOST_FORECAST = day.forecast;
  const LOST_ACTUAL = day.actual;
  const from = point(LOST_FROM);
  const to = point(LOST_TO);
  const fix = point(LOST_FIX);
  const tas = p.perf.cruise.tasKt;
  const gph = p.perf.cruise.gph;
  const plan = legTo(from, to, { tasKt: tas, windFromTrue: LOST_FORECAST.dirTrue, windKt: LOST_FORECAST.speedKt, variationDeg: VAR, gph });
  const fixAlong = alongTrack(from, to, fix).alongNm;
  const fixDue = Math.round((fixAlong / plan.groundspeedKt) * 60);
  const minutes = fixDue + LOST_LATE_MIN;
  const headingTrue = norm(plan.magHeading + VAR);
  const actualPos = deadReckon(from, headingTrue, tas, LOST_ACTUAL.dirTrue, LOST_ACTUAL.speedKt, minutes);
  const drNm = Math.round(((plan.groundspeedKt * minutes) / 60) * 10) / 10;
  const drPos = destination(from, plan.trueCourse, drNm);
  const track = trueCourse(from, actualPos);
  const gs = (distanceNm(from, actualPos) / minutes) * 60;
  const ahead = minutesToClearanceAirspace(R, actualPos, track, gs, LOST_ALT);
  const startGal = Math.round(p.usableGal * day.startShare);
  const fuelGal = Math.round((startGal - p.perf.taxiFuelGal - (minutes * gph) / 60) * 10) / 10;
  const enduranceAfterReserve = Math.floor((fuelGal / gph) * 60 - vfrReserveMin(false));
  const back = legTo(actualPos, from, { tasKt: tas, windFromTrue: LOST_ACTUAL.dirTrue, windKt: LOST_ACTUAL.speedKt, variationDeg: VAR, gph });
  const descentAlt = R.groundFt(actualPos) + 1000;
  const obstacle = R.obstacles.some((o) => distanceNm(o.pos, actualPos) <= 5 && o.mslFt > descentAlt - 500);
  const grades = gradeLost({ enduranceAfterReserveMin: enduranceAfterReserve, minutesBackToFix: back.minutes, minutesToClearanceAirspace: ahead?.minutes ?? null, obstacleWithin5NmAboveDescentAlt: obstacle });
  const off = alongTrack(from, to, actualPos);
  return { day, plan, fixDue, minutes, actualPos, drNm, drPos, track, gs, ahead, startGal, fuelGal, enduranceAfterReserve, back, obstacle, grades, off, misplacedNm: Math.round(distanceNm(actualPos, drPos) * 10) / 10 };
}

const lost: Lesson = {
  id: '5.5', module: 5, minutes: 15,
  title: 'Lost procedures',
  summary: 'When nothing below matches the chart: climb, communicate, confess, comply, conserve, and keep out of airspace you can no longer see coming.',
  acs: ['PA.VI.D', 'PA.VI.B'],
  refs: ['PHAK, lost procedures', 'AIM 6-3-1', '14 CFR 91.131'],
  variants: 2,
  build(ctx) {
    const p = xcAirplane(ctx.aircraft);
    const s = lostSituation(p, ctx.variant ?? 0);
    const { forecast: LOST_FORECAST, actual: LOST_ACTUAL } = s.day;
    const north = ctx.variant === 1;
    // Call the radar facility whose airspace the drift is carrying you toward.
    const cls = north ? 'C' : 'B';
    const app = approachFreq(cls);
    const shelves = north ? ['xqc-c1', 'xqc-c2'] : ['xbb-b2', 'xbb-b3'];
    const className = north ? 'Class Charlie' : 'Class Bravo';
    const dep = wholeHourAfter(ctx.now, 1);
    const route = [LOST_FROM, LOST_FIX, 'harlow', LOST_TO];
    const fixName = nameOf(LOST_FIX);
    const lostAt = addHours(dep, s.minutes / 60);
    const side = s.off.crossNm < 0 ? 'left' : 'right';
    const all = ['climb-call', 'reverse', 'descend-look', 'press-on'];
    const into = s.ahead ? `Held on this heading you'd be inside the ${s.ahead.name} in about ${mins(s.ahead.minutes)}, without a clearance.` : '';

    return [
      {
        kind: 'brief', id: 'b1', title: 'Nothing matches',
        scene: `${chartLine(ctx)} Home from ${nameOf(LOST_FROM)} at ${fmt(LOST_ALT)}, heading ${deg(s.plan.magHeading)}° worked from a forecast wind of ${deg(LOST_FORECAST.dirTrue)}° at ${LOST_FORECAST.speedKt} knots, ${fmt1(s.startGal)} gallons at takeoff. ${fixName} was due at ${local(addHours(dep, s.fixDue / 60))}. It's ${local(lostAt)} and there's no lake, no dam, nothing below that looks like the chart.${sampleLine(p)}`,
        say: {
          full: 'Being unsure of your position is not an emergency yet. It becomes one when you burn the fuel and the daylight pretending you are not. The sequence is **climb** (you see farther and radios reach farther), **communicate** (ATC or flight service, and 121.5 if nobody else answers), **confess** (say you are unsure of your position), **comply** with what they tell you, and **conserve** fuel with an economy power setting. Keep flying the heading you have while you do it: wandering destroys the dead reckoning you still have.',
          short: 'Climb, communicate, confess, comply, conserve.',
        },
        figure: { kind: 'chart', route, highlight: route },
      },
      {
        kind: 'example', id: 'e1', title: 'The five Cs, here',
        say: {
          full: `On this chart the radar facility for the airspace near you is **${app.name}**, printed beside its Class ${cls}. That is your first call. If you can't raise them, 121.5 is monitored by flight service and many airliners overhead.`,
          short: `${app.name} first, then 121.5.`,
        },
        work: [
          { label: 'Climb', value: 'A few thousand feet', note: `More to see, more radio range, more glide. Stay below the clouds and out of the Class ${cls} shelves.` },
          { label: 'Communicate', value: `${app.name} ${app.freq}`, note: 'Or 121.5. Squawk what they give you.' },
          { label: 'Confess', value: '"Unsure of position"', note: 'Your call sign, altitude, heading, last known fix and fuel.' },
          { label: 'Comply', value: 'Fly their vector', note: 'They see you on radar; you don\'t.' },
          { label: 'Conserve', value: 'Economy power', note: 'Lean, slow to the best economy speed. Fuel is time.' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Before you call, have the numbers ready. You've flown ${s.minutes} minutes at a planned ${s.plan.groundspeedKt} knots from ${nameOf(LOST_FROM)} and have ${fmt1(s.fuelGal)} gallons now at ${fmt1(p.perf.cruise.gph)} an hour. How far along the course does dead reckoning put you, how many minutes can you fly before you are into the ${vfrReserveMin(false)} minute reserve, and what frequency works when nothing else does?`,
        figure: { kind: 'chart', route, highlight: route },
        blanks: [
          { id: 'dr', label: 'Dead reckoning distance', unit: 'nm', answer: s.drNm, tolerance: 1,
            explain: `${s.minutes} minutes at ${s.plan.groundspeedKt} knots is ${fmt1(s.drNm)} nm along the course. That is where you would be if the wind were as forecast. It isn't, but it is the best place to start.` },
          { id: 'endur', label: 'Minutes before the reserve', unit: 'min', answer: s.enduranceAfterReserve, tolerance: 3,
            explain: `${fmt1(s.fuelGal)} gallons at ${fmt1(p.perf.cruise.gph)} an hour is ${Math.floor((s.fuelGal / p.perf.cruise.gph) * 60)} minutes, less the ${vfrReserveMin(false)} minute reserve: ${s.enduranceAfterReserve}.` },
          { id: 'freq', label: 'Emergency frequency', unit: 'MHz', answer: 121.5, tolerance: 0,
            explain: '121.5 is the VHF emergency frequency, guarded by flight service, towers and approach controls, and often by airliners.' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Unsure of your position',
        situation: `${local(lostAt)}, ${fmt(LOST_ALT)} feet, ${fmt1(s.fuelGal)} gallons. ${fixName} is ${mins(LOST_LATE_MIN)} overdue and nothing out the window matches the chart.`,
        options: [
          option('climb-call', `Hold heading, climb, and call ${app.name} for help.`),
          option('reverse', `Turn around and fly the reciprocal back toward ${nameOf(LOST_FROM)}.`),
          option('descend-look', 'Descend low enough to read a water tower or a sign.'),
          option('press-on', 'Keep going on this heading. Home has to show up eventually.'),
        ],
        grades: s.grades,
        consequence: {
          'climb-call': `${app.name} has you on radar within a minute: ${fmt1(Math.abs(s.off.crossNm))} nm ${side} of your course and ${fmt1(s.misplacedNm)} nm from where dead reckoning put you. ${s.ahead ? `"Turn ${side === 'right' ? 'left' : 'right'} heading ${deg(s.plan.magHeading + (side === 'right' ? -30 : 30))}, remain clear of the ${className}." ` : ''}You're on the ground at home with fuel to spare.`,
          reverse: s.grades.reverse === 'acceptable'
            ? `Retracing works here: ${mins(s.back.minutes)} into the wind gets you back to ${nameOf(LOST_FROM)}, inside your ${s.enduranceAfterReserve} minutes. But you would be flying a reciprocal of a heading that was already wrong, and a call would have fixed it in one minute.`
            : `${mins(s.back.minutes)} into the wind is more than your ${s.enduranceAfterReserve} minutes before the reserve.`,
          'descend-look': s.obstacle
            ? 'Low and searching near a lighted tower you can\'t place on the chart. This is how lost becomes a collision with an obstacle.'
            : 'Low, slow and searching: less radio range, less to see, less glide, and towers and wires you can\'t place on the chart. You burn fuel and may still not find a name.',
          'press-on': `${into} Hope is not a position.`.trim(),
        },
        why: `The wind was ${LOST_ACTUAL.speedKt - LOST_FORECAST.speedKt} knots stronger than forecast and pushed you ${side} of course. The first late checkpoint was the time to act. A radar facility can find you in a minute; everything else spends fuel to find out what one call would tell you.`,
      },
      {
        kind: 'brief', id: 'b2', title: 'Where you actually were',
        showIf: { step: 'd1', choices: all },
        scene: `${fmt1(Math.abs(s.off.crossNm))} nm ${side} of course, ${fmt1(s.misplacedNm)} nm from where dead reckoning said. ${into}`,
        say: {
          full: `Dead reckoning drifted because the wind was stronger than the forecast. That's normal, and it's why a checkpoint that doesn't show up on time is your cue to fix your position, not to keep looking.`,
          short: 'A late checkpoint is the cue to fix your position.',
        },
        figure: { kind: 'chart', route, highlight: [...route, ...shelves], marker: { pos: s.actualPos, altMsl: LOST_ALT, label: 'You were here' } },
      },
    ];
  },
};

export const crossCountryLessons: Lesson[] = [navLogLesson, windsAloft, checkpoints, diversion, lost];

/** For tests: the diversion facts behind 5.4. */
export const _internal = { divertSituation, flownPlan, lowestGround, DIVERT_IDS, ALT_OPTIONS, WINDS };
