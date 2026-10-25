// Module 10, Aerodynamics: the physics a pilot meets in the pattern and in
// rough air, not on a whiteboard. Load factor and the stall speed it brings,
// maneuvering speed at the weight you are actually flying, stall and spin
// recovery, and ground effect at both ends of the runway. The relations live
// in lib/aero.ts and every number and grade comes from there, with the
// pilot's own speeds when the profile has them and labeled sample speeds when
// it doesn't.

import { chartAirport } from '../chart/practiceRegion';
import {
  floatDistance, gradeFloat, gradeOvershoot, gradeStallRecovery, gradeTurbulence, loadFactor, maneuveringSpeed, SAMPLE_SPEEDS, stallBankAt, stallSpeedAt,
  type OvershootOption, type StallPhase, type VSpeeds,
} from '../lib/aero';
import { landingDistance, takeoffDistance } from '../lib/perf';
import type { Grade } from '../scenarios/goNoGo';
import { oralAirplane, weighTrip, type TripLoad } from './oralChecks';
import type { Dial, DialLine, DialState, DialValues, Figure, Lesson, LessonContext, Option } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const g2 = (n: number) => n.toFixed(2);

/** The airplane's speeds, and whether they are the sample set. */
export function speedsFor(ctx: LessonContext): { speeds: VSpeeds; sample: boolean; note: string } {
  const plane = oralAirplane(ctx.aircraft);
  const own = plane.performance.speeds;
  return own
    ? { speeds: own, sample: false, note: '' }
    : { speeds: SAMPLE_SPEEDS, sample: true, note: ' These are sample trainer speeds for teaching; use the ones in your POH.' };
}

function follow<T extends string>(grades: Record<T, Grade>, intended: Partial<Record<T, Grade>>, written: Record<T, string>, why: (id: T) => string): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const id of Object.keys(written) as T[]) out[id] = !intended[id] || intended[id] === grades[id] ? written[id] : why(id);
  return out;
}

const lfFigure = (s: VSpeeds, bankDeg: number): Figure => ({ kind: 'loadFactor', bankDeg, vs0Kias: s.vs0Kias, vs1Kias: s.vs1Kias, approachKias: s.approachKias, sample: s === SAMPLE_SPEEDS });

// ---------------------------------------------------------------- 10.1

const OVERSHOOT_BANK = [30, 45, 60];

/** The steepest bank, in whole 5° steps, that keeps 1.3 times the flaps-down stall speed at approach speed. */
export function steepestApproachBank(s: VSpeeds): number {
  const exact = stallBankAt(s.vs0Kias * 1.3, s.approachKias);
  return Math.floor(exact / 5) * 5;
}

const OVERSHOOT_VERDICT: Option[] = [
  { id: 'rudder', label: 'Tighten it with rudder' },
  { id: 'steepen', label: 'Steepen the bank, coordinated' },
  { id: 'through', label: 'Fly through and come back' },
  { id: 'go-around', label: 'Go around' },
];

function turnDials(s: VSpeeds, start: number) {
  const dials: Dial[] = [
    { id: 'bank', label: 'Bank angle', unit: '°', min: 0, max: 75, step: 5, initial: start, format: (v) => `${v}°`,
      marks: [{ at: 60, label: '2 g', kind: 'airplane' }, { at: steepestApproachBank(s), label: '1.3 Vs0', kind: 'personal' }] },
  ];
  const evaluate = (v: DialValues): DialState => {
    const n = loadFactor(v.bank);
    const vs0 = stallSpeedAt(s.vs0Kias, n);
    const vs1 = stallSpeedAt(s.vs1Kias, n);
    const margin = s.approachKias / vs0;
    const lines: DialLine[] = [];
    if (vs0 >= s.approachKias) {
      lines.push({ id: 'stalls', severity: 'limit', title: 'Stalls at approach speed', say: `At ${v.bank}° the flaps-down stall speed is ${fmt(vs0)} knots, over your ${s.approachKias} knot approach speed. Hold altitude in this turn on final and the wing stalls, low and banked.` });
    } else if (margin < 1.3) {
      lines.push({ id: 'thin', severity: 'caution', title: 'Less than 1.3 times the stall speed', say: `${fmt(vs0)} knots against your ${s.approachKias}: a margin of ${g2(margin)}. Approaches are flown at 1.3 for a reason, and a gust or a little more back pressure takes the rest.` });
    }
    return {
      figures: [lfFigure(s, v.bank)],
      readouts: [
        { id: 'n', label: 'Load factor', value: `${g2(n)} g`, tone: n >= 2 ? 'over' : n >= 1.5 ? 'near' : undefined },
        { id: 'vs1', label: 'Stall, clean', value: `${fmt(vs1)} kt` },
        { id: 'vs0', label: 'Stall, flaps down', value: `${fmt(vs0)} kt`, tone: margin < 1.3 ? 'over' : undefined },
        { id: 'margin', label: 'Approach speed over stall', value: `${g2(margin)}×`, tone: margin < 1.3 ? 'over' : undefined },
      ],
      lines,
      clear: `At ${v.bank}° you pull ${g2(n)} g and the stall speed rises to ${fmt(vs0)} knots with the flaps down, still ${g2(margin)} times under your approach speed.`,
      verdict: { options: OVERSHOOT_VERDICT, grades: gradeOvershoot(s, v.bank).grades },
    };
  };
  const best = steepestApproachBank(s);
  return {
    dials, evaluate,
    task: {
      prompt: `Set the steepest bank, in 5° steps, that still keeps your ${s.approachKias} knot approach speed at 1.3 times the flaps-down stall speed.`,
      check: (v: DialValues) => ({
        right: v.bank === best,
        explain: `${best}°: the stall speed is ${fmt(stallSpeedAt(s.vs0Kias, loadFactor(best)))} knots, and ${s.approachKias} is ${g2(s.approachKias / stallSpeedAt(s.vs0Kias, loadFactor(best)))} times that. At ${best + 5}° it is ${g2(s.approachKias / stallSpeedAt(s.vs0Kias, loadFactor(best + 5)))}.`,
      }),
    },
  };
}

const turnLesson: Lesson = {
  id: '10.1', module: 10, minutes: 15,
  title: 'Bank angle and the stall speed',
  summary: 'Why a steep turn stalls at a higher speed, and why the overshooting turn to final is where that matters most.',
  acs: ['PA.V.A', 'PA.VII.B', 'PA.VII.C'],
  refs: ['PHAK ch. 5', 'Airplane Flying Handbook (FAA-H-8083-3), stalls'],
  variants: 3,
  build(ctx) {
    const v = Math.min(ctx.variant ?? 0, OVERSHOOT_BANK.length - 1);
    const { speeds: s, note } = speedsFor(ctx);
    const bank = OVERSHOOT_BANK[v];
    const o = gradeOvershoot(s, bank);
    const n60 = loadFactor(60);
    const ids: OvershootOption[] = ['rudder', 'steepen', 'through', 'go-around'];
    const labels: Record<OvershootOption, string> = {
      rudder: 'Keep the bank and add inside rudder to swing the nose around.',
      steepen: `Steepen to about ${bank}°, coordinated, and hold your speed.`,
      through: 'Roll out through the centerline, then turn gently back to it.',
      'go-around': 'Go around, and fly a wider pattern next time.',
    };
    return [
      {
        kind: 'brief', id: 'b1', title: 'Weight you can\'t see',
        scene: 'Roll into a level turn and the seat pushes up harder. That push is load factor, and the wing has to make it.',
        say: {
          full: `In a level turn the wing makes enough lift to hold the airplane up **and** pull it around the turn. That total, in g, is the **load factor**, 1 ÷ cos(bank): 1.15 at 30°, 1.41 at 45°, **2 at 60°**. The wing has to fly at a higher angle of attack to make it, so it reaches its critical angle sooner: the **stall speed rises with the square root** of the load factor. At 60° it is 41 percent higher. A stall is an angle of attack, not a speed. Where this bites is the turn to final, low, slow and in a hurry.${note}`,
          short: 'Load factor is 1 ÷ cos(bank). Stall speed rises with its square root: +41% at 60°.',
        },
        figure: lfFigure(s, 0),
      },
      {
        kind: 'turn', id: 't1', title: 'Work it',
        prompt: `Your clean stall speed is ${s.vs1Kias} knots.`,
        blanks: [
          { id: 'n30', label: 'Load factor at 30°', unit: 'g', answer: Math.round(loadFactor(30) * 100) / 100, tolerance: 0.03, explain: `1 ÷ cos 30° = 1 ÷ 0.866 = ${g2(loadFactor(30))} g.` },
          { id: 'n60', label: 'Load factor at 60°', unit: 'g', answer: 2, tolerance: 0.03, explain: '1 ÷ cos 60° = 1 ÷ 0.5 = 2 g. You weigh twice as much, and so does the airplane.' },
          { id: 'vs60', label: 'Clean stall speed at 60°', unit: 'kt', answer: Math.round(stallSpeedAt(s.vs1Kias, n60)), tolerance: 1, explain: `${s.vs1Kias} × √2 = ${s.vs1Kias} × 1.41 = ${fmt(stallSpeedAt(s.vs1Kias, n60))} knots.` },
        ],
      },
      {
        kind: 'dials', id: 'w1', title: 'Roll it in',
        say: {
          full: `Turn the bank and watch the flaps-down stall speed climb toward your ${s.approachKias} knot approach speed. The dashed mark is where the margin falls under 1.3.`,
          short: 'Turn the bank and watch the stall speed close on your approach speed.',
        },
        turnedNote: 'Your bank angle, as you have set it.',
        ...turnDials(s, 30),
      },
      {
        kind: 'decide', id: 'd1', title: 'Overshooting final',
        situation: `A tailwind on base carried you wide. Flaps down, ${s.approachKias} knots, 500 feet above the ground. To roll out on the centerline from here you would need about ${bank}° of bank. At that bank the flaps-down stall speed is ${fmt(o.stallKias)} knots.`,
        figure: lfFigure(s, bank),
        options: ids.map((id) => ({ id, label: labels[id] })),
        grades: o.grades,
        consequence: follow(o.grades, {}, {
          rudder: 'The skid you just made is the classic stall-spin setup: the inside wing slows, its angle of attack climbs, and if it stalls the airplane rolls toward the ground at 500 feet. No altitude to recover. Never tighten a turn with rudder.',
          steepen: o.grades.steepen === 'best'
            ? `Right. ${bank}° is a normal bank: ${g2(loadFactor(bank))} g and a stall speed of ${fmt(o.stallKias)}, still ${g2(o.margin)} times under your approach speed. Coordinated, it is just a turn.`
            : o.grades.steepen === 'marginal'
              ? `It works on paper: ${fmt(o.stallKias)} knots against ${s.approachKias}, a margin of ${g2(o.margin)}. But steep, low and slow, one gust or a little more pull takes the rest. A go-around was free.`
              : `At ${bank}° the stall speed is ${fmt(o.stallKias)} knots, ${o.stallKias >= s.approachKias ? 'more than' : 'nearly'} your approach speed. Level, banked steeply at 500 feet, the wing stalls.`,
          through: 'Safe enough, and it costs an S-turn on short final. A stable approach was already gone; a go-around gives you a fresh one.',
          'go-around': o.grades['go-around'] === 'best'
            ? 'Right. Full power, pitch for Vy, flaps up in stages, and fly a wider pattern. The overshoot was the sign; the go-around is the cure.'
            : `Never wrong. Here, though, ${bank}° coordinated was an ordinary turn with plenty of margin.`,
        }, (id) => `That grades ${o.grades[id]} at ${bank}°.`),
        why: `Load factor raises the stall speed: at ${bank}° it is ${fmt(o.stallKias)} knots with the flaps down. Up to about 30°, coordinated, an overshoot is just a turn. Steeper than that near the ground, go around. And never fix it with rudder: the skidding turn to final is the stall-spin accident in the making.${note}`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 10.2

/** A solo pilot with full tanks, or four aboard, on the airplane in use. */
export function turbulenceWeights(ctx: LessonContext) {
  const a = oralAirplane(ctx.aircraft).aircraft;
  const bagStation = a.stations.some((x) => x.id === 'bag1' && x.armIn > 0) ? 'bag1' : 'rear';
  const solo: TripLoad = { frontLb: 170, rearLb: 0, bagsLb: 0, bagStation };
  const soloLb = weighTrip(a, solo, a.usableFuelGal).totalLb;
  return { a, soloLb, heavyLb: a.maxGrossLb };
}

function weightDials(s: VSpeeds, emptyPlusPilot: number, maxGross: number, start: number) {
  const dials: Dial[] = [
    { id: 'w', label: 'Weight today', unit: 'lb', min: Math.floor(emptyPlusPilot / 10) * 10, max: maxGross, step: 10, initial: start, format: (v) => `${fmt(v)} lb`,
      marks: [{ at: maxGross, label: 'Max gross', kind: 'airplane' }] },
  ];
  const evaluate = (v: DialValues): DialState => {
    const va = maneuveringSpeed(s.vaKias, v.w, maxGross);
    const g = gradeTurbulence(s, v.w, maxGross);
    const lines: DialLine[] = s.vaKias - va > 3
      ? [{ id: 'placard', severity: 'caution', title: 'The placard is too fast', say: `At ${fmt(v.w)} lb, maneuvering speed is ${fmt(va)} knots. The ${s.vaKias} on the placard is for ${fmt(maxGross)} lb; flown at that speed today, a sharp gust can overstress the airplane before the wing stalls.` }]
      : [];
    return {
      figures: [],
      readouts: [
        { id: 'va', label: 'Va today', value: `${fmt(va)} kt` },
        { id: 'placard', label: 'Va at max gross', value: `${s.vaKias} kt` },
        { id: 'diff', label: 'Slower by', value: `${fmt(s.vaKias - va)} kt`, tone: s.vaKias - va > 3 ? 'near' : undefined },
      ],
      lines,
      clear: `At ${fmt(v.w)} lb, Va is ${fmt(va)} knots, within a few knots of the placard.`,
      verdict: { options: [{ id: 'cruise', label: 'Stay at cruise' }, { id: 'placard-va', label: 'Slow to the placard Va' }, { id: 'weight-va', label: 'Slow to Va for this weight' }, { id: 'climb-out', label: 'Climb out of it' }], grades: g.grades },
    };
  };
  return { dials, evaluate };
}

const vaLesson: Lesson = {
  id: '10.2', module: 10, minutes: 12,
  title: 'Maneuvering speed and weight',
  summary: 'What Va protects you from, why it is slower when the airplane is lighter, and the speed to fly when the air gets rough.',
  acs: ['PA.I.G', 'PA.V.A'],
  refs: ['PHAK ch. 5', 'PHAK ch. 4'],
  variants: 2,
  build(ctx) {
    const heavy = ctx.variant === 1;
    const { speeds: s, note } = speedsFor(ctx);
    const w = turbulenceWeights(ctx);
    const weight = heavy ? w.heavyLb : w.soloLb;
    const slow = Math.round(s.vs1Kias * 1.4);
    const t = gradeTurbulence(s, weight, w.a.maxGrossLb, slow);
    const vaSolo = maneuveringSpeed(s.vaKias, w.soloLb, w.a.maxGrossLb);
    const cruise = Math.min(s.vnoKias - 5, s.vaKias + 12);
    return [
      {
        kind: 'brief', id: 'b1', title: 'Stall before you break',
        scene: 'A gust is a sudden change in angle of attack. Below a certain speed the wing stalls before it can pull the airplane past its limit load. That speed is maneuvering speed, Va.',
        say: {
          full: `A normal category airplane is built for **3.8 g**. Below **Va** the wing can\'t make that much lift: a gust or a full control input stalls it first, and a stall is recoverable. Above Va the wing can overstress the airplane before it stalls. The placarded Va is for **maximum gross weight**. Lighter, the same gust accelerates less mass, so the airplane reaches its limit at a lower speed: **Va falls with the square root of the weight**. And Va is not a speed below which anything goes: full, abrupt control reversals can break an airplane below it.${note}`,
          short: 'Below Va the wing stalls before it overstresses. Lighter airplane, lower Va.',
        },
      },
      {
        kind: 'turn', id: 't1', title: 'Your Va today',
        prompt: `Va is ${s.vaKias} knots at ${fmt(w.a.maxGrossLb)} lb. Solo with full tanks you weigh ${fmt(w.soloLb)} lb.`,
        blanks: [
          { id: 'ratio', label: 'Weight ratio, today over max', answer: Math.round((w.soloLb / w.a.maxGrossLb) * 100) / 100, tolerance: 0.02, explain: `${fmt(w.soloLb)} ÷ ${fmt(w.a.maxGrossLb)} = ${g2(w.soloLb / w.a.maxGrossLb)}.` },
          { id: 'va', label: 'Va solo', unit: 'kt', answer: Math.round(vaSolo), tolerance: 2, explain: `${s.vaKias} × √${g2(w.soloLb / w.a.maxGrossLb)} = ${fmt(vaSolo)} knots, ${fmt(s.vaKias - vaSolo)} slower than the placard.` },
        ],
      },
      {
        kind: 'dials', id: 'w1', title: 'Load it up',
        say: { full: 'Change the weight and watch Va follow it.', short: 'Change the weight, watch Va.' },
        turnedNote: 'The weight, as you have set it.',
        ...weightDials(s, w.soloLb - oralAirplane(ctx.aircraft).aircraft.usableFuelGal * 6, w.a.maxGrossLb, weight),
      },
      {
        kind: 'decide', id: 'd1', title: 'It gets rough',
        situation: heavy
          ? `Four aboard, right at ${fmt(weight)} lb. Cruising at ${cruise} knots, you fly into rotor downwind of a ridge: the airplane is jolting hard and a can of soda hits the ceiling.`
          : `Solo, ${fmt(weight)} lb. Cruising at ${cruise} knots, you fly into rotor downwind of a ridge: the airplane is jolting hard and your headset bangs the ceiling.`,
        options: [
          { id: 'cruise', label: `Hold ${cruise} knots. It is in the green arc.` },
          { id: 'placard-va', label: `Slow to the placard Va, ${s.vaKias} knots.` },
          heavy
            ? { id: 'well-below', label: `Slow right down to ${slow} knots, to be extra safe.` }
            : { id: 'weight-va', label: `Slow to ${fmt(t.vaKias)} knots, Va for this weight.` },
          { id: 'climb-out', label: 'Pull up hard to climb out of it quickly.' },
        ],
        grades: Object.fromEntries((heavy ? ['cruise', 'placard-va', 'well-below', 'climb-out'] as const : ['cruise', 'placard-va', 'weight-va', 'climb-out'] as const).map((id) => [id, t.grades[id]])),
        consequence: follow(t.grades, {}, {
          cruise: 'The green arc is for smooth air. In turbulence this strong, above Va, a sharp gust can take the airplane past its limit load before the wing stalls.',
          'placard-va': t.grades['placard-va'] === 'best'
            ? `Right. At maximum gross the placard is your Va. Slow to ${s.vaKias}, hold attitude rather than altitude, and let the airplane ride.`
            : `Better, and still ${fmt(s.vaKias - t.vaKias)} knots too fast. The placard assumes ${fmt(w.a.maxGrossLb)} lb; you are ${fmt(w.a.maxGrossLb - weight)} lb lighter.`,
          'weight-va': `Right. At ${fmt(weight)} lb, Va is ${fmt(t.vaKias)} knots. Slow to it, wings level, hold attitude and let the altitude wander. Then turn away from the ridge.`,
          'well-below': `Under Va the airplane is already protected. At ${slow} knots, ${g2(slow / s.vs1Kias)} times the clean stall speed, a gust that knocks off 15 knots puts you at the stall in rotor near a ridge.`,
          'climb-out': 'A hard pull adds the load you are trying to avoid, on top of the gusts. Slow down first; climb gently once the speed is under control.',
        }, (id) => `That grades ${t.grades[id]} at this weight.`),
        why: `Va for the weight you are at: ${s.vaKias} × √(${fmt(weight)} ÷ ${fmt(w.a.maxGrossLb)}) = ${fmt(t.vaKias)} knots. In turbulence fly at or below it, hold attitude rather than altitude, and keep control inputs small.${note}`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 10.3

const STALL_CASES: { phase: StallPhase; title: string; scene: string }[] = [
  { phase: 'stall', title: 'The departure stall', scene: 'Climbing out at 300 feet in a left turn to avoid a tower, nose high. The stall horn starts, the airplane shudders, and the left wing drops.' },
  { phase: 'incipient-spin', title: 'It starts to spin', scene: 'Practicing power-on stalls at 4,000 feet, you hold it too long, uncoordinated. The left wing drops sharply, the nose falls through the horizon, and the airplane starts to rotate left.' },
];

const stallLesson: Lesson = {
  id: '10.3', module: 10, minutes: 12,
  title: 'Stalls and spins',
  summary: 'A stall is an angle, not a speed. Recover by unloading the wing first, and know the four steps that stop a spin.',
  acs: ['PA.VII.B', 'PA.VII.C', 'PA.VII.D'],
  refs: ['Airplane Flying Handbook (FAA-H-8083-3), stalls', 'PHAK ch. 5'],
  variants: 2,
  build(ctx) {
    const c = STALL_CASES[Math.min(ctx.variant ?? 0, STALL_CASES.length - 1)];
    const grades = gradeStallRecovery(c.phase);
    return [
      {
        kind: 'brief', id: 'b1', title: 'Unload the wing',
        scene: 'Every stall recovery starts the same way: less angle of attack.',
        say: {
          full: 'The wing stalls when it passes its **critical angle of attack**, at any airspeed, any attitude and any power setting. So the first move is always **forward pressure** to reduce the angle, even with the ground in the windshield. Then level the wings with **coordinated** aileron and rudder, then add power. Picking up a dropped wing with aileron alone lowers that aileron, raising its angle of attack and deepening the stall on the side already stalled. If it keeps rolling and yawing into a **spin**, it is **PARE**: **P**ower idle, **A**ilerons neutral, **R**udder full opposite the rotation, **E**levator briskly forward, then neutralize the rudder when the rotation stops and recover from the dive.',
          short: 'Push first, then level coordinated, then power. Spin: power idle, ailerons neutral, opposite rudder, elevator forward.',
        },
      },
      {
        kind: 'turn', id: 't1', title: 'Angle, not speed',
        prompt: 'Pick the answer.',
        blanks: [
          { id: 'speed', label: 'The wing stalls at', answer: 'A critical angle of attack', choices: ['A critical angle of attack', 'The stall speed on the airspeed indicator', 'A nose-high attitude'],
            explain: 'It can stall at any airspeed and any attitude. The published stall speed is for wings level, 1 g, at a stated weight (PHAK ch. 5).' },
          { id: 'first', label: 'The first move in any stall recovery', answer: 'Reduce the angle of attack', choices: ['Add full power', 'Reduce the angle of attack', 'Level the wings with aileron'],
            explain: 'Power helps second or third. Without a lower angle of attack the wing stays stalled (AFH ch. 5).' },
          { id: 'skid', label: 'In a skidding turn, which wing stalls first?', answer: 'The inside wing', choices: ['The inside wing', 'The outside wing'],
            explain: 'The skid slows the inside wing and raises its angle of attack, so it stalls first and the airplane rolls into the turn and toward a spin.' },
          { id: 'pare', label: 'Spin recovery, the R in PARE', answer: 'Rudder full opposite the rotation', choices: ['Rudder full opposite the rotation', 'Rudder with the rotation', 'Rudder neutral'],
            explain: 'Opposite rudder stops the yaw. Ailerons stay neutral; elevator goes forward to break the stall.' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: c.title,
        situation: c.scene,
        options: [
          { id: 'aileron', label: 'Roll the low wing back up with aileron, and keep the nose up.' },
          { id: 'reduce-aoa', label: 'Push forward to unload, level with rudder and aileron, then power.' },
          { id: 'power-pull', label: 'Full power, and pull up away from the ground.' },
          { id: 'pare', label: 'Power idle, ailerons neutral, opposite rudder, elevator forward.' },
        ],
        grades,
        consequence: follow(grades, {}, {
          aileron: 'Down aileron on the low wing raises its angle of attack. That wing stalls deeper, the roll gets worse, and the airplane is on its way into a spin.',
          'reduce-aoa': grades['reduce-aoa'] === 'best'
            ? 'Right. A little forward pressure breaks the stall, rudder stops the yaw, aileron levels the wings once the wing is flying again, and full power climbs you away. You give up some altitude to get the wing back.'
            : 'Unloading helps, but the rotation has started. Power off and full opposite rudder are what stop it.',
          'power-pull': 'Pulling keeps the angle of attack past critical, and full power adds a yawing tendency. Near the ground this is how a stall becomes a spin.',
          pare: grades.pare === 'best'
            ? 'Right. Power idle, ailerons neutral, full right rudder, elevator briskly forward. The rotation stops; neutralize the rudder and ease out of the dive without exceeding the limits.'
            : 'The spin steps would work, but it hasn\'t started spinning. Unloading the wing and leveling coordinated is quicker and loses less altitude.',
        }, (id) => `That grades ${grades[id]} here.`),
        why: c.phase === 'incipient-spin'
          ? 'Once it rotates, PARE: power idle, ailerons neutral, rudder opposite, elevator forward. The sooner, the less altitude it costs.'
          : 'Reduce the angle of attack first, level coordinated, then power. Near the ground the instinct to pull is the one to override.',
      },
    ];
  },
};

// ---------------------------------------------------------------- 10.4

/** Landing fast in ground effect: how far the float goes, against the runway left. */
export function floatCase(ctx: LessonContext, v: number) {
  const plane = oralAirplane(ctx.aircraft);
  const { speeds: s } = speedsFor(ctx);
  const field = chartAirport(v === 1 ? 'KXQA' : '2X5')!;
  const cond = { fieldElevFt: field.elevationFt, altimeterInHg: 30.0, oatC: 20, headwindKt: 0, surface: field.surface };
  const book = landingDistance(plane.performance, cond);
  const fast = s.approachKias + (v === 1 ? 10 : 15);
  const floatFt = Math.round(floatDistance(book.over50Ft, s.approachKias, fast) / 10) * 10;
  const downFt = v === 1 ? 600 : 800;
  const remainingFt = field.runwayFt - downFt;
  const neededFt = Math.round((floatFt + book.groundRollFt * 1.5) / 10) * 10;
  return { field, book, fast, floatFt, downFt, remainingFt, neededFt, grades: gradeFloat(remainingFt, neededFt) };
}

const groundEffectLesson: Lesson = {
  id: '10.4', module: 10, minutes: 12,
  title: 'Ground effect',
  summary: 'Why the airplane flies too early on a soft field and floats too long when you come in fast, and what to do about each.',
  acs: ['PA.IV.C', 'PA.IV.D', 'PA.IV.B'],
  refs: ['PHAK ch. 5', 'Airplane Flying Handbook (FAA-H-8083-3), soft-field takeoff'],
  variants: 3,
  build(ctx) {
    const v = Math.min(ctx.variant ?? 0, 2);
    const { speeds: s, note } = speedsFor(ctx);
    const plane = oralAirplane(ctx.aircraft);
    const vx = plane.performance.vxKias;
    const brief = {
      kind: 'brief' as const, id: 'b1', title: 'A cushion a wingspan deep',
      scene: 'Within about one wingspan of the ground, the ground gets in the way of the wingtip vortices.',
      say: {
        full: `Close to the ground the wing\'s downwash and tip vortices can\'t fully form, so **induced drag drops**, by almost half at a tenth of a wingspan. The airplane flies at a lower speed near the ground than it can climb at. That is the trap on a **soft-field takeoff**: it lifts off early, and if you climb out of ground effect before reaching Vx, drag comes back and it settles onto the runway or stalls. The cure is to **level off in ground effect and accelerate**. On landing, the same cushion makes an airplane that is **too fast float**, and the extra distance grows with the square of the extra speed. Hold it off and let it settle, or go around; never push it onto the runway.${note}`,
        short: 'Ground effect cuts induced drag. Accelerate in it on takeoff; on landing, extra speed means a long float.',
      },
    };
    if (v === 0) {
      const t = takeoffDistance(plane.performance, { fieldElevFt: 820, altimeterInHg: 30.0, oatC: 20, headwindKt: 0, surface: 'grass' });
      const grades: Record<string, Grade> = { climb: 'unsafe', accelerate: 'best', abort: 'marginal', 'flaps-up': 'unsafe' };
      return [
        brief,
        {
          kind: 'turn', id: 't1', title: 'Near the ground',
          prompt: 'From the brief.',
          blanks: [
            { id: 'depth', label: 'Ground effect is strong within about', answer: 'One wingspan', choices: ['One wingspan', 'Fifty feet', 'Pattern altitude'], explain: 'It is noticeable within about a wingspan of the surface and strongest much lower (PHAK ch. 5).' },
            { id: 'drag', label: 'What ground effect reduces', answer: 'Induced drag', choices: ['Induced drag', 'Parasite drag', 'Weight'], explain: 'The ground restricts the downwash and tip vortices, which is where induced drag comes from.' },
          ],
        },
        {
          kind: 'decide', id: 'd1', title: 'Off the soft field',
          situation: `A soft-field takeoff from wet grass, flaps at the soft-field setting. You held the nose up and the airplane lifted off well below Vx, ${vx} knots. A few feet up the stall horn chirps and it starts to sink when you raise the nose. The book takeoff on dry grass would be ${fmt(t.groundRollFt)} feet of roll.`,
          options: [
            { id: 'climb', label: 'Pitch up and climb away. You are airborne now.' },
            { id: 'accelerate', label: `Stay a few feet up, and accelerate to ${vx} before climbing.` },
            { id: 'abort', label: 'Close the throttle and land straight ahead on the grass left.' },
            { id: 'flaps-up', label: 'Raise the flaps to get rid of drag, then climb.' },
          ],
          grades,
          consequence: {
            climb: 'Out of ground effect below Vx, the induced drag comes back all at once. The airplane settles back onto the grass, or stalls a few feet up.',
            accelerate: `Right. Level off just above the grass, in ground effect, where the drag is low, and let the speed build to ${vx}. Then climb at Vx over anything ahead and Vy after.`,
            abort: 'Sometimes the right call on a short field, and you would have to judge the runway left. Here the airplane was flying; it only needed speed.',
            'flaps-up': 'Flaps up at a few feet and below Vx takes away lift you are depending on. The airplane sinks back.',
          },
          why: 'On a soft field the airplane lifts off early because ground effect lets it. Stay in ground effect until Vx, then climb. Climbing out early is the soft-field accident.',
        },
      ];
    }
    const f = floatCase(ctx, v);
    return [
      brief,
      {
        kind: 'turn', id: 't1', title: 'The float',
        prompt: `Your book landing over 50 feet here is ${fmt(f.book.over50Ft)} feet at ${s.approachKias} knots. You cross the threshold at ${f.fast}.`,
        blanks: [
          { id: 'ratio', label: 'Speed ratio, squared', answer: Math.round((f.fast / s.approachKias) ** 2 * 100) / 100, tolerance: 0.03, explain: `(${f.fast} ÷ ${s.approachKias})² = ${g2((f.fast / s.approachKias) ** 2)}.` },
          { id: 'float', label: 'Extra distance floating', unit: 'ft', answer: f.floatFt, tolerance: 40, explain: `${fmt(f.book.over50Ft)} × (${g2((f.fast / s.approachKias) ** 2)} − 1) ≈ ${fmt(f.floatFt)} feet more before the wheels are on.` },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'Floating down the runway',
        situation: `${f.fast} knots over the threshold at ${f.field.name}, ${fmt(f.field.runwayFt)} feet of ${f.field.surface}. You are ${fmt(f.downFt)} feet down, a foot off the surface, and it won\'t settle. ${fmt(f.remainingFt)} feet are left. The float and the roll with the margin need about ${fmt(f.neededFt)}.`,
        options: [
          { id: 'force', label: 'Push the nose down and put it on the runway.' },
          { id: 'hold-off', label: 'Hold it off, nose up a little more, and let it settle.' },
          { id: 'go-around', label: 'Go around and come back at the right speed.' },
          { id: 'dive', label: 'Close the throttle, nose down, and brake hard on touchdown.' },
        ],
        grades: f.grades,
        consequence: {
          force: 'Forcing it on at speed lands it on the nose wheel first. It bounces, you correct, it bounces higher: a porpoise that ends with a broken nose gear or a prop strike.',
          'hold-off': f.grades['hold-off'] === 'best'
            ? `Right. ${fmt(f.remainingFt)} feet is room for the ${fmt(f.neededFt)} you need. Keep it a foot off, raise the nose as it slows, and it settles on the mains.`
            : `${fmt(f.remainingFt)} feet left and you need ${fmt(f.neededFt)}. Holding off uses the runway you don\'t have; you run off the end at a walking pace, or into the trees.`,
          'go-around': f.grades['go-around'] === 'best'
            ? `Right. With ${fmt(f.remainingFt)} feet left against ${fmt(f.neededFt)}, the only good landing is the next one. Full power, carb heat off, pitch for Vy, flaps up in stages.`
            : 'Never wrong. Here there was room to let it settle.',
          dive: 'Nose down from a float is the same porpoise, with brakes on a wheel that may not be on the ground yet.',
        },
        why: `Extra speed grows the landing with its square: ${f.fast} instead of ${s.approachKias} adds about ${fmt(f.floatFt)} feet of float. When the runway left covers it, hold off and let it settle. When it doesn\'t, go around early. Never force it on.${note}`,
      },
    ];
  },
};

export const aeroLessons: Lesson[] = [turnLesson, vaLesson, stallLesson, groundEffectLesson];
