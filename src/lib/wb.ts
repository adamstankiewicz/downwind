// Weight and balance by arm and moment. All numbers come from the pilot's
// aircraft profile; nothing here is a published value for any airframe.

export interface Station {
  id: string;
  label: string;
  armIn: number;
  /** Max weight for this station, if the POH limits it. */
  maxLb?: number;
}

export interface LoadItem {
  stationId: string;
  weightLb: number;
}

/** Envelope corners as [cg inches, weight lb], in order around the polygon. */
export type Envelope = [number, number][];

export interface WbResult {
  totalLb: number;
  momentLbIn: number;
  cgIn: number;
  withinEnvelope: boolean;
  overGross: boolean;
  stationsOverMax: string[];
}

export const FUEL_LB_PER_GAL = 6;

export function computeWb(
  emptyLb: number,
  emptyArmIn: number,
  stations: Station[],
  load: LoadItem[],
  envelope: Envelope,
  maxGrossLb: number,
): WbResult {
  let total = emptyLb;
  let moment = emptyLb * emptyArmIn;
  const over: string[] = [];
  for (const item of load) {
    const s = stations.find((st) => st.id === item.stationId);
    if (!s) continue;
    total += item.weightLb;
    moment += item.weightLb * s.armIn;
    if (s.maxLb !== undefined && item.weightLb > s.maxLb) over.push(s.id);
  }
  const cg = total > 0 ? moment / total : 0;
  return {
    totalLb: Math.round(total),
    momentLbIn: Math.round(moment),
    cgIn: Math.round(cg * 100) / 100,
    withinEnvelope: pointInPolygon([cg, total], envelope),
    overGross: total > maxGrossLb,
    stationsOverMax: over,
  };
}

export function pointInPolygon([x, y]: [number, number], poly: Envelope): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const onEdge =
      Math.abs((xj - xi) * (y - yi) - (x - xi) * (yj - yi)) < 1e-6 &&
      Math.min(xi, xj) - 1e-9 <= x && x <= Math.max(xi, xj) + 1e-9 &&
      Math.min(yi, yj) - 1e-9 <= y && y <= Math.max(yi, yj) + 1e-9;
    if (onEdge) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
