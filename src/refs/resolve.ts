// Turns the reference labels written in lessons and findings ("14 CFR 91.155(c)",
// "AIM 7-1", "PHAK ch. 4 and 11") into things the reader can open. Regulations
// and the AIM link out to their per-section pages; handbooks open in the
// in-app viewer at the passage.

import { DOCS } from './catalog';

export type RefLink =
  | { kind: 'web'; text: string; href: string }
  | { kind: 'doc'; text: string; doc: string; /** Phrases to search for, first hit wins. */ find?: string[]; page?: number }
  | { kind: 'text'; text: string };

const doc = (text: string, id: string, find?: string[]): RefLink => ({ kind: 'doc', text, doc: id, find });

const AWH_METAR = ['Aviation Routine Weather Report (METAR)', 'METAR'];
const AWH_TAF = ['Terminal Aerodrome Forecast (TAF)', 'Terminal Aerodrome Forecast'];
const AWH_FOG = ['Radiation Fog', 'Fog'];
const RMH_MINS = ['Personal Minimums'];
const XWIND_CHART = ['Crosswind and Headwind Component', 'Crosswind Component'];
const AFH_XW_LANDING = ['Crosswind Approach and Landing'];
const AFH_XW_TAKEOFF = ['Crosswind Takeoff'];
const PHAK_DOCS = ['Aircraft Documents', 'Certificate of Aircraft Registration'];
const PHAK_INSPECTIONS = ['Aircraft Inspections', 'Annual Inspection'];
const PHAK_INOP = ['Operations With Inoperative Equipment', 'Inoperative Equipment'];
const AWH_FB = ['Winds and Temperatures Aloft Forecast', 'Winds and Temperatures Aloft'];
const PHAK_FLIGHT_PLANNING = ['Charting the Course', 'Flight Planning'];
const PHAK_WIND_TRIANGLE = ['The Wind Triangle or Vector Analysis', 'Wind Triangle'];
const PHAK_DIVERSION = ['Flight Diversion', 'Diversion'];
const PHAK_LOST = ['Lost Procedures'];
const AFH_EFATO = ['Engine Failure After Takeoff (Single-Engine)', 'Engine Failure After Takeoff'];
const AFH_TERRAIN = ['Terrain Selection'];
const AFH_FIRE = ['In-Flight Fire', 'Engine Fire'];
const AFH_DESCENT = ['Emergency Descents'];
const AFH_LANDINGS = ['Basic Safety Concepts', 'Emergency Landings'];
const AFH_LANDING_TYPES = ['Types of Emergency Landings', 'Precautionary landing'];

// Handbook passages, by the exact label used in content. A unit test checks
// that every label in the course resolves, so a new label without an entry
// shows up there rather than as a dead chip.
const PASSAGES: Record<string, RefLink[]> = {
  "Pilot's Handbook of Aeronautical Knowledge (FAA-H-8083-25), crosswind components": [doc('PHAK, crosswind components', 'phak-11', XWIND_CHART)],
  'Airplane Flying Handbook (FAA-H-8083-3), crosswind approach and landing': [doc('AFH, crosswind approach and landing', 'afh-9', AFH_XW_LANDING)],
  'AFH, crosswind takeoff and landing': [doc('AFH, crosswind takeoff', 'afh-6', AFH_XW_TAKEOFF), doc('AFH, crosswind landing', 'afh-9', AFH_XW_LANDING)],
  'Airplane Flying Handbook (FAA-H-8083-3), engine failure after takeoff': [doc('AFH, engine failure after takeoff', 'afh-18', AFH_EFATO)],
  'Airplane Flying Handbook (FAA-H-8083-3), terrain selection': [doc('AFH, terrain selection', 'afh-18', AFH_TERRAIN)],
  'Airplane Flying Handbook (FAA-H-8083-3), in-flight fire': [doc('AFH, in-flight fire', 'afh-18', AFH_FIRE)],
  'Airplane Flying Handbook (FAA-H-8083-3), emergency descents': [doc('AFH, emergency descents', 'afh-18', AFH_DESCENT)],
  'Airplane Flying Handbook (FAA-H-8083-3), emergency landings': [doc('AFH, emergency landings', 'afh-18', AFH_LANDINGS)],
  'Airplane Flying Handbook (FAA-H-8083-3), types of emergency landings': [doc('AFH, types of emergency landings', 'afh-18', AFH_LANDING_TYPES)],
  'Aviation Weather Handbook (FAA-H-8083-28), METAR': [doc('Aviation Weather Handbook, METAR', 'awh', AWH_METAR)],
  'Aviation Weather Handbook (FAA-H-8083-28), TAF': [doc('Aviation Weather Handbook, TAF', 'awh', AWH_TAF)],
  'Aviation Weather Handbook, TAF section': [doc('Aviation Weather Handbook, TAF', 'awh', AWH_TAF)],
  'Aviation Weather Handbook (FAA-H-8083-28), fog': [doc('Aviation Weather Handbook, fog', 'awh', AWH_FOG)],
  'Aviation Weather Handbook (FAA-H-8083-28)': [doc('Aviation Weather Handbook', 'awh')],
  'Aviation Weather Handbook': [doc('Aviation Weather Handbook', 'awh')],
  'Risk Management Handbook (FAA-H-8083-2), personal minimums': [doc('Risk Management Handbook, personal minimums', 'rmh', RMH_MINS)],
  'Risk Management Handbook, personal minimums': [doc('Risk Management Handbook, personal minimums', 'rmh', RMH_MINS)],
  'AIM ch. 7, thunderstorm flying': [aim('AIM 7-1, thunderstorm flying', 7, 1)],
  'PHAK ch. 9, aircraft documents': [doc('PHAK, aircraft documents', 'phak-9', PHAK_DOCS)],
  'PHAK ch. 9, inspections': [doc('PHAK, aircraft inspections', 'phak-9', PHAK_INSPECTIONS)],
  'PHAK ch. 9, inoperative equipment': [doc('PHAK, inoperative equipment', 'phak-9', PHAK_INOP)],
  'PHAK, electrical system': [doc('PHAK, electrical system', 'phak-7', ['Electrical System'])],
  'PHAK, carburetor icing': [doc('PHAK, carburetor icing', 'phak-7', ['Carburetor Icing'])],
  'PHAK, fuel systems': [doc('PHAK, fuel systems', 'phak-7', ['Fuel Systems'])],
  'PHAK, gyroscopic instruments': [doc('PHAK, gyroscopic instruments', 'phak-8', ['Gyroscopic Flight Instruments'])],
  'PHAK, blocked pitot-static system': [doc('PHAK, blocked pitot-static system', 'phak-8', ['Blockage of the Pitot-Static System'])],
  'PHAK, pilotage and dead reckoning': [doc('PHAK, pilotage', 'phak-16', ['Pilotage']), doc('PHAK, dead reckoning', 'phak-16', ['Dead Reckoning'])],
  'PHAK, GPS': [doc('PHAK, GPS', 'phak-16', ['Global Positioning System (GPS)'])],
  'Aviation Weather Handbook, winds aloft': [doc('Aviation Weather Handbook, winds aloft', 'awh', AWH_FB)],
  'PHAK, flight planning': [doc('PHAK, flight planning', 'phak-16', PHAK_FLIGHT_PLANNING)],
  'PHAK, wind triangle': [doc('PHAK, wind triangle', 'phak-16', PHAK_WIND_TRIANGLE)],
  'PHAK, flight diversion': [doc('PHAK, flight diversion', 'phak-16', PHAK_DIVERSION)],
  'PHAK, lost procedures': [doc('PHAK, lost procedures', 'phak-16', PHAK_LOST)],
  'PHAK, hazardous attitudes': [doc('PHAK, hazardous attitudes', 'phak-2', ['Hazardous Attitudes and Antidotes', 'Hazardous Attitudes'])],
  'PHAK, the PAVE checklist': [doc('PHAK, the PAVE checklist', 'phak-2', ['The PAVE Checklist', 'PAVE Checklist'])],
  'PHAK, operational pitfalls': [doc('PHAK, operational pitfalls', 'phak-2', ['Operational Pitfalls'])],
  'PHAK, hypoxia': [doc('PHAK, hypoxia', 'phak-17', ['Hypoxia'])],
  'PHAK, fatigue': [doc('PHAK, fatigue', 'phak-17', ['Fatigue'])],
  'PHAK, drugs': [doc('PHAK, drugs and dosing intervals', 'phak-17', ['maximal dosing', 'Drugs'])],
  '14 CFR 43 appendix A': [{ kind: 'web', text: '14 CFR 43 appendix A, preventive maintenance', href: 'https://www.ecfr.gov/current/title-14/part-43/appendix-Appendix%20A%20to%20Part%2043' }],
  'UK CAA SafetySense 9, weight, balance and performance': [{ kind: 'web', text: 'UK CAA SafetySense 9, weight, balance and performance', href: 'https://www.caa.co.uk/media/wcebqozv/ssl09-caa-safety-sense-weight-balance-and-performance.pdf' }],
  'PHAK, night vision': [doc('PHAK, night vision', 'phak-17', ['Night Vision'])],
};

/** Every handbook passage the course cites, for the live check against the FAA files. */
export function citedPassages(): Extract<RefLink, { kind: 'doc' }>[] {
  return Object.values(PASSAGES).flat().filter((l): l is Extract<RefLink, { kind: 'doc' }> => l.kind === 'doc');
}

/** Labels that name something we cannot link, such as the pilot's own POH. */
const UNLINKED = /^POH\b/;

function aim(text: string, chapter: number, section: number): RefLink {
  return { kind: 'web', text, href: `https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap${chapter}_section_${section}.html` };
}

function cfr(text: string, section: string, para?: string): RefLink {
  const part = section.split('.')[0];
  const anchor = para ? `#p-${section}${para}` : '';
  return { kind: 'web', text, href: `https://www.ecfr.gov/current/title-14/part-${part}/section-${section}${anchor}` };
}

export function resolveRef(label: string): RefLink[] {
  const known = PASSAGES[label];
  if (known) return known;
  if (UNLINKED.test(label)) return [{ kind: 'text', text: label }];

  const out: RefLink[] = [];
  // What a bare number continues: "14 CFR 91.9, 91.203" or "PHAK ch. 4 and 11".
  let ctx: 'cfr' | 'phak' | null = null;
  for (const raw of label.split(/,\s*|\s+and\s+/)) {
    const part = raw.trim();
    if (!part) continue;
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^14 CFR (\d+\.\d+)(\([a-z0-9]+\))?$/))) {
      out.push(cfr(part, m[1], m[2]));
      ctx = 'cfr';
    } else if (ctx === 'cfr' && (m = part.match(/^(\d+\.\d+)(\([a-z0-9]+\))?$/))) {
      out.push(cfr(part, m[1], m[2]));
    } else if ((m = part.match(/^AIM (\d+)-(\d+)(?:-(\d+))?$/))) {
      out.push(aim(part, Number(m[1]), Number(m[2])));
      ctx = null;
    } else if ((m = part.match(/^PHAK ch\. (\d+)$/)) || (ctx === 'phak' && (m = part.match(/^(\d+)$/)))) {
      const id = `phak-${m[1]}`;
      out.push(DOCS[id] ? doc(DOCS[id].short, id) : { kind: 'text', text: part });
      ctx = 'phak';
    } else if (PASSAGES[part]) {
      out.push(...PASSAGES[part]);
      ctx = null;
    } else if (out.length) {
      // A gloss on the previous reference, like "14 CFR 91.103, preflight action".
      const prev = out[out.length - 1];
      out[out.length - 1] = { ...prev, text: `${prev.text}, ${part}` };
    } else {
      out.push({ kind: 'text', text: part });
    }
  }
  return out;
}
