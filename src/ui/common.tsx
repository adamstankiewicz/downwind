import type { ReactNode } from 'react';
import type { Severity, Grade } from '../scenarios/goNoGo';

/** A titled section. `boxed` draws a panel; use it only for things the pilot acts on. */
export function Card({ title, sub, right, children, className, boxed }: { title?: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string; boxed?: boolean }) {
  return (
    <section className={`card ${boxed ? 'boxed' : ''} ${className ?? ''}`}>
      {title && (
        <div className="card-head">
          <h2>{title}</h2>
          {sub && <span className="sub">{sub}</span>}
          {right && <span className="right">{right}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ kind = 'warn', label, children, action }: { kind?: 'warn' | 'info'; label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${kind === 'info' ? 'info' : ''}`} role="note">
      <p><b>{label}.</b> {children}</p>
      {action && <span className="act">{action}</span>}
    </div>
  );
}

export function SampleAircraftNotice({ onGo, template }: { onGo?: () => void; template: string | null }) {
  return (
    <Notice
      label="Sample airplane"
      action={onGo && <button className="btn quiet" type="button" onClick={onGo}>Edit airplane</button>}
    >
      Empty weight, arms, envelope and demonstrated crosswind are sample numbers from the {template ?? 'built-in'} template, not your airplane's. Replace them from your POH and current weight and balance record.
    </Notice>
  );
}

export function NoAircraftNotice({ onGo }: { onGo?: () => void }) {
  return (
    <Notice
      kind="info"
      label="No airplane yet"
      action={onGo && <button className="btn quiet" type="button" onClick={onGo}>Add your airplane</button>}
    >
      The brief checks weather against your minimums. Weight and balance and the demonstrated crosswind join in once the airplane has its POH numbers.
    </Notice>
  );
}

export function PageHead({ title, lead, meta }: { title: string; lead?: string; meta?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {meta && <div className="meta">{meta}</div>}
    </div>
  );
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  illegal: 'Not legal',
  limit: 'Airplane limit',
  personal: 'Your minimum',
  caution: 'Caution',
  info: 'For context',
};

export const GRADE_LABEL: Record<Grade, string> = {
  best: 'Best call',
  acceptable: 'Sound',
  marginal: 'Marginal',
  unsafe: 'Unsafe',
};

export function Field({ label, hint, children, size }: { label: string; hint?: string; children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <label className={`field ${size ?? ''}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Numeric input that tolerates an empty field while typing. */
export function NumInput({ value, onChange, step = 1, min, max, ariaLabel, className }: { value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; ariaLabel?: string; className?: string }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) ? value : ''}
      step={step}
      min={min}
      max={max}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => {
        const n = e.target.valueAsNumber;
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

/** The windsock mark: three sock-orange bands and an ink hoop. The bands are
 *  always sock; the hoop follows the theme's ink so the mark sits on Day and
 *  Night surfaces alike. Never recoloured, never set on sock or taxi. */
export function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g fill="var(--sock)">
        <path d="M12 17 L13.5 17.23 L14.98 17.49 L16.47 17.76 L17.95 18.05 L19.42 18.36 L20.88 18.69 L22.34 19.03 L23.79 19.4 L25.24 19.78 L26.68 20.18 L24.2 39.54 L22.95 39.62 L21.71 39.71 L20.47 39.81 L19.25 39.94 L18.02 40.07 L16.81 40.23 L15.6 40.4 L14.39 40.58 L13.19 40.78 L12 41Z" />
        <path d="M31.78 21.76 L33.14 22.23 L34.5 22.71 L35.85 23.21 L37.19 23.72 L38.53 24.25 L39.86 24.79 L41.19 25.35 L42.51 25.93 L43.83 26.52 L45.14 27.13 L41.26 40.16 L39.98 40.02 L38.7 39.88 L37.43 39.77 L36.17 39.67 L34.91 39.59 L33.66 39.52 L32.41 39.47 L31.17 39.44 L29.93 39.42 L28.7 39.42Z" />
        <path d="M49.95 29.51 L51.14 30.14 L52.33 30.78 L53.51 31.44 L54.69 32.1 L55.86 32.78 L57.03 33.47 L58.2 34.18 L59.36 34.89 L60.51 35.62 L61.67 36.36 L58.33 43.64 L57.09 43.29 L55.84 42.96 L54.6 42.65 L53.37 42.35 L52.14 42.06 L50.91 41.79 L49.69 41.54 L48.47 41.3 L47.26 41.07 L46.05 40.86Z" />
      </g>
      <ellipse cx="12" cy="29" rx="4.5" ry="14" fill="var(--ink)" />
    </svg>
  );
}

/** The instructor's voice: the windsock, then the line. `faded` is the
 *  one-line caption form for a line the pilot has already earned. */
export function Voice({ children, className, faded }: { children: ReactNode; className?: string; faded?: boolean }) {
  return (
    <p className={`voice ${faded ? 'faded' : ''} ${className ?? ''}`}>
      <span className="voice-m" aria-hidden="true"><Mark /></span>
      <span className="voice-t">{children}</span>
    </p>
  );
}

export const Icons = {
  course: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 12h4M10 12h4M17 12h4" />
      <circle cx="5" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
  tools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3v7l8 4v2l-8-2v4l2 2v1l-4-1-4 1v-1l2-2v-4l-8 2v-2l8-4V3" strokeLinejoin="round" />
    </svg>
  ),
  logbook: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  pilot: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  trip: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="6" cy="17" r="2.4" />
      <circle cx="18" cy="7" r="2.4" />
      <path d="M8 15.5c3-1 2-5.5 5-7.5 1-.6 2-.9 3-1" strokeDasharray="2.5 2.5" strokeLinecap="round" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </svg>
  ),
};
