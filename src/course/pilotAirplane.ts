// Module 1, Pilot and airplane: five flights that happen before the engine
// starts. Every date, hour and grade comes from lib/regs.ts, worked from
// the day the pilot opens the lesson. The paperwork is made up for the lesson
// and says so; the airplane in it is a club airplane with an N-number that
// cannot be real, so no lesson reads as a statement about the pilot's own
// airplane or logbook.
//
// Each lesson is written with several situations (ctx.variant). They change
// what is true on the day, so the right call changes with them: sometimes the
// answer is a workaround, sometimes it is to stay on the ground, and sometimes
// the flight is fine as planned and cancelling is the mistake.

import {
  addDays, addMonths, clock, daysBetween, endOfCalendarMonth, flightReview, fmtDay, gradePlan, hundredHour, inoperative,
  inspectionDue, medicalForPrivate, needsNightCurrency, passengerCurrency, registration, toDay, weekday,
  EQUIPMENT, NIGHT_CURRENCY_START_MIN, type Day, type InopFlight, type LogLine, type Squawk,
} from '../lib/regs';
import type { Grade } from '../scenarios/goNoGo';
import type { Blank, Figure, Lesson, LessonContext, Option, RecordRow, Step } from './types';

/** No N-number starts with a zero, so this one can never belong to a real airplane. */
export const PRACTICE_TAIL = 'N0XYZ';

/** Sunset in these scenarios, minutes after local midnight. Made up, and the copy says so. */
export const SCENARIO_SUNSET = 18 * 60 + 12;

const fmt1 = (n: number) => n.toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function airplane(ctx: LessonContext): string {
  return ctx.aircraft.type ? `the club's ${ctx.aircraft.type}` : "the club's airplane";
}

/** The next given weekday (0 Sunday) at least one day after `today`. */
function nextWeekday(today: Day, dow: number): Day {
  const d = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, ((dow - d + 7) % 7) || 7);
}

/** Date choices, chronological, with duplicates dropped. */
function dateChoices(answer: Day, others: Day[]): { answer: string; choices: string[] } {
  const all = [...new Set([answer, ...others])].sort();
  return { answer: fmtDay(answer), choices: all.map(fmtDay) };
}

function decide(
  id: string, title: string, situation: string, figure: Figure | undefined,
  opts: { id: string; label: string; grade: Grade; consequence: string }[], why: string,
): Step {
  return {
    kind: 'decide', id, title, situation, figure,
    options: opts.map<Option>((o) => ({ id: o.id, label: o.label })),
    grades: Object.fromEntries(opts.map((o) => [o.id, o.grade])),
    consequence: Object.fromEntries(opts.map((o) => [o.id, o.consequence])),
    why,
  };
}

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

/** Cancelling when nothing stands in the way is a call, too: it teaches you to distrust your own reading of the rules. */
const NEEDLESS: Grade = 'marginal';

// ---------------------------------------------------------------- 1.1

/**
 * The made-up logbook for 1.1, by days before today. Situation 1 adds night
 * landings that still count today but drop out before the flight; situation 2
 * adds recent ones that make the pilot night current.
 */
export function currencyLog(today: Day, situation = 0, flightDay: Day = nextWeekday(today, 6)): LogLine[] {
  const extra: LogLine[] = situation === 1
    ? [{ day: addDays(flightDay, -91), landings: [{ count: 3, fullStop: true, afterSunsetMin: 75 }] }]
    : situation === 2
      ? [{ day: addDays(today, -33), landings: [{ count: 3, fullStop: true, afterSunsetMin: 70 }] }]
      : [];
  return [...baseCurrencyLog(today), ...extra].sort((a, b) => a.day.localeCompare(b.day));
}

function baseCurrencyLog(today: Day): LogLine[] {
  return [
    { day: addDays(today, -96), landings: [{ count: 3, fullStop: true, afterSunsetMin: null }] },
    { day: addDays(today, -70), landings: [{ count: 1, fullStop: false, afterSunsetMin: null }, { count: 2, fullStop: true, afterSunsetMin: 80 }] },
    { day: addDays(today, -41), landings: [{ count: 1, fullStop: true, afterSunsetMin: null }] },
    { day: addDays(today, -24), landings: [{ count: 1, fullStop: true, afterSunsetMin: 40 }] },
    { day: addDays(today, -9), landings: [{ count: 2, fullStop: false, afterSunsetMin: null }] },
  ];
}

const LOG_PLACES = ['Local, pattern work', 'Out and back, lunch', 'Local, airwork', 'Sunset flight, local', 'Pattern work'];

function logbookFigure(lines: LogLine[], title: string, focusDays: Day[] = []): Figure {
  return {
    kind: 'records', variant: 'logbook', title,
    columns: [{ label: 'Date', num: true }, { label: 'Flight' }, { label: 'Day ldg', num: true }, { label: 'Night ldg', num: true }, { label: 'Remarks' }],
    rows: lines.map((l, i): RecordRow => {
      const day = l.landings.filter((s) => s.afterSunsetMin === null).reduce((a, s) => a + s.count, 0);
      const night = l.landings.filter((s) => s.afterSunsetMin !== null).reduce((a, s) => a + s.count, 0);
      const remarks = l.landings.map((s) => {
        const kind = s.fullStop ? 'full stop' : 'touch and go';
        return s.afterSunsetMin === null ? `${plural(s.count, kind, `${kind}s`)}` : `${plural(s.count, kind, `${kind}s`)}, last ${s.afterSunsetMin} min after sunset`;
      }).join('; ');
      return { cells: [fmtDay(l.day), LOG_PLACES[i % LOG_PLACES.length], String(day || ''), String(night || ''), remarks], focus: focusDays.includes(l.day) };
    }),
    caption: 'A made-up logbook page for this lesson, not yours. Night landings here are logged from sunset, the way many pilots log them.',
  };
}

const currentToCarry: Lesson = {
  id: '1.1', module: 1, minutes: 12,
  title: 'Are you current to carry passengers?',
  summary: 'Count the landings that count, day and night, and find the hour your passenger rules change.',
  acs: ['PA.I.A'],
  refs: ['14 CFR 61.57(a)', '14 CFR 61.57(b)', '14 CFR 1.1, night'],
  variants: 4,
  build(ctx) {
    // 0: not night current, sunset flight. 1: night current today, not on the day.
    // 2: night current, sunset flight. 3: not night current, afternoon flight.
    const v = ctx.variant ?? 0;
    const today = toDay(ctx.now);
    const flightDay = nextWeekday(today, 6);
    const friday = addDays(flightDay, -1);
    const log = currencyLog(today, v === 1 || v === 2 ? v : 0, flightDay);
    const nightToday = passengerCurrency(log, today, 'night');
    const dayStatus = passengerCurrency(log, flightDay, 'day');
    const nightStatus = passengerCurrency(log, flightDay, 'night');
    const figure = logbookFigure(log, 'Your logbook, the last few months');
    const inWindow = log.filter((l) => daysBetween(l.day, flightDay) <= 90);
    const dropped = log.filter((l) => daysBetween(l.day, flightDay) > 90);
    const sunset = clock(SCENARIO_SUNSET);
    const nightStart = SCENARIO_SUNSET + NIGHT_CURRENCY_START_MIN;

    // The plan: an hour and a half of sightseeing, off a quarter hour before
    // sunset; in situation 3, an hour in the afternoon.
    const plannedOff = v === 3 ? SCENARIO_SUNSET - 150 : SCENARIO_SUNSET - 15;
    const plannedLand = plannedOff + (v === 3 ? 60 : 90);
    const earlyLand = plannedLand - 45;
    const withFriday = [...log, { day: friday, landings: [{ count: 3, fullStop: true, afterSunsetMin: 70 }] }];
    const fridayNight = passengerCurrency(withFriday, flightDay, 'night');
    const legalAt = (landMin: number, night: boolean) => !needsNightCurrency(landMin - SCENARIO_SUNSET) || night;
    const earlyMargin = nightStart - earlyLand;

    return [
      {
        kind: 'brief', id: 'b1', title: 'A friend wants to come along',
        scene: v === 3
          ? `It's ${weekday(today)}. A friend has asked to come flying on ${weekday(flightDay)}, ${fmtDay(flightDay)}, in the afternoon. In this scenario sunset that day is at ${sunset}.`
          : `It's ${weekday(today)}. A friend has asked to come flying on ${weekday(flightDay)}, ${fmtDay(flightDay)}, for the sunset. In this scenario sunset that day is at ${sunset}.`,
        say: {
          full: 'Before you can carry anyone, 61.57 asks what you have done lately. **Three takeoffs and landings in the preceding 90 days**, in the same category and class, as the sole manipulator of the controls. In a tailwheel airplane they must be to a full stop. **At night** the bar is higher: three takeoffs and landings **to a full stop**, made between **one hour after sunset and one hour before sunrise**. The logbook answers both questions. We will read it together.',
          short: 'Three in 90 days. At night: three full stops, from an hour after sunset.',
        },
        figure,
      },
      {
        kind: 'example', id: 'e1', title: 'Day currency, worked',
        say: {
          full: `Count back from the day you will fly, not from today. Every takeoff and landing counts for day currency, touch and goes and night landings too. ${dropped.length ? `The ${fmtDay(dropped[0].day)} flight is more than 90 days before ${weekday(flightDay)}, so it drops out. ` : ''}Then find the **third most recent** landing. You stay current until 90 days after it, unless you land again.`,
          short: 'Count back from the day you fly. The third most recent landing sets the date.',
        },
        figure: logbookFigure(log, 'Your logbook, the last few months', inWindow.map((l) => l.day)),
        work: [
          { label: 'Counting back from', value: fmtDay(flightDay), note: weekday(flightDay) },
          { label: 'Landings that count', value: String(dayStatus.qualifying), note: 'Every landing in the 90 days, any kind' },
          { label: 'Third most recent', value: fmtDay(dayStatus.thirdDay!), note: 'The two after it are newer' },
          { label: 'Current through', value: fmtDay(dayStatus.currentThrough!), note: `90 days after ${fmtDay(dayStatus.thirdDay!)}` },
          { label: `On ${weekday(flightDay)}`, value: `${plural(dayStatus.daysLeft!, 'day')} to spare`, note: 'Day passengers: yes' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now night. Using the same page, how many landings count toward night currency on ${weekday(flightDay)}, are you night current, and from what time does it matter?`,
        figure,
        blanks: [
          { id: 'night', label: 'Landings that count at night', answer: nightStatus.qualifying, tolerance: 0,
            explain: `Only full stops made at least an hour after sunset, in the 90 days before ${weekday(flightDay)}, count. The sunset flight on ${fmtDay(log.find((l) => l.landings.some((s) => s.afterSunsetMin === 40))!.day)} landed 40 minutes after sunset: logged as night, but too early for 61.57(b). The touch and go doesn't count either.${v === 1 ? ` The three full stops on ${fmtDay(addDays(flightDay, -91))} count today, and are 91 days old by ${weekday(flightDay)}.` : ''}` },
          { id: 'current', label: 'Night current?', answer: yesNo(nightStatus.current), choices: ['Yes', 'No'],
            explain: nightStatus.current ? 'Three qualifying full stops in the 90 days.' : `${plural(nightStatus.qualifying, 'landing')} out of the three you need.` },
          { id: 'from', label: 'Night passenger rule starts at', answer: clock(nightStart), choices: [0, 30, 60, 90].map((m) => clock(SCENARIO_SUNSET + m)),
            explain: `One hour after the ${sunset} sunset. Before ${clock(nightStart)} your day currency is enough to carry a passenger. Logging night time (14 CFR 1.1, end of evening civil twilight) and turning on position lights (sunset) each use a different clock.` },
        ],
      },
      decide('d1', `The plan for ${weekday(flightDay)}`,
        v === 3
          ? `Your friend wants an hour over the lakes, off at ${clock(plannedOff)}, back on the ground at ${clock(plannedLand)}.`
          : v === 1
            ? `Your friend wants an hour and a half of sightseeing, off at ${clock(plannedOff)}, back at ${clock(plannedLand)}. Your logbook app says you are night current today${nightToday.current ? `, through ${fmtDay(nightToday.currentThrough!)}` : ''}.`
            : `Your friend wants an hour and a half of sightseeing, off at ${clock(plannedOff)}. That puts you back on the ground at ${clock(plannedLand)}.`,
        figure,
        nightStatus.current || v === 3
          ? [
            { id: 'go', label: `Go as planned and land at ${clock(plannedLand)}.`, grade: gradePlan({ legal: legalAt(plannedLand, nightStatus.current), meetsGoal: true }),
              consequence: nightStatus.current
                ? `You are night current through ${fmtDay(nightStatus.currentThrough!)}, so the landing after dark is legal with a passenger. Brief your friend on the dark cabin and a flashlight before you go.`
                : `You land at ${clock(plannedLand)}, before the night rule starts at ${clock(nightStart)}. Day currency is all this flight needs.` },
            { id: 'leave-early', label: 'Leave 45 minutes earlier anyway, to be safe.', grade: gradePlan({ legal: legalAt(earlyLand, nightStatus.current), meetsGoal: false }),
              consequence: 'Legal, and your friend sees less of what they came for. Margin is good when it buys you something; here the rule was already met.' },
            { id: 'get-current', label: nightStatus.current ? `Fly three more full stops alone on ${weekday(friday)} night first.` : 'Get night current first, then take your friend.', grade: nightStatus.current ? gradePlan({ legal: true, meetsGoal: true }) : gradePlan({ legal: true, meetsGoal: false }),
              consequence: nightStatus.current
                ? 'Not required, and never wasted. Night practice before a night flight with someone aboard is a habit many good pilots keep.'
                : `Night currency does not apply to a flight that lands at ${clock(plannedLand)}. You put off the flight for a rule that starts at ${clock(nightStart)}.` },
            { id: 'cancel', label: 'Put it off. Better safe than sorry.', grade: NEEDLESS,
              consequence: nightStatus.current
                ? 'You were current for exactly this flight. Cancelling without a reason you can name makes it harder to trust your own reading of the rules next time.'
                : `Nothing stood in the way: the flight was over ${plural(nightStart - plannedLand, 'minute')} before the night rule starts. Know the rule well enough to say yes when it says yes.` },
          ]
          : [
            { id: 'go', label: `Go as planned and land at ${clock(plannedLand)}.`, grade: gradePlan({ legal: legalAt(plannedLand, nightStatus.current), meetsGoal: true }),
              consequence: v === 1
                ? `Your app counted from today. On ${weekday(flightDay)} the three night full stops are 91 days old and drop out, leaving ${plural(nightStatus.qualifying, 'qualifying landing')}. You land at ${clock(plannedLand)} with a passenger, not night current.`
                : `The flight is lovely and the landing is smooth, and it is not legal. At ${clock(plannedLand)} you are inside the night period with a passenger and only ${plural(nightStatus.qualifying, 'qualifying landing')}. Nobody would know, which is exactly why the rule is yours to keep.` },
            { id: 'leave-early', label: `Leave 45 minutes earlier and land by ${clock(earlyLand)}.`, grade: gradePlan({ legal: legalAt(earlyLand, nightStatus.current), meetsGoal: true, margin: earlyMargin, tightBelow: 15 }),
              consequence: `You see the sun go down from the air and land at ${clock(earlyLand)}, ${plural(earlyMargin, 'minute')} before the night rule starts. Your day currency covers it.` },
            { id: 'get-current', label: `Fly three full stops alone on ${weekday(friday)} night, an hour after sunset, then go as planned.`, grade: gradePlan({ legal: legalAt(plannedLand, fridayNight.current), meetsGoal: true }),
              consequence: `Three full stops after dark on ${weekday(friday)} make you night current through ${fmtDay(fridayNight.currentThrough!)}, and ${weekday(flightDay)}'s plan is legal as written. Practice at night before you carry someone at night is a good habit on its own.` },
            { id: 'cancel', label: 'Put it off until you are night current.', grade: gradePlan({ legal: true, meetsGoal: false }),
              consequence: 'Legal, but you had two ways to make the flight work. Knowing the rule well is what lets you find them.' },
          ],
        nightStatus.current
          ? `Three full stops an hour after sunset in the 90 days before ${weekday(flightDay)}: you are night current through ${fmtDay(nightStatus.currentThrough!)}. The flight works as planned.`
          : v === 3
            ? `You are not night current, and it doesn't matter: the flight lands at ${clock(plannedLand)}, before the night rule starts at ${clock(nightStart)}. Day currency, through ${fmtDay(dayStatus.currentThrough!)}, covers it.`
            : `You are day current through ${fmtDay(dayStatus.currentThrough!)} but have ${plural(nightStatus.qualifying, 'qualifying night landing')} on ${weekday(flightDay)}${v === 1 ? ', whatever the count says today. Always count back from the day you fly' : ''}. A passenger is fine until ${clock(nightStart)}; after that you need three full stops at night first.`,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 1.2

export interface DocumentsScenario {
  registrationIssued: Day;
  medicalExam: Day;
  ageAtExam: number;
  /** The pilot certificate is at home on the kitchen table. */
  certificateAtHome: boolean;
}

/**
 * 0: the registration ran out last month. 1: the registration is fine and
 * the pilot's medical ran out. 2: everything is current, and the pilot
 * certificate is at home.
 */
export function documentsScenario(today: Day, situation = 0): DocumentsScenario {
  return {
    // Issued 85 months ago: it ran out at the end of last month.
    registrationIssued: addMonths(today, situation === 0 ? -85 : -31),
    medicalExam: addMonths(today, situation === 1 ? -25 : -20),
    ageAtExam: 41,
    certificateAtHome: situation === 2,
  };
}

function documentsFigure(s: DocumentsScenario, ctx: LessonContext, focus: string[] = []): Figure {
  const rows: (RecordRow & { key: string })[] = [
    { key: 'airworthiness', cells: ['Airworthiness certificate', `Standard, normal category, ${PRACTICE_TAIL}`, 'No expiry while maintained'], note: 'Displayed in the cabin' },
    { key: 'registration', cells: ['Registration', `${PRACTICE_TAIL}, ${ctx.aircraft.type || 'single engine land'}`, `Issued ${fmtDay(s.registrationIssued)}`] },
    { key: 'radio', cells: ['Radio station license', 'None aboard', ''] },
    { key: 'operating', cells: ['Operating limitations', "Pilot's operating handbook, placards and markings", 'Matches the serial number'] },
    { key: 'weight', cells: ['Weight and balance', 'Empty weight and arm, equipment list', 'Current record'] },
    { key: 'certificate', cells: ['Your pilot certificate', s.certificateAtHome ? 'On the kitchen table at home' : 'Private pilot, airplane single engine land', 'No expiry'], note: s.certificateAtHome ? 'Not in your wallet' : undefined },
    { key: 'medical', cells: ['Your medical', `Third class, you were ${s.ageAtExam}`, `Exam ${fmtDay(s.medicalExam)}`] },
    { key: 'id', cells: ['Photo ID', "Driver's license", 'Current'] },
  ];
  return {
    kind: 'records', variant: 'documents', title: `What's in the airplane, and in your wallet`,
    columns: [{ label: 'Document' }, { label: 'Says' }, { label: 'Date', num: true }],
    rows: rows.map(({ key, ...r }) => ({ ...r, focus: focus.includes(key) })),
    caption: `Made-up paperwork for this lesson. ${PRACTICE_TAIL} cannot be a real registration.`,
  };
}

const documents: Lesson = {
  id: '1.2', module: 1, minutes: 12,
  title: 'The documents in the airplane',
  summary: 'Check the paperwork the airplane and the pilot have to carry, and work out when each piece runs out.',
  acs: ['PA.I.A', 'PA.I.B'],
  refs: ['14 CFR 91.203', '14 CFR 91.9', '14 CFR 47.40', '14 CFR 61.3', '14 CFR 61.23(d)', 'PHAK ch. 9, aircraft documents'],
  variants: 3,
  build(ctx) {
    const v = ctx.variant ?? 0;
    const today = toDay(ctx.now);
    const s = documentsScenario(today, v);
    const reg = registration(s.registrationIssued, today);
    const med = medicalForPrivate(s.medicalExam, s.ageAtExam, today);
    const medIfYounger = medicalForPrivate(s.medicalExam, 39, today);
    const regChoice = dateChoices(reg.through, [
      addMonths(s.registrationIssued, 84), endOfCalendarMonth(s.registrationIssued, 60), endOfCalendarMonth(s.registrationIssued, 96),
    ]);
    const plane = airplane(ctx);
    const otherLegal = registration(addMonths(today, -30), today).current;

    return [
      {
        kind: 'brief', id: 'b1', title: 'Before you untie it',
        scene: `${plane[0].toUpperCase()}${plane.slice(1)}, ${PRACTICE_TAIL}, ${weekday(today)} morning. Your passenger is on the way. You open the document pouch.`,
        say: {
          full: 'Two sets of papers have to be right. The airplane carries **ARROW**: the **A**irworthiness certificate, displayed where passengers can see it (91.203); the **R**egistration, which now runs for seven years (47.40); a **R**adio station license only if you leave the country; the **O**perating limitations, meaning the POH or flight manual, placards and markings (91.9); and the **W**eight and balance. You carry your pilot certificate, a current medical or BasicMed, and a photo ID (61.3). Several of these expire, and each one counts its own way.',
          short: 'ARROW for the airplane. Certificate, medical and photo ID for you.',
        },
        figure: documentsFigure(s, ctx),
      },
      {
        kind: 'example', id: 'e1', title: 'Your medical, worked',
        say: {
          full: `The medical counts in **calendar months**: to the last day of the month. For private pilot privileges any class of medical lasts **60 months if you were under 40** at the exam and **24 months if you were 40 or older** (61.23(d)). You were ${s.ageAtExam}.`,
          short: 'Calendar months, to the end of the month. 24 if you were 40 or over, 60 if under.',
        },
        figure: documentsFigure(s, ctx, ['medical']),
        work: [
          { label: 'Exam', value: fmtDay(s.medicalExam), note: `Age ${s.ageAtExam}` },
          { label: 'Duration', value: '24 calendar months', note: '40 or older at the exam' },
          { label: 'Good through', value: fmtDay(med.through), note: 'The last day of the 24th month after the exam month' },
          { label: 'Today', value: med.current ? `${plural(med.daysLeft, 'day')} left` : 'Lapsed', note: `Under 40 it would run to ${fmtDay(medIfYounger.through)}` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Now the airplane. When does the registration run out, is it good today, and do you need the radio station license for a flight that stays in the US?',
        figure: documentsFigure(s, ctx, ['registration', 'radio']),
        blanks: [
          { id: 'reg', label: 'Registration good through', answer: regChoice.answer, choices: regChoice.choices,
            explain: `47.40: seven years after the **last day of the month** it was issued. Issued ${fmtDay(s.registrationIssued)}, so through ${fmtDay(reg.through)}.` },
          { id: 'today', label: 'Good today?', answer: yesNo(reg.current), choices: ['Yes', 'No'],
            explain: reg.current ? 'Still inside the seven years.' : `It ran out ${plural(-reg.daysLeft, 'day')} ago.` },
          { id: 'radio', label: 'Radio license needed inside the US?', answer: 'No', choices: ['Yes', 'No'],
            explain: 'The FCC requires an aircraft radio station license only for flights that leave the country. Inside the US, none is needed.' },
        ],
      },
      v === 1
        ? decide('d1', 'A lapsed medical',
          `Everything in the pouch is current. Then you check your own wallet: the medical, from an exam on ${fmtDay(s.medicalExam)} when you were ${s.ageAtExam}, ran out on ${fmtDay(med.through)}. You haven't done BasicMed. An instructor you know is at the club this morning.`,
          documentsFigure(s, ctx, ['medical']),
          [
            { id: 'go', label: 'Fly it. You feel fine, and the medical is only paperwork anyway.', grade: gradePlan({ legal: med.current, meetsGoal: true }),
              consequence: 'Without a current medical or BasicMed you may not act as pilot in command (61.3(c), 61.23). Your insurance almost certainly says the same thing, in smaller print.' },
            { id: 'solo', label: 'Fly solo today, and leave the passenger for another weekend.', grade: gradePlan({ legal: med.current, meetsGoal: false }),
              consequence: 'The medical is about acting as pilot in command at all, not about who is aboard. Alone, you are still flying without one.' },
            { id: 'cfi', label: 'Fly with the instructor as pilot in command, and book an exam.', grade: gradePlan({ legal: true, meetsGoal: true }),
              consequence: 'A flight instructor with a current medical, acting as pilot in command, can fly with you while your medical is sorted out. You log the dual, your passenger still gets the flight, and you leave with an appointment.' },
            { id: 'cancel', label: 'Cancel the flight, and book an exam or BasicMed this week.', grade: gradePlan({ legal: true, meetsGoal: false }),
              consequence: 'Legal and responsible. With an instructor around, the day did not have to end here.' },
          ],
          `The airplane is legal; you aren't, as pilot in command. You were ${s.ageAtExam} at the exam, so the medical lasted 24 calendar months, through ${fmtDay(med.through)}. Someone else can be pilot in command while you fix it.`,
        )
        : v === 2
          ? decide('d1', 'The certificate on the kitchen table',
            `The pouch is in order and your medical is good through ${fmtDay(med.through)}. Reaching for your wallet, you remember your pilot certificate is on the kitchen table, twenty minutes away. Your passenger is in the lot.`,
            documentsFigure(s, ctx, ['certificate']),
            [
              { id: 'go', label: 'Go. The FAA knows you have a certificate.', grade: 'unsafe',
                consequence: '61.3(a) asks for the certificate in your physical possession or readily accessible in the aircraft whenever you act as pilot in command. A ramp check is unlikely; the rule is not about the odds.' },
              { id: 'photo', label: 'Go. You have a photo of it on your phone.', grade: 'unsafe',
                consequence: 'A photo is not the certificate. The FAA does offer a temporary authority by fax or email, but you request it ahead of time; a picture in your camera roll does not count.' },
              { id: 'fetch', label: 'Drive home for it and go forty minutes late.', grade: gradePlan({ legal: true, meetsGoal: true }),
                consequence: 'Your passenger gets a coffee, you get the card, and the flight happens. Some pilots keep the certificate in the flight bag for exactly this reason.' },
              { id: 'cancel', label: 'Cancel and fly another day.', grade: gradePlan({ legal: true, meetsGoal: false }),
                consequence: 'Legal, and more than the problem asked for. It was forty minutes away.' },
            ],
            'Everything about the airplane is right, and so are you, except the card. It has to be with you. A forty minute delay fixes it.',
          )
          : decide('d1', 'An expired registration',
            `The registration in the pouch ran out on ${fmtDay(reg.through)}. Everything else is in order, and your passenger has just pulled into the lot.`,
            documentsFigure(s, ctx, ['registration']),
            [
              { id: 'go', label: 'Fly it. The FAA still has the airplane on file, and the paperwork is the club\'s problem.', grade: gradePlan({ legal: reg.current, meetsGoal: true }),
                consequence: 'An expired registration means the airplane is not registered, and it may not fly (91.203(a)(2)). Ramp checks are rare; the insurance adjuster reading the pouch after a minor accident is not.' },
              { id: 'with-cfi', label: 'Fly it with an instructor aboard, so it counts as instruction.', grade: gradePlan({ legal: reg.current, meetsGoal: true }),
                consequence: 'An instructor changes who is qualified, not what the airplane is. The document is about the airplane, and it is still expired.' },
              { id: 'swap', label: 'Take another club airplane, and check its pouch first.', grade: gradePlan({ legal: otherLegal, meetsGoal: true }),
                consequence: 'The other airplane\'s registration is good for years yet. You leave a note for the club about the first one, and you are off twenty minutes late.' },
              { id: 'cancel', label: 'Cancel and tell the club.', grade: gradePlan({ legal: true, meetsGoal: false }),
                consequence: 'Legal and responsible. If another airplane was free, though, the day did not have to end here.' },
            ],
            `A registration that has run out grounds the airplane, whoever is aboard. ${med.current ? `Your own papers are fine: the medical is good through ${fmtDay(med.through)}.` : ''}`.trim(),
          ),
    ];
  },
};

// ---------------------------------------------------------------- 1.3

export interface MaintenanceScenario {
  annual: Day;
  transponder: Day;
  elt: Day;
  pitotStatic: Day;
  hundredAtTach: number;
  tachNow: number;
  /** Planned tach hours each way. */
  legHours: number;
}

/**
 * 0: the 100-hour comes due partway through the trip. 1: the annual ran out
 * at the end of last month. 2: everything is current with time to spare.
 */
export function maintenanceScenario(today: Day, situation = 0): MaintenanceScenario {
  const hundredAtTach = 4418.6;
  const left = situation === 2 ? 14.6 : situation === 1 ? 31.2 : 2.3;
  return {
    annual: addMonths(today, situation === 1 ? -13 : -11),
    transponder: addMonths(today, -14),
    elt: addMonths(today, -7),
    pitotStatic: addMonths(today, -30),
    hundredAtTach,
    // In situation 0, 2.3 hours left for a trip of 1.4 each way.
    tachNow: Math.round((hundredAtTach + 100 - left) * 10) / 10,
    legHours: 1.4,
  };
}

function maintenanceFigure(m: MaintenanceScenario, focus: string[] = []): Figure {
  const rows: (RecordRow & { key: string })[] = [
    { key: 'annual', cells: [fmtDay(m.annual), fmt1(m.hundredAtTach), 'Annual inspection, airworthy', 'A&P/IA'] },
    { key: 'hundred', cells: [fmtDay(m.annual), fmt1(m.hundredAtTach), '100-hour inspection, done with the annual', 'A&P/IA'] },
    { key: 'transponder', cells: [fmtDay(m.transponder), '', 'Transponder test, 91.413', 'Repair station'] },
    { key: 'elt', cells: [fmtDay(m.elt), '', 'ELT inspected, 91.207(d). Battery due in two years', 'A&P'] },
    { key: 'pitot', cells: [fmtDay(m.pitotStatic), '', 'Altimeter and static system test, 91.411', 'Repair station'] },
  ];
  return {
    kind: 'records', variant: 'maintenance', title: `${PRACTICE_TAIL} maintenance records. Tach now ${fmt1(m.tachNow)}`,
    columns: [{ label: 'Date', num: true }, { label: 'Tach', num: true }, { label: 'Entry' }, { label: 'Signed' }],
    rows: rows.map(({ key, ...r }) => ({ ...r, focus: focus.includes(key) })),
    caption: `Made-up maintenance records for this lesson. ${PRACTICE_TAIL} cannot be a real registration.`,
  };
}

const airworthy: Lesson = {
  id: '1.3', module: 1, minutes: 15,
  title: 'Is it airworthy today?',
  summary: 'Read the maintenance records for the inspections that apply to your flight, and find what they leave you.',
  acs: ['PA.I.B'],
  refs: ['14 CFR 91.7', '14 CFR 91.409', '14 CFR 91.413', '14 CFR 91.411', '14 CFR 91.207(d)', '14 CFR 21.197', 'PHAK ch. 9, inspections'],
  variants: 3,
  build(ctx) {
    const v = ctx.variant ?? 0;
    const today = toDay(ctx.now);
    const m = maintenanceScenario(today, v);
    const annual = inspectionDue('annual', m.annual, today);
    const xpdr = inspectionDue('transponder', m.transponder, today);
    const elt = inspectionDue('elt', m.elt, today);
    const pitot = inspectionDue('pitot-static', m.pitotStatic, today);
    const h = hundredHour(m.hundredAtTach, m.tachNow);
    const eltChoice = dateChoices(elt.through, [addMonths(m.elt, 12), endOfCalendarMonth(m.elt, 24), endOfCalendarMonth(m.elt, 6)]);
    const trip = Math.round(m.legHours * 2 * 10) / 10;
    const tight = Math.round((h.remaining - 0.1) * 10) / 10;
    const local = Math.round((h.remaining - 0.8) * 10) / 10;
    const plan = (hours: number) => ({ legal: hours <= h.remaining, margin: Math.round((h.remaining - hours) * 10) / 10, tightBelow: 0.3 });
    const plane = airplane(ctx);

    return [
      {
        kind: 'brief', id: 'b1', title: 'The records, not the walkaround',
        scene: `You have booked ${plane}, ${PRACTICE_TAIL}, for a trip to a field about ${fmt1(m.legHours)} hours away and back. The club also rents it for flight instruction.`,
        say: {
          full: 'A preflight inspection tells you what the airplane looks like today. The records tell you whether it is **airworthy**: the pilot in command decides that (91.7). Run the inspections in order: **annual** every 12 calendar months; **100-hour** if anyone gives flight instruction in it for hire or carries people for hire; **transponder** every 24 calendar months; **ELT** every 12; and the **altimeter and static system** every 24, but only for IFR in controlled airspace. Then the ADs. Today\'s question is which of these apply to **this** flight, and what they leave you.',
          short: 'Annual, 100-hour if for hire, transponder, ELT; the static check only for IFR.',
        },
        figure: maintenanceFigure(m),
      },
      {
        kind: 'example', id: 'e1', title: 'The annual and the transponder, worked',
        say: {
          full: 'Both count in calendar months, so both run to the **end of the month**. Find the month it was signed, count forward, and take the last day.',
          short: 'Calendar months, end of the month.',
        },
        figure: maintenanceFigure(m, ['annual', 'transponder']),
        work: [
          { label: 'Annual signed', value: fmtDay(m.annual), note: '12 calendar months, 91.409(a)' },
          { label: 'Annual good through', value: fmtDay(annual.through), note: annual.current ? `${plural(annual.daysLeft, 'day')} left` : 'Lapsed' },
          { label: 'Transponder tested', value: fmtDay(m.transponder), note: '24 calendar months, 91.413' },
          { label: 'Transponder good through', value: fmtDay(xpdr.through), note: xpdr.current ? `${plural(xpdr.daysLeft, 'day')} left` : 'Lapsed' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `The tach reads ${fmt1(m.tachNow)}. How many hours are left before the 100-hour, when is the ELT inspection due, and does the old static system test ground it for today's VFR trip?`,
        figure: maintenanceFigure(m, ['hundred', 'elt', 'pitot']),
        blanks: [
          { id: 'hours', label: 'Hours to the 100-hour', unit: 'hr', answer: h.remaining, tolerance: 0.1,
            explain: `Done at ${fmt1(m.hundredAtTach)}, so due at ${fmt1(h.dueAtTach)}. ${fmt1(h.dueAtTach)} minus ${fmt1(m.tachNow)} leaves ${fmt1(h.remaining)} hours.` },
          { id: 'elt', label: 'ELT inspection due', answer: eltChoice.answer, choices: eltChoice.choices,
            explain: `12 calendar months from ${fmtDay(m.elt)}: through ${fmtDay(elt.through)}.` },
          { id: 'pitot', label: 'Grounded by the static test today?', answer: yesNo(false), choices: ['Yes', 'No'],
            explain: `The test ran out on ${fmtDay(pitot.through)}, but 91.411 applies only to IFR in controlled airspace. Today is VFR. Don't accept an IFR clearance until it is done.` },
        ],
      },
      v === 1
        ? decide('d1', 'The annual',
          `The 100-hour has ${fmt1(h.remaining)} hours left, plenty for the ${fmt1(trip)} hour trip. The annual was signed on ${fmtDay(m.annual)}.`,
          maintenanceFigure(m, ['annual']),
          [
            { id: 'go', label: `Fly the trip. There are ${Math.floor(h.remaining)} hours left on the 100-hour.`, grade: gradePlan({ legal: annual.current, meetsGoal: true }),
              consequence: `The annual ran out on ${fmtDay(annual.through)}. Hours left before the 100-hour say nothing about the calendar. The annual (91.409(a)) counts months, and it has to be signed by an IA.` },
            { id: 'with-ap', label: 'Fly it with a mechanic aboard to keep an eye on things.', grade: gradePlan({ legal: annual.current, meetsGoal: true }),
              consequence: 'Who is in the right seat does not change the airplane\'s paperwork. It is out of annual.' },
            { id: 'ferry', label: 'Ask the club about a special flight permit to get it to the shop.', grade: gradePlan({ legal: true, meetsGoal: false }),
              consequence: 'A special flight permit (21.197) is how an airplane out of annual gets to the place that will inspect it. Useful to know, but it is not a trip for lunch.' },
            { id: 'swap', label: 'Book another club airplane and check its records first.', grade: gradePlan({ legal: true, meetsGoal: true }),
              consequence: 'The other airplane is in annual and has hours before its 100-hour. You fly the trip, and you tell the club the first one needs its annual.' },
          ],
          `Annual inspections run 12 calendar months: signed ${fmtDay(m.annual)}, good through ${fmtDay(annual.through)}. Hours left on the 100-hour don't extend it. Hours and months are separate clocks; read both.`,
        )
        : v === 2
          ? decide('d1', 'The trip and the 100-hour',
            `Your trip is ${fmt1(m.legHours)} hours each way, ${fmt1(trip)} in all. The 100-hour comes due in ${fmt1(h.remaining)}, and the annual is good through ${fmtDay(annual.through)}.`,
            maintenanceFigure(m, ['hundred', 'annual']),
            [
              { id: 'go', label: 'Fly the trip as planned.', grade: gradePlan({ ...plan(trip), meetsGoal: true }),
                consequence: `You come home with ${fmt1(h.remaining - trip)} hours left before the 100-hour and a note on the squawk sheet that it is coming up. Everything that applies to this flight is current.` },
              { id: 'local', label: 'Fly a local flight instead, to keep hours on the airplane.', grade: gradePlan({ ...plan(local), meetsGoal: false }),
                consequence: 'Legal, and you gave up the trip for a margin you already had.' },
              { id: 'swap', label: 'Book an airplane that is further from its 100-hour.', grade: gradePlan({ legal: true, meetsGoal: false }),
                consequence: `Nothing wrong with that one, but nothing wrong with this one either: ${fmt1(h.remaining)} hours covers ${fmt1(trip)} with room for a diversion.` },
              { id: 'cancel', label: 'Cancel. The static test is out of date.', grade: NEEDLESS,
                consequence: `The altimeter and static test (91.411) is for IFR in controlled airspace. Today is VFR, and the airplane is airworthy for it.` },
            ],
            `Annual through ${fmtDay(annual.through)}, ${fmt1(h.remaining)} hours to the 100-hour, transponder and ELT current. The old static test only matters for IFR. The trip works.`,
          )
          : decide('d1', 'The trip and the 100-hour',
            `Your trip is ${fmt1(m.legHours)} hours each way, ${fmt1(trip)} in all. The 100-hour comes due in ${fmt1(h.remaining)}.`,
            maintenanceFigure(m, ['hundred']),
            [
              { id: 'go', label: 'Fly the trip. The 10 hour allowance covers the return.', grade: gradePlan({ ...plan(trip), meetsGoal: true }),
                consequence: `You come home ${fmt1(trip - h.remaining)} hours past the 100-hour. The 10 hour allowance in 91.409(b) is only for getting the airplane to a place where the inspection can be done, and those hours come off the next interval anyway. A trip for lunch is not that.` },
              { id: 'tight', label: `Pick a closer field, ${fmt1(tight)} hours round trip.`, grade: gradePlan({ ...plan(tight), meetsGoal: true }),
                consequence: `Legal on paper, with ${fmt1(h.remaining - tight)} hours to spare. One extra lap in the pattern or a headwind home and you are over. A plan with no margin is a plan you will be tempted to stretch.` },
              { id: 'local', label: `Fly a local flight instead, about ${fmt1(local)} hours.`, grade: gradePlan({ ...plan(local), meetsGoal: false }),
                consequence: `Legal with room to spare, and you leave the airplane with ${fmt1(h.remaining - local)} hours for the next renter. You gave up the trip, though.` },
              { id: 'swap', label: 'Book another club airplane with time left before its 100-hour.', grade: gradePlan({ legal: true, meetsGoal: true }),
                consequence: 'You fly the trip you planned in an airplane that can take it, and the records stay clean.' },
            ],
            `${fmt1(trip)} hours is more than the ${fmt1(h.remaining)} left before the 100-hour, and the overfly allowance is not for trips.`,
          ),
    ];
  },
};

// ---------------------------------------------------------------- 1.4

export interface SquawkCase {
  label: string;
  squawk: Squawk;
}

/** The squawk board for the turn: one item on each of three club airplanes. */
export const SQUAWK_BOARD: SquawkCase[] = [
  { label: 'Airplane A', squawk: { equipment: 'clock', onEquipmentList: false } },
  { label: 'Airplane B', squawk: { equipment: 'fuel-gauge', onEquipmentList: true } },
  { label: 'Airplane C', squawk: { equipment: 'stall-warning', onEquipmentList: true } },
];

/** A different board for each situation of 1.4, so the turn changes too. */
export const SQUAWK_BOARDS: SquawkCase[][] = [
  SQUAWK_BOARD,
  [
    { label: 'Airplane A', squawk: { equipment: 'com-2', onEquipmentList: false } },
    { label: 'Airplane B', squawk: { equipment: 'tach', onEquipmentList: true } },
    { label: 'Airplane C', squawk: { equipment: 'autopilot', onEquipmentList: false } },
  ],
  [
    { label: 'Airplane A', squawk: { equipment: 'landing-light', onEquipmentList: false } },
    { label: 'Airplane B', squawk: { equipment: 'stall-warning', onEquipmentList: false } },
    { label: 'Airplane C', squawk: { equipment: 'compass', onEquipmentList: true } },
  ],
];

/** Today's airplane: two lights out, neither on its equipment list. */
export const TODAY_SQUAWKS: Squawk[] = [
  { equipment: 'landing-light', onEquipmentList: false },
  { equipment: 'position-lights', onEquipmentList: false },
];

/**
 * Position lights must be on from sunset to sunrise (91.209(a)), so a flight
 * that lands after sunset needs the night equipment.
 */
export function flightKindFor(landingAfterSunsetMin: number): InopFlight['kind'] {
  return landingAfterSunsetMin >= 0 ? 'night' : 'day';
}

function squawkFigure(title: string, rows: { who: string; squawk: Squawk; status: string; note?: string }[], focus: number[] = []): Figure {
  return {
    kind: 'records', variant: 'squawks', title,
    columns: [{ label: 'Airplane' }, { label: 'Item' }, { label: 'Equipment list' }, { label: 'Status' }],
    rows: rows.map((r, i) => ({
      cells: [r.who, EQUIPMENT[r.squawk.equipment].name, r.squawk.onEquipmentList ? 'Required' : 'Not listed', r.status],
      note: r.note, focus: focus.includes(i),
    })),
    caption: 'A made-up squawk sheet for this lesson. The equipment list column stands in for your airplane\'s own list, which is in its weight and balance papers.',
  };
}

const inop: Lesson = {
  id: '1.4', module: 1, minutes: 15,
  title: 'Inoperative equipment and 91.213',
  summary: 'Walk the 91.213(d) questions for anything broken, and plan around what an inoperative item rules out.',
  acs: ['PA.I.B'],
  refs: ['14 CFR 91.213(d)', '14 CFR 91.205', '14 CFR 91.209', 'PHAK ch. 9, inoperative equipment'],
  variants: 3,
  build(ctx) {
    // 0: two lights out and a landing after sunset. 1: the oil temperature
    // gauge reads zero on the run-up. 2: pitot heat out on a warm day.
    const v = ctx.variant ?? 0;
    const day: InopFlight = { kind: 'day', forHire: false };
    const board = SQUAWK_BOARDS[v % SQUAWK_BOARDS.length].map((c) => ({ ...c, result: inoperative(c.squawk, day) }));
    const dome = inoperative({ equipment: 'dome-light', onEquipmentList: false }, day);
    const plane = airplane(ctx);

    const plannedLand = SCENARIO_SUNSET + 20;
    const earlyLand = plannedLand - 60;
    const squeezeLand = SCENARIO_SUNSET - 5;
    const legalLanding = (landMin: number, squawks: Squawk[]) =>
      squawks.every((s) => inoperative(s, { kind: flightKindFor(landMin - SCENARIO_SUNSET), forHire: false }).mayFly);
    const position = inoperative(TODAY_SQUAWKS[1], { kind: 'night', forHire: false });
    const landing = inoperative(TODAY_SQUAWKS[0], { kind: 'night', forHire: false });
    const action = (r: { mayFly: boolean }) => (r.mayFly ? 'Placard and fly' : 'Grounded');
    const todayFig = squawkFigure(`Today: ${PRACTICE_TAIL}`, [
      { who: PRACTICE_TAIL, squawk: TODAY_SQUAWKS[0], status: 'Placarded INOP', note: 'Breaker pulled and collared' },
      { who: PRACTICE_TAIL, squawk: TODAY_SQUAWKS[1], status: 'Placarded INOP', note: 'Right wingtip, bulb out' },
    ], [0, 1]);

    return [
      {
        kind: 'brief', id: 'b1', title: 'Something on the squawk sheet',
        scene: `The club has no minimum equipment list, like most light airplanes. There are items written up on ${plane} and two others.`,
        say: {
          full: 'Without an MEL, **91.213(d)** decides. Ask four questions about the broken item. Is it on the airplane\'s **equipment list** or the type certificate\'s required equipment? Is it required by **91.205** or another rule **for this flight**: day, night, or the airspace you will be in? Is it required by an **AD**? If any answer is yes, the airplane stays on the ground until it is fixed. If all are no, it can go once the item is **removed or deactivated** and **placarded inoperative**, and a pilot or mechanic decides it is **no hazard**.',
          short: 'Equipment list, 91.205 for this flight, AD. All no: deactivate, placard, go.',
        },
        figure: squawkFigure('Club squawk board', board.map((c) => ({ who: c.label, squawk: c.squawk, status: 'Open' }))),
      },
      {
        kind: 'example', id: 'e1', title: 'The dome light, worked',
        say: {
          full: 'An easy one first: the cabin dome light. Walk the four questions in order and stop at the first yes.',
          short: 'Four questions, stop at the first yes.',
        },
        work: [
          { label: 'Equipment list?', value: 'No', note: 'Not required by the type certificate' },
          { label: '91.205 for a day flight?', value: 'No', note: 'Day VFR is 91.205(b): airspeed, altimeter, compass, tach, oil pressure and temperature, fuel gauge, belts and so on' },
          { label: 'An AD?', value: 'No' },
          { label: 'So', value: dome.mayFly ? 'Placard and fly' : 'Grounded', note: 'Pull the breaker, placard it INOP, log it, and decide it is no hazard' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'A day VFR flight in each of the three airplanes on the board. For each item, can it go once placarded, or is it grounded?',
        figure: squawkFigure('Club squawk board', board.map((c) => ({ who: c.label, squawk: c.squawk, status: 'Open' }))),
        blanks: board.map<Blank>((c, i) => ({
          id: `sq${i}`, label: `${c.label}: ${EQUIPMENT[c.squawk.equipment].name.toLowerCase()}`, answer: action(c.result), choices: ['Placard and fly', 'Grounded'],
          explain: c.result.mayFly
            ? 'Not on the equipment list, not in 91.205, no AD. Deactivate it, placard it, and go.'
            : `Required by ${c.result.requiredBy.join(' and ')}. It has to be fixed first.`,
        })),
      },
      v === 1
        ? (() => {
          const sq: Squawk = { equipment: 'oil-temp', onEquipmentList: false };
          const r = inoperative(sq, day);
          return decide('d1', 'A dead gauge on the run-up',
            `Day VFR, not for hire, an hour local. On the run-up the oil temperature needle sits on the peg. Oil pressure is in the green, and the club mechanic thinks it is probably the sender. Your passenger is buckled in.`,
            squawkFigure(`Today: ${PRACTICE_TAIL}`, [{ who: PRACTICE_TAIL, squawk: sq, status: 'Found on run-up' }], [0]),
            [
              { id: 'go', label: 'Go. Oil pressure is normal, and that is the one that matters.', grade: gradePlan({ legal: r.mayFly, meetsGoal: true }),
                consequence: `The oil temperature gauge is required for every flight by ${r.requiredBy.join(' and ')}. And a sender fault and a real oil problem look the same from the left seat until the pressure drops too.` },
              { id: 'placard', label: 'Placard it inoperative and go.', grade: gradePlan({ legal: r.mayFly, meetsGoal: true }),
                consequence: `A placard is the answer only when all four 91.213(d) questions come back no. This one is required by ${r.requiredBy.join(' and ')}, so it has to work.` },
              { id: 'fix', label: 'Taxi back, write it up, and take another airplane if one is free.', grade: gradePlan({ legal: true, meetsGoal: true }),
                consequence: 'Ten minutes on the ramp and you are off in the other airplane, with the squawk sheet telling the next pilot why this one is parked.' },
              { id: 'cancel', label: 'Taxi back, write it up, and call it a day.', grade: gradePlan({ legal: true, meetsGoal: false }),
                consequence: 'Legal and responsible. If another airplane was free, the flight did not have to end here.' },
            ],
            `Oil temperature is on the 91.205(b) list for every flight, so 91.213(d) can't let it go. Fix it or fly something else.`,
          );
        })()
        : v === 2
          ? (() => {
            const sq: Squawk = { equipment: 'pitot-heat', onEquipmentList: false };
            const r = inoperative(sq, day);
            return decide('d1', 'Pitot heat on a warm day',
              `Day VFR, not for hire. It is 14°C on the ground with a freezing level near 9,000 feet, and you'll cruise at 3,500. Checking the pitot heat on the walkaround, the tube stays cold.`,
              squawkFigure(`Today: ${PRACTICE_TAIL}`, [{ who: PRACTICE_TAIL, squawk: sq, status: 'Found on walkaround' }], [0]),
              [
                { id: 'go', label: 'Go as it is. You will not need pitot heat today.', grade: gradePlan({ legal: false, meetsGoal: true }),
                  consequence: 'You are right that you will not need it, and 91.213(d) still asks for the item to be deactivated and placarded inoperative, and the next pilot to know about it. Two minutes with a breaker collar and a label.' },
                { id: 'placard', label: 'Pull the breaker, placard it, write it up, and go.', grade: gradePlan({ legal: r.mayFly, meetsGoal: true }),
                  consequence: 'Not on the equipment list, not in 91.205 for day VFR, no AD. Placarded and noted, it is no hazard on a day with the freezing level six thousand feet above you.' },
                { id: 'wait', label: 'Wait for the mechanic to fix it on Monday.', grade: gradePlan({ legal: true, meetsGoal: false }),
                  consequence: 'Legal, and you lose the day over an item the rules let you placard for this flight.' },
                { id: 'cancel', label: 'Cancel. Something on the airplane is broken.', grade: NEEDLESS,
                  consequence: 'Broken and grounded are different things. Walking the four questions is what tells them apart.' },
              ],
              'Pitot heat is not on the equipment list or in 91.205 for day VFR. Deactivate, placard, note it, and go. It would matter in visible moisture near freezing, which today is not.',
            );
          })()
          : decide('d1', 'Two lights out',
          `${PRACTICE_TAIL} has the landing light and the right position light placarded inoperative. Your flight plan lands back at ${clock(plannedLand)}; in this scenario sunset is at ${clock(SCENARIO_SUNSET)}.`,
          todayFig,
          [
            { id: 'go', label: 'Go as planned. It is one bulb, and you are home in twilight.', grade: gradePlan({ legal: legalLanding(plannedLand, TODAY_SQUAWKS), meetsGoal: true }),
              consequence: `From sunset the position lights must be on (91.209(a)), and night VFR needs them by ${position.requiredBy.join(' and ')}. Twilight still counts. The airplane on downwind with one wingtip dark is hard to read for the traffic behind you.` },
            { id: 'squeeze', label: `Go now on a shorter route, back at ${clock(squeezeLand)}.`, grade: gradePlan({ legal: legalLanding(squeezeLand, TODAY_SQUAWKS), meetsGoal: true, margin: SCENARIO_SUNSET - squeezeLand, tightBelow: 15 }),
              consequence: `Legal if every minute goes your way. ${SCENARIO_SUNSET - squeezeLand} minutes is one go-around and a slow taxi from not legal.` },
            { id: 'early', label: `Leave an hour earlier and land by ${clock(earlyLand)}.`, grade: gradePlan({ legal: legalLanding(earlyLand, TODAY_SQUAWKS), meetsGoal: true, margin: SCENARIO_SUNSET - earlyLand, tightBelow: 15 }),
              consequence: `You land ${SCENARIO_SUNSET - earlyLand} minutes before sunset. A day flight needs neither light, and both are placarded.` },
            { id: 'fix', label: 'Have a mechanic replace the bulb and sign it off, then go as planned.', grade: gradePlan({ legal: legalLanding(plannedLand, TODAY_SQUAWKS.slice(0, 1)), meetsGoal: true }),
              consequence: `With the position light fixed, only the landing light is out, and ${landing.mayFly ? 'for a flight not for hire it is not required at night' : 'it is still required'}. You go as planned, with the taxi light and the runway lights to land by.` },
          ],
          `Neither light is on the equipment list, so both can be placarded for a day flight. The position light becomes required at sunset; the landing light is required at night only for hire (91.205(c)(4)).`,
        ),
    ];
  },
};

// ---------------------------------------------------------------- 1.5

export interface ReviewScenario {
  checkride: Day;
  lastReview: Day;
  trip: Day;
  /** A WINGS phase finished since the last review, which counts as one (61.56(e)). */
  wings: Day | null;
  /** The last time the pilot flew, when it matters to the story. */
  lastFlown: Day | null;
}

/**
 * 0: the trip falls just after the review runs out. 1: the same dates, but
 * a WINGS phase since then. 2: current on paper, and five months since the
 * last flight.
 */
export function reviewScenario(today: Day, situation = 0): ReviewScenario {
  const lastReview = addMonths(today, situation === 2 ? -14 : -23);
  return {
    checkride: addMonths(today, -50),
    lastReview,
    // Ten days after the review runs out.
    trip: situation === 2 ? addDays(today, 21) : addDays(flightReview(lastReview, today).through, 10),
    wings: situation === 1 ? addMonths(today, -9) : null,
    lastFlown: situation === 2 ? addDays(today, -150) : null,
  };
}

const flightReviewLesson: Lesson = {
  id: '1.5', module: 1, minutes: 12,
  title: 'The flight review and 61.56',
  summary: 'Find when your flight review runs out, what else resets it, and plan around the date.',
  acs: ['PA.I.A'],
  refs: ['14 CFR 61.56(c)', '14 CFR 61.56(d)', '14 CFR 61.56(e)'],
  variants: 3,
  build(ctx) {
    const v = ctx.variant ?? 0;
    const today = toDay(ctx.now);
    const s = reviewScenario(today, v);
    const fromCheckride = flightReview(s.checkride, today);
    const last = flightReview(s.lastReview, today);
    const latest = s.wings ?? s.lastReview;
    const paxOnTrip = passengerCurrency(s.lastFlown ? [{ day: s.lastFlown, landings: [{ count: 2, fullStop: true, afterSunsetMin: null }] }] : currencyLog(today), s.trip, 'day');
    const onTrip = flightReview(latest, s.trip);
    const reviewChoice = dateChoices(last.through, [addMonths(s.lastReview, 24), endOfCalendarMonth(s.lastReview, 12), endOfCalendarMonth(s.lastReview, 23)]);
    const newReview = addDays(last.through, -14);
    const afterNew = flightReview(newReview, s.trip);
    const figure: Figure = {
      kind: 'records', variant: 'logbook', title: 'Your logbook endorsements',
      columns: [{ label: 'Date', num: true }, { label: 'Entry' }, { label: 'Signed' }],
      rows: [
        { cells: [fmtDay(s.checkride), 'Private pilot practical test, passed', 'Examiner'] },
        { cells: [fmtDay(s.lastReview), 'Flight review, 14 CFR 61.56(a)', 'CFI'], focus: true },
        ...(s.wings ? [{ cells: [fmtDay(s.wings), 'WINGS phase completed, basic level', 'FAASTeam record'], focus: true }] : []),
        ...(s.lastFlown ? [{ cells: [fmtDay(s.lastFlown), 'Local flight, 1.1 hours. Last entry in the book', ''] }] : []),
      ],
      caption: 'Made-up logbook endorsements for this lesson, not yours.',
    };

    const own: Step = ctx.lastFlightReview
      ? (() => {
        const mine = flightReview(ctx.lastFlightReview, today);
        return {
          kind: 'brief', id: 'b2', title: 'Your own date',
          scene: `Your profile says your last flight review was on ${fmtDay(ctx.lastFlightReview)}.`,
          say: {
            full: mine.current
              ? `That carries you through **${fmtDay(mine.through)}**, ${plural(mine.daysLeft, 'day')} from today. Put a reminder two months ahead of it, and book the instructor before you book the trip.`
              : `That ran out on **${fmtDay(mine.through)}**. Until you fly a review with an instructor, you can fly with one but not as pilot in command.`,
            short: mine.current ? `Through ${fmtDay(mine.through)}.` : `Ran out ${fmtDay(mine.through)}.`,
          },
        } satisfies Step;
      })()
      : {
        kind: 'brief', id: 'b2', title: 'Your own date',
        say: {
          full: 'Add the date of your last flight review on the Pilot screen, and this lesson will work out your own date the next time you fly it.',
          short: 'Add your last flight review on the Pilot screen.',
        },
      };

    return [
      {
        kind: 'brief', id: 'b1', title: 'Every 24 calendar months',
        scene: `It's ${fmtDay(today)}. You are planning a long weekend away on ${fmtDay(s.trip)}.`,
        say: {
          full: 'To act as **pilot in command**, alone or with passengers, you need a flight review in the preceding **24 calendar months** (61.56(c)): an hour of ground and an hour of flight with an instructor, signed in your logbook. Two other things reset the clock: a **practical test** for a new certificate or rating (61.56(d)), and a phase of the FAA **WINGS** program (61.56(e)). It runs to the end of the month, like the medical.',
          short: '24 calendar months. A checkride or a WINGS phase also counts.',
        },
        figure,
      },
      {
        kind: 'example', id: 'e1', title: 'Your checkride, worked',
        say: {
          full: 'Your private pilot checkride counted as a flight review. Here is how long it carried you.',
          short: 'The checkride counted.',
        },
        figure,
        work: [
          { label: 'Practical test', value: fmtDay(s.checkride), note: '61.56(d)' },
          { label: '24 calendar months', value: fmtDay(fromCheckride.through), note: 'Last day of the 24th month after' },
          { label: 'Today', value: fromCheckride.current ? 'Still current' : 'Long past', note: 'The review since then is the one that matters now' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Your last review is the second line. When does it run out, are you current for the trip, and which of these would also reset the clock?',
        figure,
        blanks: [
          { id: 'through', label: 'Flight review good through', answer: reviewChoice.answer, choices: reviewChoice.choices,
            explain: `24 calendar months from ${fmtDay(s.lastReview)}: the last day of the month, ${fmtDay(last.through)}.` },
          { id: 'trip', label: `Current on ${fmtDay(s.trip)}?`, answer: yesNo(onTrip.current), choices: ['Yes', 'No'],
            explain: s.wings
              ? `The review alone runs out first, but the WINGS phase on ${fmtDay(s.wings)} counts as a flight review and carries you through ${fmtDay(onTrip.through)}.`
              : onTrip.current ? 'Still inside the 24 months.' : `${plural(-onTrip.daysLeft, 'day')} past it.` },
          { id: 'resets', label: 'Also resets the clock', answer: 'A WINGS phase', choices: ['Three landings in 90 days', 'A WINGS phase', 'A new medical'],
            explain: 'A WINGS phase counts under 61.56(e). Landings are recency for passengers (61.57), and the medical is its own clock.' },
        ],
      },
      v === 1
        ? decide('d1', 'The trip and the WINGS phase',
          `Your review runs out on ${fmtDay(last.through)}. The trip is ${fmtDay(s.trip)}. You finished a WINGS phase on ${fmtDay(s.wings!)}.`,
          figure,
          [
            { id: 'go', label: 'Fly the trip as planned.', grade: gradePlan({ legal: onTrip.current, meetsGoal: true }),
              consequence: `The WINGS phase counts under 61.56(e) and carries you through ${fmtDay(onTrip.through)}. Make sure it is in your logbook or printed from the FAASTeam site, so anyone who asks can see it.` },
            { id: 'review', label: 'Fit in a flight review before the trip, to be safe.', grade: gradePlan({ legal: true, meetsGoal: false }),
              consequence: 'Never a bad hour of flying, but not a legal need. The WINGS phase already did the job.' },
            { id: 'solo', label: 'Fly it alone and leave the passengers home.', grade: gradePlan({ legal: true, meetsGoal: false }),
              consequence: 'The flight review rule has nothing to do with passengers, and you are current anyway.' },
            { id: 'cancel', label: 'Cancel until you have a fresh review.', grade: NEEDLESS,
              consequence: `You were current through ${fmtDay(onTrip.through)}. Know every way the clock resets, so a rule you've met doesn't cancel a trip.` },
          ],
          `A completed WINGS phase is a flight review for 61.56. The trip is inside the 24 calendar months it starts.`,
        )
        : v === 2
          ? decide('d1', 'Five months off',
            `Your review is good through ${fmtDay(last.through)}, and the trip on ${fmtDay(s.trip)} is well inside it. You haven't flown since ${fmtDay(s.lastFlown!)}, and the trip is to a busier field you haven't been to, with two friends aboard.`,
            figure,
            [
              { id: 'go', label: 'Fly the trip as planned. Your review is current.', grade: gradePlan({ legal: paxOnTrip.current, meetsGoal: true }),
                consequence: `The review is only one clock. With no landings since ${fmtDay(s.lastFlown!)}, you have none in the 90 days before the trip, so you can't carry passengers (61.57(a)). And the first landing in five months would be at a strange field with two friends watching.` },
              { id: 'cfi', label: 'Book an hour with an instructor first, and fly the trip after.', grade: gradePlan({ legal: true, meetsGoal: true }),
                consequence: 'An hour of landings, a stall or two and a look at the arrival to the new field. Your friends get a pilot who is sharp, and the trip happens.' },
              { id: 'solo', label: 'Fly a solo practice hour first, then the trip.', grade: gradePlan({ legal: true, meetsGoal: true }),
                consequence: 'Three takeoffs and landings make you passenger current again, and a walk through the radio calls for the busier field finds the rust before the passengers do. An instructor would find more.' },
              { id: 'cancel', label: 'Cancel the trip.', grade: gradePlan({ legal: true, meetsGoal: false }),
                consequence: 'Safe, and more than the problem asked for. A practice flight first fixes it.' },
            ],
            `The flight review is good through ${fmtDay(last.through)}, but passenger currency is its own clock: three takeoffs and landings in the preceding 90 days, and you have none. Fly first, then take your friends.`,
          )
          : decide('d1', 'The trip is after the date',
            `Your review runs out on ${fmtDay(last.through)}. The trip is ${fmtDay(s.trip)}.`,
            figure,
            [
              { id: 'go', label: 'Fly the trip and schedule the review for when you get back.', grade: gradePlan({ legal: onTrip.current, meetsGoal: true }),
                consequence: `On ${fmtDay(s.trip)} you are not allowed to act as pilot in command. If anything goes wrong, the first question asked will be about your logbook.` },
              { id: 'solo', label: 'Fly it alone. The review only matters with passengers.', grade: gradePlan({ legal: onTrip.current, meetsGoal: true }),
                consequence: 'The flight review is about acting as pilot in command at all, not about passengers. That is 61.57. Alone, you are still out of date.' },
              { id: 'review', label: `Book a flight review with an instructor before ${fmtDay(last.through)}.`, grade: gradePlan({ legal: afterNew.current, meetsGoal: true }),
                consequence: `A review on ${fmtDay(newReview)} carries you through ${fmtDay(afterNew.through)}. Ask the instructor to fly part of the trip's route with you.` },
              { id: 'wings', label: 'Finish a WINGS phase before the date.', grade: gradePlan({ legal: afterNew.current, meetsGoal: true }),
                consequence: 'Three knowledge credits and three flight credits with an instructor, and the phase counts as your review. Many pilots find it the better training.' },
            ],
            `The trip falls ${plural(-onTrip.daysLeft, 'day')} after the review runs out. A review or a WINGS phase before then keeps you legal.`,
          ),
      own,
    ];
  },
};

export const pilotAirplaneLessons: Lesson[] = [currentToCarry, documents, airworthy, inop, flightReviewLesson];
