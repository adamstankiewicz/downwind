// Airplane: the aircraft profile and today's loading, with a live CG chart.
// Profile edits are a draft until Save, which also clears the sample flag.

import { useEffect, useState } from 'react';
import { sampleC172K, type AircraftProfile } from '../data/aircraft';
import { computeWb, FUEL_LB_PER_GAL, type Envelope } from '../lib/wb';
import { Card, Field, Notice, NumInput, PageHead } from './common';
import { CgChart } from './CgChart';
import { FUEL_STATION_ID, loadItems, wbFor, type Loading } from './state';

export function Airplane({ aircraft, setAircraft, loading, setLoading }: {
  aircraft: AircraftProfile;
  setAircraft: (a: AircraftProfile) => void;
  loading: Loading;
  setLoading: (l: Loading) => void;
}) {
  const [draft, setDraft] = useState<AircraftProfile>(aircraft);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  useEffect(() => setDraft(aircraft), [aircraft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(aircraft);

  const wb = wbFor(draft, loading);
  const zeroFuel = computeWb(
    draft.emptyWeightLb,
    draft.emptyArmIn,
    draft.stations,
    loadItems(draft, { ...loading, fuelGal: 0 }),
    draft.envelope,
    draft.maxGrossLb,
  );
  const ok = wb.withinEnvelope && !wb.overGross && wb.stationsOverMax.length === 0;
  const fuelLb = Math.round(loading.fuelGal * FUEL_LB_PER_GAL);

  const upd = (patch: Partial<AircraftProfile>) => setDraft({ ...draft, ...patch });
  const updStation = (i: number, patch: Partial<AircraftProfile['stations'][number]>) => {
    const stations = draft.stations.map((s, j) => (j === i ? { ...s, ...patch } : s));
    upd({ stations });
  };
  const updEnvelope = (i: number, k: 0 | 1, v: number) => {
    const envelope = draft.envelope.map((p, j) => (j === i ? ((k === 0 ? [v, p[1]] : [p[0], v]) as [number, number]) : p)) as Envelope;
    upd({ envelope });
  };

  const save = () => {
    setAircraft({ ...draft, sampleValues: false });
    setSavedAt(new Date());
  };

  return (
    <>
      <PageHead
        title="Airplane"
        lead="Your profile and today's loading. The go/no-go brief uses whatever is saved here."
        meta={<><span>Profile</span><b>{aircraft.tailNumber} · {aircraft.type}</b></>}
      />

      {aircraft.sampleValues ? (
        <Notice label="Sample values">
          Every number on this page is a typical C172K figure for illustration. Replace them from your POH section 6 and your airplane's current weight and balance record, then save. Until then the brief treats W&B results as practice only.
        </Notice>
      ) : (
        <Notice kind="info" label="Your numbers">
          This profile was edited and saved{savedAt ? ` at ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}. Check it against the POH after any equipment change or reweigh.
        </Notice>
      )}

      <div className="grid-2">
        <div className="stack">
          <Card title="Today's loading" sub="Saved as you type">
            <div className="table-scroll">
              <table className="wb-table">
                <thead>
                  <tr><th>Station</th><th className="num">Arm (in)</th><th className="num">Load</th><th className="num">Weight (lb)</th><th className="num">Moment</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Empty airplane</td>
                    <td className="num">{draft.emptyArmIn}</td>
                    <td className="num muted">—</td>
                    <td className="num">{draft.emptyWeightLb.toLocaleString()}</td>
                    <td className="num">{Math.round(draft.emptyWeightLb * draft.emptyArmIn).toLocaleString()}</td>
                  </tr>
                  {draft.stations.map((s) => {
                    const isFuel = s.id === FUEL_STATION_ID;
                    const lb = isFuel ? fuelLb : loading.weights[s.id] ?? 0;
                    const over = wb.stationsOverMax.includes(s.id);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.label}
                          {s.maxLb !== undefined && <span className="muted" style={{ fontSize: '0.78rem' }}> · max {s.maxLb} lb</span>}
                        </td>
                        <td className="num">{s.armIn}</td>
                        <td className="num">
                          {isFuel ? (
                            <NumInput ariaLabel="Fuel, gallons" value={loading.fuelGal} min={0} max={draft.usableFuelGal} step={1} onChange={(n) => setLoading({ ...loading, fuelGal: Math.max(0, Math.min(draft.usableFuelGal, n)) })} />
                          ) : (
                            <NumInput ariaLabel={`${s.label}, pounds`} value={lb} min={0} step={5} onChange={(n) => setLoading({ ...loading, weights: { ...loading.weights, [s.id]: Math.max(0, n) } })} />
                          )}
                          <div className="muted" style={{ fontSize: '0.72rem' }}>{isFuel ? `gal × ${FUEL_LB_PER_GAL}` : 'lb'}</div>
                        </td>
                        <td className="num" style={over ? { color: 'var(--ifr)' } : undefined}>{lb.toLocaleString()}</td>
                        <td className="num">{Math.round(lb * s.armIn).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  <tr className="total">
                    <td>Total</td>
                    <td className="num">{wb.cgIn}</td>
                    <td className="num"></td>
                    <td className="num" style={wb.overGross ? { color: 'var(--ifr)' } : undefined}>{wb.totalLb.toLocaleString()}</td>
                    <td className="num">{wb.momentLbIn.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="cg-stat">
              <span className={`status ${ok ? 'ok' : 'bad'}`}>
                {wb.overGross ? `Over gross by ${wb.totalLb - draft.maxGrossLb} lb` : !wb.withinEnvelope ? 'CG outside envelope' : wb.stationsOverMax.length ? 'Station over its limit' : 'In the envelope'}
              </span>
              <span>Useful load left <b>{(draft.maxGrossLb - wb.totalLb).toLocaleString()} lb</b></span>
              <span>Zero fuel <b>{zeroFuel.totalLb.toLocaleString()} lb · {zeroFuel.cgIn} in</b></span>
            </div>
          </Card>

          <Card title="CG envelope" sub={draft.sampleValues ? 'Sample envelope' : 'From your profile'}>
            <CgChart envelope={draft.envelope} loaded={wb} zeroFuel={zeroFuel} maxGrossLb={draft.maxGrossLb} />
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Solid point is the loaded airplane; the hollow point is where it ends up with the tanks empty. Burning fuel moves the CG along the dashed line, so check both ends stay inside.
            </p>
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Profile"
            sub={dirty ? 'Unsaved changes' : 'Saved'}
            right={
              <span className="btn-row">
                <button type="button" className="btn quiet" disabled={!dirty} onClick={() => setDraft(aircraft)}>Discard</button>
                <button type="button" className="btn primary" disabled={!dirty} onClick={save}>Save</button>
              </span>
            }
          >
            <div className="inputs">
              <Field label="Tail number" size="sm">
                <input value={draft.tailNumber} onChange={(e) => upd({ tailNumber: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Type" size="md">
                <input value={draft.type} onChange={(e) => upd({ type: e.target.value })} />
              </Field>
            </div>
            <div className="inputs">
              <Field label="Empty weight" hint="lb" size="sm"><NumInput value={draft.emptyWeightLb} step={1} onChange={(n) => upd({ emptyWeightLb: n })} /></Field>
              <Field label="Empty CG arm" hint="in aft of datum" size="sm"><NumInput value={draft.emptyArmIn} step={0.1} onChange={(n) => upd({ emptyArmIn: n })} /></Field>
              <Field label="Max gross" hint="lb" size="sm"><NumInput value={draft.maxGrossLb} step={1} onChange={(n) => upd({ maxGrossLb: n })} /></Field>
              <Field label="Usable fuel" hint="gal" size="sm"><NumInput value={draft.usableFuelGal} step={1} onChange={(n) => upd({ usableFuelGal: n })} /></Field>
              <Field label="Demonstrated crosswind" hint="kt, POH section 4" size="sm"><NumInput value={draft.demonstratedCrosswindKt} step={1} onChange={(n) => upd({ demonstratedCrosswindKt: n })} /></Field>
            </div>
          </Card>

          <Card title="Loading stations" sub="Arms from POH section 6">
            <div className="table-scroll">
              <table className="wb-table">
                <thead><tr><th>Label</th><th className="num">Arm (in)</th><th className="num">Max (lb)</th><th></th></tr></thead>
                <tbody>
                  {draft.stations.map((s, i) => (
                    <tr key={s.id}>
                      <td><input className="wide" aria-label="Station label" value={s.label} onChange={(e) => updStation(i, { label: e.target.value })} /></td>
                      <td className="num"><NumInput ariaLabel={`${s.label} arm`} value={s.armIn} step={0.1} onChange={(n) => updStation(i, { armIn: n })} /></td>
                      <td className="num">
                        <input
                          type="number"
                          inputMode="numeric"
                          aria-label={`${s.label} max weight`}
                          placeholder="none"
                          value={s.maxLb ?? ''}
                          onChange={(e) => updStation(i, { maxLb: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined })}
                        />
                      </td>
                      <td>
                        {s.id !== FUEL_STATION_ID && (
                          <button type="button" className="rm" aria-label={`Remove ${s.label}`} onClick={() => upd({ stations: draft.stations.filter((_, j) => j !== i) })}>×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="btn quiet"
              onClick={() => upd({ stations: [...draft.stations, { id: `st${Date.now().toString(36)}`, label: 'New station', armIn: 0 }] })}
            >
              Add station
            </button>
          </Card>

          <Card title="Envelope corners" sub="CG in, weight lb, in order around the polygon">
            <div className="table-scroll">
              <table className="wb-table">
                <thead><tr><th>#</th><th className="num">CG (in)</th><th className="num">Weight (lb)</th><th></th></tr></thead>
                <tbody>
                  {draft.envelope.map((p, i) => (
                    <tr key={i}>
                      <td className="mono muted">{i + 1}</td>
                      <td className="num"><NumInput ariaLabel={`Corner ${i + 1} CG`} value={p[0]} step={0.1} onChange={(n) => updEnvelope(i, 0, n)} /></td>
                      <td className="num"><NumInput ariaLabel={`Corner ${i + 1} weight`} value={p[1]} step={10} onChange={(n) => updEnvelope(i, 1, n)} /></td>
                      <td>
                        {draft.envelope.length > 3 && (
                          <button type="button" className="rm" aria-label={`Remove corner ${i + 1}`} onClick={() => upd({ envelope: draft.envelope.filter((_, j) => j !== i) as Envelope })}>×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row">
              <button type="button" className="btn quiet" onClick={() => upd({ envelope: [...draft.envelope, [draft.envelope[draft.envelope.length - 1][0], draft.envelope[draft.envelope.length - 1][1]]] as Envelope })}>Add corner</button>
              <button type="button" className="btn quiet" onClick={() => { setAircraft(sampleC172K); setSavedAt(null); }}>Reset to sample</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
