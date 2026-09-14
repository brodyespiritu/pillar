import { useEffect, useRef, useState, useCallback } from 'react';
import { P, Icon } from '../lib/icons';
import {
  printFrame, savePdf, saveDocsPdf, isDesktopApp, printsPortraitOnly, declaresLandscape,
  keepTogetherSpans, pageBreaks, PAGE_W, PAGE_H, PDF_MARGIN,
} from '../lib/printDoc';
import './DocPreviewModal.css';

/*
 * In-app preview of a generated document, with printing done here rather than
 * in a pop-up. The same iframe is both the preview and the print source, so
 * what you see is exactly what comes out.
 *
 * The desktop app can't raise a print dialog — the Tauri webview's
 * window.print() is a no-op — so there the primary action saves a PDF instead
 * of appearing to do nothing.
 */
export default function DocPreviewModal({ html, docs, filename = 'pillar-document', title = 'Preview',
  landscape, onClose }) {
  /*
   * Either one document, or several stacked into one file (a Meeting Flow).
   * With several, the preview shows one section at a time — each keeps its own
   * page orientation — while Save and Print produce the whole stack.
   */
  const multi = Array.isArray(docs) && docs.length > 0;
  const [section, setSection] = useState(0);
  const active = multi ? docs[Math.min(section, docs.length - 1)] : { html, landscape };
  const shownHtml = active.html;
  // Unless the caller says otherwise, the document's own @page rule decides.
  const shownLandscape = active.landscape ?? declaresLandscape(shownHtml);

  // A landscape sheet is the letter page turned on its side.
  const pageW = shownLandscape ? PAGE_H : PAGE_W;
  const pageH = shownLandscape ? PAGE_W : PAGE_H;
  const frameRef = useRef(null);
  const wrapRef = useRef(null);
  const running = useRef(false);   // synchronous latch — see run()
  const [scale, setScale] = useState(1);
  const [docH, setDocH] = useState(pageH);      // measured content height
  const [docW, setDocW] = useState(pageW);      // some documents are wider than the sheet
  const [contentH, setContentH] = useState(0);  // the document itself, without the sheet's minimum
  const [keep, setKeep] = useState([]);         // rows and cards it keeps whole across pages
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const desktop = isDesktopApp();
  const portraitOnly = printsPortraitOnly();

  // Fit the document — whatever width it is — to the room the modal has.
  const fit = useCallback(width => {
    const w = wrapRef.current?.clientWidth;
    if (w) setScale(Math.min(1, (w - 48) / (width || docW)));
  }, [docW]);
  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  /*
   * Grow the iframe to its full content height. Reading this off the ref during
   * render never updated, so anything past the first screen was clipped by the
   * page wrapper's overflow — multi-page documents showed only page one.
   * Images and fonts settle after load, so measure again shortly after.
   */
  const measure = useCallback(() => {
    const f = frameRef.current;
    const b = f?.contentDocument?.body;
    if (!b) return;
    // A wide document (e.g. the care table) is laid out past letter width and
    // scaled down when printed — measure it rather than assuming 816px.
    const w = Math.max(b.scrollWidth, b.offsetWidth, pageW);
    const h = Math.max(b.scrollHeight, b.offsetHeight, pageH);
    f.style.width = `${w}px`;
    f.style.height = `${h}px`;
    setDocW(w);
    setDocH(h);
    setContentH(Math.max(b.scrollHeight, b.offsetHeight));
    setKeep(keepTogetherSpans(f.contentDocument));
    fit(w);
  }, [fit, pageW, pageH]);

  function onFrameLoad() {
    measure();
    setTimeout(measure, 250);
    setTimeout(measure, 800);
  }

  /*
   * The disabled attribute is not enough on its own: setBusy doesn't apply
   * until React re-renders, so a double-click lands a second call first and
   * saves a second PDF. Latch synchronously on a ref instead.
   */
  async function run(action) {
    const f = frameRef.current;
    if (!f || running.current) return;
    running.current = true;
    setBusy(action);
    setNote('');
    try {
      /* A multi-section flow is always saved as one file — there is no frame
         holding all of it, and printing section-by-section defeats the point. */
      const how = multi
        ? (await saveDocsPdf(docs, filename), 'saved-pdf')
        : action === 'print'
        ? await printFrame(f, { filename, html: shownHtml, landscape: shownLandscape })
        : await savePdf(f, { filename, html: shownHtml, landscape: shownLandscape });
      if (how === 'saved-pdf')  setNote(`Saved ${filename}.pdf to your Downloads folder.`);
      if (how === 'downloaded') setNote('Could not build the PDF — the document was downloaded as HTML instead.');
    } finally {
      running.current = false;
      setBusy('');
    }
  }

  // Printing scales the document to the sheet inside its margins, so one page
  // covers this many document pixels vertically. Pages then break where the
  // saved PDF breaks them: never through a row the document keeps whole.
  const inset = PDF_MARGIN * 2 * (96 / 72);
  const pageSpan = (pageH - inset) * (docW / (pageW - inset));
  const breaks = pageBreaks(contentH, pageSpan, keep);
  const pages = breaks.length + 1;

  return (
    <div className="dpv-overlay" onClick={() => !busy && onClose()}>
      <div className="dpv" onClick={e => e.stopPropagation()}>
        <header className="dpv-head">
          <h2>{title}<span className="dpv-pages">
            {multi ? `${docs.length} sections` : `${pages} ${pages === 1 ? 'page' : 'pages'}`}
          </span></h2>
          <div className="dpv-actions">
            <button className="dpv-btn ghost" onClick={() => run('save')} disabled={!!busy}>
              <Icon d={P.pdf} size={15} />{busy === 'save' ? 'Building…' : 'Save PDF'}
            </button>
            {/* Desktop can't open a print dialog, so don't offer one there.
                A stacked flow has no single frame to print, so it saves instead. */}
            {!desktop && !multi && (
              <button className="dpv-btn primary" onClick={() => run('print')} disabled={!!busy}>
                <Icon d={P.print} size={15} />{busy === 'print' ? 'Opening…' : 'Print'}
              </button>
            )}
            <button className="dpv-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={20} /></button>
          </div>
        </header>

        {multi && (
          <div className="dpv-sections">
            {docs.map((d, i) => (
              <button key={d.title} className={`dpv-section ${i === section ? 'on' : ''}`}
                onClick={() => setSection(i)}>
                {i + 1}. {d.title}
              </button>
            ))}
            <span className="dpv-section-note">Save PDF includes all {docs.length}.</span>
          </div>
        )}

        {note && <p className="dpv-note">{note}</p>}
        {desktop && !note && (
          <p className="dpv-note subtle">
            The desktop app can't open a print dialog. Save the PDF, then print it from your PDF viewer.
          </p>
        )}
        {!desktop && !multi && !note && shownLandscape && portraitOnly && (
          <p className="dpv-note subtle">
            This sheet prints landscape, but Safari opens its print dialog in portrait. Choose Landscape there, or use Save PDF, which is already landscape.
          </p>
        )}

        <div className="dpv-body" ref={wrapRef}>
          <div className="dpv-sheet" style={{ width: docW * scale, height: docH * scale }}>
            <iframe
              ref={frameRef}
              title="Document preview"
              srcDoc={shownHtml}
              key={multi ? section : "single"}
              onLoad={onFrameLoad}
              style={{ width: docW, height: docH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            />
            {/* Where each printed page ends, so nothing looks unexpectedly split. */}
            {breaks.map((top, i) => (
              <div key={i} className="dpv-break" style={{ top: top * scale }}>
                <span>Page {i + 2}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
