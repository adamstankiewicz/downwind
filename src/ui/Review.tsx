// Review: an FSRS session over the items due now. Confidence is rated before
// the answer is revealed; the scheduler uses both.

import { useState } from 'react';
import type { ReviewItem } from '../review/items';
import { dueItems, recordAnswer } from '../review/scheduler';
import { Card, PageHead } from './common';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Answered {
  item: ReviewItem;
  correct: boolean;
  confidence: number;
}

export function Review() {
  const [session, setSession] = useState<ReviewItem[]>(() => dueItems());
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(50);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState<Answered[]>([]);

  const item = session[idx];
  const finished = idx >= session.length;

  const restart = () => {
    setSession(dueItems());
    setIdx(0);
    setPicked(null);
    setConfidence(50);
    setRevealed(false);
    setDone([]);
  };

  const commit = () => {
    if (picked === null || !item) return;
    const correct = picked === item.answer;
    recordAnswer(item.id, correct, confidence);
    setDone([...done, { item, correct, confidence }]);
    setRevealed(true);
  };

  const next = () => {
    setIdx(idx + 1);
    setPicked(null);
    setConfidence(50);
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
    const cw = done.filter((d) => !d.correct && d.confidence >= 70).length;
    return (
      <>
        <PageHead title="Review" lead="Session complete." />
        <Card title="Session summary">
          <div className="score-row">
            <div className="stat"><span className="k">Answered</span><span className="v">{done.length}</span></div>
            <div className="stat"><span className="k">Correct</span><span className="v">{right}</span></div>
            <div className="stat"><span className="k">Confidently wrong</span><span className={`v ${cw ? 'warn' : ''}`}>{cw}</span></div>
          </div>
          {cw > 0 && (
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              Confidently wrong answers come back soonest. They are the ones that would bite you on a checkride or in the airplane.
            </p>
          )}
          <ul className="findings">
            {done.map((d) => (
              <li key={d.item.id} className={`finding ${d.correct ? 'info' : 'illegal'}`}>
                <span className="sev">{d.correct ? 'Right' : 'Missed'}</span>
                <h4>{d.item.prompt}</h4>
                <p>{d.item.options[d.item.answer]}</p>
                <div className="refs"><span className="chip acs">{d.item.acs}</span><span className="chip">{d.item.ref}</span></div>
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
        lead="Answer first, then read. Rate your confidence before you reveal."
        meta={<><span>Item</span><b>{idx + 1} of {session.length}</b></>}
      />
      <div className="progress" aria-hidden="true"><i style={{ width: `${(idx / session.length) * 100}%` }} /></div>

      <div className="grid-2">
        <Card title={item.acs} sub="ACS task">
          <p className="review-q">{item.prompt}</p>
          <div className="choices" role="group" aria-label="Options">
            {item.options.map((o, i) => {
              const isAnswer = revealed && i === item.answer;
              const isPicked = picked === i;
              return (
                <button
                  key={i}
                  type="button"
                  className={`choice ${revealed ? 'revealed' : ''} ${isPicked || isAnswer ? 'picked' : ''}`}
                  aria-pressed={isPicked}
                  disabled={revealed}
                  onClick={() => setPicked(i)}
                  style={isAnswer ? { borderColor: 'var(--vfr)', boxShadow: 'inset 3px 0 0 var(--vfr)' } : revealed && isPicked ? { borderColor: 'var(--ifr)', boxShadow: 'inset 3px 0 0 var(--ifr)' } : undefined}
                >
                  <span className="key">{KEYS[i]}</span>
                  <span>{o}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="stack">
          <Card title={revealed ? 'Result' : 'Commit'}>
            {!revealed ? (
              <>
                <div className="conf">
                  <div className="conf-row">
                    <label htmlFor="rconf">How sure are you?</label>
                    <b>{confidence}%</b>
                  </div>
                  <input id="rconf" type="range" min={0} max={100} step={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
                  <div className="conf-row"><span>Guessing</span><span>Certain</span></div>
                </div>
                <button type="button" className="btn primary" disabled={picked === null} onClick={commit}>Reveal</button>
              </>
            ) : (
              <>
                <div className={`result ${correct ? '' : 'wrong'}`}>
                  <b>{correct ? 'Correct' : confidence >= 70 ? 'Missed, and you were sure' : 'Missed'}</b>
                  <span>{item.explanation}</span>
                  <div className="refs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span className="chip acs">{item.acs}</span>
                    <span className="chip">{item.ref}</span>
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
      <circle cx="48" cy="48" r="40" fill="var(--chart)" stroke="var(--rule)" />
      <circle cx="48" cy="48" r="26" fill="none" stroke="var(--classb)" strokeWidth="2" strokeDasharray="6 4" />
      <g transform="translate(48 48)">
        <circle r="9" fill="none" stroke="var(--magenta)" strokeWidth="2" />
        <rect x="-15" y="-2" width="30" height="4" fill="var(--magenta)" transform="rotate(-50)" />
      </g>
    </svg>
  );
}
