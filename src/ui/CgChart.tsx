// CG envelope drawn to scale from the profile's polygon, with the loaded point
// and the zero-fuel point so the burn-off line is visible.

import type { Envelope, WbResult } from '../lib/wb';

export function CgChart({ envelope, loaded, zeroFuel, maxGrossLb }: { envelope: Envelope; loaded: WbResult; zeroFuel: WbResult; maxGrossLb: number }) {
  const xs = envelope.map((p) => p[0]).concat(loaded.cgIn, zeroFuel.cgIn);
  const ys = envelope.map((p) => p[1]).concat(loaded.totalLb, zeroFuel.totalLb, maxGrossLb);
  const xMin = Math.floor(Math.min(...xs) - 1);
  const xMax = Math.ceil(Math.max(...xs) + 1);
  const yMin = Math.floor((Math.min(...ys) - 100) / 100) * 100;
  const yMax = Math.ceil((Math.max(...ys) + 100) / 100) * 100;

  const W = 560;
  const H = 400;
  const ml = 58;
  const mr = 16;
  const mt = 16;
  const mb = 44;
  const x = (cg: number) => ml + ((cg - xMin) / (xMax - xMin)) * (W - ml - mr);
  const y = (lb: number) => mt + (1 - (lb - yMin) / (yMax - yMin)) * (H - mt - mb);

  const xTicks: number[] = [];
  for (let v = xMin; v <= xMax; v += 1) xTicks.push(v);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += 100) yTicks.push(v);

  const poly = envelope.map((p) => `${x(p[0])},${y(p[1])}`).join(' ');
  const ok = loaded.withinEnvelope && !loaded.overGross;

  return (
    <div className="cg-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`CG envelope. Loaded ${loaded.totalLb} lb at ${loaded.cgIn} inches, ${ok ? 'inside' : 'outside'} the envelope.`}>
        <rect x={ml} y={mt} width={W - ml - mr} height={H - mt - mb} fill="var(--chart)" />
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} y1={mt} x2={x(v)} y2={H - mb} stroke="var(--rule)" strokeWidth="1" />
            {(xTicks.length <= 14 || v % 2 === 0) && (
              <text x={x(v)} y={H - mb + 16} textAnchor="middle" fontFamily="var(--body)" fontSize="10.5" fill="var(--muted)">{v}</text>
            )}
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={ml} y1={y(v)} x2={W - mr} y2={y(v)} stroke="var(--rule)" strokeWidth="1" />
            <text x={ml - 8} y={y(v) + 3.5} textAnchor="end" fontFamily="var(--body)" fontSize="10.5" fill="var(--muted)">{v.toLocaleString()}</text>
          </g>
        ))}
        <line x1={ml} y1={y(maxGrossLb)} x2={W - mr} y2={y(maxGrossLb)} stroke="var(--ifr)" strokeWidth="1" strokeDasharray="4 3" />
        <text x={W - mr - 4} y={y(maxGrossLb) - 4} textAnchor="end" fontFamily="var(--body)" fontSize="9.5" fill="var(--ifr)">Max gross {maxGrossLb.toLocaleString()}</text>
        <polygon points={poly} fill="var(--tint-b)" fillOpacity="0.9" stroke="var(--classb)" strokeWidth="2" strokeLinejoin="round" />
        {/* burn line */}
        <line x1={x(loaded.cgIn)} y1={y(loaded.totalLb)} x2={x(zeroFuel.cgIn)} y2={y(zeroFuel.totalLb)} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="3 3" />
        <circle cx={x(zeroFuel.cgIn)} cy={y(zeroFuel.totalLb)} r="5" fill="var(--panel)" stroke="var(--muted)" strokeWidth="1.5" />
        <text x={x(zeroFuel.cgIn) + 9} y={y(zeroFuel.totalLb) + 4} fontFamily="var(--body)" fontSize="9.5" fill="var(--muted)">Zero fuel</text>
        {/* loaded point */}
        <circle cx={x(loaded.cgIn)} cy={y(loaded.totalLb)} r="7" fill={ok ? 'var(--vfr)' : 'var(--ifr)'} stroke="var(--panel)" strokeWidth="2" />
        <text x={x(loaded.cgIn) + 11} y={y(loaded.totalLb) - 8} fontFamily="var(--body)" fontSize="10.5" fontWeight="500" fill="var(--ink)">
          {loaded.totalLb.toLocaleString()} lb at {loaded.cgIn} in
        </text>
        <text x={ml + (W - ml - mr) / 2} y={H - 6} textAnchor="middle" fontFamily="var(--body)" fontSize="11" fill="var(--muted)">CG arm, inches aft of datum</text>
        <text x="12" y={mt + (H - mt - mb) / 2} textAnchor="middle" fontFamily="var(--body)" fontSize="11" fill="var(--muted)" transform={`rotate(-90 12 ${mt + (H - mt - mb) / 2})`}>Weight, lb</text>
      </svg>
    </div>
  );
}
