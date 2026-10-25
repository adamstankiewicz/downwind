// Systems figures for module 7: the electrical bus with its loads and the
// minutes the battery buys, the six-pack and compass drawn as schematic
// gauges, and the PHAK carburetor icing chart with today's air on it. Every
// number comes from the figure data or lib/systems; nothing here is computed
// by hand. The gauges are plain instruments, no manufacturer's face.

import type { Figure as FigureModel, PanelInstrument } from '../course/types';
import { CARB_ICE_LABEL, INSTRUMENT_NAME, type PowerSource } from '../lib/systems';
import { norm } from '../lib/wind';

type Electrical = Extract<FigureModel, { kind: 'electrical' }>;
type Panel = Extract<FigureModel, { kind: 'panel' }>;
type CarbIce = Extract<FigureModel, { kind: 'carbIce' }>;

const fmt = (n: number) => n.toLocaleString('en-US');
const pad3 = (n: number) => String(Math.round(norm(n)) || 360).padStart(3, '0');
const amps = (a: number) => (Number.isInteger(a) ? String(a) : a.toFixed(1));

/* ---------- electrical bus ---------- */

export function ElectricalFigure({ figure }: { figure: Electrical }) {
  const failed = figure.alternator === 'failed';
  const on = figure.loads.filter((l) => l.on);
  const off = figure.loads.filter((l) => !l.on);
  const minutes = Number.isFinite(figure.minutesLeft) ? fmt(figure.minutesLeft) : 'n/a';
  return (
    <figure className="fig">
      <ElectricalBus figure={figure} />
      <figcaption>
        {figure.volts} volt bus{failed ? ' on the battery alone' : ' with the alternator carrying the load'}: {on.length} load{on.length === 1 ? '' : 's'} on
        {off.length ? `, ${off.length} off` : ''}, {amps(figure.totalAmps)} amps in all.{' '}
        {failed ? `The usable ${amps(figure.usableAh)} amp-hours last about ${minutes} minutes at that draw. ` : ''}
        Filled dots mark essential loads, the ones that stay on after a shed.{' '}
        {figure.sample ? 'Sample loads for teaching, not your airplane. Use the electrical load list in your POH.' : 'Loads from your POH electrical load list.'}
      </figcaption>
    </figure>
  );
}

function ElectricalBus({ figure }: { figure: Electrical }) {
  const failed = figure.alternator === 'failed';
  // The bar is scaled to everything the bus could carry, so a shed reads as the bar shrinking.
  const everything = figure.loads.reduce((n, l) => n + l.amps, 0) || 1;
  const minutes = Number.isFinite(figure.minutesLeft) ? fmt(figure.minutesLeft) : 'n/a';
  const annun = failed ? 'Annunciators lit: alternator and low volts' : 'Annunciators dark';
  return (
    <div className={`elec${failed ? ' failed' : ''}`}>
      <div className="elec-head">
        <div className="elec-bus">
          <b className="runway">{figure.volts} <small>V bus</small></b>
          <span className="muted">{failed ? 'Alternator off line. Battery only.' : 'Alternator online.'}</span>
        </div>
        <div className="elec-annun" role="img" aria-label={annun}>
          <span className={failed ? 'lit alt' : ''}>ALT</span>
          <span className={failed ? 'lit volts' : ''}>LOW VOLTS</span>
        </div>
      </div>
      <div className="elec-bar" aria-hidden="true">
        {figure.loads.map((l) => (
          <i key={l.id} className={`${l.on ? 'on' : 'off'}${l.essential ? ' ess' : ''}`} style={{ flexGrow: l.amps / everything }} title={`${l.name} ${amps(l.amps)} A`} />
        ))}
      </div>
      <ul className="elec-loads plain">
        {figure.loads.map((l) => (
          <li key={l.id} className={l.on ? 'on' : 'off'}>
            <Rocker on={l.on} />
            <span className="elec-name">
              <i className={`ess-dot${l.essential ? ' ess' : ''}`} aria-hidden="true" />
              {l.name}
              {l.essential && <span className="vh"> (essential)</span>}
            </span>
            <span className="elec-amps mono">{l.on ? <>{amps(l.amps)} <small>A</small></> : <span className="muted">off</span>}</span>
          </li>
        ))}
      </ul>
      <dl className="elec-sum">
        <div>
          <dt>Total draw</dt>
          <dd><b className="runway">{amps(figure.totalAmps)} <small>A</small></b></dd>
        </div>
        <div>
          <dt>Usable battery</dt>
          <dd><b className="runway">{amps(figure.usableAh)} <small>Ah</small></b></dd>
        </div>
        <div className={failed ? 'now' : ''}>
          <dt>{failed ? 'Minutes at this load' : 'Minutes if the alternator quit'}</dt>
          <dd><b className="runway">{minutes} <small>min</small></b></dd>
        </div>
      </dl>
    </div>
  );
}

/** A rocker switch, up for on. */
function Rocker({ on }: { on: boolean }) {
  return (
    <svg className="rocker" viewBox="0 0 16 26" aria-hidden="true">
      <rect x="1" y="1" width="14" height="24" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3.5" y={on ? 3.5 : 13.5} width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/* ---------- the panel: six gauges and the compass ---------- */

const SOURCE_NAME: Record<PowerSource, string> = {
  pitot: 'Pitot',
  static: 'Static',
  vacuum: 'Vacuum',
  electric: 'Electric',
  none: 'No power needed',
};

const ORDER: PanelInstrument['id'][] = ['asi', 'ai', 'alt', 'tc', 'hi', 'vsi', 'compass'];

export function PanelFigure({ figure }: { figure: Panel }) {
  const byId = new Map(figure.instruments.map((i) => [i.id, i]));
  const six = ORDER.filter((id) => id !== 'compass').map((id) => byId.get(id)).filter((i): i is PanelInstrument => !!i);
  const compass = byId.get('compass');
  const covered = figure.instruments.filter((i) => i.state === 'covered');
  return (
    <figure className="fig">
      <div className="panel">
        <div className="panel-six">
          {six.map((i) => <Gauge key={i.id} inst={i} />)}
        </div>
        {compass && <Gauge inst={compass} />}
      </div>
      <figcaption>
        The six basic instruments in their standard places, the airspeed indicator, attitude indicator and altimeter across the top, the turn coordinator, heading indicator and vertical speed indicator below, with the magnetic compass above the panel. Under each one is what powers it. {covered.length ? `${covered.map((i) => INSTRUMENT_NAME[i.id]).join(' and ')} ${covered.length === 1 ? 'is' : 'are'} covered. ` : ''}Schematic gauges, not any manufacturer's panel.
      </figcaption>
    </figure>
  );
}

function sourcesText(sources: PowerSource[]): string {
  const real = sources.filter((s) => s !== 'none');
  if (real.length === 0) return SOURCE_NAME.none;
  return real.map((s) => SOURCE_NAME[s]).join(' and ');
}

function readingWords(i: PanelInstrument): string {
  const v = i.value;
  switch (i.id) {
    case 'asi': return `showing ${Math.round(v)} knots`;
    case 'ai': {
      const bank = Math.abs(v) < 1 ? 'wings level' : `${Math.round(Math.abs(v))} degrees of ${v > 0 ? 'right' : 'left'} bank`;
      const p = i.pitchDeg ?? 0;
      const pitch = Math.abs(p) < 1 ? 'nose level' : `nose ${Math.round(Math.abs(p))} degrees ${p > 0 ? 'up' : 'down'}`;
      return `showing ${bank}, ${pitch}`;
    }
    case 'alt': return `showing ${fmt(Math.round(v))} feet`;
    case 'tc': {
      if (Math.abs(v) < 0.05) return 'showing no turn';
      const rate = Math.abs(Math.abs(v) - 1) < 0.05 ? 'a standard-rate' : `${Math.abs(v).toFixed(1)} times a standard-rate`;
      return `showing ${rate} turn to the ${v > 0 ? 'right' : 'left'}`;
    }
    case 'hi': return `showing heading ${pad3(v)}`;
    case 'compass': return `showing heading ${pad3(v)}`;
    case 'vsi': return Math.abs(v) < 25 ? 'showing level flight' : `showing a ${fmt(Math.round(Math.abs(v)))} foot per minute ${v > 0 ? 'climb' : 'descent'}`;
  }
}

function Gauge({ inst }: { inst: PanelInstrument }) {
  const covered = inst.state === 'covered';
  const label = `${INSTRUMENT_NAME[inst.id]}, ${sourcesText(inst.sources).toLowerCase()}, ${covered ? 'covered' : readingWords(inst)}`;
  const wide = inst.id === 'compass';
  return (
    <div className={`gauge${wide ? ' wide' : ''}`}>
      <svg viewBox={wide ? '0 0 320 96' : '0 0 200 200'} role="img" aria-label={label}>
        {wide ? <CompassFace heading={inst.value} /> : <RoundFace inst={inst} />}
        {covered && <Cover wide={wide} />}
      </svg>
      <div className="gauge-label">
        <b>{INSTRUMENT_NAME[inst.id]}</b>
        <span className="muted">{sourcesText(inst.sources)}</span>
      </div>
    </div>
  );
}

const CX = 100;
const CY = 100;
const R_FACE = 88;
const rad = (deg: number) => (deg * Math.PI) / 180;
/** A point at `deg` clockwise from the top. */
const at = (deg: number, r: number, cx = CX, cy = CY) => ({ x: cx + Math.sin(rad(deg)) * r, y: cy - Math.cos(rad(deg)) * r });

function RoundFace({ inst }: { inst: PanelInstrument }) {
  return (
    <g>
      <circle cx={CX} cy={CY} r={97} fill="var(--gauge-bezel)" />
      <circle cx={CX} cy={CY} r={R_FACE} fill="var(--gauge-face)" />
      {inst.id === 'asi' && <AsiFace kt={inst.value} />}
      {inst.id === 'ai' && <AiFace bank={inst.value} pitch={inst.pitchDeg ?? 0} />}
      {inst.id === 'alt' && <AltFace ft={inst.value} />}
      {inst.id === 'tc' && <TcFace rate={inst.value} />}
      {inst.id === 'hi' && <HiFace heading={inst.value} />}
      {inst.id === 'vsi' && <VsiFace fpm={inst.value} />}
      {/* the glass: a hint of a reflection so the face reads as an instrument */}
      <circle cx={CX} cy={CY} r={R_FACE} fill="none" stroke="var(--gauge-rim)" strokeWidth="2" />
    </g>
  );
}

function Needle({ deg, len, width = 4, tail = 14, color = 'var(--gauge-mark)' }: { deg: number; len: number; width?: number; tail?: number; color?: string }) {
  return (
    <g transform={`rotate(${deg} ${CX} ${CY})`}>
      <polygon points={`${CX},${CY - len} ${CX + width / 2},${CY - len + 18} ${CX + width / 2},${CY + tail} ${CX - width / 2},${CY + tail} ${CX - width / 2},${CY - len + 18}`} fill={color} />
      <circle cx={CX} cy={CY} r={5} fill={color} />
    </g>
  );
}

function Ticks({ from, to, step, r, len, width = 1.5, color = 'var(--gauge-mark)' }: { from: number; to: number; step: number; r: number; len: number; width?: number; color?: string }) {
  const out: number[] = [];
  for (let d = from; d <= to + 1e-6; d += step) out.push(d);
  return (
    <g stroke={color} strokeWidth={width} strokeLinecap="round">
      {out.map((d) => {
        const a = at(d, r);
        const b = at(d, r - len);
        return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
    </g>
  );
}

/* airspeed: 40 to 200 knots around most of the dial */
const ASI_MIN = 40;
const ASI_MAX = 200;
const asiDeg = (kt: number) => 30 + ((Math.min(ASI_MAX, Math.max(ASI_MIN, kt)) - ASI_MIN) / (ASI_MAX - ASI_MIN)) * 300;

function AsiFace({ kt }: { kt: number }) {
  const majors: number[] = [];
  for (let s = ASI_MIN; s <= ASI_MAX; s += 20) majors.push(s);
  return (
    <g>
      {majors.map((s) => {
        const a = at(asiDeg(s), R_FACE - 4);
        const b = at(asiDeg(s), R_FACE - 14);
        const t = at(asiDeg(s), R_FACE - 28);
        return (
          <g key={s}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gauge-mark)" strokeWidth="2.5" strokeLinecap="round" />
            <text x={t.x} y={t.y + 5.5} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--gauge-mark)">{s}</text>
          </g>
        );
      })}
      {majors.slice(0, -1).map((s) => {
        const a = at(asiDeg(s + 10), R_FACE - 4);
        const b = at(asiDeg(s + 10), R_FACE - 10);
        return <line key={s} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gauge-mark-2)" strokeWidth="1.5" />;
      })}
      <text x={CX} y={CY + 36} textAnchor="middle" fontSize="11" fill="var(--gauge-mark-2)">KNOTS</text>
      <Needle deg={asiDeg(kt)} len={78} />
    </g>
  );
}

/* attitude: the horizon moves, the little airplane does not */
function AiFace({ bank, pitch }: { bank: number; pitch: number }) {
  const r = R_FACE - 2;
  const pitchPx = Math.max(-40, Math.min(40, pitch * 2.4));
  const ladder = [-20, -15, -10, -5, 5, 10, 15, 20];
  return (
    <g>
      <clipPath id="ai-clip"><circle cx={CX} cy={CY} r={r} /></clipPath>
      <g clipPath="url(#ai-clip)">
        {/* right bank: the horizon tilts up on the right; climb: the horizon drops */}
        <g transform={`rotate(${-bank} ${CX} ${CY}) translate(0 ${pitchPx})`}>
          <rect x={CX - 200} y={CY - 300} width={400} height={300} fill="var(--gauge-sky)" />
          <rect x={CX - 200} y={CY} width={400} height={300} fill="var(--gauge-ground)" />
          <line x1={CX - 200} y1={CY} x2={CX + 200} y2={CY} stroke="var(--gauge-mark)" strokeWidth="2" />
          {ladder.map((p) => {
            const w = p % 10 === 0 ? 22 : 11;
            const y = CY - p * 2.4;
            return <line key={p} x1={CX - w} y1={y} x2={CX + w} y2={y} stroke="var(--gauge-mark)" strokeWidth="1.5" />;
          })}
          {/* bank scale on the gyro, read against the fixed index at the top */}
          {[-60, -30, -20, -10, 0, 10, 20, 30, 60].map((d) => {
            const a = at(d, r - 2);
            const b = at(d, r - (d % 30 === 0 ? 12 : 7));
            return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gauge-mark)" strokeWidth={d === 0 ? 3 : 2} />;
          })}
          {[-45, 45].map((d) => {
            const a = at(d, r - 2);
            const b = at(d, r - 9);
            return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gauge-mark)" strokeWidth="2" />;
          })}
        </g>
      </g>
      {/* fixed bank index */}
      <polygon points={`${CX},${CY - r + 12} ${CX - 6},${CY - r + 1} ${CX + 6},${CY - r + 1}`} fill="var(--gauge-index)" />
      {/* miniature airplane */}
      <g fill="var(--gauge-index)" stroke="var(--gauge-face)" strokeWidth="1">
        <rect x={CX - 46} y={CY - 2.5} width={30} height={5} rx="1" />
        <rect x={CX + 16} y={CY - 2.5} width={30} height={5} rx="1" />
        <circle cx={CX} cy={CY} r={4.5} />
      </g>
    </g>
  );
}

/* altimeter: three hands over 0 to 9 */
function AltFace({ ft }: { ft: number }) {
  const f = Math.max(0, ft);
  const hundreds = ((f % 1000) / 1000) * 360;
  const thousands = ((f % 10000) / 10000) * 360;
  const tenThousands = ((f % 100000) / 100000) * 360;
  return (
    <g>
      <Ticks from={0} to={342} step={18} r={R_FACE - 4} len={6} color="var(--gauge-mark-2)" />
      {Array.from({ length: 10 }, (_, i) => {
        const a = at(i * 36, R_FACE - 4);
        const b = at(i * 36, R_FACE - 14);
        const t = at(i * 36, R_FACE - 28);
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gauge-mark)" strokeWidth="2.5" strokeLinecap="round" />
            <text x={t.x} y={t.y + 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--gauge-mark)">{i}</text>
          </g>
        );
      })}
      <text x={CX} y={CY + 40} textAnchor="middle" fontSize="10" fill="var(--gauge-mark-2)">ALT</text>
      <text x={CX} y={CY + 52} textAnchor="middle" fontSize="9" fill="var(--gauge-mark-2)">FEET</text>
      {/* ten-thousands: a thin hand with a small triangle at the rim */}
      <g transform={`rotate(${tenThousands} ${CX} ${CY})`}>
        <line x1={CX} y1={CY} x2={CX} y2={CY - 82} stroke="var(--gauge-mark)" strokeWidth="1.5" />
        <polygon points={`${CX},${CY - 74} ${CX - 5},${CY - 84} ${CX + 5},${CY - 84}`} fill="var(--gauge-mark)" />
      </g>
      <Needle deg={thousands} len={50} width={9} tail={10} />
      <Needle deg={hundreds} len={78} width={4} tail={14} />
    </g>
  );
}

/* turn coordinator: the airplane banks to show rate, the ball shows quality */
function TcFace({ rate }: { rate: number }) {
  const deg = Math.max(-2, Math.min(2, rate)) * 20;
  const marks = [-20, 0, 20];
  return (
    <g>
      {marks.map((d) => {
        const left = at(-90 + d, R_FACE - 4);
        const leftIn = at(-90 + d, R_FACE - 16);
        const right = at(90 - d, R_FACE - 4);
        const rightIn = at(90 - d, R_FACE - 16);
        return (
          <g key={d} stroke="var(--gauge-mark)" strokeWidth="3" strokeLinecap="round">
            <line x1={left.x} y1={left.y} x2={leftIn.x} y2={leftIn.y} />
            <line x1={right.x} y1={right.y} x2={rightIn.x} y2={rightIn.y} />
          </g>
        );
      })}
      <text x={CX - 60} y={CY + 34} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--gauge-mark)">L</text>
      <text x={CX + 60} y={CY + 34} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--gauge-mark)">R</text>
      <text x={CX} y={CY - 44} textAnchor="middle" fontSize="10" fill="var(--gauge-mark-2)">2 MIN</text>
      <text x={CX} y={CY + 76} textAnchor="middle" fontSize="8" fill="var(--gauge-mark-2)">NO PITCH INFORMATION</text>
      {/* the airplane */}
      <g transform={`rotate(${deg} ${CX} ${CY})`} fill="var(--gauge-mark)">
        <rect x={CX - 56} y={CY - 2.5} width={112} height={5} rx="2" />
        <rect x={CX - 3} y={CY - 22} width={6} height={30} rx="2" />
        <rect x={CX - 12} y={CY + 4} width={24} height={4} rx="1.5" />
        <circle cx={CX} cy={CY} r={6} />
      </g>
      {/* inclinometer: the ball stays centered, coordination is not in the data */}
      <path d={`M${CX - 34},${CY + 48} Q${CX},${CY + 62} ${CX + 34},${CY + 48}`} fill="none" stroke="var(--gauge-mark-2)" strokeWidth="12" strokeLinecap="round" />
      <path d={`M${CX - 34},${CY + 48} Q${CX},${CY + 62} ${CX + 34},${CY + 48}`} fill="none" stroke="var(--gauge-face)" strokeWidth="9" strokeLinecap="round" />
      <line x1={CX - 6} y1={CY + 49} x2={CX - 6} y2={CY + 61} stroke="var(--gauge-mark)" strokeWidth="1.5" />
      <line x1={CX + 6} y1={CY + 49} x2={CX + 6} y2={CY + 61} stroke="var(--gauge-mark)" strokeWidth="1.5" />
      <circle cx={CX} cy={CY + 55} r={3.8} fill="var(--gauge-mark)" />
    </g>
  );
}

const CARD = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];

/* heading indicator: the card turns, the airplane stays */
function HiFace({ heading }: { heading: number }) {
  return (
    <g>
      <g transform={`rotate(${-norm(heading)} ${CX} ${CY})`}>
        <Ticks from={0} to={355} step={5} r={R_FACE - 4} len={5} width={1} color="var(--gauge-mark-2)" />
        <Ticks from={0} to={350} step={10} r={R_FACE - 4} len={9} width={1.5} />
        {CARD.map((c, i) => {
          const t = at(i * 30, R_FACE - 24);
          return (
            <text key={c} x={t.x} y={t.y} textAnchor="middle" dominantBaseline="central" fontSize={/^[NESW]$/.test(c) ? 17 : 14} fontWeight="700" fill="var(--gauge-mark)" transform={`rotate(${i * 30} ${t.x} ${t.y})`}>{c}</text>
          );
        })}
      </g>
      {/* lubber line */}
      <polygon points={`${CX},${CY - R_FACE + 12} ${CX - 5},${CY - R_FACE + 1} ${CX + 5},${CY - R_FACE + 1}`} fill="var(--gauge-index)" />
      {/* the airplane */}
      <g fill="var(--gauge-index)" opacity="0.95">
        <rect x={CX - 2.5} y={CY - 30} width={5} height={54} rx="2" />
        <rect x={CX - 32} y={CY - 8} width={64} height={5} rx="2" />
        <rect x={CX - 11} y={CY + 18} width={22} height={4} rx="1.5" />
      </g>
    </g>
  );
}

/* vertical speed: zero at the left, climb clockwise */
const vsiDeg = (fpm: number) => -90 + (Math.max(-2000, Math.min(2000, fpm)) / 2000) * 160;

function VsiFace({ fpm }: { fpm: number }) {
  const labeled = [-2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000];
  return (
    <g>
      {labeled.map((v) => {
        const a = at(vsiDeg(v), R_FACE - 4);
        const b = at(vsiDeg(v), R_FACE - (v % 1000 === 0 ? 14 : 9));
        const t = at(vsiDeg(v), R_FACE - 28);
        return (
          <g key={v}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gauge-mark)" strokeWidth={v % 1000 === 0 ? 2.5 : 1.5} strokeLinecap="round" />
            {v % 1000 === 0 && <text x={t.x} y={t.y + 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--gauge-mark)">{Math.abs(v) / 1000}</text>}
          </g>
        );
      })}
      {[-1750, -1250, -750, -250, 250, 750, 1250, 1750].map((v) => {
        const a = at(vsiDeg(v), R_FACE - 4);
        const b = at(vsiDeg(v), R_FACE - 8);
        return <line key={v} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--gauge-mark-2)" strokeWidth="1" />;
      })}
      <text x={CX + 26} y={CY - 28} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--gauge-mark)">UP</text>
      <text x={CX + 26} y={CY + 38} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--gauge-mark)">DOWN</text>
      <text x={CX} y={CY + 58} textAnchor="middle" fontSize="9" fill="var(--gauge-mark-2)">VERTICAL SPEED</text>
      <text x={CX} y={CY + 69} textAnchor="middle" fontSize="8" fill="var(--gauge-mark-2)">100 FEET PER MINUTE</text>
      <Needle deg={vsiDeg(fpm)} len={78} />
    </g>
  );
}

/* the compass: a card seen from behind, so the numbers run the other way */
function CompassFace({ heading }: { heading: number }) {
  const W = 320;
  const H = 96;
  const cx = W / 2;
  const pxPerDeg = 3.4;
  const h = norm(heading);
  const ticks: { d: number; x: number }[] = [];
  // A wet compass card is read from its back: headings to the right of the lubber line are smaller.
  for (let d = Math.ceil((h - 45) / 5) * 5; d <= h + 45; d += 5) ticks.push({ d: norm(d) % 360, x: cx - (d - h) * pxPerDeg });
  return (
    <g>
      <rect x="0" y="0" width={W} height={H} rx="14" fill="var(--gauge-bezel)" />
      <rect x="10" y="10" width={W - 20} height={H - 20} rx="8" fill="var(--gauge-face)" />
      <clipPath id="compass-clip"><rect x="14" y="12" width={W - 28} height={H - 24} rx="6" /></clipPath>
      <g clipPath="url(#compass-clip)">
        {ticks.map((t) => {
          const major = t.d % 30 === 0;
          const mid = t.d % 10 === 0;
          const label = major ? CARD[Math.round(t.d / 30) % 12] : '';
          return (
            <g key={t.d}>
              <line x1={t.x} y1={H - 22} x2={t.x} y2={H - 22 - (major ? 20 : mid ? 14 : 8)} stroke={major ? 'var(--gauge-mark)' : 'var(--gauge-mark-2)'} strokeWidth={major ? 2.5 : 1.5} strokeLinecap="round" />
              {label && <text x={t.x} y={38} textAnchor="middle" fontSize={/^[NESW]$/.test(label) ? 22 : 18} fontWeight="700" fill="var(--gauge-mark)">{label}</text>}
            </g>
          );
        })}
      </g>
      <line x1={cx} y1={12} x2={cx} y2={H - 12} stroke="var(--gauge-index)" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

/** A sticky note slapped over the face, the way a pilot covers a failed gyro. */
function Cover({ wide }: { wide: boolean }) {
  const w = wide ? 150 : 128;
  const h = wide ? 64 : 112;
  const x = wide ? 85 : 36;
  const y = wide ? 16 : 44;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g transform={`rotate(${wide ? -3 : -7} ${cx} ${cy})`}>
      <rect x={x + 3} y={y + 4} width={w} height={h} rx="3" fill="var(--gauge-face)" opacity="0.5" />
      <rect x={x} y={y} width={w} height={h} rx="3" fill="var(--taxi)" stroke="var(--on-taxi)" strokeWidth="1.5" />
      <text x={cx} y={cy + 7} textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--on-taxi)">Covered</text>
    </g>
  );
}

/* ---------- carburetor icing chart, PHAK figure 7-12 ---------- */

/** The chart's own tick labels, Celsius to Fahrenheit, as the PHAK prints them. */
const TICK_F: Record<number, number> = { [-7]: 20, 0: 32, 21: 70, 38: 100 };

export function CarbIceFigure({ figure }: { figure: CarbIce }) {
  return (
    <figure className="fig">
      <CarbIceChart figure={figure} />
      <figcaption>
        The carburetor icing chart from the PHAK (FAA-H-8083-25C, figure 7-12), with today's air on it: {figure.tempC} °C with a dew point of {figure.dewC} °C is {figure.rhPct} percent relative humidity, which the chart calls {CARB_ICE_LABEL[figure.risk].toLowerCase()}. The zones show where ice is most likely, not where it stops; the PHAK notes that carburetor ice can form outside them too.
      </figcaption>
    </figure>
  );
}

function CarbIceChart({ figure }: { figure: CarbIce }) {
  const W = 480;
  const H = 330;
  const L = 54;
  const R = W - 18;
  const T = 22;
  const B = H - 64;
  const T_MIN = -10;
  const T_MAX = 40;
  const RH_MIN = 40;
  const RH_MAX = 100;
  const x = (c: number) => L + ((c - T_MIN) / (T_MAX - T_MIN)) * (R - L);
  const y = (rh: number) => B - ((rh - RH_MIN) / (RH_MAX - RH_MIN)) * (B - T);
  const tempTicks = [-7, 0, 21, 38];
  const rhTicks = [40, 50, 60, 70, 80, 90, 100];
  const clampedT = Math.max(T_MIN, Math.min(T_MAX, figure.tempC));
  const clampedRh = Math.max(RH_MIN, Math.min(RH_MAX, figure.rhPct));
  const offChart = clampedT !== figure.tempC || clampedRh !== figure.rhPct;
  const px = x(clampedT);
  const py = y(clampedRh);
  const labelRight = px < (L + R) / 2;
  const lx = px + (labelRight ? 14 : -14);
  const ly = Math.max(T + 26, Math.min(B - 30, py));
  const title = `Carburetor icing chart. Today: ${figure.tempC} degrees Celsius, dew point ${figure.dewC}, ${figure.rhPct} percent relative humidity: ${CARB_ICE_LABEL[figure.risk]}.`;
  return (
    <div className="carb">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <rect x={L} y={T} width={R - L} height={B - T} fill="var(--apron)" />
        {/* grid */}
        <g stroke="var(--line-soft)" strokeWidth="1">
          {rhTicks.map((rh) => <line key={rh} x1={L} y1={y(rh)} x2={R} y2={y(rh)} />)}
          {tempTicks.map((c) => <line key={c} x1={x(c)} y1={T} x2={x(c)} y2={B} />)}
        </g>
        {/* possible: -7 to 38 °C above 50 percent */}
        <rect x={x(-7)} y={y(100)} width={x(38) - x(-7)} height={y(50) - y(100)} fill="var(--taxi-tint)" stroke="var(--taxi-ink)" strokeWidth="1.2" strokeDasharray="4 3" />
        {/* high: -7 to 21 °C above 80 percent */}
        <rect x={x(-7)} y={y(100)} width={x(21) - x(-7)} height={y(80) - y(100)} fill="var(--sock-tint)" stroke="var(--sock-ink)" strokeWidth="1.5" />
        <text x={x(-7) + 10} y={y(100) + 20} fontSize="15" fontWeight="700" fill="var(--sock-ink)">High carburetor</text>
        <text x={x(-7) + 10} y={y(100) + 36} fontSize="15" fontWeight="700" fill="var(--sock-ink)">icing potential</text>
        <text x={x(38) - 10} y={y(50) - 12} textAnchor="end" fontSize="15" fontWeight="700" fill="var(--taxi-ink)">Carburetor icing possible</text>
        {/* axes */}
        <line x1={L} y1={B} x2={R} y2={B} stroke="var(--ink-2)" strokeWidth="1.5" />
        <line x1={L} y1={T} x2={L} y2={B} stroke="var(--ink-2)" strokeWidth="1.5" />
        {tempTicks.map((c) => (
          <g key={c}>
            <line x1={x(c)} y1={B} x2={x(c)} y2={B + 6} stroke="var(--ink-2)" strokeWidth="1.5" />
            <text x={x(c)} y={B + 21} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--ink)">{c} °C</text>
            <text x={x(c)} y={B + 38} textAnchor="middle" fontSize="13" fill="var(--ink-2)">{TICK_F[c]} °F</text>
          </g>
        ))}
        {rhTicks.map((rh) => (
          <g key={rh}>
            <line x1={L - 6} y1={y(rh)} x2={L} y2={y(rh)} stroke="var(--ink-2)" strokeWidth="1.5" />
            <text x={L - 10} y={y(rh) + 5} textAnchor="end" fontSize="14" fill="var(--ink)">{rh}</text>
          </g>
        ))}
        <text x={(L + R) / 2} y={H - 8} textAnchor="middle" fontSize="14" fill="var(--ink-2)">Outside air temperature</text>
        <text x={14} y={(T + B) / 2} textAnchor="middle" fontSize="14" fill="var(--ink-2)" transform={`rotate(-90 14 ${(T + B) / 2})`}>Relative humidity, percent</text>
        {/* today */}
        <line x1={px} y1={py} x2={px} y2={B} stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 3" />
        <circle cx={px} cy={py} r={7} fill="var(--ink)" stroke="var(--panel)" strokeWidth="2.5" />
        <text x={lx} y={ly - 2} textAnchor={labelRight ? 'start' : 'end'} fontSize="15" fontWeight="800" fill="var(--ink)">Today: {CARB_ICE_LABEL[figure.risk]}</text>
        <text x={lx} y={ly + 15} textAnchor={labelRight ? 'start' : 'end'} fontSize="13" fill="var(--ink-2)">{figure.tempC} °C, dew point {figure.dewC} °C, {figure.rhPct} % RH{offChart ? ', drawn at the chart edge' : ''}</text>
      </svg>
    </div>
  );
}
