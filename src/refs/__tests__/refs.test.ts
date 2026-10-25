import { describe, expect, it } from 'vitest';
import { resolveRef } from '../resolve';
import { DOCS } from '../catalog';
import { findPage, hitItems, looksLikeContents } from '../search';

// Every reference label written anywhere in the content, read from source so
// a new label cannot slip in without resolving.
function labelsInSource(): string[] {
  const files = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/__tests__/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const out = new Set<string>();
  for (const src of Object.values(files)) {
    for (const m of src.matchAll(/\b(?:refs|ref): *(\[[^\]]*\]|'(?:[^'\\]|\\.)*')/g)) {
      for (const s of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) out.add(s[1].replace(/\\'/g, "'"));
    }
  }
  return [...out];
}

describe('reference resolver', () => {
  it('links regulations to eCFR, with the paragraph', () => {
    expect(resolveRef('14 CFR 91.155(c)')).toEqual([
      { kind: 'web', text: '14 CFR 91.155(c)', href: 'https://www.ecfr.gov/current/title-14/part-91/section-91.155#p-91.155(c)' },
    ]);
  });
  it('carries "14 CFR" across a list and keeps glosses', () => {
    const r = resolveRef('14 CFR 91.155 and 91.157, special VFR');
    expect(r.map((l) => l.text)).toEqual(['14 CFR 91.155', '91.157, special VFR']);
    expect(r[1].kind === 'web' && r[1].href).toContain('section-91.157');
  });
  it('links the AIM by section and handbooks to the viewer', () => {
    const r = resolveRef('14 CFR 91.129, AIM 3-2-5');
    expect(r[1]).toMatchObject({ kind: 'web', href: expect.stringContaining('chap3_section_2.html') });
    expect(resolveRef('PHAK ch. 4 and 11').map((l) => l.kind === 'doc' && l.doc)).toEqual(['phak-4', 'phak-11']);
    expect(resolveRef('Aviation Weather Handbook (FAA-H-8083-28), TAF')[0]).toMatchObject({ kind: 'doc', doc: 'awh' });
  });
  it('resolves every label in the course to something that opens', () => {
    const labels = labelsInSource();
    expect(labels.length).toBeGreaterThan(20);
    for (const label of labels) {
      const links = resolveRef(label);
      expect(links.length, label).toBeGreaterThan(0);
      for (const l of links) {
        if (l.kind === 'doc') expect(DOCS[l.doc], `${label} → ${l.doc}`).toBeDefined();
        if (l.kind === 'text') expect(label, 'only the POH is left unlinked').toMatch(/^POH\b/);
      }
    }
  });
});

describe('passage search', () => {
  const pages = [
    'Contents Terminal Aerodrome Forecast (TAF) ........ 4 Fog ........ 9 METAR ........ 2 Winds ........ 5 Icing ........ 7',
    'METAR decoding starts here.',
    'Something else',
    'Terminal Aerodrome Forecast (TAF) A TAF is a concise statement',
  ];
  it('skips the contents page and prefers the specific phrase', () => {
    expect(looksLikeContents(pages[0])).toBe(true);
    expect(findPage(pages, ['Terminal Aerodrome Forecast (TAF)', 'TAF'])).toEqual({ page: 4, phrase: 'Terminal Aerodrome Forecast (TAF)' });
    expect(findPage(pages, ['Not here', 'METAR'])).toEqual({ page: 2, phrase: 'METAR' });
    expect(findPage(pages, ['Not here'])).toBeNull();
  });
  it('highlights a phrase split across text items', () => {
    expect(hitItems(['Chapter', 'Crosswind and', 'Headwind Component', 'Chart'], 'crosswind and headwind component')).toEqual([1, 2]);
  });
});
