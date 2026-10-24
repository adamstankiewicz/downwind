// First-run setup: home airport, airplane, pilot. Five short steps, each
// skippable, resumable, and editable later from Settings and Airplane.

import { useEffect, useRef, useState } from 'react';
import type { Airport } from '../data/airports';
import { aircraftTemplates, blankAircraft, isConfigured, type AircraftProfile } from '../data/aircraft';
import type { PilotProfile } from '../data/pilot';
import { lookupAirport, manualAirport, normalizeIdent } from '../lib/airportLookup';
import { fetchWeather, type WeatherBundle } from '../lib/weather';
import type { RunwayEnd } from '../lib/wind';
import { Card, Field, Mark, Notice, NumInput } from './common';
import { RawReport } from './MetarBlock';
import { flightReviewDue, type OnboardingState } from './state';

const STEPS = ['Welcome', 'Airport', 'Airplane', 'You', 'Done'];

export function Onboarding({ state, setState, airport, setAirport, aircraft, setAircraft, pilot, setPilot, onDone }: {
  state: OnboardingState;
  setState: (s: OnboardingState) => void;
  airport: Airport | null;
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
          <Mark />
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
        <button type="button" className="linkish" onClick={finish}>Skip setup for now</button>
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
        <h1 className="onboard-title">Downwind</h1>
        <p className="onboard-sub">A guided ground school for one pilot, one airplane, one airport.</p>
      </div>
      <p className="lead-lg">
        Nine modules in the order of the Private Pilot ACS. Every lesson is a short flight out of your home field, built with your runways, your airplane's numbers and your personal minimums. An instructor briefs, works one example, then hands you the controls and grades the call.
      </p>
      <ol className="loop">
        <li><span className="n">1</span><h3>Brief</h3><p>The instructor sets the scene and works the first one on a practice report.</p></li>
        <li><span className="n">2</span><h3>Your turn</h3><p>You fill the blanks and make the call. Grades stay hidden until you commit.</p></li>
        <li><span className="n">3</span><h3>Debrief</h3><p>The grade, the reasoning, the references. Then today's real conditions, with what you have learned.</p></li>
      </ol>
      <p className="help">Setup takes about a minute. Every step can be skipped and changed later.</p>
      <StepNav onNext={onNext} nextLabel="Set up" />
    </div>
  );
}

/* ---------------- 2. Airport ---------------- */

const AIRSPACE: Airport['airspace'][] = ['B', 'C', 'D', 'E', 'G'];

function AirportStep({ airport, setAirport, pilot, setPilot, onBack, onNext }: { airport: Airport | null; setAirport: (a: Airport) => void; pilot: PilotProfile; setPilot: (p: PilotProfile) => void; onBack: () => void; onNext: () => void }) {
  const [ident, setIdent] = useState(airport?.icao ?? '');
  const [draft, setDraft] = useState<Airport>(airport ?? manualAirport(''));
  const [source, setSource] = useState<'bundled' | 'awc' | 'manual' | 'saved' | null>(airport ? 'saved' : null);
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
    if (airport) previewWeather(airport);
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
        <h2 className="onboard-h2">Home airport</h2>
        <p className="muted">Where every lesson flies from, and where the daily flight pulls live weather. Runway headings and variation are what the wind lessons are built on.</p>
      </div>

      <form
        className="inputs align-end"
        onSubmit={(e) => { e.preventDefault(); void lookup(); }}
      >
        <Field label="Identifier" size="md">
          <input value={ident} placeholder="KJFK or 3B3" autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(e) => setIdent(e.target.value)} />
        </Field>
        <button type="submit" className="btn" disabled={looking || !ident.trim()}>{looking ? 'Looking up' : 'Look up'}</button>
        <span className="help" style={{ flexBasis: '100%' }}>ICAO or FAA identifier. Lookup uses aviationweather.gov; if it can't be reached, enter the field by hand from the Chart Supplement.</span>
      </form>

      {lookupFailed && (
        <Notice label="Not found">
          No record for {normalizeIdent(ident)} (lookup needs the aviationweather.gov airport API). Enter the numbers from the Chart Supplement below; every field is editable.
        </Notice>
      )}

      {source && <Card
        title={source === 'manual' ? 'Enter the airport' : 'Confirm the airport'}
        sub={source === 'bundled' ? 'Bundled with the app' : source === 'awc' ? 'From aviationweather.gov' : source === 'saved' ? 'Your saved airport' : 'Entered by hand'}
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
        {draft.verify.length > 0 && <p className="help">Still to check against the current Chart Supplement: {draft.verify.join(', ')}.</p>}
        <p className="teach">
          Why variation matters: the METAR wind is in degrees <b>true</b>, but runways are numbered <b>magnetic</b>. At {draft.icao || 'this field'} with {Math.abs(draft.magneticVariationDeg)}°{draft.magneticVariationDeg < 0 ? 'W' : 'E'} variation,
          a wind reported from 270° is really from {String((((270 - draft.magneticVariationDeg) % 360) + 360) % 360).padStart(3, '0')}° on the runway compass. The app does this conversion for you and shows both numbers.
        </p>
      </Card>}

      {source && <Card title="Weather preview" sub={wx ? (wx.source === 'live' ? 'Live report' : 'Sample report') : undefined} right={wx && <span className={`badge ${wx.metar.category ?? ''}`}>{wx.metar.category ?? '—'}</span>}>
        {wxBusy && !wx && <p className="muted">Fetching the current METAR.</p>}
        {wx && (
          <>
            {wx.source === 'sample' && (
              <Notice label="Sample weather">Could not reach the weather service{wx.error ? ` (${wx.error})` : ''}. Showing practice weather so you can see what the brief looks like.</Notice>
            )}
            <RawReport raw={wx.metar.raw} label={`METAR ${wx.metar.station}`} />
          </>
        )}
        {!wxBusy && !wx && <p className="muted">No preview yet.</p>}
      </Card>}

      <StepNav onBack={onBack} onNext={commit} onSkip={onNext} nextDisabled={!source || !draft.icao.trim()} nextLabel="Save airport" />
    </div>
  );
}

/* ---------------- 3. Aircraft ---------------- */

function AircraftStep({ aircraft, setAircraft, onBack, onNext }: { aircraft: AircraftProfile; setAircraft: (a: AircraftProfile) => void; onBack: () => void; onNext: () => void }) {
  const [draft, setDraft] = useState<AircraftProfile>(aircraft);
  const [picked, setPicked] = useState<string | null>(isConfigured(aircraft) ? aircraft.id : null);
  const [fromPoh, setFromPoh] = useState(isConfigured(aircraft) && !aircraft.sampleValues);
  const [chip, setChip] = useState('');
  const isBlank = draft.id === 'custom';
  const upd = (patch: Partial<AircraftProfile>) => setDraft({ ...draft, ...patch });

  const addChip = () => {
    const c = chip.trim();
    if (!c) return;
    if (!draft.panel.includes(c)) upd({ panel: [...draft.panel, c] });
    setChip('');
  };

  const commit = () => {
    setAircraft({ ...draft, sampleValues: !isBlank && !fromPoh });
    onNext();
  };

  return (
    <div className="onboard-col">
      <div>
        <h2 className="onboard-h2">Your airplane</h2>
        <p className="muted">Weight and balance, the demonstrated crosswind and performance all key off these. Copy them from your POH and the current weight and balance record, not from memory.</p>
      </div>

      <div className="field">
        <span>Start from</span>
        <div className="seg" role="group" aria-label="Start from">
          {aircraftTemplates.map((t) => (
            <button key={t.id} type="button" aria-pressed={picked === t.profile.id} onClick={() => { setDraft({ ...t.profile, tailNumber: draft.tailNumber, panel: draft.panel.length ? draft.panel : t.profile.panel }); setPicked(t.profile.id); setFromPoh(false); }}>
              {t.label}
            </button>
          ))}
          <button type="button" aria-pressed={picked === 'custom'} onClick={() => { setDraft({ ...blankAircraft, tailNumber: draft.tailNumber, panel: draft.panel }); setPicked('custom'); setFromPoh(false); }}>Start blank</button>
        </div>
      </div>

      <Card title="Identity">
        <div className="inputs">
          <Field label="Type" hint="make and model" size="md"><input value={draft.type} placeholder="Make and model" onChange={(e) => upd({ type: e.target.value })} /></Field>
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
              <input value={chip} placeholder="For example, a GPS or an autopilot" aria-label="Add avionics" onChange={(e) => setChip(e.target.value)} />
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
          <Field label="Demonstrated crosswind" hint="kt" size="md"><NumInput value={draft.demonstratedCrosswindKt} step={1} onChange={(n) => upd({ demonstratedCrosswindKt: n })} /></Field>
        </div>
        <p className="help">Station arms and the CG envelope are edited under Tools, Airplane, where you can see the polygon as you type.</p>
        <label className="check">
          <input type="checkbox" checked={fromPoh} onChange={(e) => setFromPoh(e.target.checked)} />
          <span>These are my airplane's numbers, copied from the POH and current W&amp;B record.</span>
        </label>
        {!fromPoh && !isBlank && (
          <Notice label="Sample numbers">
            Fine for now. Every screen that uses them will say so until you check the box above or save edits under Tools, Airplane.
          </Notice>
        )}
      </Card>

      <StepNav onBack={onBack} onNext={commit} onSkip={onNext} nextDisabled={picked === null} nextLabel={fromPoh || isBlank ? 'Save airplane' : 'Use sample numbers for now'} />
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
        <h2 className="onboard-h2">You</h2>
        <p className="muted">Personal minimums are the line between a legal flight and one you're comfortable with. Lessons and the daily flight grade against them, so set them honestly and change them on the ground, not on the ramp.</p>
      </div>
      <Card title="Pilot">
        <div className="inputs">
          <Field label="Name" size="md"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Last flight review" hint="or checkride / new rating" size="md">
            <input type="date" value={draft.lastFlightReview ?? ''} onChange={(e) => setDraft({ ...draft, lastFlightReview: e.target.value || null })} />
          </Field>
        </div>
        {due && (
          <p className={overdue ? 'callout' : 'teach'}>
            {overdue ? 'Flight review overdue. ' : 'Next flight review due by '}
            <b>{due.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })}</b>
            {overdue ? ` (was due ${due.toLocaleDateString([], { month: 'long', year: 'numeric' })}).` : ''} 14 CFR 61.56: 24 calendar months, so the whole final month counts.
          </p>
        )}
      </Card>
      <Card title="Personal minimums" sub="The defaults are conservative for a VFR private pilot">
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

function DoneStep({ airport, aircraft, pilot, onBack, onFinish }: { airport: Airport | null; aircraft: AircraftProfile; pilot: PilotProfile; onBack: () => void; onFinish: () => void }) {
  return (
    <div className="onboard-col">
      <div>
        <h2 className="onboard-h2">Ready{pilot.name ? `, ${pilot.name}` : ''}</h2>
        <p className="muted">This is what the lessons and the daily flight will use. Everything can be changed later from Pilot and Tools.</p>
      </div>
      <Card>
        <dl className="kv">
          <dt>Home airport</dt><dd>{airport ? <>{airport.icao}, {airport.name}{airport.runways.length ? `, runway ${airport.runways.map((r) => r.id).join('/')}` : ''}</> : 'Not set'}</dd>
          <dt>Airplane</dt><dd>{isConfigured(aircraft) ? `${[aircraft.tailNumber, aircraft.type].filter(Boolean).join(', ') || 'Unnamed'}${aircraft.sampleValues ? ' (sample numbers)' : ''}` : 'Not set'}</dd>
          <dt>Panel</dt><dd>{aircraft.panel.length ? aircraft.panel.join(', ') : 'None listed'}</dd>
          <dt>Minimums</dt><dd>Ceiling {pilot.minimums.ceilingFt.toLocaleString()} ft, visibility {pilot.minimums.visibilitySm} SM, crosswind {pilot.minimums.crosswindKt} kt, gust spread {pilot.minimums.gustSpreadKt} kt</dd>
        </dl>
      </Card>
      {aircraft.sampleValues && (
        <Notice label="Sample airplane">Weight and balance and crosswind results are practice only until you enter your POH numbers under Tools, Airplane.</Notice>
      )}
      <p className="voice">{airport && airport.runways.length ? `Lessons will fly from ${airport.icao} with your runways and minimums.` : 'Without a home field with runways, lessons fly from a practice field and say so. You can add one any time.'} The first lesson is a METAR read before you drive out.</p>
      <StepNav onBack={onBack} onNext={onFinish} nextLabel="Start the course" />
    </div>
  );
}
