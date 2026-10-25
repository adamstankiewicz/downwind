// A lesson figure: the raw report, the runway with the wind on it, the
// forecast laid against the flight, the practice sectional, a performance
// chart with the reading marked, a nav log, or the glide circle. Every lesson
// figure is practice material built for the lesson, and says so.

import type { AirportSign } from '../lib/airportOps';
import type { Figure as FigureModel, PerfChartId, RecordColumn, RecordRow, RecordsVariant } from '../course/types';
import { practiceRegion, withVolumes } from '../chart/practiceRegion';
import { readTable, type Performance, type PerfTable } from '../lib/perf';
import type { NavLog } from '../lib/nav';
import { parseTaf } from '../lib/taf';
import { norm } from '../lib/wind';
import { profileAlong } from '../scenarios/airspacePlan';
import { CgChart } from './CgChart';
import { RawReport } from './MetarBlock';
import { ProfileFigure } from './ProfileFigure';
import { SectionalChart } from './SectionalChart';
import { CarbIceFigure, ElectricalFigure, PanelFigure } from './SystemsFigures';
import { TafTimeline } from './TafTimeline';
import { TripMap } from './TripMap';
import { WindDiagram } from './WindDiagram';
import { SkyFigure } from './SkyFigure';

const fmt = (n: number) => n.toLocaleString('en-US');
const pad3 = (n: number) => String(Math.round(norm(n))).padStart(3, '0');

export function Figure({ figure, practiceField }: { figure: FigureModel; practiceField: boolean }) {
  if (figure.kind === 'metar') {
    const station = figure.raw.split(' ').find((t) => /^[A-Z0-9]{4}$/.test(t) && !/^(METAR|SPECI)$/.test(t)) ?? '';
    const special = /^SPECI/.test(figure.raw);
    return (
      <figure className="fig">
        <RawReport raw={figure.raw} label={`${special ? 'SPECI' : 'METAR'} ${station}`} marks={figure.marks} />
        <figcaption>{figure.turned ? 'Practice weather as you have turned it, written as a report' : 'Practice weather written for this lesson'}{practiceField ? ', at a practice field that is not a real airport' : ''}.{figure.marks?.length ? ' Underlined groups are the ones this step is about.' : ''}</figcaption>
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
    const place = (id: string) => practiceRegion.checkpoints.find((c) => c.id === id)?.name ?? id;
    const legs = figure.route && figure.route.length > 1 ? `${figure.route.map(place).join(' to ')}. ` : '';
    const extra = figure.extra ?? [];
    const tfr = extra.some((v) => v.cls === 'TFR');
    return (
      <figure className="fig">
        <div className="fig-chart">
          <SectionalChart region={withVolumes(practiceRegion, extra)} route={figure.route} highlight={figure.highlight} focus={figure.focus} marker={figure.marker} maxHeight={520} />
        </div>
        <figcaption>
          The practice sectional, a made-up stretch of country around KXYZ. {legs}Blue is towered and the airspace around towers; the orange here stands for the chart's magenta: untowered fields, Class C and the Class E edge.{tfr ? ' The TFR is drawn from the NOTAM; TFRs are not printed on sectionals.' : extra.length ? ` ${extra.map((v) => v.name).join(', ')}: drawn for this lesson, not printed on the chart.` : ''} Not a real chart.
        </figcaption>
      </figure>
    );
  }
  if (figure.kind === 'profile') {
    const profile = profileAlong(withVolumes(practiceRegion, figure.extra), figure);
    const alt = figure.airplaneAtNm !== undefined ? ' The airplane sits where you are now.' : '';
    const climbs = figure.legs.some((l) => l.altMsl !== figure.startAltMsl) || figure.legs.some((l, i) => i > 0 && l.altMsl !== figure.legs[i - 1].altMsl);
    return (
      <figure className="fig">
        <ProfileFigure profile={profile} marks={figure.marks} airplaneAtNm={figure.airplaneAtNm} />
        <figcaption>
          The practice sectional's airspace seen from the side along your path, the way an instructor sketches it: distance across, altitude up, the ground shaded. Each box is a floor and ceiling over the path, labeled in hundreds of feet as the chart prints them. The bold line is your planned altitude{climbs ? ', climbing or descending between legs' : ''}.{alt}{figure.extra?.length ? ' Volumes from the NOTAM are drawn too.' : ''} Not a real chart.
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
  if (figure.kind === 'tripMap') {
    return (
      <figure className="fig">
        <TripMap home={figure.home} points={figure.points} ringsNm={figure.ringsNm} route={figure.route} marker={figure.marker} label={`Plan view around ${figure.home.id}`} />
        <figcaption>
          Plan view from {figure.home.id}, true north up, to scale. Schematic: no terrain, airspace or obstacles, and not for navigation.{figure.practice ? ' Practice fields on a made-up chart.' : ' Plan the route on a current sectional.'}
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
  if (figure.kind === 'loadFactor') {
    return (
      <figure className="fig">
        <LoadFactorChart {...figure} />
        <figcaption>Stall speed rises with bank in a level turn: clean, and with the flaps down, against your approach speed. The dot is the bank in this step. {figure.sample ? 'Sample trainer speeds for teaching; use your POH.' : 'From your airplane\'s speeds.'}</figcaption>
      </figure>
    );
  }
  if (figure.kind === 'signs') {
    return (
      <figure className="fig">
        <SignsFigure signs={figure.signs} marking={figure.marking} />
        <figcaption>{figure.caption}</figcaption>
      </figure>
    );
  }
  if (figure.kind === 'electrical') return <ElectricalFigure figure={figure} />;
  if (figure.kind === 'panel') return <PanelFigure figure={figure} />;
  if (figure.kind === 'carbIce') return <CarbIceFigure figure={figure} />;
  if (figure.kind === 'wb') {
    const { loaded, maxGrossLb } = figure;
    const ok = loaded.withinEnvelope && !loaded.overGross;
    const diff = maxGrossLb - loaded.totalLb;
    const state = loaded.overGross ? `${fmt(-diff)} lb over max gross`
      : !loaded.withinEnvelope ? 'CG outside the envelope'
      : diff === 0 ? 'Inside the envelope, right at max gross' : `Inside the envelope, ${fmt(diff)} lb under max gross`;
    return (
      <figure className="fig">
        <div className="fig-wb">
          <div className="perf-head">
            <b>Weight and balance</b>
            <span className="muted">Weight up, CG arm across; the blue is the envelope</span>
          </div>
          <CgChart envelope={figure.envelope} loaded={loaded} zeroFuel={figure.zeroFuel} maxGrossLb={maxGrossLb} />
          <div className="perf-read">
            <b className="runway">{fmt(loaded.totalLb)} <small>lb</small></b>
            <span>CG {loaded.cgIn} in</span>
            <span className={`status ${ok ? 'ok' : 'bad'}`}>{state}</span>
          </div>
        </div>
        <figcaption>
          The loaded point is where the airplane sits now; the dashed line runs to the zero-fuel point, where the CG goes as fuel burns. Above the red line is over max gross.{' '}
          {figure.practice ? 'The practice trainer is a made-up airplane with sample numbers.' : figure.sample ? 'Sample numbers from the template. Use your own weight and balance record.' : 'From your airplane’s weight and balance record.'}
        </figcaption>
      </figure>
    );
  }
  if (figure.kind === 'sky') {
    return (
      <figure className="fig">
        <div className="fig-sky">
          <SkyFigure ceilingFtAgl={figure.ceilingFtAgl} visibilitySm={figure.visibilitySm} patternFtAgl={figure.patternFtAgl} legalCeilingFt={figure.legalCeilingFt} personalCeilingFt={figure.personalCeilingFt} />
        </div>
        <figcaption>
          {figure.airport.icao} from the side, heights above the field. The shaded band under the cloud is the 500 ft a pattern keeps clear of it{figure.legalCeilingFt !== null ? `; the legal line is the ${fmt(figure.legalCeilingFt)} ft surface-area minimum` : ''}, and yours is the ceiling you set. A sketch, not to horizontal scale.
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

// Everything on the circle is laid out in viewBox units, so the label
// placement below only needs rough text widths: a bold 12 px label in the
// condensed label face runs about 6.6 units a character, the 11 px detail
// line about 5.8. Erring wide keeps labels apart.
type Box = { x: number; y: number; w: number; h: number };
const textW = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.55 : 0.53) + 2;
const overlapArea = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// Ring spacing that keeps two to five rings on the figure, whatever the scale.
const RING_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20];
const ringStepFor = (reach: number) => RING_STEPS.find((s) => reach / s <= 5) ?? RING_STEPS[RING_STEPS.length - 1];
const nm = (n: number) => `${Number(n.toFixed(2))} nm`;

export function GlideDiagram({ heightAglFt, rangeNm, windFromTrue, windKt, fields }: {
  heightAglFt: number; rangeNm: number; windFromTrue?: number; windKt?: number;
  fields: { name: string; bearingTrue: number; distanceNm: number; reachable: boolean }[];
}) {
  const W = 420;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2;
  const PAD = 8; // labels stay this far inside the edge
  const FOOT = 26; // the footer line owns the bottom band
  const wind = windKt && windFromTrue !== undefined ? { from: windFromTrue, kt: windKt } : null;
  // The circle drifts downwind: sketched at a mile a minute, so the shift is the wind's share of the range.
  const shiftNm = wind ? rangeNm * Math.min(0.6, wind.kt / 60) : 0;
  const downwind = wind ? norm(wind.from + 180) : 0;
  // The scale follows the content: a short glide from 300 ft fills the figure
  // as much as a long one from 5,000 ft. A quarter mile is the floor.
  const reach = Math.max(rangeNm + shiftNm, ...fields.map((f) => f.distanceNm), 0.25) * 1.18;
  const px = (W / 2 - 24) / reach;
  const pt = (brg: number, nmDist: number) => {
    const r = (brg * Math.PI) / 180;
    return { x: cx + Math.sin(r) * nmDist * px, y: cy - Math.cos(r) * nmDist * px };
  };
  const shifted = pt(downwind, shiftNm);
  const ringStep = ringStepFor(reach);
  const rings: number[] = [];
  for (let i = 1; i * ringStep < reach; i++) rings.push(i * ringStep);

  // Obstacles nothing may sit on: the airplane, every field marker, the
  // bottom band. Labels are added as they are placed.
  const taken: Box[] = [
    { x: cx - 16, y: cy - 16, w: 32, h: 32 },
    { x: 0, y: H - FOOT, w: W, h: FOOT },
    ...fields.map((f) => { const q = pt(f.bearingTrue, f.distanceNm); return { x: q.x - 9, y: q.y - 9, w: 18, h: 18 }; }),
    ...rings.map((r) => ({ x: cx + 4, y: cy - r * px - 13, w: textW(nm(r), 11), h: 13 })),
  ];
  const inside = (b: Box) => b.x >= PAD && b.y >= PAD && b.x + b.w <= W - PAD && b.y + b.h <= H - FOOT;
  const clash = (b: Box) => taken.reduce((s, t) => s + overlapArea(b, t), 0);

  // The wind arrow rides the rim on the upwind side. If a field sits under
  // it, the arrow slides sideways, still pointing the way the wind blows.
  let windArrow: { tail: { x: number; y: number }; head: { x: number; y: number }; label: Box; labelY: number } | null = null;
  if (wind) {
    const a = (wind.from * Math.PI) / 180;
    const side = { x: Math.cos(a), y: Math.sin(a) }; // perpendicular to the wind line
    const labelText = `${pad3(wind.from)} at ${wind.kt} kt`;
    const lw = textW(labelText, 11, true);
    const candidates = [0, 1, -1, 2, -2].map((k) => {
      const off = k * 26;
      const tail = { x: pt(wind.from, reach * 0.9).x + side.x * off, y: pt(wind.from, reach * 0.9).y + side.y * off };
      const head = { x: pt(wind.from, reach * 0.72).x + side.x * off, y: pt(wind.from, reach * 0.72).y + side.y * off };
      const labelY = tail.y + (tail.y < cy ? -8 : 16);
      const label: Box = { x: tail.x - lw / 2, y: labelY - 11, w: lw, h: 14 };
      const line: Box = { x: Math.min(tail.x, head.x) - 4, y: Math.min(tail.y, head.y) - 4, w: Math.abs(tail.x - head.x) + 8, h: Math.abs(tail.y - head.y) + 8 };
      return { tail, head, label, labelY, cost: clash(label) + clash(line) + (inside(label) ? 0 : 1e6) };
    });
    const best = candidates.reduce((p, c) => (c.cost < p.cost ? c : p));
    windArrow = best;
    taken.push(best.label);
  }

  // The height label sits under the airplane unless a field is there; then above.
  const aglText = `${fmt(heightAglFt)} ft AGL`;
  const aglW = textW(aglText, 12, true);
  const aglBelow: Box = { x: cx - aglW / 2, y: cy + 18, w: aglW, h: 14 };
  const aglAbove: Box = { x: cx - aglW / 2, y: cy - 32, w: aglW, h: 14 };
  const agl = clash(aglBelow) === 0 || clash(aglAbove) > 0 ? { box: aglBelow, y: cy + 28 } : { box: aglAbove, y: cy - 21 };
  taken.push(agl.box);

  // Field labels: two lines, placed on the side away from the center first,
  // then wherever they fit without covering anything already drawn.
  const placed = fields
    .map((f, i) => ({ f, i, q: pt(f.bearingTrue, f.distanceNm) }))
    .sort((a, b) => a.f.distanceNm - b.f.distanceNm) // the crowded middle goes first
    .map(({ f, i, q }) => {
      const detail = `${f.distanceNm} nm, ${pad3(f.bearingTrue)}°`;
      const w = Math.max(textW(f.name, 12, true), textW(detail, 11));
      const h = 26;
      const out = { x: q.x - cx, y: q.y - cy };
      const len = Math.hypot(out.x, out.y) || 1;
      const ux = out.x / len; const uy = out.y / len;
      // anchor: where the first line's baseline starts; box: what it covers
      const dirs = [
        { dx: 1, dy: 0, anchor: 'start' as const, box: (): Box => ({ x: q.x + 11, y: q.y - 11, w, h }) },
        { dx: -1, dy: 0, anchor: 'end' as const, box: (): Box => ({ x: q.x - 11 - w, y: q.y - 11, w, h }) },
        { dx: 0, dy: -1, anchor: 'middle' as const, box: (): Box => ({ x: q.x - w / 2, y: q.y - 11 - h, w, h }) },
        { dx: 0, dy: 1, anchor: 'middle' as const, box: (): Box => ({ x: q.x - w / 2, y: q.y + 11, w, h }) },
        { dx: 0.7, dy: -0.7, anchor: 'start' as const, box: (): Box => ({ x: q.x + 8, y: q.y - 8 - h, w, h }) },
        { dx: -0.7, dy: -0.7, anchor: 'end' as const, box: (): Box => ({ x: q.x - 8 - w, y: q.y - 8 - h, w, h }) },
        { dx: 0.7, dy: 0.7, anchor: 'start' as const, box: (): Box => ({ x: q.x + 8, y: q.y + 8, w, h }) },
        { dx: -0.7, dy: 0.7, anchor: 'end' as const, box: (): Box => ({ x: q.x - 8 - w, y: q.y + 8, w, h }) },
      ];
      const scored = dirs.map((d, order) => {
        let box = d.box();
        // slide a label back inside the figure rather than clip it
        box = { ...box, x: Math.min(Math.max(box.x, PAD), W - PAD - w), y: Math.min(Math.max(box.y, PAD), H - FOOT - h) };
        const away = -(d.dx * ux + d.dy * uy); // lower is more outward
        return { d, box, cost: clash(box) * 10 + away + order * 0.01 };
      });
      const best = scored.reduce((p, c) => (c.cost < p.cost ? c : p));
      taken.push(best.box);
      const tx = best.d.anchor === 'start' ? best.box.x : best.d.anchor === 'end' ? best.box.x + w : best.box.x + w / 2;
      return { f, i, q, detail, anchor: best.d.anchor, tx, ty: best.box.y + 10 };
    })
    .sort((a, b) => a.i - b.i);

  return (
    <div className="fig-glide">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Glide range ${rangeNm} nm from ${fmt(heightAglFt)} ft above the ground. ${fields.map((f) => `${f.name} ${f.distanceNm} nm ${f.reachable ? 'reachable' : 'out of reach'}`).join(', ')}.`}>
        <rect width={W} height={H} fill="var(--apron)" rx="12" />
        {rings.map((r) => (
          <g key={r}>
            <circle cx={cx} cy={cy} r={r * px} fill="none" stroke="var(--line)" strokeWidth="1" />
            <text x={cx + 4} y={cy - r * px - 3} fontSize="11" fill="var(--ink-2)">{nm(r)}</text>
          </g>
        ))}
        {/* still-air circle, then the one the wind moves */}
        {wind && <circle cx={cx} cy={cy} r={rangeNm * px} fill="none" stroke="var(--ink-2)" strokeWidth="1.2" strokeDasharray="5 4" />}
        <circle cx={shifted.x} cy={shifted.y} r={rangeNm * px} fill="var(--sky-tint)" fillOpacity="0.7" stroke="var(--sky-ink)" strokeWidth="2" />
        {wind && windArrow && (
          <g>
            <line x1={windArrow.tail.x} y1={windArrow.tail.y} x2={windArrow.head.x} y2={windArrow.head.y} stroke="var(--sock)" strokeWidth="3.5" strokeLinecap="round" />
            {(() => {
              const a = ((downwind) * Math.PI) / 180;
              const hx = windArrow.head.x; const hy = windArrow.head.y;
              const bx = hx - Math.sin(a) * 10; const by = hy + Math.cos(a) * 10;
              const px2 = Math.cos(a) * 6; const py2 = Math.sin(a) * 6;
              return <polygon points={`${hx},${hy} ${bx + px2},${by + py2} ${bx - px2},${by - py2}`} fill="var(--sock)" />;
            })()}
            <text x={windArrow.tail.x} y={windArrow.labelY} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--sock-ink)">{pad3(wind.from)} at {wind.kt} kt</text>
          </g>
        )}
        {placed.map(({ f, q, detail, anchor, tx, ty }) => (
          <g key={f.name}>
            <circle cx={q.x} cy={q.y} r="7" fill={f.reachable ? 'var(--right)' : 'var(--panel)'} stroke={f.reachable ? 'var(--right)' : 'var(--unsafe)'} strokeWidth="2.5" />
            {!f.reachable && <path d={`M${q.x - 3},${q.y - 3} l6,6 M${q.x + 3},${q.y - 3} l-6,6`} stroke="var(--unsafe)" strokeWidth="2" strokeLinecap="round" />}
            <text x={tx} y={ty} textAnchor={anchor} fontSize="12" fontWeight="700" fill="var(--ink)">{f.name}</text>
            <text x={tx} y={ty + 13} textAnchor={anchor} fontSize="11" fill="var(--ink-2)">{detail}</text>
          </g>
        ))}
        {/* the airplane */}
        <path transform={`translate(${cx} ${cy}) scale(1.4)`} d="M0,-9 L2,-3 L10,1 L10,3 L2,1.5 L1.5,6 L4,8 L4,9 L0,8 L-4,9 L-4,8 L-1.5,6 L-2,1.5 L-10,3 L-10,1 L-2,-3 Z" fill="var(--ink)" stroke="var(--apron)" strokeWidth="1" />
        <text x={cx} y={agl.y} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">{aglText}</text>
        <text x={12} y={H - 12} fontSize="11" fill="var(--ink-2)">True north up. Glide range {rangeNm} nm{wind ? ', moved downwind by the wind' : ', still air'}.</text>
      </svg>
    </div>
  );
}

const SIGN_LABEL: Record<AirportSign['kind'], string> = {
  mandatory: 'Mandatory instruction sign',
  location: 'Location sign',
  direction: 'Direction sign',
  destination: 'Destination sign',
  ils: 'ILS critical area sign',
  'no-entry': 'No entry sign',
};

/** Signs drawn in their regulation colors, which are part of what they mean, with the marking on the pavement below. */
function SignsFigure({ signs, marking }: { signs: AirportSign[]; marking?: 'runway-hold' | 'ils-hold' }) {
  return (
    <div className="signs">
      <div className="signs-row" role="list">
        {signs.map((s, i) => (
          <span key={i} role="listitem" className={`sign sign-${s.kind}`} aria-label={`${SIGN_LABEL[s.kind]}: ${s.text}`}>
            {s.arrowDeg !== undefined && s.arrowDeg < 0 && <span className="sign-arrow" style={{ transform: `rotate(${s.arrowDeg}deg)` }} aria-hidden="true">↑</span>}
            <span className="sign-text">{s.text}</span>
            {s.arrowDeg !== undefined && s.arrowDeg >= 0 && <span className="sign-arrow" style={{ transform: `rotate(${s.arrowDeg}deg)` }} aria-hidden="true">↑</span>}
          </span>
        ))}
      </div>
      {marking && (
        <svg className="signs-marking" viewBox="0 0 320 44" role="img" aria-label={marking === 'runway-hold' ? 'Runway holding position marking: two solid lines on your side, two dashed lines on the runway side' : 'ILS critical area holding position marking: a yellow ladder across the taxiway'}>
          <rect x="0" y="0" width="320" height="44" className="pave" />
          {marking === 'runway-hold' ? (
            <g className="paint">
              <rect x="8" y="30" width="304" height="3" />
              <rect x="8" y="24" width="304" height="3" />
              {Array.from({ length: 13 }, (_, i) => <rect key={`a${i}`} x={8 + i * 24} y="15" width="14" height="3" />)}
              {Array.from({ length: 13 }, (_, i) => <rect key={`b${i}`} x={8 + i * 24} y="9" width="14" height="3" />)}
            </g>
          ) : (
            <g className="paint">
              <rect x="8" y="12" width="304" height="3" />
              <rect x="8" y="29" width="304" height="3" />
              {Array.from({ length: 16 }, (_, i) => <rect key={i} x={10 + i * 19.5} y="15" width="3" height="14" />)}
            </g>
          )}
          <text x="316" y="41" textAnchor="end" className="dir">your side ↓</text>
        </svg>
      )}
    </div>
  );
}

/** Stall speed against bank, drawn from 1 / cos(bank) and its square root. */
function LoadFactorChart({ bankDeg, vs0Kias, vs1Kias, approachKias }: { bankDeg: number; vs0Kias: number; vs1Kias: number; approachKias: number; sample: boolean }) {
  const W = 320, H = 186, L = 36, R = 10, T = 20, B = 28;
  const maxBank = 75;
  const vmax = Math.ceil((Math.max(vs1Kias / Math.sqrt(Math.cos((maxBank * Math.PI) / 180)), approachKias) + 5) / 10) * 10;
  const vmin = Math.floor((vs0Kias - 5) / 10) * 10;
  const x = (b: number) => L + (b / maxBank) * (W - L - R);
  const y = (v: number) => T + (1 - (v - vmin) / (vmax - vmin)) * (H - T - B);
  const stall = (vs: number, b: number) => vs / Math.sqrt(Math.cos((b * Math.PI) / 180));
  const path = (vs: number) => Array.from({ length: maxBank + 1 }, (_, b) => `${b === 0 ? 'M' : 'L'}${x(b).toFixed(1)},${y(Math.min(vmax, stall(vs, b))).toFixed(1)}`).join(' ');
  const ticks = [0, 15, 30, 45, 60, 75];
  const vticks: number[] = [];
  for (let v = vmin; v <= vmax; v += 10) vticks.push(v);
  const dot = stall(vs0Kias, bankDeg);
  return (
    <svg className="lf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stall speed against bank angle. At ${bankDeg} degrees the flaps-down stall speed is ${Math.round(dot)} knots against a ${approachKias} knot approach speed.`}>
      {vticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 4} y={y(v) + 3} textAnchor="end" className="tick">{v}</text></g>)}
      {ticks.map((b) => <text key={b} x={x(b)} y={H - B + 14} textAnchor="middle" className="tick">{b}°</text>)}
      <text x={W - R} y={H - 2} textAnchor="end" className="axis">bank</text>
      <text x={L - 4} y={8} textAnchor="end" className="axis">kt</text>
      <line x1={L} x2={W - R} y1={y(approachKias)} y2={y(approachKias)} className="approach" />
      <text x={L + 4} y={y(approachKias) - 4} className="lbl">approach {approachKias}</text>
      <path d={path(vs1Kias)} className="clean" />
      <path d={path(vs0Kias)} className="flaps" />
      <text x={x(20)} y={y(stall(vs1Kias, 20)) - 5} className="lbl">clean</text>
      <text x={x(20)} y={y(stall(vs0Kias, 20)) + 13} className="lbl">flaps down</text>
      {dot <= vmax && <circle cx={x(bankDeg)} cy={y(dot)} r={5} className="dot" />}
    </svg>
  );
}

