// Lesson 5.6, The VOR when the GPS goes quiet: finding the course to the
// station with the OBS, reading the needle the right way round, and checking
// the ident before trusting any of it. The station is made up for the lesson
// and isn't on any chart, so nothing here assumes a particular airplane or
// panel beyond a nav radio with a CDI. The indications and grades come from
// lib/vor.ts.

import {
  courseToStation, DEG_PER_DOT, gradeIdent, gradeVorTurn, morse, norm360, vorIndication,
  type IdentOption, type VorTurnOption,
} from '../lib/vor';
import type { Grade } from '../scenarios/goNoGo';
import type { Dial, DialLine, DialState, DialValues, Figure, Lesson, Option } from './types';

const IDENT = 'PVX';
const STATION = `the practice VOR, ${IDENT} on 112.40`;
const c3 = (d: number) => String(norm360(d) || 360).padStart(3, '0');
const dots = (needleDeg: number) => {
  const n = Math.round(Math.abs(needleDeg) / DEG_PER_DOT * 2) / 2;
  if (n < 0.5) return 'centered';
  return `${n} dot${n === 1 ? '' : 's'} ${needleDeg > 0 ? 'right' : 'left'}`;
};

/** Copy written for the intended grade; when the engine grades it otherwise, say what the engine saw. */
function follow<T extends string>(grades: Record<T, Grade>, intended: Partial<Record<T, Grade>>, written: Record<T, string>, why: (id: T) => string): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const id of Object.keys(written) as T[]) out[id] = !intended[id] || intended[id] === grades[id] ? written[id] : why(id);
  return out;
}

export function vorFigure(radial: number, obs: number, caption: string, ident = IDENT): Figure {
  const ind = vorIndication(radial, obs);
  return { kind: 'vor', obs: norm360(obs), needleDeg: ind.needleDeg, flag: ind.flag, ident, caption };
}

// ---------------------------------------------------------------- the dials

/** Where the airplane sits for the dials: southwest of the station. */
export const DIAL_RADIAL = 205;

const OBS_VERDICT: Option[] = [
  { id: 'fly', label: 'Fly this course to the station' },
  { id: 'keep', label: 'Keep turning the OBS' },
];

function obsDials(start: number) {
  const dials: Dial[] = [
    { id: 'obs', label: 'OBS course', unit: '°', min: 0, max: 355, step: 5, initial: start, format: (v) => c3(v) },
  ];
  const evaluate = (v: DialValues): DialState => {
    const ind = vorIndication(DIAL_RADIAL, v.obs);
    const centered = Math.abs(ind.needleDeg) <= DEG_PER_DOT;
    const lines: DialLine[] = [];
    if (ind.flag === 'FROM') {
      lines.push({ id: 'from', severity: 'caution', title: 'FROM flag', say: `With ${c3(v.obs)} set, the flag says FROM: flying this course takes you away from the station. Turn the OBS about 180° to get a TO.` });
    } else if (ind.flag === 'OFF') {
      lines.push({ id: 'off', severity: 'caution', title: 'Flag off', say: `${c3(v.obs)} runs nearly abeam of where you are, so the receiver can't say TO or FROM. Keep turning.` });
    } else if (!centered) {
      lines.push({ id: 'needle', severity: 'info', title: 'TO, but the needle is off', say: `TO is right; the needle is ${dots(ind.needleDeg)}. Turn the OBS toward the needle until it centers.` });
    }
    const fly: Grade = ind.flag === 'TO' && centered ? 'best' : 'marginal';
    return {
      figures: [vorFigure(DIAL_RADIAL, v.obs, 'The indicator as you have set the OBS. The airplane hasn\'t moved; only the course you asked about has.')],
      readouts: [
        { id: 'obs', label: 'Course set', value: c3(v.obs) },
        { id: 'flag', label: 'Flag', value: ind.flag, tone: ind.flag === 'TO' ? undefined : 'near' },
        { id: 'needle', label: 'Needle', value: dots(ind.needleDeg), tone: centered ? undefined : 'near' },
      ],
      lines,
      clear: `Needle centered with a TO flag: ${c3(v.obs)} is the course direct to the station from here. You are on the ${c3(v.obs + 180)} radial.`,
      verdict: { options: OBS_VERDICT, grades: { fly, keep: fly === 'best' ? 'acceptable' : 'best' } },
    };
  };
  const answer = courseToStation(DIAL_RADIAL);
  return {
    dials, evaluate,
    task: {
      prompt: 'Turn the OBS until the needle centers with a TO flag. That is the course straight to the station.',
      check: (v: DialValues) => {
        const ind = vorIndication(DIAL_RADIAL, v.obs);
        const right = ind.flag === 'TO' && Math.abs(ind.needleDeg) < 1;
        return {
          right,
          explain: right
            ? `${c3(answer)} TO. You are on the ${c3(DIAL_RADIAL)} radial, and its reciprocal is the way in. Fly a heading near ${c3(answer)}, corrected for wind, and keep the needle centered.`
            : `${c3(answer)} TO is the one. ${ind.flag === 'FROM' ? `${c3(v.obs)} centers with FROM: that is the radial you are on, the way out, not in.` : `At ${c3(v.obs)} the needle is ${dots(ind.needleDeg)}.`}`,
        };
      },
    },
  };
}

// ---------------------------------------------------------------- the decisions

interface TurnCase { kind: 'turn'; radial: number; obs: number; heading: number; title: string; scene: string; written: Record<VorTurnOption, string>; intended: Record<VorTurnOption, Grade>; why: string }
interface IdentCase { kind: 'ident'; title: string; scene: string; written: Record<IdentOption, string>; intended: Record<IdentOption, Grade>; why: string }

export function vorCase(v: number): TurnCase | IdentCase {
  if (v === 1) {
    return {
      kind: 'turn', radial: 205, obs: 200, heading: 20,
      title: 'The number you heard',
      scene: `Flight following told you that you are "on the ${IDENT} two zero zero radial", so you set 200 on the OBS, centered the needle and turned toward the station, heading 020. Ten minutes later, the needle is a little over two dots left and the flag says FROM.`,
      written: {
        left: 'You followed the needle, and it led you further off. With 200 set while flying 020, the needle works backwards: that is reverse sensing.',
        right: 'Right direction: with reverse sensing you turn away from the needle. It works until you forget, in a busy moment, which way round it is today.',
        hold: 'The needle isn\'t going to center itself. You are drifting off the course line on the wind.',
        reset: 'Right. Set the course you are flying, 020. The flag goes TO, the needle swings right, and it reads normally again: turn toward it. Radials are from the station; to fly to it, set the reciprocal.',
      },
      intended: { left: 'marginal', right: 'acceptable', hold: 'marginal', reset: 'best' },
      why: 'The VOR doesn\'t know your heading. Set the course you mean to fly, so the flag reads TO going in and FROM going out, and the needle always points toward the course line. A radial number is a bearing from the station: to go to it, set the reciprocal.',
    };
  }
  if (v === 2) {
    return {
      kind: 'ident',
      title: 'Is that really the station?',
      scene: `Your GPS has lost its signal. You tune ${STATION} to find your way to the field next to it. The needle centers with a TO flag, so you turn up the volume to identify it, and hear "${morse('TEST')}".`,
      written: {
        'fly-it': 'A station sending TEST is under maintenance, and its signal may be wrong. A centered needle from it means nothing; it could lead you off course and into terrain or airspace.',
        pilotage: 'Right. Back to the chart and the ground: a heading, landmarks and the clock. Ask flight following for help if you want a second opinion, and tell them the VOR is sending TEST.',
        'other-vor': 'Sound, if another station is in range and identifies properly. Cross-check it with the chart and the ground.',
        'turn-back': 'Safe, if the field behind you is VFR and in range. Pilotage would likely have got you there too.',
      },
      intended: { 'fly-it': 'unsafe', pilotage: 'best', 'other-vor': 'acceptable', 'turn-back': 'acceptable' },
      why: `Identify every VOR before you use it (AIM 1-1-3). During maintenance a station may send T-E-S-T (${morse('TEST')}) or no ident at all (AIM 1-1-11), and its indications can't be trusted. A needle that looks fine is not an ident.`,
    };
  }
  return {
    kind: 'turn', radial: DIAL_RADIAL, obs: 20, heading: 20,
    title: 'Drifting off',
    scene: `Inbound to ${STATION} with 020 on the OBS, heading 020. You look up from the chart and the needle is two and a half dots right, flag TO.`,
    written: {
      left: 'Away from the needle, and away from the course. With the OBS set to the course you are flying, the needle shows where the course line is.',
      right: 'Right. The needle is right, so the course is right: turn toward it, say 30° to intercept, then turn back to 020 plus a wind correction as it centers. The wind blew you left, so hold a few degrees right of 020 from then on.',
      hold: 'Holding 020 keeps you parallel to the course, a couple of miles off it, and the wind that pushed you will keep pushing.',
      reset: 'It works: center the needle with the OBS and fly the new course. You give up the course you planned, though, and that one led past the hills, not over them.',
    },
    intended: { left: 'marginal', right: 'best', hold: 'marginal', reset: 'acceptable' },
    why: 'With the course you are flying set on the OBS, the needle points toward the course line: fly toward the needle. Intercept at an angle, then hold a heading with a wind correction so it stays centered.',
  };
}

const TURN_LABELS: Record<VorTurnOption, string> = {
  left: 'Turn left to bring the needle back.',
  right: 'Turn right, toward the course line.',
  hold: 'Hold the heading and let it center.',
  reset: 'Reset the OBS before turning either way.',
};
const IDENT_LABELS: Record<IdentOption, string> = {
  'fly-it': 'Fly it. The needle is centered and the flag is TO.',
  pilotage: 'Navigate by the chart and landmarks instead.',
  'other-vor': 'Tune another VOR that identifies properly.',
  'turn-back': 'Turn back to the field you left.',
};

const CASES = 3;

export const vorLesson: Lesson = {
  id: '5.6', module: 5, minutes: 16,
  title: 'The VOR when the GPS goes quiet',
  summary: 'Find the course to a station with the OBS, read the needle the right way round, and identify the station before you trust it.',
  acs: ['PA.VI.B'],
  refs: ['AIM 1-1-3', 'AIM 1-1-11', 'PHAK ch. 16'],
  variants: CASES,
  build(ctx) {
    const v = Math.min(ctx.variant ?? 0, CASES - 1);
    const c = vorCase(v);
    const inbound = courseToStation(DIAL_RADIAL);
    const decision = c.kind === 'turn'
      ? (() => {
        const g = gradeVorTurn(c.radial, c.obs, c.heading);
        return {
          kind: 'decide' as const, id: 'd1', title: c.title, situation: c.scene,
          figure: vorFigure(c.radial, c.obs, `What the indicator shows now. You are heading ${c3(c.heading)}.`),
          options: (['left', 'right', 'hold', 'reset'] as VorTurnOption[]).map((id) => ({ id, label: TURN_LABELS[id] })),
          grades: g.grades,
          consequence: follow(g.grades, c.intended, c.written, (id) => `That grades ${g.grades[id]}: the course line is to your ${g.turn}.`),
          why: c.why,
        };
      })()
      : (() => {
        const g = gradeIdent('test');
        return {
          kind: 'decide' as const, id: 'd1', title: c.title, situation: c.scene,
          figure: vorFigure(DIAL_RADIAL, inbound, `The indicator, and the ident you hear: ${morse('TEST')}.`, 'TEST'),
          options: (['fly-it', 'pilotage', 'other-vor', 'turn-back'] as IdentOption[]).map((id) => ({ id, label: IDENT_LABELS[id] })),
          grades: g,
          consequence: follow(g, c.intended, c.written, (id) => `That grades ${g[id]} with a station sending TEST.`),
          why: c.why,
        };
      })();
    return [
      {
        kind: 'brief', id: 'b1', title: 'A backup worth knowing',
        scene: `The GPS screen says "Loss of integrity" and the magenta line is gone. ${STATION[0].toUpperCase()}${STATION.slice(1)} is near the field you are heading for.`,
        say: {
          full: 'GPS fails more often than people expect: jamming, an antenna, a database out of date. A VOR is the backup that is already in most panels. It sends out a **radial** for every degree: the magnetic bearing **from** the station. The indicator knows only which radial you are on, **not which way the airplane points**. You set a course on the **OBS**. The **flag** says whether that course takes you **TO** or **FROM** the station, and the **needle** shows which side the course line is on, two degrees a dot. Before any of it, **identify the station** by its Morse code.',
          short: 'Radials go out from the station. The VOR knows where you are, not where you point.',
        },
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `The OBS is set to 030 and the indicator shows a centered needle with a TO flag.`,
        figure: vorFigure(210, 30, 'Centered, TO, with 030 set.'),
        blanks: [
          { id: 'radial', label: 'Which radial are you on?', answer: 210, tolerance: 0, unit: '°', explain: 'Centered with TO on 030 means 030 takes you to the station, so you are on its reciprocal, the 210 radial: southwest of the station.' },
          { id: 'flip', label: 'Set 210 on the OBS instead. The flag reads', answer: 'FROM', choices: ['TO', 'FROM', 'OFF'], explain: `${vorIndication(210, 210).flag}, needle centered. 210 is the radial you are on: the way out from the station.` },
          { id: 'abeam', label: 'Set 120 on the OBS. The flag reads', answer: vorIndication(210, 120).flag, choices: ['TO', 'FROM', 'OFF'], explain: 'OFF. 120 runs at right angles to where you are, so the receiver can\'t tell TO from FROM.' },
          { id: 'test', label: `You identify the station and hear "${morse('TEST')}". That means`, answer: 'Under maintenance, don\'t use it', choices: ['The station\'s ident', 'Under maintenance, don\'t use it', 'A weather broadcast follows', 'The receiver is self-testing'], explain: 'T-E-S-T, or no ident at all, means the station is being worked on and may give false indications (AIM 1-1-11).' },
        ],
      },
      {
        kind: 'dials', id: 'w1', title: 'Find the way in',
        say: {
          full: `You are somewhere southwest of ${STATION}. Turn the OBS and watch the flag and the needle. The airplane stays put; only the course you are asking about changes.`,
          short: 'Turn the OBS until it centers with TO.',
        },
        turnedNote: 'The OBS, as you have set it.',
        ...obsDials(90),
      },
      decision,
    ];
  },
};
