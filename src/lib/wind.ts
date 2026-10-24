// Wind components. METAR and TAF winds are reported in degrees TRUE; runway
// numbers and tower/ATIS winds are MAGNETIC. Mixing them up is a classic
// error, so conversion is explicit here and shown to the learner.

/** Magnetic variation: positive east, negative west (New England is west). */
export function trueToMagnetic(dirTrue: number, variationDeg: number): number {
  return norm(dirTrue - variationDeg);
}

export function norm(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export interface Components {
  /** Positive is a headwind, negative a tailwind. */
  headwindKt: number;
  /** Always positive; see `from` for the side. */
  crosswindKt: number;
  from: 'left' | 'right' | 'none';
  /** Angle between wind and runway, 0 to 180. */
  angleDeg: number;
}

export function components(windDirMag: number, speedKt: number, runwayHeadingMag: number): Components {
  const diff = norm(windDirMag - runwayHeadingMag);
  const rad = (diff * Math.PI) / 180;
  const cross = speedKt * Math.sin(rad);
  const head = speedKt * Math.cos(rad);
  const angle = diff > 180 ? 360 - diff : diff;
  return {
    headwindKt: round1(head),
    crosswindKt: round1(Math.abs(cross)),
    from: Math.abs(cross) < 0.05 ? 'none' : cross > 0 ? 'right' : 'left',
    angleDeg: Math.round(angle),
  };
}

export interface RunwayEnd {
  id: string;
  headingMag: number;
}

/** Picks the runway end with the most headwind, then the least crosswind. */
export function bestRunway<T extends RunwayEnd>(ends: T[], windDirMag: number, speedKt: number): T {
  return [...ends].sort((a, b) => {
    const ca = components(windDirMag, speedKt, a.headingMag);
    const cb = components(windDirMag, speedKt, b.headingMag);
    return cb.headwindKt - ca.headwindKt || ca.crosswindKt - cb.crosswindKt;
  })[0];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
