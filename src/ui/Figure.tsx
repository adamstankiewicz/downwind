// A lesson figure: the raw report, the runway with the wind on it, the
// forecast laid against the flight, the practice sectional, a performance
// chart with the reading marked, a nav log, or the glide circle. Every lesson
// figure is practice material built for the lesson, and says so.

import type { Figure as FigureModel, PerfChartId, RecordColumn, RecordRow, RecordsVariant } from '../course/types';
import { readTable, type Performance, type PerfTable } from '../lib/perf';
import type { NavLog } from '../lib/nav';
import { parseTaf } from '../lib/taf';
import { norm } from '../lib/wind';
import { RawReport } from './MetarBlock';
import { SectionalChart } from './SectionalChart';
import { TafTimeline } from './TafTimeline';
import { WindDiagram } from './WindDiagram';

const fmt = (n: number) => n.toLocaleString('en-US');
const pad3 = (n: number) => String(Math.round(norm(n))).padStart(3, '0');

export function Figure({ figure, practiceField }: { figure: FigureModel; practiceField: boolean }) {
  if (figure.kind === 'metar') {
    const station = figure.raw.split(' ').find((t) => /^[A-Z0-9]{4}$/.test(t) && !/^(METAR|SPECI)$/.test(t)) ?? '';
    const special = /^SPECI/.test(figure.raw);
    return (
      <figure className="fig">
        <RawReport raw={figure.raw} label={`${special ? 'SPECI' : 'METAR'} ${station}`} marks={figure.marks} />
        <figcaption>Practice weather written for this lesson{practiceField ? ', at a practice field that is not a real airport' : ''}.{figure.marks?.length ? ' Underlined groups are the ones this step is about.' : ''}</figcaption>
      </figure>
    );
  }
  if (figure.kind === 'taf') {
    const taf = parseTaf(figure.raw);
    const hours = Math.max(1, Math.round((figure.returnAt.getTime() - figure.departure.getTime()) / 3_600_000));
    return (
      <figure className="fig">
        <RawReport raw={figure.raw} label={`TAF ${taf.station}`} />
        <TafTimeline taf={taf} departure={figure.departure} tripHours={hours} />
        <figcaption>Practice forecast written for this lesson. The shaded window is your flight, departure to return.</figcaption>
      </figure>
    );
  }
  if (figure.kind === 'chart') {
    const legs = figure.route && figure.route.length > 1 ? `${figure.route.join(' to ')}. ` : '';
    return (
      <figure className="fig">
        <div className="fig-chart">
          <SectionalChart route={figure.route} highlight={figure.highlight} focus={figure.focus} marker={figure.marker} maxHeight={520} />
        </div>
        <figcaption>
          The practice sectional, a made-up stretch of country around KXYZ. {legs}Blue is towered and the airspace around towers; the orange here stands for the chart's magenta: untowered fields, Class C and the Class E edge. Not a real chart.
        </figcaption>
      </figure>
    );
  }
  if (figure.kind === 'perf') {
    return (
      <figure className="fig">
        <PerfTableFigure chart={figure.chart} performance={figure.performance} paFt={figure.paFt} oatC={figure.oatC} />
        <figcaption>
          {PERF_TITLE[figure.chart]}. The four shaded cells are the corners the reading interpolates between.{' '}
          {figure.sample ? "Sample chart for teaching, not any manufacturer's data. Use your POH." : 'From your airplane’s performance tables.'}
        </figcaption>
      </figure>
    );
  }
  if (figure.kind === 'navlog') {
    return (
      <figure className="fig">
        <NavLogTable log={figure.log} />
        <figcaption>
          Nav log{figure.altitudeMsl ? ` at ${fmt(figure.altitudeMsl)} ft` : ''}. TC true course, WCA wind correction angle, TH true heading, MH magnetic heading, GS groundspeed. Time in minutes, fuel in gallons.
        </figcaption>
      </figure>
    );
  }
  if (figure.kind === 'records') {
    return (
      <figure className="fig">
        <RecordsFigure variant={figure.variant} title={figure.title} columns={figure.columns} rows={figure.rows} />
        <figcaption>{figure.caption}</figcaption>
      </figure>
    );
  }
  if (figure.kind === 'glide') {
    const wind = figure.windKt && figure.windFromTrue !== undefined ? ` Wind from ${pad3(figure.windFromTrue)} true at ${figure.windKt} kt moves the circle downwind; it is sketched for a glide at about a mile a minute.` : '';
    return (
      <figure className="fig">
        <GlideDiagram heightAglFt={figure.heightAglFt} rangeNm={figure.rangeNm} windFromTrue={figure.windFromTrue} windKt={figure.windKt} fields={figure.fields} />
        <figcaption>
          Glide range from {fmt(figure.heightAglFt)} ft above the ground: about {figure.rangeNm} nm, true north up.{wind} Filled fields are the ones you reach with a pattern in hand; open ones you do not.
        </figcaption>
      </figure>
    );
  }
  const { airport, windMag, speedKt, gustKt, runwayId } = figure;
  const runway = airport.runways.find((r) => r.id === runwayId) ?? airport.runways[0];
  const wind = { dirTrue: norm(windMag + airport.magneticVariationDeg) || 360, speedKt, gustKt, variable: false, rangeTrue: null };
  return (
    <figure className="fig">
      <div className="fig-wind">
        <WindDiagram airport={airport} wind={wind} rw={{ runway, windMag, steady: null, gust: null }} />
      </div>
      <figcaption>
        Runway {runway.id} with the wind drawn at {String(windMag).padStart(3, '0')}° magnetic, {speedKt} kt{gustKt ? `, gusting ${gustKt}` : ''}. Magnetic north is up.
      </figcaption>
    </figure>
  );
}

/* ---------- performance chart: a POH table with the reading marked ---------- */

export const PERF_TITLE: Record<PerfChartId, string> = {
  'takeoff-roll': 'Takeoff ground roll, ft',
  'takeoff-50': 'Takeoff distance over a 50 ft obstacle, ft',
  'landing-roll': 'Landing ground roll, ft',
  'landing-50': 'Landing distance over a 50 ft obstacle, ft',
  climb: 'Rate of climb, ft per minute',
};

export function perfTableFor(p: Performance, chart: PerfChartId): PerfTable {
  switch (chart) {
    case 'takeoff-roll': return p.takeoff.groundRoll;
    case 'takeoff-50': return p.takeoff.over50;
    case 'landing-roll': return p.landing.groundRoll;
    case 'landing-50': return p.landing.over50;
    case 'climb': return p.climbFpm;
  }
}

export function PerfTableFigure({ chart, performance, paFt, oatC }: { chart: PerfChartId; performance: Performance; paFt: number; oatC: number }) {
  const t = perfTableFor(performance, chart);
  const read = readTable(t, paFt, oatC);
  const isCorner = (pa: number, temp: number) => read.corners.some((c) => c.paFt === pa && c.tempC === temp);
  const unit = chart === 'climb' ? 'fpm' : 'ft';
  const cornerRows = [...new Set(read.corners.map((c) => c.paFt))];
  const cornerCols = [...new Set(read.corners.map((c) => c.tempC))];
  return (
    <div className="perf">
      <div className="perf-head">
        <b>{PERF_TITLE[chart]}</b>
        <span className="muted">Pressure altitude down, outside air temperature across</span>
      </div>
      <div className="table-scroll">
        <table className="perf-table">
          <thead>
            <tr>
              <th scope="col"><span className="muted">PA ft</span> <span className="vh">by</span> <span className="muted">°C</span></th>
              {t.tempsC.map((c) => <th key={c} scope="col" className={cornerCols.includes(c) ? 'on' : ''}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {t.pressureAltsFt.map((pa, ri) => (
              <tr key={pa}>
                <th scope="row" className={cornerRows.includes(pa) ? 'on' : ''}>{fmt(pa)}</th>
                {t.tempsC.map((c, ci) => (
                  <td key={c} className={isCorner(pa, c) ? 'corner' : ''}>{fmt(t.values[ri][ci])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="perf-read">
        <span>At {fmt(Math.round(paFt))} ft pressure altitude and {Math.round(oatC)} °C</span>
        <b className="runway">{fmt(Math.round(read.value))} <small>{unit}</small></b>
        {read.offChart && <span className="perf-off">Off the chart: the value shown is the edge of the table, not an answer.</span>}
      </div>
    </div>
  );
}

/* ---------- nav log ---------- */

const minutes = (m: number) => (Number.isFinite(m) ? String(m) : 'n/a');

export function NavLogTable({ log }: { log: NavLog }) {
  return (
    <div className="table-scroll">
      <table className="navlog">
        <thead>
          <tr>
            <th scope="col">Leg</th>
            <th scope="col" className="num">TC</th>
            <th scope="col" className="num">WCA</th>
            <th scope="col" className="num">TH</th>
            <th scope="col" className="num">MH</th>
            <th scope="col" className="num">nm</th>
            <th scope="col" className="num">GS</th>
            <th scope="col" className="num">min</th>
            <th scope="col" className="num">gal</th>
          </tr>
        </thead>
        <tbody>
          {log.legs.map((l, i) => (
            <tr key={i}>
              <th scope="row"><span className="leg-from">{l.from.id}</span> to <span className="leg-to">{l.to.id}</span><small>{l.to.name}</small></th>
              <td className="num mono">{pad3(l.trueCourse)}</td>
              <td className="num mono">{l.wcaDeg === 0 ? '0' : `${l.wcaDeg > 0 ? '+' : ''}${l.wcaDeg}`}</td>
              <td className="num mono">{pad3(l.trueHeading)}</td>
              <td className="num mono"><b>{pad3(l.magHeading)}</b></td>
              <td className="num mono">{l.distanceNm.toFixed(1)}</td>
              <td className="num mono">{l.groundspeedKt}</td>
              <td className="num mono">{minutes(l.minutes)}</td>
              <td className="num mono">{l.fuelGal.toFixed(1)}</td>
            </tr>
          ))}
          {log.legs.length === 0 && (
            <tr><td colSpan={9} className="muted">No legs yet. A route needs two points.</td></tr>
          )}
        </tbody>
        {log.legs.length > 0 && (
          <tfoot>
            <tr className="total">
              <th scope="row">Total</th>
              <td colSpan={4} />
              <td className="num mono">{log.totalNm.toFixed(1)}</td>
              <td />
              <td className="num mono">{minutes(log.totalMin)}</td>
              <td className="num mono">{log.totalFuelGal.toFixed(1)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/* ---------- records: a page of paperwork made up for the lesson ----------
   One table for all four variants; the variant is a modifier class on the
   wrapper. Each record is its own <tbody> so a row and the remark under it
   travel together and a focus mark covers both. */

export function RecordsFigure({ variant, title, columns, rows }: {
  variant: RecordsVariant; title: string; columns: RecordColumn[]; rows: RecordRow[];
}) {
  return (
    <div className={`records ${variant}`}>
      <div className="table-scroll">
        <table className="records-table">
          <caption>{title}</caption>
          <thead>
            <tr>
              {columns.map((c, i) => <th key={i} scope="col" className={c.num ? 'num' : undefined}>{c.label}</th>)}
            </tr>
          </thead>
          {rows.map((row, ri) => (
            <tbody key={ri} className={`rec${row.focus ? ' focus' : ''}${row.note ? ' noted' : ''}`}>
              <tr>
                {columns.map((c, ci) => {
                  const text = row.cells[ci] ?? '';
                  const cls = c.num ? 'num mono' : undefined;
                  return ci === 0 ? (
                    <th key={ci} scope="row" className={cls} data-label={c.label}>
                      {row.focus && <span className="vh">This step is about this line. </span>}
                      {text}
                    </th>
                  ) : (
                    <td key={ci} className={cls} data-label={c.label}>{text}</td>
                  );
                })}
              </tr>
              {row.note && (
                <tr className="rec-note">
                  <td colSpan={columns.length}>{row.note}</td>
                </tr>
              )}
            </tbody>
          ))}
          {rows.length === 0 && (
            <tbody><tr><td colSpan={columns.length} className="muted">No entries on this page.</td></tr></tbody>
          )}
        </table>
      </div>
    </div>
  );
}

/* ---------- glide circle, top down ---------- */

export function GlideDiagram({ heightAglFt, rangeNm, windFromTrue, windKt, fields }: {
  heightAglFt: number; rangeNm: number; windFromTrue?: number; windKt?: number;
  fields: { name: string; bearingTrue: number; distanceNm: number; reachable: boolean }[];
}) {
  const W = 420;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2;
  const wind = windKt && windFromTrue !== undefined ? { from: windFromTrue, kt: windKt } : null;
  // The circle drifts downwind: sketched at a mile a minute, so the shift is the wind's share of the range.
  const shiftNm = wind ? rangeNm * Math.min(0.6, wind.kt / 60) : 0;
  const downwind = wind ? norm(wind.from + 180) : 0;
  const reach = Math.max(rangeNm + shiftNm, ...fields.map((f) => f.distanceNm), 1) * 1.18;
  const px = (W / 2 - 24) / reach;
  const pt = (brg: number, nmDist: number) => {
    const r = (brg * Math.PI) / 180;
    return { x: cx + Math.sin(r) * nmDist * px, y: cy - Math.cos(r) * nmDist * px };
  };
  const shifted = pt(downwind, shiftNm);
  const ringStep = reach > 12 ? 5 : reach > 6 ? 2 : 1;
  const rings: number[] = [];
  for (let r = ringStep; r < reach; r += ringStep) rings.push(r);
  const windTail = wind ? pt(wind.from, reach * 0.92) : null;
  const windHead = wind ? pt(wind.from, reach * 0.72) : null;

  return (
    <div className="fig-glide">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Glide range ${rangeNm} nm from ${fmt(heightAglFt)} ft above the ground. ${fields.map((f) => `${f.name} ${f.distanceNm} nm ${f.reachable ? 'reachable' : 'out of reach'}`).join(', ')}.`}>
        <rect width={W} height={H} fill="var(--apron)" rx="12" />
        {rings.map((r) => (
          <g key={r}>
            <circle cx={cx} cy={cy} r={r * px} fill="none" stroke="var(--line)" strokeWidth="1" />
            <text x={cx + 4} y={cy - r * px - 3} fontSize="11" fill="var(--ink-2)">{r} nm</text>
          </g>
        ))}
        {/* still-air circle, then the one the wind moves */}
        {wind && <circle cx={cx} cy={cy} r={rangeNm * px} fill="none" stroke="var(--ink-2)" strokeWidth="1.2" strokeDasharray="5 4" />}
        <circle cx={shifted.x} cy={shifted.y} r={rangeNm * px} fill="var(--sky-tint)" fillOpacity="0.7" stroke="var(--sky-ink)" strokeWidth="2" />
        {wind && windTail && windHead && (
          <g>
            <line x1={windTail.x} y1={windTail.y} x2={windHead.x} y2={windHead.y} stroke="var(--sock)" strokeWidth="3.5" strokeLinecap="round" />
            {(() => {
              const a = ((downwind) * Math.PI) / 180;
              const hx = windHead.x; const hy = windHead.y;
              const bx = hx - Math.sin(a) * 10; const by = hy + Math.cos(a) * 10;
              const px2 = Math.cos(a) * 6; const py2 = Math.sin(a) * 6;
              return <polygon points={`${hx},${hy} ${bx + px2},${by + py2} ${bx - px2},${by - py2}`} fill="var(--sock)" />;
            })()}
            <text x={windTail.x} y={windTail.y + (windTail.y < cy ? -8 : 16)} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--sock-ink)">{pad3(wind.from)} at {wind.kt} kt</text>
          </g>
        )}
        {fields.map((f) => {
          const q = pt(f.bearingTrue, f.distanceNm);
          const right = q.x <= cx;
          return (
            <g key={f.name}>
              <circle cx={q.x} cy={q.y} r="7" fill={f.reachable ? 'var(--right)' : 'var(--panel)'} stroke={f.reachable ? 'var(--right)' : 'var(--unsafe)'} strokeWidth="2.5" />
              {!f.reachable && <path d={`M${q.x - 3},${q.y - 3} l6,6 M${q.x + 3},${q.y - 3} l-6,6`} stroke="var(--unsafe)" strokeWidth="2" strokeLinecap="round" />}
              <text x={q.x + (right ? 11 : -11)} y={q.y - 1} textAnchor={right ? 'start' : 'end'} fontSize="12" fontWeight="700" fill="var(--ink)">{f.name}</text>
              <text x={q.x + (right ? 11 : -11)} y={q.y + 12} textAnchor={right ? 'start' : 'end'} fontSize="11" fill="var(--ink-2)">{f.distanceNm} nm, {pad3(f.bearingTrue)}°</text>
            </g>
          );
        })}
        {/* the airplane */}
        <path transform={`translate(${cx} ${cy}) scale(1.4)`} d="M0,-9 L2,-3 L10,1 L10,3 L2,1.5 L1.5,6 L4,8 L4,9 L0,8 L-4,9 L-4,8 L-1.5,6 L-2,1.5 L-10,3 L-10,1 L-2,-3 Z" fill="var(--ink)" stroke="var(--apron)" strokeWidth="1" />
        <text x={cx} y={cy + 28} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">{fmt(heightAglFt)} ft AGL</text>
        <text x={12} y={H - 12} fontSize="11" fill="var(--ink-2)">True north up. Glide range {rangeNm} nm{wind ? ', moved downwind by the wind' : ', still air'}.</text>
      </svg>
    </div>
  );
}
