// First-run setup: home airport, airplane, pilot. Five short steps, each
// skippable, resumable, and editable later from Settings and Airplane.

import { useEffect, useRef, useState } from 'react';
import type { Airport } from '../data/airports';
import { sampleC172K, type AircraftProfile } from '../data/aircraft';
import type { PilotProfile } from '../data/pilot';
import { lookupAirport, manualAirport, normalizeIdent } from '../lib/airportLookup';
import { fetchWeather, type WeatherBundle } from '../lib/weather';
import type { RunwayEnd } from '../lib/wind';
import { Card, Field, Notice, NumInput } from './common';
import { RawReport } from './MetarBlock';
import { flightReviewDue, type OnboardingState } from './state';

const STEPS = ['Welcome', 'Airport', 'Airplane', 'You', 'Done'];

const blankAircraft: AircraftProfile = {
  id: 'custom',
  tailNumber: 'N',
  type: '',
  panel: [],
  emptyWeightLb: 0,
  emptyArmIn: 0,
  maxGrossLb: 0,
  usableFuelGal: 0,
  demonstratedCrosswindKt: 0,
  stations: [
    { id: 'front', label: 'Pilot and front passenger', armIn: 0 },
    { id: 'rear', label: 'Rear passengers', armIn: 0 },
    { id: 'fuel', label: 'Fuel', armIn: 0 },
    { id: 'bag1', label: 'Baggage', armIn: 0 },
  ],
  envelope: [
    [35, 1500],
    [35, 2000],
    [40, 2300],
    [47, 2300],
    [47, 1500],
  ],
  sampleValues: true,
};

export function Onboarding({ state, setState, airport, setAirport, aircraft, setAircraft, pilot, setPilot, onDone }: {
  state: OnboardingState;
  setState: (s: OnboardingState) => void;
  airport: Airport;
  setAirport: (a: Airport) => void;
  aircraft: AircraftProfile;
  setAircraft: (a: AircraftProfile) => void;
  pilot: PilotProfile;
  setPilot: (p: PilotProfile) => void;
  onDone: () => void;
}) {
  const step = Math.min(state.step, STEPS.length - 1);
  const goto = (n: number) => {
    setState({ ...state, step: Math.max(0, Math.min(STEPS.length - 1, n)) });
    window.scrollTo({ top: 0 });
  };
  const finish = () => {
    setState({ complete: true, step: 0 });
    onDone();
  };

  return (
    <div className="onboard">
      <div className="onboard-head">
        <div className="brand">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" fill="var(--ink)" />
            <circle cx="32" cy="32" r="20" fill="none" stroke="var(--magenta)" strokeWidth="4" />
            <rect x="29" y="8" width="6" height="48" fill="var(--paper)" transform="rotate(-40 32 32)" />
          </svg>
          <span>Downwind</span>
          <small>Setup</small>
        </div>
        <ol className="steps onboard-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <i>{i + 1}</i> <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <main className="onboard-body">
        {step === 0 && <Welcome onNext={() => goto(1)} />}
        {step === 1 && <AirportStep airport={airport} setAirport={setAirport} pilot={pilot} setPilot={setPilot} onBack={() => goto(0)} onNext={() => goto(2)} />}
        {step === 2 && <AircraftStep aircraft={aircraft} setAircraft={setAircraft} onBack={() => goto(1)} onNext={() => goto(3)} />}
        {step === 3 && <PilotStep pilot={pilot} setPilot={setPilot} onBack={() => goto(2)} onNext={() => goto(4)} />}
        {step === 4 && <DoneStep airport={airport} aircraft={aircraft} pilot={pilot} onBack={() => goto(3)} onFinish={finish} />}
      </main>

      <footer className="about">
        <span>Training aid. Not for navigation. Not a substitute for an official briefing or a CFI.</span>
        <button type="button" className="linkish" onClick={finish}>Skip setup, use defaults</button>
      </footer>
    </div>
  );
}

function StepNav({ onBack, onNext, nextLabel = 'Next', onSkip, nextDisabled }: { onBack?: () => void; onNext: () => void; nextLabel?: string; onSkip?: () => void; nextDisabled?: boolean }) {
  return (
    <div className="onboard-nav">
      {onBack && <button type="button" className="btn quiet" onClick={onBack}>Back</button>}
      <span style={{ flex: 1 }} />
      {onSkip && <button type="button" className="btn quiet" onClick={onSkip}>Skip for now</button>}
      <button type="button" className="btn primary" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>
    </div>
  );
}

/* ---------------- 1. Welcome ---------------- */

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="onboard-col">
      <div>
        <div className="eyebrow">Ground school for one pilot, one airplane, one airport</div>
        <h1 className="onboard-title">Downwind</h1>
      </div>
      <p className="lead-lg">
        Every session starts with a real decision about a real flight from your home field: live weather, your airplane's numbers, your personal minimums. You decide, then the app grades the call against the ACS and schedules what you missed.
      </p>
      <div className="loop">
        <div><span className="n">01</span><h3>Brief</h3><p>METAR, TAF, runway wind, density altitude, W&amp;B.</p></div>
        <div><span className="n">02</span><h3>Decide</h3><p>Go, go with a plan, delay or cancel. Rate your confidence.</p></div>
        <div><span className="n">03</span><h3>Debrief</h3><p>Grade, the findings that drove it, the references.</p></div>
      </div>
      <p className="muted" style={{ fontSize: '0.9rem' }}>Setup takes about a minute. Every step can be skipped and changed later.</p>
      <StepNav onNext={onNext} nextLabel="Set up" />
    </div>
  );
}

/* ---------------- 2. Airport ---------------- */

const AIRSPACE: Airport['airspace'][] = ['B', 'C', 'D', 'E', 'G'];

function AirportStep({ airport, setAirport, pilot, setPilot, onBack, onNext }: { airport: Airport; setAirport: (a: Airport) => void; pilot: PilotProfile; setPilot: (p: PilotProfile) => void; onBack: () => void; onNext: () => void }) {
  const [ident, setIdent] = useState(airport.icao);
  const [draft, setDraft] = useState<Airport>(airport);
  const [source, setSource] = useState<'bundled' | 'awc' | 'manual' | null>(airport.icao === 'KASH' ? 'bundled' : 'manual');
  const [looking, setLooking] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [wx, setWx] = useState<WeatherBundle | null>(null);
  const [wxBusy, setWxBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const previewWeather = (a: Airport) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setWxBusy(true);
    setWx(null);
    fetchWeather(a.icao, a.tafStations, ac.signal)
      .then((b) => { if (!ac.signal.aborted) setWx(b); })
      .catch(() => undefined)
      .finally(() => { if (!ac.signal.aborted) setWxBusy(false); });
  };
  useEffect(() => {
    previewWeather(airport);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookup = async () => {
    const id = normalizeIdent(ident);
    if (!id) return;
    setLooking(true);
    setLookupFailed(false);
    const r = await lookupAirport(id);
    setLooking(false);
    if (r) {
      setDraft(r.airport);
      setSource(r.source);
      previewWeather(r.airport);
    } else {
      const m = manualAirport(id);
      setDraft(m);
      setSource('manual');
      setLookupFailed(true);
      previewWeather(m);
    }
  };

  const upd = (patch: Partial<Airport>) => setDraft({ ...draft, ...patch });
  const updRwy = (i: number, patch: Partial<RunwayEnd>) => upd({ runways: draft.runways.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRwy = () => {
    const n = draft.runways.length;
    const prev = draft.runways[n - 1];
    const heading = prev ? (prev.headingMag + 180) % 360 || 360 : 360;
    const id = String(Math.round(heading / 10)).padStart(2, '0');
    upd({ runways: [...draft.runways, { id, headingMag: heading }] });
  };

  const commit = () => {
    const a = { ...draft, icao: normalizeIdent(draft.icao) };
    setAirport(a);
    setPilot({ ...pilot, homeBase: a.icao });
    onNext();
  };

  return (
    <div className="onboard-col">
      <div>
        <div className="eyebrow">Step 2 of 5</div>
        <h2 className="onboard-h2">Home airport</h2>
        <p className="muted">Where the daily brief is built. Live METAR and TAF, runway winds and density altitude come from this field.</p>
      </div>

      <form
        className="inputs align-end"
        onSubmit={(e) => { e.preventDefault(); void lookup(); }}
      >
        <Field label="Identifier" size="md">
          <input value={ident} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(e) => setIdent(e.target.value)} />
        </Field>
        <button type="submit" className="btn" disabled={looking || !ident.trim()}>{looking ? 'Looking up' : 'Look up'}</button>
        <span className="muted mono" style={{ fontSize: '0.74rem', flexBasis: '100%' }}>ICAO or FAA identifier, e.g. KASH or ASH. Lookup uses aviationweather.gov; KASH ships with the app.</span>
      </form>

      {lookupFailed && (
        <Notice label="Not found">
          No record for {normalizeIdent(ident)} (lookup needs the aviationweather.gov airport API). Enter the numbers from the Chart Supplement below; every field is editable.
        </Notice>
      )}

      <Card
        title={source === 'bundled' ? 'Confirm airport' : source === 'awc' ? 'Confirm airport (from AWC)' : 'Enter airport'}
        sub={draft.verify.length ? `Verify: ${draft.verify.join(', ')}` : undefined}
        right={<span className="chip">{source === 'bundled' ? 'bundled data' : source === 'awc' ? 'aviationweather.gov' : 'manual entry'}</span>}
      >
        <div className="inputs">
          <Field label="ICAO" size="sm"><input value={draft.icao} onChange={(e) => upd({ icao: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name" size="md"><input value={draft.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
          <Field label="City" size="md"><input value={draft.city} onChange={(e) => upd({ city: e.target.value })} /></Field>
        </div>
        <div className="inputs">
          <Field label="Elevation" hint="ft MSL" size="sm"><NumInput value={draft.elevationFt} step={1} onChange={(n) => upd({ elevationFt: n })} /></Field>
          <Field label="Mag variation" hint="degrees, west negative" size="sm"><NumInput value={draft.magneticVariationDeg} step={1} min={-180} max={180} onChange={(n) => upd({ magneticVariationDeg: n })} /></Field>
          <Field label="Airspace" hint="at the surface" size="sm">
            <select value={draft.airspace} onChange={(e) => upd({ airspace: e.target.value as Airport['airspace'] })}>
              {AIRSPACE.map((a) => <option key={a} value={a}>Class {a}</option>)}
            </select>
          </Field>
          <Field label="TAF stations" hint="comma separated, nearest first" size="md">
            <input value={draft.tafStations.join(', ')} onChange={(e) => upd({ tafStations: e.target.value.split(',').map((s) => normalizeIdent(s)).filter(Boolean) })} />
          </Field>
        </div>
        <div>
          <div className="field" style={{ marginBottom: 6 }}><span>Runway ends and magnetic headings</span></div>
          <div className="rwy-grid">
            {draft.runways.map((r, i) => (
              <div className="rwy" key={i}>
                <input aria-label={`Runway end ${i + 1} number`} value={r.id} onChange={(e) => updRwy(i, { id: e.target.value.toUpperCase() })} />
                <NumInput ariaLabel={`Runway ${r.id} magnetic heading`} value={r.headingMag} min={1} max={360} step={1} onChange={(n) => updRwy(i, { headingMag: n })} />
                <span className="muted mono">°M</span>
                <button type="button" className="rm" aria-label={`Remove runway ${r.id}`} onClick={() => upd({ runways: draft.runways.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button type="button" className="btn quiet" onClick={addRwy}>Add runway end</button>
          </div>
        </div>
        <p className="teach">
          Why variation matters: the METAR wind is in degrees <b>true</b>, but runways are numbered <b>magnetic</b>. At {draft.icao || 'this field'} with {Math.abs(draft.magneticVariationDeg)}°{draft.magneticVariationDeg < 0 ? 'W' : 'E'} variation,
          a wind reported from 270° is really from {String((((270 - draft.magneticVariationDeg) % 360) + 360) % 360).padStart(3, '0')}° on the runway compass. The app does this conversion for you and shows both numbers.
        </p>
      </Card>

      <Card title="Weather preview" sub={wx ? (wx.source === 'live' ? 'Live' : 'Sample') : undefined} right={wx && <span className={`badge ${wx.metar.category ?? ''}`}>{wx.metar.category ?? '—'}</span>}>
        {wxBusy && !wx && <p className="muted">Fetching the current METAR…</p>}
        {wx && (
          <>
            {wx.source === 'sample' && (
              <Notice label="Sample">Could not reach the weather service{wx.error ? ` (${wx.error})` : ''}. Showing a stored KASH report so you can see what the brief looks like.</Notice>
            )}
            <RawReport raw={wx.metar.raw} label={`METAR ${wx.metar.station}`} />
          </>
        )}
        {!wxBusy && !wx && <p className="muted">No preview yet.</p>}
      </Card>

      <StepNav onBack={onBack} onNext={commit} onSkip={onNext} nextDisabled={!draft.icao.trim()} nextLabel="Save airport" />
    </div>
  );
}

/* ---------------- 3. Aircraft ---------------- */

function AircraftStep({ aircraft, setAircraft, onBack, onNext }: { aircraft: AircraftProfile; setAircraft: (a: AircraftProfile) => void; onBack: () => void; onNext: () => void }) {
  const [draft, setDraft] = useState<AircraftProfile>(aircraft);
  const [fromPoh, setFromPoh] = useState(!aircraft.sampleValues);
  const [chip, setChip] = useState('');
  const upd = (patch: Partial<AircraftProfile>) => setDraft({ ...draft, ...patch });

  const addChip = () => {
    const c = chip.trim();
    if (!c) return;
    if (!draft.panel.includes(c)) upd({ panel: [...draft.panel, c] });
    setChip('');
  };

  const commit = () => {
    setAircraft({ ...draft, sampleValues: !fromPoh });
    onNext();
  };

  return (
    <div className="onboard-col">
      <div>
        <div className="eyebrow">Step 3 of 5</div>
        <h2 className="onboard-h2">Your airplane</h2>
        <p className="muted">Weight and balance, crosswind limits and performance all key off these. Copy them from your POH and the current weight and balance record, not from memory.</p>
      </div>

      <div className="seg" role="group" aria-label="Start from">
        <button type="button" aria-pressed={draft.id === 'c172k'} onClick={() => { setDraft({ ...sampleC172K, tailNumber: draft.tailNumber, panel: draft.panel }); setFromPoh(false); }}>C172K template</button>
        <button type="button" aria-pressed={draft.id === 'custom'} onClick={() => { setDraft({ ...blankAircraft, tailNumber: draft.tailNumber, panel: draft.panel }); setFromPoh(false); }}>Blank</button>
      </div>

      <Card title="Identity">
        <div className="inputs">
          <Field label="Type" hint="make and model" size="md"><input value={draft.type} placeholder="Cessna 172K" onChange={(e) => upd({ type: e.target.value })} /></Field>
          <Field label="Tail number" size="sm"><input value={draft.tailNumber} onChange={(e) => upd({ tailNumber: e.target.value.toUpperCase() })} /></Field>
        </div>
        <div>
          <div className="field" style={{ marginBottom: 6 }}><span>Panel and avionics</span></div>
          <div className="chips-edit">
            {draft.panel.map((p) => (
              <span key={p} className="chip-x">
                {p}
                <button type="button" aria-label={`Remove ${p}`} onClick={() => upd({ panel: draft.panel.filter((x) => x !== p) })}>×</button>
              </span>
            ))}
            <form className="chip-add" onSubmit={(e) => { e.preventDefault(); addChip(); }}>
              <input value={chip} placeholder="GI 275, GTN 650…" aria-label="Add avionics" onChange={(e) => setChip(e.target.value)} />
              <button type="submit" className="btn quiet" disabled={!chip.trim()}>Add</button>
            </form>
          </div>
        </div>
      </Card>

      <Card title="Numbers from the POH" sub="Section 6 for weight and balance, section 4 for crosswind">
        <div className="inputs">
          <Field label="Empty weight" hint="lb" size="sm"><NumInput value={draft.emptyWeightLb} step={1} onChange={(n) => upd({ emptyWeightLb: n })} /></Field>
          <Field label="Empty CG arm" hint="in aft of datum" size="sm"><NumInput value={draft.emptyArmIn} step={0.1} onChange={(n) => upd({ emptyArmIn: n })} /></Field>
          <Field label="Max gross" hint="lb" size="sm"><NumInput value={draft.maxGrossLb} step={1} onChange={(n) => upd({ maxGrossLb: n })} /></Field>
          <Field label="Usable fuel" hint="gal" size="sm"><NumInput value={draft.usableFuelGal} step={1} onChange={(n) => upd({ usableFuelGal: n })} /></Field>
          <Field label="Demonstrated crosswind" hint="kt" size="sm"><NumInput value={draft.demonstratedCrosswindKt} step={1} onChange={(n) => upd({ demonstratedCrosswindKt: n })} /></Field>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>Station arms and the CG envelope are edited on the Airplane screen, where you can see the polygon as you type.</p>
        <label className="check">
          <input type="checkbox" checked={fromPoh} onChange={(e) => setFromPoh(e.target.checked)} />
          <span>These are my airplane's numbers, copied from the POH and current W&amp;B record.</span>
        </label>
        {!fromPoh && (
          <Notice label="Sample numbers">
            Fine for now. The app will keep saying so on every screen that uses them until you check the box above or save edits on the Airplane screen.
          </Notice>
        )}
      </Card>

      <StepNav onBack={onBack} onNext={commit} onSkip={onNext} nextLabel={fromPoh ? 'Save airplane' : 'Use sample numbers for now'} />
    </div>
  );
}

/* ---------------- 4. You ---------------- */

function PilotStep({ pilot, setPilot, onBack, onNext }: { pilot: PilotProfile; setPilot: (p: PilotProfile) => void; onBack: () => void; onNext: () => void }) {
  const [draft, setDraft] = useState<PilotProfile>(pilot);
  const mins = draft.minimums;
  const setMin = (patch: Partial<PilotProfile['minimums']>) => setDraft({ ...draft, minimums: { ...mins, ...patch } });
  const due = flightReviewDue(draft.lastFlightReview);
  const overdue = due ? due.getTime() < Date.now() : false;

  return (
    <div className="onboard-col">
      <div>
        <div className="eyebrow">Step 4 of 5</div>
        <h2 className="onboard-h2">You</h2>
        <p className="muted">Personal minimums are the line between a legal flight and one you're comfortable with. The brief grades against them, so set them honestly and change them on the ground, not on the ramp.</p>
      </div>
      <Card title="Pilot">
        <div className="inputs">
          <Field label="Name" size="md"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Last flight review" hint="or checkride / new rating" size="md">
            <input type="date" value={draft.lastFlightReview ?? ''} onChange={(e) => setDraft({ ...draft, lastFlightReview: e.target.value || null })} />
          </Field>
        </div>
        {due && (
          <p className={overdue ? 'callout' : 'teach'} style={{ fontSize: '0.9rem' }}>
            {overdue ? 'Flight review overdue. ' : 'Next flight review due by '}
            <b>{due.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })}</b>
            {overdue ? ` (was due ${due.toLocaleDateString([], { month: 'long', year: 'numeric' })}).` : ''} 14 CFR 61.56: 24 calendar months, so the whole final month counts.
          </p>
        )}
      </Card>
      <Card title="Personal minimums" sub="Defaults are conservative for a VFR private pilot">
        <div className="inputs">
          <Field label="Ceiling" hint="ft AGL" size="sm"><NumInput value={mins.ceilingFt} step={100} min={0} onChange={(n) => setMin({ ceilingFt: n })} /></Field>
          <Field label="Visibility" hint="SM" size="sm"><NumInput value={mins.visibilitySm} step={1} min={0} onChange={(n) => setMin({ visibilitySm: n })} /></Field>
          <Field label="Crosswind" hint="kt, incl. gusts" size="sm"><NumInput value={mins.crosswindKt} step={1} min={0} onChange={(n) => setMin({ crosswindKt: n })} /></Field>
          <Field label="Gust spread" hint="kt over steady" size="sm"><NumInput value={mins.gustSpreadKt} step={1} min={0} onChange={(n) => setMin({ gustSpreadKt: n })} /></Field>
        </div>
      </Card>
      <StepNav onBack={onBack} onNext={() => { setPilot(draft); onNext(); }} onSkip={onNext} nextLabel="Save" />
    </div>
  );
}

/* ---------------- 5. Done ---------------- */

function DoneStep({ airport, aircraft, pilot, onBack, onFinish }: { airport: Airport; aircraft: AircraftProfile; pilot: PilotProfile; onBack: () => void; onFinish: () => void }) {
  return (
    <div className="onboard-col">
      <div>
        <div className="eyebrow">Step 5 of 5</div>
        <h2 className="onboard-h2">Ready{pilot.name ? `, ${pilot.name}` : ''}</h2>
        <p className="muted">Here's what the brief will use. Everything is editable from Settings and Airplane.</p>
      </div>
      <Card>
        <dl className="kv">
          <dt>Home airport</dt><dd>{airport.icao} · {airport.name}{airport.runways.length ? ` · rwy ${airport.runways.map((r) => r.id).join('/')}` : ''}</dd>
          <dt>Airplane</dt><dd>{aircraft.tailNumber} · {aircraft.type || 'unnamed'}{aircraft.sampleValues ? ' · sample numbers' : ''}</dd>
          <dt>Panel</dt><dd>{aircraft.panel.length ? aircraft.panel.join(', ') : '—'}</dd>
          <dt>Minimums</dt><dd>{pilot.minimums.ceilingFt.toLocaleString()} ft · {pilot.minimums.visibilitySm} SM · {pilot.minimums.crosswindKt} kt xw · {pilot.minimums.gustSpreadKt} kt gust</dd>
        </dl>
      </Card>
      {aircraft.sampleValues && (
        <Notice label="Sample airplane">W&amp;B and crosswind results will be practice-only until you enter your POH numbers on the Airplane screen.</Notice>
      )}
      <StepNav onBack={onBack} onNext={onFinish} nextLabel={`Open Today at ${airport.icao}`} />
    </div>
  );
}
