// The practice field as an airport diagram, drawn from radio/field.ts so the
// taxi route the controller gives is the one on the picture. Runway 06/24
// along the middle, Alpha north, Bravo south, Charlie across at midfield, the
// two ramps, hold short bars at every connector, the taxiway signs, and the
// windsock showing the ATIS wind. The event being flown decides what is
// ringed: the taxiways in the clearance, the hold short point, a crossing.
// None of it is a real airport, and the caption says so.

import type { Atis, Event } from '../radio/flights';
import { CONNECTORS, FIELD, RAMPS, TAXI_Y, runwayById, sayTaxiway, type Closure, type Ramp } from '../radio/field';

export interface DiagramFocus {
  /** Taxiways and connectors named in the clearance or the scene: 'A', 'C', 'A4'. */
  taxiways: string[];
  /** The connector to hold short at, if the event has one. */
  holdAt: string | null;
  /** True when the event crosses the runway at Charlie. */
  cross: boolean;
  /** Where the airplane is parked, when it is still on the ramp. */
  onRamp: boolean;
}

const NAMES: Record<string, string> = { alpha: 'A', bravo: 'B', charlie: 'C' };

/** Taxiway ids spoken in a text, in order: "Alpha 4" is A4, "Charlie" is C. */
function idsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(Alpha|Bravo|Charlie)(?: (\d))?\b/gi)) out.push(`${NAMES[m[1].toLowerCase()]}${m[2] ?? ''}`);
  return out;
}

/** What to ring for an event. Read from the controller's words and the scene, so it is only ever as specific as they are. */
export function focusFor(e: Event): DiagramFocus {
  const text = e.kind === 'transmit' ? `${e.atc ?? ''} ${e.situation}` : e.situation;
  const hold = text.match(/hold(?:ing)? short(?: of)? runway \d\d at (Alpha|Bravo|Charlie)(?: (\d))?/i)
    ?? text.match(/hold short line at (Alpha|Bravo|Charlie)(?: (\d))?/i)
    ?? text.match(/at (Alpha|Bravo|Charlie)(?: (\d))?, short of runway/i);
  const ids = idsIn(text);
  return {
    taxiways: [...new Set(ids)],
    holdAt: hold ? `${NAMES[hold[1].toLowerCase()]}${hold[2] ?? ''}` : null,
    cross: /cross(?:es|ing)? (?:the )?runway/i.test(text),
    onRamp: e.id === 'ground-call' || (e.id === 'atis' && /ramp/i.test(e.situation)),
  };
}

// Schematic widths: wider than life so they read at phone size.
const RWY_HALF = 100;
const TWY_HALF = 55;
const HOLD_Y = 250;
const SIGN_Y = TAXI_Y + TWY_HALF + 120;

const Y = (y: number) => -y;

function Sign({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length > 1 ? 300 : 210;
  return (
    <g>
      <rect x={x - w / 2} y={Y(y) - 95} width={w} height={190} rx="28" fill="var(--sign)" />
      <text x={x} y={Y(y) + 62} textAnchor="middle" fontSize="170" fontWeight="800" fill="var(--taxi)">{text}</text>
    </g>
  );
}

function Pavement({ x1, y1, x2, y2, half, hot }: { x1: number; y1: number; x2: number; y2: number; half: number; hot?: boolean }) {
  return (
    <>
      <line x1={x1} y1={Y(y1)} x2={x2} y2={Y(y2)} stroke="var(--panel-2)" strokeWidth={half * 2} strokeLinecap="butt" />
      {hot && <line x1={x1} y1={Y(y1)} x2={x2} y2={Y(y2)} stroke="var(--sock)" strokeWidth={half * 2 + 50} strokeOpacity="0.22" />}
      <line x1={x1} y1={Y(y1)} x2={x2} y2={Y(y2)} stroke="var(--taxi)" strokeWidth="22" />
    </>
  );
}

/** Two bars across a connector just short of the runway: solid on the taxiway side, broken on the runway side. */
function HoldBars({ x, side }: { x: number; side: 1 | -1 }) {
  const y1 = Y(side * HOLD_Y);
  const y2 = Y(side * (HOLD_Y - 50));
  return (
    <>
      <line x1={x - 75} y1={y1} x2={x + 75} y2={y1} stroke="var(--taxi)" strokeWidth="26" />
      <line x1={x - 75} y1={y2} x2={x + 75} y2={y2} stroke="var(--taxi)" strokeWidth="22" strokeDasharray="30 22" />
    </>
  );
}

function Windsock({ x, y, atis }: { x: number; y: number; atis: Atis | null }) {
  // Field frame: +x is runway heading 060, so a heading h sits 60 - h degrees counterclockwise from +x.
  const dir = atis?.windMag === null || !atis ? null : (((60 - (atis.windMag + 180)) * Math.PI) / 180);
  const len = dir === null ? 150 : 150 + Math.min(atis!.windKt, 15) * 14;
  const tip: [number, number] = dir === null ? [x + 60, y - 130] : [x + Math.cos(dir) * len, y + Math.sin(dir) * len];
  const nx = dir === null ? 0 : -Math.sin(dir);
  const ny = dir === null ? 1 : Math.cos(dir);
  return (
    <g>
      <circle cx={x} cy={Y(y)} r="24" fill="var(--ink)" />
      <path d={`M ${x + nx * 55} ${Y(y + ny * 55)} L ${x - nx * 55} ${Y(y - ny * 55)} L ${tip[0]} ${Y(tip[1])} Z`} fill="var(--sock)" />
    </g>
  );
}

export function AirportDiagram({ focus, atis, ramp }: { focus: DiagramFocus | null; atis: Atis | null; ramp: Ramp | null }) {
  const closure: Closure | null = atis?.closure ?? null;
  const hot = (id: string) => Boolean(focus?.taxiways.includes(id));
  const holdAt = focus?.holdAt ? CONNECTORS.find((c) => c.id === focus.holdAt) : null;
  const holdSide: 1 | -1 = holdAt ? (holdAt.side === 'south' ? -1 : 1) : 1;
  const rw06 = runwayById('06');
  const rw24 = runwayById('24');
  const label = [
    `Diagram of the practice field: runway 06/24 with taxiway Alpha on the north side, Bravo on the south and Charlie crossing at midfield.`,
    focus?.taxiways.length ? `Marked: ${focus.taxiways.map(sayTaxiway).join(', ')}.` : '',
    focus?.holdAt ? `Hold short point at ${sayTaxiway(focus.holdAt)}.` : '',
    closure ? `${closure.text}.` : '',
  ].filter(Boolean).join(' ');

  return (
    <figure className="fig diagram">
      <svg viewBox="-400 -1150 6300 2300" role="img" aria-label={label}>
        <rect x="-400" y="-1150" width="6300" height="2300" fill="var(--panel)" />

        {/* ramps */}
        {Object.values(RAMPS).map((r) => {
          const s = r.side === 'north' ? 1 : -1;
          const top = Y(s * (TAXI_Y + TWY_HALF + 440));
          const bottom = Y(s * (TAXI_Y + TWY_HALF - 10));
          const mine = ramp?.id === r.id;
          return (
            <g key={r.id}>
              <rect x={r.x - 350} y={Math.min(top, bottom)} width={800} height={Math.abs(top - bottom)} rx="40" fill="var(--panel-2)" stroke="var(--line)" strokeWidth="12" />
              <text x={r.x + 50} y={Y(s * (TAXI_Y + TWY_HALF + 330)) + (s === 1 ? 60 : 0)} textAnchor="middle" fontSize="150" fontWeight="600" fill={mine ? 'var(--ink)' : 'var(--ink-2)'}>
                {r.name.replace(/^the /, '').replace(/^\w/, (c) => c.toUpperCase())}
              </text>
              {focus?.onRamp && mine && (
                <g>
                  <circle cx={r.x - 200} cy={Y(s * (TAXI_Y + TWY_HALF + 150))} r="70" fill="var(--sock)" />
                  <text x={r.x - 90} y={Y(s * (TAXI_Y + TWY_HALF + 150)) + 52} fontSize="150" fontWeight="700" fill="var(--sock-ink)">You</text>
                </g>
              )}
            </g>
          );
        })}
        {/* the tower, on the main ramp */}
        <rect x={RAMPS.main.x + 300} y={Y(TAXI_Y + TWY_HALF + 420)} width="130" height="130" fill="var(--sign)" />

        {/* parallels and connectors */}
        <Pavement x1={-TWY_HALF} y1={TAXI_Y} x2={FIELD.lengthFt + TWY_HALF} y2={TAXI_Y} half={TWY_HALF} hot={hot('A')} />
        <Pavement x1={-TWY_HALF} y1={-TAXI_Y} x2={FIELD.lengthFt + TWY_HALF} y2={-TAXI_Y} half={TWY_HALF} hot={hot('B')} />
        {CONNECTORS.map((c) => {
          const sides: (1 | -1)[] = c.side === 'both' ? [1, -1] : [c.side === 'north' ? 1 : -1];
          return sides.map((s) => <Pavement key={`${c.id}${s}`} x1={c.x} y1={s * (RWY_HALF - 10)} x2={c.x} y2={s * TAXI_Y} half={TWY_HALF} hot={hot(c.id) || (c.id === 'C' && focus?.cross)} />);
        })}
        {CONNECTORS.map((c) => (c.side === 'both' ? ([1, -1] as const) : [c.side === 'north' ? 1 : -1] as const).map((s) => <HoldBars key={`${c.id}h${s}`} x={c.x} side={s} />))}

        {/* a closed stretch */}
        {closure && (() => {
          const s = closure.side === 'north' ? 1 : -1;
          const y = Y(s * TAXI_Y);
          const mid = (closure.fromX + closure.toX) / 2;
          return (
            <g>
              <line x1={closure.fromX + 120} y1={y} x2={closure.toX - 120} y2={y} stroke="var(--unsafe)" strokeWidth="40" strokeDasharray="90 70" />
              {[closure.fromX + 420, mid, closure.toX - 420].map((x) => (
                <g key={x} stroke="var(--unsafe)" strokeWidth="34" strokeLinecap="round">
                  <line x1={x - 80} y1={y - 80} x2={x + 80} y2={y + 80} />
                  <line x1={x - 80} y1={y + 80} x2={x + 80} y2={y - 80} />
                </g>
              ))}
              <text x={mid} y={Y(s * 260) + (s === 1 ? 50 : 50)} textAnchor="middle" fontSize="150" fontWeight="700" fill="var(--unsafe)">Closed</text>
            </g>
          );
        })()}

        {/* the runway, on top so Charlie reads as crossing it */}
        <rect x="0" y={-RWY_HALF} width={FIELD.lengthFt} height={RWY_HALF * 2} fill="var(--sign)" />
        <line x1="700" y1="0" x2={FIELD.lengthFt - 700} y2="0" stroke="var(--cat-ink-light)" strokeOpacity="0.55" strokeWidth="14" strokeDasharray="120 90" />
        <text x={rw06.thresholdX + 320} y="0" transform={`rotate(90 ${rw06.thresholdX + 320} 0)`} textAnchor="middle" dominantBaseline="central" fontSize="150" fontWeight="800" fill="var(--cat-ink-light)">06</text>
        <text x={rw24.thresholdX - 320} y="0" transform={`rotate(-90 ${rw24.thresholdX - 320} 0)`} textAnchor="middle" dominantBaseline="central" fontSize="150" fontWeight="800" fill="var(--cat-ink-light)">24</text>

        {/* signs */}
        {CONNECTORS.filter((c) => c.id !== 'C').map((c) => <Sign key={c.id} x={c.x} y={(c.side === 'north' ? 1 : -1) * SIGN_Y} text={c.id} />)}
        <Sign x={2800} y={SIGN_Y} text="C" />
        <Sign x={2800} y={-SIGN_Y} text="C" />
        <Sign x={1000} y={SIGN_Y} text="A" />
        <Sign x={4900} y={SIGN_Y} text="A" />
        <Sign x={1000} y={-SIGN_Y} text="B" />
        <Sign x={4900} y={-SIGN_Y} text="B" />

        {/* what the clearance points at */}
        {focus?.cross && <circle cx={CONNECTORS.find((c) => c.id === 'C')!.x} cy="0" r="230" fill="none" stroke="var(--sock)" strokeWidth="30" />}
        {holdAt && (
          <g>
            <circle cx={holdAt.x} cy={Y(holdSide * HOLD_Y)} r="170" fill="none" stroke="var(--sock)" strokeWidth="30" />
            <text x={holdAt.x + (holdAt.x > FIELD.lengthFt / 2 ? -230 : 230)} y={Y(holdSide * HOLD_Y) + 50} textAnchor={holdAt.x > FIELD.lengthFt / 2 ? 'end' : 'start'} fontSize="150" fontWeight="700" fill="var(--sock-ink)">Hold short</text>
          </g>
        )}

        <Windsock x={4450} y={TAXI_Y + TWY_HALF + 340} atis={atis} />

        {/* north */}
        <g transform="translate(5650 -1000)">
          <line x1="0" y1="0" x2="0" y2="-120" stroke="var(--ink)" strokeWidth="18" />
          <path d="M -55 -80 L 0 -190 L 55 -80" fill="var(--ink)" />
          <text x="0" y="170" textAnchor="middle" fontSize="150" fontWeight="700" fill="var(--ink)">N</text>
        </g>
      </svg>
      <figcaption>
        Practice field, not a real airport. Runway 06/24, {FIELD.lengthFt.toLocaleString('en-US')} ft. Alpha runs the north side, Bravo the south, Charlie crosses at midfield.
        {closure ? ` ${closure.text}.` : ''}
        {focus?.holdAt ? ` The ring is the hold short point at ${sayTaxiway(focus.holdAt)}.` : focus?.cross ? ' The ring is the runway crossing at Charlie.' : ''}
        {atis ? ` The windsock shows ${atis.windMag === null ? 'calm wind' : `wind from ${String(atis.windMag).padStart(3, '0')} at ${atis.windKt}`}.` : ''}
      </figcaption>
    </figure>
  );
}
