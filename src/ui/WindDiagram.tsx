// Runway and wind drawn to the actual numbers. Magnetic north is up, because
// that's how the runway is numbered. The METAR wind arrives in degrees true
// and is converted before it goes on the diagram; both values are labeled.

import type { Airport } from '../data/airports';
import type { Wind } from '../lib/metar';
import { norm } from '../lib/wind';
import type { RunwayWind } from '../scenarios/goNoGo';

const C = 110;
const R = 92;

function dir(headingDeg: number): [number, number] {
  const r = (headingDeg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}
function pt(headingDeg: number, radius: number): [number, number] {
  const [dx, dy] = dir(headingDeg);
  return [C + dx * radius, C + dy * radius];
}

export function WindDiagram({ airport, wind, rw }: { airport: Airport; wind: Wind | null; rw: RunwayWind | null }) {
  const ends = airport.runways;
  const axis = ends[0];
  const half = 70;
  const trueNorthMag = norm(0 - airport.magneticVariationDeg);
  const windMag = rw?.windMag ?? null;
  const speed = wind?.speedKt ?? 0;
  const arrowLen = Math.min(26 + speed * 1.6, 62);
  const label = wind
    ? wind.dirTrue === null
      ? wind.speedKt === 0
        ? 'Calm'
        : `VRB ${wind.speedKt} kt`
      : `${String(wind.dirTrue).padStart(3, '0')}° true`
    : 'No wind report';

  return (
    <svg viewBox="0 0 220 220" role="img" aria-label={`Runway ${ends.map((e) => e.id).join('/')} with wind ${label}${windMag !== null ? `, ${windMag} degrees magnetic` : ''}`}>
      <circle cx={C} cy={C} r={R} fill="var(--chart)" stroke="var(--rule)" />
      {/* compass ticks every 30 degrees */}
      {Array.from({ length: 12 }, (_, i) => {
        const [x1, y1] = pt(i * 30, R);
        const [x2, y2] = pt(i * 30, R - (i % 3 === 0 ? 9 : 5));
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth={i === 0 ? 2 : 1} />;
      })}
      {(['N', 'E', 'S', 'W'] as const).map((l, i) => {
        const [x, y] = pt(i * 90, R + 12);
        return (
          <text key={l} x={x} y={y + 3.5} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--muted)">
            {l}
          </text>
        );
      })}
      {/* true north reference */}
      {(() => {
        const [x1, y1] = pt(trueNorthMag, R);
        const [x2, y2] = pt(trueNorthMag, R - 18);
        const [tx, ty] = pt(trueNorthMag, R + 11);
        return (
          <g>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--classb)" strokeWidth="1.4" strokeDasharray="3 2" />
            <text x={tx + 8} y={ty + 3} fontFamily="var(--mono)" fontSize="8" fill="var(--classb)">TN</text>
          </g>
        );
      })()}
      {/* runway */}
      <g transform={`rotate(${axis.headingMag} ${C} ${C})`}>
        <rect x={C - 11} y={C - half} width="22" height={half * 2} fill="var(--ink)" />
        <line x1={C} y1={C - half + 14} x2={C} y2={C + half - 14} stroke="var(--paper)" strokeWidth="1.2" strokeDasharray="6 5" />
      </g>
      {ends.map((e) => {
        // The runway number sits at the threshold you land toward when flying its heading.
        const [x, y] = pt(e.headingMag + 180, half + 13);
        return (
          <text key={e.id} x={x} y={y + 4} textAnchor="middle" fontFamily="var(--display)" fontWeight="700" fontSize="13" fill="var(--ink)">
            {e.id}
          </text>
        );
      })}
      {/* wind arrow */}
      {windMag !== null && (
        <g>
          {(() => {
            const [sx, sy] = pt(windMag, R - 4);
            const [ex, ey] = pt(windMag, R - 4 - arrowLen);
            const [hx, hy] = pt(windMag, R - 4 - arrowLen + 9);
            const [px, py] = dir(windMag + 90);
            return (
              <>
                <line x1={sx} y1={sy} x2={hx} y2={hy} stroke="var(--magenta)" strokeWidth="3" />
                <polygon points={`${ex},${ey} ${hx + px * 5},${hy + py * 5} ${hx - px * 5},${hy - py * 5}`} fill="var(--magenta)" />
              </>
            );
          })()}
          {wind?.gustKt && (() => {
            const [gx, gy] = pt(windMag, R - 4);
            const [g2x, g2y] = pt(windMag, R + 6);
            return <line x1={gx} y1={gy} x2={g2x} y2={g2y} stroke="var(--magenta)" strokeWidth="3" strokeDasharray="2 2" />;
          })()}
        </g>
      )}
      {windMag === null && (
        <text x={C} y={C + 4} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--paper)">
          {label}
        </text>
      )}
      {/* axis labels */}
      <text x="6" y="214" fontFamily="var(--mono)" fontSize="8" fill="var(--muted)">
        MAG N UP · VAR {Math.abs(airport.magneticVariationDeg)}°{airport.magneticVariationDeg < 0 ? 'W' : 'E'}
      </text>
      <text x="214" y="214" textAnchor="end" fontFamily="var(--mono)" fontSize="8" fill="var(--muted)">
        {airport.icao}
      </text>
    </svg>
  );
}
