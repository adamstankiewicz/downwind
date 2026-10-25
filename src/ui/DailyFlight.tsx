// Today's real conditions, laid out as a briefing sheet. Each line belongs to
// the lesson that teaches it: covered lines ask for the pilot's reading before
// showing the app's; uncovered lines are filled in and marked. Then sign.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isConfigured, type AircraftProfile } from '../data/aircraft';
import type { Airport } from '../data/airports';
import type { PilotProfile } from '../data/pilot';
import { fetchWeather, sampleWeather, type WeatherBundle } from '../lib/weather';
import { buildBrief, debrief as runDebrief, type Brief, type ChoiceId, type Finding } from '../scenarios/goNoGo';
import { dailySheet, fileSheet, type FiledSheet, type SheetSection } from '../course/daily';
import { checkBlank, type CourseProgress } from '../course/progress';
import { Field, GRADE_LABEL, Icons, NoAircraftNotice, Notice, SEVERITY_LABEL, SampleAircraftNotice, Voice } from './common';
import { RawReport } from './MetarBlock';
import { WindDiagram } from './WindDiagram';
import { TafTimeline } from './TafTimeline';
import { Strip, type StripPoint } from './Strip';
import { Rich } from './text';
import { fmtZ, nextWholeHour, templateLabel, toLocalInput, wbFor, type Loading } from './state';
import { RefChips } from '../refs/RefViewer';

const KEYS = ['A', 'B', 'C', 'D'];

export function DailyFlight({ airport, aircraft, loading, pilot, progress, log, setLog, goAirplane, goLogbook, onExit }: {
  airport: Airport;
  aircraft: AircraftProfile;
  loading: Loading;
  pilot: PilotProfile;
  progress: CourseProgress;
  log: FiledSheet[];
  setLog: (next: FiledSheet[] | ((p: FiledSheet[]) => FiledSheet[])) => void;
  goAirplane: () => void;
  goLogbook: () => void;
  onExit: () => void;
}) {
  const [wx, setWx] = useState<WeatherBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [departure, setDeparture] = useState<Date>(() => nextWholeHour());
  const [tripHours, setTripHours] = useState(3);
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [choice, setChoice] = useState<ChoiceId | null>(null);
  const [committed, setCommitted] = useState(false);
  const [filedId, setFiledId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debriefRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    setChoice(null);
    setCommitted(false);
    setFiledId(null);
    setReadings({});
    setRevealed({});
  };
  const refresh = () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    fetchWeather(airport.icao, airport.tafStations, ac.signal)
      .then((b) => { if (!ac.signal.aborted) setWx(b); })
      .catch(() => { if (!ac.signal.aborted) setWx(sampleWeather(airport.icao, 'Request aborted')); })
      .finally(() => { if (!ac.signal.aborted) setBusy(false); });
    reset();
  };
  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport.icao]);
  // A new plan is a new sheet.
  useEffect(() => { reset(); }, [departure, tripHours]);

  const configured = isConfigured(aircraft);
  const wb = useMemo(() => (configured ? wbFor(aircraft, loading) : null), [aircraft, loading, configured]);
  const brief = useMemo(
    () => (wx ? buildBrief({ airport, aircraft, wb, minimums: pilot.minimums, metar: wx.metar, taf: wx.taf, departure, tripHours }) : null),
    [wx, airport, aircraft, wb, pilot.minimums, departure, tripHours],
  );
  const sections = useMemo(() => (brief ? dailySheet(brief, progress, pilot.minimums) : []), [brief, progress, pilot.minimums]);
  const result = useMemo(() => (brief && committed && choice ? runDebrief(brief, choice) : null), [brief, committed, choice]);
  useEffect(() => {
    if (result) debriefRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const asked = sections.filter((s) => s.prompt);
  const answered = asked.filter((s) => revealed[s.id]);
  const allRead = answered.length === asked.length;
  const readingsRight = asked.filter((s) => revealed[s.id] && checkBlank(s.prompt!, readings[s.id] ?? '')).length;
  const covered = sections.filter((s) => s.covered).length;

  const points: StripPoint[] = [
    ...sections.map((s) => ({
      id: s.id, label: s.title, sub: s.covered ? 'covered' : 'not yet',
      state: (committed || (s.prompt && revealed[s.id]) ? 'done' : asked.find((x) => !revealed[x.id])?.id === s.id ? 'now' : 'todo') as StripPoint['state'],
    })),
    { id: 'decide', label: 'Decide', state: committed ? 'done' : allRead ? 'now' : 'todo' },
    { id: 'debrief', label: 'Debrief', state: committed ? 'now' : 'todo' },
  ];

  const file = () => {
    if (!brief || !result || !choice || !wx) return;
    const entry: Omit<FiledSheet, 'id' | 'filedAt'> = {
      station: airport.icao, source: wx.source, departure: departure.toISOString(), choice, grade: result.grade,
      readingsRight, readingsTotal: asked.length,
      findings: brief.findings.map((f) => ({ title: f.title, severity: f.severity })),
    };
    const next = fileSheet(log, entry);
    setLog(next);
    setFiledId(next[0].id);
  };

  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <div>
            <h1>Today's real conditions at {airport.icao}</h1>
            <span className="muted">
              {airport.name}{airport.city ? `, ${airport.city}` : ''}. {wx ? (wx.source === 'live' ? `Live weather, fetched ${wx.fetchedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'Practice weather, not a real report.') : 'Pulling the current report.'} {covered} of {sections.length} lines covered by the course.
            </span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn quiet" onClick={refresh} disabled={busy}>{Icons.refresh}{busy ? 'Refreshing' : 'Refresh weather'}</button>
            <button type="button" className="btn quiet" onClick={onExit}>Back to course</button>
          </div>
        </div>
        <Strip points={points} label="Lines of the sheet" />
      </div>

      {!wx || !brief ? (
        <p className="muted">Pulling the current METAR and TAF for {airport.icao}.</p>
      ) : (
        <div className="daily">
          <div className="sheet">
            {wx.source === 'sample' && (
              <Notice label="Practice weather">
                Live weather could not be fetched{wx.error ? ` (${wx.error})` : ''}. This sheet uses practice weather, not a real report for {airport.icao}. Do not plan a flight from it.
              </Notice>
            )}
            {!configured ? <NoAircraftNotice onGo={goAirplane} /> : aircraft.sampleValues && <SampleAircraftNotice onGo={goAirplane} template={templateLabel(aircraft)} />}

            <section className="line plan">
              <div className="line-head">
                <h2>The flight</h2>
                <span className="muted">Local flight, back the same day</span>
              </div>
              <div className="inputs">
                <Field label="Departure, local time" hint={fmtZ(departure)} size="md">
                  <input type="datetime-local" value={toLocalInput(departure)} onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) setDeparture(d); }} />
                </Field>
                <Field label="Hours away" size="sm">
                  <input type="number" inputMode="numeric" min={1} max={12} step={1} value={tripHours} onChange={(e) => setTripHours(Math.min(12, Math.max(1, Math.round(e.target.valueAsNumber || 1))))} />
                </Field>
              </div>
              {covered === 0 && <Voice>Nothing on this sheet has been taught yet, so every line is filled in for you. Read it, decide anyway, and the grade still uses every finding. Lesson 2.1 is where the questions start.</Voice>}
              {covered > 0 && !committed && <Voice>{asked.length ? `${asked.length} line${asked.length === 1 ? ' asks' : 's ask'} for your reading before the sheet shows its own. ` : ''}I will not prompt on the lines you have earned. Sign when you are ready.</Voice>}
            </section>

            {sections.map((s) => (
              <SheetLine
                key={s.id}
                section={s}
                brief={brief}
                wx={wx}
                airport={airport}
                aircraft={aircraft}
                pilot={pilot}
                wb={configured ? wb : null}
                departure={departure}
                tripHours={tripHours}
                reading={readings[s.id] ?? ''}
                setReading={(v) => setReadings((r) => ({ ...r, [s.id]: v }))}
                revealed={Boolean(revealed[s.id])}
                onReveal={() => setRevealed((r) => ({ ...r, [s.id]: true }))}
                locked={committed}
                drove={result ? result.keyFindings.some((f) => s.findings.includes(f)) : false}
                goAirplane={goAirplane}
              />
            ))}

            <section className={`line decide-line ${committed ? 'signed' : ''}`}>
              <div className="line-head">
                <h2>Decision</h2>
                <span className="muted">{committed ? `Signed at ${fmtZ(new Date())}` : allRead ? 'The grade stays hidden until you sign' : `Read the ${asked.length - answered.length} remaining line${asked.length - answered.length === 1 ? '' : 's'} first`}</span>
              </div>
              <p className="prompt">With this sheet, your airplane and the minimums you set, what do you do?</p>
              <div className="choices" role="group" aria-label="Choices">
                {brief.choices.map((c, i) => {
                  const picked = choice === c.id;
                  const grade = committed ? brief.grades[c.id] : null;
                  return (
                    <button key={c.id} type="button" className={`choice ${committed ? 'revealed' : ''} ${picked ? 'picked' : ''}`} aria-pressed={picked} disabled={committed || !allRead} onClick={() => setChoice(c.id)}>
                      <span className="key">{KEYS[i]}</span>
                      <span>{c.label}</span>
                      {grade && <span className={`gradechip ${grade}`}>{GRADE_LABEL[grade]}</span>}
                    </button>
                  );
                })}
              </div>
              {!committed ? (
                <div className="cta">
                  <button type="button" className="btn primary" disabled={!choice || !allRead} onClick={() => setCommitted(true)}>Sign and commit</button>
                </div>
              ) : (
                <button type="button" className="btn quiet" onClick={() => { setCommitted(false); setChoice(null); setFiledId(null); }}>Decide again</button>
              )}
            </section>

            {result && (
              <section ref={debriefRef} className="line debrief-line">
                <div className="line-head">
                  <h2>Debrief</h2>
                  <span className="muted">Marked against every finding, covered or not</span>
                </div>
                <div className={`grade ${result.grade}`}>{GRADE_LABEL[result.grade]}</div>
                <p className="lcg">Learner-centered grading: {result.lcg}.</p>
                <Voice>{result.rationale}{asked.length ? ` Your readings: ${readingsRight} of ${asked.length} matched the sheet.` : ''}</Voice>
                {brief.findings.length === 0
                  ? <p className="muted">Nothing flagged. Legal, inside the airplane's numbers and inside your minimums.</p>
                  : <p className="muted small">The lines that drove the grade are marked above, each with its note and the lesson that teaches it.</p>}
                <div className="cta">
                  {filedId
                    ? <><span className="filed">Filed to your logbook.</span><button type="button" className="btn quiet" onClick={goLogbook}>Open logbook</button></>
                    : <button type="button" className="btn primary" onClick={file}>File this briefing</button>}
                  <span className="hint">Filed briefings build the record for your flight review.</span>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SheetLine({ section: s, brief, wx, airport, aircraft, pilot, wb, departure, tripHours, reading, setReading, revealed, onReveal, locked, drove, goAirplane }: {
  section: SheetSection;
  departure: Date;
  tripHours: number;
  brief: Brief;
  wx: WeatherBundle;
  airport: Airport;
  aircraft: AircraftProfile;
  pilot: PilotProfile;
  wb: ReturnType<typeof wbFor> | null;
  reading: string;
  setReading: (v: string) => void;
  revealed: boolean;
  onReveal: () => void;
  locked: boolean;
  drove: boolean;
  goAirplane: () => void;
}) {
  const asks = Boolean(s.prompt) && !revealed;
  const p = s.prompt;
  const right = p && revealed ? checkBlank(p, reading) : null;
  const status = !s.covered
    ? `Not covered yet, taught in ${s.taughtBy}`
    : p
      ? revealed
        ? right ? 'Your reading matched' : 'Your reading differed'
        : `Covered in ${s.taughtBy}. Your reading first.`
      : `Covered in ${s.taughtBy}`;

  return (
    <section className={`line ${s.covered ? 'covered' : 'uncovered'} ${drove ? 'drove' : ''} ${asks ? 'asking' : ''}`}>
      <div className="line-head">
        <h2>{s.title}</h2>
        <span className={`muted ${right === false ? 'differ' : ''}`}>{status}</span>
      </div>
      {asks && p ? (
        <div className="ask">
          <label htmlFor={`read-${s.id}`}>{p.label}{p.unit ? <small> {p.unit}</small> : null}</label>
          {p.choices ? (
            <div className="chips" role="group" id={`read-${s.id}`}>
              {p.choices.map((c) => <button key={c} type="button" className="chip-btn" aria-pressed={reading === c} onClick={() => setReading(c)}>{c}</button>)}
            </div>
          ) : (
            <input id={`read-${s.id}`} className="mono" type="text" inputMode="decimal" autoComplete="off" value={reading} onChange={(e) => setReading(e.target.value)} />
          )}
          <div className="cta">
            <button type="button" className="btn" disabled={!reading.trim() || locked} onClick={onReveal}>Compare with the sheet</button>
            <span className="hint">The line stays folded until you have read it yourself.</span>
          </div>
        </div>
      ) : (
        <>
          {p && revealed && (
            <p className={`explain ${right ? 'right' : 'wrong'}`}>
              <b>{right ? 'Right.' : `You read ${reading.trim()}; the sheet says ${typeof p.answer === 'number' ? p.answer.toLocaleString('en-US') : p.answer}${p.unit ? ` ${p.unit}` : ''}.`}</b> <Rich text={p.explain} />
            </p>
          )}
          <LineBody id={s.id} brief={brief} wx={wx} airport={airport} aircraft={aircraft} pilot={pilot} wb={wb} departure={departure} tripHours={tripHours} goAirplane={goAirplane} />
          {s.findings.length > 0 && (
            <ul className="findings">
              {s.findings.map((f) => <FindingRow key={f.id} f={f} note={drove} taughtBy={s.taughtBy} covered={s.covered} />)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function LineBody({ id, brief, wx, airport, aircraft, pilot, wb, departure, tripHours, goAirplane }: {
  id: SheetSection['id']; brief: Brief; wx: WeatherBundle; airport: Airport; aircraft: AircraftProfile; pilot: PilotProfile; wb: ReturnType<typeof wbFor> | null; departure: Date; tripHours: number; goAirplane: () => void;
}) {
  const m = wx.metar;
  const f = brief.facts;
  const mins = pilot.minimums;
  const rw = f.runwayWind;
  switch (id) {
    case 'report': {
      const tok = m.clouds.find((c) => c.baseFtAgl === m.ceilingFtAgl && (c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV'));
      const ceilingTok = tok ? `${tok.cover}${String(tok.baseFtAgl / 100).padStart(3, '0')}${tok.type ?? ''}` : null;
      return (
        <div className="line-body">
          <RawReport raw={m.raw} label={`METAR ${m.station}${m.issued ? `, observed ${String(m.issued.day).padStart(2, '0')}${String(m.issued.hour).padStart(2, '0')}${String(m.issued.minute).padStart(2, '0')}Z` : ''}`} ceilingToken={ceilingTok} />
          <Row k="Flight category" v={<span className={`cat ${m.category ?? ''}`}>{m.category ?? 'Not determined'}</span>} />
        </div>
      );
    }
    case 'wind': {
      const steadyX = rw?.steady?.crosswindKt ?? null;
      const gustX = rw?.gust?.crosswindKt ?? null;
      const worst = gustX ?? steadyX;
      const demo = isConfigured(aircraft) && aircraft.demonstratedCrosswindKt > 0 ? aircraft.demonstratedCrosswindKt : null;
      const cls = worst === null ? '' : demo !== null && worst > demo ? 'bad' : worst > mins.crosswindKt ? 'warn' : 'ok';
      return (
        <div className="line-body wind">
          <WindDiagram airport={airport} wind={m.wind} rw={rw} />
          <div className="line-rows">
            <Row k="Reported" v={m.wind ? m.wind.dirTrue === null ? (m.wind.speedKt ? `Variable at ${m.wind.speedKt} kt` : 'Calm') : `${String(m.wind.dirTrue).padStart(3, '0')}° true at ${m.wind.speedKt}${m.wind.gustKt ? ` gusting ${m.wind.gustKt}` : ''} kt` : 'Not reported'} />
            {rw && rw.windMag !== null && <Row k="Magnetic" v={`${String(rw.windMag).padStart(3, '0')}°, variation ${Math.abs(airport.magneticVariationDeg)}°${airport.magneticVariationDeg < 0 ? 'W' : 'E'}`} />}
            {rw?.steady ? (
              <>
                <Row k={`Runway ${rw.runway.id}`} v={`${rw.steady.angleDeg}° off the nose${rw.steady.from !== 'none' ? `, from the ${rw.steady.from}` : ''}`} />
                <Row k="Crosswind" cls={cls} v={`${Math.round(rw.steady.crosswindKt)} kt${rw.gust ? `, ${Math.round(rw.gust.crosswindKt)} in gusts` : ''}`} note={`Your minimum ${mins.crosswindKt} kt${demo !== null ? `, demonstrated ${demo}` : ''}`} />
              </>
            ) : <Row k="Runway" v="Calm or variable: no runway favored" />}
            {m.wind?.gustKt && <Row k="Gust spread" cls={m.wind.gustKt - m.wind.speedKt > mins.gustSpreadKt ? 'warn' : 'ok'} v={`${m.wind.gustKt - m.wind.speedKt} kt`} note={`Your maximum ${mins.gustSpreadKt} kt`} />}
          </div>
        </div>
      );
    }
    case 'forecast':
      return (
        <div className="line-body">
          {wx.taf && <RawReport raw={wx.taf.raw} label={`TAF ${wx.taf.station}${wx.taf.station !== airport.icao ? ', nearest TAF station' : ''}`} />}
          <TafTimeline taf={wx.taf} departure={departure} tripHours={tripHours} />
        </div>
      );
    case 'ceiling': {
      const cc = m.ceilingFtAgl !== null && m.ceilingFtAgl < 1000 ? 'bad' : m.ceilingFtAgl !== null && m.ceilingFtAgl < mins.ceilingFt ? 'warn' : 'ok';
      const vc = m.visibilitySm !== null && m.visibilitySm < 3 ? 'bad' : m.visibilitySm !== null && m.visibilitySm < mins.visibilitySm ? 'warn' : 'ok';
      return (
        <div className="line-body line-rows">
          <Row k="Ceiling" cls={cc} v={m.ceilingFtAgl !== null ? `${m.ceilingFtAgl.toLocaleString('en-US')} ft AGL` : 'None'} note={`Your minimum ${mins.ceilingFt.toLocaleString('en-US')} ft`} />
          <Row k="Visibility" cls={vc} v={m.visibilitySm !== null ? `${m.visibilityPlus ? 'more than ' : ''}${m.visibilitySm} SM` : 'Not reported'} note={`Your minimum ${mins.visibilitySm} SM`} />
        </div>
      );
    }
    case 'trend':
      return (
        <div className="line-body line-rows">
          <Row k="Temperature and dew point" v={m.tempC !== null && m.dewpointC !== null ? `${m.tempC}°C and ${m.dewpointC}°C` : 'Not reported'} />
          <Row k="Spread" cls={f.tempDewSpreadC !== null && f.tempDewSpreadC <= 3 ? 'warn' : 'ok'} v={f.tempDewSpreadC !== null ? `${f.tempDewSpreadC}°C` : 'Not computed'} note="Within about 3°C, watch for fog as it cools" />
        </div>
      );
    case 'airplane':
      return (
        <div className="line-body line-rows">
          <Row k="Density altitude" cls={f.densityAltitudeFt !== null && f.densityAltitudeFt > 2000 ? 'warn' : ''} v={f.densityAltitudeFt !== null ? `${f.densityAltitudeFt.toLocaleString('en-US')} ft` : 'Not computed'} note={`Field ${airport.elevationFt} ft, ${m.tempC ?? '?'}°C, altimeter ${m.altimeterInHg ?? '?'}`} />
          {wb
            ? <Row k="Weight and balance" cls={wb.overGross || !wb.withinEnvelope ? 'bad' : 'ok'} v={`${wb.totalLb.toLocaleString('en-US')} lb`} note={`CG ${wb.cgIn} in, ${wb.overGross ? 'over gross' : wb.withinEnvelope ? 'in the envelope' : 'outside the envelope'}`} />
            : <Row k="Weight and balance" v={<button type="button" className="linkish" onClick={goAirplane}>Add your airplane</button>} />}
        </div>
      );
  }
}

function Row({ k, v, note, cls }: { k: string; v: ReactNode; note?: string; cls?: string }) {
  return (
    <div className="row">
      <dt>{k}</dt>
      <dd className={cls ?? ''}>{v}</dd>
      {note && <span className="note">{note}</span>}
    </div>
  );
}

function FindingRow({ f, note, taughtBy, covered }: { f: Finding; note: boolean; taughtBy: string; covered: boolean }) {
  return (
    <li className={`finding ${f.severity} ${note ? 'noted' : ''}`}>
      <span className="sev">{SEVERITY_LABEL[f.severity]}</span>
      <h4>{f.title}</h4>
      {note && (
        <>
          <Voice>{f.detail} {covered ? `You did this in ${taughtBy}.` : `${taughtBy} teaches this; it is marked here anyway, because safety does not wait for the syllabus.`}</Voice>
          <div className="refs">
            {f.acs.map((a) => <span key={a} className="chip acs">{a}</span>)}
            <RefChips refs={f.refs} />
          </div>
        </>
      )}
    </li>
  );
}
