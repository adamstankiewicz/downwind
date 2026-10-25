// Finding a passage in a handbook by text, so a reference survives the FAA
// repaginating a chapter. Pure functions; the viewer feeds them page text.

export const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** Contents and index pages mention every heading; skip them when searching. */
export function looksLikeContents(pageText: string): boolean {
  const leaders = pageText.match(/\.{4,}|(?:\. ){4,}/g)?.length ?? 0;
  return leaders >= 5 || /\btable of contents\b/i.test(pageText);
}

/**
 * The first page (1-based) whose text holds one of the phrases, trying the
 * phrases in order so a specific heading beats a generic word.
 */
export function findPage(pages: string[], phrases: string[]): { page: number; phrase: string } | null {
  const texts = pages.map(norm);
  for (const phrase of phrases) {
    const p = norm(phrase);
    const i = texts.findIndex((t, idx) => t.includes(p) && !looksLikeContents(pages[idx]));
    if (i >= 0) return { page: i + 1, phrase };
  }
  return null;
}

/**
 * Which text items (by index) cover the phrase on a page, for highlighting.
 * Items are joined the way pdf.js lays them out, so a phrase split across
 * items still matches.
 */
export function hitItems(items: string[], phrase: string): number[] {
  const p = norm(phrase);
  let joined = '';
  const starts: number[] = [];
  for (const s of items) {
    starts.push(joined.length);
    joined += norm(s) + ' ';
  }
  const hits = new Set<number>();
  let from = 0;
  for (;;) {
    const at = joined.indexOf(p, from);
    if (at < 0) break;
    const end = at + p.length;
    starts.forEach((st, i) => {
      const en = i + 1 < starts.length ? starts[i + 1] : joined.length;
      if (st < end && en > at && items[i].trim()) hits.add(i);
    });
    from = end;
  }
  return [...hits].sort((a, b) => a - b);
}
