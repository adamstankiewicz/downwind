// The practice sectional, drawn the way a sectional is drawn: blue for towered
// fields and the Class B and D that surround them, magenta for untowered
// fields, Class C and the 700 ft Class E vignette, hatched borders on the
// special use areas, towns in yellow, numbers printed beside every symbol.
// The region is made up and the chart says so on its face. The SVG is sized
// in device pixels (the viewBox follows the box it sits in), so every font
// size here is the size it renders at: nothing smaller than 11px.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { practiceRegion, maxElevationFigure, type ChartAirport, type Checkpoint, type Region } from '../chart/practiceRegion';
import type { Limit, Shape, Volume } from '../lib/airspace';
import { destination, distanceNm, trueCourse, type LatLon } from '../lib/nav';
import { fitProjection, focusProjection, makeProjection, overlaps, placeLabel, placeLabelLoose, textWidth, type Box, type Projection, type XY } from './projection';

export interface ChartMarker {
  pos: LatLon;
  altMsl: number;
  label?: string;
}

export interface SectionalChartProps {
  region?: Region;
  /** Ids of airports and checkpoints, flown in order, drawn as a course line. */
  route?: string[];
  /** Ids (airports, checkpoints, airspace volumes) to emphasize; the rest dims. */
  highlight?: string[];
  /** Center on one thing and show this far around it. */
  focus?: { id: string; radiusNm: number };
  /** An airplane at a position and altitude. */
  marker?: ChartMarker;
  /** A picked point, drawn as a crosshair. */
  point?: LatLon;
  onPick?: (p: LatLon) => void;
  /** Tallest the chart may be; the width follows the box it sits in. */
  maxHeight?: number;
  /** Shortest the chart may be. */
  minHeight?: number;
}

type Entity =
  | { kind: 'airport'; id: string; pos: LatLon; airport: ChartAirport }
  | { kind: 'checkpoint'; id: string; pos: LatLon; checkpoint: Checkpoint }
  | { kind: 'volume'; id: string; pos: LatLon; volume: Volume };

const BLUE = 'var(--sky)';
const BLUE_INK = 'var(--sky-ink)';
const MAGENTA = 'var(--sock-ink)';

/** Center of a shape: the circle's center or the polygon's mean point. */
export function shapeCenter(s: Shape): LatLon {
  if (s.kind !== 'polygon') return s.center;
  const n = s.points.length;
  return { lat: s.points.reduce((a, p) => a + p.lat, 0) / n, lon: s.points.reduce((a, p) => a + p.lon, 0) / n };
}

export function findEntity(region: Region, id: string): Entity | undefined {
  const a = region.airports.find((x) => x.id === id);
  if (a) return { kind: 'airport', id, pos: a.pos, airport: a };
  const c = region.checkpoints.find((x) => x.id === id);
  if (c) return { kind: 'checkpoint', id, pos: c.pos, checkpoint: c };
  const v = region.airspace.find((x) => x.id === id);
  if (v) return { kind: 'volume', id, pos: shapeCenter(v.shape), volume: v };
  return undefined;
}

/** Nearest airport or checkpoint to a point within `withinNm`, for taps. */
export function nearestPlace(region: Region, p: LatLon, withinNm: number): ChartAirport | Checkpoint | undefined {
  let best: { d: number; e: ChartAirport | Checkpoint } | null = null;
  for (const e of [...region.airports, ...region.checkpoints]) {
    const d = distanceNm(p, e.pos);
    if (d <= withinNm && (!best || d < best.d)) best = { d, e };
  }
  return best?.e;
}

/** A floor or ceiling the way the chart prints it: hundreds of feet MSL, or SFC. */
export function limitLabel(l: Limit): string {
  if (l === 'sfc') return 'SFC';
  const h = Math.round(l.ft / 100);
  return l.ref === 'agl' ? `${h} AGL` : String(h);
}

const fmtDeg = (d: number, hemi: [string, string]) => {
  const a = Math.abs(d);
  const deg = Math.floor(a + 1e-9);
  const min = Math.round((a - deg) * 60);
  return `${deg}°${String(min).padStart(2, '0')}'${d >= 0 ? hemi[0] : hemi[1]}`;
};
const pad3 = (n: number) => String(Math.round(n)).padStart(3, '0');
const fmtNum = (n: number) => n.toLocaleString('en-US');

function useBoxWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface Label {
  box: Box;
  node: React.ReactNode;
}

export function SectionalChart({ region = practiceRegion, route = [], highlight = [], focus, marker, point, onPick, maxHeight = 720, minHeight = 300 }: SectionalChartProps) {
  const [boxRef, measured] = useBoxWidth();
  const uid = useId().replace(/:/g, '');
  const W = measured || 720;
  const H = Math.round(Math.min(maxHeight, Math.max(minHeight, W * 0.78)));

  const proj: Projection = useMemo(() => {
    const f = focus ? findEntity(region, focus.id) : undefined;
    if (f) return focusProjection(f.pos, focus!.radiusNm, W, H);
    // Fit the charted bounds, widened to hold every field and volume with a little margin.
    const b = { ...region.bounds };
    const grow = (p: LatLon, rNm: number) => {
      const dLat = rNm / 60;
      const dLon = rNm / (60 * Math.cos((p.lat * Math.PI) / 180));
      b.north = Math.max(b.north, p.lat + dLat); b.south = Math.min(b.south, p.lat - dLat);
      b.east = Math.max(b.east, p.lon + dLon); b.west = Math.min(b.west, p.lon - dLon);
    };
    for (const a of region.airports) grow(a.pos, 3);
    for (const v of region.airspace) {
      const s = v.shape;
      if (s.kind === 'circle') grow(s.center, s.radiusNm);
      else if (s.kind === 'ring') grow(s.center, s.outerNm);
      else for (const p of s.points) grow(p, 1);
    }
    const fit = fitProjection(b, W - 16, H - 16);
    return makeProjection(fit.center, fit.pxPerNm, W, H);
  }, [region, focus, W, H]);

  const S = proj.pxPerNm;
  const compact = S < 5.5;
  const nm = (n: number) => n * S;
  const routeSet = new Set(route);
  const hiSet = new Set(highlight);
  const dimming = hiSet.size > 0;
  const dimOf = (id: string) => (dimming && !hiSet.has(id) && !routeSet.has(id) ? 0.3 : 1);
  const frame: Box = { x: 2, y: 2, w: W - 4, h: H - 4 };
  const inFrame = (q: XY, m = 12) => q.x >= -m && q.x <= W + m && q.y >= -m && q.y <= H + m;
  const trueHeading = (rwy: string) => parseInt(rwy, 10) * 10 + region.variationDeg;

  // Labels are placed greedily, most important first, so what is on the
  // route or highlighted always gets its name.
  const placed: Box[] = [];
  const labels: Label[] = [];
  const halo = { paintOrder: 'stroke' as const, stroke: 'var(--panel)', strokeWidth: 3, strokeLinejoin: 'round' as const };

  // Fixed furniture first so nothing lands on it.
  const roseBox: Box = { x: W - 70, y: 10, w: 60, h: 70 };
  const scaleNm = S > 24 ? 2 : S > 12 ? 5 : S > 3.2 ? 10 : 20;
  const scaleBox: Box = { x: W - nm(scaleNm) - 30, y: H - 34, w: nm(scaleNm) + 20, h: 26 };
  const signText = 'Practice sectional. Not a real chart.';
  const signBox: Box = { x: 10, y: H - 32, w: textWidth(signText, 11) + 16, h: 22 };
  placed.push(roseBox, scaleBox, signBox);

  // --- terrain: sampled on a grid, shaded in bands of ink ---
  const cell = W > 700 ? 4 : 6;
  const terrain = useMemo(() => {
    const cols = Math.ceil(W / cell);
    const rows = Math.ceil(H / cell);
    // Bands every 300 ft from 600 ft, like the hypsometric tints on a sectional, in ink.
    const band = (ft: number) => Math.min(6, Math.max(0, Math.floor((ft - 600) / 300) + 1));
    const rects: { x: number; y: number; w: number; b: number }[] = [];
    for (let r = 0; r < rows; r++) {
      let run: { x: number; w: number; b: number } | null = null;
      for (let c = 0; c <= cols; c++) {
        const b = c < cols ? band(region.groundFt(proj.toLatLon({ x: c * cell + cell / 2, y: r * cell + cell / 2 }))) : -1;
        if (run && run.b === b) run.w += cell;
        else {
          if (run && run.b > 0) rects.push({ x: run.x, y: r * cell, w: run.w, b: run.b });
          run = b >= 0 ? { x: c * cell, w: cell, b } : null;
        }
      }
    }
    return rects;
  }, [region, proj, W, H, cell]);
  const bandOpacity = [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24];

  // --- graticule every 30 minutes, ticks every 10, MEF in each quadrangle ---
  const ext = proj.extent();
  const latLines: number[] = [];
  for (let v = Math.ceil(ext.south * 6) / 6; v < ext.north; v += 1 / 6) latLines.push(Math.round(v * 6) / 6);
  const lonLines: number[] = [];
  for (let v = Math.ceil(ext.west * 6) / 6; v < ext.east; v += 1 / 6) lonLines.push(Math.round(v * 6) / 6);
  const isHalf = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;
  // The graticule's own labels, kept clear of everything else.
  const latTexts = latLines.filter(isHalf).map((v) => ({ v, y: proj.toXY({ lat: v, lon: proj.center.lon }).y })).filter((t) => t.y > 24 && t.y < H - 40)
    .map((t) => ({ ...t, box: { x: 11, y: t.y - 14, w: textWidth(fmtDeg(t.v, ['N', 'S']), 11) + 4, h: 14 } }));
  const lonTexts = lonLines.filter(isHalf).map((v) => ({ v, x: proj.toXY({ lat: proj.center.lat, lon: v }).x })).filter((t) => t.x > 40 && t.x < W - 60)
    .map((t) => ({ ...t, box: { x: t.x + 2, y: H - 25, w: textWidth(fmtDeg(t.v, ['E', 'W']), 11) + 4, h: 14 } }))
    .filter((t) => !placed.some((p) => overlaps(p, t.box)));
  placed.push(...latTexts.map((t) => t.box), ...lonTexts.map((t) => t.box));
  const mefs: { x: number; y: number; thousands: number; hundreds: number }[] = [];
  if (S >= 4.5) {
    const lat0 = Math.floor(ext.south * 2) / 2;
    const lon0 = Math.floor(ext.west * 2) / 2;
    for (let la = lat0; la < ext.north; la += 0.5) {
      for (let lo = lon0; lo < ext.east; lo += 0.5) {
        const sw = { lat: la, lon: lo };
        const ne = { lat: la + 0.5, lon: lo + 0.5 };
        const mef = maxElevationFigure(region, sw, ne);
        // Center of the visible part of the quadrangle.
        const vis = { lat: (Math.max(la, ext.south) + Math.min(la + 0.5, ext.north)) / 2, lon: (Math.max(lo, ext.west) + Math.min(lo + 0.5, ext.east)) / 2 };
        const q = proj.toXY(vis);
        mefs.push({ x: q.x, y: q.y, thousands: Math.floor(mef / 1000), hundreds: Math.round((mef % 1000) / 100) });
        placed.push({ x: q.x - 14, y: q.y - 20, w: 28, h: 24 });
      }
    }
  }

  // --- airspace ---
  const away = (p: LatLon) => trueCourse(proj.center, p); // label side: away from the middle of the chart
  const fraction = (ceiling: string, floor: string, color: string, size = 11): { w: number; h: number; node: (x: number, y: number) => React.ReactNode } => {
    const w = Math.max(textWidth(ceiling, size), textWidth(floor, size)) + 4;
    const h = size * 2 + 6;
    return {
      w, h,
      node: (x, y) => (
        <g>
          <text x={x + w / 2} y={y + size} textAnchor="middle" fontSize={size} fontWeight="700" fill={color} style={halo}>{ceiling}</text>
          <line x1={x + 2} y1={y + size + 3} x2={x + w - 2} y2={y + size + 3} stroke={color} strokeWidth="1.2" />
          <text x={x + w / 2} y={y + size * 2 + 4} textAnchor="middle" fontSize={size} fontWeight="700" fill={color} style={halo}>{floor}</text>
        </g>
      ),
    };
  };
  const ringLabelAt = (center: LatLon, rNm: number, angle: number): XY => proj.toXY(destination(center, angle, rNm));
  const candidatesAround = (anchor: (a: number) => XY, w: number, h: number, base: number): Box[] =>
    [0, 35, -35, 70, -70, 110, -110, 180].map((d) => { const q = anchor(base + d); return { x: q.x - w / 2, y: q.y - h / 2, w, h }; });

  const airspaceNodes: React.ReactNode[] = [];
  const airspaceLabels: { prio: number; cands: Box[]; node: (b: Box) => React.ReactNode; id: string; fallback: boolean }[] = [];
  const hatchId = (cls: string) => `${uid}-hatch-${cls === 'Restricted' ? 'b' : 'm'}`;
  const polyPoints = (pts: LatLon[]) => pts.map((p) => { const q = proj.toXY(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');

  for (const v of region.airspace) {
    const s = v.shape;
    const color = v.cls === 'B' || v.cls === 'D' || v.cls === 'Restricted' || v.cls === 'Prohibited' ? BLUE : MAGENTA;
    const op = dimOf(v.id);
    const nodes: React.ReactNode[] = [];
    if (s.kind === 'circle' || s.kind === 'ring') {
      const c = proj.toXY(s.center);
      const radii = s.kind === 'circle' ? [s.radiusNm] : [s.outerNm, s.innerNm];
      for (const rNm of radii) {
        const r = nm(rNm);
        if (v.cls === 'B' || v.cls === 'C') {
          nodes.push(<circle key={`${rNm}-band`} cx={c.x} cy={c.y} r={Math.max(0, r - 4)} fill="none" stroke={color} strokeOpacity="0.16" strokeWidth="8" />);
          nodes.push(<circle key={`${rNm}-line`} cx={c.x} cy={c.y} r={r} fill="none" stroke={color} strokeWidth="2" />);
        } else if (v.cls === 'D') {
          nodes.push(<circle key={`${rNm}-d`} cx={c.x} cy={c.y} r={r} fill="none" stroke={color} strokeWidth="1.8" strokeDasharray="6 4" />);
        } else if (v.cls === 'E') {
          nodes.push(<circle key={`${rNm}-e1`} cx={c.x} cy={c.y} r={Math.max(0, r - 6)} fill="none" stroke={color} strokeOpacity="0.2" strokeWidth="12" />);
          nodes.push(<circle key={`${rNm}-e2`} cx={c.x} cy={c.y} r={r} fill="none" stroke={color} strokeOpacity="0.6" strokeWidth="1" />);
        } else {
          nodes.push(<circle key={`${rNm}-s`} cx={c.x} cy={c.y} r={r} fill="none" stroke={color} strokeWidth="1.5" />);
        }
      }
      // The surface area of a B or C gets a faint wash so the shelves read as steps.
      if (s.kind === 'circle' && (v.cls === 'B' || v.cls === 'C')) nodes.push(<circle key="wash" cx={c.x} cy={c.y} r={nm(s.radiusNm)} fill={color} fillOpacity="0.06" />);
      const labelR = s.kind === 'circle' ? s.radiusNm * 0.72 : (s.innerNm + s.outerNm) / 2;
      const base = away(s.center);
      if (v.cls === 'D') {
        const txt = `[${limitLabel(v.ceiling)}]`;
        const w = textWidth(txt, 11) + 4;
        const h = 14;
        airspaceLabels.push({
          id: v.id, prio: 2, fallback: inFrame(proj.toXY(s.center)) && (!compact || hiSet.has(v.id)),
          cands: candidatesAround((a) => ringLabelAt(s.center, s.kind === 'circle' ? s.radiusNm + 1 + (w / 2) / S : labelR, a), w, h, base + 60),
          node: (b) => <text x={b.x + 2} y={b.y + 11} fontSize="11" fontWeight="700" fill={BLUE_INK} style={halo}>{txt}</text>,
        });
      } else if (v.cls === 'B' || v.cls === 'C') {
        const f = fraction(limitLabel(v.ceiling), limitLabel(v.floor), color === BLUE ? BLUE_INK : MAGENTA);
        airspaceLabels.push({ id: v.id, prio: 2, fallback: inFrame(proj.toXY(s.center)), cands: candidatesAround((a) => ringLabelAt(s.center, labelR, a), f.w, f.h, base), node: (b) => f.node(b.x, b.y) });
      }
    } else {
      const pts = polyPoints(s.points);
      const clip = `${uid}-clip-${v.id}`;
      nodes.push(
        <g key="poly">
          <defs><clipPath id={clip}><polygon points={pts} /></clipPath></defs>
          <polygon points={pts} fill="none" stroke={`url(#${hatchId(v.cls)})`} strokeWidth="18" clipPath={`url(#${clip})`} />
          <polygon points={pts} fill="none" stroke={color} strokeWidth="1.4" />
        </g>,
      );
      const c = shapeCenter(s);
      const name = v.name;
      const f = fraction(limitLabel(v.ceiling), limitLabel(v.floor), color === BLUE ? BLUE_INK : MAGENTA);
      const w = Math.max(textWidth(name, 12) + 4, f.w);
      const h = 15 + f.h;
      const q = proj.toXY(c);
      // A special use area's name sits at its middle like the sign on a door: placed first, everything else goes round it.
      airspaceLabels.push({
        id: v.id, prio: -1, fallback: inFrame(q),
        cands: [[0, 0], [0, -3], [0, 3], [-3, 0], [3, 0], [-3, -3], [3, -3], [-3, 3], [3, 3]].map(([dx, dy]) => ({ x: q.x - w / 2 + nm(dx), y: q.y - h / 2 + nm(dy), w, h })),
        node: (b) => (
          <g>
            <text x={b.x + w / 2} y={b.y + 12} textAnchor="middle" fontSize="12" fontWeight="700" fill={color === BLUE ? BLUE_INK : MAGENTA} style={halo}>{name}</text>
            {f.node(b.x + (w - f.w) / 2, b.y + 15)}
          </g>
        ),
      });
    }
    airspaceNodes.push(<g key={v.id} opacity={op}>{nodes}</g>);
  }

  // --- airports, obstacles, checkpoints ---
  type Pending = { prio: number; id: string; cands: Box[]; node: (b: Box) => React.ReactNode; fallback: boolean; opacity: number };
  const pending: Pending[] = airspaceLabels.map((l) => ({ ...l, opacity: dimOf(l.id) }));
  const symbolNodes: React.ReactNode[] = [];

  const sideCandidates = (q: XY, w: number, h: number, gap: number): Box[] => [
    { x: q.x + gap, y: q.y - h / 2, w, h },
    { x: q.x - gap - w, y: q.y - h / 2, w, h },
    { x: q.x - w / 2, y: q.y + gap, w, h },
    { x: q.x - w / 2, y: q.y - gap - h, w, h },
    { x: q.x + gap * 0.7, y: q.y + gap * 0.7, w, h },
    { x: q.x - gap * 0.7 - w, y: q.y + gap * 0.7, w, h },
    { x: q.x + gap * 0.7, y: q.y - gap * 0.7 - h, w, h },
    { x: q.x - gap * 0.7 - w, y: q.y - gap * 0.7 - h, w, h },
    { x: q.x + gap * 2, y: q.y - h / 2, w, h },
    { x: q.x - gap * 2 - w, y: q.y - h / 2, w, h },
    { x: q.x - w / 2, y: q.y + gap * 2, w, h },
    { x: q.x - w / 2, y: q.y - gap * 2 - h, w, h },
  ];

  for (const a of region.airports) {
    const q = proj.toXY(a.pos);
    if (!inFrame(q)) continue;
    const color = a.towered ? BLUE : MAGENTA;
    const r = compact ? 6 : 7.5;
    const important = routeSet.has(a.id) || hiSet.has(a.id);
    const op = dimOf(a.id);
    symbolNodes.push(
      <g key={a.id} opacity={op}>
        {a.fuel && [45, 135, 225, 315].map((d) => {
          const rr = (d * Math.PI) / 180;
          return <line key={d} x1={q.x + Math.sin(rr) * (r + 1)} y1={q.y - Math.cos(rr) * (r + 1)} x2={q.x + Math.sin(rr) * (r + 4.5)} y2={q.y - Math.cos(rr) * (r + 4.5)} stroke={color} strokeWidth="1.5" />;
        })}
        <circle cx={q.x} cy={q.y} r={r} fill="var(--panel)" stroke={color} strokeWidth="1.8" />
        {a.surface === 'paved' && <rect x={q.x - 1.8} y={q.y - r + 1} width="3.6" height={r * 2 - 2} fill={color} transform={`rotate(${trueHeading(a.runways[0])} ${q.x} ${q.y})`} />}
      </g>,
    );
    const idLine = { t: a.id, size: 12, weight: 800, color: a.towered ? BLUE_INK : MAGENTA };
    const freqLine = (atis: boolean) => ({ t: `${a.freqKind === 'Tower' ? 'CT' : 'CTAF'} ${a.freq}${atis && a.atis ? `  ATIS ${a.atis}` : ''}`, size: 11, weight: 500, color: 'var(--ink)' });
    const lines: { t: string; size: number; weight: number; color: string }[] = !compact
      ? [
          idLine,
          { t: a.name, size: 11, weight: 600, color: 'var(--ink)' },
          freqLine(true),
          { t: `${fmtNum(a.elevationFt)} ft, rwy ${fmtNum(a.runwayFt)} ft${a.surface === 'grass' ? ' grass' : ''}`, size: 11, weight: 500, color: 'var(--ink-2)' },
        ]
      : important
      ? [idLine, { t: a.name, size: 11, weight: 600, color: 'var(--ink)' }, freqLine(false)]
      : [
          idLine,
          freqLine(false),
        ];
    const w = Math.max(...lines.map((l) => textWidth(l.t, l.size))) + 4;
    const h = lines.reduce((n, l) => n + l.size + 3, 0) + 2;
    pending.push({
      id: a.id, prio: important ? 0 : 1, fallback: true, opacity: op,
      cands: sideCandidates(q, w, h, r + 7),
      node: (b) => {
        let y = b.y;
        return (
          <g>
            {lines.map((l, i) => { y += l.size + (i ? 3 : 0); return <text key={i} x={b.x + 2} y={y} fontSize={l.size} fontWeight={l.weight} fill={l.color} style={halo}>{l.t}</text>; })}
          </g>
        );
      },
    });
  }

  for (const o of region.obstacles) {
    const q = proj.toXY(o.pos);
    if (!inFrame(q)) continue;
    const op = dimOf(o.id);
    symbolNodes.push(
      <g key={o.id} opacity={op}>
        <polygon points={`${q.x},${q.y - 13} ${q.x - 3},${q.y} ${q.x + 3},${q.y}`} fill="var(--ink)" />
        {o.lighted && <path d={`M${q.x - 5},${q.y - 14} l-3,-3 M${q.x + 5},${q.y - 14} l3,-3 M${q.x},${q.y - 15} v-4`} stroke="var(--ink)" strokeWidth="1.2" strokeLinecap="round" />}
      </g>,
    );
    const t1 = fmtNum(o.mslFt);
    const t2 = `(${fmtNum(o.aglFt)})`;
    const w = Math.max(textWidth(t1, 11), textWidth(t2, 11)) + 4;
    const h = 27;
    pending.push({
      id: o.id, prio: 3, fallback: !compact || dimOf(o.id) === 1 && hiSet.has(o.id), opacity: op,
      cands: sideCandidates({ x: q.x, y: q.y - 6 }, w, h, 8),
      node: (b) => (
        <g>
          <text x={b.x + 2} y={b.y + 11} fontSize="11" fontWeight="800" fill="var(--ink)" style={halo}>{t1}</text>
          <text x={b.x + 2} y={b.y + 24} fontSize="11" fill="var(--ink)" style={halo}>{t2}</text>
        </g>
      ),
    });
  }

  for (const c of region.checkpoints) {
    if (c.kind === 'tower' && region.obstacles.some((o) => distanceNm(o.pos, c.pos) < 0.2)) continue; // the obstacle draws it
    const q = proj.toXY(c.pos);
    if (!inFrame(q)) continue;
    const op = dimOf(c.id);
    const important = routeSet.has(c.id) || hiSet.has(c.id);
    let sym: React.ReactNode;
    switch (c.kind) {
      case 'town':
        sym = <polygon points={`${q.x - 6},${q.y - 4} ${q.x + 5},${q.y - 5} ${q.x + 6},${q.y + 4} ${q.x - 4},${q.y + 5}`} fill="var(--taxi)" stroke="var(--ink)" strokeWidth="0.8" />;
        break;
      case 'lake':
        sym = <ellipse cx={q.x} cy={q.y} rx={Math.max(3, nm(0.5))} ry={Math.max(7, nm(2))} fill="var(--sky-tint)" stroke={BLUE} strokeWidth="1" />;
        break;
      case 'dam':
        sym = (
          <g>
            <ellipse cx={q.x} cy={q.y - 4} rx={Math.max(5, nm(0.9))} ry={Math.max(3, nm(0.6))} fill="var(--sky-tint)" stroke={BLUE} strokeWidth="1" />
            <line x1={q.x - 6} y1={q.y + 1} x2={q.x + 6} y2={q.y + 1} stroke="var(--ink)" strokeWidth="2.5" />
          </g>
        );
        break;
      case 'highway':
      case 'river':
        sym = (
          <g>
            <line x1={q.x - 9} y1={q.y + 5} x2={q.x + 9} y2={q.y - 5} stroke={BLUE} strokeWidth="1.5" />
            <line x1={q.x - 6} y1={q.y - 7} x2={q.x + 6} y2={q.y + 7} stroke="var(--ink)" strokeWidth="2.2" />
          </g>
        );
        break;
      case 'plant':
        sym = (
          <g>
            <rect x={q.x - 5} y={q.y - 3} width="10" height="7" fill="var(--ink)" />
            <path d={`M${q.x - 2},${q.y - 3} v-7 M${q.x + 2},${q.y - 3} v-7`} stroke="var(--ink)" strokeWidth="1.8" />
          </g>
        );
        break;
      default:
        sym = <circle cx={q.x} cy={q.y} r="3" fill="var(--ink)" />;
    }
    symbolNodes.push(<g key={c.id} opacity={op}>{sym}</g>);
    const w = textWidth(c.name, 11) + 4;
    const h = 14;
    const gap = c.kind === 'lake' ? Math.max(9, nm(0.5)) + 4 : 9;
    pending.push({
      id: c.id, prio: important ? 0 : 3, fallback: important || !compact, opacity: op,
      cands: sideCandidates(q, w, h, gap),
      node: (b) => <text x={b.x + 2} y={b.y + 11} fontSize="11" fontWeight="600" fill="var(--ink)" style={halo}>{c.name}</text>,
    });
  }

  // --- route ---
  const routePts = route.map((id) => findEntity(region, id)).filter((e): e is Entity => !!e);
  const routeNodes: React.ReactNode[] = [];
  routePts.forEach((e, i) => {
    const q = proj.toXY(e.pos);
    routeNodes.push(<circle key={`wp-${i}`} cx={q.x} cy={q.y} r={compact ? 10 : 12} fill="none" stroke="var(--ink)" strokeWidth="2" />);
    if (i + 1 >= routePts.length) return;
    const b = routePts[i + 1];
    const qb = proj.toXY(b.pos);
    const tc = trueCourse(e.pos, b.pos);
    const d = distanceNm(e.pos, b.pos);
    const ang = (Math.atan2(qb.y - q.y, qb.x - q.x) * 180) / Math.PI;
    const upright = ang > 90 || ang < -90 ? ang + 180 : ang;
    const mx = (q.x + qb.x) / 2;
    const my = (q.y + qb.y) / 2;
    // Offset the label to the left of the line as flown, so it never sits on it.
    const nx = Math.sin((upright * Math.PI) / 180) * 9;
    const ny = -Math.cos((upright * Math.PI) / 180) * 9;
    // The full label on a leg long enough to carry it, the distance alone on a short one, nothing on a stub.
    const len = Math.hypot(qb.x - q.x, qb.y - q.y);
    const full = `TC ${pad3(tc)}  ${Math.round(d)} nm`;
    const short = `${Math.round(d)} nm`;
    const txt = len > textWidth(full, 11.5) + 30 ? full : len > textWidth(short, 11.5) + 24 ? short : '';
    routeNodes.push(
      <g key={`leg-${i}`}>
        <line x1={q.x} y1={q.y} x2={qb.x} y2={qb.y} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
        {txt && <text x={mx + nx} y={my + ny} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--ink)" transform={`rotate(${upright} ${mx + nx} ${my + ny})`} style={halo}>{txt}</text>}
      </g>,
    );
    const lw = textWidth(txt, 11.5);
    if (txt) placed.push({ x: mx - lw / 2, y: my - 14, w: lw, h: 28 });
    // The line itself, as a chain of small boxes, so labels stay off the course.
    const steps = Math.max(1, Math.round(len / 10));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      placed.push({ x: q.x + (qb.x - q.x) * t - 4, y: q.y + (qb.y - q.y) * t - 4, w: 8, h: 8 });
    }
  });

  // --- the marker and the picked point ---
  const extras: React.ReactNode[] = [];
  if (marker) {
    const q = proj.toXY(marker.pos);
    const txt = `${marker.label ? `${marker.label}, ` : ''}${fmtNum(marker.altMsl)} ft`;
    extras.push(
      <g key="marker">
        <path transform={`translate(${q.x} ${q.y}) scale(1.1)`} d="M0,-9 L2,-3 L10,1 L10,3 L2,1.5 L1.5,6 L4,8 L4,9 L0,8 L-4,9 L-4,8 L-1.5,6 L-2,1.5 L-10,3 L-10,1 L-2,-3 Z" fill="var(--ink)" stroke="var(--panel)" strokeWidth="1.2" strokeLinejoin="round" />
        <text x={q.x + 14} y={q.y + 4} fontSize="11.5" fontWeight="700" fill="var(--ink)" style={halo}>{txt}</text>
      </g>,
    );
    placed.push({ x: q.x - 12, y: q.y - 12, w: 26 + textWidth(txt, 11.5), h: 24 });
  }
  if (point) {
    const q = proj.toXY(point);
    extras.push(
      <g key="point" aria-hidden="true">
        <circle cx={q.x} cy={q.y} r="10" fill="none" stroke="var(--sock)" strokeWidth="2.5" />
        <circle cx={q.x} cy={q.y} r="2" fill="var(--sock)" />
        <path d={`M${q.x - 15},${q.y} h6 M${q.x + 9},${q.y} h6 M${q.x},${q.y - 15} v6 M${q.x},${q.y + 9} v6`} stroke="var(--sock)" strokeWidth="2" strokeLinecap="round" />
      </g>,
    );
    placed.push({ x: q.x - 15, y: q.y - 15, w: 30, h: 30 });
  }

  // --- place the labels ---
  pending.sort((a, b) => a.prio - b.prio);
  for (const p of pending) {
    const got = p.fallback ? placeLabelLoose(placed, p.cands, frame) : placeLabel(placed, p.cands, frame);
    if (!got) continue;
    placed.push(got);
    labels.push({ box: got, node: <g key={`lbl-${p.id}`} opacity={p.opacity}>{p.node(got)}</g> });
  }

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const q = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    onPick(proj.toLatLon(q));
  };

  const varLabel = `${Math.abs(region.variationDeg)}°${region.variationDeg < 0 ? 'W' : 'E'}`;
  const desc = `${region.name}. ${region.airports.map((a) => `${a.id} ${a.name}`).join(', ')}.${routePts.length > 1 ? ` Route ${routePts.map((e) => e.id).join(' to ')}.` : ''}`;

  return (
    <div ref={boxRef} className={`sectional${onPick ? ' pickable' : ''}`}>
      {measured > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={desc} onClick={onPick ? pick : undefined}>
          <defs>
            <pattern id={`${uid}-hatch-b`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={BLUE} strokeWidth="1.4" strokeOpacity="0.7" />
            </pattern>
            <pattern id={`${uid}-hatch-m`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={MAGENTA} strokeWidth="1.4" strokeOpacity="0.7" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill="var(--panel)" />
          <g shapeRendering="crispEdges">
            {terrain.map((t, i) => <rect key={i} x={t.x} y={t.y} width={t.w} height={12} fill="var(--ink)" fillOpacity={bandOpacity[t.b]} />)}
          </g>
          {/* graticule */}
          <g stroke="var(--ink-2)" strokeOpacity="0.35" strokeWidth="1">
            {latLines.filter(isHalf).map((v) => { const y = proj.toXY({ lat: v, lon: proj.center.lon }).y; return <line key={`la${v}`} x1={0} y1={y} x2={W} y2={y} />; })}
            {lonLines.filter(isHalf).map((v) => { const x = proj.toXY({ lat: proj.center.lat, lon: v }).x; return <line key={`lo${v}`} x1={x} y1={0} x2={x} y2={H} />; })}
          </g>
          {mefs.map((m, i) => (
            <text key={`mef${i}`} x={m.x} y={m.y} textAnchor="middle" className="mef" fill="var(--ink-2)" fillOpacity="0.8" style={halo}>
              <tspan fontSize="22">{m.thousands}</tspan>
              <tspan fontSize="13" dy="-8">{m.hundreds}</tspan>
            </text>
          ))}
          {airspaceNodes}
          {symbolNodes}
          {routeNodes}
          {extras}
          {labels.map((l) => l.node)}
          {/* frame and ticks */}
          <g stroke="var(--ink)" strokeWidth="1.5" fill="none">
            <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} />
            {latLines.map((v) => { const y = proj.toXY({ lat: v, lon: proj.center.lon }).y; const l = isHalf(v) ? 10 : 5; return <g key={`t${v}`}><line x1={0} y1={y} x2={l} y2={y} /><line x1={W - l} y1={y} x2={W} y2={y} /></g>; })}
            {lonLines.map((v) => { const x = proj.toXY({ lat: proj.center.lat, lon: v }).x; const l = isHalf(v) ? 10 : 5; return <g key={`u${v}`}><line x1={x} y1={0} x2={x} y2={l} /><line x1={x} y1={H - l} x2={x} y2={H} /></g>; })}
          </g>
          <g fill="var(--ink)" fontSize="11" fontWeight="600" style={halo}>
            {latTexts.map((t) => <text key={`lt${t.v}`} x={13} y={t.y - 3}>{fmtDeg(t.v, ['N', 'S'])}</text>)}
            {lonTexts.map((t) => <text key={`ln${t.v}`} x={t.x + 4} y={H - 14}>{fmtDeg(t.v, ['E', 'W'])}</text>)}
          </g>
          {/* north arrows: true, and magnetic turned by the variation */}
          <g transform={`translate(${roseBox.x + 30} ${roseBox.y + 36})`}>
            <rect x="-30" y="-36" width="60" height="70" rx="6" fill="var(--panel)" fillOpacity="0.9" />
            <line x1="0" y1="26" x2="0" y2="-20" stroke="var(--ink)" strokeWidth="1.8" />
            <polygon points="0,-26 -4,-16 4,-16" fill="var(--ink)" />
            <text x="0" y="-27" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--ink)">N</text>
            <g transform={`rotate(${region.variationDeg})`}>
              <line x1="0" y1="24" x2="0" y2="-14" stroke={MAGENTA} strokeWidth="1.4" strokeDasharray="3 2" />
              <polygon points="0,-20 -3,-12 3,-12" fill={MAGENTA} />
            </g>
            <text x="0" y="33" textAnchor="middle" fontSize="11" fontWeight="600" fill={MAGENTA}>MN {varLabel}</text>
          </g>
          {/* scale bar */}
          <g transform={`translate(${scaleBox.x + 10} ${scaleBox.y + 8})`}>
            <rect x="-6" y="-8" width={nm(scaleNm) + 12} height="26" rx="4" fill="var(--panel)" fillOpacity="0.9" />
            <line x1="0" y1="6" x2={nm(scaleNm)} y2="6" stroke="var(--ink)" strokeWidth="2" />
            {[0, 0.5, 1].map((f) => <line key={f} x1={nm(scaleNm) * f} y1="2" x2={nm(scaleNm) * f} y2="10" stroke="var(--ink)" strokeWidth="2" />)}
            <text x={nm(scaleNm) / 2} y="-1" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)" className="mono-num">{scaleNm} nm</text>
          </g>
          {/* the sign */}
          <g transform={`translate(${signBox.x} ${signBox.y})`}>
            <rect width={signBox.w} height={signBox.h} rx="4" fill="var(--sign)" />
            <text x="8" y="15" fontSize="11" fontWeight="700" fill="var(--taxi)">{signText}</text>
          </g>
        </svg>
      )}
    </div>
  );
}
