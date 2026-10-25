// Module 9, Airport operations: the ground and the pattern, where most of the
// collisions that matter happen. Signs and runway crossings, the tower's light
// gun when the radio dies, who gives way, and where a big airplane's wake
// goes. The rules live in lib/airportOps.ts and every grade comes from there.
// The airports are on the practice sectional, so no real field is assumed.

import { chartAirport } from '../chart/practiceRegion';
import {
  gradeLightOnFinal, gradeTaxi, gradeWake, LIGHT_MEANS, LIGHT_NAMES, rightOfWay,
  type AirportSign, type Encounter, type LightSignal, type TaxiSituation, type WakeSituation,
} from '../lib/airportOps';
import { landingDistance, takeoffDistance } from '../lib/perf';
import type { Grade } from '../scenarios/goNoGo';
import { oralAirplane, RUNWAY_MARGIN } from './oralChecks';
import { PRACTICE_TAIL } from './pilotAirplane';
import type { Figure, Lesson, LessonContext, Option } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const r50 = (n: number) => Math.round(n / 50) * 50;
/** The practice tail, shortened the way a controller says it once you have checked in. */
const SHORT_CALL = 'Zero X-ray Yankee Zulu';

/** Copy written for the intended grade; when the engine grades it otherwise, say what the engine saw. */
function follow<T extends string>(grades: Record<T, Grade>, intended: Partial<Record<T, Grade>>, written: Record<T, string>, why: (id: T) => string): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const id of Object.keys(written) as T[]) out[id] = !intended[id] || intended[id] === grades[id] ? written[id] : why(id);
  return out;
}

const signsFig = (signs: AirportSign[], marking: 'runway-hold' | 'ils-hold' | undefined, where: string): Figure => ({
  kind: 'signs', signs, marking,
  caption: `${where} Drawn for this lesson at a practice airport, not a real field.`,
});

// ---------------------------------------------------------------- 9.1

interface TaxiCase {
  clearance: string;
  situation: TaxiSituation;
  where: string;
  signs: AirportSign[];
  marking?: 'runway-hold' | 'ils-hold';
  scene: string;
  labels: Record<'continue' | 'stop-call' | 'stop-wait' | 'look-go', string>;
  intended: Partial<Record<'continue' | 'stop-call' | 'stop-wait' | 'look-go', Grade>>;
  written: Record<'continue' | 'stop-call' | 'stop-wait' | 'look-go', string>;
  why: string;
}

function taxiCase(v: number): TaxiCase {
  if (v === 1) {
    return {
      clearance: `"${SHORT_CALL}, runway 35, taxi via Alpha, cross runway 6-24."`,
      situation: { kind: 'runway-crossing', runway: '6-24', crossingCleared: true },
      where: 'Taxiway Alpha at runway 6-24.',
      signs: [{ kind: 'location', text: 'A' }, { kind: 'mandatory', text: '6-24' }],
      marking: 'runway-hold',
      scene: 'You read the crossing back. At the end of the ramp, Alpha meets runway 6-24, and the hold line is under your nose.',
      labels: {
        continue: 'Keep rolling straight across. You were cleared to cross.',
        'stop-call': 'Stop at the hold line and ask ground to confirm the crossing.',
        'stop-wait': 'Stop at the hold line and wait for ground to call you.',
        'look-go': 'Look both ways and down both finals, then cross without stopping.',
      },
      intended: { continue: 'acceptable', 'look-go': 'best', 'stop-call': 'acceptable', 'stop-wait': 'marginal' },
      written: {
        continue: 'Legal, and you did cross. But a clearance is not a guarantee: a look both ways and down both finals is what catches the airplane landing on the wrong runway.',
        'stop-call': 'Safe, and it costs a call on a busy frequency. You had the crossing and read it back.',
        'stop-wait': 'Ground already cleared you. Sitting at the hold line holds up everyone behind you, and the next call you get may be a puzzled one.',
        'look-go': 'Right. You have an explicit crossing clearance, read back. Look left, right and down both approaches, then cross promptly and don\'t stop on the runway.',
      },
      why: 'Each runway crossing needs its own explicit clearance (AIM 4-3-18), and you had one. A clearance still isn\'t a substitute for looking: scan both directions and both finals before the nose wheel passes the hold line.',
    };
  }
  if (v === 2) {
    return {
      clearance: `"${SHORT_CALL}, runway 35, taxi via Alpha, cross runway 6-24."`,
      situation: { kind: 'ils-hold', toldToHold: false },
      where: 'Taxiway Alpha, short of runway 35.',
      signs: [{ kind: 'location', text: 'A' }, { kind: 'ils', text: 'ILS' }],
      marking: 'ils-hold',
      scene: 'Across 6-24 and nearly at the end of Alpha. It is a clear day, nobody is on an instrument approach, and ahead you see a yellow sign that reads ILS over a yellow ladder painted across the taxiway. The runway 35 hold line is further on.',
      labels: {
        continue: 'Taxi past it to the runway hold line and do your run-up there.',
        'stop-call': 'Stop at the ILS line and call ground to ask whether you can pass.',
        'stop-wait': 'Stop at the ILS line. Every yellow line on a taxiway is a hold line.',
        'look-go': 'Stop briefly, look for traffic on final, then continue to the runway.',
      },
      intended: { continue: 'best', 'stop-call': 'marginal', 'stop-wait': 'marginal', 'look-go': 'acceptable' },
      written: {
        continue: 'Right. The ILS critical area is a holding point only when ATC tells you to hold there, usually when the weather is low and someone is on the approach. Today nobody told you to.',
        'stop-call': 'Harmless, but it shows you didn\'t know the sign. It is a holding point only on instruction (AIM 2-3-8).',
        'stop-wait': 'Not every yellow line is a runway hold line. Stopping here for no reason blocks the taxiway, and the tower is waiting for you at the real one.',
        'look-go': 'Looking is never wrong, but there was no reason to stop. The runway hold line ahead is where you stop.',
      },
      why: 'Two holding position markings guard a runway. The runway hold line (two solid and two dashed lines, with a red sign) always needs a clearance to pass. The ILS ladder and its yellow "ILS" sign protect the localizer signal, and you hold there only when ATC tells you to (AIM 2-3-5, 2-3-8).',
    };
  }
  if (v === 3) {
    return {
      clearance: `"${SHORT_CALL}, runway 35, taxi via Alpha, cross runway 6-24."`,
      situation: { kind: 'lost' },
      where: 'A taxiway intersection you weren\'t expecting.',
      signs: [{ kind: 'direction', text: 'A', arrowDeg: -90 }, { kind: 'location', text: 'B' }, { kind: 'direction', text: 'C', arrowDeg: 90 }],
      scene: 'It is after dark and you have never been here. You turned off the ramp where you thought Alpha began. Now the black location sign in front of you says B, and the arrows say Alpha is back to your left.',
      labels: {
        continue: 'Keep going. Bravo probably leads to the same runway.',
        'stop-call': 'Stop, tell ground you\'re unsure where you are, and ask for progressive taxi.',
        'stop-wait': 'Stop, and study the airport diagram until you work it out.',
        'look-go': 'Turn left at the sign and find Alpha yourself. No need to bother ground.',
      },
      intended: { continue: 'unsafe', 'stop-call': 'best', 'stop-wait': 'acceptable', 'look-go': 'unsafe' },
      written: {
        continue: 'This is how runway incursions start: a pilot who isn\'t where they think, still moving. Bravo might cross a runway before it goes anywhere useful.',
        'stop-call': 'Right. "Ground, Zero X-ray Yankee Zulu, I\'m on Bravo, not sure of my position." Ground gives you progressive taxi, turn by turn, and nobody minds.',
        'stop-wait': 'Stopping is the important part, and the diagram helps. But ground can see you and knows the field; one call fixes it faster.',
        'look-go': 'You were cleared via Alpha, so you are already off your clearance. Turning on your own at night at a strange field is a second guess on top of the first.',
      },
      why: 'When you are unsure where you are on an airport, stop and say so. Ask for progressive taxi instructions (AIM 4-3-18). Never cross a hold line you aren\'t sure about. Have the airport diagram out before you start, with the route traced, especially at night.',
    };
  }
  return {
    clearance: `"${SHORT_CALL}, runway 35, taxi via Alpha."`,
    situation: { kind: 'runway-crossing', runway: '6-24', crossingCleared: false },
    where: 'Taxiway Alpha at runway 6-24.',
    signs: [{ kind: 'location', text: 'A' }, { kind: 'mandatory', text: '6-24' }],
    marking: 'runway-hold',
    scene: 'At the end of the ramp, Alpha meets runway 6-24 on the way to 35. A red sign reads 6-24, and two solid yellow lines cross the taxiway under your nose.',
    labels: {
      continue: 'Keep taxiing. The clearance to runway 35 takes you all the way there.',
      'stop-call': 'Stop at the hold line and call ground: holding short of 6-24 at Alpha.',
      'stop-wait': 'Stop at the hold line and wait for ground to call you.',
      'look-go': 'Look both ways, and cross quickly if nobody is landing.',
    },
    intended: { continue: 'unsafe', 'stop-call': 'best', 'stop-wait': 'acceptable', 'look-go': 'unsafe' },
    written: {
      continue: 'A taxi clearance to a runway does not clear you across any runway on the way. You have just entered an active runway without a clearance: a runway incursion.',
      'stop-call': 'Right. You stop with the nose short of the solid lines and tell ground where you are. They clear you across, you read it back, look both ways and cross.',
      'stop-wait': 'Safe, and legal. Ground may have forgotten you, though, and a short call saves the wait.',
      'look-go': 'Looking is good and still not a clearance. At a towered field, 91.129(i) needs a clearance to be on a runway at all.',
    },
    why: 'Since 2010 a taxi clearance no longer implies crossing runways on the way: each crossing needs its own explicit clearance, and you read back every hold short instruction (AIM 4-3-18). The red sign and the solid lines on your side are where you stop.',
  };
}

const taxiLesson: Lesson = {
  id: '9.1', module: 9, minutes: 14,
  title: 'Signs, lines and runway crossings',
  summary: 'Read the signs at a towered field, stop where the paint says to, and know what a taxi clearance does and doesn\'t cover.',
  acs: ['PA.II.D', 'PA.III.A'],
  refs: ['AIM 2-3-5', 'AIM 2-3-8', 'AIM 4-3-18', '14 CFR 91.129'],
  variants: 4,
  build(ctx) {
    const v = ctx.variant ?? 0;
    const c = taxiCase(v);
    const field = chartAirport('KXQC')!;
    const grades = gradeTaxi(c.situation);
    const options: Option[] = (['continue', 'stop-call', 'stop-wait', 'look-go'] as const).map((id) => ({ id, label: c.labels[id] }));
    return [
      {
        kind: 'brief', id: 'b1', title: 'Red means a runway',
        scene: `You're in ${PRACTICE_TAIL} at ${field.name}, a towered field on the practice sectional with two runways that cross. Ground has just said: ${c.clearance}`,
        say: {
          full: 'Signs come in three colors that matter. **White on red** is a mandatory instruction: a runway, or the area that protects it. You stop there unless cleared. **Yellow on black** is a location sign: where you are now. **Black on yellow** says where something is: direction signs with arrows, and destination signs. On the pavement, the runway holding position is **two solid and two dashed yellow lines**. Stop on the solid side. And since 2010, "taxi to runway 35" no longer clears you across anything on the way: each runway crossing needs its own clearance, and you read back every hold short.',
          short: 'Red: a runway, stop unless cleared. Solid lines are your side. Each crossing needs its own clearance.',
        },
        figure: signsFig([{ kind: 'direction', text: 'C', arrowDeg: -45 }, { kind: 'location', text: 'A' }, { kind: 'mandatory', text: '6-24' }, { kind: 'destination', text: '35', arrowDeg: 0 }], 'runway-hold', 'A typical spot on a taxiway: where Charlie goes, where you are, the runway ahead, and the way to runway 35.'),
      },
      {
        kind: 'turn', id: 't1', title: 'Read the signs',
        prompt: 'From the signs above.',
        blanks: [
          { id: 'red', label: 'The red 6-24 sign means', answer: 'A runway: stop unless cleared', choices: ['A runway: stop unless cleared', 'You are on runway 6-24', 'Runway 6-24 is to the right', 'Runway 6-24 is closed'],
            explain: 'White on red is a mandatory instruction sign. 6-24 is the runway ahead, with its ends left and right in the order they lie (AIM 2-3-8).' },
          { id: 'black', label: 'The black sign with a yellow A means', answer: 'You are on taxiway A', choices: ['You are on taxiway A', 'Taxiway A is ahead', 'Turn onto A here', 'A is closed'],
            explain: 'Yellow letters on black are a location sign: the taxiway you are on now (AIM 2-3-9).' },
          { id: 'side', label: 'At the hold line you stop on the side with', answer: 'The solid lines', choices: ['The solid lines', 'The dashed lines'],
            explain: 'Solid lines face you on the taxiway side; dashed lines face the runway. From the dashed side you can cross without a clearance, which is how you leave a runway after landing (AIM 2-3-5).' },
          { id: 'readback', label: 'Ground says "hold short of runway 6-24". You', answer: 'Read back the hold short with your call sign', choices: ['Read back the hold short with your call sign', 'Say "roger"', 'Click the mic twice'],
            explain: 'Hold short instructions are always read back: "Hold short of 6-24, Zero X-ray Yankee Zulu" (AIM 4-3-18).' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'At the sign',
        situation: `${c.clearance.replace(/"/g, '')} ${c.scene}`,
        figure: signsFig(c.signs, c.marking, c.where),
        options,
        grades,
        consequence: follow(grades, c.intended, c.written, (id) => `That grades ${grades[id]} here.`),
        why: c.why,
      },
    ];
  },
};

// ---------------------------------------------------------------- 9.2

const LIGHT_CASES: { signal: LightSignal; scene: string }[] = [
  { signal: 'steady-green', scene: 'On a two-mile final you see a steady green light from the tower cab.' },
  { signal: 'steady-red', scene: 'On a two-mile final you see a steady red light from the tower cab. A jet is turning onto the runway.' },
  { signal: 'flashing-red', scene: 'On a two-mile final you see a flashing red light from the tower cab. There are trucks on the runway.' },
];

const radioOutLesson: Lesson = {
  id: '9.2', module: 9, minutes: 12,
  title: 'Radio out at a towered field',
  summary: 'Squawk 7600, join the pattern where the tower can see you, and read the light gun, which means something different on the ground and in the air.',
  acs: ['PA.III.A'],
  refs: ['14 CFR 91.125', 'AIM 4-3-13', 'AIM 6-4-2', '14 CFR 91.129'],
  variants: 3,
  build(ctx) {
    const v = Math.min(ctx.variant ?? 0, LIGHT_CASES.length - 1);
    const lc = LIGHT_CASES[v];
    const field = chartAirport('KXYZ')!;
    const grades = gradeLightOnFinal(lc.signal);
    const means = LIGHT_MEANS[lc.signal];
    const choicesAir = ['Cleared to land', 'Give way and keep circling', 'Airport unsafe, do not land', 'Return for landing'];
    const choicesGround = ['Cleared for takeoff', 'Cleared to taxi', 'Stop', 'Taxi clear of the runway', 'Return to the starting point'];
    return [
      {
        kind: 'brief', id: 'b1', title: 'Silence on the frequency',
        scene: `Ten miles out from ${field.name}, the practice field, you call the tower and hear nothing back. The radio's display is on; the side tone is gone.`,
        say: {
          full: 'Check the obvious first: volume, the frequency, the headset jacks, the other radio. If it is really dead, **squawk 7600**. Stay outside the Class D until you have worked out which runway is in use from the windsock or the traffic, then join the pattern where the tower can see you, usually a **45 to the downwind**. Watch the tower cab for the **light gun**. In the air you answer by **rocking your wings**, at night by flashing the landing light. On the ground, move the ailerons or rudder. 91.129 lets you land without two-way radio when the weather is VFR, you keep visual contact with the tower and you get a clearance to land, which is a steady green.',
          short: 'Squawk 7600, join on a 45 where the tower can see you, and watch the cab.',
        },
      },
      {
        kind: 'turn', id: 't1', title: 'The light gun',
        prompt: 'Each light means one thing in the air and another on the ground.',
        blanks: [
          { id: 'green-air', label: 'Steady green, in the air', answer: LIGHT_MEANS['steady-green'].air, choices: choicesAir, explain: '91.125: steady green in the air is cleared to land.' },
          { id: 'red-air', label: 'Steady red, in the air', answer: 'Give way and keep circling', choices: choicesAir, explain: `91.125: ${LIGHT_MEANS['steady-red'].air.toLowerCase()}.` },
          { id: 'fred-air', label: 'Flashing red, in the air', answer: 'Airport unsafe, do not land', choices: choicesAir, explain: `91.125: ${LIGHT_MEANS['flashing-red'].air.toLowerCase()}. Go somewhere else.` },
          { id: 'fgreen-ground', label: 'Flashing green, on the ground', answer: 'Cleared to taxi', choices: choicesGround, explain: '91.125: flashing green on the ground is cleared to taxi.' },
          { id: 'fred-ground', label: 'Flashing red, on the ground', answer: 'Taxi clear of the runway', choices: choicesGround, explain: `91.125: ${LIGHT_MEANS['flashing-red'].ground.toLowerCase()}.` },
          { id: 'white-ground', label: 'Flashing white, on the ground', answer: 'Return to the starting point', choices: choicesGround, explain: 'Return to your starting point on the airport. It has no meaning in the air.' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: 'The tower answers',
        situation: `Squawking 7600, you joined the downwind and rocked your wings at the tower. ${lc.scene} The radio is still silent.`,
        options: [
          { id: 'land', label: 'Continue the approach and land.' },
          { id: 'circle', label: 'Go around, give way, and fly the pattern again.' },
          { id: 'divert', label: 'Leave the pattern and land at another airport.' },
          { id: 'radio', label: 'Keep trying the radio before doing anything.' },
        ],
        grades,
        consequence: follow(grades, {}, {
          land: grades.land === 'best' ? 'Right. A steady green is your landing clearance. Rock your wings to acknowledge if you can, and land.' : lc.signal === 'steady-red' ? 'A steady red in the air means give way and keep circling. You just landed on a runway the tower was holding for someone else.' : 'A flashing red means the airport is unsafe. You landed among the trucks.',
          circle: grades.circle === 'best' ? 'Right. Steady red: give way and keep circling. Go around, fly the pattern again, and watch the cab for green.' : lc.signal === 'steady-green' ? 'You had a landing clearance, so going around just costs another lap and confuses the tower.' : 'Circling doesn\'t help: a flashing red means the airport is unsafe, not that you should wait.',
          divert: grades.divert === 'best' ? 'Right. Flashing red in the air means airport unsafe, do not land. Go to your alternate, squawking 7600, and call the tower by phone when you are down.' : lc.signal === 'steady-green' ? 'You were cleared to land. Leaving now trades a clearance for an unplanned trip without a radio.' : 'Legal, but a steady red only means wait your turn. You could have landed a lap later.',
          radio: 'On short final the airplane needs you more than the radio does. The light already told you what to do.',
        }, (id) => `That grades ${grades[id]} with this light.`),
        why: `${LIGHT_NAMES[lc.signal]} in the air means "${means.air.toLowerCase()}" (91.125). On the ground it would mean "${means.ground.toLowerCase()}". Knowing both columns is the point: you will see these once in a flying career, with no time to look them up.`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 9.3

interface RowCase {
  encounter: Encounter;
  title: string;
  scene: string;
  options: Option[];
  grades: Record<string, Grade>;
  written: Record<string, string>;
}

function rowCase(v: number): RowCase {
  if (v === 1) {
    const e: Encounter = { kind: 'converging', you: 'airplane', other: 'airplane', otherOn: 'right' };
    const r = rightOfWay(e);
    const theirs = r.has === 'other';
    return {
      encounter: e, title: 'Converging at the 45',
      scene: 'You are on the 45 to the downwind, at pattern altitude. A low-wing airplane at the same altitude is converging from your right, joining the same downwind. Neither of you has said anything on the radio.',
      options: [
        { id: 'hold', label: 'Hold your course and altitude. You are already established on the 45.' },
        { id: 'behind', label: 'Turn right, behind it, and follow it into the downwind.' },
        { id: 'climb', label: 'Climb over it and join the downwind ahead of it.' },
        { id: 'call', label: 'Call your position and keep going, so it knows you are there.' },
      ],
      grades: { hold: theirs ? 'unsafe' : 'best', behind: theirs ? 'best' : 'acceptable', climb: 'unsafe', call: theirs ? 'marginal' : 'acceptable' },
      written: {
        hold: 'Being established on the 45 gives you nothing. Same category, converging: it is on your right, so it has the right of way.',
        behind: 'Right. It is on your right, so it has the right of way. Turn behind it, call that you are following it, and join the downwind with room.',
        climb: '91.113(b) says don\'t pass over, under or ahead of an aircraft with the right of way unless well clear. Climbing over a converging airplane at pattern altitude is how midairs happen.',
        call: 'A call is good airmanship. It doesn\'t change who gives way, and you still have to.',
      },
    };
  }
  if (v === 3) {
    const e: Encounter = { kind: 'converging', you: 'airplane', other: 'airplane', otherOn: 'left' };
    const r = rightOfWay(e);
    const yours = r.has === 'you';
    return {
      encounter: e, title: 'Converging from the left',
      scene: 'Cruising at 4,500. A high-wing airplane at your altitude is converging from your left, two miles off, its bearing not changing. It hasn\'t turned yet.',
      options: [
        { id: 'hold', label: 'Hold your course and speed, keep it in sight, and be ready to turn.' },
        { id: 'behind', label: 'Turn left now and pass behind it, to be on the safe side.' },
        { id: 'climb', label: 'Climb a few hundred feet and let it pass under you.' },
        { id: 'call', label: 'Keep going, and stop watching it: you have the right of way.' },
      ],
      grades: { hold: yours ? 'best' : 'unsafe', behind: yours ? 'acceptable' : 'best', climb: 'marginal', call: 'unsafe' },
      written: {
        hold: 'Right. It is on your left, so you have the right of way and the other pilot gives way. The rule works when the airplane with the right of way is predictable. Keep it in sight; if it doesn\'t turn soon, you turn, because 91.113(b) makes avoiding a collision everyone\'s job.',
        behind: 'Not wrong, and sometimes needed. But turning toward it while it turns behind you is how two polite pilots meet. Holding course is what the other pilot expects.',
        climb: 'Climbing hides it under your nose, the one place a high wing pilot can\'t see either. If you maneuver, turn so you keep it in sight.',
        call: 'Right of way isn\'t a shield. If the other pilot hasn\'t seen you, the rules won\'t move them. Watch it until it is clearly passing.',
      },
    };
  }
  if (v === 2) {
    const e: Encounter = { kind: 'converging', you: 'airplane', other: 'towing', otherOn: 'left' };
    const r = rightOfWay(e);
    const theirs = r.has === 'other';
    return {
      encounter: e, title: 'A towplane from the left',
      scene: 'Cruising at 3,500 near a glider field. A towplane with a glider behind it is converging from your left at about your altitude.',
      options: [
        { id: 'hold', label: 'Hold your course. It is on your left, so you have the right of way.' },
        { id: 'behind', label: 'Turn to pass well behind the glider, not between it and the towplane.' },
        { id: 'climb', label: 'Climb to pass over the towplane and its rope.' },
        { id: 'call', label: 'Rock your wings and keep going, so the tow pilot sees you.' },
      ],
      grades: { hold: theirs ? 'unsafe' : 'best', behind: theirs ? 'best' : 'acceptable', climb: 'unsafe', call: theirs ? 'unsafe' : 'acceptable' },
      written: {
        hold: 'The right-hand rule only applies between aircraft of the same category. An aircraft towing has the right of way over other engine-driven aircraft, whichever side it is on (91.113(d)).',
        behind: 'Right. A towplane can barely maneuver, and the glider on the rope even less. Pass well behind the glider. Never cross between them: the rope can be 200 feet long.',
        climb: 'The rope and the glider are behind and often below the towplane, and the glider can release and climb. Passing over a tow is passing close to something you can\'t see well.',
        call: 'The tow pilot has the right of way and almost no room to use it. Rocking your wings asks them to move.',
      },
    };
  }
  const e: Encounter = { kind: 'landing', youLower: false, otherOnFinal: true };
  const r = rightOfWay(e);
  const theirs = r.has === 'other';
  return {
    encounter: e, title: 'A straight-in on final',
    scene: 'You are on the downwind at a nontowered field, abeam the numbers. Someone calls a three-mile final for the same runway, straight in. Turning base now would put you in front of them.',
    options: [
      { id: 'hold', label: 'Turn base now. You are in the pattern; they skipped it.' },
      { id: 'behind', label: 'Extend downwind, call that you have them, and turn base behind them.' },
      { id: 'climb', label: 'Make a short approach and land well ahead of them.' },
      { id: 'call', label: 'Ask them on the radio to go around and enter the pattern.' },
    ],
    grades: { hold: theirs ? 'unsafe' : 'acceptable', behind: theirs ? 'best' : 'acceptable', climb: theirs ? 'unsafe' : 'marginal', call: 'marginal' },
    written: {
      hold: 'Straight-ins are legal, and an aircraft on final has the right of way over one in the pattern (91.113(g)). Turning in front of it is cutting in.',
      behind: 'Right. "Traffic on final, I have you in sight, extending downwind, will follow." You turn base when they pass abeam, with room for them to clear the runway.',
      climb: 'A dive for the runway ahead of someone on final is the cut-in 91.113(g) prohibits, flown at low altitude with a rushed landing.',
      call: 'You may not like straight-ins, but they are legal. Asking someone on final to go around because you would rather go first isn\'t how right of way works.',
    },
  };
}

const rightOfWayLesson: Lesson = {
  id: '9.3', module: 9, minutes: 12,
  title: 'Who gives way',
  summary: 'The right of way rules in the order they apply: distress, then category, then geometry, with the traffic you actually meet near an airport.',
  acs: ['PA.III.B', 'PA.I.E'],
  refs: ['14 CFR 91.113', 'AIM 4-3-3'],
  variants: 4,
  build(ctx) {
    const c = rowCase(ctx.variant ?? 0);
    const r = rightOfWay(c.encounter);
    const ask = (e: Encounter) => (rightOfWay(e).has === 'other' ? 'The other aircraft' : rightOfWay(e).has === 'you' ? 'You' : 'Both turn right');
    const choices = ['You', 'The other aircraft', 'Both turn right'];
    const q1: Encounter = { kind: 'converging', you: 'airplane', other: 'airplane', otherOn: 'left' };
    const q2: Encounter = { kind: 'converging', you: 'airplane', other: 'glider', otherOn: 'left' };
    const q3: Encounter = { kind: 'head-on' };
    const q4: Encounter = { kind: 'overtaking', youAre: 'overtaking' };
    const q5: Encounter = { kind: 'landing', youLower: true, otherOnFinal: false };
    return [
      {
        kind: 'brief', id: 'b1', title: 'Three questions, in order',
        scene: 'Right of way is decided before anyone is close, by three questions asked in order.',
        say: {
          full: 'First: **is anyone in distress?** They have it over everyone. Second: **are you different categories?** The less maneuverable has it: balloons, then gliders, then aircraft towing or refueling, then airships, then airplanes and helicopters. Only then, third, **the geometry**: converging, the one on the right has it; head-on, both turn right; overtaking, the one ahead has it and you pass on its right. Landing aircraft have it over everyone in the air or on the ground, and the lower of two landing has it, but may not cut in. Whoever has the right of way still has to see and avoid (91.113(b)).',
          short: 'Distress, then category, then geometry. Landing traffic over all.',
        },
      },
      {
        kind: 'turn', id: 't1', title: 'Who has it?',
        prompt: 'You are in an airplane each time.',
        blanks: [
          { id: 'q1', label: 'Another airplane converging from your left', answer: ask(q1), choices, explain: rightOfWay(q1).rule },
          { id: 'q2', label: 'A glider converging from your left', answer: ask(q2), choices, explain: rightOfWay(q2).rule },
          { id: 'q3', label: 'An airplane coming straight at you', answer: ask(q3), choices, explain: rightOfWay(q3).rule },
          { id: 'q4', label: 'You are catching up with a slower airplane', answer: ask(q4), choices, explain: rightOfWay(q4).rule },
          { id: 'q5', label: 'Two of you on a long final, and you are lower', answer: ask(q5), choices, explain: rightOfWay(q5).rule },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: c.title,
        situation: c.scene,
        options: c.options,
        grades: c.grades,
        consequence: c.written,
        why: `${r.rule} ${r.action}`,
      },
    ];
  },
};

// ---------------------------------------------------------------- 9.4

export interface WakeCase {
  s: WakeSituation;
  title: string;
  scene: string;
  labels: Record<'go-now' | 'past-point' | 'wait' | 'before-point', string>;
}

/** The wake situations, with your own book distance plus the margin. */
export function wakeCase(ctx: LessonContext, v: number): WakeCase {
  const plane = oralAirplane(ctx.aircraft);
  const field = chartAirport('KXQC')!;
  const cond = { fieldElevFt: field.elevationFt, altimeterInHg: 30.0, oatC: 20, headwindKt: 0, surface: 'paved' as const };
  const takeoff = r50(takeoffDistance(plane.performance, cond).over50Ft * RUNWAY_MARGIN);
  const landing = r50(landingDistance(plane.performance, cond).over50Ft * RUNWAY_MARGIN);
  const runwayFt = field.runwayFt;
  if (v === 1) {
    const point = 1800;
    return {
      s: { you: 'takeoff', leader: 'landed', leaderPointFt: point, runwayFt, yourDistanceFt: takeoff, lingering: false },
      title: 'Behind a landing jet',
      scene: `A regional jet has just landed on runway 35 ahead of you, touching down about ${fmt(point)} feet from the threshold. Tower: "${SHORT_CALL}, runway 35, cleared for takeoff." The runway is ${fmt(runwayFt)} feet; you need ${fmt(takeoff)} to clear 50 feet with the margin.`,
      labels: {
        'go-now': 'Take off normally and rotate at your usual point.',
        'past-point': `Rotate past its touchdown point, ${fmt(point)} feet down.`,
        wait: 'Tell tower you need two minutes for the wake.',
        'before-point': 'Rotate as early as you can, and stay low and fast in ground effect.',
      },
    };
  }
  if (v === 2) {
    const point = 1500;
    return {
      s: { you: 'landing', leader: 'landed', leaderPointFt: point, runwayFt, yourDistanceFt: landing, lingering: true },
      title: 'Following a jet to land',
      scene: `You are on a four-mile final to runway 35 behind a regional jet, cleared to land, "caution wake turbulence". The wind is light and quartering from behind. The jet touches down about ${fmt(point)} feet down the ${fmt(runwayFt)} foot runway. You need ${fmt(landing)} to land over 50 feet with the margin.`,
      labels: {
        'go-now': 'Fly your normal approach and touch down on the numbers.',
        'past-point': 'Stay above its glidepath and touch down past where it did.',
        wait: 'Go around, and come back once the wake has had time to drift off.',
        'before-point': 'Come in low and flat, and land short of where it touched down.',
      },
    };
  }
  if (v === 3) {
    const point = 3800;
    return {
      s: { you: 'landing', leader: 'departed', leaderPointFt: point, runwayFt, yourDistanceFt: landing, lingering: false },
      title: 'Landing behind a departing jet',
      scene: `Short final for runway 35. A business jet has just taken off ahead of you, rotating about ${fmt(point)} feet down the runway. You need ${fmt(landing)} feet to land over 50 feet with the margin.`,
      labels: {
        'go-now': 'Land as normal. The wake is up where the jet is now.',
        'past-point': 'Float down the runway and land past its rotation point.',
        wait: 'Go around and give it a couple of minutes.',
        'before-point': `Land on the numbers and stop well before ${fmt(point)} feet.`,
      },
    };
  }
  const point = 2500;
  return {
    s: { you: 'takeoff', leader: 'departed', leaderPointFt: point, runwayFt, yourDistanceFt: takeoff, lingering: false },
    title: 'Behind a departing jet',
    scene: `A regional jet has just lifted off runway 35, rotating about ${fmt(point)} feet down. Tower: "${SHORT_CALL}, runway 35, caution wake turbulence, cleared for takeoff."`,
    labels: {
      'go-now': 'Take off right away. The tower cleared you.',
      'past-point': 'Take off and lift off past its rotation point.',
      wait: 'Tell tower you\'d like to wait two minutes for the wake.',
      'before-point': 'Rotate before its rotation point and climb above its path.',
    },
  };
}

const wakeLesson: Lesson = {
  id: '9.4', module: 9, minutes: 14,
  title: 'Wake turbulence',
  summary: 'Where a big airplane\'s wake starts, where it ends and where it drifts, and how a light airplane stays out of it on the same runway.',
  acs: ['PA.IV.A', 'PA.IV.B'],
  refs: ['AIM 7-4-6', 'AIM 7-4-4'],
  variants: 4,
  build(ctx) {
    const v = ctx.variant ?? 0;
    const c = wakeCase(ctx, v);
    const grades = gradeWake(c.s);
    const ids = ['go-now', 'past-point', 'wait', 'before-point'] as const;
    const beyond = c.s.runwayFt - c.s.leaderPointFt;
    const fitsBeyond = beyond >= c.s.yourDistanceFt;
    const consequence: Record<string, string> = {};
    for (const id of ids) {
      consequence[id] = (() => {
        const g = grades[id];
        if (c.s.you === 'takeoff' && c.s.leader === 'departed') {
          return {
            'go-now': 'The tower cleared you; it didn\'t take your wake for you. At the jet\'s rotation point its vortices are sinking onto the runway, and you fly through them at 60 knots with a fraction of the roll authority they need.',
            'past-point': 'Past its rotation point is exactly where the vortices are. That is the advice for following a landing, not a departure.',
            wait: 'Right. "Tower, Zero X-ray Yankee Zulu would like two minutes for wake." Two minutes lets the vortices sink and drift. The tower expects the request.',
            'before-point': 'For an airplane that can climb above a jet\'s path. A trainer can\'t: the jet is climbing three times as fast, so you end up flying up into its wake.',
          }[id];
        }
        if (c.s.you === 'takeoff') {
          return {
            'go-now': `A normal rotation, around a thousand feet down, is short of its touchdown point at ${fmt(c.s.leaderPointFt)}. You lift off into the air its vortices sank through on the way down.`,
            'past-point': fitsBeyond ? `Right. Its vortices started at touchdown, ${fmt(c.s.leaderPointFt)} feet down. Lift off past that point and you climb above where they began, with ${fmt(beyond)} feet left for your ${fmt(c.s.yourDistanceFt)}.` : `Only ${fmt(beyond)} feet remain past its touchdown point, short of your ${fmt(c.s.yourDistanceFt)}. Wait instead.`,
            wait: g === 'best' ? 'Right. There isn\'t enough runway past its touchdown point, so give the wake time to clear.' : 'Safe, and costs two minutes. There was enough runway past its touchdown point to go now.',
            'before-point': 'Low and slow under the path where its vortices lay before touchdown is the worst place on the runway to be.',
          }[id];
        }
        if (c.s.leader === 'landed') {
          return {
            'go-now': 'The numbers are short of its touchdown point, under the path its vortices are sinking from. With a light quartering tailwind they can drift back up the runway into your touchdown zone.',
            'past-point': fitsBeyond ? `Right. Stay at or above its glidepath and land beyond its touchdown point: you have ${fmt(beyond)} feet past it for your ${fmt(c.s.yourDistanceFt)}.` : `Only ${fmt(beyond)} feet remain past its touchdown point, short of your ${fmt(c.s.yourDistanceFt)}. Go around instead.`,
            wait: g === 'best' ? 'Right. There isn\'t enough runway past its touchdown point.' : 'Safe, and you could also have landed long, above its path, with room to spare.',
            'before-point': 'Low and flat behind a jet puts you under its glidepath, exactly where its vortices sink.',
          }[id];
        }
        return {
          'go-now': 'Probably fine, since you will land before its rotation point anyway. Say it out loud as a plan, though, not as luck.',
          'past-point': 'Past its rotation point is where its vortices begin. Floating down there is flying into them near the ground.',
          wait: 'Safe, and you didn\'t need to: landing before its rotation point keeps you clear.',
          'before-point': c.s.leaderPointFt >= c.s.yourDistanceFt ? `Right. Vortices start when the nose comes up, at ${fmt(c.s.leaderPointFt)} feet. You land and stop in ${fmt(c.s.yourDistanceFt)}, well before it.` : 'You can\'t stop before its rotation point with the margin. Go around.',
        }[id];
      })();
    }
    return [
      {
        kind: 'brief', id: 'b1', title: 'Where the wake is',
        scene: 'Every wing makes two vortices. A heavy, slow, clean airplane makes the strongest, and they can roll a trainer faster than its ailerons can stop it.',
        say: {
          full: 'Vortices **start when the nose wheel lifts off** and **end when it touches down**. In between they trail behind and below the airplane, **sink** at a few hundred feet a minute to level off about **500 to 1,000 feet** below its path, and **drift with the wind**. Near the ground they spread sideways at about 5 knots. A light crosswind can hold the upwind one on the runway; a **light quartering tailwind** is the worst, pushing them back into the touchdown zone. So: behind a landing, stay above its path and land **beyond** its touchdown point. Behind a departure, land **before** its rotation point. Taking off behind a departure, a light airplane can\'t climb above a jet\'s path, so it **waits**: ask for two minutes.',
          short: 'Wake starts at rotation, ends at touchdown, sinks and drifts. Stay above, land beyond, or wait.',
        },
      },
      {
        kind: 'turn', id: 't1', title: 'Where is it?',
        prompt: 'From the brief.',
        blanks: [
          { id: 'start', label: 'Vortices begin when the airplane', answer: 'Rotates', choices: ['Starts its roll', 'Rotates', 'Reaches 50 feet'], explain: 'They are made by lift, so they start when the wing starts lifting at rotation (AIM 7-4-4).' },
          { id: 'sink', label: 'They level off below the path by about', unit: 'ft', answer: 750, tolerance: 250, explain: 'They sink a few hundred feet a minute and level off about 500 to 1,000 feet below the flight path (AIM 7-4-4).' },
          { id: 'worst', label: 'The most dangerous wind on the runway', answer: 'Light quartering tailwind', choices: ['Strong headwind', 'Light quartering tailwind', 'Calm', 'Strong crosswind'], explain: 'It moves the vortices forward into the touchdown zone and keeps them there. A strong wind breaks them up quickly (AIM 7-4-4).' },
        ],
      },
      {
        kind: 'decide', id: 'd1', title: c.title,
        situation: c.scene,
        options: ids.map((id) => ({ id, label: c.labels[id] })),
        grades,
        consequence,
        why: 'Know where its vortices began or ended, then fly so you are above them or away from them. Behind a landing: above its path and beyond its touchdown point. Behind a departure: before its rotation point, or wait. ATC gives you a caution; the avoidance is yours (AIM 7-4-6, 7-4-8).',
      },
    ];
  },
};

export const airportOpsLessons: Lesson[] = [taxiLesson, radioOutLesson, rightOfWayLesson, wakeLesson];
export const _internal = { taxiCase, rowCase, LIGHT_CASES };
