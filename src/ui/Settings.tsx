// Settings: personal minimums, home base, theme, and the reset controls.

import { useState } from 'react';
import type { Airport } from '../data/airports';
import type { PilotProfile } from '../data/pilot';
import { resetReview } from '../review/scheduler';
import { Card, Field, NumInput, PageHead } from './common';
import type { Theme } from './state';

export function Settings({ airport, pilot, setPilot, theme, setTheme, onReviewReset, onRerunSetup }: {
  airport: Airport;
  pilot: PilotProfile;
  setPilot: (p: PilotProfile) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onReviewReset: () => void;
  onRerunSetup: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const mins = pilot.minimums;
  const setMin = (patch: Partial<PilotProfile['minimums']>) => setPilot({ ...pilot, minimums: { ...mins, ...patch } });
  const ap = airport;

  return (
    <>
      <PageHead title="Settings" lead="Personal minimums are yours to set and yours to honor. The brief grades against them." />
      <div className="grid-2">
        <div className="stack">
          <Card title="Personal minimums" sub="Saved as you type">
            <div className="inputs">
              <Field label="Ceiling" hint="ft AGL" size="sm"><NumInput value={mins.ceilingFt} step={100} min={0} onChange={(n) => setMin({ ceilingFt: n })} /></Field>
              <Field label="Visibility" hint="statute miles" size="sm"><NumInput value={mins.visibilitySm} step={1} min={0} onChange={(n) => setMin({ visibilitySm: n })} /></Field>
              <Field label="Crosswind" hint="kt, including gusts" size="sm"><NumInput value={mins.crosswindKt} step={1} min={0} onChange={(n) => setMin({ crosswindKt: n })} /></Field>
              <Field label="Gust spread" hint="kt over steady" size="sm"><NumInput value={mins.gustSpreadKt} step={1} min={0} onChange={(n) => setMin({ gustSpreadKt: n })} /></Field>
            </div>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              The FAA Risk Management Handbook suggests setting these on a calm day and raising them after a long layoff. Lowering them on the ramp defeats the purpose.
            </p>
          </Card>
          <Card title="Pilot">
            <div className="inputs">
              <Field label="Name" size="md"><input value={pilot.name} onChange={(e) => setPilot({ ...pilot, name: e.target.value })} /></Field>
              <Field label="Last flight review" hint="14 CFR 61.56, 24 calendar months" size="md">
                <input type="date" value={pilot.lastFlightReview ?? ''} onChange={(e) => setPilot({ ...pilot, lastFlightReview: e.target.value || null })} />
              </Field>
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Home base" sub="Set during setup" right={<button type="button" className="btn quiet" onClick={onRerunSetup}>Run setup again</button>}>
            <dl className="kv">
              <dt>Airport</dt><dd>{ap.icao} · {ap.name}, {ap.city}</dd>
              <dt>Elevation</dt><dd>{ap.elevationFt} ft</dd>
              <dt>Airspace</dt><dd>Class {ap.airspace}</dd>
              <dt>Runways</dt><dd>{ap.runways.length ? ap.runways.map((r) => `${r.id} (${String(r.headingMag).padStart(3, '0')}°M)`).join(' / ') : 'none entered'}</dd>
              <dt>Variation</dt><dd>{Math.abs(ap.magneticVariationDeg)}°{ap.magneticVariationDeg < 0 ? 'W' : 'E'}</dd>
              <dt>TAF sources</dt><dd>{ap.tafStations.join(', ')}</dd>
            </dl>
            {ap.verify.length > 0 && (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Still to confirm against the current Chart Supplement: {ap.verify.join(', ')}. Run setup again to edit.
              </p>
            )}
          </Card>
          <Card title="Appearance">
            <div className="seg" role="group" aria-label="Theme">
              {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
                <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>{t === 'auto' ? 'System' : t}</button>
              ))}
            </div>
          </Card>
          <Card title="Reset">
            <p style={{ fontSize: '0.9rem' }}>Clears every review answer and the FSRS schedule. Readiness starts over. The airplane profile and minimums stay.</p>
            {!confirm ? (
              <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Reset review history</button>
            ) : (
              <div className="btn-row">
                <button type="button" className="btn danger" onClick={() => { resetReview(); setConfirm(false); onReviewReset(); }}>Yes, erase it</button>
                <button type="button" className="btn quiet" onClick={() => setConfirm(false)}>Keep it</button>
              </div>
            )}
          </Card>
          <Card title="About">
            <p style={{ fontSize: '0.9rem' }}>Downwind Ground School, Phase 0 prototype. Weather from aviationweather.gov when reachable. Crosswind, density altitude and weight and balance are computed in the app from the parsed report and your profile. No model output touches a number.</p>
            <p className="mono muted" style={{ fontSize: '0.78rem' }}>Training aid. Not for navigation. Not a substitute for an official briefing or a CFI.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
