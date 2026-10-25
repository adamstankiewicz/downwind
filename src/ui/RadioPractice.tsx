// Radio practice: a flight told on the radio at the practice field. Pick a
// mission, copy the ATIS, then type every call the way you would say it. The
// engine in radio/ builds the flight from a seed and grades each transmission
// for who, where and what, the way a controller listens, and says what the
// controller would say back. Three screens: the radio home, the flight with a
// kneeboard beside it, and the debrief. Typing only, never voice.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AircraftProfile } from '../data/aircraft';
import { MISSIONS, buildRadioFlight, callsignFor, checkCopy, newSeed, type Event as RadioEvent, type Freq, type Mission, type RadioFlight } from '../radio/flights';
import { wordy, type CallResult, type Outcome, type Part } from '../radio/grade';
import { MAX_TRIES, emptyRadioAnswers, eventDone, gradeTry, loadRadioLog, recordRadio, scoreRadio, transmitState, type RadioAnswers, type RadioLogEntry, type RadioScore } from '../radio/session';
import { FIELD } from '../radio/field';
import { GRADE_LABEL, Notice, Voice } from './common';
import { Strip, type StripPoint } from './Strip';
import { RefChips } from '../refs/RefViewer';
import { AirportDiagram, focusFor } from './AirportDiagram';

type Transmit = Extract<RadioEvent, { kind: 'transmit' }>;
type Decide = Extract<RadioEvent, { kind: 'decide' }>;
type AtisEvent = Extract<RadioEvent, { kind: 'atis' }>;

const KEYS = ['A', 'B', 'C', 'D'];
const PART_LABEL: Record<Part, string> = { who: 'Who', where: 'Where', what: 'What' };
const OUTCOME_LABEL: Record<Outcome, string> = { heard: 'Heard', missing: 'Missing', wrong: 'Wrong' };

/** The strip label for an event: the frequency it happens on. */
const stripLabel = (e: RadioEvent) => (e.kind === 'atis' ? 'ATIS' : e.kind === 'decide' ? 'Decide' : e.freq.name.replace(`${FIELD.facility} `, ''));

/** True under the phone layout, where the kneeboard folds. */
function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 959px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 959px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

export function RadioPractice({ aircraft, onExit }: { aircraft: AircraftProfile; onExit: () => void }) {
  const [pick, setPick] = useState<{ mission: Mission; seed: number; attempt: number } | null>(null);
  // The same seed builds the same flight, so "fly this one again" is exact.
  const flight = useMemo(() => (pick ? buildRadioFlight(pick.mission, pick.seed, aircraft) : null), [pick, aircraft]);
  const [answers, setAnswers] = useState<RadioAnswers>(emptyRadioAnswers);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState<RadioScore | null>(null);
  const [log, setLog] = useState<RadioLogEntry[]>(loadRadioLog);

  const start = (mission: Mission, seed: number) => {
    setPick((p) => ({ mission, seed, attempt: (p?.attempt ?? 0) + 1 }));
    setAnswers(emptyRadioAnswers());
    setIdx(0);
    setScore(null);
    window.scrollTo({ top: 0 });
  };
  const home = () => {
    setPick(null);
    setScore(null);
    window.scrollTo({ top: 0 });
  };
  const go = (n: number) => {
    setIdx(n);
    window.scrollTo({ top: 0 });
  };
  const finish = () => {
    if (!flight) return;
    const s = scoreRadio(flight, answers);
    setScore(s);
    setLog(recordRadio(flight, s));
    window.scrollTo({ top: 0 });
  };

  if (!flight) return <RadioHome aircraft={aircraft} log={log} onStart={start} onExit={onExit} />;

  const events = flight.events;
  const e = events[Math.min(idx, events.length - 1)];
  const last = idx >= events.length - 1;
  const done = eventDone(flight, e, answers);
  const points: StripPoint[] = [
    ...events.map((x, i) => ({
      id: x.id,
      label: stripLabel(x),
      sub: x.title,
      state: (score || i < idx ? 'done' : i === idx ? 'now' : 'todo') as StripPoint['state'],
      onClick: !score && i < idx ? () => go(i) : undefined,
    })),
    { id: 'debrief', label: 'Debrief', state: score ? 'now' : 'todo' },
  ];

  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <div>
            <h1>{flight.title}</h1>
            <span className="muted">Radio practice at the practice field, not a real airport. You are {flight.callsign.sayFull}.</span>
          </div>
          <button type="button" className="btn quiet" onClick={score ? onExit : home}>{score ? 'Back to course' : 'Leave flight'}</button>
        </div>
        <Strip points={points} label="Steps of this flight" />
      </div>

      {score ? (
        <Debrief flight={flight} answers={answers} score={score} onAgain={() => start(flight.mission, flight.seed)} onNew={() => start(flight.mission, newSeed())} onBack={home} />
      ) : (
        <div className="lesson radio">
          <div className="scene">
            <EventView key={e.id} flight={flight} e={e} answers={answers} setAnswers={setAnswers} />
            <div className="step-nav">
              {idx > 0 && <button type="button" className="btn quiet" onClick={() => go(idx - 1)}>Back</button>}
              <span style={{ flex: 1 }} />
              {last
                ? <button type="button" className="btn primary" disabled={!done} onClick={finish}>Debrief</button>
                : <button type="button" className="btn primary" disabled={!done} onClick={() => go(idx + 1)}>Continue</button>}
            </div>
          </div>
          <Kneeboard flight={flight} e={e} answers={answers} />
        </div>
      )}
    </>
  );
}

// ---------- the radio home ----------

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

function RadioHome({ aircraft, log, onStart, onExit }: { aircraft: AircraftProfile; log: RadioLogEntry[]; onStart: (m: Mission, seed: number) => void; onExit: () => void }) {
  const cs = callsignFor(aircraft);
  // The facilities each mission talks to, in order, read off a sample flight.
  const sequence = (m: Mission) => {
    const names: string[] = [];
    for (const e of buildRadioFlight(m, 1, aircraft).events) {
      const n = e.kind === 'decide' ? null : stripLabel(e);
      if (n && names[names.length - 1] !== n) names.push(n);
    }
    return names;
  };
  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <div>
            <h1>Radio practice</h1>
            <span className="muted">The practice field, not a real airport. Class D, one runway, Ground and Tower.</span>
          </div>
          <button type="button" className="btn quiet" onClick={onExit}>Back to course</button>
        </div>
      </div>

      <div className="radio-home">
        <div className="radio-main">
          <Voice>
            Every flight here is a short story on the radio: the ATIS, a call to Ground, the taxi readback, Tower, the pattern, and home again.
            Type each call the way you would say it. I listen the way a controller does, for who you are calling, who you are, where you are and what you want, and I tell you what the controller would say back.
            {cs.practice ? '' : ` You are ${cs.sayFull}.`}
          </Voice>
          {cs.practice && (
            <Notice kind="info" label="Practice tail number">
              You fly as {cs.sayFull}, a made-up tail. Put your own tail number and type in your airplane, under Tools, and the controller will use yours.
            </Notice>
          )}
          <div className="freqs" aria-label="Frequencies at the practice field">
            <FreqPlate freq={{ name: 'ATIS', mhz: FIELD.atis }} />
            <FreqPlate freq={{ name: `${FIELD.facility} Ground`, mhz: FIELD.ground }} />
            <FreqPlate freq={{ name: `${FIELD.facility} Tower`, mhz: FIELD.tower }} />
          </div>

          <section className="missions-sec">
            <h2>Pick a flight</h2>
            <ul className="missions">
              {MISSIONS.map((m) => (
                <li key={m.id}>
                  <button type="button" className="mission" onClick={() => onStart(m.id, newSeed())}>
                    <b>{m.title}</b>
                    <span className="d">{m.summary}</span>
                    <span className="seq">{sequence(m.id).map((n, i) => <span key={i}>{n}</span>)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="cta">
              <button type="button" className="btn" onClick={() => onStart(MISSIONS[Math.floor(Math.random() * MISSIONS.length)].id, newSeed())}>Surprise me</button>
              <span className="hint">Every flight is different: the ATIS, the runway, the ramp, a closed taxiway, the traffic and what the controller says. Typed, never spoken.</span>
            </div>
          </section>
        </div>

        <section className="radio-side">
          <h2>Recent flights</h2>
          {log.length === 0 ? (
            <p className="help">Nothing flown yet. Flights are kept on this device, with the grade and how many calls were complete the first time.</p>
          ) : (
            <ul className="log">
              {log.map((r, i) => (
                <li key={`${r.at}-${i}`}>
                  <span className="z">{fmtDate(r.at)}</span>
                  <span className="what">
                    <b>{MISSIONS.find((m) => m.id === r.mission)?.title ?? r.mission}</b>
                    <small>{r.clean} of {r.calls} calls complete first time</small>
                  </span>
                  <span className={`g ${r.grade}`}>{GRADE_LABEL[r.grade]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

// ---------- pieces of the tape ----------

/** The frequency you are on: a taxiway-sign plate, name and megahertz. */
function FreqPlate({ freq }: { freq: Freq }) {
  return (
    <span className="freq">
      <span className="fn">{freq.name}</span>
      <span className="fm">{freq.mhz}</span>
    </span>
  );
}

/** One transmission on the frequency: who said it, then the words. */
function Xmit({ who, kind, children }: { who: string; kind: 'atc' | 'pilot' | 'model'; children: ReactNode }) {
  return (
    <div className={`xmit ${kind}`}>
      <span className="who">{who}</span>
      <p className="say">{children}</p>
    </div>
  );
}

const MARK: Record<Outcome, ReactNode> = {
  heard: <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9" /><path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="var(--panel)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  missing: <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.5" /></svg>,
  wrong: <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9" /><path d="M6.5 6.5l7 7M13.5 6.5l-7 7" stroke="var(--panel)" strokeWidth="2.2" strokeLinecap="round" /></svg>,
};

/** How a call was heard: the items grouped who, where, what, each heard, missing or wrong. */
function Readback({ r, e }: { r: CallResult; e: Transmit }) {
  const heard = r.items.filter((x) => x.outcome === 'heard').length;
  const modelWords = e.model.trim().split(/\s+/).length;
  return (
    <div className="readback" role="group" aria-label="How the call was heard">
      <div className="rb-head">
        <span className={`gradechip ${r.grade}`}>{GRADE_LABEL[r.grade]}</span>
        <span className="muted small">{heard} of {r.items.length} heard.{heard === r.items.length ? ' Nothing missing.' : ''}</span>
      </div>
      <div className="rb-groups">
        {(['who', 'where', 'what'] as Part[]).map((part) => {
          const items = r.items.filter((x) => x.item.part === part);
          if (!items.length) return null;
          return (
            <div key={part} className="rb-group">
              <h3>{PART_LABEL[part]}</h3>
              <ul className="plain">
                {items.map((x) => (
                  <li key={x.item.id} className={`rb-item ${x.outcome} ${x.item.need}`}>
                    <i>{MARK[x.outcome]}<span className="vh">{OUTCOME_LABEL[x.outcome]}: </span></i>
                    <span>
                      {x.item.label}
                      {(x.item.need === 'should' || x.outcome !== 'heard') && <small>{x.item.need === 'must' ? 'Required' : 'Good practice'}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {wordy(r, modelWords) && <p className="hint">That was a long one, {r.words} words. The good call is {modelWords}: what the controller needs, then stop.</p>}
    </div>
  );
}

/** The text box and the Transmit button. Enter transmits, Shift+Enter starts a new line. */
function CallBox({ e, retry, onTransmit }: { e: Transmit; retry: boolean; onTransmit: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const send = () => {
    const t = draft.trim();
    if (t) onTransmit(t);
  };
  return (
    <form className="callbox" onSubmit={(ev) => { ev.preventDefault(); send(); }}>
      <label htmlFor={`call-${e.id}`}>Your call</label>
      <textarea
        id={`call-${e.id}`}
        rows={2}
        value={draft}
        autoFocus={retry}
        autoComplete="off"
        placeholder={retry ? 'Say it again, with what was missing' : e.atc ? 'Read it back, then your call sign' : 'Who you are calling, who you are, where you are, what you want'}
        onChange={(ev) => setDraft(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            send();
          }
        }}
      />
      <div className="cta">
        <button type="submit" className="btn primary" disabled={!draft.trim()}>Transmit</button>
        <span className="hint">Type it the way you would say it. Enter transmits.</span>
      </div>
    </form>
  );
}

// ---------- one event of the flight ----------

function EventView({ flight, e, answers, setAnswers }: { flight: RadioFlight; e: RadioEvent; answers: RadioAnswers; setAnswers: (f: (a: RadioAnswers) => RadioAnswers) => void }) {
  if (e.kind === 'atis') return <AtisView e={e} flight={flight} answers={answers} setAnswers={setAnswers} />;
  if (e.kind === 'decide') return <DecideView e={e} answers={answers} setAnswers={setAnswers} />;
  return <TransmitView e={e} flight={flight} answers={answers} setAnswers={setAnswers} />;
}

function AtisView({ e, flight, answers, setAnswers }: { e: AtisEvent; flight: RadioFlight; answers: RadioAnswers; setAnswers: (f: (a: RadioAnswers) => RadioAnswers) => void }) {
  const checked = answers.copyChecked;
  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, copy: { ...a.copy, [id]: v } }));
  const filled = e.fields.every((f) => (answers.copy[f.id] ?? '').trim() !== '');
  return (
    <section className="step">
      <h2>{e.title}</h2>
      <Voice>{e.situation}</Voice>
      <div className="tape">
        <FreqPlate freq={e.freq} />
        <Xmit who="Recorded, repeating" kind="atc">{e.atis.text}</Xmit>
      </div>
      <div className="blanks copy-pad">
        {e.fields.map((f) => {
          const v = answers.copy[f.id] ?? '';
          const right = checked ? checkCopy(f, flight.atis, v) : null;
          return (
            <div key={f.id} className={`blank ${right === null ? '' : right ? 'right' : 'wrong'}`}>
              <label htmlFor={`copy-${f.id}`}>{f.label}</label>
              {f.choices ? (
                <div className="chips" role="group" aria-labelledby={`copy-${f.id}`} id={`copy-${f.id}`}>
                  {f.choices.map((c) => (
                    <button key={c} type="button" className="chip-btn" aria-pressed={v === c} disabled={checked} onClick={() => set(f.id, c)}>{c}</button>
                  ))}
                </div>
              ) : (
                <input id={`copy-${f.id}`} className="mono" type="text" autoComplete="off" placeholder={f.placeholder} value={v} disabled={checked} onChange={(ev) => set(f.id, ev.target.value)} />
              )}
              {checked && <p className="explain"><b>{right ? 'Right.' : `Not quite. ${f.answer}.`}</b></p>}
            </div>
          );
        })}
      </div>
      {!checked && (
        <div className="cta">
          <button type="button" className="btn primary" disabled={!filled} onClick={() => setAnswers((a) => ({ ...a, copyChecked: true }))}>Check my copy</button>
          <span className="hint">The letter or the word both count. Fill every line first.</span>
        </div>
      )}
    </section>
  );
}

function TransmitView({ e, flight, answers, setAnswers }: { e: Transmit; flight: RadioFlight; answers: RadioAnswers; setAnswers: (f: (a: RadioAnswers) => RadioAnswers) => void }) {
  const tries = answers.calls[e.id] ?? [];
  const state = transmitState(flight, e, tries);
  const results = tries.map((t) => gradeTry(flight, e, t));
  const lastResult = results[results.length - 1];
  const transmit = (text: string) => setAnswers((a) => ({ ...a, calls: { ...a.calls, [e.id]: [...(a.calls[e.id] ?? []), text] } }));
  // What the controller says back to the latest call, announced as it arrives.
  const reply = state === 'retry' && lastResult?.fix
    ? <Xmit who={e.freq.name} kind="atc">{lastResult.fix}</Xmit>
    : state === 'done'
      ? <Xmit who="A good call" kind="model">{e.model}</Xmit>
      : null;
  return (
    <section className="step">
      <h2>{e.title}</h2>
      <Voice>{e.situation}</Voice>
      <div className="tape">
        <FreqPlate freq={e.freq} />
        {e.atc && <Xmit who={e.freq.name} kind="atc">{e.atc}</Xmit>}
        {tries.map((t, i) => (
          <Fragment key={i}>
            <Xmit who={flight.callsign.sayFull} kind="pilot">{t}</Xmit>
            <Readback r={results[i]} e={e} />
            {i < tries.length - 1 && results[i].fix && <Xmit who={e.freq.name} kind="atc">{results[i].fix}</Xmit>}
          </Fragment>
        ))}
        <div aria-live="polite">{reply}</div>
        {state !== 'done' && <CallBox key={tries.length} e={e} retry={state === 'retry'} onTransmit={transmit} />}
      </div>
      {state === 'open' && <p className="hint">Grades stay hidden until you transmit. Once you have, the controller answers and you can try again once if they ask.</p>}
      {state === 'retry' && <p className="hint">Try {tries.length + 1} of {MAX_TRIES}. The first try is the one that counts in the debrief.</p>}
    </section>
  );
}

function DecideView({ e, answers, setAnswers }: { e: Decide; answers: RadioAnswers; setAnswers: (f: (a: RadioAnswers) => RadioAnswers) => void }) {
  const [choice, setChoice] = useState<string | null>(answers.decisions[e.id] ?? null);
  const committed = Boolean(answers.decisions[e.id]);
  return (
    <section className="step">
      <h2>{e.title}</h2>
      <p className="situ">{e.situation}</p>
      <p className="prompt">What do you do?</p>
      <div className="choices" role="group" aria-label="Options">
        {e.options.map((o, i) => {
          const picked = choice === o.id;
          const grade = committed ? e.grades[o.id] : null;
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
          <button type="button" className="btn primary" disabled={!choice} onClick={() => choice && setAnswers((a) => ({ ...a, decisions: { ...a.decisions, [e.id]: choice } }))}>Commit</button>
          <span className="hint">Grades stay hidden until you commit.</span>
        </div>
      ) : (
        choice && <Voice className="cons">{e.consequence[choice]}</Voice>
      )}
    </section>
  );
}

// ---------- the kneeboard: the ATIS as copied, and the field ----------

function Kneeboard({ flight, e, answers }: { flight: RadioFlight; e: RadioEvent; answers: RadioAnswers }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const atisEvent = flight.events.find((x): x is AtisEvent => x.kind === 'atis');
  const copied = answers.copyChecked && atisEvent && e.kind !== 'atis';
  const focus = focusFor(e);
  // On a phone the kneeboard opens itself when the diagram matters: a hold short point or a runway crossing.
  useEffect(() => {
    if (focus.holdAt || focus.cross) setOpen(true);
  }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = (
    <div className="kneeboard">
      {copied && (
        <div className="kb-atis">
          <div className="kb-head">
            <b>Information {flight.atis.word}</b>
            <span className="muted small">{flight.atis.timeZ}Z</span>
          </div>
          <dl className="kb-rows">
            {atisEvent.fields.map((f) => {
              const v = answers.copy[f.id] ?? '';
              const ok = checkCopy(f, flight.atis, v);
              return (
                <div key={f.id} className={ok ? 'right' : 'wrong'}>
                  <dt>{f.label}</dt>
                  <dd><span className="mono">{v || 'blank'}</span>{!ok && <small>{f.answer}</small>}</dd>
                </div>
              );
            })}
          </dl>
          <details>
            <summary>The broadcast</summary>
            <p className="kb-text">{flight.atis.text}</p>
          </details>
        </div>
      )}
      <AirportDiagram focus={focus} atis={flight.atis} ramp={flight.ramp} />
    </div>
  );
  if (!phone) return <aside className="tool" aria-label="Kneeboard">{body}</aside>;
  return (
    <aside className="tool" aria-label="Kneeboard">
      <details className="kb-fold" open={open} onToggle={(ev) => setOpen((ev.target as HTMLDetailsElement).open)}>
        <summary>Kneeboard{copied ? `: information ${flight.atis.word}, runway ${flight.atis.runway}, the field` : ': the field'}</summary>
        {body}
      </details>
    </aside>
  );
}

// ---------- the debrief ----------

function Debrief({ flight, answers, score, onAgain, onNew, onBack }: { flight: RadioFlight; answers: RadioAnswers; score: RadioScore; onAgain: () => void; onNew: () => void; onBack: () => void }) {
  const transmits = flight.events.filter((x): x is Transmit => x.kind === 'transmit');
  const decides = flight.events.filter((x): x is Decide => x.kind === 'decide');
  const atisEvent = flight.events.find((x): x is AtisEvent => x.kind === 'atis');
  return (
    <div className="debrief-page">
      <section className="step">
        <h2>Debrief</h2>
        <div className={`grade ${score.grade}`}>{GRADE_LABEL[score.grade]}</div>
        <p className="lcg">
          {score.clean} of {score.calls.length} calls complete the first time.
          {score.decisions.length ? ` ${score.decisions.filter((d) => d.grade === 'best').length} of ${score.decisions.length} decisions the best call.` : ''}
          {score.copyTotal ? ` ATIS copied ${score.copyRight} of ${score.copyTotal}.` : ''}
        </p>
      </section>

      <section className="step">
        <h2>Each call</h2>
        <ol className="decisions calls">
          {score.calls.map((c) => {
            const e = transmits.find((x) => x.id === c.id)!;
            const tries = answers.calls[c.id] ?? [];
            const off = c.first.items.filter((x) => x.outcome !== 'heard');
            return (
              <li key={c.id}>
                <h3>{c.title}</h3>
                <p className="dec-row">
                  <span className={`gradechip ${c.grade}`}>{GRADE_LABEL[c.grade]}</span>
                  {c.tries > 1 && <span className="muted">{c.tries} tries. The first one is graded.</span>}
                </p>
                {e.atc && <Xmit who={e.freq.name} kind="atc">{e.atc}</Xmit>}
                <Xmit who="Your first try" kind="pilot">{tries[0]}</Xmit>
                {off.length > 0 && (
                  <ul className="plain rb-list">
                    {off.map((x) => (
                      <li key={x.item.id} className={`rb-item ${x.outcome} ${x.item.need}`}>
                        <i>{MARK[x.outcome]}<span className="vh">{OUTCOME_LABEL[x.outcome]}: </span></i>
                        <span>{x.item.label}<small>{x.item.need === 'must' ? 'Required' : 'Good practice'}</small></span>
                      </li>
                    ))}
                  </ul>
                )}
                {c.grade !== 'best' && <Xmit who="A good call" kind="model">{e.model}</Xmit>}
                {c.grade !== 'best' && <Voice>{e.why}</Voice>}
              </li>
            );
          })}
        </ol>
      </section>

      {score.decisions.length > 0 && (
        <section className="step">
          <h2>Each decision</h2>
          <ol className="decisions">
            {score.decisions.map((d) => {
              const e = decides.find((x) => x.id === d.id)!;
              const mine = e.options.find((o) => o.id === d.choice)!;
              const best = e.options.filter((o) => e.grades[o.id] === 'best');
              return (
                <li key={d.id}>
                  <h3>{d.title}</h3>
                  <p className="dec-row"><span className="muted">You chose</span> <span>{mine.label}</span> <span className={`gradechip ${d.grade}`}>{GRADE_LABEL[d.grade]}</span></p>
                  {d.grade !== 'best' && best.length > 0 && (
                    <p className="dec-row"><span className="muted">{best.length > 1 ? 'Best calls' : 'Best call'}</span> <span>{best.map((b) => b.label).join(' Or: ')}</span></p>
                  )}
                  <Voice>{e.why}</Voice>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {atisEvent && (
        <section className="step">
          <h2>Your ATIS copy</h2>
          <p><b>{score.copyRight} of {score.copyTotal}</b> lines right. Information {flight.atis.word}.</p>
          <ul className="blank-list">
            {atisEvent.fields.map((f) => {
              const v = answers.copy[f.id] ?? '';
              const ok = checkCopy(f, flight.atis, v);
              return (
                <li key={f.id} className={ok ? 'right' : 'wrong'}>
                  <span>{f.label}</span>
                  <span className="mono">{v || 'blank'}{!ok && <> <span className="muted">(broadcast {f.answer})</span></>}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="step">
        <h2>Standards and references</h2>
        <div className="refs">
          {flight.acs.map((a) => <span key={a} className="chip acs">{a}</span>)}
          <RefChips refs={flight.refs} />
        </div>
      </section>

      <div className="step-nav">
        <button type="button" className="btn quiet" onClick={onBack}>Back to radio practice</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onAgain}>Fly this one again</button>
        <button type="button" className="btn primary" onClick={onNew}>New flight</button>
      </div>
    </div>
  );
}
