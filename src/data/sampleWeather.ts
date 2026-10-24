// Practice weather used when live reports can't be fetched (offline, rate
// limited, or in tests). It is not a real report for any airport: the
// station identifier is swapped in so the brief can be shown for the pilot's
// own field, and the UI labels it as practice data everywhere.
const METAR = 'METAR {ID} 241653Z 27014G22KT 7SM BKN028 14/04 A3002 RMK AO2 SLP165';
const TAF = 'TAF {ID} 241720Z 2418/2518 28012G20KT P6SM SCT035 FM242200 31008KT P6SM SKC FM251200 VRB04KT P6SM SCT250';

export const SAMPLE_STATION = 'KXYZ';

export function sampleMetarFor(station: string): string {
  return METAR.replace('{ID}', station || SAMPLE_STATION);
}

export function sampleTafFor(station: string): string {
  return TAF.replace('{ID}', station || SAMPLE_STATION);
}

export const sampleMetar = sampleMetarFor(SAMPLE_STATION);
export const sampleTaf = sampleTafFor(SAMPLE_STATION);
