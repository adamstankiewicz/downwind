// Dials on a lesson figure. The pilot turns the conditions; the engine
// re-runs on every change and the readouts, the crossed lines and the grades
// follow at once. Nothing here computes: values come from the step's
// `evaluate`, and the task is checked by the step's own `check`.

import { useMemo } from 'react';
import type { Dial, DialLine, DialState, DialValues } from '../course/types';
import { initialValues, type DialsStep } from '../course/dials';
import { GRADE_LABEL, Voice } from './common';
import { Rich } from './text';

const show = (d: Dial, v: number) => (d.format ? d.format(v) : `${v.toLocaleString('en-US')} ${d.unit}`);

export function DialsView({ step, level, values, state, setValue, reset, checked, onCheck }: {
  step: DialsStep;
  level: 'full' | 'short';
  values: DialValues;
  state: DialState;
  setValue: (id: string, v: number) => void;
  reset: () => void;
  /** The setting the pilot asked the engine to check, once they have. */
  checked: DialValues | null;
  onCheck: () => void;
}) {
  // A line the lesson's own conditions didn't cross is one the pilot turned the dials across.
  const start = useMemo(() => new Set(step.evaluate(initialValues(step)).lines.map((l) => l.id)), [step]);
  const fresh = state.lines.filter((l) => !start.has(l.id)).map((l) => l.id);
  const top: DialLine | undefined = state.lines[0];
  const moved = step.dials.some((d) => values[d.id] !== d.initial);
  const result = checked && step.task ? step.task.check(checked) : null;

  return (
    <section className="step dials-step">
      <h2>{step.title}</h2>
      <Voice><Rich text={step.say[level]} /></Voice>

      <div className="dials" role="group" aria-label="Dials">
        {step.dials.map((d) => (
          <DialControl key={d.id} dial={d} value={values[d.id]} onChange={(v) => setValue(d.id, v)} />
        ))}
        <div className="dials-foot">
          <span className="muted small">{moved ? 'Practice weather, as you have turned it.' : 'The lesson\'s own conditions.'}</span>
          <button type="button" className="btn quiet" disabled={!moved} onClick={reset}>Back to the lesson's numbers</button>
        </div>
      </div>

      <dl className="readouts" aria-live="polite">
        {state.readouts.map((r) => (
          <div key={r.id} className={r.tone ?? ''}>
            <dt>{r.label}</dt>
            <dd className="mono">{r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="dial-lines">
        {top ? (
          <>
            <p className={`line-tag ${top.severity}`}>{fresh.includes(top.id) ? 'Crossed: ' : ''}{top.title}</p>
            <Voice className="cons">{top.say}</Voice>
            {state.lines.length > 1 && (
              <ul className="line-more">
                {state.lines.slice(1).map((l) => <li key={l.id} className={l.severity}>{l.title}</li>)}
              </ul>
            )}
          </>
        ) : (
          <Voice className="cons">{state.clear}</Voice>
        )}
      </div>

      <div className="verdict">
        <p className="prompt">How the engine grades it right now</p>
        <ul>
          {state.verdict.options.map((o) => {
            const g = state.verdict.grades[o.id];
            return (
              <li key={o.id}>
                <span>{o.label}</span>
                <span className={`gradechip ${g}`}>{GRADE_LABEL[g]}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {step.task && (
        <div className={`dial-task ${result ? (result.right ? 'right' : 'wrong') : ''}`}>
          <p className="situ"><b>Find it.</b> {step.task.prompt}</p>
          {result ? (
            <p className="explain"><b>{result.right ? 'Right.' : 'Not quite.'}</b> {result.explain}</p>
          ) : (
            <div className="cta">
              <button type="button" className="btn primary" onClick={onCheck}>Check this setting</button>
              <span className="hint">The engine checks the dials where they sit now.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DialControl({ dial, value, onChange }: { dial: Dial; value: number; onChange: (v: number) => void }) {
  const pct = (x: number) => ((x - dial.min) / (dial.max - dial.min)) * 100;
  const id = `dial-${dial.id}`;
  return (
    <div className="dial">
      <label htmlFor={id}>
        <span>{dial.label}</span>
        <b className="mono">{show(dial, value)}</b>
      </label>
      <div className="dial-track">
        <input
          id={id} type="range" min={dial.min} max={dial.max} step={dial.step} value={value}
          aria-valuetext={show(dial, value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {dial.marks?.filter((m) => m.at >= dial.min && m.at <= dial.max).map((m) => (
          <span key={`${m.kind}-${m.at}`} className={`dial-mark ${m.kind}`} style={{ left: `${pct(m.at)}%` }} aria-hidden="true">
            <i />
            <small>{m.label}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
