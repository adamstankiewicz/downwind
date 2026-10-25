// Lesson 8.5, Illusions on the approach and in the dark: what the eyes and
// the inner ear get wrong, which way each one pushes you, and the numbers
// that beat it. The airports are on the practice sectional; the illusions
// and the fixes come from lib/illusions.ts, after AIM 8-1-5 and PHAK ch. 17.

import { chartAirport } from '../chart/practiceRegion';
import { APPROACH_ILLUSIONS, gradeIllusion, VESTIBULAR_ILLUSIONS, type ApproachIllusion, type IllusionCase, type IllusionOption, type VestibularIllusion } from '../lib/illusions';
import type { Grade } from '../scenarios/goNoGo';
import type { Lesson } from './types';

/** Copy written for the intended grade; when the engine grades it otherwise, say what the engine saw. */
function follow<T extends string>(grades: Record<T, Grade>, intended: Partial<Record<T, Grade>>, written: Record<T, string>, why: (id: T) => string): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const id of Object.keys(written) as T[]) out[id] = !intended[id] || intended[id] === grades[id] ? written[id] : why(id);
  return out;
}

/** A 3° path loses about 300 feet a nautical mile. */
export const FT_PER_NM = 300;

export interface IllusionScene {
  ill: IllusionCase;
  /** The practice sectional airport it happens at. */
  field: string;
  title: string;
  scene: string;
  labels: Partial<Record<IllusionOption, string>>;
  intended: Partial<Record<IllusionOption, Grade>>;
  written: Partial<Record<IllusionOption, string>>;
  why: string;
}

export function illusionScene(v: number): IllusionScene {
  const quill = chartAirport('KXQA')!;
  const ridge = chartAirport('KXRB')!;
  if (v === 1) {
    return {
      field: 'KXRB',
      ill: { kind: 'sloped', slope: 'upslope', papiReds: 4 },
      title: 'It looks steep',
      scene: `A first visit to ${ridge.name}, on a clear afternoon. Runway 32 climbs noticeably toward the far end, and on a one mile final the picture looks steep, as if you are high. The PAPI on the left shows four red.`,
      labels: {
        picture: 'Ease the nose down a bit. You look high.',
        papi: 'Add power, level off to two red and two white.',
        'go-around': 'Go around and fly the pattern again.',
        numbers: 'Hold 300 feet a mile by the altimeter.',
      },
      intended: { picture: 'unsafe', papi: 'best', 'go-around': 'acceptable', numbers: 'acceptable' },
      written: {
        picture: 'Four red already says you are well low. An upsloping runway makes a normal path look steep, so the picture is pulling you down toward the trees short of the runway.',
        papi: 'Right. Four red is well below the path. Power, level off, and let the lights come back to two red and two white, then continue. If it can\'t be stable by 300 feet, go around.',
        'go-around': 'Never wrong, and a fine choice this low. Power and a level-off would have fixed it a mile out.',
        numbers: 'Better than the picture. Your altimeter does not see the slope, so it is honest; the PAPI is right there and more precise.',
      },
      why: `An upsloping runway makes you feel high, so you fly a low approach (AIM 8-1-5). The fix for every visual illusion is a reference it can't bend: here, the PAPI. Two red and two white is on the path.`,
    };
  }
  if (v === 2) {
    return {
      field: 'KXQA',
      ill: { kind: 'dark-takeoff' },
      title: 'The nose feels high',
      scene: `A night departure from ${quill.name}, runway 20, toward dark woods and a lake: no lights ahead, no horizon. Full power, rotate, climb. At 400 feet it feels as if the nose is pitching up, steeper and steeper.`,
      labels: {
        push: 'Lower the nose until it feels right again.',
        instruments: 'Hold climb attitude on the attitude indicator.',
        'turn-back': 'Turn back toward the runway lights now.',
        outside: 'Look outside harder for a horizon to fly by.',
      },
      intended: { push: 'unsafe', instruments: 'best', 'turn-back': 'marginal', outside: 'marginal' },
      written: {
        push: 'The acceleration made level feel nose-up. Pushing until it feels right flies a healthy airplane into the lake: the somatogravic illusion, one of the classic night takeoff accidents.',
        instruments: 'Right. The attitude indicator shows the climb attitude you set, the VSI and altimeter say you are climbing. Trust them until you have lights or a horizon to fly by.',
        'turn-back': 'A low turn at night, while disoriented, is how a feeling becomes a spiral. Climb first, on instruments, then decide.',
        outside: 'There is nothing out there to see. Hunting for a horizon that isn\'t there leaves the instruments unwatched just when you need them.',
      },
      why: 'Rapid acceleration on a dark takeoff feels like a nose-up pitch, and pilots push into the ground (the somatogravic illusion, AIM 8-1-5). When there is no outside reference, fly the instruments; a VFR night takeoff is an instrument takeoff for the first few hundred feet.',
    };
  }
  return {
    field: 'KXQA',
    ill: { kind: 'black-hole', vgsi: false, litAlternateNm: 18 },
    title: 'A black hole',
    scene: `Night, clear, no moon. ${quill.name}, runway 02, has runway lights but no PAPI or VASI, and the approach is over a dark lake and woods. From 5 miles out on a straight-in, the runway lights look small and far away, and you feel high.`,
    labels: {
      picture: 'Start down now, so the runway looks right.',
      numbers: 'Join a normal pattern and descend by the numbers.',
      flat: 'Stay on a long, shallow straight-in to keep it in sight.',
      divert: 'Divert to the lit field with a PAPI, 18 miles away.',
    },
    intended: { picture: 'unsafe', numbers: 'best', flat: 'marginal', divert: 'acceptable' },
    written: {
      picture: 'Over dark ground the eye has nothing to judge height by, and you feel high when you are not. Descending until the picture "looks right" flies a low, flat path into the dark short of the runway: the black hole approach.',
      numbers: `Right. Fly to the field at pattern altitude, then a normal downwind, base and final, using the same key points as in daylight and about ${FT_PER_NM} feet a mile on final by the altimeter. Don't leave pattern altitude early.`,
      flat: 'A long, shallow final over the dark is where the black hole works best: the lights never look closer, and the ground you can\'t see is right under you. Flown strictly by the altimeter it can work, but a normal pattern gives you the key points you know.',
      divert: 'Sound, and a good choice if you don\'t know the field. A normal pattern by the numbers works here too.',
    },
    why: `Water or dark ground short of the runway makes you feel high, so you fly low (AIM 8-1-5). Without a VGSI, fly a normal pattern and use numbers the dark can't bend: pattern altitude, the usual key positions, and about ${FT_PER_NM} feet a mile on final.`,
  };
}

const CASES = 3;
const LOW = 'Low approach';
const HIGH = 'High approach';

export const illusionsLesson: Lesson = {
  id: '8.5', module: 8, minutes: 15,
  title: 'Illusions on the approach and in the dark',
  summary: 'Why a narrow runway, a slope or a dark lake makes you fly low, why a dark takeoff makes you push, and the numbers that beat each one.',
  acs: ['PA.I.H', 'PA.IV.B'],
  refs: ['AIM 8-1-5', 'PHAK ch. 17'],
  variants: CASES,
  build(ctx) {
    const v = Math.min(ctx.variant ?? 0, CASES - 1);
    const sc = illusionScene(v);
    const all = gradeIllusion(sc.ill);
    const ids = Object.keys(sc.labels) as IllusionOption[];
    const grades = Object.fromEntries(ids.map((id) => [id, all[id] ?? 'marginal'])) as Record<IllusionOption, Grade>;
    const tend = (k: ApproachIllusion) => (APPROACH_ILLUSIONS[k].tendency === 'low' ? LOW : HIGH);
    const vest = (Object.keys(VESTIBULAR_ILLUSIONS) as VestibularIllusion[]).map((k) => VESTIBULAR_ILLUSIONS[k].name);
    return [
      {
        kind: 'brief', id: 'b1', title: 'Your senses, at their worst',
        say: {
          full: 'On the approach your eyes judge height from the shape of the runway and the ground around it. Change either and the picture lies: a **narrow** runway or one that **slopes up** looks like you are high, a **wide** one or one that slopes down like you are low. **Water, snow or dark ground** short of the runway, rain on the windscreen and haze all make you feel high, so you fly a **low approach**. In the dark the inner ear takes over, and it is worse: acceleration feels like pitching up, a slow roll goes unnoticed, and a long turn feels level. Every one of these has the same fix: **a reference the illusion can\'t bend**, such as a VGSI, the altimeter or the attitude indicator.',
          short: 'Narrow, upslope, dark or wet makes you fly low. Fly the numbers.',
        },
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Which way does each one push your approach if you don\'t catch it?',
        blanks: [
          { id: 'narrow', label: APPROACH_ILLUSIONS.narrow.name, answer: tend('narrow'), choices: [LOW, HIGH], explain: `You feel ${APPROACH_ILLUSIONS.narrow.feels}, so you fly low.` },
          { id: 'wide', label: APPROACH_ILLUSIONS.wide.name, answer: tend('wide'), choices: [LOW, HIGH], explain: `You feel ${APPROACH_ILLUSIONS.wide.feels}, so you fly high and land long.` },
          { id: 'down', label: APPROACH_ILLUSIONS.downslope.name, answer: tend('downslope'), choices: [LOW, HIGH], explain: `You feel ${APPROACH_ILLUSIONS.downslope.feels}, so you fly high.` },
          { id: 'water', label: APPROACH_ILLUSIONS.featureless.name, answer: tend('featureless'), choices: [LOW, HIGH], explain: `You feel ${APPROACH_ILLUSIONS.featureless.feels}, so you fly low: the black hole.` },
          { id: 'haze', label: APPROACH_ILLUSIONS.haze.name, answer: tend('haze'), choices: [LOW, HIGH], explain: `You feel ${APPROACH_ILLUSIONS.haze.feels}, so you fly low (AIM 8-1-5).` },
          { id: 'spiral', label: 'In cloud, a long descending turn starts to feel like wings level. That is', answer: VESTIBULAR_ILLUSIONS['graveyard-spiral'].name, choices: vest, explain: `${VESTIBULAR_ILLUSIONS['graveyard-spiral'].feels}. Level the wings on the attitude indicator first, then raise the nose.` },
          { id: 'leans', label: 'After a slow roll out of a long bank, you feel banked the other way. That is', answer: VESTIBULAR_ILLUSIONS.leans.name, choices: vest, explain: `${VESTIBULAR_ILLUSIONS.leans.feels}. The attitude indicator settles it.` },
        ],
      },
      {
        kind: 'example', id: 'e1', title: 'Numbers the dark can\'t bend',
        say: {
          full: `A 3° path loses about ${FT_PER_NM} feet for every nautical mile. Know where you should be, and check it with the altimeter.`,
          short: `About ${FT_PER_NM} feet a mile.`,
        },
        work: [3, 2, 1, 0.5].map((nm) => ({ label: `${nm} nm from the threshold`, value: `${(nm * FT_PER_NM).toLocaleString('en-US')} ft above the runway`, note: nm === 1 ? 'Where the black hole pilot is often at half this' : undefined })),
      },
      {
        kind: 'decide', id: 'd1', title: sc.title,
        situation: sc.scene,
        figure: { kind: 'chart', focus: { id: sc.field, radiusNm: 6 } },
        options: ids.map((id) => ({ id, label: sc.labels[id]! })),
        grades,
        consequence: follow(grades, sc.intended, sc.written as Record<IllusionOption, string>, (id) => `That grades ${grades[id]} here.`),
        why: sc.why,
      },
    ];
  },
};
