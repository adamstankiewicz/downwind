// The strip: one sequence across the top of every screen. On the course home
// it is the modules; inside a lesson, the steps of the flight; in the daily
// flight, the lines of the sheet. The magenta tick is always "now".

export interface StripPoint {
  id: string;
  label: string;
  state: 'done' | 'now' | 'todo';
  /** Shown under the label on wide screens. */
  sub?: string;
  onClick?: () => void;
}

export function Strip({ points, label }: { points: StripPoint[]; label: string }) {
  return (
    <ol className="strip" aria-label={label}>
      {points.map((p, i) => {
        const inner = (
          <>
            <i aria-hidden="true" />
            <span className="strip-label">{p.label}</span>
            {p.sub && p.sub !== p.label && <span className="strip-sub">{p.sub}</span>}
          </>
        );
        return (
          <li key={p.id} className={p.state} aria-current={p.state === 'now' ? 'step' : undefined} style={{ ['--i' as string]: i }}>
            {p.onClick ? <button type="button" onClick={p.onClick} aria-label={`${p.label}${p.state === 'done' ? ', done' : p.state === 'now' ? ', current' : ''}`}>{inner}</button> : <span>{inner}</span>}
          </li>
        );
      })}
    </ol>
  );
}
