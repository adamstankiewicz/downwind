import type { ReactNode } from 'react';
import type { Severity, Grade } from '../scenarios/goNoGo';

export function Card({ title, sub, right, children, className }: { title?: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {title && (
        <div className="card-head">
          <div className="eyebrow">{title}</div>
          {sub && <span className="sub">{sub}</span>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ kind = 'warn', label, children, action }: { kind?: 'warn' | 'info'; label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${kind === 'info' ? 'info' : ''}`} role="note">
      <b>{label}</b>
      <span>{children}</span>
      {action && <span className="act">{action}</span>}
    </div>
  );
}

export function SampleAircraftNotice({ onGo }: { onGo?: () => void }) {
  return (
    <Notice
      label="Sample airplane"
      action={onGo && <button className="btn quiet" type="button" onClick={onGo}>Edit airplane</button>}
    >
      Empty weight, arms, envelope and demonstrated crosswind are typical C172K numbers, not your airplane. Replace them from your POH and current weight and balance record.
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
  illegal: 'Illegal',
  limit: 'Limit',
  personal: 'Personal',
  caution: 'Caution',
  info: 'Info',
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

export const Icons = {
  today: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  airplane: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3v7l8 4v2l-8-2v4l2 2v1l-4-1-4 1v-1l2-2v-4l-8 2v-2l8-4V3" strokeLinejoin="round" />
    </svg>
  ),
  review: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  ),
  readiness: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" fill="var(--panel)" />
      <circle cx="15" cy="12" r="2" fill="var(--panel)" />
      <circle cx="8" cy="17" r="2" fill="var(--panel)" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </svg>
  ),
};
