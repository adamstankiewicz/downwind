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
  acceptable: 'Acceptable',
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

/** The app mark: a runway seen from the pattern. */
export function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="8" fill="var(--ink)" />
      <rect x="27" y="6" width="10" height="52" fill="var(--paper)" transform="rotate(-35 32 32)" />
      <rect x="31" y="14" width="2" height="8" fill="var(--ink)" transform="rotate(-35 32 32)" />
      <rect x="31" y="28" width="2" height="8" fill="var(--ink)" transform="rotate(-35 32 32)" />
      <rect x="31" y="42" width="2" height="8" fill="var(--ink)" transform="rotate(-35 32 32)" />
    </svg>
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
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </svg>
  ),
};
