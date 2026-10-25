// The field from the side, drawn to the numbers: the ground, the pattern at
// its height, the cloud base, the 500 ft the pattern keeps below it, and the
// legal and personal ceilings as lines across. Visibility is the band along
// the ground. Every height comes from the figure; nothing is computed here
// beyond placing it on the page. Colours are the system's: the legal line in
// the unsafe red, the pilot's own in the sock, the pattern and airplane in ink.

const W = 320;
const H = 230;
const GROUND = 184;
const TOP = 16;
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
  const inCloud = ceilingFtAgl !== null && ceilingFtAgl <= patternFtAgl;
  const visW = Math.min(1, visibilitySm / 10) * (W - 48);
  const py = y(patternFtAgl);
  // The pattern label goes under its line unless the ground is right there.
  const patternLabelY = py + 14 > GROUND - 4 ? py - 5 : py + 14;
  const ref = (ft: number, label: string, cls: string) => (
    <g className={`sky-ref ${cls}`}>
      <line x1={0} x2={W} y1={y(ft)} y2={y(ft)} />
      <text x={W - 8} y={y(ft) - 4} textAnchor="end">{label} {fmt(ft)}</text>
    </g>
  );
  return (
    <svg className={`sky-fig ${squeezed ? 'squeezed' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Side view: ceiling ${ceilingFtAgl === null ? 'none' : `${fmt(ceilingFtAgl)} feet`}, pattern at ${fmt(patternFtAgl)} feet${squeezed ? ', too close to the cloud' : ''}, visibility ${visibilitySm} miles`}>
      <defs>
        <pattern id="sky-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="sky-hatch" />
        </pattern>
      </defs>
      <rect className="sky-air" x={0} y={0} width={W} height={GROUND} />
      {base !== null && (
        <g className="sky-cloud">
          <rect x={0} y={0} width={W} height={base} />
          <rect className="sky-clearance" x={0} y={base} width={W} height={Math.max(0, y(Math.max(0, ceilingFtAgl! - clearanceFt)) - base)} fill="url(#sky-hatch)" />
          <line className="sky-base" x1={0} x2={W} y1={base} y2={base} />
          <text x={8} y={Math.max(TOP + 2, base - 6)}>Cloud base {fmt(ceilingFtAgl!)}</text>
        </g>
      )}
      {legalCeilingFt !== null && ref(legalCeilingFt, 'Legal', 'legal')}
      {ref(personalCeilingFt, 'Yours', 'personal')}
      <g className="sky-pattern">
        <line x1={28} x2={W - 28} y1={py} y2={py} />
        <path transform={`translate(${W / 2} ${py}) scale(1.1)`} d="M-11,0 L-3,-1.5 L-1,-5 L1,-5 L2,-1.5 L11,0 L11,1 L2,2 L1.5,4 L4,5 L4,6 L0,5.2 L-4,6 L-4,5 L-1.5,4 L-2,2 L-11,1 Z" />
        <text x={28} y={patternLabelY}>Pattern {fmt(patternFtAgl)}{inCloud ? ', in the cloud' : squeezed ? ', squeezed' : ''}</text>
      </g>
      <rect className="sky-ground" x={0} y={GROUND} width={W} height={H - GROUND} />
      <rect className="sky-runway" x={W / 2 - 54} y={GROUND - 3} width={108} height={3} />
      <g className="sky-vis">
        <rect x={24} y={GROUND + 11} width={W - 48} height={6} rx={3} className="track" />
        <rect x={24} y={GROUND + 11} width={visW} height={6} rx={3} />
        <text x={24} y={GROUND + 32}>Visibility {visibilitySm} SM</text>
      </g>
    </svg>
  );
}
