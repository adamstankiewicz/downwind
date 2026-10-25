// The lesson player: a flight that unfolds one step at a time. Brief, worked
// example, your turn, decide, then the debrief. Nothing is graded until the
// pilot commits; blanks are checked only when the pilot asks.

import { useMemo, useRef, useState } from 'react';
import type { Lesson, LessonContext, Step } from '../course/types';
import { modules } from '../course/modules';
import {
  checkBlank, coachLevel, emptyAnswers, nextLesson, recordLesson, scoreLesson, visibleSteps,
  type CourseProgress, type LessonAnswers, type LessonResult,
} from '../course/progress';
import { GRADE_LABEL, Voice } from './common';
import { Figure } from './Figure';
import { Strip, type StripPoint } from './Strip';
import { Rich } from './text';
import { RefChips } from '../refs/RefViewer';
import { arrange, nextVariant, variantCount } from '../course/variant';
import { lessonOutcomes } from '../review/lessonCards';
import { enrollLesson } from '../review/scheduler';

const freshSeed = () => Math.floor(Math.random() * 2 ** 31);

const KEYS = ['A', 'B', 'C', 'D'];
const KIND_LABEL: Record<Step['kind'], string> = { brief: 'Brief', example: 'Worked example', turn: 'Your turn', decide: 'Decide' };

export function LessonPlayer({ lesson, ctx, progress, setProgress, onExit, onNext }: {
  lesson: Lesson;
  ctx: LessonContext;
  progress: CourseProgress;
  setProgress: (next: CourseProgress | ((p: CourseProgress) => CourseProgress)) => void;
  onExit: () => void;
  onNext: (l: Lesson) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  // Built once per attempt so the practice weather holds still while the pilot
  // works. Each attempt flies a situation not yet seen, options freshly ordered.
  const { steps, variant } = useMemo(() => {
    const seed = freshSeed();
    const variant = nextVariant(lesson, progress[lesson.id], seed);
    return { steps: arrange(lesson.build({ ...ctx, variant }), seed), variant };
  }, [lesson, ctx, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState<LessonAnswers>(emptyAnswers);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [committed, setCommitted] = useState<Record<string, boolean>>({});
  const [idx, setIdx] = useState(0);
  const [result, setResult] = useState<LessonResult | null>(null);
  const level = useRef(coachLevel(progress, lesson)).current;

  const shown = visibleSteps(steps, answers);
  const step = shown[Math.min(idx, shown.length - 1)];
  const m = modules.find((x) => x.n === lesson.module)!;
  const lessonNo = m.lessons.findIndex((l) => l.id === lesson.id) + 1;

  const complete = (s: Step) => s.kind === 'brief' || s.kind === 'example' || (s.kind === 'turn' ? Boolean(checked[s.id]) : Boolean(committed[s.id]));
  const last = idx >= shown.length - 1;

  const finish = () => {
    const r = scoreLesson(steps, answers);
    setResult(r);
    setProgress((p) => recordLesson(p, lesson.id, r, new Date(), variant));
    enrollLesson(lesson.id, lessonOutcomes(steps, answers));
    window.scrollTo({ top: 0 });
  };
  const again = () => {
    setAttempt((a) => a + 1);
    setAnswers(emptyAnswers());
    setChecked({});
    setCommitted({});
    setIdx(0);
    setResult(null);
    window.scrollTo({ top: 0 });
  };
  const go = (n: number) => {
    setIdx(n);
    window.scrollTo({ top: 0 });
  };

  const points: StripPoint[] = [
    ...shown.map((s, i) => ({
      id: s.id,
      label: KIND_LABEL[s.kind],
      sub: s.title,
      state: (result || i < idx ? 'done' : i === idx ? 'now' : 'todo') as StripPoint['state'],
      onClick: !result && i < idx ? () => go(i) : undefined,
    })),
    { id: 'debrief', label: 'Debrief', state: result ? 'now' : 'todo' },
  ];

  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <div>
            <h1><span className="lid">{lesson.id}</span> {lesson.title}</h1>
            <span className="muted">Module {m.n}, {m.title}. Lesson {lessonNo} of {m.lessons.length}. {lesson.acs.join(', ')}.{variantCount(lesson) > 1 ? ` Situation ${variant + 1} of ${variantCount(lesson)}.` : ''}{ctx.practiceField ? ' Practice field, not a real airport.' : ''}</span>
          </div>
          <button type="button" className="btn quiet" onClick={onExit}>{result ? 'Back to course' : 'Leave lesson'}</button>
        </div>
        <Strip points={points} label="Steps of this lesson" />
      </div>

      {result ? (
        <Debrief lesson={lesson} steps={shown} answers={answers} result={result} progress={progress} onAgain={again} onNext={onNext} onExit={onExit} />
      ) : (
        <div className="lesson">
          <div className="scene">
            <StepView
              key={step.id}
              step={step}
              level={level}
              answers={answers}
              setAnswers={setAnswers}
              checked={Boolean(checked[step.id])}
              onCheck={() => setChecked((c) => ({ ...c, [step.id]: true }))}
              committed={Boolean(committed[step.id])}
              onCommit={() => setCommitted((c) => ({ ...c, [step.id]: true }))}
            />
            <div className="step-nav">
              {idx > 0 && <button type="button" className="btn quiet" onClick={() => go(idx - 1)}>Back</button>}
              <span style={{ flex: 1 }} />
              {last
                ? <button type="button" className="btn primary" disabled={!complete(step)} onClick={finish}>Debrief</button>
                : <button type="button" className="btn primary" disabled={!complete(step)} onClick={() => go(idx + 1)}>Continue</button>}
            </div>
          </div>
          <aside className="tool" aria-label="Figure for this step">
            {(() => {
              // The drawer stays open: a step without its own figure keeps the last one.
              const prev = shown.slice(0, idx + 1).filter((s) => s.figure).at(-1);
              if (step.figure) return <Figure figure={step.figure} practiceField={ctx.practiceField} />;
              if (prev?.figure) return <><Figure figure={prev.figure} practiceField={ctx.practiceField} /><p className="muted small">Still open from "{prev.title}".</p></>;
              return <p className="muted small">No figure for this step.</p>;
            })()}
          </aside>
        </div>
      )}
    </>
  );
}

export function StepView({ step, level, answers, setAnswers, checked, onCheck, committed, onCommit }: {
  step: Step;
  level: 'full' | 'short';
  answers: LessonAnswers;
  setAnswers: (f: (a: LessonAnswers) => LessonAnswers) => void;
  checked: boolean;
  onCheck: () => void;
  committed: boolean;
  onCommit: () => void;
}) {
  if (step.kind === 'brief') {
    return (
      <section className="step">
        <h2>{step.title}</h2>
        {step.scene && <p className="situ"><Rich text={step.scene} /></p>}
        <Voice><Rich text={step.say[level]} /></Voice>
      </section>
    );
  }
  if (step.kind === 'example') {
    return (
      <section className="step">
        <h2>{step.title}</h2>
        <Voice><Rich text={step.say[level]} /></Voice>
        <dl className="work">
          {step.work.map((w) => (
            <div key={w.label}>
              <dt>{w.label}</dt>
              <dd><span className="mono">{w.value}</span>{w.note && <small>{w.note}</small>}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (step.kind === 'turn') {
    const mine = answers.blanks[step.id] ?? {};
    const set = (id: string, v: string) => setAnswers((a) => ({ ...a, blanks: { ...a.blanks, [step.id]: { ...(a.blanks[step.id] ?? {}), [id]: v } } }));
    const filled = step.blanks.every((b) => (mine[b.id] ?? '').trim() !== '');
    return (
      <section className="step">
        <h2>{step.title}</h2>
        <p className="situ">{step.prompt}</p>
        <div className="blanks">
          {step.blanks.map((b) => {
            const v = mine[b.id] ?? '';
            const right = checked ? checkBlank(b, v) : null;
            return (
              <div key={b.id} className={`blank ${right === null ? '' : right ? 'right' : 'wrong'}`}>
                <label htmlFor={`${step.id}-${b.id}`}>{b.label}{b.unit ? <small> {b.unit}</small> : null}</label>
                {b.choices ? (
                  <div className="chips" role="group" aria-labelledby={`${step.id}-${b.id}`} id={`${step.id}-${b.id}`}>
                    {b.choices.map((c) => (
                      <button key={c} type="button" className="chip-btn" aria-pressed={v === c} disabled={checked} onClick={() => set(b.id, c)}>{c}</button>
                    ))}
                  </div>
                ) : (
                  <input id={`${step.id}-${b.id}`} className="mono" type="text" inputMode="decimal" autoComplete="off" value={v} disabled={checked} onChange={(e) => set(b.id, e.target.value)} />
                )}
                {checked && (
                  <p className="explain">
                    <b>{right ? 'Right.' : `Not quite. ${typeof b.answer === 'number' ? `${b.answer.toLocaleString('en-US')}${b.unit ? ` ${b.unit}` : ''}.` : `${b.answer}.`}`}</b> <Rich text={b.explain} />
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {!checked && (
          <div className="cta">
            <button type="button" className="btn primary" disabled={!filled} onClick={onCheck}>Check my numbers</button>
            <span className="hint">Answers are checked only when you ask. Fill every blank first.</span>
          </div>
        )}
      </section>
    );
  }
  const a = answers.decisions[step.id];
  const choice = a?.choice ?? null;
  const setChoice = (id: string) =>
    setAnswers((x) => ({ ...x, decisions: { ...x.decisions, [step.id]: { choice: id } } }));
  return (
    <section className="step">
      <h2>{step.title}</h2>
      <p className="situ">{step.situation}</p>
      <p className="prompt">What do you do?</p>
      <div className="choices" role="group" aria-label="Options">
        {step.options.map((o, i) => {
          const picked = choice === o.id;
          const grade = committed ? step.grades[o.id] : null;
          return (
            <button key={o.id} type="button" className={`choice ${committed ? 'revealed' : ''} ${picked ? 'picked' : ''}`} aria-pressed={picked} disabled={committed} onClick={() => setChoice(o.id)}>
              <span className="key">{KEYS[i]}</span>
              <span>{o.label}</span>
              {grade && <span className={`gradechip ${grade}`}>{GRADE_LABEL[grade]}</span>}
            </button>
          );
        })}
      </div>
      {!committed ? (
        <div className="cta">
          <button type="button" className="btn primary" disabled={!choice} onClick={onCommit}>Commit</button>
          <span className="hint">Grades stay hidden until you commit.</span>
        </div>
      ) : (
        choice && (
          <Voice className="cons">{step.consequence[choice]}</Voice>
        )
      )}
    </section>
  );
}

function Debrief({ lesson, steps, answers, result, progress, onAgain, onNext, onExit }: {
  lesson: Lesson;
  steps: Step[];
  answers: LessonAnswers;
  result: LessonResult;
  progress: CourseProgress;
  onAgain: () => void;
  onNext: (l: Lesson) => void;
  onExit: () => void;
}) {
  const next = nextLesson(progress);
  const decideSteps = steps.filter((s): s is Extract<Step, { kind: 'decide' }> => s.kind === 'decide');
  return (
    <div className="debrief-page">
      <section className="step">
        <h2>Debrief</h2>
        <div className={`grade ${result.grade}`}>{GRADE_LABEL[result.grade]}</div>
        <p className="lcg">Learner-centered grading: {result.lcg}. {LCG_TEXT[result.lcg]}</p>
      </section>

      <section className="step">
        <h2>Each decision</h2>
        <ol className="decisions">
          {result.decisions.map((d) => {
            const s = decideSteps.find((x) => x.id === d.stepId)!;
            const mine = s.options.find((o) => o.id === d.choice)!;
            const best = d.best.map((id) => s.options.find((o) => o.id === id)!);
            return (
              <li key={d.stepId}>
                <h3>{d.title}</h3>
                <p className="dec-row"><span className="muted">You chose</span> <span>{mine.label}</span> <span className={`gradechip ${d.grade}`}>{GRADE_LABEL[d.grade]}</span></p>
                {!d.best.includes(d.choice) && (
                  <p className="dec-row"><span className="muted">{best.length > 1 ? 'Best calls' : 'Best call'}</span> <span>{best.map((b) => b.label).join(' Or: ')}</span></p>
                )}
                <Voice>{s.why}</Voice>
              </li>
            );
          })}
        </ol>
      </section>

      {result.blanksTotal > 0 && (
        <section className="step">
          <h2>Your numbers</h2>
          <p><b>{result.blanksRight} of {result.blanksTotal}</b> blanks right.</p>
          <ul className="blank-list">
            {steps.filter((s): s is Extract<Step, { kind: 'turn' }> => s.kind === 'turn').flatMap((s) =>
              s.blanks.map((b) => {
                const v = answers.blanks[s.id]?.[b.id] ?? '';
                const ok = checkBlank(b, v);
                return (
                  <li key={`${s.id}-${b.id}`} className={ok ? 'right' : 'wrong'}>
                    <span>{b.label}</span>
                    <span className="mono">{v || 'blank'}{!ok && <> <span className="muted">(answer {typeof b.answer === 'number' ? b.answer.toLocaleString('en-US') : b.answer}{b.unit ? ` ${b.unit}` : ''})</span></>}</span>
                  </li>
                );
              }),
            )}
          </ul>
        </section>
      )}

      <section className="step">
        <h2>Standards and references</h2>
        <div className="refs">
          {lesson.acs.map((a) => <span key={a} className="chip acs">{a}</span>)}
          <RefChips refs={lesson.refs} />
        </div>
      </section>

      <div className="step-nav">
        <button type="button" className="btn quiet" onClick={onAgain}>{variantCount(lesson) > 1 ? 'Fly another situation' : 'Fly it again'}</button>
        <span style={{ flex: 1 }} />
        {next && next.id !== lesson.id
          ? <button type="button" className="btn primary" onClick={() => onNext(next)}>Next lesson: {next.id} {next.title}</button>
          : <button type="button" className="btn primary" onClick={onExit}>Back to course</button>}
      </div>
    </div>
  );
}

const LCG_TEXT: Record<LessonResult['lcg'], string> = {
  Explain: 'You can describe the limits but did not apply them here.',
  Practice: 'You have the idea; the numbers or the call still need reps.',
  Perform: 'A sound call. The best one was a little better.',
  'Manage/Decide': 'You read the situation and made the best call.',
};
