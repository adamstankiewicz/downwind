// Module 4, Airspace and the chart: five flights on the practice sectional
// (chart/practiceRegion.ts). Real sectionals can't ship with the app, so
// every lesson reads and flies the same made-up country around KXYZ and says
// so; where the pilot has a home field, the brief points back to it. Each
// decision option is a plan (a path, altitudes and what the controller said),
// and scenarios/airspacePlan.ts grades it against the airspace it crosses.

import { maxElevationFigure, practiceRegion as R, withVolumes, type ChartAirport, type Checkpoint } from '../chart/practiceRegion';
import { limitMsl, positionAt, type AirspaceClass, type Volume } from '../lib/airspace';
import { destination, distanceNm, trueCourse, type LatLon } from '../lib/nav';
import { trueToMagnetic } from '../lib/wind';
import { checkPlan, gradePlans, replyPermits, samplePlan, type GradeOptions, type Plan, type PlanCheck } from '../scenarios/airspacePlan';
import type { Figure, Lesson, LessonContext, Step } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pad3 = (n: number) => String(Math.round(n) % 360 || 360).padStart(3, '0');
const nm1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');

const airport = (id: string): ChartAirport => R.airports.find((a) => a.id === id)!;
const checkpoint = (id: string): Checkpoint => R.checkpoints.find((c) => c.id === id)!;
const volume = (id: string): Volume => R.airspace.find((v) => v.id === id)!;
const ceilingMsl = (v: Volume) => limitMsl(v.ceiling, 0);
const floorMsl = (v: Volume) => limitMsl(v.floor, 0);
const radiusNm = (v: Volume) => (v.shape.kind === 'circle' ? v.shape.radiusNm : v.shape.kind === 'ring' ? v.shape.outerNm : 0);
const along = (a: LatLon, b: LatLon, nm: number) => destination(a, trueCourse(a, b), nm);

/** The call sign the lessons use: the pilot's own tail number, or an obviously made-up one. */
export function callSign(ctx: LessonContext): string {
  return ctx.aircraft.tailNumber.trim().toUpperCase() || 'Practice 345';
}


/** One line tying the practice chart back to the pilot's own field, when there is one. */
function yourField(ctx: LessonContext, cls?: AirspaceClass): string {
  if (ctx.practiceField) return '';
  const f = ctx.airport;
  if (cls && f.airspace === cls) return ` ${f.icao} sits in Class ${cls} too, so this is the airspace you fly out of at home.`;
  return ` Find ${f.icao} on your own sectional afterwards: the same symbols read the same way there.`;
}

interface PlanOption {
  id: string;
  label: string;
  plan: Omit<Plan, 'id'>;
  /** What happened next. A function reads the plan's check, for copy that depends on it. */
  then: string | ((c: PlanCheck) => string);
}

/**
 * A decision whose options are plans. The grade comes from the plan check;
 * the consequence adds the rule that was broken, from the same check, so
 * the copy can't claim a different reason than the grade.
 */
function planDecision(id: string, title: string, situation: string, figure: Figure, options: PlanOption[], active: string[], why: string, o: GradeOptions = {}, extra: Volume[] = [], keepOrder = false): Step {
  const plans = options.map((x) => ({ ...x.plan, id: x.id }));
  const { grades, checks } = gradePlans(withVolumes(R, extra), plans, active, o);
  const consequence: Record<string, string> = {};
  for (const x of options) {
    const c = checks[x.id];
    const then = typeof x.then === 'string' ? x.then : x.then(c);
    const v = c.violations[0];
    consequence[x.id] = v ? `${then} ${v.text} (${v.ref}).` : then;
  }
  return {
    kind: 'decide', id, title, situation, figure,
    options: options.map((x) => ({ id: x.id, label: x.label })),
    grades, consequence, why, keepOrder,
  };
}

/** Which class is overhead at a point and altitude on the practice chart. */
function classAt(p: LatLon, altMsl: number, extra: Volume[] = []) {
  const r = withVolumes(R, extra);
  return positionAt(r.airspace, p, altMsl, r.groundFt(p), r.veils);
}

const CLASS_CHOICES = ['Class B', 'Class C', 'Class D', 'Class E', 'Class G'];

// ---------------------------------------------------------------- 4.1

const chartAroundField: Lesson = {
  id: '4.1', module: 4, minutes: 15,
  title: 'Reading the chart around your field',
  summary: 'Decode an airport data block, the airspace drawn around it, and the maximum elevation figure, then pick a cruising altitude over rising ground.',
  acs: ['PA.I.D', 'PA.I.E'],
  refs: ['PHAK ch. 16', 'PHAK ch. 15', '14 CFR 91.159', '14 CFR 91.119'],
  build(ctx) {
    const home = airport('KXYZ');
    const mill = airport('2X5');
    const lake = checkpoint('long-lake');
    const d = volume('xyz-d');
    const dTop = ceilingMsl(d);
    const millMef = maxElevationFigure(R, { lat: Math.floor(mill.pos.lat * 2) / 2, lon: Math.floor(mill.pos.lon * 2) / 2 }, { lat: Math.floor(mill.pos.lat * 2) / 2 + 0.5, lon: Math.floor(mill.pos.lon * 2) / 2 + 0.5 });
    const overMill = classAt(mill.pos, 2500);
    const tc = Math.round(trueCourse(home.pos, lake.pos));
    const mc = Math.round(trueToMagnetic(tc, R.variationDeg));

    // The highest maximum elevation figure the trip to Long Lake crosses.
    const tripMef = Math.max(...samplePlan({ id: 'x', start: home.pos, startAltMsl: 0, legs: [{ to: lake.pos, altMsl: 0 }], cleared: [], transponder: true }, R.variationDeg)
      .map((s) => {
        const lat = Math.floor(s.pos.lat * 2) / 2;
        const lon = Math.floor(s.pos.lon * 2) / 2;
        return maxElevationFigure(R, { lat, lon }, { lat: lat + 0.5, lon: lon + 0.5 });
      }));
    const westbound = mc >= 180;
    const alts = [2500, 3500, 4500, 5500];
    const trip = (alt: number): Omit<Plan, 'id'> => ({ start: home.pos, startAltMsl: alt, legs: [{ to: lake.pos, altMsl: alt }], cleared: ['xyz-d'], transponder: true });

    return [
      {
        kind: 'brief', id: 'b1', title: 'A chart is a list of facts',
        scene: `Before a sightseeing trip you spread out the sectional around ${home.id}. This module flies a practice sectional, a made-up stretch of country, so the shapes are always the same.${yourField(ctx)}`,
        say: {
          full: 'Every symbol on a sectional is a fact you would otherwise have to look up. The **color** of an airport says whether it has a tower: **blue** is towered, **magenta** is not. The **data block** beside it gives the frequency, elevation and longest runway. The line drawn around it is the airspace, with its **ceiling** printed in brackets. And in the middle of each half-degree square, between the lines of latitude and longitude, is the **maximum elevation figure**, the highest thing in that square plus a little extra. We will read the home field together.',
          short: 'Color says tower or not; the data block, the bracket and the big number in each square say the rest.',
        },
        figure: { kind: 'chart', focus: { id: 'KXYZ', radiusNm: 9 }, highlight: ['KXYZ', 'xyz-d'] },
      },
      {
        kind: 'example', id: 'e1', title: `${home.id}, taken apart`,
        say: {
          full: `Blue, so it has a tower. The dashed blue circle is its **Class D**, ${nm1(radiusNm(d))} nm out, and the [${Math.round(dTop / 100)}] is its ceiling in hundreds of feet **above sea level**, not above the field. Subtract the field elevation to see how tall it really is.`,
          short: `[${Math.round(dTop / 100)}] is ${fmt(dTop)} MSL. Subtract the field.`,
        },
        figure: { kind: 'chart', focus: { id: 'KXYZ', radiusNm: 7 }, highlight: ['KXYZ', 'xyz-d'] },
        work: [
          { label: 'Tower', value: home.freq, note: `ATIS ${home.atis}. ${d.note ?? ''}`.trim() },
          { label: 'Elevation', value: `${fmt(home.elevationFt)} ft`, note: 'Field elevation, MSL' },
          { label: 'Longest runway', value: `${fmt(home.runwayFt)} ft`, note: `Printed as ${Math.round(home.runwayFt / 100)}, in hundreds of feet` },
          { label: 'Class D ceiling', value: `${fmt(dTop)} ft MSL`, note: `${fmt(dTop)} − ${fmt(home.elevationFt)} = ${fmt(dTop - home.elevationFt)} ft above the field` },
          { label: 'Class D radius', value: `${nm1(radiusNm(d))} nm` },
          { label: 'Pattern altitude', value: `${fmt(home.tpaMsl)} ft MSL`, note: `${fmt(home.tpaMsl - home.elevationFt)} ft above the field, from the Chart Supplement` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Now ${mill.name} (${mill.id}), ${Math.round(distanceNm(home.pos, mill.pos))} nm west. Read its data block and the square it sits in.`,
        figure: { kind: 'chart', focus: { id: '2X5', radiusNm: 9 }, highlight: ['2X5'] },
        blanks: [
          { id: 'elev', label: 'Field elevation', unit: 'ft', answer: mill.elevationFt, tolerance: 0, explain: `${mill.name} is ${fmt(mill.elevationFt)} ft above sea level.` },
          { id: 'freq', label: 'Frequency to use', answer: mill.freq, choices: [mill.freq, home.freq, airport('KXRB').freq],
            explain: `Magenta means no tower, so you self-announce on the CTAF, ${mill.freq}.` },
          { id: 'tpa', label: 'Pattern height above the field', unit: 'ft', answer: mill.tpaMsl - mill.elevationFt, tolerance: 0,
            explain: `Pattern altitude ${fmt(mill.tpaMsl)} MSL minus ${fmt(mill.elevationFt)}: ${fmt(mill.tpaMsl - mill.elevationFt)} ft.` },
          { id: 'mef', label: 'Maximum elevation figure in that square', unit: 'ft', answer: millMef, tolerance: 0,
            explain: `The big number in the square is ${Math.floor(millMef / 1000)} and the small one ${Math.round((millMef % 1000) / 100)}: ${fmt(millMef)} ft MSL. It covers the highest terrain or obstacle in the square, with a margin.` },
          { id: 'cls', label: 'Over the field at 2,500 MSL you are in', answer: `Class ${overMill.cls}`, choices: CLASS_CHOICES,
            explain: overMill.cls === 'G'
              ? `Nothing is drawn around ${mill.id}, and 2,500 MSL is less than 1,200 ft above the ground there, so it is Class G.`
              : `Nothing is drawn around ${mill.id}, but 2,500 MSL is more than 1,200 ft above the ground there, so it is Class ${overMill.cls}.` },
        ],
      },
      planDecision('d1', 'How high to Long Lake?',
        `Long Lake is ${Math.round(distanceNm(home.pos, lake.pos))} nm away, true course ${pad3(tc)}, magnetic ${pad3(mc)}: ${westbound ? 'westbound' : 'eastbound'}. The squares you cross have maximum elevation figures up to ${fmt(tripMef)} ft.`,
        { kind: 'chart', route: ['KXYZ', 'long-lake'], highlight: ['KXYZ', 'long-lake', 'tower-1749'] },
        alts.map((alt) => ({
          id: `alt-${alt}`,
          label: `${fmt(alt)} ft`,
          plan: trip(alt),
          then: (c) => c.violations.some((v) => v.id === 'hemispheric')
            ? `High enough, but ${fmt(alt)} is an ${westbound ? 'eastbound' : 'westbound'} altitude, and over most of this route you are more than 3,000 ft above the ground. Opposite-direction traffic is flying it.`
            : c.mefMarginFt < 0
              ? `Over the hills near the lake you are ${fmt(-c.mefMarginFt)} ft below the highest figure on your route. Legal where the ground is low, with no margin for a tower you missed.`
              : c.mefMarginFt < 1000
                ? `Clear of everything charted, but only ${fmt(c.mefMarginFt)} ft over the highest square.`
                : `${fmt(c.mefMarginFt)} ft over the highest square, and a legal cruising altitude for a ${westbound ? 'westbound' : 'eastbound'} course.`,
        })),
        [],
        `Two checks pick the altitude. Stay at least 1,000 ft above the highest maximum elevation figure on the route, and once you are more than 3,000 ft above the ground, fly ${westbound ? 'even' : 'odd'} thousands plus 500 on a magnetic course of ${pad3(mc)} (91.159).`,
        { mef: true },
        [],
        true,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 4.2

const classD: Lesson = {
  id: '4.2', module: 4, minutes: 14,
  title: 'The Class D next door',
  summary: 'Know when radio contact with a tower is established, and what to do when it isn\'t yet.',
  acs: ['PA.I.E', 'PA.III.A'],
  refs: ['14 CFR 91.129', 'AIM 3-2-5', 'PHAK ch. 15'],
  build(ctx) {
    const home = airport('KXYZ');
    const mill = airport('2X5');
    const plant = checkpoint('plant');
    const d = volume('xyz-d');
    const dTop = ceilingMsl(d);
    const r = radiusNm(d);
    const sign = callSign(ctx);
    const cruise = Math.floor(dTop / 1000) * 1000;
    const tower = `${home.name} Tower`;
    // The practice area: 8 nm past the field on the line from Mill Pond toward the plant.
    const area = along(mill.pos, plant.pos, distanceNm(mill.pos, home.pos) + 8);
    const goodReply = `${sign}, stand by.`;
    const badReply = `Aircraft calling ${tower}, stand by.`;
    // The decision happens 2.5 nm outside the Class D, on the way to the practice area.
    const toBoundary = distanceNm(mill.pos, home.pos) - r - 2.5;
    const here = along(mill.pos, area, toBoundary);
    const climbTo = Math.ceil((dTop + 1) / 500) * 500;
    const arc = [330, 30, 90].map((b) => ({ to: destination(home.pos, b, r + 3.5), altMsl: cruise }));
    const direct = distanceNm(here, area);
    const holdMin = 2;

    return [
      {
        kind: 'brief', id: 'b1', title: 'A cylinder with a tower in it',
        scene: `You've been flying at ${mill.name} and want to practice steep turns in the open country 8 nm east of ${home.id}. The straight line goes right over ${home.id}.${yourField(ctx, 'D')}`,
        say: {
          full: `Class D is usually a cylinder around a towered field, from the **surface** up to the bracketed ceiling. To enter it you need **two-way radio communication established** with the tower (91.129). Not a clearance: communication. It is established the moment the tower answers **with your call sign**. "${goodReply}" means you may enter. "${badReply}" does not, because they haven't said who they are talking to.`,
          short: 'Your call sign back from the tower means you may enter. Anything else, stay out.',
        },
        figure: { kind: 'chart', focus: { id: 'KXYZ', radiusNm: 13 }, highlight: ['KXYZ', 'xyz-d', '2X5'], marker: { pos: area, altMsl: cruise, label: 'Practice area' } },
      },
      {
        kind: 'example', id: 'e1', title: 'Where the line crosses',
        say: {
          full: `Look at the side view. The cylinder starts at the ground, so there is no going under it, and it stops at ${fmt(dTop)} MSL. At ${fmt(cruise)} you are inside it, because the ceiling is "up to and including" the number in the bracket.`,
          short: `Surface to ${fmt(dTop)}. ${fmt(cruise)} is inside.`,
        },
        figure: { kind: 'profile', start: mill.pos, startAltMsl: cruise, legs: [{ to: area, altMsl: cruise }], marks: [{ atNm: 0, label: mill.id }, { atNm: distanceNm(mill.pos, home.pos), label: home.id }], airplaneAtNm: toBoundary },
        work: [
          { label: 'Class D', value: `SFC to ${fmt(dTop)} MSL`, note: `[${Math.round(dTop / 100)}] on the chart` },
          { label: 'Radius', value: `${nm1(r)} nm`, note: `Around ${home.id}` },
          { label: 'Your altitude', value: `${fmt(cruise)} MSL`, note: cruise <= dTop ? 'Inside: at or below the ceiling' : 'Above it' },
          { label: 'Over the top', value: `${fmt(climbTo)} MSL`, note: `The next 500 ft step above ${fmt(dTop)}` },
          { label: 'Frequency', value: home.freq, note: `${tower}` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Read the Class D and the two replies.',
        figure: { kind: 'chart', focus: { id: 'KXYZ', radiusNm: 7 }, highlight: ['KXYZ', 'xyz-d'] },
        blanks: [
          { id: 'top', label: 'Ceiling of the Class D', unit: 'ft MSL', answer: dTop, tolerance: 0, explain: `[${Math.round(dTop / 100)}] is ${fmt(dTop)} ft MSL.` },
          { id: 'agl', label: 'That ceiling above the field', unit: 'ft', answer: dTop - home.elevationFt, tolerance: 0, explain: `${fmt(dTop)} − ${fmt(home.elevationFt)} = ${fmt(dTop - home.elevationFt)} ft.` },
          { id: 'good', label: `"${goodReply}" May you enter?`, answer: replyPermits(goodReply, sign, 'D') ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: 'Yes. They used your call sign, so communication is established, even though they asked you to wait (AIM 3-2-5).' },
          { id: 'bad', label: `"${badReply}" May you enter?`, answer: replyPermits(badReply, sign, 'D') ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: 'No. Without your call sign, the tower hasn\'t established communication with you. Stay outside until they answer you by name.' },
        ],
      },
      planDecision('d1', `${nm1(2.5)} nm from the line`,
        `You call ${tower} at ${fmt(cruise)} ft. The reply is: "${badReply}" The boundary is ${nm1(2.5)} nm ahead.`,
        { kind: 'profile', start: here, startAltMsl: cruise, legs: [{ to: area, altMsl: cruise }], marks: [{ atNm: 0, label: 'You' }, { atNm: distanceNm(here, home.pos), label: home.id }], airplaneAtNm: 0 },
        [
          { id: 'continue', label: 'Continue in. They know you are out there.', plan: { start: here, startAltMsl: cruise, legs: [{ to: area, altMsl: cruise }], cleared: [], transponder: true },
            then: 'You cross the line before anyone has said your call sign. The tower was busy with traffic in the pattern, and now there is an airplane in their airspace they never talked to.' },
          { id: 'hold', label: 'Turn away and circle outside until they call you by name.', plan: { start: here, startAltMsl: cruise, legs: [{ to: area, altMsl: cruise }], cleared: ['xyz-d'], transponder: true, delayMin: holdMin },
            then: `${holdMin} minutes later: "${sign}, ${tower}, enter Class Delta, report clear to the east." Now you have it, and the tower knows exactly where you are.` },
          { id: 'over', label: `Climb to ${fmt(climbTo)} and pass over the top.`, plan: { start: here, startAltMsl: cruise, legs: [{ to: along(here, area, 1.5), altMsl: climbTo }, { to: area, altMsl: climbTo }], cleared: [], transponder: true },
            then: `Legal: ${fmt(climbTo)} is over a ${fmt(dTop)} ceiling. It is also only ${fmt(climbTo - dTop)} ft above the airspace, right where the tower's departures climb out.` },
          { id: 'around', label: 'Swing north around the circle, a few miles clear.', plan: { start: here, startAltMsl: cruise, legs: [...arc, { to: area, altMsl: cruise }], cleared: [], transponder: true },
            then: (c) => `No airspace to enter and nobody to wait for, for ${Math.round(c.distanceNm - direct)} extra miles.` },
        ],
        [],
        'Communication is established by the tower saying your call sign, not by you saying theirs. Until then the boundary is a wall. Waiting, or going around with room to spare, both keep you out of it.',
      ),
    ];
  },
};

// ---------------------------------------------------------------- 4.3

const classC: Lesson = {
  id: '4.3', module: 4, minutes: 15,
  title: 'Class C: rings and radar',
  summary: 'Read the inner ring and the shelf, and know what "remain outside" means on the way into a Class C field.',
  acs: ['PA.I.E', 'PA.III.A'],
  refs: ['14 CFR 91.130', 'AIM 3-2-4', '14 CFR 91.215'],
  build(ctx) {
    const home = airport('KXYZ');
    const qc = airport('KXQC');
    const mill = airport('2X5');
    const dam = checkpoint('dam');
    const inner = volume('xqc-c1');
    const shelf = volume('xqc-c2');
    const top = ceilingMsl(inner);
    const shelfFloor = floorMsl(shelf);
    const outer = radiusNm(shelf);
    const sign = callSign(ctx);
    const approach = 'Quarry Approach';
    const reply = `${sign}, ${approach}, remain outside the Class Charlie airspace and stand by.`;
    const cruise = 2500;
    const tripNm = distanceNm(home.pos, qc.pos);
    const here = along(home.pos, qc.pos, tripNm - (outer + 3));
    const atDam = classAt(dam.pos, cruise);
    const damNm = distanceNm(dam.pos, qc.pos);

    return [
      {
        kind: 'brief', id: 'b1', title: 'A fuel stop with radar',
        scene: `You're flying from ${home.id} to ${qc.name} (${qc.id}), ${Math.round(tripNm)} nm north, for fuel and lunch. It is a Class C field.${yourField(ctx, 'C')}`,
        say: {
          full: `Class C is drawn as two solid magenta circles. The **inner ring**, about 5 nm, goes from the surface up. The **shelf**, out to about 10 nm, has a floor, so you can pass beneath it. Both share the same ceiling, printed over the floor like a fraction. To enter you need **two-way radio communication established** with approach and a **transponder with Mode C** (91.130, 91.215). As with a tower, they establish it by saying your call sign. But if they add **"remain outside"**, you stay out, whatever else they said.`,
          short: 'Inner ring from the surface, shelf with a floor. Your call sign, and no "remain outside".',
        },
        figure: { kind: 'chart', route: ['KXYZ', 'KXQC'], highlight: ['KXQC', 'xqc-c1', 'xqc-c2'] },
      },
      {
        kind: 'example', id: 'e1', title: 'The rings, from the side',
        say: {
          full: `The fractions read ${Math.round(top / 100)} over SFC for the inner ring and ${Math.round(top / 100)} over ${Math.round(shelfFloor / 100)} for the shelf. In feet above the field that is ${fmt(top - qc.elevationFt)} and ${fmt(shelfFloor - qc.elevationFt)}, which is how Class C is usually built. Your straight-in descent to the field crosses the shelf and then the inner ring, so there is no way to land without talking first.`,
          short: `${Math.round(top / 100)} over SFC, ${Math.round(top / 100)} over ${Math.round(shelfFloor / 100)}. Landing means entering.`,
        },
        figure: { kind: 'profile', start: home.pos, startAltMsl: cruise, legs: [{ to: along(home.pos, qc.pos, tripNm - 12), altMsl: cruise }, { to: qc.pos, altMsl: qc.elevationFt }], marks: [{ atNm: 0, label: home.id }, { atNm: tripNm - outer, label: `${outer} nm` }, { atNm: tripNm, label: qc.id }] },
        work: [
          { label: 'Inner ring', value: `SFC to ${fmt(top)} MSL`, note: `${radiusNm(inner)} nm around ${qc.id}` },
          { label: 'Shelf', value: `${fmt(shelfFloor)} to ${fmt(top)} MSL`, note: `${radiusNm(inner)} to ${outer} nm` },
          { label: 'Above the field', value: `${fmt(shelfFloor - qc.elevationFt)} and ${fmt(top - qc.elevationFt)} ft`, note: `Field elevation ${fmt(qc.elevationFt)}` },
          { label: 'Call', value: approach, note: inner.note ?? undefined },
          { label: 'Equipment', value: 'Mode C and ADS-B Out', note: '91.215, 91.225' },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: `Read the rings, and the dam ${Math.round(distanceNm(home.pos, dam.pos))} nm along your way.`,
        figure: { kind: 'chart', focus: { id: 'KXQC', radiusNm: 12 }, highlight: ['KXQC', 'xqc-c1', 'xqc-c2', 'dam'] },
        blanks: [
          { id: 'floor', label: 'Floor of the shelf', unit: 'ft MSL', answer: shelfFloor, tolerance: 0, explain: `The shelf's fraction has ${Math.round(shelfFloor / 100)} on the bottom: ${fmt(shelfFloor)} MSL.` },
          { id: 'top', label: 'Ceiling of the Class C', unit: 'ft MSL', answer: top, tolerance: 0, explain: `${Math.round(top / 100)} on top: ${fmt(top)} MSL, for both rings.` },
          { id: 'dam', label: `Over the dam at ${fmt(cruise)} MSL you are in`, answer: `Class ${atDam.cls}`, choices: CLASS_CHOICES,
            explain: atDam.cls === 'C'
              ? `The dam is ${nm1(damNm)} nm from ${qc.id}, inside the ${outer} nm shelf, and ${fmt(cruise)} is above its floor.`
              : `The dam is ${nm1(damNm)} nm from ${qc.id}, just outside the ${outer} nm shelf, so you are in Class ${atDam.cls} there.` },
          { id: 'reply', label: `"${reply}" May you enter?`, answer: replyPermits(reply, sign, 'C') ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: 'No. They said your call sign, but "remain outside" overrides it.' },
        ],
      },
      planDecision('d1', `${outer + 3} nm out`,
        `You call ${approach} ${outer + 3} nm south at ${fmt(cruise)} ft and hear: "${reply}"`,
        { kind: 'profile', start: here, startAltMsl: cruise, legs: [{ to: along(here, qc.pos, 1), altMsl: cruise }, { to: qc.pos, altMsl: qc.elevationFt }], marks: [{ atNm: 0, label: 'You' }, { atNm: 3, label: `${outer} nm` }, { atNm: distanceNm(here, qc.pos), label: qc.id }], airplaneAtNm: 0 },
        [
          { id: 'continue', label: 'Keep going. They know who you are.', plan: { start: here, startAltMsl: cruise, legs: [{ to: along(here, qc.pos, 1), altMsl: cruise }, { to: qc.pos, altMsl: qc.elevationFt }], cleared: [], transponder: true },
            then: '"Remain outside" was the instruction. You are inside the shelf two minutes later with approach still sequencing the airplanes they had already let in.' },
          { id: 'hold', label: `Turn and hold outside ${outer} nm until they clear you in.`, plan: { start: here, startAltMsl: cruise, legs: [{ to: along(here, qc.pos, 1), altMsl: cruise }, { to: qc.pos, altMsl: qc.elevationFt }], cleared: ['xqc-c1', 'xqc-c2'], transponder: true, delayMin: 4 },
            then: `A few minutes of circling over the fields, then: "${sign}, proceed inbound, enter left downwind runway 35." Lunch is a little later and entirely legal.` },
          { id: 'under', label: 'Duck under the shelf and head for the field.', plan: { start: here, startAltMsl: cruise, legs: [{ to: along(here, qc.pos, 2), altMsl: shelfFloor - 200 }, { to: along(here, qc.pos, distanceNm(here, qc.pos) - 2), altMsl: shelfFloor - 200 }, { to: qc.pos, altMsl: qc.elevationFt }], cleared: [], transponder: true },
            then: 'The shelf has a floor; the inner ring does not. You can sneak under the first and still have to fly into the second to land.' },
          { id: 'elsewhere', label: `Give up on ${qc.id} and land at ${mill.name} instead.`, plan: { start: here, startAltMsl: cruise, legs: [{ to: along(here, mill.pos, distanceNm(here, mill.pos) - 3), altMsl: cruise }, { to: mill.pos, altMsl: mill.elevationFt }], cleared: [], transponder: true, reachesGoal: false },
            then: `Legal and calm, but ${mill.name} has no fuel. A short wait at ${qc.id} would have got you what you came for.` },
        ],
        [],
        '"Remain outside" is an instruction, and it wins over hearing your call sign. Holding outside the shelf costs a few minutes; the alternatives either break 91.130 or give up the trip.',
      ),
    ];
  },
};

// ---------------------------------------------------------------- 4.4

const classB: Lesson = {
  id: '4.4', module: 4, minutes: 16,
  title: 'Class B shelves and Mode C',
  summary: 'Read the upside-down wedding cake, find the floor where you are, and know the difference between a squawk code and a clearance.',
  acs: ['PA.I.E'],
  refs: ['14 CFR 91.131', '14 CFR 91.215, 91.225', 'AIM 3-2-3'],
  build(ctx) {
    const home = airport('KXYZ');
    const bb = airport('KXBB');
    const plant = checkpoint('plant');
    const veil = 30;
    const sign = callSign(ctx);
    const approach = 'Bayport Approach';
    const reply = `${sign}, ${approach}, squawk 0412.`;
    const ok = `${sign}, cleared into the Class Bravo airspace, maintain 3,500.`;
    const cruise = 3500;
    // Every Class B ring the path from the field to the plant crosses, outermost first.
    const rings = ['xbb-b3', 'xbb-b2', 'xbb-b1'].map(volume);
    const plantNm = distanceNm(plant.pos, bb.pos);
    const plantRing = rings.find((v) => v.shape.kind === 'ring' ? plantNm > v.shape.innerNm && plantNm <= v.shape.outerNm : plantNm <= radiusNm(v))!;
    const plantFloor = floorMsl(plantRing);
    const homeNm = distanceNm(home.pos, bb.pos);
    const inVeil = homeNm <= veil;
    const ringNm = (plantRing.shape.kind === 'ring' ? plantRing.shape.outerNm : radiusNm(plantRing));
    // Where the path from home crosses that ring, and the decision point 4 nm before it.
    const crossAt = samplePlan({ id: 'x', start: home.pos, startAltMsl: cruise, legs: [{ to: plant.pos, altMsl: cruise }], cleared: [], transponder: true }, R.variationDeg)
      .find((s) => distanceNm(s.pos, bb.pos) <= ringNm)!.alongNm;
    const here = along(home.pos, plant.pos, crossAt - 4);
    const before = along(home.pos, plant.pos, crossAt - 1.5);
    const below = plantFloor - 500;
    const squeeze = plantFloor - 100;
    const outerShelf = rings[0];

    const path = (alt: number) => [{ to: before, altMsl: alt }, { to: plant.pos, altMsl: alt }];
    const allB = rings.map((v) => v.id);

    return [
      {
        kind: 'brief', id: 'b1', title: 'The wedding cake',
        scene: `A clear afternoon. You want to circle the power plant on the river, ${Math.round(distanceNm(home.pos, plant.pos))} nm east of ${home.id}, toward ${bb.name}.${yourField(ctx, 'B')}`,
        say: {
          full: `Class B is built in steps: a core from the surface around the big airport, then **shelves** whose floors rise as you move away, like an upside-down wedding cake. Each step is drawn in solid blue with its ceiling over its floor. Under a shelf you are not in Class B. To enter, you need to hear the words **"cleared into the Class Bravo"** (91.131). A squawk code, radar contact, even "maintain VFR" are not a clearance. And within ${veil} nm of the primary airport, the **Mode C veil**, you need a transponder and ADS-B Out even below the shelves.`,
          short: 'Floors rise as you move out. "Cleared into the Class Bravo", or stay under or outside.',
        },
        figure: { kind: 'chart', route: ['KXYZ', 'plant'], highlight: ['KXBB', ...allB, 'plant'] },
      },
      {
        kind: 'example', id: 'e1', title: 'Floors along the way',
        say: {
          full: `Laid out from the side, your path at ${fmt(cruise)} first passes under the ${fmt(floorMsl(outerShelf))} ft shelf, with room to spare. Then, ${nm1(ringNm)} nm from ${bb.id}, the floor drops to ${fmt(plantFloor)}, and ${fmt(cruise)} is inside it. The plant sits ${nm1(plantNm)} nm from ${bb.id}, under that lower shelf.`,
          short: `At ${nm1(ringNm)} nm the floor drops to ${fmt(plantFloor)}.`,
        },
        figure: { kind: 'profile', start: home.pos, startAltMsl: cruise, legs: [{ to: plant.pos, altMsl: cruise }], marks: [{ atNm: 0, label: home.id }, { atNm: crossAt, label: `${nm1(ringNm)} nm` }, { atNm: distanceNm(home.pos, plant.pos), label: 'Plant' }] },
        work: [
          ...rings.map((v) => ({ label: v.shape.kind === 'ring' ? `${v.shape.innerNm} to ${v.shape.outerNm} nm` : `0 to ${radiusNm(v)} nm`, value: `${v.floor === 'sfc' ? 'SFC' : fmt(floorMsl(v))} to ${fmt(ceilingMsl(v))}`, note: v.name })),
          { label: 'Mode C veil', value: `${veil} nm`, note: `${home.id} is ${nm1(homeNm)} nm out: ${inVeil ? 'inside' : 'outside'} it` },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'Read the floor over the plant, the veil, and the reply.',
        figure: { kind: 'chart', focus: { id: 'plant', radiusNm: 14 }, highlight: ['KXBB', ...allB, 'plant'] },
        blanks: [
          { id: 'dist', label: `Plant to ${bb.id}`, unit: 'nm', answer: Math.round(plantNm), tolerance: 1, explain: `${nm1(plantNm)} nm, so it sits under the ${plantRing.shape.kind === 'ring' ? `${plantRing.shape.innerNm} to ${plantRing.shape.outerNm} nm` : 'core'} ring.` },
          { id: 'floor', label: 'Class B floor over the plant', unit: 'ft MSL', answer: plantFloor, tolerance: 0, explain: `That ring's floor is ${fmt(plantFloor)} MSL.` },
          { id: 'veil', label: `Is ${home.id} inside the Mode C veil?`, answer: inVeil ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: `${home.id} is ${nm1(homeNm)} nm from ${bb.id}; the veil is ${veil} nm. ${inVeil ? 'Inside: transponder on from the ground up.' : 'Just outside, but you are inside it within a few minutes of takeoff.'}` },
          { id: 'reply', label: `"${reply}" May you enter the Class B?`, answer: replyPermits(reply, sign, 'B') ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: `No. A squawk code is not a clearance. You need to hear something like "${ok}"` },
        ],
      },
      planDecision('d1', 'Four miles from the step',
        `You are at ${fmt(cruise)}, ${nm1(4)} nm from where the floor drops to ${fmt(plantFloor)}. You called ${approach} and heard: "${reply}" You set the code.`,
        { kind: 'profile', start: here, startAltMsl: cruise, legs: [{ to: plant.pos, altMsl: cruise }], marks: [{ atNm: 0, label: 'You' }, { atNm: 4, label: `${nm1(ringNm)} nm` }, { atNm: distanceNm(here, plant.pos), label: 'Plant' }], airplaneAtNm: 0 },
        [
          { id: 'continue', label: `Continue at ${fmt(cruise)}. They have you on radar.`, plan: { start: here, startAltMsl: cruise, legs: path(cruise), cleared: [], transponder: true },
            then: `Two minutes later: "${sign}, you appear to be inside the Class Bravo without a clearance. Advise when ready to copy a phone number."` },
          { id: 'ask', label: 'Ask for a Class B clearance, and stay outside until you hear it.', plan: { start: here, startAltMsl: cruise, legs: path(cruise), cleared: allB, transponder: true, delayMin: 2 },
            then: `"${ok}" You cross the step with the words in hand.` },
          { id: 'below', label: `Descend to ${fmt(below)} before the step and stay under the shelf.`, plan: { start: here, startAltMsl: cruise, legs: path(below), cleared: [], transponder: true },
            then: `${fmt(below)} keeps ${fmt(plantFloor - below)} ft under the floor all the way to the plant. No clearance needed.` },
          { id: 'squeeze', label: `Descend to ${fmt(squeeze)}, just under the floor.`, plan: { start: here, startAltMsl: cruise, legs: path(squeeze), cleared: [], transponder: true },
            then: `Legal on paper, but ${fmt(plantFloor - squeeze)} ft is one bump of turbulence or one glance at the plant away from a violation, and Bayport's arrivals descend to that floor right above you.` },
        ],
        [],
        `Only "cleared into the Class Bravo" lets you in. Without it, stay at least 500 ft under the floor where you are, which here means ${fmt(below)} or lower.`,
      ),
    ];
  },
};

// ---------------------------------------------------------------- 4.5

/** A circle drawn as a polygon, so the chart labels it like other special use areas. */
function circle(center: LatLon, r: number, n = 24): LatLon[] {
  return Array.from({ length: n }, (_, i) => destination(center, (360 * i) / n, r));
}

const tfrSua: Lesson = {
  id: '4.5', module: 4, minutes: 16,
  title: 'TFRs and special use airspace',
  summary: 'Find the restrictions that aren\'t printed on the chart, tell a MOA from a restricted area, and route around both.',
  acs: ['PA.I.E', 'PA.I.D'],
  refs: ['14 CFR 91.137', '14 CFR 91.133', 'AIM 3-4-3', 'AIM 3-4-5', 'AIM 3-5-3', 'AIM 5-1-3', '14 CFR 91.103'],
  build(ctx) {
    const home = airport('KXYZ');
    const rb = airport('KXRB');
    const moa = volume('granite-moa');
    const rArea = volume('r-4101');
    const tripNm = distanceNm(home.pos, rb.pos);
    const tc = trueCourse(home.pos, rb.pos);
    const center = destination(home.pos, tc, tripNm / 2);
    const radius = 5;
    const tfrTop = 4000;
    const tfr: Volume = {
      id: 'tfr-fire', name: 'TFR (practice NOTAM)', cls: 'TFR',
      shape: { kind: 'polygon', points: circle(center, radius) },
      floor: 'sfc', ceiling: { ft: tfrTop, ref: 'msl' },
      note: 'Firefighting, 91.137(a)(2). Practice NOTAM written for this lesson.',
    };
    const extra = [tfr];
    const active = ['tfr-fire', rArea.id];
    const cruise = 3500;
    const over = 4500;
    const mc = trueToMagnetic(tc, R.variationDeg);
    const west = destination(center, tc + 90, radius + 3.5);
    const east = destination(center, tc - 90, radius + 3.5);
    // Legal to cross? Ask the plan check, the same way the options are graded.
    const through = (v: Volume) => {
      const pts = v.shape.kind === 'polygon' ? v.shape.points : [];
      const a = pts[0];
      const b = pts[2];
      const alt = Math.max(limitMsl(v.floor, 0) + 500, 2500);
      return checkPlan(withVolumes(R, extra), { id: 'x', start: a, startAltMsl: alt, legs: [{ to: b, altMsl: alt }], cleared: [], transponder: true }, active).violations.length === 0;
    };
    const moaOk = through(moa);
    const rOk = through(rArea);
    const notam = `!FDC PRACTICE ZXX PART 1 OF 1 FLIGHT RESTRICTIONS ${Math.round(radius)}NM RADIUS OF ${home.id}${pad3(tc)}0${String(Math.round(tripNm / 2)).padStart(2, '0')} SFC-${tfrTop}FT. TO PROVIDE A SAFE ENVIRONMENT FOR FIRE FIGHTING AIRCRAFT OPERATIONS PURSUANT TO 14 CFR SECTION 91.137(A)(2).`;
    const chartFig: Figure = { kind: 'chart', route: ['KXYZ', 'KXRB'], highlight: ['KXYZ', 'KXRB', 'tfr-fire', rArea.id, moa.id], extra };
    const trip = (legs: Plan['legs']): Omit<Plan, 'id'> => ({ start: home.pos, startAltMsl: cruise, legs, cleared: ['xyz-d'], transponder: true });
    const land = { to: rb.pos, altMsl: rb.elevationFt };
    const near = (alt: number) => ({ to: destination(rb.pos, tc + 180, 4), altMsl: alt });

    return [
      {
        kind: 'brief', id: 'b1', title: 'What the chart doesn\'t show',
        scene: `Tomorrow you fly to ${rb.name} (${rb.id}), ${Math.round(tripNm)} nm ${mc >= 135 && mc < 225 ? 'south' : 'away'}. Tonight you get the briefing.${yourField(ctx)}`,
        say: {
          full: 'Special use airspace is printed on the chart with hatched borders. A **MOA** (military operations area) is legal to fly through VFR, even when it is active, though it is wise to call the controlling agency for traffic. A **restricted area** is closed while it is active unless the controlling agency lets you in. A **prohibited area** is closed, always. A **TFR**, temporary flight restriction, is not on the chart at all. It comes by **NOTAM**: fires, stadiums, VIP visits, disasters. You only learn about it by asking, and 91.103 says you have to know everything about the flight before you go.',
          short: 'MOA: legal, call. Restricted: closed while active. TFR: only in the NOTAMs.',
        },
        figure: { kind: 'chart', focus: { id: rArea.id, radiusNm: 22 }, highlight: [rArea.id, moa.id] },
      },
      {
        kind: 'example', id: 'e1', title: 'Reading the NOTAM',
        say: {
          full: 'Here is the NOTAM that turned up in your briefing, drawn on the chart. TFRs are given from a navaid or a field: here a radius around a point on a bearing and distance from the home field. Find the center, draw the circle, and check the altitudes against your plan.',
          short: 'Center, radius, altitudes. Then draw it.',
        },
        figure: chartFig,
        work: [
          { label: 'NOTAM', value: notam, note: 'Practice NOTAM written for this lesson, not a real one' },
          { label: 'Center', value: `${home.id} ${pad3(tc)}° at ${Math.round(tripNm / 2)} nm`, note: 'Bearing and distance from the field' },
          { label: 'Radius', value: `${radius} nm` },
          { label: 'Altitudes', value: `SFC to ${fmt(tfrTop)} MSL` },
          { label: 'Your direct route', value: `Through it`, note: `The center is right on your course` },
          { label: rArea.name, value: 'Active today', note: rArea.note },
        ],
      },
      {
        kind: 'turn', id: 't1', title: 'Your turn',
        prompt: 'From the NOTAM and the chart: how big is the TFR, and which areas may you fly through while they are active?',
        figure: chartFig,
        blanks: [
          { id: 'top', label: 'TFR ceiling', unit: 'ft MSL', answer: tfrTop, tolerance: 0, explain: `SFC-${tfrTop}FT: from the surface up to ${fmt(tfrTop)} MSL.` },
          { id: 'radius', label: 'TFR radius', unit: 'nm', answer: radius, tolerance: 0, explain: `${radius}NM RADIUS.` },
          { id: 'moa', label: `${moa.name}, active: may you cross VFR?`, answer: moaOk ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: 'Yes. A MOA separates military training from IFR traffic; VFR pilots may cross it, and should call for traffic while it is active (AIM 3-4-5).' },
          { id: 'r', label: `${rArea.name}, active: may you cross?`, answer: rOk ? 'Yes' : 'No', choices: ['Yes', 'No'],
            explain: `No, not without the controlling agency's permission while it is active (91.133). ${rArea.note ?? ''}`.trim() },
        ],
      },
      planDecision('d1', 'Planning the way around',
        `The TFR sits on your direct course at ${fmt(cruise)} ft. ${rArea.name} is active east of it. Which way do you plan?`,
        chartFig,
        [
          { id: 'direct', label: `Direct at ${fmt(cruise)}. Firefighting is down low.`, plan: trip([near(cruise), land]),
            then: 'Tankers and spotter planes work the whole TFR, up to its ceiling, often low and slow in smoke. Busting one is also an enforcement case, whatever you saw.' },
          { id: 'west', label: 'Dogleg west, a few miles clear of the circle.', plan: trip([{ to: west, altMsl: cruise }, near(cruise), land]),
            then: 'A few extra miles, clear of the TFR, and clear of the restricted area.' },
          { id: 'east', label: 'Dogleg east, a few miles clear of the circle.', plan: trip([{ to: east, altMsl: cruise }, near(cruise), land]),
            then: `Clear of the fire, straight into ${rArea.name}, which is active today. Avoiding one restriction is how pilots end up in the next one.` },
          { id: 'over', label: `Climb to ${fmt(over)} and fly over it.`, plan: trip([{ to: destination(home.pos, tc, 8), altMsl: over }, near(over), land]),
            then: `${fmt(over)} clears the ${fmt(tfrTop)} ft ceiling by ${fmt(over - tfrTop)} ft and is a legal altitude for a magnetic course of ${pad3(mc)}. Expect smoke over a fire.` },
        ],
        active,
        'A TFR is a wall up to its ceiling. Around it, keep a couple of miles, and check what the detour runs into. Over it, keep 500 ft and the right cruising altitude.',
        {},
        extra,
      ),
    ];
  },
};

export const airspaceLessons: Lesson[] = [chartAroundField, classD, classC, classB, tfrSua];
