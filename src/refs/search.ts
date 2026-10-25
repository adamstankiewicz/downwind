// Finding a passage in a handbook by text, so a reference survives the FAA
// repaginating a chapter. Pure functions; the viewer feeds them page text.

export const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * Contents and index pages mention every heading; skip them when searching.
 * A contents line is dot leaders ending in a page number ("6 - 4", "3-13").
 * Worked examples also use leaders ("OAT........70 °F", "Weight....2,600
 * pounds"), so leaders followed by a measured value don't count.
 */
const PAGE_LEADER = /(?:\.\s?){4,}\s*\d+(?:\s*-\s*\d+)?(?![\d,.]|\s*(?:°|"|%|feet|ft|pounds|lb|knots|kts|in|mph|gal))/g;

export function looksLikeContents(pageText: string): boolean {
  const leaders = pageText.match(PAGE_LEADER)?.length ?? 0;
  return leaders >= 5 || /\btable of contents\b/i.test(pageText);
}

/** Same spacing and dashes as `norm`, but keeps case, so a Title Case heading can be told from prose. */
const tidy = (s: string) => s.replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** Where `p` occurs in `t` other than inside a cross-reference such as 'see the “Crosswind Takeoff” section'. */
function holds(t: string, p: string): boolean {
  for (let at = t.indexOf(p); at >= 0; at = t.indexOf(p, at + 1)) {
    if (!/[“"‘']$/.test(t.slice(Math.max(0, at - 2), at).trimEnd())) return true;
  }
  return false;
}

/**
 * The first page (1-based) whose text holds one of the phrases, trying the
 * phrases in order so a specific heading beats a generic word. For each
 * phrase a match in the phrase's own case (a heading) wins over a lowercase
 * mention in a preface or summary.
 */
export function findPage(pages: string[], phrases: string[]): { page: number; phrase: string } | null {
  const exact = pages.map(tidy);
  const loose = pages.map(norm);
  const ok = (idx: number) => !looksLikeContents(pages[idx]);
  for (const phrase of phrases) {
    let i = exact.findIndex((t, idx) => holds(t, tidy(phrase)) && ok(idx));
    if (i < 0) i = loose.findIndex((t, idx) => holds(t, norm(phrase)) && ok(idx));
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
