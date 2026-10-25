// Review: an FSRS session over the items due now. Pick an answer, then reveal.
// The scheduler reads its rating from the answer: right or wrong, how long it
// took, and whether a wrong pick was an unsafe one, which also comes back
// once more before the session ends.

import { useEffect, useRef, useState } from 'react';
import type { ReviewItem } from '../review/items';
import { dueItems, recordAnswer, wordsIn } from '../review/scheduler';
import { Card, PageHead } from './common';
import { RefChips } from '../refs/RefViewer';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Answered {
  item: ReviewItem;
  correct: boolean;
}

export function Review() {
  const [session, setSession] = useState<ReviewItem[]>(() => dueItems());
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState<Answered[]>([]);
  const shownAt = useRef(Date.now());
  const requeued = useRef(new Set<string>());

  const item = session[idx];
  const finished = idx >= session.length;
  useEffect(() => {
    shownAt.current = Date.now();
  }, [idx, session]);

  const restart = () => {
    setSession(dueItems());
    setIdx(0);
    setPicked(null);
    setRevealed(false);
    setDone([]);
    requeued.current.clear();
  };

  const commit = () => {
    if (picked === null || !item) return;
    const correct = picked === item.answer;
    const unsafe = !correct && (item.unsafeOptions?.includes(picked) ?? false);
    recordAnswer(item.id, { correct, unsafe, seconds: (Date.now() - shownAt.current) / 1000, words: wordsIn(item) });
    if (unsafe && !requeued.current.has(item.id)) {
      requeued.current.add(item.id);
      setSession([...session, item]);
    }
    setDone([...done, { item, correct }]);
    setRevealed(true);
  };

  const next = () => {
    setIdx(idx + 1);
    setPicked(null);
    setRevealed(false);
  };

  if (session.length === 0) {
    return (
      <>
        <PageHead title="Review" lead="Spaced repetition over ACS Area I, scheduled with FSRS." />
        <div className="empty">
          <EmptyGlyph />
          <h2>Nothing due</h2>
          <p>Every item is scheduled for later. Come back when the scheduler calls, or make a go/no-go decision on the Today screen.</p>
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
          {right < done.length && <p className="help">Missed items come back soonest.</p>}
          <ul className="findings">
            {done.map((d, i) => (
              <li key={`${d.item.id}-${i}`} className={`finding ${d.correct ? 'right' : 'illegal'}`}>
                <span className="sev">{d.correct ? 'Right' : 'Missed'}</span>
                <h4>{d.item.prompt}</h4>
                <p>{d.item.options[d.item.answer]}</p>
                <div className="refs"><span className="chip acs">{d.item.acs}</span><RefChips refs={[d.item.ref]} /></div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn primary" onClick={restart}>Start another session</button>
        </Card>
      </>
    );
  }

  const correct = revealed && picked === item.answer;

  return (
    <>
      <PageHead
        title="Review"
        lead="Answer first, then read."
        meta={<>Item <b>{idx + 1}</b> of {session.length}</>}
      />
      <div className="progress" aria-hidden="true"><i style={{ width: `${(idx / session.length) * 100}%` }} /></div>

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
              <>
                <button type="button" className="btn primary" disabled={picked === null} onClick={commit}>Reveal</button>
              </>
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
                <button type="button" className="btn primary" onClick={next}>{idx + 1 < session.length ? 'Next' : 'Finish'}</button>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
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
