// In-app handbook viewer. Opens a cited FAA handbook at the passage: it searches
// the PDF's text for the cited heading, renders that page with pdf.js, and
// highlights the words. pdf.js is loaded only when a reader opens a book.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DOCS, docUrl } from './catalog';
import { resolveRef, type RefLink } from './resolve';
import { findPage, hitItems } from './search';

type DocLink = Extract<RefLink, { kind: 'doc' }>;

const RefContext = createContext<(link: DocLink) => void>(() => {});

export function RefProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<DocLink | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((link: DocLink) => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(link);
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);
  return (
    <RefContext.Provider value={show}>
      {children}
      {open && <RefViewer link={open} onClose={close} />}
    </RefContext.Provider>
  );
}

/** A small book: the chip opens the handbook here, in the app. */
const BookGlyph = () => (
  <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M2 3.2C3.6 2.4 5.9 2.5 8 3.6c2.1-1.1 4.4-1.2 6-.4v9.6c-1.6-.8-3.9-.7-6 .4-2.1-1.1-4.4-1.2-6-.4V3.2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 3.6v9.6" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

/** Reference chips for a list of labels. Handbooks open in the viewer; regulations and the AIM open their own pages. */
export function RefChips({ refs }: { refs: string[] }) {
  const show = useContext(RefContext);
  return (
    <>
      {refs.flatMap((label) => resolveRef(label).map((l, i) => {
        const key = `${label}-${i}`;
        if (l.kind === 'web') return <a key={key} className="chip ref" href={l.href} target="_blank" rel="noopener noreferrer">{l.text}<span className="ext" aria-label=" (opens a new tab)">↗</span></a>;
        if (l.kind === 'doc') return <button key={key} type="button" className="chip ref book" onClick={() => show(l)}><BookGlyph />{l.text}</button>;
        return <span key={key} className="chip">{l.text}</span>;
      }))}
    </>
  );
}

type Pdfjs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<Pdfjs> | null = null;
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsPromise;
}

const FOUND_KEY = 'downwind.refs.found.v1';
function rememberedPage(key: string): number | null {
  try {
    return (JSON.parse(localStorage.getItem(FOUND_KEY) ?? '{}') as Record<string, number>)[key] ?? null;
  } catch {
    return null;
  }
}
function rememberPage(key: string, page: number) {
  try {
    const all = JSON.parse(localStorage.getItem(FOUND_KEY) ?? '{}') as Record<string, number>;
    all[key] = page;
    localStorage.setItem(FOUND_KEY, JSON.stringify(all));
  } catch {
    // Storage is a convenience here; the search simply runs again next time.
  }
}

type Status =
  | { s: 'loading' }
  | { s: 'finding'; done: number; of: number }
  | { s: 'ready' }
  | { s: 'error' };

/** Zoom steps over fit-to-width. */
const ZOOMS = [1, 1.5, 2] as const;

/** The passage part of a chip label: "Aviation Weather Handbook, METAR" cites "METAR". */
function passageOf(text: string): string | null {
  const i = text.indexOf(', ');
  return i > 0 ? text.slice(i + 2) : null;
}

function RefViewer({ link, onClose }: { link: DocLink; onClose: () => void }) {
  const src = DOCS[link.doc];
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [lib, setLib] = useState<Pdfjs | null>(null);
  const [page, setPage] = useState(1);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const [status, setStatus] = useState<Status>({ s: 'loading' });
  const [zoomIx, setZoomIx] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const titleId = `refv-${link.doc}`;
  const passage = passageOf(link.text);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Load the book, then find the passage.
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ url: docUrl(link.doc), isEvalSupported: false, disableRange: true, disableStream: true }).promise;
        if (cancelled) return;
        setLib(pdfjs);
        setPdf(doc);
        if (link.page) {
          setPage(Math.min(link.page, doc.numPages));
        } else if (link.find?.length) {
          const key = `${link.doc}|${link.find.join('|')}`;
          const known = rememberedPage(key);
          if (known && known <= doc.numPages) {
            setPage(known);
            setPhrase(link.find.find(Boolean) ?? null);
          } else {
            const texts: string[] = [];
            for (let n = 1; n <= doc.numPages; n++) {
              const tc = await (await doc.getPage(n)).getTextContent();
              if (cancelled) return;
              texts.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
              // Stop early once the most specific phrase turns up.
              const hit = findPage(texts, link.find.slice(0, 1));
              if (hit) break;
              if (n % 8 === 0) setStatus({ s: 'finding', done: n, of: doc.numPages });
            }
            const hit = findPage(texts, link.find);
            if (hit) {
              setPage(hit.page);
              rememberPage(key, hit.page);
            } else {
              setMissed(true);
            }
          }
        }
        setStatus({ s: 'ready' });
      } catch {
        if (!cancelled) setStatus({ s: 'error' });
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [link]);

  // Phrase to highlight on the current page: the first of the cited phrases it holds.
  useEffect(() => {
    if (!link.find?.length || !pdf) return;
    let cancelled = false;
    (async () => {
      const tc = await (await pdf.getPage(page)).getTextContent();
      if (cancelled) return;
      const text = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ');
      setPhrase(findPage([text], link.find!)?.phrase ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page, link.find]);

  // Render the page to fit the stage width, times the zoom, with a text layer for selection and highlights.
  useEffect(() => {
    if (!pdf || !lib || status.s !== 'ready' || !stage.current) return;
    const host = stage.current;
    const zoom = ZOOMS[zoomIx];
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    let textLayer: { cancel(): void } | null = null;
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const cs = getComputedStyle(host);
      const inner = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const scale = Math.max(0.5, (inner - 2) / base.width) * zoom;
      const viewport = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sheet = document.createElement('div');
      sheet.className = 'refv-sheet';
      sheet.style.width = `${viewport.width}px`;
      sheet.style.height = `${viewport.height}px`;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute('aria-hidden', 'true');
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      layer.style.setProperty('--scale-factor', String(scale));
      sheet.append(canvas, layer);
      const render = p.render({ canvasContext: canvas.getContext('2d')!, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = render;
      await render.promise;
      if (cancelled) return;
      const tc = await p.getTextContent();
      const tl = new lib.TextLayer({ textContentSource: tc, container: layer, viewport });
      textLayer = tl;
      await tl.render();
      if (cancelled) return;
      host.replaceChildren(sheet);
      if (phrase) {
        const items = tc.items.filter((it) => 'str' in it).map((it) => ('str' in it ? it.str : ''));
        const hits = hitItems(items, phrase);
        hits.forEach((i) => tl.textDivs[i]?.classList.add('hit'));
        const first = tl.textDivs[hits[0]];
        if (first) {
          // A pencil tick in the margin, level with the highlighted line.
          const pin = document.createElement('i');
          pin.className = 'refv-pin';
          pin.setAttribute('aria-hidden', 'true');
          pin.style.top = `${first.offsetTop}px`;
          pin.style.height = `${Math.max(first.offsetHeight, 8)}px`;
          sheet.append(pin);
          host.scrollTo({
            top: Math.max(0, sheet.offsetTop + first.offsetTop - 72),
            left: Math.max(0, sheet.offsetLeft + first.offsetLeft - 48),
          });
        }
      } else {
        host.scrollTo({ top: 0, left: 0 });
      }
    })().catch(() => {
      // A cancelled render rejects; nothing to show for it.
    });
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, lib, page, phrase, status.s, zoomIx]);

  const n = pdf?.numPages ?? 0;
  const zoom = ZOOMS[zoomIx];
  return (
    <div className="refv" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="refv-panel">
        <header className="refv-head">
          <div className="refv-title">
            {passage && <span className="refv-tab"><i aria-hidden="true" />{passage}</span>}
            <h2 id={titleId}>{src?.title ?? 'Handbook'}</h2>
            <p className="refv-meta">
              {src?.chapter && <span className="refv-ch">{src.chapter}</span>}
              {src?.edition && <span className="refv-ed">{src.edition}</span>}
              {src && <a className="refv-faa" href={src.landing} target="_blank" rel="noopener noreferrer">Open at the FAA<span className="ext" aria-label=" (opens a new tab)">↗</span></a>}
            </p>
          </div>
          <button ref={closeBtn} type="button" className="btn quiet refv-close" onClick={onClose}>Close</button>
        </header>
        <div className="refv-bar">
          <div className="refv-nav">
            <button type="button" className="btn quiet" disabled={!pdf || page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
            <span className="refv-page" aria-live="polite">{n ? <>Page <b>{page}</b> of {n}</> : ' '}</span>
            <button type="button" className="btn quiet" disabled={!pdf || page >= n} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
          </div>
          <div className="refv-zoom" role="group" aria-label="Zoom">
            <button type="button" className="btn quiet" disabled={status.s !== 'ready' || zoomIx <= 0} onClick={() => setZoomIx(zoomIx - 1)} aria-label="Zoom out">−</button>
            <button type="button" className="btn quiet refv-fit" disabled={status.s !== 'ready'} aria-pressed={zoomIx === 0} onClick={() => setZoomIx(0)}>
              {zoomIx === 0 ? 'Fit width' : `${zoom * 100}%`}
            </button>
            <button type="button" className="btn quiet" disabled={status.s !== 'ready' || zoomIx >= ZOOMS.length - 1} onClick={() => setZoomIx(zoomIx + 1)} aria-label="Zoom in">+</button>
          </div>
        </div>
        {missed && status.s === 'ready' && <p className="refv-note">Couldn't find “{link.find?.[0]}” in this edition, so this opens at the start.</p>}
        {status.s !== 'ready' && (
          <div className="refv-wait">
            <div className={`refv-blank${status.s === 'error' ? ' err' : ''}`} aria-hidden={status.s !== 'error'}>
              {status.s === 'error' ? (
                <div className="refv-err">
                  <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                    <path d="M10 6h20l8 8v28H10z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="M30 6v8h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="M18 23h12M18 29h12M18 35h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 3" />
                  </svg>
                  <p><b>This handbook isn't on this device yet.</b></p>
                  <p>Open it once while you're online and it stays available offline.</p>
                  {src && <a className="btn" href={src.landing} target="_blank" rel="noopener noreferrer">Open at the FAA<span className="ext" aria-label=" (opens a new tab)">↗</span></a>}
                </div>
              ) : (
                <>
                  <i className="t" /><i /><i /><i className="s" /><i /><i /><i className="s" />
                </>
              )}
            </div>
            {status.s === 'loading' && <p className="refv-msg" role="status">Opening {src?.short ?? 'the handbook'}…</p>}
            {status.s === 'finding' && (
              <div className="refv-msg" role="status">
                <span>Finding the passage, page {status.done} of {status.of}…</span>
                <span className="refv-prog" aria-hidden="true"><i style={{ width: `${Math.round((status.done / status.of) * 100)}%` }} /></span>
              </div>
            )}
          </div>
        )}
        {/* pdf.js draws into this node directly, so React keeps no children in it. */}
        <div className="refv-stage" ref={stage} hidden={status.s !== 'ready'} />
      </div>
    </div>
  );
}
