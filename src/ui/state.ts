// App-level persisted state: aircraft profile, current loading, pilot profile
// and theme. Everything goes through lib/storage so it degrades gracefully.

import { useCallback, useEffect, useState } from 'react';
import { load, save } from '../lib/storage';
import { sampleC172K, type AircraftProfile } from '../data/aircraft';
import { defaultPilot, type PilotProfile } from '../data/pilot';
import { KASH, type Airport } from '../data/airports';
import { computeWb, FUEL_LB_PER_GAL, type LoadItem, type WbResult } from '../lib/wb';

export const KEYS = {
  aircraft: 'downwind.aircraft.v1',
  loading: 'downwind.loading.v1',
  pilot: 'downwind.pilot.v1',
  airport: 'downwind.airport.v1',
  theme: 'downwind.theme.v1',
  onboarding: 'downwind.onboarding.v1',
} as const;

export interface OnboardingState {
  complete: boolean;
  /** Last step the pilot was on, so setup resumes where it left off. */
  step: number;
}

export function useAirport() {
  return usePersisted<Airport>(KEYS.airport, KASH);
}
export function useOnboarding() {
  return usePersisted<OnboardingState>(KEYS.onboarding, { complete: false, step: 0 });
}

/** Next flight review due: 24 calendar months after the last one, end of that month (61.56). */
export function flightReviewDue(lastIso: string | null): Date | null {
  if (!lastIso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(lastIso);
  if (!m) return null;
  // Day 0 of the following month is the last day of the target month.
  return new Date(Number(m[1]), Number(m[2]) - 1 + 25, 0);
}

/** The fuel station is special: the pilot enters gallons, we convert to pounds. */
export const FUEL_STATION_ID = 'fuel';

export interface Loading {
  /** Pounds by station id, for every station except fuel. */
  weights: Record<string, number>;
  fuelGal: number;
}

export const defaultLoading: Loading = {
  weights: { front: 340, rear: 0, bag1: 20 },
  fuelGal: 38,
};

export function usePersisted<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => load<T>(key, fallback));
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        save(key, v);
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

export function useAircraft() {
  return usePersisted<AircraftProfile>(KEYS.aircraft, sampleC172K);
}
export function useLoading() {
  return usePersisted<Loading>(KEYS.loading, defaultLoading);
}
export function usePilot() {
  return usePersisted<PilotProfile>(KEYS.pilot, defaultPilot);
}

export function loadItems(aircraft: AircraftProfile, loading: Loading): LoadItem[] {
  return aircraft.stations.map((s) => ({
    stationId: s.id,
    weightLb: s.id === FUEL_STATION_ID ? Math.round(loading.fuelGal * FUEL_LB_PER_GAL) : loading.weights[s.id] ?? 0,
  }));
}

export function wbFor(aircraft: AircraftProfile, loading: Loading): WbResult {
  return computeWb(
    aircraft.emptyWeightLb,
    aircraft.emptyArmIn,
    aircraft.stations,
    loadItems(aircraft, loading),
    aircraft.envelope,
    aircraft.maxGrossLb,
  );
}

export type Theme = 'auto' | 'light' | 'dark';

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = usePersisted<Theme>(KEYS.theme, 'auto');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

/** Next whole hour, local time. */
export function nextWholeHour(from = new Date()): Date {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Value for an <input type="datetime-local">, in local time. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtZ(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
}

export function fmtLocal(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
