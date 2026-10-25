// The Chart tool: the practice sectional with two things to do on it. Look up
// a point: tap the chart (or pick a place from the list) and read the airspace
// class at your altitude, what it takes to be there, and the weather you need.
// Plan a route: tap fields and checkpoints in order and read the nav log for
// your airplane's cruise numbers and today's wind.

import { useMemo, useState } from 'react';
import { practiceRegion as R } from '../chart/practiceRegion';
import type { AircraftProfile } from '../data/aircraft';
import { positionAt, requirements, vfrMinimums, type AirspaceClass } from '../lib/airspace';
import { isLegalVfrAltitude, navLog, vfrCruisingAltitudes, type LatLon, type NavPoint } from '../lib/nav';
import { sampleTrainerPerformance } from '../lib/perf';
import { Field, NumInput } from './common';
import { NavLogTable } from './Figure';
import { nearestPlace, SectionalChart } from './SectionalChart';

type Mode = 'point' | 'route';

const CLASS_NAME: Record<AirspaceClass, string> = { B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', G: 'Golf' };
const fmt = (n: number) => n.toLocaleString('en-US');
const pad3 = (n: number) => String(Math.round(n)).padStart(3, '0');

const PLACES = [
  ...R.airports.map((a) => ({ id: a.id, label: `${a.id} ${a.name}`, pos: a.pos, name: a.name })),
  ...R.checkpoints.map((c) => ({ id: c.id, label: c.name, pos: c.pos, name: c.name })),
];

export function ChartTool({ aircraft }: { aircraft: AircraftProfile }) {
  const [mode, setMode] = useState<Mode>('point');
  const [altitude, setAltitude] = useState(3500);
  const [night, setNight] = useState(false);
  const [point, setPoint] = useState<{ pos: LatLon; name?: string } | null>(null);
  const [route, setRoute] = useState<string[]>([]);
  const [windFrom, setWindFrom] = useState(270);
  const [windKt, setWindKt] = useState(10);
  const [pendingPlace, setPendingPlace] = useState('');

  const perf = aircraft.performance ?? sampleTrainerPerformance();
  const perfSource = aircraft.performance && !aircraft.sampleValues ? `${aircraft.type || 'your airplane'}` : 'the sample trainer';

  const onPick = (p: LatLon) => {
    if (mode === 'route') {
      // A tap within about three miles of a field or checkpoint adds it.
      const near = nearestPlace(R, p, Math.max(2.5, 6));
      if (near) setRoute((r) => (r[r.length - 1] === near.id ? r : [...r, near.id]));
      return;
    }
    const near = nearestPlace(R, p, 1.5);
    setPoint({ pos: near ? near.pos : p, name: near ? near.name : undefined });
  };

  const addPlace = (id: string) => {
    if (!id) return;
    setRoute((r) => (r[r.length - 1] === id ? r : [...r, id]));
    setPendingPlace('');
  };

  const lookup = useMemo(() => {
    if (!point) return null;
    const ground = R.groundFt(point.pos);
    const pos = positionAt(R.airspace, point.pos, altitude, ground, R.veils);
    return { ground, pos, reqs: requirements(pos, altitude), mins: vfrMinimums(pos.cls, altitude, ground, night) };
  }, [point, altitude, night]);

  const navPoints: NavPoint[] = route.map((id) => PLACES.find((p) => p.id === id)!).filter(Boolean).map((p) => ({ id: p.id, name: p.name, lat: p.pos.lat, lon: p.pos.lon }));
  const log = useMemo(() => navLog(navPoints, { tasKt: perf.cruise.tasKt, windFromTrue: windFrom, windKt, variationDeg: R.variationDeg, gph: perf.cruise.gph }), [navPoints, perf, windFrom, windKt]);
  const first = log.legs[0];
  const cruising = first ? vfrCruisingAltitudes(first.magCourse, 3500, 11500) : [];
  const groundAtStart = navPoints[0] ? R.groundFt(navPoints[0]) : 0;
  const altLegal = first ? isLegalVfrAltitude(first.magCourse, altitude, groundAtStart) : true;

  return (
    <section className="card chart-tool">
      <div className="card-head">
        <h2>Practice sectional</h2>
        <span className="sub">A made-up region around KXYZ. Nothing here is a real place.</span>
      </div>
      <div className="chart-bar">
        <div className="seg" role="group" aria-label="What to do on the chart">
          <button type="button" aria-pressed={mode === 'point'} onClick={() => setMode('point')}>Look up a point</button>
          <button type="button" aria-pressed={mode === 'route'} onClick={() => setMode('route')}>Plan a route</button>
        </div>
        <Field label="Your altitude, ft MSL" size="sm">
          <NumInput value={altitude} onChange={(n) => setAltitude(Math.max(0, n))} step={500} min={0} max={17500} ariaLabel="Your altitude, ft MSL" />
        </Field>
        {mode === 'point' && (
          <div className="seg" role="group" aria-label="Day or night">
            <button type="button" aria-pressed={!night} onClick={() => setNight(false)}>Day</button>
            <button type="button" aria-pressed={night} onClick={() => setNight(true)}>Night</button>
          </div>
        )}
      </div>
      <p className="help">
        {mode === 'point'
          ? 'Tap anywhere on the chart, or choose a place from the list, to read the airspace there at your altitude.'
          : 'Tap fields and checkpoints in order, or add them from the list, to build a route and read the nav log.'}
      </p>
      <SectionalChart
        route={mode === 'route' ? route : undefined}
        point={mode === 'point' && point ? point.pos : undefined}
        onPick={onPick}
        maxHeight={640}
      />

      {mode === 'point' && (
        <div className="chart-panel">
          <div className="chart-controls">
            <Field label="Or choose a place" size="md">
              <select value="" onChange={(e) => { const p = PLACES.find((x) => x.id === e.target.value); if (p) setPoint({ pos: p.pos, name: p.name }); }} aria-label="Choose a place on the chart">
                <option value="">Pick an airport or checkpoint</option>
                <optgroup label="Airports">
                  {R.airports.map((a) => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}
                </optgroup>
                <optgroup label="Checkpoints">
                  {R.checkpoints.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              </select>
            </Field>
          </div>
          {!lookup || !point ? (
            <p className="muted">No point picked yet.</p>
          ) : (
            <div className="lookup" aria-live="polite">
              <div className="lookup-class">
                <span className="lookup-k">{point.name ? `Over ${point.name}` : `${point.pos.lat.toFixed(2)}°N ${Math.abs(point.pos.lon).toFixed(2)}°W`} at {fmt(altitude)} ft MSL</span>
                <b className="runway">Class {lookup.pos.cls}</b>
                <span className="lookup-v">
                  {CLASS_NAME[lookup.pos.cls]}{lookup.pos.volume ? `, ${lookup.pos.volume.name}` : lookup.pos.cls === 'E' ? ', 1,200 ft AGL and up' : ', uncontrolled'}
                  {lookup.pos.volume?.note ? `. ${lookup.pos.volume.note}` : ''}
                </span>
              </div>
              <dl className="work">
                <div><dt>Ground</dt><dd>{fmt(lookup.ground)} ft MSL, so you are {fmt(altitude - lookup.ground)} ft above it</dd></div>
                <div><dt>Mode C veil</dt><dd>{lookup.pos.modeCVeil ? 'Inside the 30 nm veil of KXBB' : 'Outside any veil'}</dd></div>
                {lookup.pos.special.length > 0 && (
                  <div><dt>Special use</dt><dd>{lookup.pos.special.map((s) => `${s.name}${s.note ? `: ${s.note}` : ''}`).join(' ')}</dd></div>
                )}
                <div>
                  <dt>To be here</dt>
                  <dd>
                    {lookup.reqs.length === 0 ? <span>Nothing beyond basic VFR. No clearance, no call.</span> : (
                      <ul className="plain req-list">
                        {lookup.reqs.map((r) => <li key={r.id}>{r.text} <small className="muted">{r.ref}</small></li>)}
                      </ul>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Weather you need</dt>
                  <dd>
                    <span><b>{lookup.mins.visibilitySm} SM</b> visibility, {night ? 'night' : 'day'}</span>
                    <span>{lookup.mins.clouds ? `${fmt(lookup.mins.clouds.belowFt)} ft below, ${fmt(lookup.mins.clouds.aboveFt)} ft above, ${lookup.mins.clouds.horizontal} from clouds` : 'Clear of clouds'}</span>
                    <small>{lookup.mins.ref}</small>
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}

      {mode === 'route' && (
        <div className="chart-panel">
          <div className="chart-controls">
            <Field label="Add a waypoint" size="md">
              <div className="chip-add">
                <select value={pendingPlace} onChange={(e) => setPendingPlace(e.target.value)} aria-label="Waypoint to add">
                  <option value="">Pick an airport or checkpoint</option>
                  <optgroup label="Airports">
                    {R.airports.map((a) => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}
                  </optgroup>
                  <optgroup label="Checkpoints">
                    {R.checkpoints.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                </select>
                <button type="button" className="btn" onClick={() => addPlace(pendingPlace)} disabled={!pendingPlace}>Add</button>
              </div>
            </Field>
            <Field label="Wind from, true" size="sm">
              <NumInput value={windFrom} onChange={(n) => setWindFrom(((n % 360) + 360) % 360)} step={10} min={0} max={360} ariaLabel="Wind from, degrees true" />
            </Field>
            <Field label="Wind, kt" size="sm">
              <NumInput value={windKt} onChange={(n) => setWindKt(Math.max(0, n))} step={1} min={0} max={99} ariaLabel="Wind speed, knots" />
            </Field>
          </div>
          {route.length > 0 && (
            <ol className="route-list" aria-label="Route">
              {route.map((id, i) => {
                const p = PLACES.find((x) => x.id === id);
                return (
                  <li key={`${id}-${i}`} className="chip-x">
                    <span>{p?.label ?? id}</span>
                    <button type="button" aria-label={`Remove ${p?.label ?? id} from the route`} onClick={() => setRoute((r) => r.filter((_, j) => j !== i))}>×</button>
                  </li>
                );
              })}
              <li><button type="button" className="btn quiet sm" onClick={() => setRoute([])}>Clear route</button></li>
            </ol>
          )}
          <NavLogTable log={log} />
          <p className="help">
            Cruise {perf.cruise.tasKt} kt true and {perf.cruise.gph} gph from {perfSource}. Variation {Math.abs(R.variationDeg)}°{R.variationDeg < 0 ? 'W' : 'E'}, so magnetic is true plus {Math.abs(R.variationDeg)}.
          </p>
          {first && (
            <div className="cruise-alts">
              <span>Legal VFR cruising altitudes above 3,000 ft AGL for the first leg, magnetic course {pad3(first.magCourse)}:</span>
              <span className="alt-chips">
                {cruising.map((a) => <span key={a} className={`chip${a === altitude ? ' on' : ''}`}>{fmt(a)}</span>)}
              </span>
              <span className={altLegal ? 'status ok' : 'status bad'}>
                {altLegal ? `${fmt(altitude)} ft is fine for this course${altitude - groundAtStart <= 3000 ? ', under 3,000 ft AGL the rule does not apply' : ''}.` : `${fmt(altitude)} ft is the wrong side of the rule for this course.`}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
