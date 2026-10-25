// Tools: what you reach for from inside a flight. The airplane and its weight
// and balance, the current weather at your field, the practice sectional, and
// the review deck.

import { useEffect, useRef, useState } from 'react';
import type { AircraftProfile } from '../data/aircraft';
import type { Airport } from '../data/airports';
import { fetchWeather, sampleWeather, type WeatherBundle } from '../lib/weather';
import { Airplane } from './Airplane';
import { ChartTool } from './ChartTool';
import { Icons, Notice } from './common';
import { MetarLegend, RawReport } from './MetarBlock';
import { Review } from './Review';
import type { Loading } from './state';

export type Tool = 'airplane' | 'weather' | 'chart' | 'review';

export function Tools({ tool, setTool, airport, aircraft, setAircraft, loading, setLoading, epoch, onSetup }: {
  tool: Tool;
  setTool: (t: Tool) => void;
  airport: Airport | null;
  aircraft: AircraftProfile;
  setAircraft: (a: AircraftProfile) => void;
  loading: Loading;
  setLoading: (l: Loading) => void;
  epoch: number;
  onSetup: () => void;
}) {
  return (
    <>
      <div className="strip-head">
        <div className="strip-title">
          <div>
            <h1>Tools</h1>
            <span className="muted">The drawer you reach into from a flight. Nothing here is graded.</span>
          </div>
        </div>
        <div className="seg tabs" role="tablist" aria-label="Tools">
          {([['airplane', 'Airplane'], ['weather', 'Weather now'], ['chart', 'Chart'], ['review', 'Review deck']] as [Tool, string][]).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tool === id} aria-pressed={tool === id} onClick={() => setTool(id)}>{label}</button>
          ))}
        </div>
      </div>
      {tool === 'airplane' && <Airplane aircraft={aircraft} setAircraft={setAircraft} loading={loading} setLoading={setLoading} />}
      {tool === 'weather' && (airport ? <WeatherNow airport={airport} /> : (
        <div className="empty">
          <h2>No home airport yet</h2>
          <p>Weather now shows the current METAR and TAF for the field you fly from.</p>
          <button type="button" className="btn primary" onClick={onSetup}>Set home airport</button>
        </div>
      ))}
      {tool === 'chart' && <ChartTool aircraft={aircraft} />}
      {tool === 'review' && <Review key={epoch} />}
    </>
  );
}

function WeatherNow({ airport }: { airport: Airport }) {
  const [wx, setWx] = useState<WeatherBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const refresh = () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    fetchWeather(airport.icao, airport.tafStations, ac.signal)
      .then((b) => { if (!ac.signal.aborted) setWx(b); })
      .catch(() => { if (!ac.signal.aborted) setWx(sampleWeather(airport.icao, 'Request aborted')); })
      .finally(() => { if (!ac.signal.aborted) setBusy(false); });
  };
  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airport.icao]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Weather now at {airport.icao}</h2>
        {wx && <span className="sub">{wx.source === 'live' ? `Live, fetched ${wx.fetchedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Practice weather'}</span>}
        <span className="right"><button type="button" className="btn quiet" onClick={refresh} disabled={busy}>{Icons.refresh}{busy ? 'Refreshing' : 'Refresh'}</button></span>
      </div>
      {!wx && <p className="muted">Pulling the current METAR and TAF.</p>}
      {wx && (
        <>
          {wx.source === 'sample' && (
            <Notice label="Practice weather">Live weather could not be fetched{wx.error ? ` (${wx.error})` : ''}. This is not a real report for {airport.icao}.</Notice>
          )}
          <div>
            <RawReport raw={wx.metar.raw} label={`METAR ${wx.metar.station}`} />
            {wx.taf ? <RawReport raw={wx.taf.raw} label={`TAF ${wx.taf.station}${wx.taf.station !== airport.icao ? ', nearest TAF station' : ''}`} /> : <p className="muted small">No TAF for this field or a nearby station.</p>}
          </div>
          <MetarLegend />
          <p className="help">Flight category {wx.metar.category ?? 'not determined'}. For the full read against your minimums, fly today's real conditions from the course page.</p>
        </>
      )}
    </section>
  );
}
