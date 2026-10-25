// The side view of a path across the practice sectional, the sketch a CFI
// draws on the whiteboard: distance along the path across, altitude MSL up,
// the ground as a silhouette, every floor and ceiling overhead as a box in
// the chart's own idiom (solid blue B, dashed blue D, magenta C, hatched
// borders on the special use areas) labeled the way the chart prints them,
// and the planned altitude as one bold line with the airplane on it. The
// numbers all come from profileAlong; this file only draws them. Like the
// chart, the SVG is sized in device pixels, so nothing is under 11px.

import { useEffect, useId, useRef, useState } from 'react';
import type { Volume } from '../lib/airspace';
import type { Profile, ProfileBand } from '../scenarios/airspacePlan';
import { placeLabel, placeLabelLoose, textWidth, type Box } from './projection';

export interface ProfileMark {
  atNm: number;
  label: string;
}

const BLUE = 'var(--sky)';
const BLUE_INK = 'var(--sky-ink)';
const MAGENTA = 'var(--sock-ink)';
const AIRPLANE = 'M0,-9 L2,-3 L10,1 L10,3 L2,1.5 L1.5,6 L4,8 L4,9 L0,8 L-4,9 L-4,8 L-1.5,6 L-2,1.5 L-10,3 L-10,1 L-2,-3 Z';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const isBlue = (cls: Volume['cls']) => cls === 'B' || cls === 'D' || cls === 'Restricted' || cls === 'Prohibited';
const hatched = (cls: Volume['cls']) => cls === 'Restricted' || cls === 'Prohibited' || cls === 'TFR' || cls === 'MOA';

/** A band's floor or ceiling the way the chart prints it: hundreds of feet, SFC for the ground. */
const limitText = (b: ProfileBand, which: 'floor' | 'ceiling') => (which === 'floor' && b.surface ? 'SFC' : String(Math.round(b[`${which}Msl`] / 100)));

/** "Bayport Class B" from "Bayport Class B, 3,000 ft shelf": the fraction says the rest. */
const shortName = (name: string) => name.split(',')[0];

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

export function ProfileFigure({ profile, marks = [], airplaneAtNm }: { profile: Profile; marks?: ProfileMark[]; airplaneAtNm?: number }) {
  const [boxRef, measured] = useBoxWidth();
  const uid = useId().replace(/:/g, '');
  const W = measured || 700;
  const H = Math.round(Math.min(340, Math.max(260, W * 0.5)));
  const { samples, bands, distanceNm } = profile;

  // The plot: a left margin wide enough for "10,000", a bottom deep enough for two rows of labels.
  const L = 48; const R = 14; const T = 22; const B = 48;
  const plot: Box = { x: L, y: T, w: W - L - R, h: H - T - B };
  const planMax = Math.max(...samples.map((s) => s.altMsl));
  // Altitude runs from the ground up to a bit above the plan; taller ceilings are clipped, not squashed.
  const yTop = Math.ceil(Math.max(planMax + 3000, 6000) / 1000) * 1000;
  const gridStep = yTop > 8000 ? 2000 : 1000;
  const x = (nm: number) => plot.x + (nm / distanceNm) * plot.w;
  const y = (ft: number) => plot.y + plot.h - (ft / yTop) * plot.h;
  // Distance ticks far enough apart to read, whatever the width.
  const tickNm = [1, 2, 5, 10, 20].find((t) => (plot.w / distanceNm) * t >= 44) ?? 50;
  const ticks: number[] = [];
  for (let n = 0; n <= distanceNm + 1e-6; n += tickNm) ticks.push(n);
  const grid: number[] = [];
  for (let ft = gridStep; ft <= yTop; ft += gridStep) grid.push(ft);

  const halo = { paintOrder: 'stroke' as const, stroke: 'var(--panel)', strokeWidth: 3, strokeLinejoin: 'round' as const };
  const labels: React.ReactNode[] = [];

  // --- the planned altitude, and where the airplane is on it ---
  const altPath = samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.alongNm).toFixed(1)},${y(s.altMsl).toFixed(1)}`).join(' ');
  const altAt = (nm: number) => {
    const i = samples.findIndex((s) => s.alongNm >= nm);
    if (i <= 0) return samples[Math.max(0, i)].altMsl;
    const a = samples[i - 1]; const b = samples[i];
    const f = b.alongNm === a.alongNm ? 0 : (nm - a.alongNm) / (b.alongNm - a.alongNm);
    return a.altMsl + (b.altMsl - a.altMsl) * f;
  };
  const plane = airplaneAtNm !== undefined ? { nm: Math.min(distanceNm, Math.max(0, airplaneAtNm)), alt: altAt(airplaneAtNm) } : null;
  // The line and the airplane are placed first, as a chain of small boxes, so no label lands on them.
  const placed: Box[] = samples.filter((_, i) => i % 2 === 0).map((s) => ({ x: x(s.alongNm) - 4, y: y(s.altMsl) - 4, w: 8, h: 8 }));
  if (plane) placed.push({ x: x(plane.nm) - 13, y: y(plane.alt) - 13, w: 26, h: 26 });

  // --- the ground, closed below the plot so it fills ---
  const groundPath = `M${x(0).toFixed(1)},${y(samples[0].groundFt).toFixed(1)} ` + samples.map((s) => `L${x(s.alongNm).toFixed(1)},${y(s.groundFt).toFixed(1)}`).join(' ');
  const groundFill = `${groundPath} L${(plot.x + plot.w).toFixed(1)},${plot.y + plot.h} L${plot.x},${plot.y + plot.h} Z`;

  // --- the bands, one box each, labeled by the chart's fraction ---
  // The name is printed once per volume family, on its widest band; the others carry only their numbers.
  const widest = new Map<string, string>();
  for (const b of [...bands].sort((p, q) => (q.toNm - q.fromNm) - (p.toNm - p.fromNm))) {
    if (!widest.has(shortName(b.name))) widest.set(shortName(b.name), b.volumeId);
  }
  const namedIds = new Set(widest.values());
  const bandNodes: React.ReactNode[] = [];
  for (const b of bands) {
    const color = isBlue(b.cls) ? BLUE : MAGENTA;
    const ink = isBlue(b.cls) ? BLUE_INK : MAGENTA;
    const clipped = b.ceilingMsl > yTop;
    const x0 = x(b.fromNm); const x1 = x(b.toNm);
    const top = clipped ? plot.y - 6 : y(b.ceilingMsl);
    // A surface area's floor is the ground: the box runs under the silhouette, which covers it.
    const bottom = b.surface ? plot.y + plot.h + 6 : y(b.floorMsl);
    const w = Math.max(1, x1 - x0); const h = Math.max(1, bottom - top);
    const clipId = `${uid}-band-${b.volumeId}-${Math.round(b.fromNm * 10)}`;
    const dashed = b.cls === 'D';
    bandNodes.push(
      <g key={clipId}>
        <rect x={x0} y={top} width={w} height={h} fill={color} fillOpacity={dashed ? 0.05 : 0.09} />
        {hatched(b.cls) && (
          <g>
            <defs><clipPath id={clipId}><rect x={x0} y={top} width={w} height={h} /></clipPath></defs>
            <rect x={x0} y={top} width={w} height={h} fill="none" stroke={`url(#${uid}-hatch-${isBlue(b.cls) ? 'b' : 'm'})`} strokeWidth="18" clipPath={`url(#${clipId})`} />
          </g>
        )}
        <rect x={x0} y={top} width={w} height={h} fill="none" stroke={color} strokeWidth={dashed ? 1.8 : 2} strokeDasharray={dashed ? '6 4' : undefined} />
      </g>,
    );
    // The fraction and name sit in the box when they fit, else beside it; when
    // even that is crowded the name goes and the numbers stay.
    const ceil = limitText(b, 'ceiling'); const floor = limitText(b, 'floor');
    const fullName = namedIds.has(b.volumeId) ? shortName(b.name) : '';
    const fw = Math.max(textWidth(ceil, 12), textWidth(floor, 12)) + 6;
    // The visible part of the box: inside the plot, and above the ground.
    const groundTop = Math.min(...samples.filter((s) => s.alongNm >= b.fromNm - 0.3 && s.alongNm <= b.toNm + 0.3).map((s) => y(s.groundFt)));
    const visTop = Math.max(top, plot.y); const visBot = Math.min(bottom, plot.y + plot.h, groundTop);
    const cx = (x0 + x1) / 2; const cy = (visTop + visBot) / 2;
    const candidates = (lw: number, lh: number): Box[][] => [
      [{ x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh }, { x: cx - lw / 2, y: visTop + 8, w: lw, h: lh }, { x: cx - lw / 2, y: visBot - lh - 8, w: lw, h: lh }],
      [{ x: cx - lw / 2, y: visTop - lh - 4, w: lw, h: lh }, { x: cx - lw / 2, y: visBot + 4, w: lw, h: lh }, { x: x1 + 6, y: visTop + 4, w: lw, h: lh }, { x: x0 - lw - 6, y: visTop + 4, w: lw, h: lh }, { x: x1 + 6, y: cy - lh / 2, w: lw, h: lh }, { x: x0 - lw - 6, y: cy - lh / 2, w: lw, h: lh }],
    ];
    let name = fullName;
    let lw = Math.max(fw, name ? textWidth(name, 11) + 4 : 0);
    let lh = 30 + (name ? 14 : 0);
    const bareW = fw; const bareH = 30;
    // Text may overhang a box edge by a few pixels; the halo keeps it readable.
    const fits = (bw: number, bh: number) => w >= bw - 6 && visBot - visTop >= bh + 6;
    const [fullIn, fullOut] = candidates(lw, lh);
    const [bareIn, bareOut] = candidates(bareW, bareH);
    let got = fits(lw, lh) ? placeLabel(placed, fullIn, plot) : null;
    if (!got && name && fits(bareW, bareH)) {
      const bare = placeLabel(placed, bareIn, plot);
      if (bare) { got = bare; name = ''; }
    }
    if (!got) got = placeLabel(placed, fullOut, plot);
    if (!got && name) {
      const bare = placeLabel(placed, bareOut, plot);
      if (bare) { got = bare; name = ''; }
    }
    if (!got) got = placeLabelLoose(placed, fits(lw, lh) ? fullIn : fullOut, plot);
    if (!name) { lw = bareW; lh = bareH; }
    placed.push(got);
    // A name that would not fit with its numbers still goes beside the box when there is room.
    if (fullName && !name) {
      const nw = textWidth(fullName, 11) + 4;
      const spot = placeLabel(placed, [
        { x: cx - nw / 2, y: visTop - 18, w: nw, h: 14 }, { x: x1 - nw, y: visTop - 18, w: nw, h: 14 }, { x: x0, y: visTop - 18, w: nw, h: 14 },
        { x: cx - nw / 2, y: visBot + 4, w: nw, h: 14 }, { x: x1 - nw, y: visBot + 4, w: nw, h: 14 }, { x: x0, y: visBot + 4, w: nw, h: 14 },
      ], plot);
      if (spot) {
        placed.push(spot);
        labels.push(<text key={`name-${clipId}`} x={spot.x + nw / 2} y={spot.y + 11} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)" style={halo}>{fullName}</text>);
      }
    }
    const mx = got.x + lw / 2;
    labels.push(
      <g key={`lbl-${clipId}`} fill={ink} fontWeight="700" style={halo}>
        <text x={mx} y={got.y + 12} textAnchor="middle" fontSize="12">{ceil}</text>
        <line x1={mx - fw / 2 + 2} y1={got.y + 15.5} x2={mx + fw / 2 - 2} y2={got.y + 15.5} stroke={ink} strokeWidth="1.2" />
        <text x={mx} y={got.y + 27} textAnchor="middle" fontSize="12">{floor}</text>
        {name && <text x={mx} y={got.y + 41} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">{name}</text>}
      </g>,
    );
    // A box taller than the plot says where it really ends.
    if (clipped && w >= 60) {
      const t = `to ${fmt(b.ceilingMsl)}`;
      const tw = textWidth(t, 11) + 4;
      const box = placeLabel(placed, [{ x: x1 - tw - 4, y: plot.y + 3, w: tw, h: 13 }, { x: x0 + 4, y: plot.y + 3, w: tw, h: 13 }], plot);
      if (box) placed.push(box);
      if (box) labels.push(<text key={`to-${clipId}`} x={box.x + 2} y={box.y + 10} fontSize="11" fontWeight="600" fill={ink} style={halo}>{t}</text>);
    }
  }

  // --- the airplane's label, then the altitude at each end ---
  const extras: React.ReactNode[] = [];
  if (plane) {
    const px = x(plane.nm); const py = y(plane.alt);
    const t = `${fmt(plane.alt)} ft`;
    const tw = textWidth(t, 12) + 4;
    const box = placeLabelLoose(placed, [{ x: px - tw / 2, y: py - 30, w: tw, h: 14 }, { x: px + 15, y: py - 7, w: tw, h: 14 }, { x: px - tw - 15, y: py - 7, w: tw, h: 14 }, { x: px - tw / 2, y: py + 16, w: tw, h: 14 }], plot);
    placed.push(box);
    extras.push(
      <g key="plane">
        <path transform={`translate(${px} ${py}) rotate(90) scale(1.3)`} d={AIRPLANE} fill="var(--ink)" stroke="var(--panel)" strokeWidth="1.2" strokeLinejoin="round" />
        <text x={box.x + tw / 2} y={box.y + 11} textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--ink)" style={halo}>{t}</text>
      </g>,
    );
  }
  // The altitude at each end of the line, unless the airplane already says that number or sits right there.
  const ends = [samples[0], samples[samples.length - 1]].map((s, i) => ({ s, end: i === 1 }));
  for (const { s, end } of ends) {
    if (plane && (Math.abs(plane.alt - s.altMsl) < 1 || Math.abs(x(plane.nm) - x(s.alongNm)) < 56)) continue;
    const t = `${fmt(s.altMsl)} ft`;
    const tw = textWidth(t, 11) + 4;
    const ex = x(s.alongNm); const ey = y(s.altMsl);
    const box = placeLabelLoose(placed, end
      ? [{ x: ex - tw - 2, y: ey - 18, w: tw, h: 13 }, { x: ex - tw - 2, y: ey + 6, w: tw, h: 13 }]
      : [{ x: ex + 2, y: ey - 18, w: tw, h: 13 }, { x: ex + 2, y: ey + 6, w: tw, h: 13 }], plot);
    placed.push(box);
    extras.push(<text key={`end-${end}`} x={box.x + 2} y={box.y + 10} fontSize="11" fontWeight="700" fill="var(--ink)" style={halo}>{t}</text>);
  }

  const desc = `Side view along ${Math.round(distanceNm)} nm of the practice sectional. ${bands.map((b) => `${b.name} from ${b.fromNm} to ${b.toNm} nm, ${b.surface ? 'surface' : `${fmt(b.floorMsl)} ft`} to ${fmt(b.ceilingMsl)} ft`).join('; ')}.${plane ? ` You at ${fmt(plane.alt)} ft, ${Math.round(plane.nm)} nm along.` : ''}`;

  return (
    <div ref={boxRef} className="profile">
      {measured > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={desc}>
          <defs>
            <pattern id={`${uid}-hatch-b`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={BLUE} strokeWidth="1.4" strokeOpacity="0.7" />
            </pattern>
            <pattern id={`${uid}-hatch-m`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={MAGENTA} strokeWidth="1.4" strokeOpacity="0.7" />
            </pattern>
            <clipPath id={`${uid}-plot`}><rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} /></clipPath>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill="var(--panel)" />
          {/* altitude gridlines */}
          <g stroke="var(--line-soft)" strokeWidth="1">
            {grid.map((ft) => <line key={ft} x1={plot.x} y1={y(ft)} x2={plot.x + plot.w} y2={y(ft)} />)}
          </g>
          <g fill="var(--ink-2)" fontSize="11" fontWeight="500" textAnchor="end">
            {grid.map((ft) => <text key={ft} x={plot.x - 8} y={y(ft) + 4}>{fmt(ft)}</text>)}
          </g>
          <text x={plot.x - 8} y={plot.y - 9} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--ink-2)">ft MSL</text>
          <g clipPath={`url(#${uid}-plot)`}>
            {bandNodes}
            {/* the ground */}
            <path d={groundFill} fill="var(--panel)" />
            <path d={groundFill} fill="var(--ink)" fillOpacity="0.14" />
            <path d={groundPath} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
            {/* marks, as dotted guides up from the axis */}
            {marks.map((m) => <line key={m.label} x1={x(m.atNm)} y1={plot.y} x2={x(m.atNm)} y2={plot.y + plot.h} stroke="var(--ink-2)" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 4" />)}
            {/* the plan */}
            <path d={altPath} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {extras}
          </g>
          {labels}
          {/* the x axis: distance, then the marks */}
          <line x1={plot.x} y1={plot.y + plot.h + 0.75} x2={plot.x + plot.w} y2={plot.y + plot.h + 0.75} stroke="var(--ink)" strokeWidth="1.5" />
          <g fill="var(--ink-2)" fontSize="11" fontWeight="500">
            {ticks.map((n, i) => {
              const last = i === ticks.length - 1;
              const tx = x(n);
              return (
                <g key={n}>
                  <line x1={tx} y1={plot.y + plot.h} x2={tx} y2={plot.y + plot.h + 5} stroke="var(--ink)" strokeWidth="1.5" />
                  <text x={tx} y={plot.y + plot.h + 17} textAnchor={last ? 'end' : i === 0 ? 'start' : 'middle'}>{n}{last ? ' nm' : ''}</text>
                </g>
              );
            })}
          </g>
          <g fill="var(--ink)" fontSize="11" fontWeight="700">
            {marks.map((m) => {
              const mx = x(m.atNm);
              const anchor = mx < plot.x + 40 ? 'start' : mx > plot.x + plot.w - 40 ? 'end' : 'middle';
              return (
                <g key={m.label}>
                  <line x1={mx} y1={plot.y + plot.h} x2={mx} y2={plot.y + plot.h + 24} stroke="var(--ink)" strokeWidth="1.5" />
                  <text x={mx + (anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0)} y={plot.y + plot.h + 36} textAnchor={anchor}>{m.label}</text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
