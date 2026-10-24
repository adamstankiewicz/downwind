// Today at <home airport>: Brief -> Decide -> Debrief. The answer stays hidden until the
// pilot commits to a choice and a confidence (retrieval practice).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AircraftProfile } from '../data/aircraft';
import type { Airport } from '../data/airports';
import type { PilotProfile } from '../data/pilot';
import { fetchWeather, sampleWeather, type WeatherBundle } from '../lib/weather';
import { buildBrief, debrief as runDebrief, type ChoiceId, type Finding } from '../scenarios/goNoGo';
import { Card, Field, GRADE_LABEL, Icons, Notice, SEVERITY_LABEL, SampleAircraftNotice } from './common';
import { RawReport, MetarLegend } from './MetarBlock';
import { WindDiagram } from './WindDiagram';
import { TafTimeline } from './TafTimeline';
import { fmtZ, nextWholeHour, toLocalInput, wbFor, type Loading } from './state';

const KEYS = ['A', 'B', 'C', 'D'];

export function Today({ airport, aircraft, loading, pilot, goAirplane }: { airport: Airport; aircraft: AircraftProfile; loading: Loading; pilot: PilotProfile; goAirplane: () => void }) {
  const [wx, setWx] = useState<WeatherBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [departure, setDeparture] = useState<Date>(() => nextWholeHour());
  const [tripHours, setTripHours] = useState(3);
  const [choice, setChoice] = useState<ChoiceId | null>(null);
  const [confidence, setConfidence] = useState(50);
  const [committed, setCommitted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debriefRef = useRef<HTMLDivElement>(null);

  const refresh = () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    fetchWeather(airport.icao, airport.tafStations, ac.signal)
      .then((b) => {
        if (!ac.signal.aborted) setWx(b);
      })
      .catch(() => {
        if (!ac.signal.aborted) setWx(sampleWeather('Request aborted'));
      })
      .finally(() => {
        if (!ac.signal.aborted) setBusy(false);
      });
    setChoice(null);
    setCommitted(false);
  };

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport.icao]);

  // A new plan is a new decision.
  useEffect(() => {
    setChoice(null);
    setCommitted(false);
  }, [departure, tripHours]);

  const wb = useMemo(() => wbFor(aircraft, loading), [aircraft, loading]);
  const brief = useMemo(
    () =>
      wx
        ? buildBrief({ airport, aircraft, wb, minimums: pilot.minimums, metar: wx.metar, taf: wx.taf, departure, tripHours })
        : null,
    [wx, airport, aircraft, wb, pilot.minimums, departure, tripHours],
  );
  const result = useMemo(() => (brief && committed && choice ? runDebrief(brief, choice, confidence) : null), [brief, committed, choice, confidence]);

  useEffect(() => {
    if (result) debriefRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  if (!wx || !brief) {
    return (
      <>
        <Head airport={airport} wx={null} />
        <p className="muted">Pulling the current METAR and TAF…</p>
      </>
    );
  }

  const m = wx.metar;
  const f = brief.facts;
  const rw = f.runwayWind;
  const mins = pilot.minimums;
  const steadyX = rw?.steady?.crosswindKt ?? null;
  const gustX = rw?.gust?.crosswindKt ?? null;
  const worstX = gustX ?? steadyX;
  const xwClass = worstX === null ? '' : worstX > aircraft.demonstratedCrosswindKt ? 'bad' : worstX > mins.crosswindKt ? 'warn' : 'ok';
  const ceilingToken = m.clouds.find((c) => c.baseFtAgl === m.ceilingFtAgl && (c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV'));
  const ceilingTok = ceilingToken ? `${ceilingToken.cover}${String(ceilingToken.baseFtAgl / 100).padStart(3, '0')}${ceilingToken.type ?? ''}` : null;
  const windTxt = m.wind
    ? m.wind.dirTrue === null
      ? m.wind.speedKt === 0 ? 'Calm' : `VRB ${m.wind.speedKt} kt`
      : `${String(m.wind.dirTrue).padStart(3, '0')}° at ${m.wind.speedKt}${m.wind.gustKt ? ` G ${m.wind.gustKt}` : ''} kt`
    : 'Not reported';
  const step = committed ? 3 : choice ? 2 : 1;

  return (
    <>
      <Head airport={airport} wx={wx} onRefresh={refresh} busy={busy} />

      {wx.source === 'sample' && (
        <Notice label="Sample weather">
          Live weather could not be fetched{wx.error ? ` (${wx.error})` : ''}. This is a stored KASH report for practice, not today's conditions at {airport.icao}. Do not plan a flight from it.
        </Notice>
      )}
      {aircraft.sampleValues && <SampleAircraftNotice onGo={goAirplane} />}

      <div className="steps" aria-label="Progress">
        <span className={step === 1 ? 'on' : 'done'}><i>1</i> Brief</span>
        <span className={step === 2 ? 'on' : step > 2 ? 'done' : ''}><i>2</i> Decide</span>
        <span className={step === 3 ? 'on' : ''}><i>3</i> Debrief</span>
      </div>

      <div className="today">
        {/* ---------------- Brief ---------------- */}
        <div className="stack">
          <Card
            title="Current weather"
            sub={m.issued ? `Observed ${String(m.issued.day).padStart(2, '0')}${String(m.issued.hour).padStart(2, '0')}${String(m.issued.minute).padStart(2, '0')}Z` : undefined}
            right={<span className={`badge ${m.category ?? ''}`}>{m.category ?? 'No category'}</span>}
          >
            <div>
              <RawReport raw={m.raw} label={`METAR ${m.station}`} ceilingToken={ceilingTok} />
              {wx.taf && <RawReport raw={wx.taf.raw} label={`TAF ${wx.taf.station}${wx.taf.station !== airport.icao ? ' (nearest TAF station)' : ''}`} />}
            </div>
            <MetarLegend />
            <div className="calc">
              <div>
                <span className="k">Ceiling</span>
                <span className={`v ${m.ceilingFtAgl !== null && m.ceilingFtAgl < 1000 ? 'bad' : m.ceilingFtAgl !== null && m.ceilingFtAgl < mins.ceilingFt ? 'warn' : 'ok'}`}>
                  {m.ceilingFtAgl !== null ? `${m.ceilingFtAgl.toLocaleString()} ft` : 'None'}
                  <small>AGL · your min {mins.ceilingFt.toLocaleString()}</small>
                </span>
              </div>
              <div>
                <span className="k">Visibility</span>
                <span className={`v ${m.visibilitySm !== null && m.visibilitySm < 3 ? 'bad' : m.visibilitySm !== null && m.visibilitySm < mins.visibilitySm ? 'warn' : 'ok'}`}>
                  {m.visibilitySm !== null ? `${m.visibilityPlus ? '>' : ''}${m.visibilitySm} SM` : 'n/a'}
                  <small>your min {mins.visibilitySm} SM</small>
                </span>
              </div>
              <div>
                <span className="k">Wind (true)</span>
                <span className="v">
                  {windTxt}
                  {m.wind?.gustKt && <small>spread {m.wind.gustKt - m.wind.speedKt} kt · your max {mins.gustSpreadKt}</small>}
                </span>
              </div>
              <div>
                <span className="k">Crosswind rwy {rw?.runway.id ?? '—'}</span>
                <span className={`v ${xwClass}`}>
                  {steadyX !== null ? `${Math.round(steadyX)} kt` : 'n/a'}
                  {gustX !== null && ` G ${Math.round(gustX)}`}
                  <small>demo {aircraft.demonstratedCrosswindKt} · your min {mins.crosswindKt}</small>
                </span>
              </div>
              <div>
                <span className="k">Density altitude</span>
                <span className={`v ${f.densityAltitudeFt !== null && f.densityAltitudeFt > 2000 ? 'warn' : ''}`}>
                  {f.densityAltitudeFt !== null ? `${f.densityAltitudeFt.toLocaleString()} ft` : 'n/a'}
                  <small>field {airport.elevationFt} ft · {m.tempC ?? '?'}°C · {m.altimeterInHg ?? '?'}</small>
                </span>
              </div>
              <div>
                <span className="k">Weight and balance</span>
                <span className={`v ${wb.overGross || !wb.withinEnvelope ? 'bad' : 'ok'}`}>
                  {wb.totalLb.toLocaleString()} lb
                  <small>CG {wb.cgIn} in · {wb.overGross ? 'over gross' : wb.withinEnvelope ? 'in envelope' : 'outside envelope'}</small>
                </span>
              </div>
            </div>
          </Card>

          <Card title="Wind on the runway" sub={rw?.windMag !== null && rw?.windMag !== undefined ? `${String(m.wind?.dirTrue).padStart(3, '0')}°T becomes ${String(rw.windMag).padStart(3, '0')}°M` : undefined}>
            <div className="wind">
              <WindDiagram airport={airport} wind={m.wind} rw={rw} />
              <div className="wind-notes">
                {rw && rw.steady ? (
                  <dl>
                    <dt>Best runway</dt>
                    <dd>{rw.runway.id} ({String(rw.runway.headingMag).padStart(3, '0')}°M)</dd>
                    <dt>Wind angle</dt>
                    <dd>{rw.steady.angleDeg}° off the nose{rw.steady.from !== 'none' ? `, from the ${rw.steady.from}` : ''}</dd>
                    <dt>Headwind</dt>
                    <dd>{rw.steady.headwindKt >= 0 ? `${Math.round(rw.steady.headwindKt)} kt` : `${Math.abs(Math.round(rw.steady.headwindKt))} kt tailwind`}</dd>
                    <dt>Crosswind</dt>
                    <dd className={xwClass === 'ok' ? '' : xwClass}>
                      {Math.round(rw.steady.crosswindKt)} kt steady{rw.gust ? `, ${Math.round(rw.gust.crosswindKt)} kt in gusts` : ''}
                    </dd>
                    <dt>Demonstrated</dt>
                    <dd>{aircraft.demonstratedCrosswindKt} kt{aircraft.sampleValues ? ' (sample)' : ''}</dd>
                    <dt>Your minimum</dt>
                    <dd>{mins.crosswindKt} kt</dd>
                  </dl>
                ) : (
                  <p className="muted">Wind is calm or variable, so no runway is favored. Treat the full speed as a possible crosswind.</p>
                )}
                <p className="teach">
                  The METAR wind is in degrees <b>true</b>. Runways are numbered <b>magnetic</b>. Variation at {airport.icao} is {Math.abs(airport.magneticVariationDeg)}°{airport.magneticVariationDeg < 0 ? 'W' : 'E'},
                  so {airport.magneticVariationDeg < 0 ? 'add' : 'subtract'} {Math.abs(airport.magneticVariationDeg)}° before comparing it to a runway. Tower and ATIS winds are already magnetic.
                </p>
              </div>
            </div>
          </Card>

          <Card title="Forecast through your return" sub={wx.taf ? `TAF ${wx.taf.station}` : undefined}>
            <TafTimeline taf={wx.taf} departure={departure} tripHours={tripHours} />
          </Card>
        </div>

        {/* ---------------- Decide / Debrief ---------------- */}
        <div className="stack">
          <Card title="The flight">
            <p style={{ fontSize: '0.95rem' }}>
              Local flight out of {airport.icao}, back the same day. Pick your departure and how long you'll be gone, then decide.
            </p>
            <div className="inputs">
              <Field label="Departure (local)" hint={fmtZ(departure)} size="md">
                <input
                  type="datetime-local"
                  value={toLocalInput(departure)}
                  onChange={(e) => {
                    const d = new Date(e.target.value);
                    if (!Number.isNaN(d.getTime())) setDeparture(d);
                  }}
                />
              </Field>
              <Field label="Trip hours" size="sm">
                <input type="number" inputMode="numeric" min={1} max={12} step={1} value={tripHours} onChange={(e) => setTripHours(Math.min(12, Math.max(1, Math.round(e.target.valueAsNumber || 1))))} />
              </Field>
            </div>
          </Card>

          <Card title="Decide" sub={committed ? 'Committed' : 'Answer is hidden until you commit'}>
            <p className="prompt">Given the brief, your airplane and your personal minimums, what do you do?</p>
            <div className="choices" role="group" aria-label="Choices">
              {brief.choices.map((c, i) => {
                const picked = choice === c.id;
                const grade = committed ? brief.grades[c.id] : null;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`choice ${committed ? 'revealed' : ''} ${picked ? 'picked' : ''}`}
                    aria-pressed={picked}
                    disabled={committed}
                    onClick={() => setChoice(c.id)}
                  >
                    <span className="key">{KEYS[i]}</span>
                    <span>{c.label}</span>
                    {grade && <span className={`gradechip grade ${grade}`}>{GRADE_LABEL[grade]}</span>}
                  </button>
                );
              })}
            </div>
            <div className="conf">
              <div className="conf-row">
                <label htmlFor="conf">How confident are you?</label>
                <b>{confidence}%</b>
              </div>
              <input id="conf" type="range" min={0} max={100} step={5} value={confidence} disabled={committed} onChange={(e) => setConfidence(Number(e.target.value))} />
              <div className="conf-row"><span>Guessing</span><span>Certain</span></div>
            </div>
            {!committed ? (
              <button type="button" className="btn primary" disabled={!choice} onClick={() => setCommitted(true)}>
                Commit
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => { setCommitted(false); setChoice(null); }}>
                Decide again
              </button>
            )}
          </Card>

          {result && (
            <div ref={debriefRef} className="stack">
              <div className="debrief">
                <div className="debrief-head">
                  <span className="eyebrow">Debrief</span>
                  <span className="lcg">Learner-centered grade: {result.lcg}</span>
                </div>
                <div className={`grade ${result.grade}`}>{GRADE_LABEL[result.grade]}</div>
                <p>{result.rationale}</p>
                {result.confidentlyWrong && (
                  <div className="callout">
                    <b>Confidently wrong</b>
                    <span>You were {confidence}% sure of a {result.grade} call. That gap is the thing to study, more than the answer itself. This item comes back sooner.</span>
                  </div>
                )}
              </div>
              <Card title="What drove the grade" sub={`${brief.findings.length} finding${brief.findings.length === 1 ? '' : 's'}`}>
                {brief.findings.length === 0 ? (
                  <p className="muted">Nothing flagged. Legal, inside the airplane's numbers and inside your minimums.</p>
                ) : (
                  <>
                    <ul className="findings">
                      {result.keyFindings.map((x) => <FindingRow key={x.id} f={x} />)}
                    </ul>
                    {brief.findings.length > result.keyFindings.length && (
                      <details>
                        <summary className="muted" style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
                          {brief.findings.length - result.keyFindings.length} more
                        </summary>
                        <ul className="findings" style={{ marginTop: 8 }}>
                          {brief.findings.filter((x) => !result.keyFindings.includes(x)).map((x) => <FindingRow key={x.id} f={x} />)}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className={`finding ${f.severity}`}>
      <span className="sev">{SEVERITY_LABEL[f.severity]}</span>
      <h4>{f.title}</h4>
      <p>{f.detail}</p>
      <div className="refs">
        {f.acs.map((a) => <span key={a} className="chip acs">{a}</span>)}
        {f.refs.map((r) => <span key={r} className="chip">{r}</span>)}
      </div>
    </li>
  );
}

function Head({ airport, wx, onRefresh, busy }: { airport: Airport; wx: WeatherBundle | null; onRefresh?: () => void; busy?: boolean }) {
  const rwys = airport.runways.map((r) => r.id).join('/');
  return (
    <div className="page-head">
      <div>
        <h1>Today at {airport.icao}</h1>
        <p className="lead">
          {airport.name}{airport.city ? `, ${airport.city}` : ''} · Class {airport.airspace} · field elevation {airport.elevationFt} ft{rwys ? ` · runway ${rwys}` : ''}
        </p>
      </div>
      <div className="btn-row">
        {wx && (
          <span className="mono muted" style={{ fontSize: '0.74rem' }}>
            {wx.source === 'live' ? 'Live' : 'Sample'} · fetched {wx.fetchedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
        <button type="button" className="btn" onClick={onRefresh} disabled={busy || !onRefresh}>
          {Icons.refresh}
          {busy ? 'Refreshing' : 'Refresh weather'}
        </button>
      </div>
    </div>
  );
}
