// Ask the instructor: a question typed about the step in front of the pilot,
// answered in the instructor's voice. It sits under the step, quiet until
// opened, and never competes with the step's own button. It renders nothing
// at all when the worker cannot answer. Typing and tapping only.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { askAvailable, askInstructor, type AskResult } from '../ask/client';
import { askRequest, MAX_QUESTION, type AskContext, type AskTurn } from '../ask/context';
import type { Step } from '../course/types';
import { RefChips } from '../refs/RefViewer';
import { Icons, Mark, Notice, Voice } from './common';
import { Rich } from './text';

/** One asked question with what came back, kept per step by the player. */
export interface AskEntry extends AskTurn {
  refs: string[];
}

type Failure = Extract<AskResult, { ok: false }>['reason'];

/** Resolves once per session; null while the answer is still on its way. */
export function useAskAvailable(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    askAvailable().then((ok) => { if (live) setOn(ok); });
    return () => { live = false; };
  }, []);
  return on;
}

/** Three ways in, chosen for the kind of step and whether its answer is out yet. */
export function starterQuestions(step: Step, revealed: boolean): string[] {
  switch (step.kind) {
    case 'brief':
      return ['Why does this matter in the airplane?', 'What should I notice first?', 'Where does this rule come from?'];
    case 'example':
      return ['Walk me through this step by step.', 'Why that number and not another?', 'How would I do this in the airplane?'];
    case 'turn':
      return revealed
        ? ['Why is that the answer?', 'Where did my reasoning go wrong?', 'Is there a quicker way to work this out?']
        : ['How do I work this out?', 'Which rule applies here?', 'What am I likely to miss?'];
    case 'decide':
      return revealed
        ? ['Why was that the best call?', 'What makes the other options worse?', 'What would change this decision?']
        : ['What should I be weighing here?', 'Which rule applies here?', 'What would a careful pilot ask first?'];
  }
}

const FAIL_COPY: Record<Failure, { label: string; text: string }> = {
  unavailable: { label: 'Instructor not available', text: 'The instructor is not available right now. The lesson carries on without it.' },
  busy: { label: 'Busy at the moment', text: 'A lot of questions are coming in. Give it a few seconds and ask again.' },
  failed: { label: 'That did not go through', text: 'Nothing was lost. Ask again when you are ready.' },
  limit: { label: 'That is all for today', text: 'This device has asked its questions for the day. The instructor is back tomorrow, and the lesson carries on without it.' },
};

export function AskInstructor({ step, context, revealed, thread, onAnswer }: {
  step: Step;
  context: AskContext;
  /** The blanks are checked or the decision is committed, so the answer is out. */
  revealed: boolean;
  /** Earlier questions on this step, oldest first. */
  thread: AskEntry[];
  onAnswer: (entry: AskEntry) => void;
}) {
  const available = useAskAvailable();
  const [open, setOpen] = useState(thread.length > 0);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ reason: Failure; question: string } | null>(null);
  const [gone, setGone] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const fieldId = `ask-${step.id}`;

  // A question left pending when the pilot moves on is dropped, not answered later.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  if (available !== true) return null;

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || pending) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFailure(null);
    setPending(question);
    setDraft('');
    const earlier = thread.map(({ question: q, answer }) => ({ question: q, answer }));
    const result = await askInstructor(askRequest(question, earlier, context), ctrl.signal);
    if (ctrl.signal.aborted) return;
    abort.current = null;
    setPending(null);
    if (result.ok) {
      onAnswer({ question, answer: result.reply.answer, refs: result.reply.refs });
    } else {
      setFailure({ reason: result.reason, question });
      if (result.reason === 'unavailable') setGone(true);
    }
    field.current?.focus();
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setDraft(pending ?? '');
    setPending(null);
    requestAnimationFrame(() => field.current?.focus());
  };

  const toggle = () => {
    if (open && pending) cancel();
    setOpen((o) => !o);
    if (open) requestAnimationFrame(() => opener.current?.focus());
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const starters = thread.length === 0 && !pending ? starterQuestions(step, revealed) : [];
  const left = MAX_QUESTION - draft.length;

  return (
    <section className={`ask ask-instructor ${open ? 'open' : ''}`} role="region" aria-label="Ask the instructor">
      <button ref={opener} type="button" className="btn quiet ask-open" aria-expanded={open} aria-controls={`${fieldId}-panel`} onClick={toggle}>
        <Mark />Ask the instructor
      </button>

      {open && (
        <div id={`${fieldId}-panel`} className="ask-panel">
          <div className="ask-thread" aria-live="polite" aria-busy={pending !== null}>
            {thread.map((t, i) => (
              <div key={i} className="ask-turn">
                <p className="ask-q"><span className="ask-who" aria-hidden="true">{Icons.pilot}</span><span>{t.question}</span></p>
                <Voice><Rich text={t.answer} /></Voice>
                {t.refs.length > 0 && <div className="refs ask-refs"><RefChips refs={t.refs} /></div>}
              </div>
            ))}
            {pending && (
              <div className="ask-turn">
                <p className="ask-q"><span className="ask-who" aria-hidden="true">{Icons.pilot}</span><span>{pending}</span></p>
                <div className="cta ask-wait">
                  <Voice className="thinking"><span className="muted">Thinking it over.</span></Voice>
                  <button type="button" className="btn quiet sm" onClick={cancel}>Cancel</button>
                </div>
              </div>
            )}
            {failure && (
              <Notice
                kind="info"
                label={FAIL_COPY[failure.reason].label}
                action={failure.reason !== 'unavailable' && failure.reason !== 'limit' && <button type="button" className="btn quiet" onClick={() => void send(failure.question)}>Ask again</button>}
              >
                {FAIL_COPY[failure.reason].text}
              </Notice>
            )}
          </div>

          {!gone && (
            <form className="ask-compose" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
              {starters.length > 0 && (
                <div className="chips ask-starters" role="group" aria-label="Questions to start with">
                  {starters.map((q) => (
                    <button key={q} type="button" className="chip-btn" onClick={() => { setDraft(q); field.current?.focus(); }}>{q}</button>
                  ))}
                </div>
              )}
              <label htmlFor={fieldId}>Your question</label>
              <textarea
                id={fieldId}
                ref={field}
                rows={2}
                maxLength={MAX_QUESTION}
                value={draft}
                disabled={pending !== null}
                placeholder="About this step"
                autoComplete="off"
                aria-describedby={`${fieldId}-help`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
              />
              <div className="cta">
                <button type="submit" className="btn" disabled={!draft.trim() || pending !== null}>Ask</button>
                <span id={`${fieldId}-help`} className="hint">
                  The instructor explains and does not grade.<span className="ask-kbd"> Enter sends, Shift+Enter for a new line.</span>
                  {left <= 60 && <> <span className="mono">{left}</span> characters left.</>}
                </span>
              </div>
              <p className="hint ask-note">Training aid, not a briefing. Check anything that matters against your POH, the regulations or your CFI.</p>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
