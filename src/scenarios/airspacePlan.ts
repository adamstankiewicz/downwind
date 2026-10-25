// Grading a VFR plan against the airspace it flies through. A plan is a path
// and altitudes plus what the pilot has in hand (a clearance, two-way radio
// contact, a transponder). The check walks the path, finds every volume the
// airplane is in, and says which rules were broken and how close it came to
// the ones it avoided. Lessons turn their decision options into plans and
// let this grade them, so the copy and the grade can't disagree.

import { inShape, limitMsl, type Shape, type Volume } from '../lib/airspace';
import { destination, distanceNm, isLegalVfrAltitude, trueCourse, type LatLon } from '../lib/nav';
import { trueToMagnetic } from '../lib/wind';
import type { Region } from '../chart/practiceRegion';
import { maxElevationFigure } from '../chart/practiceRegion';
import type { Grade } from './goNoGo';

export interface PlanLeg {
  to: LatLon;
  /** Altitude at the end of the leg, MSL. The leg climbs or descends evenly from the one before. */
  altMsl: number;
}

export interface Plan {
  id: string;
  start: LatLon;
  startAltMsl: number;
  legs: PlanLeg[];
  /**
   * Volumes the pilot may be in: a Class B clearance, two-way radio contact
   * for C and D, or the controlling agency's permission for a restricted area.
   */
  cleared: string[];
  transponder: boolean;
  /** Minutes spent waiting before the path is flown (holding for a clearance). */
  delayMin?: number;
  /** False when the option gives up the trip (turning back, landing elsewhere). */
  reachesGoal?: boolean;
}

export interface Violation {
  id: string;
  volumeId?: string;
  text: string;
  ref: string;
  /** Distance along the path where it first happens. */
  atNm: number;
}

export interface PlanCheck {
  violations: Violation[];
  /** Closest vertical approach, ft, to a volume the plan may not enter while under or over it. */
  verticalMarginFt: number | null;
  /** Closest horizontal approach, nm, to a volume the plan may not enter while beside it. */
  lateralMarginNm: number | null;
  /** Ids of every volume the path passes through. */
  entered: string[];
  /** Special use areas crossed that are legal to cross but worth a call (an active MOA). */
  cautions: string[];
  distanceNm: number;
  /** Lowest level-leg altitude above the route's maximum elevation figures, ft. */
  mefMarginFt: number;
}

const STEP_NM = 0.25;

export interface Sample {
  pos: LatLon;
  altMsl: number;
  alongNm: number;
  level: boolean;
  magCourse: number;
}

/** Points every quarter mile along the plan, with the altitude flown there. */
export function samplePlan(plan: Plan, variationDeg: number): Sample[] {
  const out: Sample[] = [];
  let from = plan.start;
  let fromAlt = plan.startAltMsl;
  let along = 0;
  for (const leg of plan.legs) {
    const d = distanceNm(from, leg.to);
    const tc = trueCourse(from, leg.to);
    const n = Math.max(1, Math.ceil(d / STEP_NM));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      out.push({
        pos: destination(from, tc, d * f),
        altMsl: fromAlt + (leg.altMsl - fromAlt) * f,
        alongNm: along + d * f,
        level: leg.altMsl === fromAlt,
        magCourse: trueToMagnetic(tc, variationDeg),
      });
    }
    along += d;
    from = leg.to;
    fromAlt = leg.altMsl;
  }
  return out;
}

/** Horizontal distance from a point to the edge of a shape, nm; 0 inside. */
export function distanceToShape(p: LatLon, s: Shape): number {
  if (s.kind === 'circle') return Math.max(0, distanceNm(p, s.center) - s.radiusNm);
  if (s.kind === 'ring') {
    const d = distanceNm(p, s.center);
    if (d > s.outerNm) return d - s.outerNm;
    if (d <= s.innerNm) return s.innerNm - d;
    return 0;
  }
  if (inShape(p, s)) return 0;
  // Flat earth around the point is close enough over a few miles.
  const k = Math.cos((p.lat * Math.PI) / 180);
  const xy = (q: LatLon) => ({ x: (q.lon - p.lon) * 60 * k, y: (q.lat - p.lat) * 60 });
  let best = Infinity;
  for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
    const a = xy(s.points[j]);
    const b = xy(s.points[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

const CONTROLLED: Record<string, { text: string; ref: string }> = {
  B: { text: 'Entered Class B without hearing "cleared into the Class Bravo"', ref: '14 CFR 91.131' },
  C: { text: 'Entered Class C before two-way radio communication was established', ref: '14 CFR 91.130' },
  D: { text: 'Entered Class D before two-way radio communication was established', ref: '14 CFR 91.129' },
  Restricted: { text: 'Entered an active restricted area without the controlling agency\'s permission', ref: '14 CFR 91.133' },
  Prohibited: { text: 'Entered a prohibited area', ref: '14 CFR 91.133' },
  TFR: { text: 'Entered a temporary flight restriction', ref: '14 CFR 91.137' },
};

/** Is this volume one the plan needs permission to be in, and does it lack it? */
function barred(v: Volume, plan: Plan, active: string[]): boolean {
  if (v.cls === 'Prohibited') return true;
  if (v.cls === 'Restricted' || v.cls === 'TFR') return active.includes(v.id) && !plan.cleared.includes(v.id);
  if (v.cls === 'B' || v.cls === 'C' || v.cls === 'D') return !plan.cleared.includes(v.id);
  return false;
}

/**
 * Walk the plan through the region. `active` lists the special use areas and
 * TFRs that are in effect; the rest are treated as cold.
 */
export function checkPlan(region: Region, plan: Plan, active: string[] = []): PlanCheck {
  const samples = samplePlan(plan, region.variationDeg);
  const violations: Violation[] = [];
  const once = (v: Violation) => { if (!violations.some((x) => x.id === v.id)) violations.push(v); };
  const entered = new Set<string>();
  const cautions = new Set<string>();
  let vMargin: number | null = null;
  let lMargin: number | null = null;
  let mefMargin = Infinity;
  const mefCache = new Map<string, number>();

  for (const s of samples) {
    const ground = region.groundFt(s.pos);
    for (const v of region.airspace) {
      const lateral = inShape(s.pos, v.shape);
      const floor = limitMsl(v.floor, ground);
      const ceiling = limitMsl(v.ceiling, ground);
      const vertical = s.altMsl >= floor && s.altMsl <= ceiling;
      if (lateral && vertical) {
        entered.add(v.id);
        if (barred(v, plan, active)) once({ id: `enter-${v.id}`, volumeId: v.id, ...CONTROLLED[v.cls], text: `${CONTROLLED[v.cls].text}: ${v.name}`, atNm: s.alongNm });
        else if ((v.cls === 'B' || v.cls === 'C') && !plan.transponder) once({ id: 'xpdr', volumeId: v.id, text: `No transponder in ${v.name}`, ref: '14 CFR 91.215', atNm: s.alongNm });
        if (v.cls === 'MOA' && active.includes(v.id)) cautions.add(v.id);
        continue;
      }
      if (!barred(v, plan, active)) continue;
      if (lateral) {
        const gap = s.altMsl < floor ? floor - s.altMsl : s.altMsl - ceiling;
        vMargin = vMargin === null ? gap : Math.min(vMargin, gap);
      } else if (vertical) {
        const gap = distanceToShape(s.pos, v.shape);
        lMargin = lMargin === null ? gap : Math.min(lMargin, gap);
      }
    }
    if (!plan.transponder && s.altMsl <= 10000 && region.veils.some((v) => distanceNm(s.pos, v.center) <= 30)) {
      once({ id: 'veil', text: 'Inside a Class B Mode C veil without a transponder', ref: '14 CFR 91.215', atNm: s.alongNm });
    }
    if (s.level) {
      const nearField = region.airports.some((a) => distanceNm(s.pos, a.pos) < 1.5);
      if (!nearField && s.altMsl - ground < 500) once({ id: 'low', text: 'Less than 500 ft above the ground away from a runway', ref: '14 CFR 91.119', atNm: s.alongNm });
      if (!isLegalVfrAltitude(s.magCourse, s.altMsl, ground)) once({ id: 'hemispheric', text: `${Math.round(s.altMsl).toLocaleString('en-US')} ft is the wrong cruising altitude for this direction more than 3,000 ft above the ground`, ref: '14 CFR 91.159', atNm: s.alongNm });
      const lat = Math.floor(s.pos.lat * 2) / 2;
      const lon = Math.floor(s.pos.lon * 2) / 2;
      const key = `${lat},${lon}`;
      if (!mefCache.has(key)) mefCache.set(key, maxElevationFigure(region, { lat, lon }, { lat: lat + 0.5, lon: lon + 0.5 }));
      mefMargin = Math.min(mefMargin, s.altMsl - mefCache.get(key)!);
    }
  }
  violations.sort((a, b) => a.atNm - b.atNm);
  return {
    violations, entered: [...entered], cautions: [...cautions],
    verticalMarginFt: vMargin === null ? null : Math.round(vMargin),
    lateralMarginNm: lMargin === null ? null : Math.round(lMargin * 10) / 10,
    distanceNm: Math.round(samples[samples.length - 1].alongNm * 10) / 10,
    mefMarginFt: Number.isFinite(mefMargin) ? Math.round(mefMargin) : Infinity,
  };
}

/** The margins this course teaches: 500 ft above or below, 2 nm beside. */
export const MARGIN = { verticalFt: 500, lateralNm: 2, mefFt: 1000 } as const;

export interface GradeOptions {
  /** Grade cruising height against the maximum elevation figures too. */
  mef?: boolean;
  /** Speed used only to weigh a longer path against a wait, knots. */
  speedKt?: number;
  /** How many minutes slower than the quickest sound option still counts as best. */
  slackMin?: number;
}

/** The grade one plan earns on its own, before it is compared with the others. */
export function planGrade(c: PlanCheck, plan: Plan, o: GradeOptions = {}): Grade {
  if (c.violations.length) return 'unsafe';
  let g: Grade = 'best';
  const worse = (x: Grade) => { if (RANK[x] > RANK[g]) g = x; };
  const v = c.verticalMarginFt;
  const l = c.lateralMarginNm;
  if ((v !== null && v < 300) || (l !== null && l < 1)) worse('marginal');
  else if ((v !== null && v < MARGIN.verticalFt) || (l !== null && l < MARGIN.lateralNm)) worse('acceptable');
  if (o.mef) {
    if (c.mefMarginFt < 0) worse('marginal');
    else if (c.mefMarginFt < MARGIN.mefFt) worse('acceptable');
  }
  if (plan.reachesGoal === false) worse('acceptable');
  return g;
}

const RANK: Record<Grade, number> = { best: 0, acceptable: 1, marginal: 2, unsafe: 3 };

export function planMinutes(c: PlanCheck, plan: Plan, speedKt = 100): number {
  return (c.distanceNm / speedKt) * 60 + (plan.delayMin ?? 0);
}

/**
 * Grade every option. A plan that breaks a rule is unsafe; one that comes
 * within 300 ft or a mile of airspace it may not enter is marginal, within
 * 500 ft or 2 nm acceptable. Of the sound plans that finish the trip, the
 * quickest and any within a few minutes of it are best; slower ones are
 * acceptable.
 */
export function gradePlans(region: Region, plans: Plan[], active: string[] = [], o: GradeOptions = {}): { grades: Record<string, Grade>; checks: Record<string, PlanCheck> } {
  const checks: Record<string, PlanCheck> = {};
  const grades: Record<string, Grade> = {};
  for (const p of plans) {
    checks[p.id] = checkPlan(region, p, active);
    grades[p.id] = planGrade(checks[p.id], p, o);
  }
  const sound = plans.filter((p) => grades[p.id] === 'best');
  const fastest = Math.min(...sound.map((p) => planMinutes(checks[p.id], p, o.speedKt)));
  for (const p of sound) {
    if (planMinutes(checks[p.id], p, o.speedKt) > fastest + (o.slackMin ?? 5)) grades[p.id] = 'acceptable';
  }
  return { grades, checks };
}

/**
 * What a controller's reply gives you. Class C and D need two-way
 * communication: the controller answers with your call sign, and does not
 * tell you to remain outside. Class B needs the words "cleared into" (or
 * "cleared through") the Class B. A squawk code alone is neither.
 */
export function replyPermits(reply: string, callSign: string, cls: 'B' | 'C' | 'D'): boolean {
  const r = reply.toLowerCase();
  const sign = callSign.toLowerCase();
  if (cls === 'B') return r.includes(sign) && /cleared (into|through) (the )?class bravo/.test(r) && !/remain (clear|outside)/.test(r);
  return r.startsWith(sign) && !/remain (clear|outside)/.test(r);
}

export interface ProfileBand {
  volumeId: string;
  name: string;
  cls: Volume['cls'];
  fromNm: number;
  toNm: number;
  floorMsl: number;
  ceilingMsl: number;
  /** True when the floor is the ground (a surface area). */
  surface: boolean;
}

export interface Profile {
  distanceNm: number;
  /** Ground and the planned altitude, every quarter mile. */
  samples: { alongNm: number; groundFt: number; altMsl: number }[];
  /** Each stretch of the path that lies under or inside a charted volume, as a side view draws it. */
  bands: ProfileBand[];
}

const PROFILE_CLASSES = new Set(['B', 'C', 'D', 'Restricted', 'Prohibited', 'TFR', 'MOA']);

/** The side view of a plan: ground, altitude, and the airspace overhead. */
export function profileAlong(region: Region, plan: Pick<Plan, 'start' | 'startAltMsl' | 'legs'>): Profile {
  const samples = samplePlan({ ...plan, id: 'profile', cleared: [], transponder: true }, region.variationDeg);
  const bands: ProfileBand[] = [];
  for (const v of region.airspace) {
    if (!PROFILE_CLASSES.has(v.cls)) continue;
    let run: ProfileBand | null = null;
    for (const s of samples) {
      if (inShape(s.pos, v.shape)) {
        const g = region.groundFt(s.pos);
        const floor = limitMsl(v.floor, g);
        const ceiling = limitMsl(v.ceiling, g);
        if (!run) {
          run = { volumeId: v.id, name: v.name, cls: v.cls, fromNm: s.alongNm, toNm: s.alongNm, floorMsl: floor, ceilingMsl: ceiling, surface: v.floor === 'sfc' };
          bands.push(run);
        }
        run.toNm = s.alongNm;
        run.floorMsl = Math.min(run.floorMsl, floor);
        run.ceilingMsl = Math.max(run.ceilingMsl, ceiling);
      } else run = null;
    }
  }
  return {
    distanceNm: samples[samples.length - 1].alongNm,
    samples: samples.map((s) => ({ alongNm: s.alongNm, groundFt: region.groundFt(s.pos), altMsl: s.altMsl })),
    bands: bands.map((b) => ({ ...b, fromNm: Math.round(b.fromNm * 10) / 10, toNm: Math.round(b.toNm * 10) / 10, floorMsl: Math.round(b.floorMsl), ceilingMsl: Math.round(b.ceilingMsl) })),
  };
}
