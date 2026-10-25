// The chart's geometry, kept pure so it can be tested: an equirectangular
// projection scaled by cos(latitude), which is as flat as a practice area
// needs, and a greedy label placer that keeps text boxes off each other.

import type { LatLon } from '../lib/nav';

export interface XY {
  x: number;
  y: number;
}

export interface Projection {
  center: LatLon;
  /** Pixels per nautical mile. */
  pxPerNm: number;
  width: number;
  height: number;
  toXY(p: LatLon): XY;
  toLatLon(q: XY): LatLon;
  /** The lat/lon rectangle the frame shows. */
  extent(): { north: number; south: number; east: number; west: number };
}

const NM_PER_DEG = 60;
const rad = (d: number) => (d * Math.PI) / 180;

export function makeProjection(center: LatLon, pxPerNm: number, width: number, height: number): Projection {
  const kx = NM_PER_DEG * Math.cos(rad(center.lat)) * pxPerNm;
  const ky = NM_PER_DEG * pxPerNm;
  const toXY = (p: LatLon): XY => ({ x: width / 2 + (p.lon - center.lon) * kx, y: height / 2 - (p.lat - center.lat) * ky });
  const toLatLon = (q: XY): LatLon => ({ lat: center.lat - (q.y - height / 2) / ky, lon: center.lon + (q.x - width / 2) / kx });
  return {
    center, pxPerNm, width, height, toXY, toLatLon,
    extent() {
      const nw = toLatLon({ x: 0, y: 0 });
      const se = toLatLon({ x: width, y: height });
      return { north: nw.lat, west: nw.lon, south: se.lat, east: se.lon };
    },
  };
}

/** A projection that fits a lat/lon box into width by height, centered. */
export function fitProjection(b: { north: number; south: number; east: number; west: number }, width: number, height: number): Projection {
  const center = { lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2 };
  const latNm = (b.north - b.south) * NM_PER_DEG;
  const lonNm = (b.east - b.west) * NM_PER_DEG * Math.cos(rad(center.lat));
  return makeProjection(center, Math.min(width / lonNm, height / latNm), width, height);
}

/** A projection centered on a point showing at least `radiusNm` all round. */
export function focusProjection(center: LatLon, radiusNm: number, width: number, height: number): Projection {
  return makeProjection(center, Math.min(width, height) / (2 * radiusNm), width, height);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box, pad = 0): boolean =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/**
 * Picks the first candidate box that clears every box already placed and
 * stays inside the frame. Returns null when none does, so the caller can
 * drop the label or fall back to the first candidate.
 */
export function placeLabel(placed: Box[], candidates: Box[], frame: Box, pad = 2): Box | null {
  for (const c of candidates) {
    if (c.x < frame.x || c.y < frame.y || c.x + c.w > frame.x + frame.w || c.y + c.h > frame.y + frame.h) continue;
    if (placed.some((p) => overlaps(p, c, pad))) continue;
    return c;
  }
  return null;
}

const clampBox = (c: Box, frame: Box): Box => ({
  ...c,
  x: Math.min(Math.max(c.x, frame.x), frame.x + frame.w - c.w),
  y: Math.min(Math.max(c.y, frame.y), frame.y + frame.h - c.h),
});

const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * When nothing is free: the in-frame candidate that covers the least of what
 * is already placed, or the first candidate pushed inside the frame.
 */
export function placeLabelLoose(placed: Box[], candidates: Box[], frame: Box): Box {
  const free = placeLabel(placed, candidates, frame);
  if (free) return free;
  let best: { c: Box; a: number } | null = null;
  for (const raw of candidates) {
    const c = clampBox(raw, frame);
    const a = placed.reduce((n, p) => n + overlapArea(p, c), 0);
    if (!best || a < best.a) best = { c, a };
  }
  return best ? best.c : clampBox(candidates[0], frame);
}

/** Rough text width for the label face, enough to lay out boxes. */
export const textWidth = (s: string, fontPx: number, factor = 0.56): number => s.length * fontPx * factor;
