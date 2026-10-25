// Module 7, Systems and the panel: four flights. The failures happen in the
// air, so they fly on the practice sectional, where the distances are the same
// for every pilot. The airplane's speed and fuel burn come from the pilot's
// own performance tables, or labeled sample tables without them. Every number
// and every grade comes from lib/systems.ts and lib/nav.ts.

import { chartAirport, practiceRegion, type ChartAirport, type Checkpoint } from '../chart/practiceRegion';
import { destination, distanceNm, navLog, trueCourse, windTriangle, type LatLon, type NavPoint } from '../lib/nav';
import { sampleTrainerPerformance } from '../lib/perf';
import {
  CARB_ICE_LABEL, CLASSIC_PANEL, ELECTRICAL_MARGIN_MIN, FAILURE_NAME, INSTRUMENT_NAME, affectedBy, batteryMinutes, blockedStatic, busLoadAmps,
  carbIceRisk, diagnose, gradeAlternatorFailure, gradeGpsLoss, gradeGyroFailure, gradeRoughEngine, gradeRpmLoss, relativeHumidity,
  sampleElectrical, shedLoads, stillGood, usableAh, type ElectricalSystem, type InstrumentId, type SystemFailure,
} from '../lib/systems';
import { norm } from '../lib/wind';
import type { Grade } from '../scenarios/goNoGo';
import { cloud, metarText, observedAt } from './practice';
import type { Figure, Lesson, LessonContext, Option, PanelInstrument, Step } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const deg = (n: number) => String(Math.round(norm(n)) || 360).padStart(3, '0');
const r1 = (n: number) => Math.round(n * 10) / 10;
/** 'a', 'a and b', 'a, b and c'. */
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

const HOME = chartAirport('KXYZ')!;
const VARIATION = practiceRegion.variationDeg;

/** The airplane's numbers: the pilot's own tables, or the labeled sample set. */
function airplane(ctx: LessonContext) {
  const own = ctx.aircraft.performance;
  return { perf: own ?? sampleTrainerPerformance(), sample: !own || ctx.aircraft.sampleValues };
}

function onTheChart(ctx: LessonContext): string {
  return ctx.practiceField ? '' : ' This one flies on the practice sectional, so the distances are the same for every pilot.';
}

function sampleLine(sample: boolean): string {
  return sample ? ' Speeds and fuel burn are sample values for a trainer, not your POH.' : '';
}

/**
 * Lesson copy is written for the case the lesson sets up. When the pilot's
 * own airplane or minimums change a grade, the consequence for that option
 * falls back to a line that follows the engine.
 */
function consequences<K extends string>(grades: Record<K, Grade>, intended: Partial<Record<K, Grade>>, written: Record<K, string>, engineWhy: string): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const id of Object.keys(written) as K[]) {
    out[id] = !intended[id] || grades[id] === intended[id] ? written[id] : `With your numbers this plays out differently. ${engineWhy}`;
  }
  return out;
}

function decision<K extends string>(
  id: string, title: string, situation: string, figure: Figure | undefined,
  labels: Record<K, string>, grades: Record<K, Grade>, intended: Partial<Record<K, Grade>>, written: Record<K, string>, why: string,
): Step {
  const options: Option[] = (Object.keys(labels) as K[]).map((k) => ({ id: k, label: labels[k] }));
  return { kind: 'decide', id, title, situation, figure, options, grades, consequence: consequences(grades, intended, written, why), why };
}

/** Minutes and groundspeed from a point to a field at a wind. */
function legTo(from: LatLon, to: LatLon, tasKt: number, windFromTrue: number, windKt: number) {
  const nm = r1(distanceNm(from, to));
  const tc = Math.round(trueCourse(from, to));
  const w = windTriangle(tc, tasKt, windFromTrue, windKt);
  return { nm, tc, gs: w.groundspeedKt, min: Math.round((nm / w.groundspeedKt) * 60) };
}

// ---------------------------------------------------------------- 7.1

function electricalFigure(sys: ElectricalSystem, on: string[], alternator: 'online' | 'failed'): Figure {
  const total = busLoadAmps(sys, on);
  return {
    kind: 'electrical', volts: alternator === 'online' ? sys.volts + 0.3 : sys.volts - 1.6, alternator,
    loads: sys.loads.map((l) => ({ id: l.id, name: l.name, amps: l.amps, on: on.includes(l.id), essential: l.essential })),
    totalAmps: total, usableAh: usableAh(sys), minutesLeft: batteryMinutes(sys, total), sample: sys.sample,
  };
}

const alternator: Lesson = {
  id: '7.1', module: 7, minutes: 15,
  title: 'Electrical system and the alternator light',
  summary: 'Turn an alternator light into battery minutes, shed load, and pick the field the battery can actually reach.',
  acs: ['PA.I.G', 'PA.IX.C'],
  refs: ['PHAK, electrical system', 'POH section 3, electrical power supply system malfunctions'],
  build(ctx) {
    const { perf, sample } = airplane(ctx);
    const sys = sampleElectrical();
    const pos = destination(HOME.pos, 255, 44);
    const windFrom = 70;
    const windKt = 18;
    const fields = practiceRegion.airports.filter((a) => a.id !== HOME.id).map((a) => ({ a, leg: legTo(pos, a.pos, perf.cruise.tasKt, windFrom, windKt) }));
    const nearest = fields.sort((x, y) => x.leg.nm - y.leg.nm)[0];
    const home = legTo(pos, HOME.pos, perf.cruise.tasKt, windFrom, windKt);

    const on = sys.loads.filter((l) => l.id !== 'pitotheat').map((l) => l.id);
    const shed = shedLoads(sys, on);
    const fullA = busLoadAmps(sys, on);
    const shedA = busLoadAmps(sys, shed);
    const fullMin = batteryMinutes(sys, fullA);
    const shedMin = batteryMinutes(sys, shedA);
    const grades = gradeAlternatorFailure({ fullMin, shedMin, toHomeMin: home.min, toNearestMin: nearest.leg.min });
    const essentials = sys.loads.filter((l) => shed.includes(l.id)).map((l) => l.name.toLowerCase());
    const chart: Figure = { kind: 'chart', route: [HOME.id], highlight: [HOME.id, nearest.a.id], focus: { id: HOME.id, radiusNm: 50 }, marker: { pos, altMsl: 4500, label: 'You' } };

    return [
      {
        kind: 'brief', id: 'b1', title: 'Where the electrons come from',
        scene: `Heading home to ${HOME.id} from ${nearest.a.name} at 4,500 feet, ${home.nm} nm out, in good visibility.${onTheChart(ctx)}`,
        say: {
          full: 'The engine drives an **alternator**, which carries every electrical load and keeps the **battery** charged. The battery starts the engine and is the reserve. When the alternator quits, nothing changes at first: the radios work, the lights stay on, and the engine keeps running, because the **magnetos** make their own spark. What changes is that the battery is now carrying the whole bus, and it is going flat. Your job is to turn that into minutes.',
          short: 'Alternator out: the engine runs, the battery is now the clock.',
        },
        figure: electricalFigure(sys, on, 'online'),
      },
      {
        kind: 'example', id: 'e1', title: 'The light comes on',
        say: {
          full: `The alternator light comes on and the ammeter shows a discharge. Check the alternator breaker, then turn the alternator side of the master off and on **once**. If the light stays on, you are on the battery. Now the arithmetic. ${sample ? 'These are sample loads for teaching.' : ''} Count on about half the battery's rating: an older battery gives less, and the radios quit before it is flat.`,
          short: 'Breaker, cycle once, then do the arithmetic.',
        },
        figure: electricalFigure(sys, on, 'failed'),
        work: [
          { label: 'Battery', value: `${sys.batteryAh} Ah`, note: `Counted at ${Math.round(sys.usableFraction * 100)} percent: ${usableAh(sys)} Ah` },
          { label: 'Load now', value: `${fullA} A`, note: 'Everything that was on when the light came on' },
          { label: 'Minutes', value: `${fullMin} min`, note: `${usableAh(sys)} Ah ÷ ${fullA} A × 60` },
          { label: 'To home', value: `${home.min} min`, note: `${home.nm} nm at ${home.gs} kt groundspeed into the wind` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Shed everything except the ${list(essentials)}. What do they draw, how many minutes does the battery give you at that load, and how many minutes is it home at ${home.gs} knots over the ground?`,
        figure: electricalFigure(sys, on, 'failed'),
        blanks: [
          { id: 'amps', label: 'Load after shedding', unit: 'A', answer: shedA, tolerance: 0.2,
            explain: `${sys.loads.filter((l) => shed.includes(l.id)).map((l) => `${l.amps}`).join(' + ')} = ${shedA} amps.` },
          { id: 'min', label: 'Battery minutes', unit: 'min', answer: shedMin, tolerance: 3,
            explain: `${usableAh(sys)} Ah ÷ ${shedA} A × 60 is about ${shedMin} minutes, against ${fullMin} with everything on.` },
          { id: 'home', label: 'Minutes to home', unit: 'min', answer: home.min, tolerance: 2,
            explain: `${home.nm} nm at ${home.gs} knots is ${home.min} minutes.` },
        ],
      },
      decision('d1', 'Which field?',
        `${HOME.id} is ${home.min} minutes ahead and towered, so you will want the radio for the call. ${nearest.a.name} is ${nearest.leg.min} minutes behind you. Shed, the battery gives about ${shedMin} minutes; with everything on, about ${fullMin}.`,
        chart,
        {
          'carry-on': 'Leave everything on and continue home. The engine does not need electricity.',
          'shed-home': `Shed load, call ${HOME.id} tower early to say what is going on, and continue home.`,
          'shed-nearest': `Shed load and turn back for ${nearest.a.name}.`,
        },
        grades,
        { 'carry-on': 'unsafe', 'shed-home': 'best', 'shed-nearest': 'acceptable' },
        {
          'carry-on': `The battery runs out at about ${fullMin} minutes, ${Math.max(0, fullMin - home.min)} after you reach the field, and that is the count with the battery at its best. The radio goes in the pattern of a towered field, and so does the transponder.`,
          'shed-home': `You land at home with about ${shedMin - home.min} minutes of battery left. The tower knew before you entered the airspace, and the radio still worked when they cleared you to land.`,
          'shed-nearest': `Also sound: you are on the ground in ${nearest.leg.min} minutes. The airplane is away from its mechanic, but nobody is in a hurry now.`,
        },
        `Shed, the battery gives about ${shedMin} minutes against ${home.min} to home plus ${ELECTRICAL_MARGIN_MIN} in hand${fullMin >= home.min + ELECTRICAL_MARGIN_MIN ? '' : `; at full load, ${fullMin} minutes does not cover it`}. The POH says to land as soon as practical, and a field the battery reaches with margin fits that.`,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 7.2

function panel(values: Partial<Record<InstrumentId, { value: number; pitchDeg?: number }>>, wrong: InstrumentId[] = [], covered: InstrumentId[] = []): Figure {
  const base: Record<InstrumentId, { value: number; pitchDeg?: number }> = {
    asi: { value: 105 }, ai: { value: 0, pitchDeg: 0 }, alt: { value: 4500 }, tc: { value: 0 }, hi: { value: 250 }, vsi: { value: 0 }, compass: { value: 250 },
  };
  const instruments: PanelInstrument[] = (Object.keys(CLASSIC_PANEL) as InstrumentId[]).map((id) => ({
    id, sources: CLASSIC_PANEL[id], ...base[id], ...values[id],
    state: covered.includes(id) ? 'covered' : wrong.includes(id) ? 'wrong' : 'ok',
  }));
  return { kind: 'panel', instruments };
}

const instruments: Lesson = {
  id: '7.2', module: 7, minutes: 15,
  title: 'Vacuum, electric and backup instruments',
  summary: 'Know what powers each instrument, catch the one that is lying by cross-checking, and fly on what is left.',
  acs: ['PA.I.G', 'PA.IX.C'],
  refs: ['PHAK, gyroscopic instruments', 'PHAK, blocked pitot-static system', '14 CFR 91.205'],
  build(ctx) {
    const failure = diagnose(CLASSIC_PANEL, ['ai', 'hi']) as SystemFailure;
    const bad = affectedBy(CLASSIC_PANEL, failure);
    const good = stillGood(CLASSIC_PANEL, failure);
    const vis = Math.max(3, ctx.minimums.visibilitySm - 1);
    const grades = gradeGyroFailure({ visibilitySm: vis, minimumSm: ctx.minimums.visibilitySm });
    const blockAt = 2500;
    const climbTo = 4500;
    const climb = blockedStatic(blockAt, climbTo);
    const askAt = 3500;
    const descendTo = 2500;
    const descend = blockedStatic(askAt, descendTo);
    const failed = panel({ ai: { value: -15, pitchDeg: 2 }, hi: { value: 214 } }, bad);
    const nearMin = 12;
    const tripMin = 40;
    const sourceOf = (s: string) => s === 'none' ? 'nothing' : s;
    const byName = (ids: InstrumentId[]) => list(ids.map((i) => INSTRUMENT_NAME[i].toLowerCase()));

    return [
      {
        kind: 'brief', id: 'b1', title: 'Three ways to power a needle',
        scene: 'A hazy afternoon over the hills. The horizon is soft, and you are leaning on the panel more than you think.',
        say: {
          full: 'Every instrument on a classic panel depends on something. The **airspeed**, **altimeter** and **vertical speed** read air pressure through the pitot tube and static port. The **attitude** and **heading indicators** are gyros spun by the **vacuum** pump. The **turn coordinator** is a gyro on **electric** power, on purpose, so one failure cannot take every gyro. The **compass** needs nothing. Electronic displays work differently: they take power from the bus and usually carry a backup battery, so check what yours runs on in its supplement. Learn your own panel by source, and a failure tells you exactly which instruments to stop believing.',
          short: 'Pitot-static, vacuum, electric, nothing. Know which is which.',
        },
        figure: panel({}),
      },
      {
        kind: 'example', id: 'e1', title: 'A static port that ices',
        say: {
          full: `Here is one worked through. The static port ices over as you pass ${fmt(blockAt)} feet in the climb, and you keep climbing to ${fmt(climbTo)}. The static instruments now read the air trapped at ${fmt(blockAt)}. The cure is the **alternate static source**, if you have one, which reads a little high because cabin pressure is lower.`,
          short: 'Static blocked: altimeter frozen, VSI zero, airspeed wrong.',
        },
        figure: panel({ alt: { value: climb.altimeterFt }, vsi: { value: climb.vsiFpm }, asi: { value: 88 } }, affectedBy(CLASSIC_PANEL, 'static')),
        work: [
          { label: 'Altimeter', value: `${fmt(climb.altimeterFt)} ft`, note: 'Frozen where the port blocked' },
          { label: 'Vertical speed', value: `${climb.vsiFpm} fpm`, note: 'No change in pressure, so no rate' },
          { label: 'Airspeed', value: `Reads ${climb.airspeed}`, note: 'Above the blockage the trapped pressure is too high, so it under-reads' },
          { label: 'Attitude, heading, turn', value: 'Still right', note: 'Gyros do not use the static port' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Later on the same flight the panel looks like this. The attitude indicator shows a bank, the heading indicator is turning, the turn coordinator says wings level and the compass is steady. Which source failed, and what do you fly with? Then one more static question.',
        figure: failed,
        blanks: [
          { id: 'source', label: 'Failed source', answer: FAILURE_NAME[failure], choices: Object.values(FAILURE_NAME),
            explain: `The two instruments that disagree with the rest, the ${byName(bad)}, share one source: ${sourceOf(failure)}. Nothing else on the panel uses it.` },
          { id: 'turning', label: 'Trust for turning', answer: INSTRUMENT_NAME.tc, choices: [INSTRUMENT_NAME.ai, INSTRUMENT_NAME.hi, INSTRUMENT_NAME.tc],
            explain: `The turn coordinator runs on electric power, so losing the ${sourceOf(failure)} system leaves it alone. It and the compass agree you are not turning.` },
          { id: 'static', label: `Static blocked at ${fmt(askAt)}, now at ${fmt(descendTo)}: altimeter reads`, unit: 'ft', answer: descend.altimeterFt, tolerance: 0,
            explain: `It freezes at ${fmt(descend.altimeterFt)}. Below the blockage the airspeed reads ${descend.airspeed}.` },
        ],
      },
      decision('d1', 'The gyros are going',
        `Visibility is about ${vis} miles in haze and your minimum is ${ctx.minimums.visibilitySm}. Still working: the ${byName(good)}. A field with a long runway is ${nearMin} minutes away; the trip has ${tripMin} minutes left.`,
        failed,
        {
          'trust-attitude': 'Level the wings on the attitude indicator. It is the primary instrument for bank.',
          'cover-land': 'Cover the attitude and heading indicators, fly by the turn coordinator, compass and the view outside, and land at the nearer field.',
          'cover-continue': 'Cover them and finish the trip on the rest of the panel.',
          'climb-clear': 'Climb above the haze, where the horizon is sharper, and sort it out up there.',
        },
        grades,
        { 'trust-attitude': 'unsafe', 'cover-land': 'best', 'cover-continue': 'marginal', 'climb-clear': 'unsafe' },
        {
          'trust-attitude': 'You roll right to level a bank that was never there. The turn coordinator swings, the compass starts to move, and in the haze you are now in a real bank following a dead gyro. This is how a failed vacuum pump becomes a spiral.',
          'cover-land': `Covered, the lying instruments stop pulling your eye. You fly ${nearMin} minutes on the turn coordinator, the compass and the horizon you have, and land with the haze still around you.`,
          'cover-continue': `Covering them was right. ${tripMin} minutes of partial panel in haze below your minimum is a long time to fly on the hardest instruments to read.`,
          'climb-clear': 'Climbing into a softer horizon with no attitude indicator is the wrong direction. If the haze tops out higher than you think, you are on partial panel in cloud.',
        },
        `A failed gyro keeps showing something plausible, which is what makes it dangerous. Cover it first. Then, with visibility ${vis >= ctx.minimums.visibilitySm ? 'at' : 'under'} your minimum, the nearer field is the shorter exposure.`,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 7.3

const QA = chartAirport('KXQA')!;
const cp = (id: string) => practiceRegion.checkpoints.find((c) => c.id === id)!;
const asPoint = (p: ChartAirport | Checkpoint): NavPoint => ({ id: p.id, name: p.name, lat: p.pos.lat, lon: p.pos.lon });

const gps: Lesson = {
  id: '7.3', module: 7, minutes: 16,
  title: 'GPS failure and paper backup',
  summary: 'Lose the GPS mid-trip and finish by pilotage and dead reckoning from the nav log you built on the ground.',
  acs: ['PA.VI.A', 'PA.VI.B', 'PA.IX.C'],
  refs: ['PHAK, pilotage and dead reckoning', 'PHAK, GPS', 'AIM 1-1-17', '14 CFR 91.103'],
  build(ctx) {
    const { perf, sample } = airplane(ctx);
    const route = [asPoint(HOME), asPoint(cp('harlow')), asPoint(cp('long-lake')), asPoint(cp('pinecrest')), asPoint(QA)];
    const windFrom = 300;
    const windKt = 15;
    const log = navLog(route, { tasKt: perf.cruise.tasKt, windFromTrue: windFrom, windKt, variationDeg: VARIATION, gph: perf.cruise.gph });
    const flown = log.legs.slice(0, 2);
    const next = log.legs[2];
    const last = log.legs[3];
    const nextWind = windTriangle(next.trueCourse, perf.cruise.tasKt, windFrom, windKt);
    const elapsed = flown.reduce((n, l) => n + l.minutes, 0) + 8;
    const remaining = next.minutes + last.minutes;
    const enduranceMin = 210;
    const reserve = 30;
    const fuelMarginMin = enduranceMin - elapsed - remaining - reserve;
    const vis = Math.max(ctx.minimums.visibilitySm + 3, 8);
    const grades = gradeGpsLoss({ visibilitySm: vis, minimumSm: ctx.minimums.visibilitySm, fuelMarginMin, checkpointAhead: true });
    const lake = cp('long-lake');
    const chart: Figure = { kind: 'chart', route: route.map((p) => p.id), highlight: [lake.id, 'pinecrest'], focus: { id: lake.id, radiusNm: 25 }, marker: { pos: lake.pos, altMsl: 5500, label: 'GPS out' } };
    const wcaText = (w: number) => (w === 0 ? 'none' : `${Math.abs(w)}° ${w > 0 ? 'right' : 'left'}`);

    return [
      {
        kind: 'brief', id: 'b1', title: 'The screen goes quiet',
        scene: `Off ${HOME.id} for ${QA.name}, ${fmt(log.totalNm)} nm west at 5,500 feet. Over ${lake.name} the GPS shows a loss of integrity, then no position at all.${onTheChart(ctx)}`,
        say: {
          full: 'GPS checks itself: the receiver needs extra satellites to prove the position is right, and when it cannot, it says so and stops guiding you. Receivers fail, antennas fail, and GPS can be jammed or tested off for miles. On a VFR flight that is an inconvenience, not an emergency, **if** you planned the way the knowledge test asks: a route drawn on the chart, checkpoints you can see, and a nav log with headings and times. Then the GPS was a convenience laid over a plan that still works.',
          short: 'GPS out: back to the nav log and the window.',
        },
        figure: chart,
      },
      {
        kind: 'example', id: 'e1', title: 'The log you built on the ground',
        say: {
          full: `Here is the nav log, with wind from ${deg(windFrom)} at ${windKt}. The leg you just flew shows the pattern: true course from the chart, the wind correction angle, true heading, then variation (${Math.abs(VARIATION)}° west, so add it) for the magnetic heading you hold. Your last fix was ${lake.name}, on time. Dead reckoning starts from there.${sampleLine(sample)}`,
          short: 'Last fix, heading, groundspeed, time.',
        },
        figure: { kind: 'navlog', log, altitudeMsl: 5500 },
        work: [
          { label: 'Leg', value: `${flown[1].from.name} to ${flown[1].to.name}` },
          { label: 'True course', value: `${deg(flown[1].trueCourse)}°`, note: `${flown[1].distanceNm} nm` },
          { label: 'Wind correction', value: wcaText(flown[1].wcaDeg), note: `True heading ${deg(flown[1].trueHeading)}°` },
          { label: 'Magnetic heading', value: `${deg(flown[1].magHeading)}°`, note: `${deg(flown[1].trueHeading)} + ${Math.abs(VARIATION)} west` },
          { label: 'Groundspeed', value: `${flown[1].groundspeedKt} kt`, note: `${flown[1].minutes} minutes on the leg` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Next leg, ${next.from.name} to ${next.to.name}: true course ${deg(next.trueCourse)}°, ${next.distanceNm} nm, TAS ${perf.cruise.tasKt} kt, wind ${deg(windFrom)}° at ${windKt}. What magnetic heading do you hold, what groundspeed do you expect, and how many minutes to ${next.to.name}?`,
        figure: chart,
        blanks: [
          { id: 'mh', label: 'Magnetic heading', unit: '°', answer: next.magHeading, tolerance: 3,
            explain: `Wind correction ${wcaText(next.wcaDeg)} gives true heading ${deg(next.trueHeading)}°; add ${Math.abs(VARIATION)}° west for ${deg(next.magHeading)}° magnetic.` },
          { id: 'gs', label: 'Groundspeed', unit: 'kt', answer: next.groundspeedKt, tolerance: 3,
            explain: `The wind gives a ${nextWind.headwindKt >= 0 ? 'headwind' : 'tailwind'} of about ${Math.abs(nextWind.headwindKt)} knots on this leg: about ${next.groundspeedKt} knots over the ground.` },
          { id: 'ete', label: 'Minutes to the checkpoint', unit: 'min', answer: next.minutes, tolerance: 1,
            explain: `${next.distanceNm} nm at ${next.groundspeedKt} knots is ${next.minutes} minutes. Note the time over the lake and add it.` },
        ],
      },
      decision('d1', 'Over the lake, no GPS',
        `Visibility ${vis} miles. ${cp('pinecrest').name} should show up in ${next.minutes} minutes: ${cp('pinecrest').looksLike.toLowerCase()} You left with ${Math.floor(enduranceMin / 60)} hours ${enduranceMin % 60} minutes of fuel and have flown ${elapsed} minutes.`,
        chart,
        {
          pilotage: `Hold ${deg(next.magHeading)}°, time the leg, and confirm ${cp('pinecrest').name} when it shows up. Finish the trip on the chart.`,
          'ask-atc': 'Call approach for flight following and ask for help with position, and keep flying the nav log.',
          'turn-back': `Turn around and fly home to ${HOME.id}.`,
          nearest: 'Land at the nearest field and sort out the GPS on the ground.',
        },
        grades,
        { pilotage: 'best', 'ask-atc': 'best', 'turn-back': 'acceptable', nearest: 'acceptable' },
        {
          pilotage: `${cp('pinecrest').name} shows up a minute late; the wind is a little stronger than forecast. You correct and land at ${QA.name} ${remaining + 2} minutes after the lake, with ${fuelMarginMin - 2} minutes of fuel past your reserve.`,
          'ask-atc': 'Approach puts you on radar and confirms you are on course. Help you ask for early is help you do not need to beg for later, and you still flew the log.',
          'turn-back': 'Safe, and you know the way home. But the airplane flies the same without the GPS, and the trip ahead was planned and in good weather.',
          nearest: 'Nothing wrong with it, though nothing about this flight needed it either.',
        },
        `In good visibility, with a checkpoint ahead and ${fuelMarginMin} minutes of fuel past your reserve, nothing about the flight changed except the screen.`,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 7.4

const carbIce: Lesson = {
  id: '7.4', module: 7, minutes: 18,
  title: 'Carburetor ice and fuel systems',
  summary: 'Read icing risk from the temperature and dew point, use carb heat the way the PHAK says, and keep track of which tank is feeding.',
  acs: ['PA.I.G', 'PA.IX.C'],
  refs: ['PHAK, carburetor icing', 'PHAK, fuel systems', 'POH section 3, rough engine operation or loss of power'],
  build(ctx) {
    const { perf, sample } = airplane(ctx);
    const tempC = 12;
    const dewC = 10;
    const rh = relativeHumidity(tempC, dewC);
    const risk = carbIceRisk(tempC, dewC);
    const rpmGrades = gradeRpmLoss(risk);
    const ownTanks = ctx.aircraft.usableFuelGal > 0;
    const tankGal = ownTanks ? r1(ctx.aircraft.usableFuelGal / 2) : 20;
    const minutesOnTank = Math.floor(((tankGal - perf.taxiFuelGal - 1) / perf.cruise.gph) * 60);
    const usedGal = r1(perf.taxiFuelGal + (perf.cruise.gph * minutesOnTank) / 60);
    const leftGal = r1(tankGal - usedGal);
    const roughGrades = gradeRoughEngine({ tankLeftGal: leftGal });
    const chart: Figure = { kind: 'carbIce', tempC, dewC, rhPct: rh, risk };
    const report: Figure = {
      kind: 'metar', marks: [`${tempC}/${dewC}`],
      raw: metarText({ station: ctx.airport.icao, at: observedAt(ctx.now), wind: { dirTrue: 200, speedKt: 6 }, vis: '7SM', sky: [cloud('SCT', 4500)], tempC, dewC, altimeter: 30.04 }),
    };
    const hm = (m: number) => `${Math.floor(m / 60)} hour${m >= 120 ? 's' : ''} ${m % 60} minutes`;

    return [
      {
        kind: 'brief', id: 'b1', title: 'Ice on a warm day',
        scene: `A soft spring morning, ${tempC}°C with a dew point of ${dewC}. You are cruising at 3,500 feet in an airplane with a float carburetor.`,
        say: {
          full: 'Air speeds up through the carburetor\'s venturi, its pressure drops, and the fuel evaporating into it takes heat with it. The PHAK puts the drop at as much as **70°F, about 38°C**, so ice forms on the throttle plate on days nobody would call icy. The PHAK chart plots the risk against temperature and humidity. If your engine is fuel-injected you can skip the ice, but not the rest of this lesson.',
          short: 'Humid air, a carburetor, and any temperature on the chart: think ice.',
        },
        figure: report,
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'From the report: what is the spread, about what relative humidity does that give, and where does today sit on the chart?',
        figure: report,
        blanks: [
          { id: 'spread', label: 'Spread', unit: '°C', answer: tempC - dewC, tolerance: 0, explain: `${tempC} minus ${dewC}.` },
          { id: 'rh', label: 'Relative humidity', unit: '%', answer: rh, tolerance: 5,
            explain: `A ${tempC - dewC} degree spread at ${tempC}°C is about ${rh} percent.` },
          { id: 'risk', label: 'On the chart', answer: CARB_ICE_LABEL[risk], choices: Object.values(CARB_ICE_LABEL),
            explain: `${tempC}°C is inside the -7 to 21°C band, and ${rh} percent is ${rh >= 80 ? 'above' : 'below'} the 80 percent line.` },
        ],
      },
      {
        kind: 'example', id: 'e1', title: 'What it looks like',
        say: {
          full: 'With a fixed-pitch propeller, the first sign is a slow **drop in rpm**, then roughness. With a constant-speed propeller the rpm holds and the **manifold pressure** drops. Full carb heat is both the test and the cure, and it gets worse before it gets better.',
          short: 'Rpm drops slowly. Full heat: worse, then better.',
        },
        work: [
          { label: 'Ice there, full heat', value: 'Rpm drops, then rises', note: 'Heated air is less dense, then the ice melts. Expect roughness as the water goes through.' },
          { label: 'No ice, full heat', value: 'Rpm drops and stays', note: 'Then rises back when the heat goes off' },
          { label: 'Partial heat', value: 'Avoid it', note: 'Without a carb temperature gauge it can warm the air into the icing range' },
          { label: 'Descent', value: 'Heat on first', note: 'Ice builds unnoticed at low power; heat on before you close the throttle' },
        ],
      },
      decision('d1', 'Rpm creeping down',
        `Over ten minutes the rpm has crept down about 150 with the throttle where you left it, and the engine has the first hint of roughness.`,
        chart,
        {
          'full-heat': 'Full carb heat, and leave it on until the rpm comes back.',
          'partial-heat': 'Pull the heat half way. Full heat costs too much power.',
          'more-throttle': 'Add throttle to get the rpm back.',
          lean: 'Lean the mixture. It is probably running rich.',
        },
        rpmGrades,
        { 'full-heat': 'best', 'partial-heat': 'unsafe', 'more-throttle': 'unsafe', lean: 'marginal' },
        {
          'full-heat': 'The rpm drops another 100 and the engine shakes for half a minute, then it smooths out and climbs past where it started. You leave the heat on a while longer, then check again every few minutes.',
          'partial-heat': 'Half heat warms the air just enough to keep the moisture liquid until it hits the cold throttle plate. The ice builds faster.',
          'more-throttle': 'More throttle hides the symptom and feeds the ice more humid air. The rpm drops again, and now there is less throttle left to add.',
          lean: 'Leaning changes the mixture, not the ice. The rpm keeps sliding.',
        },
        `${CARB_ICE_LABEL[risk]} on the chart, and a slow rpm loss is the textbook first sign. Full heat until it is gone.`,
      ),
      {
        kind: 'example', id: 'e2', title: 'Which tank is feeding',
        say: {
          full: `Now the fuel system. Some airplanes feed from both tanks at once; many make you pick one. Suppose this one feeds from one tank at a time, ${ownTanks ? `${tankGal} usable gallons a side from your profile` : `${tankGal} usable gallons a side for this lesson`}, and you have been on the left tank since the run-up, ${hm(minutesOnTank)} ago. Light airplane fuel gauges are not precise enough to plan on, so the clock is the gauge.${sampleLine(sample)}`,
          short: 'The clock is the fuel gauge.',
        },
        work: [
          { label: 'Taxi and run-up', value: `${perf.taxiFuelGal} gal` },
          { label: 'Cruise', value: `${r1((perf.cruise.gph * minutesOnTank) / 60)} gal`, note: `${perf.cruise.gph} gph for ${minutesOnTank} minutes` },
          { label: 'Used from the left', value: `${usedGal} gal` },
          { label: 'Left in it', value: `${leftGal} gal`, note: `${tankGal} − ${usedGal}` },
        ],
      },
      decision('d2', 'A stumble',
        `A few minutes later the engine stumbles, surges, and stumbles again. Carb heat is already on. The left tank has about ${leftGal} gallon${leftGal === 1 ? '' : 's'} by the clock.`,
        undefined,
        {
          'switch-tank': 'Fuel selector to the other tank, mixture rich, fuel pump on if you have one.',
          'heat-off': 'Carb heat off. Maybe the heat is making it run rough.',
          'land-now': 'Pick a field and set up for a precautionary landing.',
        },
        roughGrades,
        { 'switch-tank': 'best', 'heat-off': 'unsafe', 'land-now': 'marginal' },
        {
          'switch-tank': 'Two seconds later the engine catches and runs smoothly. You note the time on the right tank, and you will land with the fuel your plan said.',
          'heat-off': 'The heat was not the problem; an empty tank was. The engine quits.',
          'land-now': 'Picking a field is never wrong when an engine is unhappy, but the fix was one hand movement away, and the arithmetic said so.',
        },
        `About ${leftGal} gallon${leftGal === 1 ? '' : 's'} is a tank running dry, and a dry tank sounds exactly like this. Fuel first, then everything else.`,
      ),
    ];
  },
};

export const systemsLessons: Lesson[] = [alternator, instruments, gps, carbIce];
