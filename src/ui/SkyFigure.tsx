// The field from the side, drawn to the numbers: the ground, the pattern at
// its height, the cloud base, the 500 ft the pattern keeps below it, and the
// legal and personal ceilings as lines across. Visibility is the band along
// the ground. Every height comes from the figure; nothing is computed here
// beyond placing it on the page.

const W = 320;
const H = 220;
const GROUND = 186;
const TOP = 18;
const fmt = (n: number) => n.toLocaleString('en-US');

export function SkyFigure({ ceilingFtAgl, visibilitySm, patternFtAgl, legalCeilingFt, personalCeilingFt, clearanceFt = 500 }: {
  ceilingFtAgl: number | null;
  visibilitySm: number;
  patternFtAgl: number;
  legalCeilingFt: number | null;
  personalCeilingFt: number;
  clearanceFt?: number;
}) {
  const topFt = Math.max(3500, (ceilingFtAgl ?? 0) + 800, personalCeilingFt + 600);
  const y = (ft: number) => GROUND - ((GROUND - TOP) * ft) / topFt;
  const base = ceilingFtAgl === null ? null : y(ceilingFtAgl);
  const squeezed = ceilingFtAgl !== null && ceilingFtAgl - patternFtAgl < clearanceFt;
  const visW = Math.min(1, visibilitySm / 10) * (W - 60);
  const ref = (ft: number, label: string, cls: string) => (
    <g className={cls}>
      <line x1={8} x2={W - 8} y1={y(ft)} y2={y(ft)} strokeDasharray="5 4" />
      <text x={W - 10} y={y(ft) - 4} textAnchor="end">{label} {fmt(ft)}</text>
    </g>
  );
  return (
    <svg className="sky-fig" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Side view: ceiling ${ceilingFtAgl === null ? 'none' : `${fmt(ceilingFtAgl)} feet`}, pattern at ${fmt(patternFtAgl)} feet, visibility ${visibilitySm} miles`}>
      {base !== null && (
        <g className="sky-cloud">
          <rect x={0} y={TOP - 18} width={W} height={base - TOP + 18} />
          <rect className="sky-clearance" x={0} y={base} width={W} height={Math.max(0, y(Math.max(0, ceilingFtAgl! - clearanceFt)) - base)} />
          <text x={10} y={Math.max(TOP + 4, base - 6)}>Cloud base {fmt(ceilingFtAgl!)}</text>
        </g>
      )}
      {legalCeilingFt !== null && ref(legalCeilingFt, 'Legal', 'sky-ref legal')}
      {ref(personalCeilingFt, 'Yours', 'sky-ref personal')}
      <g className={`sky-pattern ${squeezed ? 'squeezed' : ''}`}>
        <line x1={40} x2={W - 40} y1={y(patternFtAgl)} y2={y(patternFtAgl)} />
        <path d={`M${W / 2 - 7} ${y(patternFtAgl)} l14 0 m-9 -4 l0 8 m8 -3 l3 -2 l0 4 z`} />
        <text x={40} y={y(patternFtAgl) + 13}>Pattern {fmt(patternFtAgl)}</text>
      </g>
      <rect className="sky-ground" x={0} y={GROUND} width={W} height={H - GROUND} />
      <rect className="sky-runway" x={W / 2 - 50} y={GROUND - 3} width={100} height={3} />
      <g className="sky-vis">
        <rect x={30} y={GROUND + 12} width={W - 60} height={6} rx={3} className="track" />
        <rect x={30} y={GROUND + 12} width={visW} height={6} rx={3} />
        <text x={30} y={GROUND + 30}>Visibility {visibilitySm} SM</text>
      </g>
    </svg>
  );
}
