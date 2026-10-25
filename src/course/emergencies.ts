// Module 6, Emergencies: five flights where the engine, a fire or the field
// below decides how much time you have. Every number comes from the
// airplane's own glide and landing performance (lib/emergency.ts), or from the
// labeled sample set when the airplane has none, and every grade from
// scenarios/emergency.ts. 6.1 is built on the pilot's own runway; 6.2 and 6.5
// fly over the practice sectional; 6.3 and 6.4 are set over made-up ground
// near the pilot's field, and say so.

import { chartAirport, practiceRegion } from '../chart/practiceRegion';
import {
  checkField, glideReachNm, glideSinkFpm, glidingTurn, headwindOn, reach, turnback, TURNBACK_DEG, type Field, type FieldCheck,
} from '../lib/emergency';
import { destination, distanceNm, trueCourse, windTriangle } from '../lib/nav';
import { climbRate, isaTempC, landingDistance, sampleTrainerPerformance, type Performance } from '../lib/perf';
import { norm } from '../lib/wind';
import {
  gradeAfterTakeoff, gradeEngineFire, gradeField, gradeFireResponse, gradeGlideChoice, gradePartialPower, type EngineFireOption, type FireResponse,
} from '../scenarios/emergency';
import { magToTrue, mainRunway } from './practice';
import type { Figure, Lesson, LessonContext } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const nm1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const deg3 = (n: number) => String(Math.round(norm(n)) || 360).padStart(3, '0');
const min1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** The airplane's performance, or the labeled sample set when it has none. */
function airplane(ctx: LessonContext): { perf: Performance; sample: boolean; source: string } {
  const own = ctx.aircraft.performance;
  const sample = !own || ctx.aircraft.sampleValues;
  return {
    perf: own ?? sampleTrainerPerformance(),
    sample,
    source: sample
      ? 'These numbers come from a **sample** performance set, not your POH. Put your own figures in the airplane profile and they follow.'
      : 'These numbers come from the performance figures in your airplane profile.',
  };
}

function fieldName(ctx: LessonContext): string {
  return ctx.practiceField ? 'the practice field' : ctx.airport.icao;
}

/** Left or right of a heading, for a bearing. */
function side(headingTrue: number, bearingTrue: number): 'left' | 'right' {
  return norm(bearingTrue - headingTrue) > 180 ? 'left' : 'right';
}

/** The first of the four field tests a field fails, in the order you run them. */
function firstFail(c: FieldCheck): string | null {
  if (!c.reach.reachable) return 'reach';
  if (c.headwindKt < 0) return 'wind';
  if (!c.fits) return 'length';
  if (c.rough) return 'surface';
  return null;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const compass = (brgTrue: number) => COMPASS[Math.round(norm(brgTrue) / 45) % 8];

const PRACTICE_NOTE = 'This flight is over the practice sectional, a made-up stretch of country, whatever your home field is.';

// ---------------------------------------------------------------- 6.1

const afterTakeoff: Lesson = {
  id: '6.1', module: 6, minutes: 15,
  title: 'Engine failure after takeoff',
  summary: 'Work out what a turn back actually costs in your airplane, then make the call in the seconds you have.',
  acs: ['PA.IX.B'],
  refs: ['Airplane Flying Handbook (FAA-H-8083-3), engine failure after takeoff', 'POH, emergency procedures'],
  build(ctx) {
    const f = ctx.airport;
    const { perf, sample, source } = airplane(ctx);
    const rwy = mainRunway(f);
    const rwyTrue = magToTrue(f, rwy.headingMag);
    const windFrom = norm(rwyTrue + 10);
    const windKt = 8;
    const head = headwindOn(rwyTrue, windFrom, windKt);
    const oatC = 15;
    const climbFpm = Math.round(climbRate(perf, f.elevationFt, oatC).value);
    const sink = Math.round(glideSinkFpm(perf));

    const banks = [30, 45, 60].map((b) => glidingTurn(perf, b, TURNBACK_DEG));
    const t45 = banks[1];
    const probe = turnback(perf, { failureAglFt: 0, climbFpm, headwindKt: head });
    // The engine quits at or below the height the reaction and the turn cost, so the turn cannot finish.
    const h = Math.max(300, Math.floor((probe.reactionLossFt + t45.altitudeLostFt) / 100) * 100);
    const tb = turnback(perf, { failureAglFt: h, climbFpm, headwindKt: head });
    const glideFt = h - tb.reactionLossFt;
    const seconds = Math.round((glideFt / sink) * 60);

    // A field just right of the nose, inside the glide; a bigger one off the left wing, a 90° turn away.
    const aheadBrg = norm(rwyTrue + 20);
    const aheadReachNm = glideReachNm(perf, glideFt, aheadBrg, windFrom, windKt);
    const ahead = reach(perf, glideFt, aheadBrg, Math.max(0.1, aheadReachNm * 0.6), windFrom, windKt, 0);
    const sideTurn = glidingTurn(perf, 30, 90);
    const sideBrg = norm(rwyTrue - 90);
    const sideLeft = glideFt - sideTurn.altitudeLostFt;
    const sideField = reach(perf, sideLeft, sideBrg, Math.max(0.3, aheadReachNm * 0.9), windFrom, windKt, 0);
    const runwayNm = tb.outFt / 6076;
    const runwayReachable = tb.turnCompletes && tb.heightAfterTurnFt >= tb.glideBackNeedFt;
    const grades = gradeAfterTakeoff({ turnCompletes: tb.turnCompletes, aheadReachable: ahead.reachable, sideReachable: sideField.reachable });

    const h2 = h + 200;
    const tb2 = turnback(perf, { failureAglFt: h2, climbFpm, headwindKt: head });

    const glideFig: Figure = {
      kind: 'glide', heightAglFt: h, rangeNm: glideReachNm(perf, glideFt, 0, 0, 0), windFromTrue: windFrom, windKt,
      fields: [
        { name: 'Field ahead', bearingTrue: ahead.bearingTrue, distanceNm: ahead.distanceNm, reachable: ahead.reachable },
        { name: 'Big field', bearingTrue: sideField.bearingTrue, distanceNm: sideField.distanceNm, reachable: sideField.reachable },
        { name: `Runway ${rwy.id}`, bearingTrue: Math.round(norm(rwyTrue + 180)), distanceNm: Math.round(runwayNm * 10) / 10, reachable: runwayReachable },
      ],
    };

    return [
      {
        kind: 'brief', id: 'b1', title: 'The climb out',
        scene: `Runway ${rwy.id} at ${fieldName(ctx)}, a normal takeoff into a light wind, climbing at ${perf.vyKias} knots. The farmland ahead is made up for this lesson.`,
        say: {
          full: `If the engine quits on the climb out, the first thing you do is not a decision, it is a movement: **lower the nose** to the glide attitude, now. At the climb attitude with no thrust the airspeed bleeds off in seconds, and a stall this low has no room for recovery. Then land **ahead**, within about 30° either side of the nose. The AFH calls that the option with the lowest risk. The turn back to the runway feels like the safe choice, and this lesson works out why it so often is not.`,
          short: 'Nose down first. Then land ahead, within about 30° of the nose.',
        },
      },
      {
        kind: 'example', id: 'e1', title: 'What the turn costs',
        say: {
          full: `The AFH counts a turn back as ${TURNBACK_DEG}°: 180° to reverse, then 45° more to point at the runway, after a ${tb.reactionSec} second reaction. Here it is in your airplane, gliding at ${perf.bestGlideKias} knots with a glide ratio of ${perf.glideRatio} to 1. A steeper bank turns faster but sinks faster, and you have to fly faster to keep the same margin over the stall. The height lost is least near **45°**. ${source}`,
          short: `${TURNBACK_DEG}° of turn plus the reaction. Least height lost near 45°.`,
        },
        work: [
          { label: 'Reaction', value: `${fmt(tb.reactionLossFt)} ft`, note: `${tb.reactionSec} seconds at ${fmt(sink)} ft/min, already gliding` },
          ...banks.map((t) => ({
            label: `${TURNBACK_DEG}° at ${t.bankDeg}° bank`, value: `${fmt(t.altitudeLostFt)} ft`,
            note: `${t.seconds} s at ${t.speedKias} kt, sinking ${fmt(t.sinkFpm)} ft/min. Stall speed up ${t.stallRisePct}%.`,
          })),
          { label: 'Climb out', value: `${fmt(climbFpm)} ft/min`, note: `At ${perf.vyKias} kt from the climb chart at ${fmt(f.elevationFt)} ft${sample ? ', sample chart' : ''}` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Say it quits higher, at ${fmt(h2)} feet above the ground. Work the turn back at a 45° bank.`,
        blanks: [
          { id: 'n', label: 'Load factor in a 45° bank', unit: 'G', answer: t45.loadFactor, tolerance: 0.05,
            explain: `One over the cosine of the bank: 1 ÷ cos 45° is ${t45.loadFactor.toFixed(2)}.` },
          { id: 'stall', label: 'Stall speed rise', unit: '%', answer: t45.stallRisePct, tolerance: 2,
            explain: `Stall speed goes up with the square root of the load factor: √${t45.loadFactor.toFixed(2)} is about ${(1 + t45.stallRisePct / 100).toFixed(2)}, so ${t45.stallRisePct}% higher.` },
          { id: 'left', label: 'Height left after the reaction and the turn', unit: 'ft', answer: tb2.heightAfterTurnFt, tolerance: 20,
            explain: `${fmt(h2)} − ${fmt(tb2.reactionLossFt)} − ${fmt(t45.altitudeLostFt)} = ${fmt(tb2.heightAfterTurnFt)} feet. To glide back to where you lifted off you would need about ${fmt(tb2.glideBackNeedFt)}, with the wind behind you. ${tb2.heightAfterTurnFt >= tb2.glideBackNeedFt ? 'It works on paper, which is not the same as working on the day.' : 'Unless most of the runway is still ahead of that point, it is short, and that assumes a perfectly flown turn.'}` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: `${fmt(h)} feet, and quiet`,
        situation: `Climbing through ${fmt(h)} feet above the ground, the engine stops. The runway is ${nm1(runwayNm)} nm behind you. A mown field sits ${nm1(ahead.distanceNm)} nm ahead, just ${side(rwyTrue, aheadBrg)} of the nose. Off your left wing, ${nm1(sideField.distanceNm)} nm away, is a bigger one.`,
        figure: glideFig,
        options: [
          { id: 'land-ahead', label: 'Nose down, and land in the field ahead.' },
          { id: 'turn-back', label: 'Turn back for the runway.' },
          { id: 'side-field', label: 'Turn 90° left for the bigger field.' },
          { id: 'restart-first', label: 'Hold the attitude and try a restart first.' },
        ],
        grades,
        consequence: {
          'land-ahead': ahead.reachable
            ? `You lower the nose and the airspeed settles at ${perf.bestGlideKias} knots. You have about ${seconds} seconds: fuel and mixture off, flaps as you need them, door unlatched, master off before touchdown. You touch down into the wind, at the slowest groundspeed you can have. The airplane may be bent. You walk away.`
            : `The field is ${nm1(ahead.distanceNm)} nm and your glide reaches ${nm1(ahead.reachNm)} that way. You touch down short of it, but under control and into the wind, which is still the landing you want.`,
          'turn-back': tb.turnCompletes
            ? `You make it around with ${fmt(tb.heightAfterTurnFt)} feet left and the runway ${nm1(runwayNm)} nm away, downwind. Gliding back to where you lifted off takes about ${fmt(tb.glideBackNeedFt)}. Pilots who practice this in their own airplane with an instructor sometimes make it. Untrained, on the day, most do not.`
            : `The reaction and the turn cost ${fmt(tb.reactionLossFt + t45.altitudeLostFt)} feet and you have ${fmt(h)}. Partway around, steeply banked and slow, you run out of height. This is the accident the AFH calls "the impossible turn".`,
          'side-field': sideField.reachable
            ? `A 90° turn at 30° bank costs ${fmt(sideTurn.altitudeLostFt)} feet, and the field is just inside what is left. You make it, crosswind and with no margin. The field ahead asked for less.`
            : `A 90° turn at 30° bank costs ${fmt(sideTurn.altitudeLostFt)} feet, leaving ${fmt(Math.max(0, sideLeft))} feet and ${nm1(sideField.reachNm)} nm of glide. The field is ${nm1(sideField.distanceNm)} nm away. You land short, crosswind, in whatever is between.`,
          'restart-first': `Without the engine, the climb attitude is a stall attitude. In the few seconds you spend on the mixture and the key, the airspeed falls toward the stall at a height with no room to recover. Nose down first. A restart, if there is time, happens on the way down.`,
        },
        why: `At ${fmt(h)} feet the reaction and a 45° turn back cost ${fmt(tb.reactionLossFt + t45.altitudeLostFt)} feet${tb.turnCompletes ? '' : ', more than you have'}. Ahead is a landing under control, into the wind and slow over the ground. Know your own airplane's turn back height before you need it, and practice it only with an instructor, at altitude.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 6.2

const atAltitude: Lesson = {
  id: '6.2', module: 6, minutes: 15,
  title: 'Engine failure at altitude',
  summary: 'Fly the glide from cruise: best glide, a field you can actually reach with the wind, then the checklist and the call.',
  acs: ['PA.IX.B'],
  refs: ['Airplane Flying Handbook (FAA-H-8083-3), terrain selection', 'AIM 6-3-1', 'AIM 6-2-2', 'POH, emergency procedures'],
  build(ctx) {
    const { perf, source } = airplane(ctx);
    const home = chartAirport('KXYZ')!;
    const mill = chartAirport('2X5')!;
    const course = trueCourse(home.pos, mill.pos);
    const pos = destination(home.pos, course, distanceNm(home.pos, mill.pos) / 2);
    const altMsl = 6500;
    const groundFt = practiceRegion.groundFt(pos);
    const agl = altMsl - groundFt;
    const windFrom = 290;
    const windKt = 20;
    const sink = Math.round(glideSinkFpm(perf));

    const at = (a: typeof home) => ({ a, r: reach(perf, agl, trueCourse(pos, a.pos), distanceNm(pos, a.pos), windFrom, windKt) });
    const ahead = at(mill);
    const behind = at(home);
    const still = glideReachNm(perf, agl - 1000, 0, 0, 0);
    const gsInto = perf.bestGlideKias - headwindOn(ahead.r.bearingTrue, windFrom, windKt);
    const gsWith = perf.bestGlideKias - headwindOn(behind.r.bearingTrue, windFrom, windKt);
    const cands = [ahead, behind].map((c) => ({ id: c.a.id, reachable: c.r.reachable, marginNm: Math.round((c.r.reachNm - c.r.distanceNm) * 10) / 10 }));
    const grades = gradeGlideChoice(cands);
    const anyReachable = cands.some((c) => c.reachable);
    const canReach = ahead.r.reachable && behind.r.reachable ? 'Both' : ahead.r.reachable ? `${mill.name} (${mill.id})` : behind.r.reachable ? home.id : 'Neither';

    // A minute of checklist before turning: height spent, and the field behind drifting away.
    const lateDist = behind.r.distanceNm + gsInto / 60;
    const late = reach(perf, agl - sink, behind.r.bearingTrue, lateDist, windFrom, windKt);

    const called = (a: typeof home) => (a.id === home.id ? home.id : a.name);
    const said = (c: typeof ahead, where: string) => c.r.reachable
      ? `You turn, trim for ${perf.bestGlideKias} knots and head for ${called(c.a)}, ${where}. You arrive with ${nm1(c.r.reachNm - c.r.distanceNm)} nm to spare and the 1,000 feet you kept for a pattern. The restart flow and the radio call happen on the way. You fly a close pattern and land.`
      : `${called(c.a)} is ${nm1(c.r.distanceNm)} nm away and the glide reaches ${nm1(c.r.reachNm)} that way. You come up ${nm1(c.r.distanceNm - c.r.reachNm)} nm short, low, over ground you did not choose.`;

    return [
      {
        kind: 'brief', id: 'b1', title: 'Cruise, then quiet',
        scene: `Westbound at ${fmt(altMsl)} feet, halfway from KXYZ to ${mill.name} (${mill.id}), a grass strip. The wind up here is from ${deg3(windFrom)} at ${windKt} knots, nearly on the nose. The engine coughs twice and stops. ${PRACTICE_NOTE}`,
        say: {
          full: `Height is time, and the order is the same every time. **Airspeed**: pitch for best glide, ${perf.bestGlideKias} knots in your airplane, and trim for it. **Best field**: turn toward somewhere you can reach. **Checklist**: the restart flow in your POH, usually fuel selector, mixture, carb heat or alternate air, magnetos, primer. Then **declare**: say "Mayday" on the frequency you are on or 121.5, and squawk 7700. The field comes before the checklist because the field is the part that runs out.`,
          short: 'Airspeed, best field, checklist, then declare.',
        },
        figure: { kind: 'chart', route: ['KXYZ', mill.id], marker: { pos, altMsl, label: 'Engine out' } },
      },
      {
        kind: 'example', id: 'e1', title: 'How far, and which way',
        say: {
          full: `Glide range starts from height above the **ground**, not the altimeter. Keep about 1,000 feet in hand for a pattern at the other end, then multiply what is left by the glide ratio. The wind changes your groundspeed, not how fast you come down, so a headwind shortens the range and a tailwind stretches it by the ratio of groundspeed to airspeed. Here is the way you are pointed, into the wind. ${source}`,
          short: 'Height above the ground, less 1,000, times the glide ratio. Then the wind.',
        },
        figure: { kind: 'chart', route: ['KXYZ', mill.id], marker: { pos, altMsl, label: 'Engine out' } },
        work: [
          { label: 'Altitude', value: `${fmt(altMsl)} ft MSL` },
          { label: 'Ground below', value: `${fmt(groundFt)} ft`, note: 'From the chart' },
          { label: 'Height', value: `${fmt(agl)} ft AGL` },
          { label: 'Kept for the pattern', value: '1,000 ft' },
          { label: 'Still air', value: `${nm1(still)} nm`, note: `${fmt(agl - 1000)} ft × ${perf.glideRatio} ÷ 6,076 ft per nm` },
          { label: `Toward ${mill.id}`, value: `${nm1(ahead.r.reachNm)} nm`, note: `Groundspeed ${Math.round(gsInto)} kt instead of ${perf.bestGlideKias}. ${mill.id} is ${nm1(ahead.r.distanceNm)} nm.` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now the other way, back toward KXYZ with the wind behind you. KXYZ is ${nm1(behind.r.distanceNm)} nm away.`,
        blanks: [
          { id: 'gs', label: 'Groundspeed toward KXYZ', unit: 'kt', answer: Math.round(gsWith), tolerance: 2,
            explain: `${perf.bestGlideKias} knots plus about ${Math.round(gsWith - perf.bestGlideKias)} of tailwind.` },
          { id: 'reach', label: 'Glide reach toward KXYZ', unit: 'nm', answer: behind.r.reachNm, tolerance: 0.3,
            explain: `${nm1(still)} nm in still air × ${Math.round(gsWith)} ÷ ${perf.bestGlideKias} is about ${nm1(behind.r.reachNm)} nm.` },
          { id: 'which', label: 'Which can you reach?', answer: canReach, choices: [`${mill.name} (${mill.id})`, home.id, 'Both', 'Neither'],
            explain: `${mill.id}: ${nm1(ahead.r.distanceNm)} nm away, ${nm1(ahead.r.reachNm)} nm of glide. KXYZ: ${nm1(behind.r.distanceNm)} nm away, ${nm1(behind.r.reachNm)} nm of glide.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Which way?',
        situation: `Trimmed at ${perf.bestGlideKias} knots, ${fmt(agl)} feet above the ground and coming down at about ${fmt(sink)} feet a minute. ${mill.id} is ${nm1(ahead.r.distanceNm)} nm ahead into the wind. KXYZ is ${nm1(behind.r.distanceNm)} nm behind you.`,
        figure: {
          kind: 'glide', heightAglFt: agl, rangeNm: still, windFromTrue: windFrom, windKt,
          fields: [ahead, behind].map((c) => ({ name: c.a.id, bearingTrue: c.r.bearingTrue, distanceNm: c.r.distanceNm, reachable: c.r.reachable })),
        },
        options: [
          { id: `glide-${mill.id.toLowerCase()}`, label: `Hold course for ${mill.name}, ${nm1(ahead.r.distanceNm)} nm ahead.` },
          { id: 'glide-kxyz', label: `Turn back for KXYZ, ${nm1(behind.r.distanceNm)} nm behind.` },
          { id: 'off-airport', label: 'Pick a field below and plan the landing there.' },
          { id: 'troubleshoot-first', label: 'Hold heading and run the restart checklist, then decide.' },
        ],
        grades,
        consequence: {
          [`glide-${mill.id.toLowerCase()}`]: said(ahead, 'ahead'),
          'glide-kxyz': said(behind, 'behind you'),
          'off-airport': anyReachable
            ? 'A field you pick early is a real option, and the AFH would back you. But a runway you can reach with margin is better: a known surface, a clear approach, and people who can help.'
            : 'With no runway in reach, a field chosen early, while you still have height to look it over, is the right call.',
          'troubleshoot-first': `A minute on the checklist before turning costs about ${fmt(sink)} feet and carries you ${nm1(gsInto / 60)} nm farther from KXYZ. ${late.reachable ? 'You can still make it, with less in hand.' : 'That is enough to put it out of reach.'} Turn first, then troubleshoot.`,
        },
        why: `${mill.id} is ${Math.abs(ahead.r.distanceNm - behind.r.distanceNm) < 0.2 ? 'just as close' : ahead.r.distanceNm < behind.r.distanceNm ? 'closer' : 'farther'}, but the wind decides: toward it you reach ${nm1(ahead.r.reachNm)} nm, toward KXYZ ${nm1(behind.r.reachNm)}. Pick the field by reach, not by distance.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 6.3

const fire: Lesson = {
  id: '6.3', module: 6, minutes: 14,
  title: 'Fire in flight',
  summary: 'An electrical fire and an engine fire: take away what feeds each one, then get on the ground as fast as you can reach it.',
  acs: ['PA.IX.A', 'PA.IX.C'],
  refs: ['Airplane Flying Handbook (FAA-H-8083-3), in-flight fire', 'Airplane Flying Handbook (FAA-H-8083-3), emergency descents', 'POH, emergency procedures'],
  build(ctx) {
    const { perf, source } = airplane(ctx);
    const sink = Math.round(glideSinkFpm(perf));
    const spiral = glidingTurn(perf, 45, 360);
    const h = 4000;
    const minutesGlide = h / sink;
    const minutesSpiral = h / spiral.sinkFpm;

    const electrical: (FireResponse & { label: string; consequence: string })[] = [
      { id: 'master-off', cutsSource: true, landsSoon: true, label: 'Master and alternator off, then land at the nearest airport.',
        consequence: 'The smell fades within a minute. You fly the rest by hand and by window, call on a handheld if you have one, and land at the nearest airport. The fault turns out to be a chafed wire behind the panel.' },
      { id: 'one-by-one', cutsSource: true, landsSoon: false, label: 'Master off, then bring things back one at a time to find it, and continue.',
        consequence: 'You find it on the third switch, when the smell comes back. The AFH describes this hunt for when electrical power is essential, and warns it recreates the problem. Here it was not essential, and you carried a fault all the way home.' },
      { id: 'vents-open', cutsSource: false, landsSoon: true, label: 'Open the vents and windows to clear the smoke.',
        consequence: 'The cabin clears for a moment, then the smoke thickens: the fresh air feeds what is burning and the circuit is still live. Close the vents, master off, and only ventilate once it is out.' },
      { id: 'press-on', cutsSource: false, landsSoon: false, label: 'It is just a smell. Continue and have it looked at.',
        consequence: 'The smell of burning insulation is the first sign of an electrical fire, and it rarely gets better on its own. Twenty minutes later the panel lights flicker and the smoke is visible.' },
    ];
    const elecGrades = Object.fromEntries(electrical.map((r) => [r.id, gradeFireResponse(r)]));

    // The engine fire: a field below, and an airport inside the glide.
    const brg = 60;
    const airportNm = Math.round(reach(perf, h, brg, 0, 0, 0).reachNm * 0.75 * 10) / 10;
    const toAirport = reach(perf, h, brg, airportNm, 0, 0);
    const minutesAirport = toAirport.reachable ? toAirport.minutes + 1000 / sink : null;
    const engineOpts: (EngineFireOption & { label: string })[] = [
      { id: 'cutoff-descend', cutsFuel: true, restarts: false, minutesToGround: minutesSpiral, label: 'Mixture to cut-off, fuel off, emergency descent to the field below.' },
      { id: 'cutoff-glide', cutsFuel: true, restarts: false, minutesToGround: minutesAirport, label: `Mixture to cut-off, fuel off, glide to the airport ${nm1(airportNm)} nm away.` },
      { id: 'keep-running', cutsFuel: false, restarts: false, minutesToGround: null, label: 'Keep the engine running to make the airport.' },
      { id: 'restart', cutsFuel: true, restarts: true, minutesToGround: null, label: 'Fuel off until the flames go out, then restart for the airport.' },
    ];
    const engGrades = gradeEngineFire(engineOpts);

    return [
      {
        kind: 'brief', id: 'b1', title: 'What feeds it',
        scene: `Level at cruise, ${fmt(h)} feet above made-up farmland near ${fieldName(ctx)}. Two flights, two different fires.`,
        say: {
          full: 'Every fire needs something to burn and something to keep it going. An **electrical** fire announces itself with the smell of burning insulation, and the electrical system feeds it: the **master** and **alternator** take that away. An **engine** fire is usually fuel or oil on something hot, seen as smoke or flame from the cowling: the **mixture to idle cut-off and the fuel selector off** take that away. Your POH has the exact checklist for your airplane, and it comes first. After that, the AFH puts it plainly: get the airplane on the ground.',
          short: 'Take away what feeds it, then get on the ground.',
        },
      },
      {
        kind: 'decide', id: 'd1', title: 'The smell behind the panel',
        situation: 'The sharp smell of hot insulation, and a thin haze from behind the radios. No flames. The ammeter is showing a discharge. The nearest airport is ten minutes away.',
        options: electrical.map((r) => ({ id: r.id, label: r.label })),
        grades: elecGrades,
        consequence: Object.fromEntries(electrical.map((r) => [r.id, r.consequence])),
        why: 'Master and alternator off removes the likely source in one movement. The AFH calls landing as soon as possible the most prudent course, and ventilating only after the fire is out.',
      },
      {
        kind: 'example', id: 'e1', title: 'Two ways down',
        say: {
          full: `Another day: smoke and flame from the cowling. With the fuel off you are a glider, and the only question is how quickly you can be on the ground. At best glide you come down slowly, which is what you want when you are trying to go far. An **emergency descent** banks 30° to 45° to come down fast while keeping a positive load on the wings. Here are both, from ${fmt(h)} feet, in your airplane. The descent below is the gentlest version, a 45° gliding turn at ${spiral.speedKias} knots; your POH may allow a faster one. ${source}`,
          short: 'Best glide to go far, an emergency descent to come down fast.',
        },
        work: [
          { label: 'Best glide', value: `${fmt(sink)} ft/min`, note: `${perf.bestGlideKias} kt ÷ glide ratio ${perf.glideRatio}, in feet per minute` },
          { label: '45° gliding turn', value: `${fmt(spiral.sinkFpm)} ft/min`, note: `At ${spiral.speedKias} kt, load factor ${spiral.loadFactor.toFixed(2)}` },
          { label: `From ${fmt(h)} ft, best glide`, value: `${min1(minutesGlide)} min` },
          { label: `From ${fmt(h)} ft, descending`, value: `${min1(minutesSpiral)} min` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `The airport is ${nm1(airportNm)} nm away in still air. Gliding there, how long until you are on the ground, counting about 1,000 feet for a pattern once you arrive?`,
        blanks: [
          { id: 'cruise', label: 'Minutes to get there at best glide', unit: 'min', answer: Math.round(toAirport.minutes * 10) / 10, tolerance: 0.3,
            explain: `${nm1(airportNm)} nm at ${perf.bestGlideKias} knots is ${min1(toAirport.minutes)} minutes.` },
          { id: 'total', label: 'Minutes to the ground, with the pattern', unit: 'min', answer: Math.round((minutesAirport ?? 0) * 10) / 10, tolerance: 0.4,
            explain: `Plus 1,000 feet at ${fmt(sink)} feet a minute: ${min1(1000 / sink)} more, so about ${min1(minutesAirport ?? 0)} minutes in all, against ${min1(minutesSpiral)} descending to the field below.` },
        ],
      },
      {
        kind: 'decide', id: 'd2', title: 'Flame from the cowling',
        situation: `${fmt(h)} feet above the ground. Orange flame along the cowling seam on the right side. A big flat field below you, and an airport ${nm1(airportNm)} nm away that you can glide to.`,
        options: engineOpts.map((o) => ({ id: o.id, label: o.label })),
        grades: engGrades,
        consequence: {
          'cutoff-descend': `Fuel off, ignition left on to burn what is in the lines, and you spiral down over the field. You are on the ground in about ${min1(minutesSpiral)} minutes and out of the airplane soon after.`,
          'cutoff-glide': toAirport.reachable
            ? `You make the airport, but you are in a burning airplane for about ${min1(minutesAirport!)} minutes instead of ${min1(minutesSpiral)}. A runway is nicer than a field. It is not worth the extra minutes of fire.`
            : `The airport is out of reach: the glide covers ${nm1(toAirport.reachNm)} nm. You end up landing in a field anyway, later and lower.`,
          'keep-running': 'Running the engine keeps pumping fuel to the fire. The AFH says it plainly: in a single-engine airplane there is no choice but a forced landing.',
          restart: 'An engine fire that seems to be out can rekindle as the airflow changes, and a restart gives it fuel again. The AFH says never to restart once the flames are out.',
        },
        why: `Fuel off first, then the quickest way to the ground: ${min1(minutesSpiral)} minutes descending against ${minutesAirport ? `${min1(minutesAirport)} gliding to the airport` : 'an airport out of reach'}. The airplane is expendable. The people in it are not.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 6.4

const fieldSelection: Lesson = {
  id: '6.4', module: 6, minutes: 16,
  title: 'Forced landing field selection',
  summary: 'Sort four fields by reach, wind, length and surface, worked from your own landing chart.',
  acs: ['PA.IX.B'],
  refs: ['Airplane Flying Handbook (FAA-H-8083-3), terrain selection', 'Airplane Flying Handbook (FAA-H-8083-3), emergency landings', 'POH, landing distance'],
  build(ctx) {
    const f = ctx.airport;
    const { perf, sample, source } = airplane(ctx);
    const rwy = mainRunway(f);
    const windFrom = magToTrue(f, rwy.headingMag);
    const windKt = 12;
    const height = 2000;
    const elevationFt = f.elevationFt;
    const oatC = Math.round(isaTempC(elevationFt) + 5);
    const o = { heightAglFt: height, elevationFt, oatC, windFromTrue: windFrom, windKt };
    const reachToward = (brg: number) => reach(perf, height, brg, 0, windFrom, windKt).reachNm;
    const ceil100 = (n: number) => Math.ceil(n / 100) * 100;
    // Lengths are set from the airplane's own numbers so each field plays the part it is written for.
    const size = (fld: Omit<Field, 'lengthFt'>, factor: number): Field => {
      const need = checkField(perf, { ...fld, lengthFt: 0 }, o).needFt;
      return { ...fld, lengthFt: ceil100(need * factor) };
    };
    const at = (rel: number, frac: number) => {
      const b = norm(windFrom + rel);
      return { bearingTrue: Math.round(b), distanceNm: Math.max(0.2, Math.round(reachToward(b) * frac * 10) / 10) };
    };
    const fields: (Field & { what: string })[] = [
      { ...size({ id: 'hayfield', name: 'Hayfield', ...at(50, 0.55), landingTrue: windFrom, surface: 'mown', obstacleFt: 40 }, 1.3), what: 'mown hay, into the wind, power lines across the approach end' },
      { ...size({ id: 'pasture', name: 'Pasture', ...at(200, 0.4), landingTrue: norm(windFrom + 180), surface: 'pasture', obstacleFt: 0 }, 1.4), what: 'smooth and long, but woods on three sides mean the only way in is with the wind behind you' },
      { ...size({ id: 'plowed', name: 'Plowed field', ...at(-70, 0.6), landingTrue: windFrom, surface: 'plowed', obstacleFt: 0 }, 1.8), what: 'freshly plowed, into the wind, furrows running across your path' },
      { ...size({ id: 'sod-farm', name: 'Sod farm', ...at(5, 1.3), landingTrue: windFrom, surface: 'mown', obstacleFt: 0 }, 2.5), what: 'huge, smooth and flat, straight upwind' },
    ];
    const checks: Record<string, FieldCheck> = Object.fromEntries(fields.map((fl) => [fl.id, checkField(perf, fl, o)]));
    const grades = Object.fromEntries(fields.map((fl) => [fl.id, gradeField({ ...checks[fl.id], reachable: checks[fl.id].reach.reachable })]));
    const hay = fields[0];
    const pasture = fields[1];
    const hayDist = landingDistance(perf, { fieldElevFt: elevationFt, altimeterInHg: 29.92, oatC, headwindKt: checks.hayfield.headwindKt, surface: 'grass' });

    const consequence = (fl: Field & { what: string }): string => {
      const c = checks[fl.id];
      if (!c.reach.reachable) return `${fl.name} is ${nm1(c.reach.distanceNm)} nm upwind and your glide reaches ${nm1(c.reach.reachNm)} that way, keeping the pattern height. It looks close from ${fmt(height)} feet. You land short of it, downwind of the trees at its edge.`;
      if (!c.fits) return `You need about ${fmt(c.needFt)} feet and ${fl.name.toLowerCase()} has ${fmt(fl.lengthFt)}. You run off the far end at walking pace into whatever is there.`;
      if (c.rough) return `You make it and touch down slowly into the wind, but the furrows across your path catch the nosewheel. The AFH's advice is to land along furrows, not across them, and to keep the nose up as long as you can. Survivable, and the airplane is badly damaged.`;
      if (c.headwindKt < 0) return `It fits, with ${fmt(fl.lengthFt - c.needFt)} feet to spare. But with the wind behind you, your groundspeed at touchdown is ${2 * windKt} knots higher than landing into it, and the energy to get rid of goes with the square of groundspeed. You stop, faster and harder than you needed to.`;
      return `Over the wires with height to spare, ${fmt(c.needFt)} feet of the ${fmt(fl.lengthFt)} used, into the wind at the slowest groundspeed of the four. You stop in the hay.`;
    };

    return [
      {
        kind: 'brief', id: 'b1', title: 'Four fields',
        scene: `Engine out at ${fmt(height)} feet above made-up farmland near ${fieldName(ctx)}, wind from ${deg3(windFrom)} at ${windKt} knots. Four fields in sight. None of them are real.`,
        say: {
          full: 'The AFH says to pick the general area first, then the spot, and not to change your mind more than once. Sort fields in this order. **Reach**: can you get there with height for a pattern, given the wind? **Wind**: land into it, because the energy you have to get rid of goes with the square of your groundspeed. **Length**: from your own landing chart, over an obstacle if there is one. **Surface**: smooth beats rough, and along furrows beats across them. The first field that fails a test is out.',
          short: 'Reach, wind, length, surface. In that order.',
        },
        figure: {
          kind: 'glide', heightAglFt: height, rangeNm: glideReachNm(perf, height - 1000, 0, 0, 0), windFromTrue: windFrom, windKt,
          fields: fields.map((fl) => ({ name: fl.name, bearingTrue: fl.bearingTrue, distanceNm: fl.distanceNm, reachable: checks[fl.id].reach.reachable })),
        },
      },
      {
        kind: 'example', id: 'e1', title: 'The hayfield, worked',
        say: {
          full: `The hayfield is ${fmt(hay.lengthFt)} feet of ${hay.what}. With wires on the approach, read the distance **over a 50 foot obstacle**, then correct for the wind and the grass the way the chart notes say. ${source}`,
          short: 'Over 50 feet when there is something to clear, then the notes.',
        },
        figure: { kind: 'perf', chart: 'landing-50', performance: perf, paFt: elevationFt, oatC, sample },
        work: [
          { label: 'Reach', value: checks.hayfield.reach.reachable ? 'Yes' : 'No', note: `${nm1(hay.distanceNm)} nm away, ${nm1(checks.hayfield.reach.reachNm)} nm of glide that way` },
          { label: 'Wind', value: `${checks.hayfield.headwindKt} kt headwind`, note: `Landing ${deg3(hay.landingTrue)}°, wind from ${deg3(windFrom)}°` },
          ...hayDist.steps.map((s) => ({ label: s.label, value: `${fmt(s.over50Ft)} ft`, note: 'Over 50 ft' })),
          { label: 'Length', value: `${fmt(hay.lengthFt)} ft`, note: checks.hayfield.fits ? 'It fits' : 'Too short' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now the pasture: ${fmt(pasture.lengthFt)} feet, ${pasture.what}. Nothing to clear on the approach, so the ground roll is the number.`,
        figure: { kind: 'perf', chart: 'landing-roll', performance: perf, paFt: elevationFt, oatC, sample },
        blanks: [
          { id: 'tail', label: 'Tailwind landing in the pasture', unit: 'kt', answer: -checks.pasture.headwindKt, tolerance: 2,
            explain: `Landing ${deg3(pasture.landingTrue)}° with the wind from ${deg3(windFrom)}° puts all ${windKt} knots behind you.` },
          { id: 'roll', label: 'Ground roll needed', unit: 'ft', answer: checks.pasture.needFt, tolerance: 60,
            explain: `The chart, then the tailwind note (${perf.landing.notes.tailwindPct}% per ${perf.landing.notes.tailwindStepKt} knots), then grass: about ${fmt(checks.pasture.needFt)} feet.` },
          { id: 'fits', label: 'Does it fit?', answer: checks.pasture.fits ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: `${fmt(checks.pasture.needFt)} feet needed, ${fmt(pasture.lengthFt)} available.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Pick one',
        situation: `${fmt(height)} feet and coming down. ${fields.map((fl) => `${fl.name}: ${fl.what}.`).join(' ')}`,
        figure: {
          kind: 'glide', heightAglFt: height, rangeNm: glideReachNm(perf, height - 1000, 0, 0, 0), windFromTrue: windFrom, windKt,
          fields: fields.map((fl) => ({ name: fl.name, bearingTrue: fl.bearingTrue, distanceNm: fl.distanceNm, reachable: checks[fl.id].reach.reachable })),
        },
        options: fields.map((fl) => ({ id: fl.id, label: `The ${fl.name.toLowerCase()}, ${nm1(fl.distanceNm)} nm to the ${compass(fl.bearingTrue)}.` })),
        grades,
        consequence: Object.fromEntries(fields.map((fl) => [fl.id, consequence(fl)])),
        why: `Run the four tests in order. ${fields.map((fl) => { const fail = firstFail(checks[fl.id]); return `The ${fl.name.toLowerCase()} ${fail ? `fails ${fail}` : 'passes all four'}.`; }).join(' ')}${checks.hayfield.fits ? ` The hayfield is the shortest, and it is still ${fmt(hay.lengthFt - checks.hayfield.needFt)} feet longer than you need.` : ''}`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 6.5

const partialPower: Lesson = {
  id: '6.5', module: 6, minutes: 14,
  title: 'Partial power',
  summary: 'The engine is still running, just not well. Treat it as the warning it is and use the power while you have it.',
  acs: ['PA.IX.C', 'PA.IX.B'],
  refs: ['Airplane Flying Handbook (FAA-H-8083-3), types of emergency landings', 'POH, emergency procedures'],
  build(ctx) {
    const { perf, source } = airplane(ctx);
    const home = chartAirport('KXYZ')!;
    const pos = destination(home.pos, 280, 16);
    const altMsl = 5500;
    const groundFt = practiceRegion.groundFt(pos);
    const agl = altMsl - groundFt;
    const windFrom = 90;
    const windKt = 15;
    const others = practiceRegion.airports.filter((a) => a.id !== home.id);
    const nearest = others.reduce((a, b) => (distanceNm(pos, a.pos) <= distanceNm(pos, b.pos) ? a : b));
    const rNear = reach(perf, agl, trueCourse(pos, nearest.pos), distanceNm(pos, nearest.pos), windFrom, windKt);
    const rHome = reach(perf, agl, trueCourse(pos, home.pos), distanceNm(pos, home.pos), windFrom, windKt);
    const homeIsNearest = rHome.distanceNm <= rNear.distanceNm;
    // With partial power the airplane just holds altitude at about Vy.
    const gsTo = (brg: number) => windTriangle(brg, perf.vyKias, windFrom, windKt).groundspeedKt;
    const minNear = (rNear.distanceNm / gsTo(rNear.bearingTrue)) * 60;
    const minHome = (rHome.distanceNm / gsTo(rHome.bearingTrue)) * 60;
    const grades = gradePartialPower({ nearestInGlide: rNear.reachable, homeInGlide: rHome.reachable, homeIsNearest });

    return [
      {
        kind: 'brief', id: 'b1', title: 'Rough running',
        scene: `Eastbound at ${fmt(altMsl)} feet, heading back to KXYZ, ${nm1(rHome.distanceNm)} nm ahead into a ${windKt} knot headwind. The engine starts to shake and the RPM drops a few hundred. ${PRACTICE_NOTE}`,
        say: {
          full: `Partial power is harder than a clean failure, because the engine keeps offering you hope. Fly first: pitch for the airspeed that holds altitude, often near Vy, ${perf.vyKias} knots in your airplane. Then **turn toward the nearest suitable airport** before you troubleshoot, and run the POH flow on the way: fuel selector, mixture, carb heat or alternate air, magnetos one at a time. The AFH lists "gradually developing engine trouble" as a reason for a precautionary landing, and warns that too many of those become forced landings when the pilot hopes instead of deciding.`,
          short: 'Turn for the nearest suitable airport first, then troubleshoot.',
        },
        figure: { kind: 'chart', route: ['KXYZ'], highlight: [nearest.id], marker: { pos, altMsl, label: 'Rough engine' } },
      },
      {
        kind: 'example', id: 'e1', title: 'Two clocks',
        say: {
          full: `Two numbers matter now. How long until you reach a runway at the power you have, and whether you could still glide to one if the engine stopped this minute. Here they are for ${nearest.name} (${nearest.id}), holding altitude at ${perf.vyKias} knots, and for gliding with ${fmt(agl - 1000)} feet to spend. ${source}`,
          short: 'Time to the runway, and the glide if it quits now.',
        },
        figure: { kind: 'chart', route: ['KXYZ'], highlight: [nearest.id], marker: { pos, altMsl, label: 'Rough engine' } },
        work: [
          { label: `To ${nearest.id}`, value: `${nm1(rNear.distanceNm)} nm`, note: `${deg3(rNear.bearingTrue)}° true, ${nearest.runwayFt.toLocaleString('en-US')} ft ${nearest.surface}` },
          { label: 'Groundspeed', value: `${Math.round(gsTo(rNear.bearingTrue))} kt`, note: `${perf.vyKias} kt with the wind from ${deg3(windFrom)}° at ${windKt}` },
          { label: 'Time', value: `${min1(minNear)} min` },
          { label: 'Glide if it quits', value: `${nm1(rNear.reachNm)} nm`, note: rNear.reachable ? 'Inside the glide the whole way' : 'Outside the glide for now' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now KXYZ: ${nm1(rHome.distanceNm)} nm, holding altitude at ${perf.vyKias} knots.`,
        figure: { kind: 'chart', route: ['KXYZ'], highlight: [nearest.id], marker: { pos, altMsl, label: 'Rough engine' } },
        blanks: [
          { id: 'gs', label: 'Groundspeed toward KXYZ', unit: 'kt', answer: Math.round(gsTo(rHome.bearingTrue)), tolerance: 2,
            explain: `${perf.vyKias} knots less about ${Math.round(perf.vyKias - gsTo(rHome.bearingTrue))} of headwind.` },
          { id: 'min', label: 'Minutes to KXYZ', unit: 'min', answer: Math.round(minHome * 10) / 10, tolerance: 1,
            explain: `${nm1(rHome.distanceNm)} nm at ${Math.round(gsTo(rHome.bearingTrue))} knots is about ${min1(minHome)} minutes.` },
          { id: 'glide', label: 'Could you glide to KXYZ from here?', answer: rHome.reachable ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: `The glide reaches ${nm1(rHome.reachNm)} nm toward KXYZ, keeping 1,000 feet for a pattern. It is ${nm1(rHome.distanceNm)} nm.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'It is still running',
        situation: `Carb heat and mixture made no difference. The engine is holding altitude at ${perf.vyKias} knots, just. ${nearest.name} is ${min1(minNear)} minutes away, KXYZ ${min1(minHome)}.`,
        figure: {
          kind: 'glide', heightAglFt: agl, rangeNm: glideReachNm(perf, agl - 1000, 0, 0, 0), windFromTrue: windFrom, windKt,
          fields: [
            { name: nearest.id, bearingTrue: rNear.bearingTrue, distanceNm: rNear.distanceNm, reachable: rNear.reachable },
            { name: home.id, bearingTrue: rHome.bearingTrue, distanceNm: rHome.distanceNm, reachable: rHome.reachable },
          ],
        },
        options: [
          { id: 'nearest', label: `Divert to ${nearest.name} now and land.` },
          { id: 'press-home', label: `Press on to KXYZ, ${min1(minHome)} minutes ahead.` },
          { id: 'field-now', label: 'Land in a field now, while you still have some power.' },
          { id: 'circle', label: 'Circle here and keep troubleshooting until it smooths out.' },
        ],
        grades,
        consequence: {
          nearest: `You turn, stay high, and keep ${nearest.id} inside the glide the whole way. ${min1(minNear)} minutes later you are on the ${nearest.surface} runway, ${nearest.runwayFt.toLocaleString('en-US')} feet. Later the mechanic finds a cracked intake gasket. It would have kept running, or it would not have: you did not need to find out.`,
          'press-home': rHome.reachable || homeIsNearest
            ? `You make it, and KXYZ was within glide the whole way, so it was a fair bet. ${homeIsNearest ? '' : `${nearest.id} was still closer.`}`
            : `For most of the next ${min1(minHome)} minutes KXYZ is beyond the glide, and the field below is all you have if it quits. It keeps running, this time. You were betting the flight on it.`,
          'field-now': rNear.reachable
            ? `A precautionary landing while you have power is better than a forced one later, and the AFH backs it. But a runway inside your glide, ${min1(minNear)} minutes away, was the safer place to put it down.`
            : 'With no runway inside the glide, a precautionary landing while you still have power to fix your mistakes is the right call.',
          circle: 'Circling spends the power you have over a place you have not chosen. The engine does not smooth out, and twenty minutes later you are still over the same woods with less fuel and the same problem.',
        },
        why: `${nearest.id} is ${min1(minNear)} minutes away and ${rNear.reachable ? 'inside your glide if the engine stops' : 'the closest runway you have'}. KXYZ is ${min1(minHome)} minutes and ${rHome.reachable ? 'inside the glide too' : 'beyond the glide'}. Treat partial power as the start of a failure, and spend the power on getting to a runway.`,
      },
    ];
  },
};

export const emergencyLessons: Lesson[] = [afterTakeoff, atAltitude, fire, fieldSelection, partialPower];
