// CG envelope drawn to scale from the profile's polygon, with the loaded point
// and the zero-fuel point so the burn-off line is visible. Everything above
// max gross is tinted, so a point up there reads as over before the label
// says so. Shared by the Airplane tool and the lesson figure.

import type { Envelope, WbResult } from '../lib/wb';

const fmt = (n: number) => n.toLocaleString('en-US');

export function CgChart({ envelope, loaded, zeroFuel, maxGrossLb }: { envelope: Envelope; loaded: WbResult; zeroFuel: WbResult; maxGrossLb: number }) {
  const xs = envelope.map((p) => p[0]).concat(loaded.cgIn, zeroFuel.cgIn);
  const ys = envelope.map((p) => p[1]).concat(loaded.totalLb, zeroFuel.totalLb, maxGrossLb);
  const xMin = Math.floor(Math.min(...xs) - 1);
  const xMax = Math.ceil(Math.max(...xs) + 1);
  const ok = loaded.withinEnvelope && !loaded.overGross;
  // A tall range gets 200 lb rows so the axis stays readable at phone width,
  // and the top keeps room for the loaded point's label, two lines when it is out.
  const yStep = Math.max(...ys) - Math.min(...ys) > 800 ? 200 : 100;
  const yMin = Math.floor((Math.min(...ys) - 80) / yStep) * yStep;
  const yMax = Math.ceil((Math.max(...ys) + (ok ? 100 : 180)) / yStep) * yStep;

  const W = 440;
  const H = 340;
  const ml = 54;
  const mr = 14;
  const mt = 14;
  const mb = 42;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const x = (cg: number) => ml + ((cg - xMin) / (xMax - xMin)) * pw;
  const y = (lb: number) => mt + (1 - (lb - yMin) / (yMax - yMin)) * ph;

  const xTicks: number[] = [];
  for (let v = xMin; v <= xMax; v += 1) xTicks.push(v);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += yStep) yTicks.push(v);

  const poly = envelope.map((p) => `${x(p[0])},${y(p[1])}`).join(' ');
  const over = loaded.totalLb - maxGrossLb;
  const state = loaded.overGross ? `${fmt(over)} lb over max gross` : loaded.withinEnvelope ? 'inside the envelope' : 'outside the envelope';

  // Labels sit on whichever side of their point has room.
  const side = (px: number) => (px < ml + pw / 2 ? 1 : -1);
  const lx = x(loaded.cgIn);
  const ly = y(loaded.totalLb);
  const ls = side(lx);
  const zx = x(zeroFuel.cgIn);
  const zy = y(zeroFuel.totalLb);
  const zs = side(zx);

  return (
    <div className="cg-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`CG envelope. Loaded ${fmt(loaded.totalLb)} lb at ${loaded.cgIn} inches, ${state}. Zero fuel ${fmt(zeroFuel.totalLb)} lb at ${zeroFuel.cgIn} inches.`}>
        <rect x={ml} y={mt} width={pw} height={ph} fill="var(--apron)" />
        {y(maxGrossLb) > mt && <rect x={ml} y={mt} width={pw} height={y(maxGrossLb) - mt} fill="var(--unsafe-tint)" fillOpacity="0.7" />}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} y1={mt} x2={x(v)} y2={H - mb} stroke="var(--line)" strokeWidth="1" />
            {(xTicks.length <= 12 || v % 2 === 0) && (
              <text x={x(v)} y={H - mb + 15} textAnchor="middle" fontSize="11" fill="var(--ink-2)">{v}</text>
            )}
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={ml} y1={y(v)} x2={W - mr} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={ml - 7} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-2)">{fmt(v)}</text>
          </g>
        ))}
        <polygon points={poly} fill="var(--sky-tint)" fillOpacity="0.9" stroke="var(--sky-ink)" strokeWidth="2" strokeLinejoin="round" />
        {/* max gross, drawn over the envelope so the line shows along its top edge */}
        <line x1={ml} y1={y(maxGrossLb)} x2={W - mr} y2={y(maxGrossLb)} stroke="var(--unsafe)" strokeWidth="1.5" strokeDasharray="5 3" />
        <text x={ml + 6} y={y(maxGrossLb) - 5} fontSize="11" fontWeight="600" fill="var(--unsafe)">Max gross {fmt(maxGrossLb)} lb</text>
        {/* burn line, zero fuel first so the loaded point sits on top */}
        <line x1={lx} y1={ly} x2={zx} y2={zy} stroke="var(--ink-2)" strokeWidth="1.75" strokeDasharray="3 3" />
        <circle cx={zx} cy={zy} r="5" fill="var(--panel)" stroke="var(--ink-2)" strokeWidth="1.75" />
        <text x={zx + 10 * zs} y={zy + 4} textAnchor={zs > 0 ? 'start' : 'end'} fontSize="11" fill="var(--ink-2)">Zero fuel, {fmt(zeroFuel.totalLb)} lb</text>
        {/* loaded point */}
        <circle cx={lx} cy={ly} r="7.5" fill={ok ? 'var(--right)' : 'var(--unsafe)'} stroke="var(--panel)" strokeWidth="2" />
        <text x={lx + 12 * ls} y={ly - 10} textAnchor={ls > 0 ? 'start' : 'end'} fontSize="12.5" fontWeight="700" fill="var(--ink)">
          {fmt(loaded.totalLb)} lb at {loaded.cgIn} in
        </text>
        {!ok && (
          <text x={lx + 12 * ls} y={ly - 24} textAnchor={ls > 0 ? 'start' : 'end'} fontSize="11" fontWeight="600" fill="var(--unsafe)">
            {loaded.overGross ? `${fmt(over)} lb over max gross` : 'Outside the envelope'}
          </text>
        )}
        <text x={ml + pw / 2} y={H - 6} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--ink-2)">CG arm, inches aft of datum</text>
        <text x="12" y={mt + ph / 2} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--ink-2)" transform={`rotate(-90 12 ${mt + ph / 2})`}>Weight, lb</text>
      </svg>
    </div>
  );
}
