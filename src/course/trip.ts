// Trip copy and the planning lesson. The engine (scenarios/trip.ts) works
// and grades every trip; this file only reads its numbers into the
// instructor's words and turns the trip the pilot picks into a lesson: the
// leg out worked, the leg home on the pilot, the fuel and the daylight, then
// the forecast moving halfway out.

import type { NavLeg, NavLog, LatLon } from '../lib/nav';
import { norm } from '../lib/wind';
import {
  deg3, diversionScene, gradeDiversionChoices, GROUND_MIN, longestRunwayFt, stopper,
  type DiversionChoice, type PlanOptions, type Recommendation, type TripInputs, type TripLeg, type TripPlan, type TripTag, type WxAt,
} from '../scenarios/trip';
import type { Grade } from '../scenarios/goNoGo';
import type { Figure, Lesson, MapPoint, Step } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const localTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`;

export const TAG_LABEL: Record<TripTag, string> = {
  new: 'New to you',
  stale: 'Not in six months',
  towered: 'Towered',
  'xc-credit': 'Over 50 nm',
  'short-runway': 'Short runway',
  grass: 'Grass',
  longest: 'Longest yet',
  crosswind: 'Crosswind practice',
  'wind-lesson': 'Wind changes the times',
};

/** "ceiling 2,500", "no ceiling", with visibility when it matters. */
export function skyText(wx: WxAt): string {
  if (wx.source === 'none') return 'no report';
  const ceil = wx.ceilingFtAgl === null ? 'no ceiling' : `ceiling ${fmt(wx.ceilingFtAgl)}`;
  const vis = wx.visibilitySm !== null && wx.visibilitySm < 6 ? `, ${wx.visibilitySm} SM` : '';
  return `${ceil}${vis}`;
}

/** Where the arrival weather comes from, in a few words. */
export function wxSource(wx: WxAt): string {
  if (wx.source === 'none') return 'nothing reports there';
  if (wx.source === 'metar') return `${wx.station} report now`;
  return wx.stationNm === 0 ? `${wx.station} TAF` : `${wx.station} TAF, ${wx.stationNm} nm away`;
}

const windText = (w: { dirTrue: number; speedKt: number } | null) =>
  !w || w.speedKt < 3 ? 'light and variable' : `${deg3(w.dirTrue)} true at ${w.speedKt}`;

/** The instructor's opening line over the list. */
export function tripLead(rec: Recommendation, o: PlanOptions): string {
  if (!rec.ranked.length) {
    const s = rec.filtered.map(stopper).find(Boolean);
    return rec.considered.length
      ? `Nothing passes today. ${s ? `The most common reason: ${s.title.toLowerCase()}.` : ''} Change the departure time or your radius, or use the day for a lesson on the ground.`
      : `No fields that report weather lie within ${o.prefs.maxLegNm} nm. Widen your radius to see more.`;
  }
  const top = rec.ranked[0];
  const w = top.out.wind;
  const pass = `${rec.ranked.length} of ${rec.considered.length} fields in reach pass your minimums.`;
  if (!w) return `${pass} No winds aloft were in reach, so the times assume still air.`;
  if (w.speedKt < 10) return `Winds at ${fmt(top.out.altitudeMsl)} ft are ${windText(w)}, so out and home take about the same time. ${pass}`;
  const toward = compass(norm(w.dirTrue));
  return `Winds at ${fmt(top.out.altitudeMsl)} ft are ${windText(w)}. Anything ${toward} is a headwind out and a push home; anything the other way, the reverse. ${pass}`;
}

function compass(dir: number): string {
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(dir / 45) % 8];
}

/** Two or three sentences on why this trip, today. */
export function tripPitch(p: TripPlan, o: PlanOptions): string {
  const s: string[] = [];
  const has = (t: TripTag) => p.tags.includes(t);
  const rwy = longestRunwayFt(p.dest);
  if (has('new') && has('towered')) s.push('A towered field you haven\'t planned before, so the radio work is new too.');
  else if (has('new')) s.push('A field you haven\'t planned before.');
  else if (has('stale')) s.push('You haven\'t planned this one in over six months.');
  if (has('grass')) s.push(`Grass at the end, ${fmt(rwy)} ft of it.`);
  else if (has('short-runway')) s.push(`A ${fmt(rwy)} ft runway, so the landing is the lesson.`);
  if (has('wind-lesson')) s.push(`${mins(p.out.totalMin)} out and ${p.back.totalMin} home: the wind is the lesson.`);
  if (has('crosswind') && p.runway) s.push(`${Math.round(p.runway.gustCrosswindKt ?? p.runway.crosswindKt)} kt across runway ${p.runway.end.id} at arrival, inside your ${o.minimums.crosswindKt}.`);
  if (has('longest')) s.push('Farther than any trip you have planned here.');
  if (has('xc-credit') && s.length < 2) s.push('It lands more than 50 nm out, the distance 61.1 uses for cross-country time.');
  if (!s.length) s.push(`${Math.round(p.distanceNm)} nm, home by ${localTime(p.times.home)}.`);
  s.push(`At arrival, ${skyText(p.arrivalWx)} (${wxSource(p.arrivalWx)}).`);
  return s.slice(0, 3).join(' ');
}

/* ---------------------------------------------------------------- figures */

/** A trip leg as a nav log row. */
export function navLeg(from: { id: string; name: string; pos: LatLon }, to: { id: string; name: string; pos: LatLon }, l: TripLeg): NavLeg {
  const wca = ((l.magHeading - l.magCourse + 540) % 360) - 180;
  return {
    from: { id: from.id, name: from.name, ...from.pos }, to: { id: to.id, name: to.name, ...to.pos },
    distanceNm: l.distanceNm, trueCourse: l.trueCourse, magCourse: l.magCourse,
    trueHeading: Math.round(norm(l.trueCourse + wca)), magHeading: l.magHeading, wcaDeg: wca,
    groundspeedKt: l.groundspeedKt, minutes: l.minutes, fuelGal: l.fuelGal,
  };
}

export function navLogOf(legs: NavLeg[]): NavLog {
  const sum = (f: (l: NavLeg) => number) => legs.reduce((n, l) => n + f(l), 0);
  return { legs, totalNm: Math.round(sum((l) => l.distanceNm) * 10) / 10, totalMin: sum((l) => l.minutes), totalFuelGal: Math.round(sum((l) => l.fuelGal) * 10) / 10 };
}

/** The plan view for a set of trips: home, the picks, and what was left out. */
export function tripMapFigure(input: TripInputs, picks: TripPlan[], filtered: TripPlan[], ringsNm: number[], route?: string): Extract<Figure, { kind: 'tripMap' }> {
  const points: MapPoint[] = [
    ...picks.map((p) => ({ id: p.dest.id, label: p.dest.id, sub: `${Math.round(p.distanceNm)} nm`, pos: p.dest.pos, role: 'pick' as const })),
    ...filtered.map((p) => ({ id: p.dest.id, label: p.dest.id, sub: stopper(p)?.title, pos: p.dest.pos, role: 'filtered' as const })),
  ];
  return {
    kind: 'tripMap', practice: input.source === 'practice', variationDeg: input.home.variationDeg,
    home: { id: input.home.id, label: input.home.id, pos: input.home.pos, role: 'home' },
    points, ringsNm, route: route ? [input.home.id, route] : undefined,
  };
}

/* ---------------------------------------------------------------- the lesson */

const CONSEQUENCE: Record<Grade, (c: DiversionChoice) => string> = {
  best: (c) => `You turn to ${c.field.id}, heading ${deg3(c.leg.magHeading)}. ${mins(c.leg.minutes)} later you are on the ground with ${fmt1(c.fuelOnLandingGal)} gallons and a story, not a problem.`,
  acceptable: (c) => `You head for ${c.field.id}, ${mins(c.leg.minutes)} away. It works, with ${fmt1(c.fuelOnLandingGal)} gallons on landing; there was a sooner way down.`,
  marginal: (c) => c.id === 'continue'
    ? `You press on. ${c.field.id} is legal, but under the line you drew for yourself on the ground, and you find out why you drew it there in the last ten miles.`
    : `You go for ${c.field.id}. It works on paper, but it's under one of your own lines, and a diversion is the time you most want margin.`,
  unsafe: (c) => c.legalMarginGal < 0
    ? `You head for ${c.field.id} and land with ${fmt1(c.fuelOnLandingGal)} gallons, under the legal reserve. That is the fuel-exhaustion accident chain, one link from the end.`
    : `You head for ${c.field.id}. The weather or the runway there doesn't allow it, and now you need a second diversion with less fuel.`,
};

function optionLabel(c: DiversionChoice): string {
  const where = c.id === 'continue' ? `Press on to ${c.field.id}` : c.id === 'home' ? `Turn for home, ${c.field.id}` : `Divert to ${c.field.id}, ${c.field.name}`;
  return `${where}: ${fmt1(c.leg.distanceNm)} nm, heading ${deg3(c.leg.magHeading)}, ${mins(c.leg.minutes)}, ${skyText(c.wx)}.`;
}

/**
 * The planning lesson for one trip. It is built once, when the pilot picks
 * the trip, from the same plan the card showed, so the numbers agree.
 */
export function tripLesson(input: TripInputs, plan: TripPlan, o: PlanOptions): Lesson {
  const home = input.home;
  const dest = plan.dest;
  const { out, back, fuel, times } = plan;
  const practice = input.source === 'practice';
  const sample = o.airplane.sample
    ? ` The airplane numbers are **sample values** (${fmt(o.airplane.perf.cruise.tasKt)} knots, ${fmt1(o.airplane.perf.cruise.gph)} gallons an hour, ${fmt(o.airplane.usableGal)} gallons usable), not your POH.`
    : '';
  const where = practice ? ' These are practice fields on a made-up chart with made-up weather.' : '';
  const legOut = navLeg(home, dest, out);
  const legBack = navLeg(dest, home, back);
  const scene = diversionScene(input, plan, o);
  const grades = gradeDiversionChoices(scene, o);
  const best = scene.choices.filter((c) => grades[c.id] === 'best').map((c) => c.field.id);
  const climbFuel = fmt1((o.airplane.perf.climbGph * out.climbMin) / 60);
  const ringNm = [25, 50, Math.max(75, o.prefs.maxLegNm)];

  const steps: Step[] = [
    {
      kind: 'brief', id: 'why', title: `${home.id} to ${dest.id}, ${Math.round(plan.distanceNm)} nm`,
      scene: `Leave ${localTime(times.depart)}, land at ${dest.id} about ${localTime(times.arrive)}, ${GROUND_MIN} minutes on the ground, home about ${localTime(times.home)}.${times.sunset ? ` Sunset ${localTime(times.sunset)}.` : ''}${where}`,
      say: {
        full: `${tripPitch(plan, o)} Plan it the way you would the night before: the nav log first, then the fuel, then what you'd do if the far end goes bad halfway there.${sample}`,
        short: `${tripPitch(plan, o)}${sample}`,
      },
      figure: tripMapFigure(input, [plan], [], ringNm, dest.id),
    },
    {
      kind: 'example', id: 'out', title: 'The leg out',
      say: {
        full: `I'll work the leg out. The wind comes from the winds aloft forecast at ${plan.windsStation ?? 'no station'}, read at the cruise altitude, and it is in true degrees, so the wind triangle is worked in true and the variation goes on at the end.${out.climbMin ? ` The climb gets its own time and fuel on top.` : ''}`,
        short: 'The leg out, worked. Wind in true, variation last.',
      },
      figure: { kind: 'navlog', log: navLogOf([legOut]), altitudeMsl: out.altitudeMsl },
      work: [
        { label: 'True course', value: `${deg3(out.trueCourse)}°`, note: `${fmt1(out.distanceNm)} nm, measured on the chart` },
        { label: 'Cruise altitude', value: `${fmt(out.altitudeMsl)} ft`, note: 'The lowest 91.159 altitude for the course with room over the ground, kept under the clouds' },
        { label: 'Wind at altitude', value: windText(out.wind), note: plan.windsStation ? `FB forecast, ${plan.windsStation}` : 'No forecast in reach; still air' },
        { label: 'Wind correction', value: `${legOut.wcaDeg > 0 ? '+' : ''}${legOut.wcaDeg}°`, note: `True heading ${deg3(legOut.trueHeading)}°` },
        { label: 'Magnetic heading', value: `${deg3(out.magHeading)}°`, note: `Variation ${Math.abs(Math.round((home.variationDeg + dest.variationDeg) / 2))}° ${home.variationDeg < 0 ? 'west, added' : 'east, subtracted'}` },
        { label: 'Groundspeed', value: `${out.groundspeedKt} kt`, note: `From ${fmt(o.airplane.perf.cruise.tasKt)} kt true airspeed` },
        { label: 'Time', value: `${out.climbMin} + ${out.minutes} min`, note: 'Climb, then cruise over the whole distance' },
        { label: 'Fuel', value: `${fmt1(out.totalFuelGal)} gal`, note: `Taxi ${fmt1(o.airplane.perf.taxiFuelGal)}, climb ${climbFuel}, cruise ${fmt1(out.fuelGal)}` },
      ],
    },
    {
      kind: 'turn', id: 'back', title: 'The leg home',
      prompt: `Your turn, the leg home. True course ${deg3(back.trueCourse)}°, ${fmt1(back.distanceNm)} nm, at ${fmt(back.altitudeMsl)} ft${back.altitudeMsl !== out.altitudeMsl ? ' (the other hemisphere\'s altitude)' : ''}. Wind ${windText(back.wind)}. True airspeed ${fmt(o.airplane.perf.cruise.tasKt)} kt, ${fmt1(o.airplane.perf.cruise.gph)} gal an hour.`,
      figure: { kind: 'navlog', log: navLogOf([legOut]), altitudeMsl: out.altitudeMsl },
      blanks: [
        { id: 'mh', label: 'Magnetic heading', unit: '°', answer: back.magHeading, tolerance: 3,
          explain: `Wind correction ${legBack.wcaDeg > 0 ? '+' : ''}${legBack.wcaDeg}° gives a true heading of ${deg3(legBack.trueHeading)}°, then the variation: ${deg3(back.magHeading)}° magnetic.` },
        { id: 'gs', label: 'Groundspeed', unit: 'kt', answer: back.groundspeedKt, tolerance: 4,
          explain: `${back.groundspeedKt} kt against ${out.groundspeedKt} on the way out.${Math.abs(back.groundspeedKt - out.groundspeedKt) >= 10 ? ' Same wind, opposite direction: that difference is the whole reason to work both legs.' : ''}` },
        { id: 'min', label: 'Cruise time', unit: 'min', answer: back.minutes, tolerance: 2,
          explain: `${fmt1(back.distanceNm)} nm at ${back.groundspeedKt} kt is ${back.minutes} minutes.` },
        { id: 'gal', label: 'Cruise fuel', unit: 'gal', answer: back.fuelGal, tolerance: 0.5,
          explain: `${back.minutes} minutes at ${fmt1(o.airplane.perf.cruise.gph)} gal an hour is ${fmt1(back.fuelGal)} gal.` },
      ],
    },
    {
      kind: 'turn', id: 'fuel', title: 'Fuel and daylight',
      prompt: `With taxi and climb, the leg out burns ${fmt1(fuel.outGal)} gal and the leg home ${fmt1(fuel.backGal)}. You keep ${fuel.reserveMin} minutes on landing at ${fmt1(o.airplane.perf.cruise.gph)} gal an hour.${times.sunset ? ` You'd be home at ${localTime(times.home)}; sunset is ${localTime(times.sunset)}.` : ''}`,
      blanks: [
        { id: 'need', label: 'Fuel needed, with your reserve', unit: 'gal', answer: fuel.requiredGal, tolerance: 0.6,
          explain: `${fmt1(fuel.outGal)} + ${fmt1(fuel.backGal)} + ${fmt1(fuel.reserveGal)} reserve is ${fmt1(fuel.requiredGal)} of ${fmt(fuel.usableGal)} usable, which leaves ${fmt1(fuel.marginGal)} spare. The legal day reserve is 30 minutes, ${fmt1(fuel.legalReserveGal)} gal; your own line is the one planned to.` },
        ...(times.sunsetMarginMin !== null && times.sunset ? [{
          id: 'daylight', label: 'Daylight to spare at home', unit: 'min', answer: times.sunsetMarginMin, tolerance: 5,
          explain: `${localTime(times.home)} to ${localTime(times.sunset)} is ${mins(times.sunsetMarginMin)}.${times.sunsetMarginMin < 90 ? ' Less than you\'d think once you add a fuel stop or a slow ground.' : ''}`,
        }] : []),
      ],
    },
    {
      kind: 'decide', id: 'divert', title: 'The forecast moves',
      situation: `Halfway out, about ${localTime(scene.at)}, with ${fmt1(scene.fuelOnBoardGal)} gallons on board, ${dest.id}'s forecast amends: a ceiling of ${fmt(scene.amendedCeilingFt)} ft when you'd get there. Your line is ${fmt(o.minimums.ceilingFt)}. ${scene.choices.length > 2 ? 'The nearest fields are on the list with their current reports.' : ''}`.trim(),
      figure: {
        kind: 'tripMap', practice, variationDeg: home.variationDeg,
        home: { id: home.id, label: home.id, pos: home.pos, role: 'home' },
        points: scene.choices.filter((c) => c.id !== 'home').map((c) => ({
          id: c.field.id, label: c.field.id, sub: c.id === 'continue' ? `ceiling ${fmt(scene.amendedCeilingFt)}` : skyText(c.wx), pos: c.field.pos, role: c.id === 'continue' ? 'dest' as const : 'alternate' as const,
        })),
        ringsNm: [], route: [home.id, dest.id], marker: scene.pos,
      },
      options: scene.choices.map((c) => ({ id: c.id, label: optionLabel(c) })),
      grades,
      consequence: Object.fromEntries(scene.choices.map((c) => [c.id, CONSEQUENCE[grades[c.id]](c)])),
      why: `A personal minimum only works if it holds in the air, where pressing on is easiest. ${best.length ? `${best.join(' or ')} is the soonest field above your lines with the fuel to spare, ` : 'Every choice here costs something, '}and a diversion picked early is a calm one: heading, distance, time and fuel, then tell someone.${scene.choices.some((c) => c.id !== 'continue' && c.id !== 'home') ? ' The alternates use their reports from now.' : ''}`,
    },
  ];

  return {
    id: `trip-${dest.id}`,
    module: 0,
    title: `Plan ${home.id} to ${dest.id}`,
    summary: `A round trip to ${dest.name}, planned from today's weather.`,
    minutes: 15,
    acs: ['PA.I.D', 'PA.VI.A', 'PA.VI.C'],
    refs: ['PHAK, flight planning', 'PHAK, wind triangle', 'Aviation Weather Handbook, winds aloft', '14 CFR 91.151', '14 CFR 91.159', 'PHAK, flight diversion', '14 CFR 91.103, preflight action'],
    build: () => steps,
  };
}
