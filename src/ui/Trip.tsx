// Trip: flights worth planning from the pilot's home field today. The engine
// finds the fields in reach, works each round trip against the weather, the
// airplane and the pilot's minimums, and ranks what passes; this screen
// shows three, says why the rest were left out, and turns the one the pilot
// picks into a planning lesson.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AircraftProfile } from '../data/aircraft';
import type { Airport } from '../data/airports';
import type { PilotProfile } from '../data/pilot';
import type { CourseProgress, LessonResult } from '../course/progress';
import type { LessonContext } from '../course/types';
import { fetchTripInputs } from '../lib/tripData';
import { sunTimes } from '../lib/sun';
import { xcAirplane } from '../scenarios/crossCountry';
import { pickVaried, recommend, stopper, deg3, type PlanOptions, type TripInputs, type TripPlan } from '../scenarios/trip';
import { practiceTripInputs } from '../course/tripPractice';
import { localTime, skyText, TAG_LABEL, tripLead, tripLesson, tripMapFigure, tripPitch, wxSource } from '../course/trip';
import { Field, Icons, Notice, SEVERITY_LABEL, Voice } from './common';
import { Figure } from './Figure';
import { LessonPlayer } from './LessonPlayer';
import { nextWholeHour, toLocalInput, useTripHistory, useTripPrefs } from './state';

const PICKS = 3;

/** Next whole hour, unless that leaves under three hours of daylight: then 9:00 tomorrow. */
export function defaultDeparture(now: Date, pos: { lat: number; lon: number } | null): Date {
  const next = nextWholeHour(now);
  const sunset = pos ? sunTimes(pos, next).sunset : null;
  if (!sunset || sunset.getTime() - next.getTime() >= 3 * 3_600_000) return next;
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return t;
}

export function Trip({ airport, aircraft, pilot, ctx, progress, setProgress, onSetup }: {
  airport: Airport | null;
  aircraft: AircraftProfile;
  pilot: PilotProfile;
  ctx: LessonContext;
  progress: CourseProgress;
  setProgress: (next: CourseProgress | ((p: CourseProgress) => CourseProgress)) => void;
  onSetup: () => void;
}) {
  const [prefs, setPrefs] = useTripPrefs();
  const [history, setHistory] = useTripHistory();
  const [inputs, setInputs] = useState<TripInputs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [departure, setDeparture] = useState<Date>(() => defaultDeparture(new Date(), airport?.pos ?? null));
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [planning, setPlanning] = useState<TripPlan | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const live = Boolean(airport && airport.runways.length);
  const load = () => {
    abortRef.current?.abort();
    setSkip(new Set());
    if (!live || !airport) {
      setInputs(practiceTripInputs(new Date()));
      setError(null);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    fetchTripInputs(airport, prefs.maxLegNm, departure, ac.signal)
      .then((x) => { if (!ac.signal.aborted) { setInputs(x); setError(null); } })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setError(e.message);
        setInputs(practiceTripInputs(new Date()));
      })
      .finally(() => { if (!ac.signal.aborted) setBusy(false); });
  };
  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
    // The radius changes what is fetched; the departure only what the engine reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport?.icao, prefs.maxLegNm]);

  const o: PlanOptions = useMemo(() => ({
    airplane: xcAirplane(aircraft), minimums: pilot.minimums, prefs,
    demonstratedCrosswindKt: aircraft.demonstratedCrosswindKt, departure, history,
  }), [aircraft, pilot.minimums, prefs, departure, history]);
  const rec = useMemo(() => (inputs ? recommend(inputs, o) : null), [inputs, o]);
  const picks = useMemo(() => (rec ? pickVaried(rec.ranked, PICKS, skip) : []), [rec, skip]);
  const lesson = useMemo(() => (inputs && planning ? tripLesson(inputs, planning, o) : null), [inputs, planning]); // eslint-disable-line react-hooks/exhaustive-deps

  if (lesson && planning && inputs) {
    const onResult = (r: LessonResult) => setHistory((h) => [
      { id: planning.dest.id, at: new Date().toISOString(), distanceNm: planning.distanceNm, grade: r.grade }, ...h,
    ].slice(0, 50));
    return (
      <LessonPlayer
        key={lesson.id}
        lesson={lesson}
        ctx={{ ...ctx, practiceField: inputs.source === 'practice' }}
        progress={progress}
        setProgress={setProgress}
        onExit={() => setPlanning(null)}
        onNext={() => setPlanning(null)}
        standalone={{
          line: `Trip planning lesson, from ${inputs.source === 'live' ? 'live weather' : 'practice weather on the practice chart'}.`,
          onResult, exitLabel: 'Back to trips',
        }}
      />
    );
  }

  const practice = inputs?.source === 'practice';
  const homeId = inputs?.home.id ?? airport?.icao ?? 'KXYZ';
  const age = inputs ? Math.max(0, Math.round((Date.now() - inputs.fetchedAt.getTime()) / 60_000)) : 0;
  const more = rec ? rec.ranked.filter((p) => !skip.has(p.dest.id) && !picks.includes(p)).length : 0;

  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <div>
            <h1>Trips from {homeId}</h1>
            <span className="muted">
              Cross-countries worth planning, worked from {practice ? 'practice weather on the practice chart' : 'live weather'}.{' '}
              {inputs && !practice ? `Reports fetched ${localTime(inputs.fetchedAt)}${age > 0 ? `, ${age} min ago` : ''}.` : ''}
            </span>
          </div>
          <button type="button" className="btn quiet" onClick={load} disabled={busy}>{Icons.refresh}{busy ? 'Working' : 'Refresh'}</button>
        </div>
      </div>

      <div className="trip">
        {!airport && (
          <Notice kind="info" label="No home field yet" action={<button type="button" className="btn quiet" onClick={onSetup}>Set home field</button>}>
            These trips are from the practice field on the practice chart, with made-up weather. Set your home field to get real ones.
          </Notice>
        )}
        {error && (
          <Notice label="Live weather unavailable">
            {error}. Showing practice trips on the practice chart instead. None of these fields or reports are real.
          </Notice>
        )}

        <section className="trip-controls" aria-label="Trip settings">
          <Field label="Leave at">
            <input type="datetime-local" value={toLocalInput(departure)} onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) { setDeparture(d); setSkip(new Set()); } }} />
          </Field>
          <Field label="Farthest one way" hint="nm">
            <input className="mono" type="number" inputMode="numeric" min={20} max={250} step={10} value={prefs.maxLegNm}
              onChange={(e) => { const n = Number(e.target.value); if (n >= 20 && n <= 250) setPrefs({ ...prefs, maxLegNm: n }); }} />
          </Field>
          <Field label="Shortest runway" hint="ft">
            <input className="mono" type="number" inputMode="numeric" min={1000} max={10000} step={100} value={prefs.minRunwayFt}
              onChange={(e) => { const n = Number(e.target.value); if (n >= 1000 && n <= 10000) setPrefs({ ...prefs, minRunwayFt: n }); }} />
          </Field>
          <Field label="Fuel on landing" hint="min">
            <input className="mono" type="number" inputMode="numeric" min={30} max={120} step={15} value={prefs.reserveMin}
              onChange={(e) => { const n = Number(e.target.value); if (n >= 30 && n <= 120) setPrefs({ ...prefs, reserveMin: n }); }} />
          </Field>
        </section>

        {!rec && <p className="muted">{busy ? 'Pulling reports, forecasts and winds aloft for the fields in reach.' : 'Working the trips.'}</p>}

        {rec && inputs && (
          <>
            <div className="trip-lead">
              <Voice>{tripLead(rec, o)}</Voice>
              {o.airplane.sample && (
                <p className="help">Times and fuel use <b>sample airplane numbers</b> ({o.airplane.perf.cruise.tasKt} kt, {o.airplane.perf.cruise.gph} gal an hour, {o.airplane.usableGal} gal usable) until you enter your own.</p>
              )}
            </div>
            <div className="trip-grid">
              <div className="trip-main">
                <ol className="trips" aria-label="Recommended trips">
                  {picks.map((p) => <TripCard key={p.dest.id} plan={p} o={o} onPlan={() => setPlanning(p)} />)}
                </ol>
                {(more > 0 || skip.size > 0) && (
                  <div className="btn-row trip-more">
                    {more > 0 && (
                      <button type="button" className="btn" onClick={() => setSkip((s) => new Set([...s, ...picks.map((p) => p.dest.id)]))}>Show me others</button>
                    )}
                    {skip.size > 0 && (
                      <button type="button" className="linkish" onClick={() => setSkip(new Set())}>Back to the first set</button>
                    )}
                  </div>
                )}
                {rec.filtered.length > 0 && (
                  <section className="trip-filtered" aria-labelledby="trip-left-out">
                    <h2 id="trip-left-out">Left out</h2>
                    <ul>
                      {rec.filtered.map((p) => {
                        const s = stopper(p)!;
                        return (
                          <li key={p.dest.id}>
                            <span className="mono trip-id">{p.dest.id}</span>
                            <span className="trip-why"><b>{s.title}.</b> <span className="muted">{s.detail}</span></span>
                            <span className="mono trip-nm">{Math.round(p.distanceNm)} nm</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                <div className="trip-foot">
                  <p className="trip-disclaimer">
                    <b>A training plan, not a briefing.</b> Before you fly any of these, get an official briefing and check NOTAMs and TFRs. The engine reads neither, and it doesn't know terrain, obstacles or airspace{practice ? '' : ' along a real route'}.
                  </p>
                  <p className="help">
                    {practice
                      ? 'Practice fields and practice weather, made up for the practice chart. Not real places or reports.'
                      : 'Fields that report weather, from FAA airport data and aviationweather.gov reports, forecasts and winds aloft. Fields without a weather report are not suggested.'}
                  </p>
                </div>
              </div>
              <aside className="tool trip-tool" aria-label="Plan view">
                <Figure figure={tripMapFigure(inputs, picks, rec.filtered, [25, 50, prefs.maxLegNm].filter((r, i, a) => a.indexOf(r) === i && r <= prefs.maxLegNm))} practiceField={practice} />
                <dl className="tm-key" aria-label="Plan view key">
                  <div><dt><i className="k-home" /></dt><dd>Home</dd></div>
                  <div><dt><i className="k-pick" /></dt><dd>Worth planning</dd></div>
                  <div><dt><i className="k-filtered" /></dt><dd>Left out</dd></div>
                </dl>
              </aside>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function TripCard({ plan: p, o, onPlan }: { plan: TripPlan; o: PlanOptions; onPlan: () => void }) {
  const cautions = p.findings.filter((f) => f.severity === 'caution');
  const margin = p.times.sunsetMarginMin;
  return (
    <li className="trip-card">
      <div className="trip-card-head">
        <h3><span className="mono trip-id">{p.dest.id}</span> <span className="trip-name">{p.dest.name}</span></h3>
        <span className="trip-meta">{Math.round(p.distanceNm)} nm, {deg3(p.magCourse)}° magnetic{p.dest.towered ? ', towered' : ''}</span>
      </div>
      <dl className="trip-ro">
        <div><dt>GS out / home</dt><dd className="mono">{p.out.groundspeedKt} / {p.back.groundspeedKt}<small>kt</small></dd></div>
        <div><dt>Time out / home</dt><dd className="mono">{p.out.totalMin} / {p.back.totalMin}<small>min</small></dd></div>
        <div><dt>Fuel needed</dt><dd className="mono">{p.fuel.requiredGal}<small>gal</small></dd></div>
        <div><dt>At arrival</dt><dd className="mono">{skyText(p.arrivalWx)}</dd></div>
        {margin !== null && <div><dt>Home before sunset</dt><dd className="mono">{Math.floor(margin / 60)}<small>h</small> {margin % 60}<small>m</small></dd></div>}
      </dl>
      <p className="trip-pitch">{tripPitch(p, o)}</p>
      {p.tags.length > 0 && (
        <div className="chips">
          {p.tags.map((t) => <span key={t} className="chip">{TAG_LABEL[t]}</span>)}
        </div>
      )}
      {cautions.length > 0 && (
        <ul className="trip-cautions">
          {cautions.map((f) => <li key={f.id}><b>{SEVERITY_LABEL[f.severity]}.</b> {f.title}. <span className="muted">{f.detail}</span></li>)}
        </ul>
      )}
      <div className="cta">
        <button type="button" className="btn primary" onClick={onPlan}>Plan this trip</button>
        <span className="hint">Weather from {wxSource(p.arrivalWx)}. Home about {localTime(p.times.home)}.</span>
      </div>
    </li>
  );
}
