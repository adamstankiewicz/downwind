// The Trip plan view: home in the middle, range rings, the fields in play.
// North up and to scale, but schematic: no terrain, no airspace, never a
// chart. The caption says so wherever it appears.
//
// Labels are placed after the points are known: each one tries a few seats
// around its dot and takes the first that clears every label and dot already
// placed, so idents stay readable when fields cluster on one side of home.

import type { LatLon } from '../lib/nav';
import { distanceNm, trueCourse } from '../lib/nav';
import type { MapPoint } from '../course/types';

const W = 560;
const H = 440;
const MARGIN = 46;
const ID_PX = 7.4; // about one 12px mono character
const SUB_PX = 6.1; // about one 11px label character

interface Box { x: number; y: number; w: number; h: number }

const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

interface Placed { x: number; y: number; anchor: 'start' | 'end'; box: Box }

/** Seat a label of the given size next to a dot, clear of what is already on the page. */
function seat(cx: number, cy: number, r: number, w: number, h: number, taken: Box[]): Placed {
  const gap = r + 5;
  // Right, left, then the diagonals below and above. Order matters: the eye reads a label to the right first.
  const seats: Array<{ dx: number; dy: number; anchor: 'start' | 'end' }> = [
    { dx: gap, dy: 0, anchor: 'start' },
    { dx: -gap, dy: 0, anchor: 'end' },
    { dx: gap, dy: h / 2 + 2, anchor: 'start' },
    { dx: gap, dy: -(h / 2 + 2), anchor: 'start' },
    { dx: -gap, dy: h / 2 + 2, anchor: 'end' },
    { dx: -gap, dy: -(h / 2 + 2), anchor: 'end' },
    { dx: 0, dy: h / 2 + gap + 4, anchor: 'start' },
    { dx: 0, dy: -(h / 2 + gap + 4), anchor: 'start' },
  ];
  let best: Placed | null = null;
  let bestCost = Infinity;
  for (const s of seats) {
    const x = cx + s.dx;
    const y = cy + s.dy; // the vertical middle of the label block
    const box: Box = { x: s.anchor === 'start' ? x : x - w, y: y - h / 2, w, h };
    const outside = Math.max(0, -box.x) + Math.max(0, box.x + box.w - W) + Math.max(0, -box.y) + Math.max(0, box.y + box.h - H);
    const cost = taken.reduce((c, t) => c + overlapArea(box, t), 0) + outside * 40;
    if (cost < bestCost) { bestCost = cost; best = { x, y, anchor: s.anchor, box }; }
    if (cost === 0) break;
  }
  return best!;
}

export function TripMap({ home, points, ringsNm, route, marker, label }: {
  home: MapPoint;
  points: MapPoint[];
  ringsNm: number[];
  route?: [string, string];
  marker?: LatLon;
  label: string;
}) {
  // Polar from home, so distances read true against the rings.
  const rings = [...ringsNm].sort((p, q) => p - q);
  const polar = (p: LatLon) => {
    const nm = distanceNm(home.pos, p);
    const b = (trueCourse(home.pos, p) * Math.PI) / 180;
    return { x: nm * Math.sin(b), y: -nm * Math.cos(b), nm };
  };
  // Scale to the fields in play, not the outer ring: a ring past the edge still reads as a radius,
  // while fields crowded into the middle do not. The smallest ring always fits, so the scale is legible.
  const reach = Math.max(...points.map((p) => polar(p.pos).nm), marker ? polar(marker).nm : 0);
  const far = Math.max(10, rings[0] ?? 0, reach * 1.12);
  const scale = (Math.min(W, H) / 2 - MARGIN) / far;
  const visibleRing = (r: number) => r * scale < Math.hypot(W / 2, H / 2);
  const labelledRing = (r: number) => r * scale * Math.SQRT1_2 < Math.min(W / 2 - 64, H / 2 - 24);
  const xy = (p: LatLon) => {
    const q = polar(p);
    return { x: W / 2 + q.x * scale, y: H / 2 + q.y * scale };
  };
  const all = [home, ...points];
  const at = (id: string) => all.find((p) => p.id === id);
  const a = route && at(route[0]);
  const b = route && at(route[1]);
  const m = marker && xy(marker);

  // What a label must not cover: the north arrow, every dot, the airplane, then each label as it lands.
  const taken: Box[] = [{ x: W - 52, y: 8, w: 44, h: 48 }];
  const radius = (p: MapPoint) => (p.role === 'home' ? 9 : p.role === 'filtered' ? 4 : 6);
  const dots = all.map((p) => ({ p, q: p.role === 'home' ? { x: W / 2, y: H / 2 } : xy(p.pos) }));
  for (const d of dots) { const r = radius(d.p) + 2; taken.push({ x: d.q.x - r, y: d.q.y - r, w: 2 * r, h: 2 * r }); }
  if (m) taken.push({ x: m.x - 12, y: m.y - 12, w: 24, h: 24 });

  // Ring labels sit on the ring, up and to the right of home, so they never cross a route drawn due north.
  const ringLabels = rings.filter(labelledRing).map((r) => {
    const x = W / 2 + r * scale * Math.SQRT1_2;
    const y = H / 2 - r * scale * Math.SQRT1_2;
    const text = `${r} nm`;
    const box: Box = { x: x + 4, y: y - 12, w: text.length * SUB_PX + 4, h: 14 };
    taken.push(box);
    return { r, x: x + 6, y: y - 2, text };
  });

  // Home first, then the fields that matter, then the ones left out: the important labels get the good seats.
  const order = ['home', 'dest', 'pick', 'alternate', 'filtered'];
  const labels = [...dots]
    .sort((u, v) => order.indexOf(u.p.role) - order.indexOf(v.p.role))
    .map(({ p, q }) => {
      const w = Math.max(p.label.length * ID_PX, (p.sub?.length ?? 0) * SUB_PX) + 2;
      const h = p.sub ? 27 : 13;
      const s = seat(q.x, q.y, radius(p), w, h, taken);
      taken.push(s.box);
      return { p, s, h };
    });

  return (
    <svg className="tripmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <g className="tm-rings">
        {rings.filter(visibleRing).map((r) => <circle key={r} cx={W / 2} cy={H / 2} r={r * scale} className="tm-ring" />)}
        {rings.length > 0 && <line x1={W / 2} y1={Math.max(0, H / 2 - rings[rings.length - 1] * scale)} x2={W / 2} y2={H / 2} className="tm-meridian" />}
        {ringLabels.map((l) => <text key={l.r} x={l.x} y={l.y} className="tm-ring-label">{l.text}</text>)}
      </g>
      <g className="tm-north" transform={`translate(${W - 30} 28)`}>
        <path d="M0 -13 L5 5 L0 1.5 L-5 5 Z" />
        <text y="20" textAnchor="middle">N</text>
      </g>
      {a && b && (() => {
        const p = xy(a.pos);
        const q = xy(b.pos);
        return <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="tm-route" />;
      })()}
      {dots.filter((d) => d.p.role === 'filtered').map(({ p, q }) => (
        <circle key={p.id} cx={q.x} cy={q.y} r={4} className="tm-dot tm-filtered" />
      ))}
      {dots.filter((d) => d.p.role !== 'filtered' && d.p.role !== 'home').map(({ p, q }) => (
        <circle key={p.id} cx={q.x} cy={q.y} r={6} className={`tm-dot tm-${p.role}`} />
      ))}
      <g className="tm-home">
        <circle cx={W / 2} cy={H / 2} r={9} />
        <circle cx={W / 2} cy={H / 2} r={3} className="tm-home-dot" />
      </g>
      {m && (
        <g className="tm-airplane" transform={`translate(${m.x} ${m.y})${a && b ? ` rotate(${trueCourse(a.pos, b.pos)})` : ''}`}>
          <path d="M0 -10 L2.2 -2 L10 1 L10 3.2 L2.2 2.2 L1.2 7.5 L4.5 9.6 L4.5 11 L0 10 L-4.5 11 L-4.5 9.6 L-1.2 7.5 L-2.2 2.2 L-10 3.2 L-10 1 L-2.2 -2 Z" />
        </g>
      )}
      <g className="tm-labels">
        {labels.map(({ p, s, h }) => (
          <g key={p.id} className={`tm-label tm-${p.role}`}>
            <text x={s.x} y={s.y - h / 2 + 11} textAnchor={s.anchor} className="tm-id">{p.label}</text>
            {p.sub && <text x={s.x} y={s.y - h / 2 + 24} textAnchor={s.anchor} className="tm-sub">{p.sub}</text>}
          </g>
        ))}
      </g>
    </svg>
  );
}
