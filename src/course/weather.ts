// Module 2, Weather: five flights. Every flight is built around the pilot's
// own field, runways, airplane and minimums. Decisions on the ground are
// graded by the same go/no-go engine as the daily flight; the one decision in
// the air (2.5) is graded here, with the rule that decides it cited.

import { buildBrief, runwayWind, type Brief, type ChoiceId, type Grade } from '../scenarios/goNoGo';
import { parseMetar } from '../lib/metar';
import { parseTaf } from '../lib/taf';
import { trueToMagnetic, components, norm } from '../lib/wind';
import {
  addHours, cloud, gustForCrosswind, nextLocalHour, mainRunway, metarText, observedAt, wholeHourAfter, windAcross, windGroup, zDayHour, zTime,
} from './practice';
import type { Lesson, LessonContext, Option, Step } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const deg = (n: number) => String(Math.round(norm(n)) || 360).padStart(3, '0');
const hhmmZ = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
const local = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const round100 = (n: number) => Math.round(n / 100) * 100;

function fieldName(ctx: LessonContext): string {
  return ctx.practiceField ? 'the practice field' : ctx.airport.icao;
}

function options(labels: Record<ChoiceId, string>): Option[] {
  return (['go', 'go-plan', 'delay', 'cancel'] as ChoiceId[]).map((id) => ({ id, label: labels[id] }));
}

/**
 * Lesson copy is written for the conditions the lesson sets up. With unusual
 * minimums or a high field the engine can grade differently; when it does, the
 * consequence falls back to plain text that follows the engine's grade.
 */
function consequences(brief: Brief, intended: Partial<Record<ChoiceId, Grade>>, written: Record<ChoiceId, string>): Record<ChoiceId, string> {
  const out = {} as Record<ChoiceId, string>;
  for (const id of Object.keys(written) as ChoiceId[]) {
    if (!intended[id] || brief.grades[id] === intended[id]) {
      out[id] = written[id];
      continue;
    }
    const top = brief.findings.find((f) => f.severity !== 'info');
    out[id] = top
      ? `With your numbers this plays out differently: ${top.title.toLowerCase()}. ${brief.rationale}`
      : `With your numbers nothing on this report binds. ${brief.rationale}`;
  }
  return out;
}

function decision(id: string, title: string, situation: string, brief: Brief, labels: Record<ChoiceId, string>, intended: Partial<Record<ChoiceId, Grade>>, written: Record<ChoiceId, string>, why: string): Step {
  return {
    kind: 'decide', id, title, situation, brief,
    options: options(labels),
    grades: brief.grades,
    consequence: consequences(brief, intended, written),
    why: `${why} ${brief.rationale}`.trim(),
  };
}

// ---------------------------------------------------------------- 2.1

const readMetar: Lesson = {
  id: '2.1', module: 2, minutes: 12,
  title: 'Reading the METAR before you drive out',
  summary: 'Decode a routine report group by group, find the ceiling, and name the flight category.',
  acs: ['PA.I.C'],
  refs: ['Aviation Weather Handbook (FAA-H-8083-28), METAR', 'AIM 7-1, meteorology'],
  build(ctx) {
    const f = ctx.airport;
    const rwy = mainRunway(f);
    const obs = observedAt(ctx.now);
    const dep = wholeHourAfter(ctx.now, 1);
    const ceiling = round100(Math.max(ctx.minimums.ceilingFt + 2000, 4500));
    const windTrue = windAcross(f, rwy.headingMag, 20);
    const raw = metarText({
      station: f.icao, at: obs, wind: { dirTrue: windTrue, speedKt: 8 }, vis: '10SM',
      sky: [cloud('FEW', 2500), cloud('BKN', ceiling)], tempC: 18, dewC: 9, altimeter: 30.05,
    });
    const metar = parseMetar(raw);
    const brief = buildBrief({ airport: f, aircraft: ctx.aircraft, wb: null, minimums: ctx.minimums, metar, taf: null, departure: dep, tripHours: 2 });
    const figure = { kind: 'metar' as const, raw };
    return [
      {
        kind: 'brief', id: 'b1', title: 'Before you leave the house',
        scene: `You're planning a local flight from ${fieldName(ctx)}, wheels up around ${local(dep)}. Before you drive out you pull the latest report.`,
        say: {
          full: 'A METAR is one observation, taken just before the hour, written in a fixed order: **where**, **when**, **wind**, **visibility**, **weather**, **sky**, **temperature and dew point**, **altimeter**. Read it left to right in that order every time and you will never lose your place. We will do this one together, then you will do the next part on your own.',
          short: 'Same order every time: where, when, wind, visibility, weather, sky, temperature, altimeter.',
        },
        figure,
      },
      {
        kind: 'example', id: 'e1', title: 'Group by group',
        say: {
          full: 'Here is the report taken apart. Two things catch people out. The time is **Zulu**, not local. The wind direction is **true**, not magnetic, so it will not match the runway numbers or the tower. We spend the whole next lesson on that.',
          short: 'Time is Zulu. Wind is true.',
        },
        figure,
        work: [
          { label: 'Where', value: f.icao, note: ctx.practiceField ? 'Practice field, not a real station' : f.name },
          { label: 'When', value: `${zTime(obs)}`, note: `Day ${obs.getUTCDate()}, ${hhmmZ(obs)}, which is ${local(obs)} local` },
          { label: 'Wind', value: windGroup({ dirTrue: windTrue, speedKt: 8 }), note: `From ${deg(windTrue)}° true at 8 knots` },
          { label: 'Visibility', value: '10SM', note: '10 statute miles' },
          { label: 'Sky', value: `${cloud('FEW', 2500)} ${cloud('BKN', ceiling)}`, note: `A few clouds at 2,500, broken at ${fmt(ceiling)}. Heights are above the field.` },
          { label: 'Temperature', value: '18/09', note: '18°C, dew point 9°C: a 9 degree spread' },
          { label: 'Altimeter', value: 'A3005', note: '30.05 inches. Set it before takeoff.' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Same report. What is the ceiling, how far can you see, and what flight category is it?',
        figure,
        blanks: [
          { id: 'ceiling', label: 'Ceiling', unit: 'ft AGL', answer: ceiling, tolerance: 0,
            explain: `The ceiling is the lowest **broken** or **overcast** layer, or vertical visibility. FEW and SCT don't count, so it is the BKN layer at ${fmt(ceiling)} feet.` },
          { id: 'vis', label: 'Visibility', unit: 'SM', answer: 10, tolerance: 0, explain: '10SM is ten statute miles.' },
          { id: 'cat', label: 'Flight category', answer: 'VFR', choices: ['VFR', 'MVFR', 'IFR', 'LIFR'],
            explain: 'VFR is a ceiling above 3,000 feet and visibility above 5 miles. MVFR is 1,000 to 3,000 feet or 3 to 5 miles.' },
        ],
      },
      decision('d1', 'Do you drive out?',
        `Your minimums are a ${fmt(ctx.minimums.ceilingFt)} foot ceiling and ${ctx.minimums.visibilitySm} miles. The report is twenty minutes old.`,
        brief,
        {
          go: 'Drive out and start the preflight.',
          'go-plan': 'Drive out, and check the next report before engine start.',
          delay: 'Wait at home for the next hourly report.',
          cancel: 'Cancel. Something about it feels off.',
        },
        { go: 'best', 'go-plan': 'acceptable' },
        {
          go: `You're at the airplane by ${local(addHours(ctx.now, 0.5))}. The new report an hour later reads almost the same. A good day.`,
          'go-plan': 'Also fine. Checking again before engine start is a good habit, though nothing on this report needed it.',
          delay: 'You lose an hour for a report that reads the same. Nothing wrong with caution, but this one was clear.',
          cancel: 'Nothing on this report argues against the flight. Canceling without a reason you can name makes it harder to trust your own reasons later.',
        },
        'Every group is well inside your minimums.',
      ),
    ];
  },
};

// ---------------------------------------------------------------- 2.2

const windOnRunway: Lesson = {
  id: '2.2', module: 2, minutes: 15,
  title: 'Wind on the runway',
  summary: 'Turn a true wind into a magnetic one, find the crosswind on your runway, and hold it against your minimum.',
  acs: ['PA.I.C', 'PA.IV.B'],
  refs: ['Pilot\'s Handbook of Aeronautical Knowledge (FAA-H-8083-25), crosswind components', 'Airplane Flying Handbook (FAA-H-8083-3), crosswind approach and landing'],
  build(ctx) {
    const f = ctx.airport;
    const rwy = mainRunway(f);
    const vari = f.magneticVariationDeg;
    const varText = vari === 0 ? 'no variation' : `${Math.abs(vari)}° ${vari < 0 ? 'west' : 'east'}`;
    const obs = observedAt(ctx.now);
    const dep = wholeHourAfter(ctx.now, 0.5);

    // Worked example: a steady wind 30° off the runway.
    const exTrue = windAcross(f, rwy.headingMag, -30);
    const exMag = trueToMagnetic(exTrue, vari);
    const ex = components(exMag, 10, rwy.headingMag);

    // The lesson's wind: about 40° off, gusting just over the pilot's minimum.
    const windTrue = windAcross(f, rwy.headingMag, 40);
    const windMag = trueToMagnetic(windTrue, vari);
    const angle = components(windMag, 10, rwy.headingMag).angleDeg || 40;
    const gust = gustForCrosswind(ctx.minimums, angle, 2);
    const steady = Math.max(gust - 8, 5);
    const raw = metarText({
      station: f.icao, at: obs, wind: { dirTrue: windTrue, speedKt: steady, gustKt: gust }, vis: '10SM',
      sky: [cloud('SCT', round100(Math.max(ctx.minimums.ceilingFt + 1500, 4500)))], tempC: 16, dewC: 6, altimeter: 29.98,
    });
    const metar = parseMetar(raw);
    const rw = runwayWind(f, metar.wind)!;
    const steadyX = rw.steady?.crosswindKt ?? 0;
    const gustX = rw.gust?.crosswindKt ?? steadyX;
    const brief = buildBrief({ airport: f, aircraft: ctx.aircraft, wb: null, minimums: ctx.minimums, metar, taf: null, departure: dep, tripHours: 1.5 });
    const demo = ctx.aircraft.demonstratedCrosswindKt;
    const reportedMag = trueToMagnetic(metar.wind!.dirTrue!, vari);

    return [
      {
        kind: 'brief', id: 'b1', title: 'Two norths',
        scene: `Same field, a windier afternoon. You're taxiing out at ${fieldName(ctx)} for runway ${rwy.id}.`,
        say: {
          full: `The METAR gives wind from **true** north, because it is written for maps and forecasts. Runway numbers, the tower and the ATIS use **magnetic** north, because that is what your compass reads. Here the variation is ${varText}. ${vari < 0 ? 'West variation means magnetic is **more** than true: add it. "East is least, west is best."' : vari > 0 ? 'East variation means magnetic is **less** than true: subtract it. "East is least, west is best."' : 'With no variation the two agree, but the habit of checking still matters.'} Only then do you compare the wind with the runway.`,
          short: `Variation here is ${varText}. Convert before you compare.`,
        },
        figure: { kind: 'metar', raw, marks: [windGroup({ dirTrue: windTrue, speedKt: steady, gustKt: gust })] },
      },
      {
        kind: 'example', id: 'e1', title: 'A worked one first',
        say: {
          full: `Let's do an easier wind together: ${deg(exTrue)} at 10, no gusts. Convert it, find the angle to runway ${rwy.id}, then use the rule of thumb: at 30° off the nose the crosswind is about **half** the wind, at 45° about **seven tenths**, at 60° and beyond nearly **all** of it.`,
          short: 'Convert, find the angle, then half, seven tenths, or nearly all.',
        },
        figure: { kind: 'wind', airport: f, windMag: exMag, speedKt: 10, gustKt: null, runwayId: rwy.id },
        work: [
          { label: 'Reported', value: `${deg(exTrue)}° true at 10 kt` },
          { label: 'Variation', value: varText, note: vari === 0 ? undefined : `${deg(exTrue)} ${vari < 0 ? '+' : '−'} ${Math.abs(vari)}` },
          { label: 'Magnetic', value: `${deg(exMag)}°` },
          { label: `Angle to ${rwy.id}`, value: `${ex.angleDeg}°`, note: `Runway ${rwy.id} is ${deg(rwy.headingMag)}°` },
          { label: 'Crosswind', value: `${Math.round(ex.crosswindKt)} kt from the ${ex.from}`, note: `Headwind ${Math.round(ex.headwindKt)} kt` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now the real one: ${windGroup({ dirTrue: windTrue, speedKt: steady, gustKt: gust })}. What is the wind in magnetic, and what is the crosswind on runway ${rw.runway.id}, steady and in the gusts?`,
        figure: { kind: 'metar', raw, marks: [windGroup({ dirTrue: windTrue, speedKt: steady, gustKt: gust })] },
        blanks: [
          { id: 'mag', label: 'Wind, magnetic', unit: '°', answer: reportedMag, tolerance: 5,
            explain: `${deg(metar.wind!.dirTrue!)}° true with ${varText} is ${deg(reportedMag)}° magnetic.` },
          { id: 'xw', label: 'Crosswind, steady', unit: 'kt', answer: Math.round(steadyX), tolerance: 2,
            explain: `${rw.steady!.angleDeg}° off the runway at ${steady} knots is about ${Math.round(steadyX)} knots across.` },
          { id: 'xwg', label: 'Crosswind, in gusts', unit: 'kt', answer: Math.round(gustX), tolerance: 2,
            explain: `The same angle at ${gust} knots is about ${Math.round(gustX)} knots across. Plan for the gust, not the average.` },
        ],
      },
      decision('d1', `Holding short of ${rw.runway.id}`,
        `Run-up done. Crosswind about ${Math.round(steadyX)} knots, ${Math.round(gustX)} in the gusts. Your personal minimum is ${ctx.minimums.crosswindKt} knots${demo > 0 ? `, and the airplane's demonstrated crosswind is ${demo}` : ''}.`,
        brief,
        {
          go: 'Go. It is legal, and the airplane can handle it.',
          'go-plan': 'Go, but abort the takeoff if it gets squirrelly, and plan a full-stop landing.',
          delay: 'Taxi back and wait an hour to see if it settles.',
          cancel: 'Taxi back and put the airplane away.',
        },
        { go: 'unsafe', 'go-plan': 'marginal' },
        {
          go: `The takeoff is fine. The landing is not: a ${Math.round(gustX)} knot gust arrives in the flare, you run out of aileron, and you go around twice before getting it down long and fast. Nothing broken, but you flew past a line you drew for yourself.`,
          'go-plan': 'An abort point is good thinking, but the hard part is the landing, and you have committed to that the moment you lift off.',
          delay: 'Reasonable. Without a forecast you are guessing whether it settles, so check it against a TAF before you wait. That is the next lesson.',
          cancel: 'The clean call. Your minimum did its job: it made the decision before the wind could.',
        },
        `The gust crosswind is over your ${ctx.minimums.crosswindKt} knot minimum.`,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 2.3

const tafReturn: Lesson = {
  id: '2.3', module: 2, minutes: 15,
  title: 'The TAF and your return time',
  summary: 'Read the forecast against your own departure and return, not the clock, and spot when waiting is the better trip.',
  acs: ['PA.I.C'],
  refs: ['Aviation Weather Handbook (FAA-H-8083-28), TAF', '14 CFR 91.103, preflight action'],
  build(ctx) {
    const f = ctx.airport;
    const rwy = mainRunway(f);
    const obs = observedAt(ctx.now);
    const dep = wholeHourAfter(ctx.now, 1);
    const ret = addHours(dep, 2);
    const fm = addHours(dep, 4);
    const validFrom = wholeHourAfter(addHours(obs, -1), 1);

    const windTrue = windAcross(f, rwy.headingMag, 50);
    const angle = 50;
    const gust = gustForCrosswind(ctx.minimums, angle, 3);
    const steady = Math.max(gust - 8, 5);
    const calmTrue = windAcross(f, rwy.headingMag, 10);
    const ceiling = round100(Math.max(ctx.minimums.ceilingFt + 1500, 4500));
    const fmGroup = `FM${zDayHour(fm)}00`;

    const rawMetar = metarText({
      station: f.icao, at: obs, wind: { dirTrue: windTrue, speedKt: steady, gustKt: gust }, vis: '10SM',
      sky: [cloud('SCT', ceiling)], tempC: 14, dewC: 3, altimeter: 30.01,
    });
    const rawTaf = [
      'TAF', f.icao, zTime(addHours(validFrom, -0.67)), `${zDayHour(validFrom)}/${zDayHour(addHours(validFrom, 24))}`,
      windGroup({ dirTrue: windTrue, speedKt: steady, gustKt: gust }), 'P6SM', cloud('SCT', ceiling),
      fmGroup, windGroup({ dirTrue: calmTrue, speedKt: 7 }), 'P6SM', 'SKC',
    ].join(' ');
    const metar = parseMetar(rawMetar);
    const taf = parseTaf(rawTaf);
    const brief = buildBrief({ airport: f, aircraft: ctx.aircraft, wb: null, minimums: ctx.minimums, metar, taf, departure: dep, tripHours: 2 });
    const figure = { kind: 'taf' as const, raw: rawTaf, departure: dep, returnAt: ret };

    return [
      {
        kind: 'brief', id: 'b1', title: 'Now and later',
        scene: `A two-hour flight: off at ${hhmmZ(dep)}, back by ${hhmmZ(ret)}. The wind is up again.${ctx.practiceField ? '' : ` For this lesson, assume ${f.icao} issues its own TAF. Many fields don't, and you read the nearest one instead.`}`,
        say: {
          full: 'The METAR says what the field is doing **now**. A flight needs to know what it will be doing when you come back, and that is the TAF. It opens with a valid period, then the opening forecast, then **change groups**. **FM** means "from this time on, replace everything above with this." Read every group against **your** departure and return times, not against the clock on the wall.',
          short: 'Read each group against your own departure and return.',
        },
        figure,
      },
      {
        kind: 'example', id: 'e1', title: 'Laying it against the flight',
        say: {
          full: `Validity first: day ${validFrom.getUTCDate()} at ${String(validFrom.getUTCHours()).padStart(2, '0')}Z for 24 hours. The opening forecast holds until ${fmGroup}, which is ${hhmmZ(fm)}. Your flight sits entirely in front of it. The calmer wind is real, but it arrives two hours after you are back.`,
          short: `${fmGroup} is ${hhmmZ(fm)}. Where does your flight sit?`,
        },
        figure,
        work: [
          { label: 'Valid', value: `${zDayHour(validFrom)}/${zDayHour(addHours(validFrom, 24))}`, note: `From day ${validFrom.getUTCDate()} at ${String(validFrom.getUTCHours()).padStart(2, '0')}Z, for 24 hours` },
          { label: 'Opening', value: `${windGroup({ dirTrue: windTrue, speedKt: steady, gustKt: gust })} P6SM ${cloud('SCT', ceiling)}`, note: `Gusts to ${gust}, good visibility` },
          { label: fmGroup, value: `${windGroup({ dirTrue: calmTrue, speedKt: 7 })} P6SM SKC`, note: `From ${hhmmZ(fm)}: light wind, nearly down the runway` },
          { label: 'Your flight', value: `${hhmmZ(dep)} to ${hhmmZ(ret)}`, note: 'Entirely in the opening forecast' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Which part of the TAF covers your return, what gusts does it forecast, and at what hour does the wind ease?',
        figure,
        blanks: [
          { id: 'group', label: 'Group covering your return', answer: 'Opening forecast', choices: ['Opening forecast', fmGroup],
            explain: `You're back at ${hhmmZ(ret)}; ${fmGroup} doesn't start until ${hhmmZ(fm)}.` },
          { id: 'gust', label: 'Gusts at your return', unit: 'kt', answer: gust, tolerance: 0, explain: `The opening forecast has gusts to ${gust}.` },
          { id: 'ease', label: 'Wind eases at', unit: 'Z (hour)', answer: fm.getUTCHours(), tolerance: 0,
            explain: `${fmGroup}: day ${fm.getUTCDate()}, ${String(fm.getUTCHours()).padStart(2, '0')}00Z.` },
        ],
      },
      decision('d1', 'Now, or after the change?',
        `It is ${hhmmZ(addHours(dep, -0.5))}. The gusts are over your ${ctx.minimums.crosswindKt} knot crosswind minimum now, and the TAF has them until ${hhmmZ(fm)}.`,
        brief,
        {
          go: 'Go now. The TAF says it gets better anyway.',
          'go-plan': 'Go now, and come back early if it is bad.',
          delay: `Move the flight to after ${hhmmZ(fm)}.`,
          cancel: 'Cancel for today.',
        },
        { go: 'unsafe', 'go-plan': 'marginal', delay: 'best' },
        {
          go: 'This is the most common way a TAF gets misread: an improvement after you land used as the reason to go before it. You fly the whole trip in the gusts.',
          'go-plan': 'Coming back early still means landing in the opening forecast. The early return buys nothing.',
          delay: `You take off at ${hhmmZ(addHours(fm, 0.5))} into a light wind nearly down the runway. Same trip, much more margin.`,
          cancel: 'Safe, but the forecast handed you a better slot later the same day.',
        },
        'The improvement is the argument for waiting, not for going.',
      ),
    ];
  },
};

// ---------------------------------------------------------------- 2.4

const ceilings: Lesson = {
  id: '2.4', module: 2, minutes: 12,
  title: 'Ceilings: legal, personal, and the pattern',
  summary: 'Separate the legal VFR minimum from the ceiling you need for a normal pattern, and from the one you set for yourself.',
  acs: ['PA.I.C', 'PA.I.E'],
  refs: ['14 CFR 91.155, basic VFR weather minimums', 'Risk Management Handbook (FAA-H-8083-2), personal minimums'],
  build(ctx) {
    const f = ctx.airport;
    const rwy = mainRunway(f);
    const obs = observedAt(ctx.now);
    const dep = wholeHourAfter(ctx.now, 1);
    const ceiling = Math.max(1100, round100(ctx.minimums.ceilingFt - 700));
    const raw = metarText({
      station: f.icao, at: obs, wind: { dirTrue: windAcross(f, rwy.headingMag, 10), speedKt: 6 }, vis: '8SM',
      sky: [cloud('BKN', ceiling), cloud('OVC', ceiling + 1500)], tempC: 12, dewC: 6, altimeter: 30.12,
    });
    const metar = parseMetar(raw);
    const brief = buildBrief({ airport: f, aircraft: ctx.aircraft, wb: null, minimums: ctx.minimums, metar, taf: null, departure: dep, tripHours: 1 });
    const surface = f.airspace === 'G' ? 'Class G' : `the Class ${f.airspace} surface area`;
    const figure = { kind: 'metar' as const, raw, marks: [cloud('BKN', ceiling)] };

    return [
      {
        kind: 'brief', id: 'b1', title: 'Three numbers',
        scene: `Low and grey this morning. You only want to fly the pattern at ${fieldName(ctx)}.`,
        say: {
          full: `There are three different ceilings in your head. The **legal** one: to take off or land VFR in a surface area you need a 1,000 foot ceiling and 3 miles (91.155(c) and (d)). The **practical** one: a pattern at 1,000 feet above the field, with the 500 feet of clearance below cloud that Class D and E require, needs about 1,500 feet. And **yours**: you set ${fmt(ctx.minimums.ceilingFt)} on a calm day for reasons you'll want to remember on a day like this.`,
          short: 'Legal 1,000. A normal pattern about 1,500. Yours is the one that binds.',
        },
        figure,
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'What is the ceiling, what is the legal minimum ceiling in a surface area, and what ceiling gives a 1,000 foot pattern 500 feet below the clouds?',
        figure,
        blanks: [
          { id: 'ceiling', label: 'Ceiling', unit: 'ft AGL', answer: ceiling, tolerance: 0, explain: `The lowest broken layer: ${fmt(ceiling)} feet.` },
          { id: 'legal', label: 'Legal VFR ceiling, surface area', unit: 'ft', answer: 1000, tolerance: 0,
            explain: '91.155(c): no VFR takeoff, landing or pattern under a ceiling below 1,000 feet in a surface area, without special VFR.' },
          { id: 'pattern', label: 'Ceiling for a 1,000 ft pattern', unit: 'ft', answer: 1500, tolerance: 0,
            explain: '1,000 feet of pattern plus 500 feet below the clouds.' },
        ],
      },
      {
        kind: 'example', id: 'e1', title: 'Where today sits',
        say: {
          full: `So today's ${fmt(ceiling)} feet is ${ceiling >= 1000 ? 'legal' : 'not legal'} in ${surface}, ${ceiling >= 1500 ? 'tall enough for a normal pattern' : 'too low for a normal pattern without squeezing the cloud clearance'}, and ${ceiling < ctx.minimums.ceilingFt ? `${fmt(ctx.minimums.ceilingFt - ceiling)} feet under your own minimum` : 'at or above your own minimum'}. Legal is the floor, not the target.`,
          short: 'Legal is the floor, not the target.',
        },
        work: [
          { label: 'Legal', value: '1,000 ft', note: ceiling >= 1000 ? 'Met' : 'Not met' },
          { label: 'Normal pattern', value: '1,500 ft', note: ceiling >= 1500 ? 'Met' : 'Not met' },
          { label: 'Yours', value: `${fmt(ctx.minimums.ceilingFt)} ft`, note: ceiling >= ctx.minimums.ceilingFt ? 'Met' : 'Not met' },
          { label: 'Today', value: `${fmt(ceiling)} ft` },
        ],
      },
      decision('d1', 'Pattern work or not?',
        `${fmt(ceiling)} broken, 8 miles, light wind. No forecast for the field.`,
        brief,
        {
          go: 'Go. It is legal VFR and it is only the pattern.',
          'go-plan': 'Go, but fly a lower pattern to stay clear of the clouds.',
          delay: 'Wait for it to lift.',
          cancel: 'Not today.',
        },
        { go: 'unsafe', 'go-plan': 'marginal', cancel: 'best' },
        {
          go: 'Legal is not the question your minimum asks. On the crosswind leg the bases are ragged and lower than reported; you are in and out of wisps at pattern altitude.',
          'go-plan': 'A low pattern trades cloud clearance for obstacle and traffic margin, and everyone else is flying the published one. It is how a small problem becomes a big one.',
          delay: 'Fine, as long as "lift" means a report back above your minimum, not a hopeful look at the sky.',
          cancel: 'The clean call. You set that number for a day like this one.',
        },
        `${fmt(ceiling)} feet is under your ${fmt(ctx.minimums.ceilingFt)} foot minimum.`,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 2.5

const spread: Lesson = {
  id: '2.5', module: 2, minutes: 18,
  title: 'When the spread closes',
  summary: 'Fly an evening flight with a narrow temperature and dew point spread, and make the call when the field goes down behind you.',
  acs: ['PA.I.C', 'PA.IX.A'],
  refs: ['Aviation Weather Handbook (FAA-H-8083-28), fog', '14 CFR 91.155 and 91.157, special VFR'],
  build(ctx) {
    const f = ctx.airport;
    const rwy = mainRunway(f);
    // An evening flight whatever time the pilot opens the lesson.
    const dep = nextLocalHour(ctx.now, 17);
    const obs = observedAt(addHours(dep, -1));
    const fm = addHours(dep, 3);
    const validFrom = wholeHourAfter(addHours(obs, -1), 1);
    const lightTrue = windAcross(f, rwy.headingMag, 10);

    const raw = metarText({
      station: f.icao, at: obs, wind: { dirTrue: lightTrue, speedKt: 4 }, vis: '10SM', sky: [],
      tempC: 12, dewC: 10, altimeter: 30.18,
    });
    const rawTaf = [
      'TAF', f.icao, zTime(addHours(validFrom, -0.67)), `${zDayHour(validFrom)}/${zDayHour(addHours(validFrom, 24))}`,
      windGroup({ dirTrue: lightTrue, speedKt: 4 }), 'P6SM', 'SKC',
      `FM${zDayHour(fm)}00`, '00000KT', '4SM', 'BR', cloud('BKN', 1500),
    ].join(' ');
    const special = metarText({
      station: f.icao, at: addHours(dep, 0.7), speci: true, wind: { dirTrue: null, speedKt: 0 }, vis: '2SM', weather: ['BR'],
      sky: [cloud('BKN', 700), cloud('OVC', 1200)], tempC: 10, dewC: 10, altimeter: 30.19,
    }).replace('VRB00KT', '00000KT');
    const metar = parseMetar(raw);
    const taf = parseTaf(rawTaf);
    const brief = buildBrief({ airport: f, aircraft: ctx.aircraft, wb: null, minimums: ctx.minimums, metar, taf, departure: dep, tripHours: 1.5 });

    return [
      {
        kind: 'brief', id: 'b1', title: 'A still evening',
        scene: `An hour and a half of sightseeing before sunset, off at ${hhmmZ(dep)}. Clear sky, almost no wind.`,
        say: {
          full: 'Look at the temperature group before you look at the sky. When the temperature and dew point are within about **3°C**, the air is close to saturated. On a still evening, as the ground cools, that gap closes, and **fog or low cloud can form faster than any forecast says**. The TAF can be right about the trend and wrong about the hour.',
          short: 'Spread within 3°C on a still evening: watch it.',
        },
        figure: { kind: 'metar', raw, marks: ['12/10'] },
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'What is the temperature and dew point spread, and when does the TAF bring the mist in?',
        figure: { kind: 'taf', raw: rawTaf, departure: dep, returnAt: addHours(dep, 1.5) },
        blanks: [
          { id: 'spread', label: 'Spread', unit: '°C', answer: 2, tolerance: 0, explain: '12 minus 10: a 2 degree spread.' },
          { id: 'fm', label: 'Mist forecast from', unit: 'Z (hour)', answer: fm.getUTCHours(), tolerance: 0,
            explain: `FM${zDayHour(fm)}00 brings 4 miles in mist and a broken layer at 1,500 feet.` },
        ],
      },
      decision('d1', 'Before engine start',
        `Clear, light wind, a 2 degree spread. The TAF has mist ${hhmmZ(fm)}, an hour and a half after you plan to be back.`,
        brief,
        {
          go: 'Go as planned.',
          'go-plan': 'Go, stay within 15 minutes of the field, pick an inland alternate, and turn back at the first sign of mist.',
          delay: 'Wait and watch the next report.',
          cancel: 'Cancel. Fog is coming.',
        },
        { 'go-plan': 'best' },
        {
          go: 'You go with no plan for the one thing the report was warning about.',
          'go-plan': 'You go, staying close, with an alternate picked that sits higher and inland.',
          delay: 'Reasonable, but nothing on the next report will tell you more than this one did.',
          cancel: 'Safe. The flight was fine with a plan, though, and that plan is the skill.',
        },
        'Legal and inside your minimums, with one thing to watch.',
      ),
      {
        kind: 'brief', id: 'b2', title: 'Forty minutes later',
        showIf: { step: 'd1', choices: ['go', 'go-plan'] },
        scene: 'Twenty minutes from home, the sun on the horizon. You tune the field\'s weather and hear a special report.',
        say: {
          full: 'A **SPECI** is an unscheduled report, issued because something changed enough to matter. Here the spread has closed to zero and the field has gone to **2 miles in mist with a 700 foot ceiling**, almost two hours before the TAF said.',
          short: 'A SPECI means something changed. Read it all.',
        },
        figure: { kind: 'metar', raw: special, marks: ['2SM', cloud('BKN', 700), '10/10'] },
      },
      {
        kind: 'brief', id: 'b3', title: 'What happened while you waited',
        showIf: { step: 'd1', choices: ['delay', 'cancel'] },
        scene: 'You stayed on the ground. Here is the special report forty minutes after your planned departure.',
        say: {
          full: 'The field went to **2 miles in mist with a 700 foot ceiling**, almost two hours before the TAF said. Now picture yourself twenty minutes out when this comes over the radio. That is the decision this lesson is about.',
          short: 'Picture yourself twenty minutes out.',
        },
        figure: { kind: 'metar', raw: special, marks: ['2SM', cloud('BKN', 700), '10/10'] },
      },
      {
        kind: 'decide', id: 'd2', title: 'Twenty minutes out',
        situation: `Home is ${fmt(700)} overcast-broken and 2 miles. Your inland alternate, fifteen minutes away and higher, reports clear and 10. Sunset is in ten minutes.`,
        options: [
          { id: 'go', label: 'Continue home and get in under it.' },
          { id: 'go-plan', label: 'Divert to the alternate now.' },
          { id: 'delay', label: 'Hold nearby and wait for it to lift.' },
          { id: 'cancel', label: 'Ask the tower for a special VFR clearance home.' },
        ],
        grades: { go: 'unsafe', 'go-plan': 'best', delay: 'marginal', cancel: 'marginal' },
        consequence: {
          go: 'Under a 700 foot ceiling you can\'t fly a legal VFR pattern in the surface area, and in the dark the mist and the ground look the same. This is how VFR-into-IMC accidents start.',
          'go-plan': 'You land at the alternate in the last of the light, tie down, and call for a ride. The airplane comes home tomorrow morning.',
          delay: 'Mist after sunset tends to get worse, not better, and every lap of holding is fuel you will want later.',
          cancel: 'Special VFR needs 1 mile and clear of clouds, and at night it also needs an instrument rating and an IFR-equipped airplane (91.157). Ten minutes from sunset, you\'re about to lose it.',
        },
        why: 'The field is below basic VFR minimums, the light is going, and you have an alternate in good weather. Picking that alternate before takeoff is what made this decision easy.',
      },
    ];
  },
};

export const weatherLessons: Lesson[] = [readMetar, windOnRunway, tafReturn, ceilings, spread];
