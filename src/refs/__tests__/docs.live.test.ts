// Live check against the FAA files: every catalog URL returns a PDF and every
// cited passage is found. Needs network to www.faa.gov, so it only runs with
// `npm run check-docs`.
import { describe, expect, it } from 'vitest';
import { DOCS } from '../catalog';
import { citedPassages } from '../resolve';
import { findPage } from '../search';

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CHECK_DOCS === '1';

describe.skipIf(!live)('FAA handbook files', () => {
  const texts = new Map<string, Promise<string[]>>();
  const pagesOf = (id: string) => {
    if (!texts.has(id)) {
      texts.set(id, (async () => {
        const res = await fetch(`https://www.faa.gov${DOCS[id].path}`);
        expect(res.ok, `${id}: HTTP ${res.status}`).toBe(true);
        const data = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        const out: string[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const tc = await (await doc.getPage(n)).getTextContent();
          out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
        }
        return out;
      })());
    }
    return texts.get(id)!;
  };

  for (const id of Object.keys(DOCS)) {
    it(`${id} is a PDF`, async () => {
      expect((await pagesOf(id)).length).toBeGreaterThan(0);
    }, 120_000);
  }
  for (const p of citedPassages().filter((l) => l.find)) {
    it(`${p.text} is found in ${p.doc}`, async () => {
      const hit = findPage(await pagesOf(p.doc), p.find!);
      expect(hit, `${p.find!.join(' | ')}`).not.toBeNull();
      console.log(`${p.text}: page ${hit!.page} ("${hit!.phrase}")`);
    }, 120_000);
  }
});
