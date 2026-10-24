// TAF periods laid across the departure-to-return window. FM and base
// periods fill the top row; TEMPO, BECMG and PROB groups sit underneath
// because they modify rather than replace the forecast.

import { hoursFrom, type Taf, type TafPeriod } from '../lib/taf';
import type { FlightCategory } from '../lib/metar';
import { useEffect, useState } from 'react';
import { fmtLocal } from './state';

function useNarrow(query = '(max-width: 559px)'): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

export const CAT_COLOR: Record<FlightCategory, string> = {
  VFR: 'var(--vfr)',
  MVFR: 'var(--mvfr)',
  IFR: 'var(--ifr)',
  LIFR: 'var(--lifr)',
};

function color(p: TafPeriod): string {
  return p.category ? CAT_COLOR[p.category] : 'var(--rule)';
}

function windText(p: TafPeriod): string {
  const w = p.wind;
  if (!w) return '';
  const d = w.dirTrue === null ? 'VRB' : String(w.dirTrue).padStart(3, '0');
  return `${d}/${w.speedKt}${w.gustKt ? `G${w.gustKt}` : ''}`;
}

export function TafTimeline({ taf, departure, tripHours }: { taf: Taf | null; departure: Date; tripHours: number }) {
  const narrow = useNarrow();
  if (!taf) {
    return <p className="muted">No TAF available for this field or a nearby station.</p>;
  }
  const pad = 1; // hours of context either side
  const h0 = -pad;
  const h1 = tripHours + pad;
  const W = narrow ? 360 : 640;
  const H = 96;
  const left = 8;
  const right = W - 8;
  const x = (h: number) => left + ((h - h0) / (h1 - h0)) * (right - left);

  const spans = taf.periods
    .map((p) => {
      if (!p.from) return null;
      const a = hoursFrom(departure, p.from);
      const b = p.to ? hoursFrom(departure, p.to) : a + 24;
      return { p, a: Math.max(a, h0), b: Math.min(b, h1), realA: a, realB: b };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null && s.b > s.a);

  const main = spans.filter((s) => s.p.kind === 'BASE' || s.p.kind === 'FM');
  const mods = spans.filter((s) => s.p.kind !== 'BASE' && s.p.kind !== 'FM');
  const inWindow = spans.filter((s) => s.realB > 0 && s.realA < tripHours);

  const ticks: number[] = [];
  const step = tripHours > 8 ? 2 : 1;
  for (let h = 0; h <= tripHours; h += step) ticks.push(h);
  const ret = new Date(departure.getTime() + tripHours * 3_600_000);

  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`TAF timeline from ${fmtLocal(departure)} departure to ${fmtLocal(ret)} return`}>
        {/* window shading */}
        <rect x={x(0)} y="6" width={x(tripHours) - x(0)} height={H - 28} fill="var(--tint-b)" />
        {/* main periods */}
        {main.map((s, i) => {
          const w = x(s.b) - x(s.a);
          return (
            <g key={`m${i}`}>
              <rect x={x(s.a)} y="14" width={w} height="26" fill={color(s.p)} opacity="0.9" />
              {w > 60 && (
                <text x={x(s.a) + 6} y="31" fontFamily="var(--body)" fontSize="11" fill="#fff" fontWeight="600">
                  {s.p.category ?? '—'} {windText(s.p)}
                </text>
              )}
            </g>
          );
        })}
        {/* modifier periods */}
        {mods.map((s, i) => {
          const w = x(s.b) - x(s.a);
          return (
            <g key={`t${i}`}>
              <rect x={x(s.a)} y="46" width={w} height="12" fill={color(s.p)} opacity="0.55" />
              {w > 70 && (
                <text x={x(s.a) + 4} y="56" fontFamily="var(--body)" fontSize="9" fill="var(--ink)">
                  {s.p.kind}{s.p.probability ? s.p.probability : ''} {s.p.category ?? ''}
                </text>
              )}
            </g>
          );
        })}
        {/* axis */}
        <line x1={left} y1={H - 22} x2={right} y2={H - 22} stroke="var(--ink)" />
        {ticks.map((h) => (
          <g key={h}>
            <line x1={x(h)} y1={H - 26} x2={x(h)} y2={H - 18} stroke="var(--ink)" />
            <text x={x(h)} y={H - 6} textAnchor="middle" fontFamily="var(--body)" fontSize="10" fill="var(--muted)">
              {h === 0 ? 'Depart' : h === tripHours ? 'Return' : `+${h} h`}
            </text>
          </g>
        ))}
        {/* departure and return markers */}
        <line x1={x(0)} y1="6" x2={x(0)} y2={H - 22} stroke="var(--ink)" strokeWidth="1.5" />
        <line x1={x(tripHours)} y1="6" x2={x(tripHours)} y2={H - 22} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
      <div className="timeline-cap">
        <span>Depart {fmtLocal(departure)} local</span>
        <span>Return {fmtLocal(ret)} local, {tripHours} h away</span>
      </div>
      {inWindow.length === 0 ? (
        <p className="help">
          This TAF ({taf.station}, valid {taf.validFrom ? `${String(taf.validFrom.day).padStart(2, '0')}${String(taf.validFrom.hour).padStart(2, '0')}` : '?'}/
          {taf.validTo ? `${String(taf.validTo.day).padStart(2, '0')}${String(taf.validTo.hour).padStart(2, '0')}Z` : '?'}) does not cover your window.
        </p>
      ) : (
        <ul className="taf-list plain">
          {inWindow.map((s, i) => (
            <li key={i}>
              <i style={{ background: color(s.p) }} />
              <span>{s.p.raw}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
