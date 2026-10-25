// Review: an FSRS session over the cards due now. Two kinds of card share the
// deck: questions from the bank, and decisions and worked numbers from lessons
// already flown. A lesson card is built again in a situation picked fresh, with
// its options in a new order, so it asks for the skill rather than the answer
// remembered from last time. The scheduler reads its rating from the answer:
// right or wrong, how long it took, and whether a wrong pick was an unsafe
// one, which also comes back once more before the session ends.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LessonContext } from '../course/types';
import { emptyAnswers, type LessonAnswers } from '../course/progress';
import { variantCount } from '../course/variant';
import type { ReviewItem } from '../review/items';
import { buildCard, stepOutcome, stepWords, type BuiltCard } from '../review/lessonCards';
import { dueCards, recordAnswer, wordsIn, type DueCard } from '../review/scheduler';
import { Card, PageHead, Voice } from './common';
import { Figure } from './Figure';
import { StepView } from './LessonPlayer';
import { Rich } from './text';
import { RefChips } from '../refs/RefViewer';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Answered {
  id: string;
  title: string;
  answer: string;
  acs: string[];
  refs: string[];
  correct: boolean;
}

const freshSeed = () => Math.floor(Math.random() * 2 ** 31);

export function Review({ ctx }: { ctx: LessonContext }) {
  const [session, setSession] = useState<DueCard[]>(() => dueCards());
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Answered[]>([]);
  const [revealed, setRevealed] = useState(false);
  const requeued = useRef(new Set<string>());

  const card = session[idx];
  const finished = idx >= session.length;

  const restart = () => {
    setSession(dueCards());
    setIdx(0);
    setRevealed(false);
    setDone([]);
    requeued.current.clear();
  };

  const onAnswered = (a: Answered, unsafe: boolean) => {
    if (unsafe && !requeued.current.has(card.id)) {
      requeued.current.add(card.id);
      setSession([...session, card]);
    }
    setDone([...done, a]);
    setRevealed(true);
  };

  const next = () => {
    setIdx(idx + 1);
    setRevealed(false);
  };

  if (session.length === 0) {
    return (
      <>
        <PageHead title="Review" lead="Spaced repetition over the course, scheduled with FSRS." />
        <div className="empty">
          <EmptyGlyph />
          <h2>Nothing due</h2>
          <p>Every card is scheduled for later. Lessons you fly add their decisions to the deck, and they come back here in a new situation when the scheduler calls.</p>
          <button type="button" className="btn" onClick={restart}>Check again</button>
        </div>
      </>
    );
  }

  if (finished) {
    const right = done.filter((d) => d.correct).length;
    return (
      <>
        <PageHead title="Review" lead="Session complete." />
        <Card title="Session summary">
          <div className="score-row">
            <div className="stat"><span className="k">Answered</span><span className="v">{done.length}</span></div>
            <div className="stat"><span className="k">Correct</span><span className="v">{right}</span></div>
          </div>
          {right < done.length && <p className="help">Missed cards come back soonest.</p>}
          <ul className="findings">
            {done.map((d, i) => (
              <li key={`${d.id}-${i}`} className={`finding ${d.correct ? 'right' : 'illegal'}`}>
                <span className="sev">{d.correct ? 'Right' : 'Missed'}</span>
                <h4>{d.title}</h4>
                <p>{d.answer}</p>
                <div className="refs">{d.acs.map((a) => <span key={a} className="chip acs">{a}</span>)}<RefChips refs={d.refs} /></div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn primary" onClick={restart}>Start another session</button>
        </Card>
      </>
    );
  }

  const nextButton = <button type="button" className="btn primary" onClick={next}>{idx + 1 < session.length ? 'Next' : 'Finish'}</button>;

  return (
    <>
      <PageHead
        title="Review"
        lead="Answer first, then read."
        meta={<>Card <b>{idx + 1}</b> of {session.length}</>}
      />
      <div className="progress" aria-hidden="true"><i style={{ width: `${(idx / session.length) * 100}%` }} /></div>
      {card.kind === 'bank'
        ? <BankCard key={`${card.id}-${idx}`} item={card.item} revealed={revealed} onAnswered={onAnswered} next={nextButton} />
        : <LessonCard key={`${card.id}-${idx}`} id={card.id} ctx={ctx} revealed={revealed} onAnswered={onAnswered} next={nextButton} onMissing={next} />}
    </>
  );
}

function BankCard({ item, revealed, onAnswered, next }: {
  item: ReviewItem;
  revealed: boolean;
  onAnswered: (a: Answered, unsafe: boolean) => void;
  next: React.ReactNode;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const shownAt = useRef(Date.now());

  const commit = () => {
    if (picked === null) return;
    const correct = picked === item.answer;
    const unsafe = !correct && (item.unsafeOptions?.includes(picked) ?? false);
    recordAnswer(item.id, { correct, unsafe, seconds: (Date.now() - shownAt.current) / 1000, words: wordsIn(item) });
    onAnswered({ id: item.id, title: item.prompt, answer: item.options[item.answer], acs: [item.acs], refs: [item.ref], correct }, unsafe);
  };
  const correct = revealed && picked === item.answer;

  return (
    <div className="grid-2">
      <Card title="Question" sub={`ACS ${item.acs}`}>
        <p className="review-q">{item.prompt}</p>
        <div className="choices" role="group" aria-label="Options">
          {item.options.map((o, i) => {
            const isAnswer = revealed && i === item.answer;
            const isPicked = picked === i;
            return (
              <button
                key={i}
                type="button"
                className={`choice ${revealed ? 'revealed' : ''} ${isPicked || isAnswer ? 'picked' : ''} ${isAnswer ? 'right' : revealed && isPicked ? 'wrong' : ''}`}
                aria-pressed={isPicked}
                disabled={revealed}
                onClick={() => setPicked(i)}
              >
                <span className="key">{KEYS[i]}</span>
                <span>{o}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="stack">
        <Card title={revealed ? 'Result' : 'Your answer'} className="decide">
          {!revealed ? (
            <button type="button" className="btn primary" disabled={picked === null} onClick={commit}>Reveal</button>
          ) : (
            <>
              <div className={`result ${correct ? '' : 'wrong'}`}>
                <b>{correct ? 'Correct' : 'Missed'}</b>
                <span>{item.explanation}</span>
                <div className="refs">
                  <span className="chip acs">{item.acs}</span>
                  <RefChips refs={[item.ref]} />
                </div>
              </div>
              {next}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function LessonCard({ id, ctx, revealed, onAnswered, next, onMissing }: {
  id: string;
  ctx: LessonContext;
  revealed: boolean;
  onAnswered: (a: Answered, unsafe: boolean) => void;
  next: React.ReactNode;
  onMissing: () => void;
}) {
  const built = useMemo<BuiltCard | null>(() => buildCard(id, ctx, freshSeed()), [id, ctx]);
  const [answers, setAnswers] = useState<LessonAnswers>(emptyAnswers);
  const shownAt = useRef(Date.now());
  // A lesson rewritten since the card was made may no longer have the step.
  useEffect(() => {
    if (!built) onMissing();
  }, [built]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!built) return null;
  const { lesson, step, scene, figure } = built;

  const commit = () => {
    const o = stepOutcome(step, answers);
    recordAnswer(id, { correct: o.correct, usedHelp: o.partial, unsafe: o.unsafe, seconds: (Date.now() - shownAt.current) / 1000, words: stepWords(step, scene) });
    const answer = step.kind === 'decide'
      ? step.options.filter((x) => step.grades[x.id] === 'best').map((x) => x.label).join(' Or: ')
      : step.blanks.map((b) => `${b.label}: ${typeof b.answer === 'number' ? b.answer.toLocaleString('en-US') : b.answer}${b.unit ? ` ${b.unit}` : ''}`).join('. ');
    onAnswered({ id, title: `${lesson.id} ${lesson.title}: ${step.title}`, answer, acs: lesson.acs, refs: lesson.refs, correct: o.correct }, o.unsafe);
  };

  return (
    <div className="lesson">
      <div className="scene">
        <p className="muted small">From lesson {lesson.id}, {lesson.title}.{variantCount(lesson) > 1 ? ' The situation is picked fresh each time.' : ''}</p>
        {scene && <p className="situ"><Rich text={scene} /></p>}
        <StepView
          step={step}
          level="short"
          answers={answers}
          setAnswers={setAnswers}
          checked={revealed}
          onCheck={commit}
          committed={revealed}
          onCommit={commit}
        />
        {revealed && (
          <>
            {step.kind === 'decide' && <Voice>{step.why}</Voice>}
            <div className="refs">{lesson.acs.map((a) => <span key={a} className="chip acs">{a}</span>)}<RefChips refs={lesson.refs} /></div>
            <div className="step-nav"><span style={{ flex: 1 }} />{next}</div>
          </>
        )}
      </div>
      <aside className="tool" aria-label="Figure for this card">
        {figure ? <Figure figure={figure} practiceField={ctx.practiceField} /> : <p className="muted small">No figure for this card.</p>}
      </aside>
    </div>
  );
}

export function EmptyGlyph() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="40" fill="var(--apron)" stroke="var(--line)" />
      <circle cx="48" cy="48" r="26" fill="none" stroke="var(--sky-ink)" strokeWidth="2" strokeDasharray="6 4" />
      <g transform="translate(48 48)">
        <rect x="-4" y="-18" width="8" height="36" fill="var(--ink)" transform="rotate(-35)" />
      </g>
    </svg>
  );
}
