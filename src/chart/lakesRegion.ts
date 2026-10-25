// The second practice sectional: the lake country around Westvale (KWVA), a
// made-up stretch with different shapes from the first, so chart and
// navigation lessons don't always ask about the same towns. None of it is a
// real place. Mountains rise to the north with a high field among them, a
// Class C sits on the coast plain to the south, a Class E surface area and an
// alert area to the east, and the variation is larger than on the first chart.

import { destination, type LatLon } from '../lib/nav';
import { boxAround, levelledGround, type ChartAirport, type Region } from './practiceRegion';

const HOME: LatLon = { lat: 44.2, lon: -70.6 };
const at = (brgTrue: number, nm: number, from: LatLon = HOME) => destination(from, brgTrue, nm);

const WCP = at(170, 26);
const WLN = at(75, 34);
const WFB = at(330, 20);
const WSL = at(355, 46);

/** Low near the coast to the south, climbing into mountains to the north: about 3,800 ft on the high ground. */
function terrainFt(p: LatLon): number {
  // The foothill line wanders north and south rather than running straight across.
  const edge = 43.9 + 0.12 * Math.sin((p.lon + 70.6) * 4) + 0.06 * Math.sin((p.lon + 70.6) * 9);
  const north = Math.min(1, Math.max(0, (p.lat - edge) / 0.9));
  const range = Math.exp(-(((p.lat - 44.85) / 0.22) ** 2)) * Math.exp(-(((p.lon + 70.65) / 0.7) ** 2));
  // A knot of hills west of the field, above the dam.
  const knob = Math.exp(-(((p.lat - 44.25) / 0.1) ** 2) - (((p.lon + 71.15) / 0.15) ** 2));
  return Math.round(60 + 1100 * north + 2600 * range + 900 * knob);
}

const FIELDS: ChartAirport[] = [
  { id: 'KWVA', name: 'Westvale Regional', pos: HOME, elevationFt: 340, towered: true, runwayFt: 6000, surface: 'paved', runways: ['15', '33'], freq: '118.35', freqKind: 'Tower', atis: '127.65', fuel: true, tpaMsl: 1340 },
  { id: 'KWCP', name: 'Calder Point', pos: WCP, elevationFt: 40, towered: true, runwayFt: 8000, surface: 'paved', runways: ['09', '27', '18', '36'], freq: '119.75', freqKind: 'Tower', atis: '126.25', fuel: true, tpaMsl: 1040 },
  { id: 'KWLN', name: 'Lanmore', pos: WLN, elevationFt: 210, towered: false, runwayFt: 3800, surface: 'paved', runways: ['04', '22'], freq: '122.70', freqKind: 'CTAF', fuel: true, tpaMsl: 1210 },
  { id: 'KWFB', name: 'Fernbrook', pos: WFB, elevationFt: 760, towered: false, runwayFt: 2300, surface: 'grass', runways: ['01', '19'], freq: '122.95', freqKind: 'CTAF', fuel: false, tpaMsl: 1760 },
  { id: 'KWSL', name: 'Summit Lake', pos: WSL, elevationFt: 2050, towered: false, runwayFt: 3200, surface: 'paved', runways: ['12', '30'], freq: '123.05', freqKind: 'CTAF', fuel: false, tpaMsl: 3050 },
];

export const lakesRegion: Region = {
  id: 'lakes',
  name: 'Practice sectional 2, the lake country (not a real chart)',
  variationDeg: -16,
  bounds: { north: 45.15, south: 43.65, east: -69.7, west: -71.55 },
  airports: FIELDS,
  airspace: [
    { id: 'wva-d', name: 'KWVA Class D', cls: 'D', shape: { kind: 'circle', center: HOME, radiusNm: 4.2 }, floor: 'sfc', ceiling: { ft: 2800, ref: 'msl' }, note: 'Tower 118.35, 0700 to 2300 local. Class E when the tower is closed.' },
    { id: 'wcp-c1', name: 'Calder Point Class C, surface area', cls: 'C', shape: { kind: 'circle', center: WCP, radiusNm: 5 }, floor: 'sfc', ceiling: { ft: 4000, ref: 'msl' }, note: 'Calder Approach 125.35.' },
    { id: 'wcp-c2', name: 'Calder Point Class C, shelf', cls: 'C', shape: { kind: 'ring', center: WCP, innerNm: 5, outerNm: 10 }, floor: { ft: 1200, ref: 'msl' }, ceiling: { ft: 4000, ref: 'msl' } },
    { id: 'wln-e', name: 'Lanmore Class E surface area', cls: 'E', eKind: 'surface', shape: { kind: 'circle', center: WLN, radiusNm: 4 }, floor: 'sfc', ceiling: { ft: 17999, ref: 'msl' }, note: 'Weather minimums of controlled airspace start at the surface: 3 miles and 1,000 ft ceiling to land without a clearance.' },
    { id: 'wsl-e', name: 'Summit Lake Class E from 700 ft', cls: 'E', eKind: '700', shape: { kind: 'circle', center: WSL, radiusNm: 5 }, floor: { ft: 700, ref: 'agl' }, ceiling: { ft: 17999, ref: 'msl' } },
    { id: 'wfb-e', name: 'Fernbrook Class E from 700 ft', cls: 'E', eKind: '700', shape: { kind: 'circle', center: WFB, radiusNm: 4.5 }, floor: { ft: 700, ref: 'agl' }, ceiling: { ft: 17999, ref: 'msl' } },
    { id: 'a-561', name: 'A-561', cls: 'Alert', shape: { kind: 'polygon', points: boxAround(at(105, 20), 5, 6) }, floor: 'sfc', ceiling: { ft: 4500, ref: 'msl' }, note: 'High volume of flight training, 0700 to 2000 local. No clearance needed; extra vigilance.' },
    { id: 'kestrel-moa', name: 'Kestrel MOA', cls: 'MOA', shape: { kind: 'polygon', points: boxAround(at(30, 42), 9, 11) }, floor: { ft: 6000, ref: 'msl' }, ceiling: { ft: 17999, ref: 'msl' }, note: 'Active 0900 to 1700 local, Tuesday to Saturday. Contact Calder Approach 125.35 for status.' },
  ],
  veils: [],
  checkpoints: [
    { id: 'ashby', name: 'Ashby', pos: at(345, 10), kind: 'town', looksLike: 'A town at the south end of a lake, with a long pier and a white water tower.' },
    { id: 'sable-lake', name: 'Sable Lake', pos: at(350, 28), kind: 'lake', looksLike: 'A big lake shaped like a boot, the toe pointing east, an island in the middle.' },
    { id: 'notch', name: 'Kettle Notch', pos: at(358, 37), kind: 'highway', looksLike: 'A pass where the highway climbs between two summits, a ski area on the west side.' },
    { id: 'tower-2385', name: 'Lighted tower', pos: at(10, 33), kind: 'tower', looksLike: 'A lighted tower 2,385 MSL, 1,040 AGL, on the ridge east of the notch.' },
    { id: 'rail-yard', name: 'Rail yard', pos: at(80, 16), kind: 'highway', looksLike: 'A rail yard where three lines meet beside the river, long rows of freight cars.' },
    { id: 'harbor', name: 'Granger Harbor', pos: at(140, 18), kind: 'town', looksLike: 'A harbor town at the head of a bay, a breakwater and a lighthouse.' },
    { id: 'falls-dam', name: 'Cutler Falls dam', pos: at(255, 14), kind: 'dam', looksLike: 'A dam with a power station below it, the river narrow and white downstream.' },
  ],
  obstacles: [
    { id: 'tower-2385', pos: at(10, 33), mslFt: 2385, aglFt: 1040, lighted: true },
    { id: 'stack-2', pos: at(255, 14.5), mslFt: 720, aglFt: 480, lighted: true },
  ],
  groundFt: levelledGround(terrainFt, FIELDS),
};
