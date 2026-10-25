// Radio practice: a flight told on the radio at the practice field. Pick a
// mission, copy the ATIS, then type every call the way you would say it. The
// engine in radio/ builds the flight from a seed and grades each transmission
// for who, where and what, the way a controller listens, and says what the
// controller would say back. Three screens: the radio home, the flight with a
// kneeboard beside it, and the debrief. The pilot always types. With sound on
// (off until they ask) the controller and the ATIS are read aloud by a voice
// on the device, and with listen first the words wait behind a button so the
// pilot copies by ear. The words are never more than one tap away.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AircraftProfile } from '../data/aircraft';
import { MISSIONS, buildRadioFlight, callsignFor, checkCopy, newSeed, type Event as RadioEvent, type Freq, type Mission, type RadioFlight } from '../radio/flights';
import { wordy, type CallResult, type Outcome, type Part } from '../radio/grade';
import { MAX_TRIES, emptyRadioAnswers, eventDone, gradeTry, loadRadioLog, recordRadio, scoreRadio, transmitState, type RadioAnswers, type RadioLogEntry, type RadioScore } from '../radio/session';
import { FIELD } from '../radio/field';
import { canSpeak, deviceVoices, loadRadioPrefs, onVoicesChanged, saveRadioPrefs, speak, stopSpeaking, type RadioPrefs } from '../radio/voice';
import { KOKORO_VOICES, MODEL_INFO, autoLoadModels, canRecord, loadModel, modelState, startRecording, subscribeModels, transcribe } from '../radio/models/client';
import type { ModelId } from '../radio/models/protocol';
import { Field, GRADE_LABEL, Notice, Voice } from './common';
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
  const [prefs, setPrefsState] = useState<RadioPrefs>(loadRadioPrefs);
  const setPrefs = (p: RadioPrefs) => {
    if (!p.sound) stopSpeaking();
    saveRadioPrefs(p);
    setPrefsState(p);
  };
  // Nothing keeps talking after the screen is gone.
  useEffect(() => () => stopSpeaking(), []);
  // The speech models load as part of opening radio practice, from the cache after the first time.
  useEffect(() => autoLoadModels(prefs.speechInput), []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (mission: Mission, seed: number) => {
    stopSpeaking();
    setPick((p) => ({ mission, seed, attempt: (p?.attempt ?? 0) + 1 }));
    setAnswers(emptyRadioAnswers());
    setIdx(0);
    setScore(null);
    window.scrollTo({ top: 0 });
  };
  const home = () => {
    stopSpeaking();
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
    stopSpeaking();
    const s = scoreRadio(flight, answers);
    setScore(s);
    setLog(recordRadio(flight, s));
    window.scrollTo({ top: 0 });
  };

  if (!flight) return <RadioHome aircraft={aircraft} log={log} prefs={prefs} setPrefs={setPrefs} onStart={start} onExit={onExit} />;

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
            <EventView key={e.id} flight={flight} e={e} answers={answers} setAnswers={setAnswers} prefs={prefs} setPrefs={setPrefs} />
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

function RadioHome({ aircraft, log, prefs, setPrefs, onStart, onExit }: { aircraft: AircraftProfile; log: RadioLogEntry[]; prefs: RadioPrefs; setPrefs: (p: RadioPrefs) => void; onStart: (m: Mission, seed: number) => void; onExit: () => void }) {
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
            <SoundControl prefs={prefs} setPrefs={setPrefs} />
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
              <span className="hint">Every flight is different: the ATIS, the runway, the ramp, a closed taxiway, the traffic and what the controller says. You type every call. Turn sound on to hear the controller.</span>
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

// ---------- sound ----------

const SpeakerGlyph = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M3 7.5h3.2L10.5 4v12L6.2 12.5H3z" fill="currentColor" />
    {on
      ? <path d="M13 7.2a3.6 3.6 0 0 1 0 5.6M15.3 5a6.6 6.6 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      : <path d="M13 8l4 4M17 8l-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
  </svg>
);

/** The sound settings button and, when open, the panel under it. Sits on a frequency row. */
function SoundControl({ prefs, setPrefs }: { prefs: RadioPrefs; setPrefs: (p: RadioPrefs) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn quiet sm sound-btn ${prefs.sound ? 'on' : ''}`} aria-expanded={open} aria-controls="sound-panel" onClick={() => setOpen((o) => !o)}>
        <SpeakerGlyph on={prefs.sound} />
        Sound settings
      </button>
      <ModelStatus />
      {open && <SoundSettings prefs={prefs} setPrefs={setPrefs} />}
    </>
  );
}

/**
 * A quiet line beside Sound settings while the speech models come down, so
 * the pilot knows why the voice is the device's for now. Gone once both are
 * ready; a failure stays in the settings panel, with its Try again.
 */
function ModelStatus() {
  const kokoro = useModel('kokoro');
  const moonshine = useModel('moonshine');
  const [id, m] = kokoro.status === 'loading' ? (['kokoro', kokoro] as const) : moonshine.status === 'loading' ? (['moonshine', moonshine] as const) : [null, null];
  if (!id || !m) return null;
  const info = MODEL_INFO[id];
  const pct = m.progress === null ? null : Math.round(m.progress * 100);
  const what = id === 'kokoro' ? 'the controller voice' : 'speech input';
  return (
    <span className="model-status hint" role="status">
      <span className="bar" aria-hidden="true"><i style={{ width: `${pct ?? 4}%` }} /></span>
      {pct === null || pct === 100 ? `Getting ${what} ready` : `Downloading ${what}, ${pct}% of ${info.mb} MB`}
    </span>
  );
}

function Switch({ label, sub, on, disabled, onChange }: { label: string; sub: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`sw-row ${disabled ? 'off' : ''}`}>
      <span className="sw-l">{label}</span>
      <button type="button" className="sw" aria-pressed={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />
      <span className="sw-s">{sub}</span>
    </div>
  );
}

/** The state of one optional model, live. */
const useModel = (id: ModelId) => useSyncExternalStore(subscribeModels, () => modelState(id), () => modelState(id));

/**
 * One speech model in the settings: its progress, plain words when it fails,
 * and a download button only when it was not fetched on its own (data saver,
 * a low-memory device). Downloads happen once and run on this device.
 */
function ModelRow({ id, fallback, children }: { id: ModelId; fallback: string; children?: ReactNode }) {
  const m = useModel(id);
  const info = MODEL_INFO[id];
  const pct = m.progress === null ? null : Math.round(m.progress * 100);
  return (
    <div className={`model ${m.status}`}>
      {m.status === 'idle' && (
        <div className="cta">
          <button type="button" className="btn sm" onClick={() => loadModel(id)}>Download {info.name}</button>
          <span className="hint">{info.mb} MB, once. Not fetched on its own because this browser is saving data. It runs on this device and nothing you say or hear is sent anywhere.</span>
        </div>
      )}
      {m.status === 'loading' && (
        <div className="model-progress" role="progressbar" aria-label={`Downloading ${info.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={pct === null ? 'Starting' : `${pct} percent`}>
          <span className="bar" aria-hidden="true"><i style={{ width: `${pct ?? 4}%` }} /></span>
          <span className="hint">{pct === null ? `Getting ${info.name} ready` : pct === 100 ? `Loading ${info.name}` : `Downloading ${info.name}, ${pct} percent`}</span>
        </div>
      )}
      {m.status === 'error' && (
        <div className="cta">
          <span className="hint err">{info.name} could not load: {m.error ?? 'unknown problem'}. {fallback}</span>
          <button type="button" className="btn quiet sm" onClick={() => loadModel(id)}>Try again</button>
        </div>
      )}
      {m.status === 'ready' && children}
    </div>
  );
}

/** Sound on or off, listen first, squelch, who reads and how fast, and speaking your calls. Saved on this device. */
function SoundSettings({ prefs, setPrefs }: { prefs: RadioPrefs; setPrefs: (p: RadioPrefs) => void }) {
  const [voices, setVoices] = useState(deviceVoices);
  // Some browsers hand the voice list over late, or only after it is asked for once.
  useEffect(() => onVoicesChanged(() => setVoices(deviceVoices())), []);
  const kokoro = useModel('kokoro');
  const noVoice = (!canSpeak() || voices.length === 0) && kokoro.status !== 'ready';
  const set = (p: Partial<RadioPrefs>) => setPrefs({ ...prefs, ...p });
  const chooseEngine = (engine: RadioPrefs['engine']) => set({ engine });
  const sample = () => void speak(`${FIELD.facility} Tower, Cessna 2XY, runway 24, cleared for takeoff, altimeter 30.08.`, prefs);
  const canSample = prefs.sound && (prefs.engine === 'kokoro' ? kokoro.status === 'ready' : !noVoice);
  return (
    <div className="sound-panel" id="sound-panel" role="group" aria-label="Sound settings">
      <p className="hint lead">Sound is optional. The words are always on the page, and typing always works. The voice and speech models download once, run on this device and are kept for offline use.</p>
      <Switch label="Sound" sub="A voice reads the controller and the ATIS. Off until you turn it on." on={prefs.sound} onChange={(v) => set({ sound: v })} />
      <Switch label="Listen first" sub={prefs.sound ? 'The words wait behind a button until you ask, so you copy by ear.' : 'Turn sound on first.'} on={prefs.listenFirst} disabled={!prefs.sound} onChange={(v) => set({ listenFirst: v })} />
      <Switch label="Radio squelch" sub="A short burst of static when the controller keys up and lets go." on={prefs.radio} disabled={!prefs.sound} onChange={(v) => set({ radio: v })} />

      <div className={`sound-who ${prefs.sound ? '' : 'off'}`}>
        <span className="sw-l" id="voice-label">Voice</span>
        <div className="seg" role="group" aria-labelledby="voice-label">
          <button type="button" aria-pressed={prefs.engine === 'kokoro'} disabled={!prefs.sound} onClick={() => chooseEngine('kokoro')}>Kokoro</button>
          <button type="button" aria-pressed={prefs.engine === 'device'} disabled={!prefs.sound} onClick={() => chooseEngine('device')}>Your device's voice</button>
        </div>
        {prefs.engine === 'device' && (noVoice
          ? <p className="hint">This device has no built-in voice, so the controller stays in writing. Kokoro works instead.</p>
          : (
            <Field label="Which voice">
              <select value={prefs.voice ?? ''} disabled={!prefs.sound} onChange={(ev) => set({ voice: ev.target.value || null })}>
                <option value="">Device default</option>
                {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </Field>
          ))}
        {prefs.engine === 'kokoro' && (
          <ModelRow id="kokoro" fallback="Your device's voice reads instead.">
            <Field label="Which voice">
              <select value={prefs.kokoroVoice} onChange={(ev) => set({ kokoroVoice: ev.target.value })}>
                {KOKORO_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </Field>
          </ModelRow>
        )}
        <Field label="Pace" hint="Controllers run a little quick.">
          <span className="pace">
            <input type="range" min={0.9} max={1.5} step={0.05} value={prefs.rate} disabled={!prefs.sound} aria-label="Pace" aria-valuetext={`${prefs.rate.toFixed(2)} times normal`} onChange={(ev) => set({ rate: Number(ev.target.value) })} />
            <b className="mono">{prefs.rate.toFixed(2)}</b>
          </span>
        </Field>
        <div className="cta">
          <button type="button" className="btn sm" disabled={!canSample} onClick={sample}>Hear a sample</button>
        </div>
      </div>

      <Switch
        label="Speak your calls"
        sub={canRecord()
          ? 'Hold a button and say your call. The words land in the box for you to check before you transmit. Typing always works.'
          : 'This browser has no microphone access. Typing works the same.'}
        on={prefs.speechInput}
        disabled={!canRecord()}
        onChange={(v) => { set({ speechInput: v }); if (v) loadModel('moonshine'); }}
      />
      {prefs.speechInput && canRecord() && (
        <ModelRow id="moonshine" fallback="Keep typing your calls.">
          <p className="hint">Moonshine is ready. Hold the talk button beside Transmit and say your call.</p>
        </ModelRow>
      )}
    </div>
  );
}

/**
 * Hold to talk: the microphone while the button is held, then the words into
 * the call box for the pilot to check. Nothing is transmitted by itself.
 * Pointer: down starts, up stops. Keyboard: Space or Enter starts and stops.
 */
function HoldToTalk({ onText }: { onText: (text: string) => void }) {
  const [state, setState] = useState<'idle' | 'listening' | 'reading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  useEffect(() => () => rec.current?.cancel(), []);
  const begin = () => {
    if (state !== 'idle' && state !== 'error') return;
    setState('listening');
    setError(null);
    starting.current = startRecording().then((r) => { rec.current = r; }).catch((e: unknown) => {
      rec.current = null;
      setState('error');
      setError(/denied|permission|NotAllowed/i.test(String(e)) ? 'The microphone was not allowed. Type your call instead.' : 'The microphone could not start. Type your call instead.');
    });
  };
  const end = async () => {
    if (state !== 'listening') return;
    await starting.current;
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setState('reading');
    try {
      const text = (await transcribe(await r.stop())).trim();
      if (text) onText(text);
      setState('idle');
    } catch {
      setState('error');
      setError('Could not read what you said. Type your call instead.');
    }
  };
  const live = state === 'listening' ? 'Listening' : state === 'reading' ? 'Reading what you said' : state === 'error' ? error : null;
  return (
    <span className="talk">
      <button
        type="button"
        className={`btn sm talk-btn ${state}`}
        aria-pressed={state === 'listening'}
        disabled={state === 'reading'}
        onPointerDown={(ev) => { if (ev.button === 0) { ev.preventDefault(); begin(); } }}
        onPointerUp={() => void end()}
        onPointerCancel={() => void end()}
        onPointerLeave={() => void end()}
        onKeyDown={(ev) => {
          if (ev.repeat || (ev.key !== ' ' && ev.key !== 'Enter')) return;
          ev.preventDefault();
          if (state === 'listening') void end();
          else begin();
        }}
        onContextMenu={(ev) => ev.preventDefault()}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="7" y="2.5" width="6" height="9" rx="3" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        Hold to talk
      </button>
      <span className={`hint ${state === 'error' ? 'err' : ''}`} role="status">{live}</span>
    </span>
  );
}

/** Speaks on request and remembers which line is playing. Stops when the owner unmounts. */
function useSpeaker(prefs: RadioPrefs) {
  const [playing, setPlaying] = useState<string | null>(null);
  const token = useRef(0);
  const say = useCallback((id: string, text: string) => {
    const t = ++token.current;
    setPlaying(id);
    void speak(text, prefs).then(() => { if (token.current === t) setPlaying(null); });
  }, [prefs]);
  useEffect(() => () => { token.current++; stopSpeaking(); }, []);
  return { playing, say };
}

/** A line heard on the frequency but not yet read: a trace of the transmission, and the way to the words. */
function HeardLine({ text, playing, onShow }: { text: string; playing: boolean; onShow: () => void }) {
  // Bar heights follow the text, so the same transmission always draws the same trace.
  const n = Math.min(40, Math.max(14, Math.round(text.length / 4)));
  const bars = Array.from({ length: n }, (_, i) => 3 + ((text.charCodeAt(i % text.length) * 7 + i * 13) % 13));
  return (
    <div className={`heard ${playing ? 'on' : ''}`}>
      <svg viewBox={`0 0 ${n * 5} 20`} height="20" width={n * 5} aria-hidden="true" focusable="false">
        {bars.map((h, i) => <rect key={i} x={i * 5} y={10 - h / 2} width="3" height={h} rx="1.5" />)}
      </svg>
      <span className="vh">The controller's words are hidden until you ask.</span>
      <button type="button" className="btn sm" onClick={onShow}>Show the words</button>
    </div>
  );
}

/**
 * One transmission on the frequency: who said it, then the words. A controller
 * line can carry a play control and, under listen first, hide its words behind
 * a trace until the pilot asks for them.
 */
function Xmit({ who, kind, children, play, playLabel, playing, hidden, onShow }: { who: string; kind: 'atc' | 'pilot' | 'model'; children: ReactNode; play?: () => void; playLabel?: string; playing?: boolean; hidden?: boolean; onShow?: () => void }) {
  return (
    <div className={`xmit ${kind}`}>
      <span className="who">
        {who}
        {play && (
          <button type="button" className={`play ${playing ? 'on' : ''}`} aria-label={playLabel} onClick={play}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M6 4.5v11l9-5.5z" /></svg>
          </button>
        )}
      </span>
      {hidden && onShow
        ? <HeardLine text={typeof children === 'string' ? children : who} playing={Boolean(playing)} onShow={onShow} />
        : <p className="say">{children}</p>}
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

/**
 * The text box and the Transmit button. Enter transmits, Shift+Enter starts a
 * new line. With speech input on and Moonshine ready, a hold-to-talk button
 * puts what the pilot said into the box; they still read it and transmit.
 */
function CallBox({ e, retry, prefs, onTransmit }: { e: Transmit; retry: boolean; prefs: RadioPrefs; onTransmit: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const moonshine = useModel('moonshine');
  const talk = prefs.speechInput && moonshine.status === 'ready' && canRecord();
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
        {talk && <HoldToTalk onText={(t) => setDraft((d) => (d.trim() ? `${d.trim()} ${t}` : t))} />}
        <span className="hint">{talk ? 'Type it, or hold to talk and check the words. Enter transmits.' : 'Type it the way you would say it. Enter transmits.'}</span>
      </div>
    </form>
  );
}

// ---------- one event of the flight ----------

type Sound = { prefs: RadioPrefs; setPrefs: (p: RadioPrefs) => void };

function EventView({ flight, e, answers, setAnswers, prefs, setPrefs }: { flight: RadioFlight; e: RadioEvent; answers: RadioAnswers; setAnswers: (f: (a: RadioAnswers) => RadioAnswers) => void } & Sound) {
  if (e.kind === 'atis') return <AtisView e={e} flight={flight} answers={answers} setAnswers={setAnswers} prefs={prefs} setPrefs={setPrefs} />;
  if (e.kind === 'decide') return <DecideView e={e} answers={answers} setAnswers={setAnswers} />;
  return <TransmitView e={e} flight={flight} answers={answers} setAnswers={setAnswers} prefs={prefs} setPrefs={setPrefs} />;
}

/** The top of the tape: the frequency, and the sound settings beside it. */
function TapeHead({ freq, prefs, setPrefs }: { freq: Freq } & Sound) {
  return (
    <div className="tape-head">
      <FreqPlate freq={freq} />
      <SoundControl prefs={prefs} setPrefs={setPrefs} />
    </div>
  );
}

function AtisView({ e, flight, answers, setAnswers, prefs, setPrefs }: { e: AtisEvent; flight: RadioFlight; answers: RadioAnswers; setAnswers: (f: (a: RadioAnswers) => RadioAnswers) => void } & Sound) {
  const checked = answers.copyChecked;
  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, copy: { ...a.copy, [id]: v } }));
  const filled = e.fields.every((f) => (answers.copy[f.id] ?? '').trim() !== '');
  const { playing, say } = useSpeaker(prefs);
  const [shown, setShown] = useState(false);
  // Listen first: the broadcast stays hidden until asked for, or until the copy is checked.
  const hidden = prefs.sound && prefs.listenFirst && !shown && !checked;
  useEffect(() => { if (prefs.sound) say('atis', e.atis.text); }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="step">
      <h2>{e.title}</h2>
      <Voice>{e.situation}</Voice>
      <div className="tape">
        <TapeHead freq={e.freq} prefs={prefs} setPrefs={setPrefs} />
        <Xmit who="Recorded, repeating" kind="atc" play={() => say('atis', e.atis.text)} playLabel="Play the ATIS" playing={playing === 'atis'} hidden={hidden} onShow={() => setShown(true)}>{e.atis.text}</Xmit>
      </div>
      {hidden && <p className="hint">Fill the pad from what you heard. The words are one tap away if you need them.</p>}
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

function TransmitView({ e, flight, answers, setAnswers, prefs, setPrefs }: { e: Transmit; flight: RadioFlight; answers: RadioAnswers; setAnswers: (f: (a: RadioAnswers) => RadioAnswers) => void } & Sound) {
  const tries = answers.calls[e.id] ?? [];
  const state = transmitState(flight, e, tries);
  const results = tries.map((t) => gradeTry(flight, e, t));
  const lastResult = results[results.length - 1];
  const transmit = (text: string) => setAnswers((a) => ({ ...a, calls: { ...a.calls, [e.id]: [...(a.calls[e.id] ?? []), text] } }));
  const { playing, say } = useSpeaker(prefs);
  const [shown, setShown] = useState(false);
  // Listen first: the controller's words wait until asked for. Once the pilot has
  // transmitted they always show, so the readback check makes sense.
  const hidden = prefs.sound && prefs.listenFirst && !shown && tries.length === 0;
  // With sound on, the controller speaks when the step opens and when they correct a call.
  // Both follow a click (Continue, Transmit), so the browser allows the audio.
  useEffect(() => { if (prefs.sound && e.atc) say('atc', e.atc); }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prefs.sound && state === 'retry' && lastResult?.fix) say(`fix-${tries.length}`, lastResult.fix);
  }, [tries.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const fixLine = (fix: string, n: number) => (
    <Xmit who={e.freq.name} kind="atc" play={() => say(`fix-${n}`, fix)} playLabel="Play the controller" playing={playing === `fix-${n}`}>{fix}</Xmit>
  );
  // What the controller says back to the latest call, announced as it arrives.
  const reply = state === 'retry' && lastResult?.fix
    ? fixLine(lastResult.fix, tries.length)
    : state === 'done'
      ? <Xmit who="A good call" kind="model">{e.model}</Xmit>
      : null;
  return (
    <section className="step">
      <h2>{e.title}</h2>
      <Voice>{e.situation}</Voice>
      <div className="tape">
        <TapeHead freq={e.freq} prefs={prefs} setPrefs={setPrefs} />
        {e.atc && <Xmit who={e.freq.name} kind="atc" play={() => say('atc', e.atc!)} playLabel="Play the controller" playing={playing === 'atc'} hidden={hidden} onShow={() => setShown(true)}>{e.atc}</Xmit>}
        {tries.map((t, i) => (
          <Fragment key={i}>
            <Xmit who={flight.callsign.sayFull} kind="pilot">{t}</Xmit>
            <Readback r={results[i]} e={e} />
            {i < tries.length - 1 && results[i].fix && fixLine(results[i].fix!, i + 1)}
          </Fragment>
        ))}
        <div aria-live="polite">{reply}</div>
        {state !== 'done' && <CallBox key={tries.length} e={e} retry={state === 'retry'} prefs={prefs} onTransmit={transmit} />}
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
  // The copied ATIS, and with it the broadcast's words, only appear once the copy
  // pad is checked. So under listen first the kneeboard never gives the words away.
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
