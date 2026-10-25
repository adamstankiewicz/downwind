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

// Handbook passages, by the exact label used in content. A unit test checks
// that every label in the course resolves, so a new label without an entry
// shows up there rather than as a dead chip.
const PASSAGES: Record<string, RefLink[]> = {
  "Pilot's Handbook of Aeronautical Knowledge (FAA-H-8083-25), crosswind components": [doc('PHAK, crosswind components', 'phak-11', XWIND_CHART)],
  'Airplane Flying Handbook (FAA-H-8083-3), crosswind approach and landing': [doc('AFH, crosswind approach and landing', 'afh-9', AFH_XW_LANDING)],
  'AFH, crosswind takeoff and landing': [doc('AFH, crosswind takeoff', 'afh-6', AFH_XW_TAKEOFF), doc('AFH, crosswind landing', 'afh-9', AFH_XW_LANDING)],
  'Aviation Weather Handbook (FAA-H-8083-28), METAR': [doc('Aviation Weather Handbook, METAR', 'awh', AWH_METAR)],
  'Aviation Weather Handbook (FAA-H-8083-28), TAF': [doc('Aviation Weather Handbook, TAF', 'awh', AWH_TAF)],
  'Aviation Weather Handbook, TAF section': [doc('Aviation Weather Handbook, TAF', 'awh', AWH_TAF)],
  'Aviation Weather Handbook (FAA-H-8083-28), fog': [doc('Aviation Weather Handbook, fog', 'awh', AWH_FOG)],
  'Aviation Weather Handbook (FAA-H-8083-28)': [doc('Aviation Weather Handbook', 'awh')],
  'Aviation Weather Handbook': [doc('Aviation Weather Handbook', 'awh')],
  'Risk Management Handbook (FAA-H-8083-2), personal minimums': [doc('Risk Management Handbook, personal minimums', 'rmh', RMH_MINS)],
  'Risk Management Handbook, personal minimums': [doc('Risk Management Handbook, personal minimums', 'rmh', RMH_MINS)],
  'AIM ch. 7, thunderstorm flying': [aim('AIM 7-1, thunderstorm flying', 7, 1)],
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
