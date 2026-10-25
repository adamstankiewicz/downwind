// The practice sectionals the app ships with. Figures name a chart by its id;
// leaving it out means the first one, so every older lesson keeps its chart.

import { lakesRegion } from './lakesRegion';
import { practiceRegion, type ChartAirport, type Region } from './practiceRegion';

export const regions: Region[] = [practiceRegion, lakesRegion];
export type RegionId = 'practice' | 'lakes';

export const regionById = (id: string | undefined): Region => regions.find((r) => r.id === id) ?? practiceRegion;

/** An airport on any practice sectional. Ids are unique across them. */
export const anyChartAirport = (id: string): ChartAirport | undefined => {
  for (const r of regions) {
    const a = r.airports.find((x) => x.id === id);
    if (a) return a;
  }
  return undefined;
};
