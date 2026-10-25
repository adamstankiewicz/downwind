// Dials: the lesson's conditions as controls. Each builder returns the dials,
// an `evaluate` that re-runs the engine for any setting, and a task the pilot
// answers by setting the dials. Every readout, line and grade comes from the
// same engine as the rest of the lesson (scenarios/goNoGo, lib/perf), so the
// numbers stay honest however far the pilot turns them. The words are written
// here once per line, and only ever interpolate engine values.

import { buildBrief, runwayWind, type Brief, type ChoiceId, type Finding, type Grade, type Severity } from '../scenarios/goNoGo';
import { parseMetar, type Metar } from '../lib/metar';
import { norm } from '../lib/wind';
import { takeoffDistance, type DistanceResult, type Performance } from '../lib/perf';
import { cloud, mainRunway, metarText, observedAt, windAcross } from './practice';
import { runwayGrade, RUNWAY_MARGIN } from './airplane';
import type { Dial, DialLine, DialReadout, DialState, DialTask, DialValues, LessonContext, Option, Step } from './types';

export type DialsStep = Extract<Step, { kind: 'dials' }>;
type DialsParts = Pick<DialsStep, 'dials' | 'evaluate' | 'task'>;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const deg = (n: number) => String(Math.round(norm(n)) || 360).padStart(3, '0');
const RANK: Severity[] = ['illegal', 'limit', 'personal', 'caution', 'info'];
const bySeverity = (a: DialLine, b: DialLine) => RANK.indexOf(a.severity) - RANK.indexOf(b.severity);

/** The four weather choices, short enough to sit under the dials. */
export const WEATHER_VERDICT: Option[] = [
  { id: 'go', label: 'Go' },
  { id: 'go-plan', label: 'Go with a plan' },
  { id: 'delay', label: 'Wait' },
  { id: 'cancel', label: 'Cancel' },
];

function brief(ctx: LessonContext, metar: Metar): Brief {
  return buildBrief({ airport: ctx.airport, aircraft: ctx.aircraft, wb: null, minimums: ctx.minimums, metar, taf: null, departure: ctx.now, tripHours: 1.5 });
}

/** A finding the dials care about, turned into the instructor's line. */
function line(f: Finding, say: string): DialLine {
  return { id: f.id, severity: f.severity, title: f.title, say };
}

// ---------------------------------------------------------------- wind

export interface WindSetting {
  dirTrue: number;
  speedKt: number;
  /** Zero, or anything at or below the steady speed, means no gust. */
  gustKt: number;
}

export function windMetar(ctx: LessonContext, w: WindSetting): string {
  const gust = w.gustKt > w.speedKt ? w.gustKt : null;
  return metarText({
    station: ctx.airport.icao, at: observedAt(ctx.now), wind: { dirTrue: w.dirTrue, speedKt: w.speedKt, gustKt: gust }, vis: '10SM',
    sky: [cloud('SCT', 5000)], tempC: 16, dewC: 6, altimeter: 29.98,
  });
}

/**
 * The highest gust, in whole knots up to `cap`, that keeps the gust crosswind
 * on the best runway within the pilot's minimum. Null when the steady wind is
 * already over it; `cap` when no gust on the dial gets there.
 */
export function maxGustWithin(ctx: LessonContext, dirTrue: number, speedKt: number, cap: number): number | null {
  const min = ctx.minimums.crosswindKt;
  const steady = runwayWind(ctx.airport, { dirTrue, speedKt, gustKt: null, variable: false, rangeTrue: null });
  if (!steady?.steady || steady.steady.crosswindKt > min) return null;
  let best = speedKt;
  for (let g = speedKt + 1; g <= cap; g++) {
    const rw = runwayWind(ctx.airport, { dirTrue, speedKt, gustKt: g, variable: false, rangeTrue: null });
    if ((rw?.gust?.crosswindKt ?? 0) <= min) best = g;
    else break;
  }
  return best;
}

export function windDials(ctx: LessonContext, start: WindSetting): DialsParts {
  const f = ctx.airport;
  const mins = ctx.minimums;
  const planned = mainRunway(f);
  const demo = ctx.aircraft.demonstratedCrosswindKt;
  const GUST_MAX = 40;
  const dials: Dial[] = [
    { id: 'dir', label: 'Wind from, true', unit: '°', min: 10, max: 360, step: 10, initial: start.dirTrue, format: (v) => `${deg(v)}°` },
    { id: 'speed', label: 'Steady wind', unit: 'kt', min: 3, max: 30, step: 1, initial: start.speedKt },
    { id: 'gust', label: 'Gusts to', unit: 'kt', min: 0, max: GUST_MAX, step: 1, initial: start.gustKt, format: (v) => (v > 0 ? `${v} kt` : 'none') },
  ];
  const setting = (v: DialValues): WindSetting => ({ dirTrue: v.dir, speedKt: v.speed, gustKt: v.gust });

  const evaluate = (v: DialValues): DialState => {
    const w = setting(v);
    const raw = windMetar(ctx, w);
    const metar = parseMetar(raw);
    const b = brief(ctx, metar);
    const rw = b.facts.runwayWind!;
    const steady = rw.steady!;
    const gust = rw.gust;
    const worst = gust?.crosswindKt ?? steady.crosswindKt;
    const side = steady.from === 'none' ? '' : ` from the ${steady.from}`;
    const readouts: DialReadout[] = [
      { id: 'mag', label: 'Magnetic', value: `${deg(rw.windMag!)}°` },
      { id: 'runway', label: 'Best runway', value: rw.runway.id, tone: rw.runway.id !== planned.id ? 'near' : undefined },
      { id: 'angle', label: 'Off the runway', value: `${steady.angleDeg}°` },
      { id: 'xw', label: 'Crosswind', value: `${Math.round(steady.crosswindKt)} kt`, tone: steady.crosswindKt > mins.crosswindKt ? 'over' : undefined },
      { id: 'xwg', label: 'In gusts', value: gust ? `${Math.round(gust.crosswindKt)} kt` : 'no gust', tone: gust && gust.crosswindKt > mins.crosswindKt ? 'over' : undefined },
      steady.headwindKt >= 0
        ? { id: 'head', label: 'Headwind', value: `${Math.round(steady.headwindKt)} kt` }
        : { id: 'head', label: 'Tailwind', value: `${Math.round(-steady.headwindKt)} kt`, tone: 'over' },
    ];

    const lines: DialLine[] = [];
    for (const x of b.findings) {
      if (x.id === 'xw-personal') {
        lines.push(line(x, `${Math.round(worst)} knots across runway ${rw.runway.id}${gust ? ' in the gusts' : ''}, against your ${mins.crosswindKt}. You drew that line on a calm day for exactly this moment, and it is the gust that arrives in the flare.`));
      } else if (x.id === 'xw-demo') {
        lines.push(line(x, `That is past the airplane's demonstrated ${demo} knots. It isn't a legal limit, but nobody tested the airplane beyond it, so on this landing you would be the test pilot.`));
      } else if (x.id === 'gust-spread') {
        lines.push(line(x, `The gust is ${w.gustKt - w.speedKt} knots over the steady wind, past your ${mins.gustSpreadKt}. A spread like that is what makes a landing go from busy to out of hand: the airspeed jumps and drops in the flare. If you fly it at all, add half the gust factor to your approach speed and expect to work.`));
      } else if (x.id === 'tailwind') {
        lines.push(line(x, `Even runway ${rw.runway.id}, the best one, has ${Math.abs(Math.round(steady.headwindKt))} knots behind you. Groundspeed at touchdown goes up by the same amount and the roll gets long.`));
      }
    }
    if (rw.runway.id !== planned.id) {
      lines.push({
        id: 'runway-flip', severity: 'caution', title: `The wind favors runway ${rw.runway.id} now`,
        say: `The wind has swung past the beam of ${planned.id}, so the into-wind end is ${rw.runway.id}. If the tower or the traffic is still using ${planned.id}, ask for ${rw.runway.id}. "Unable" is a complete answer when the alternative is a tailwind landing.`,
      });
    }
    lines.sort(bySeverity);

    return {
      figures: [
        { kind: 'wind', airport: f, windMag: rw.windMag!, speedKt: w.speedKt, gustKt: w.gustKt > w.speedKt ? w.gustKt : null, runwayId: rw.runway.id },
        { kind: 'metar', raw, turned: true },
      ],
      readouts,
      lines,
      clear: `${Math.round(steady.crosswindKt)} knots across runway ${rw.runway.id}${side}${gust ? `, ${Math.round(gust.crosswindKt)} in the gusts` : ''}, inside your ${mins.crosswindKt}. This one is yours to fly. Aileron into the wind from the moment you start the roll, and more of it as you slow down.`,
      verdict: { options: WEATHER_VERDICT, grades: b.grades },
    };
  };

  const task: DialTask = {
    prompt: `Leave the direction and the steady wind where they are. Turn the gust dial to the strongest gust that still keeps the crosswind within your ${mins.crosswindKt} knot minimum.`,
    check(v) {
      const target = maxGustWithin(ctx, v.dir, v.speed, GUST_MAX);
      const setGust = v.gust > v.speed ? v.gust : v.speed;
      if (target === null) {
        return { right: false, explain: `At ${deg(v.dir)}° and ${v.speed} knots the steady wind alone is already over your ${mins.crosswindKt}, so no gust is acceptable. Turn the direction or the steady wind back toward the report and try again.` };
      }
      const rw = runwayWind(f, { dirTrue: v.dir, speedKt: v.speed, gustKt: target > v.speed ? target : null, variable: false, rangeTrue: null })!;
      const angle = rw.steady!.angleDeg;
      if (target >= GUST_MAX) {
        return { right: setGust >= GUST_MAX, explain: `At ${angle}° off runway ${rw.runway.id} even a ${GUST_MAX} knot gust stays inside your minimum. The wind is nearly down the runway, which is why the angle matters more than the speed.` };
      }
      const over = runwayWind(f, { dirTrue: v.dir, speedKt: v.speed, gustKt: target + 1, variable: false, rangeTrue: null })!;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      const explain = target > v.speed
        ? `At ${angle}° off runway ${rw.runway.id}, a gust to ${target} gives ${r1(rw.gust!.crosswindKt)} knots across and ${target + 1} gives ${r1(over.gust!.crosswindKt)}. So ${target} knots is your line for this wind. Know it before the ATIS tells you the number.`
        : `At ${angle}° off runway ${rw.runway.id} the steady ${v.speed} knots is already ${r1(rw.steady!.crosswindKt)} across, and a gust to ${target + 1} makes it ${r1(over.gust!.crosswindKt)}. Any gust at all puts you over, so your line for this wind is no gust.`;
      return { right: setGust === target, explain };
    },
  };

  return { dials, evaluate, task };
}

/** The lesson's wind as a setting: a gust just over the pilot's line, 40° off the planned runway. */
export function lessonWind(ctx: LessonContext, gustKt: number, speedKt: number): WindSetting {
  const rwy = mainRunway(ctx.airport);
  return { dirTrue: windAcross(ctx.airport, rwy.headingMag, 40), speedKt, gustKt };
}

// ---------------------------------------------------------------- ceiling

/** A normal pattern is 1,000 ft above the field and keeps 500 ft below the cloud. */
export const PATTERN_FT_AGL = 1000;
export const CLOUD_CLEARANCE_FT = 500;

export function ceilingMetar(ctx: LessonContext, ceilingFt: number, visSm: number): string {
  const rwy = mainRunway(ctx.airport);
  return metarText({
    station: ctx.airport.icao, at: observedAt(ctx.now), wind: { dirTrue: windAcross(ctx.airport, rwy.headingMag, 10), speedKt: 6 }, vis: `${visSm}SM`,
    sky: [cloud('BKN', ceilingFt), cloud('OVC', ceilingFt + 1500)], tempC: 12, dewC: 6, altimeter: 30.12,
  });
}

/**
 * Go/no-go grades for a pattern flight. The engine's grades stand; a ceiling
 * that is legal but too low to keep the pattern 500 ft below the cloud is a
 * caution when nothing worse is in play, the same as any other caution.
 */
export function patternGrades(b: Brief, ceilingFt: number | null): Record<ChoiceId, Grade> {
  const squeezed = ceilingFt !== null && ceilingFt >= 1000 && ceilingFt < PATTERN_FT_AGL + CLOUD_CLEARANCE_FT;
  const worse = b.findings.some((x) => x.severity === 'illegal' || x.severity === 'limit' || x.severity === 'personal');
  if (squeezed && !worse) return { go: 'marginal', 'go-plan': 'marginal', delay: 'best', cancel: 'acceptable' };
  return b.grades;
}

/** The lowest ceiling on the dial at which going is graded acceptable or better, at this visibility. */
export function lowestGoCeiling(ctx: LessonContext, visSm: number, dial: { min: number; max: number; step: number }): number | null {
  for (let c = dial.min; c <= dial.max; c += dial.step) {
    const b = brief(ctx, parseMetar(ceilingMetar(ctx, c, visSm)));
    const g = patternGrades(b, c).go;
    if (g === 'best' || g === 'acceptable') return c;
  }
  return null;
}

export function ceilingDials(ctx: LessonContext, start: { ceilingFt: number; visSm: number }): DialsParts {
  const f = ctx.airport;
  const mins = ctx.minimums;
  const surface = f.airspace !== 'G';
  const C = { min: 300, max: 5000, step: 100 };
  const dials: Dial[] = [
    {
      id: 'ceiling', label: 'Ceiling', unit: 'ft', ...C, initial: start.ceilingFt, format: (v) => `${fmt(v)} ft`,
      marks: [
        ...(surface ? [{ at: 1000, label: 'Legal', kind: 'legal' as const }] : []),
        { at: PATTERN_FT_AGL + CLOUD_CLEARANCE_FT, label: 'Pattern', kind: 'airplane' as const },
        { at: Math.min(C.max, mins.ceilingFt), label: 'Yours', kind: 'personal' as const },
      ],
    },
    {
      id: 'vis', label: 'Visibility', unit: 'SM', min: 1, max: 10, step: 1, initial: start.visSm, format: (v) => `${v} SM`,
      marks: [
        ...(surface ? [{ at: 3, label: 'Legal', kind: 'legal' as const }] : []),
        { at: Math.min(10, mins.visibilitySm), label: 'Yours', kind: 'personal' as const },
      ],
    },
  ];

  const evaluate = (v: DialValues): DialState => {
    const raw = ceilingMetar(ctx, v.ceiling, v.vis);
    const metar = parseMetar(raw);
    const b = brief(ctx, metar);
    const ceil = metar.ceilingFtAgl!;
    const below = ceil - PATTERN_FT_AGL;
    const legal = !b.findings.some((x) => x.severity === 'illegal');
    const readouts: DialReadout[] = [
      { id: 'ceiling', label: 'Ceiling', value: `${fmt(ceil)} ft`, tone: ceil < mins.ceilingFt ? 'over' : undefined },
      { id: 'vis', label: 'Visibility', value: `${metar.visibilitySm} SM`, tone: (metar.visibilitySm ?? 0) < mins.visibilitySm ? 'over' : undefined },
      { id: 'cat', label: 'Category', value: metar.category ?? 'none' },
      { id: 'legal', label: surface ? 'Legal VFR here' : 'Class G', value: legal ? 'Yes' : 'No', tone: legal ? undefined : 'over' },
      { id: 'clear', label: 'Pattern to cloud', value: below > 0 ? `${fmt(below)} ft` : 'in it', tone: below < CLOUD_CLEARANCE_FT ? 'over' : undefined },
    ];

    const lines: DialLine[] = [];
    for (const x of b.findings) {
      if (x.id === 'vfr-ceiling') {
        lines.push(line(x, `Under 1,000 feet it stops being your decision. Inside the ${f.icao} surface area you need 1,000 and 3 for VFR, so without a special VFR clearance there is no "go with a plan" left to pick.`));
      } else if (x.id === 'vfr-vis') {
        lines.push(line(x, `${metar.visibilitySm} miles is under the 3 you need in the surface area. The ceiling can look fine from the ramp while the haze takes the far end of the pattern away.`));
      } else if (x.id === 'ceiling-personal') {
        lines.push(line(x, `Legal, but ${fmt(mins.ceilingFt - ceil)} feet under your own ${fmt(mins.ceilingFt)}. Notice where your line sits on the dial: well above the legal one. The space between them is the margin you chose to keep.`));
      } else if (x.id === 'vis-personal') {
        lines.push(line(x, `${metar.visibilitySm} miles is legal and under your ${mins.visibilitySm}. Low visibility shrinks the time you have to spot traffic in the pattern, and that is the reason you set the number.`));
      }
    }
    if (ceil >= 1000 && below < CLOUD_CLEARANCE_FT) {
      lines.push({
        id: 'pattern-squeeze', severity: 'caution', title: 'Too low for a normal pattern',
        say: `A pattern at ${fmt(PATTERN_FT_AGL)} feet leaves ${below > 0 ? `only ${fmt(below)}` : 'no room'} below this ceiling, and you want ${CLOUD_CLEARANCE_FT}. You'd fly the pattern low, or in the bases, while everyone else flies the published one. Reported bases are often lower on the far side of the field, too.`,
      });
    }
    lines.sort(bySeverity);

    return {
      figures: [
        { kind: 'sky', airport: f, ceilingFtAgl: ceil, visibilitySm: metar.visibilitySm ?? v.vis, patternFtAgl: PATTERN_FT_AGL, legalCeilingFt: surface ? 1000 : null, personalCeilingFt: mins.ceilingFt },
        { kind: 'metar', raw, turned: true },
      ],
      readouts,
      lines,
      clear: `${fmt(ceil)} feet and ${metar.visibilitySm} miles: legal, a full pattern with ${fmt(below)} feet to the cloud, and inside your own numbers. Nothing on this report binds.`,
      verdict: { options: WEATHER_VERDICT, grades: patternGrades(b, ceil) },
    };
  };

  const task: DialTask = {
    prompt: 'Keep the visibility where it is. Turn the ceiling to the lowest report you would fly this pattern under.',
    check(v) {
      const target = lowestGoCeiling(ctx, v.vis, C);
      if (target === null) {
        return { right: false, explain: `At ${v.vis} miles no ceiling makes this a go: the visibility is holding it down. Turn the visibility up past ${Math.max(surface ? 3 : 1, mins.visibilitySm)} and try again.` };
      }
      const pattern = PATTERN_FT_AGL + CLOUD_CLEARANCE_FT;
      const bind = target === pattern && mins.ceilingFt <= pattern ? `the pattern plus ${CLOUD_CLEARANCE_FT} feet of cloud clearance` : 'your own minimum';
      return {
        right: v.ceiling === target,
        explain: `${fmt(target)} feet, and the line that binds is ${bind}. ${surface ? 'The legal 1,000 is the floor, the' : 'The'} pattern needs ${fmt(pattern)}, and yours is ${fmt(mins.ceilingFt)}. The highest of them is the one you fly by.`,
      };
    },
  };

  return { dials, evaluate, task };
}

// ---------------------------------------------------------------- takeoff

export interface StripSetup {
  perf: Performance;
  fieldElevFt: number;
  runwayFt: number;
  surface: 'paved' | 'grass';
  sample: boolean;
}

function stripDistance(s: StripSetup, oatC: number, headwindKt: number): DistanceResult {
  return takeoffDistance(s.perf, { fieldElevFt: s.fieldElevFt, altimeterInHg: 29.92, oatC, headwindKt, surface: s.surface });
}

/** The warmest whole degree on the dial at which the strip still gives the margin, in calm wind. */
export function warmestWithMargin(s: StripSetup, dial: { min: number; max: number }): number | null {
  let best: number | null = null;
  for (let t = dial.min; t <= dial.max; t++) {
    if (runwayGrade(stripDistance(s, t, 0).over50Ft, s.runwayFt) === 'best') best = t;
    else break;
  }
  return best;
}

export function takeoffDials(s: StripSetup, start: { oatC: number; headwindKt: number }): DialsParts {
  // The temperature dial spans the chart, so every setting has a reading.
  const temps = s.perf.takeoff.over50.tempsC;
  const T = { min: temps[0], max: temps[temps.length - 1] };
  const dials: Dial[] = [
    { id: 'oat', label: 'Temperature', unit: '°C', ...T, step: 1, initial: Math.min(T.max, Math.max(T.min, start.oatC)), format: (v) => `${v}°C` },
    {
      id: 'wind', label: 'Wind on the nose', unit: 'kt', min: -5, max: 15, step: 1, initial: start.headwindKt,
      format: (v) => (v === 0 ? 'calm' : v > 0 ? `${v} kt head` : `${-v} kt tail`),
      marks: [{ at: 0, label: 'Calm', kind: 'airplane' }],
    },
  ];

  const evaluate = (v: DialValues): DialState => {
    const d = stripDistance(s, v.oat, v.wind);
    const want = Math.round((d.over50Ft * RUNWAY_MARGIN) / 5) * 5;
    const grade = runwayGrade(d.over50Ft, s.runwayFt);
    const readouts: DialReadout[] = [
      { id: 'da', label: 'Density altitude', value: `${fmt(d.densityAltFt)} ft` },
      { id: 'roll', label: 'Ground roll', value: `${fmt(d.groundRollFt)} ft` },
      { id: 'over50', label: 'Over 50 ft', value: `${fmt(d.over50Ft)} ft`, tone: grade === 'unsafe' ? 'over' : undefined },
      { id: 'want', label: 'With half again', value: `${fmt(want)} ft`, tone: grade === 'best' ? undefined : grade === 'unsafe' ? 'over' : 'near' },
      { id: 'runway', label: 'Runway', value: `${fmt(s.runwayFt)} ft` },
    ];
    const lines: DialLine[] = [];
    if (d.offChart) {
      lines.push({ id: 'off-chart', severity: 'limit', title: 'Off the edge of the chart',
        say: 'These conditions are past the edge of the chart, so the number shown is the edge, not an answer. When the book runs out, so does the takeoff.' });
    }
    if (grade === 'unsafe') {
      lines.push({ id: 'over-runway', severity: 'limit', title: 'The book does not clear the trees',
        say: `The book needs ${fmt(d.over50Ft)} feet to clear 50 feet, and the strip is ${fmt(s.runwayFt)}. There is no technique that makes up ${fmt(d.over50Ft - s.runwayFt)} feet.` });
    } else if (grade === 'marginal') {
      lines.push({ id: 'under-margin', severity: 'personal', title: 'Inside the runway, outside the margin',
        say: `The book clears the trees with ${fmt(s.runwayFt - d.over50Ft)} feet to spare, and you'd want ${fmt(want)} feet of strip. That spare is all there is for a soft spot, a tired engine or a technique that isn't perfect.` });
    }
    if (v.wind < 0) {
      lines.push({ id: 'tailwind', severity: 'caution', title: 'Tailwind',
        say: `${-v.wind} knots behind you costs far more than the same headwind saves; the notes charge for it in small steps. Take off the other way, or wait for it to swing.` });
    }
    lines.sort(bySeverity);
    return {
      figures: [{ kind: 'perf', chart: 'takeoff-50', performance: s.perf, paFt: d.pressureAltFt, oatC: v.oat, sample: s.sample }],
      readouts,
      lines,
      clear: `${fmt(d.over50Ft)} feet to clear the trees, and ${fmt(want)} with half again, inside ${fmt(s.runwayFt)} feet of strip. The numbers are happy with this one.`,
      verdict: { options: [{ id: 'go', label: 'Take off at this setting' }], grades: { go: grade } },
    };
  };

  const task: DialTask = {
    prompt: 'In calm wind, what is the warmest it can get with this strip still giving you half again? Set the temperature dial there.',
    check(v) {
      const target = warmestWithMargin(s, T);
      if (target === null) return { right: false, explain: 'Even the coldest air on the dial does not give half again on this strip.' };
      const at = stripDistance(s, target, 0);
      const next = stripDistance(s, target + 1, 0);
      return {
        right: v.oat === target,
        explain: `${target}°C. In calm air that needs ${fmt(at.over50Ft)} feet over the trees, ${fmt(at.over50Ft * RUNWAY_MARGIN)} with half again, against ${fmt(s.runwayFt)}. One degree warmer it needs ${fmt(next.over50Ft * RUNWAY_MARGIN)}. That temperature is the number to watch on the forecast, not the clock.`,
      };
    },
  };

  return { dials, evaluate, task };
}

/** The values a step starts at. */
export function initialValues(step: DialsStep): DialValues {
  return Object.fromEntries(step.dials.map((d) => [d.id, d.initial]));
}
