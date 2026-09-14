/*
 * Turn an HTML document into something the user can actually print.
 *
 * Two environments, two mechanisms:
 *  - Browser / PWA: render into a hidden iframe and raise the system print
 *    dialog ("Save as PDF" is one of its destinations). No window.open(), so
 *    no pop-up blocker is involved — the old code hit a blocker with no way
 *    for the user to allow it.
 *  - Desktop app: the Tauri webview's window.print() is a no-op, so printing
 *    silently did nothing. There we rasterise the same document into a real
 *    .pdf file and save it, which the user can open and print.
 */

export function isDesktopApp() {
  return typeof window !== 'undefined'
    && !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.isTauri);
}

/*
 * Safari ignores a document's `@page` orientation and always opens its print
 * dialog in portrait. So does every browser on iPhone and iPad, which all run
 * on Safari's engine. Chrome, Edge and Firefox turn the page as asked.
 */
export function printsPortraitOnly() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\//.test(ua);
}

/* Letter at 96dpi — the width the document is authored against. */
export const PAGE_W = 816;
export const PAGE_H = 1056;

/* The margin a saved PDF keeps on every side, in points (27pt ≈ 0.375in). */
export const PDF_MARGIN = 27;

/*
 * Every document names its orientation in its own `@page` rule, and that rule is
 * what a browser's print dialog goes by. The PDF path reads the same rule, so a
 * caller that forgets to pass `landscape` can't save a landscape sheet as portrait.
 */
export function declaresLandscape(html) {
  return /@page[^{]*\{[^}]*\bsize\s*:[^;}]*\blandscape\b/i.test(String(html || ''));
}

/*
 * The rows and cards a document asks to keep whole (`break-inside: avoid`), as
 * [top, bottom] spans in document pixels. A browser follows that rule when it
 * prints; the saved PDF and the preview's page markers read it from here.
 */
export function keepTogetherSpans(doc) {
  const body = doc?.body;
  const view = doc?.defaultView;
  if (!body || !view) return [];
  const origin = body.getBoundingClientRect().top;
  const spans = [];
  for (const el of body.querySelectorAll('*')) {
    const cs = view.getComputedStyle(el);
    if (cs.breakInside !== 'avoid' && cs.pageBreakInside !== 'avoid') continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0) spans.push([r.top - origin, r.bottom - origin]);
  }
  return spans;
}

/*
 * Where a page starting at `from`, with room for `span` pixels, should end when
 * a full page would cut through something kept whole: at the top of that block,
 * so the block starts the next page. Not when the block could never fit on one
 * page, and not when moving it would leave this page under 55% full. Returns
 * null when nothing kept whole is in the way.
 */
export function keptWholeEnd(from, span, keep = []) {
  const ideal = from + span;
  const limit = from + span * 0.55;
  let end = null;
  for (const [top, bottom] of keep) {
    if (top > limit && top < ideal && bottom > ideal && bottom - top <= span) {
      end = end === null ? top : Math.min(end, top);
    }
  }
  return end;
}

/* Every page break in a document `total` pixels tall, placed as the saved PDF places them. */
export function pageBreaks(total, span, keep = []) {
  const breaks = [];
  if (!(span > 0)) return breaks;
  for (let from = 0; total - from > span; ) {
    from = keptWholeEnd(from, span, keep) ?? from + span;
    breaks.push(from);
  }
  return breaks;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadHtml(html, filename) {
  saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }),
    filename.endsWith('.html') ? filename : `${filename}.html`);
}

/* Rasterise an already-rendered frame into a paginated letter-size PDF doc. */
async function frameToCanvas(frame) {
  const { default: html2canvas } = await import('html2canvas');
  const target = frame.contentDocument.body;
  return html2canvas(target, {
    scale: 2,   // crisp text; JPEG below keeps the file small
    backgroundColor: '#ffffff',
    windowWidth: target.scrollWidth,
    windowHeight: target.scrollHeight,
    logging: false,
  });
}

/* The frame as a picture, plus what it keeps whole, measured in the picture's pixels. */
async function renderFrame(frame) {
  const canvas = await frameToCanvas(frame);
  const k = canvas.width / (frame.contentDocument.body.getBoundingClientRect().width || canvas.width);
  return { canvas, keep: keepTogetherSpans(frame.contentDocument).map(([top, bottom]) => [top * k, bottom * k]) };
}

/*
 * Lay a rendered canvas into `pdf`, splitting it across pages. Kept separate
 * from frameToPdfDoc so a Meeting Flow can stack several documents — each in
 * its own orientation — into a single file.
 */
function addCanvasToPdf(pdf, canvas, { newPage = false, keep = [] } = {}) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();

  /*
   * A real page margin. `@page { margin }` only governs BROWSER printing — this
   * rasterised path used to place the image at 0,0 across the full sheet, so the
   * heading sat flush against the paper edge and printers clipped it inside
   * their non-printable border. 27pt ≈ 0.375in clears that on every page.
   */
  const M = PDF_MARGIN;
  const usableW = pw - M * 2;
  const usableH = ph - M * 2;

  const imgW = usableW;
  const imgH = (canvas.height * imgW) / canvas.width;

  if (imgH <= usableH) {
    if (newPage) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, imgW, imgH);
  } else {
    // Slice the tall canvas into page-height strips.
    const pageCanvasH = Math.floor((usableH * canvas.width) / usableW);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    /*
     * Cutting at a fixed height slices straight through whatever sits on the
     * boundary — a name, a line of a note. Walk back from the ideal cut to the
     * nearest blank row so pages break in the gaps between cards instead.
     */
    const isBlankRow = y => {
      const { data } = ctx.getImageData(0, y, canvas.width, 1);
      for (let i = 0; i < data.length; i += 4 * 4) {          // sample every 4th px
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false;
      }
      return true;
    };
    const safeCut = (from, ideal) => {
      /* A blank row between two lines of one person's note still splits their
         row, leaving the rest of it on the next page without their name. A row
         or card the document keeps whole starts the next page instead. */
      const whole = keptWholeEnd(from, pageCanvasH, keep);
      if (whole !== null) return Math.floor(whole) - from;
      const limit = Math.max(from + Math.floor(pageCanvasH * 0.55), 1);   // never orphan a tiny sliver
      for (let y = Math.min(ideal, canvas.height - 1); y > limit; y--) {
        if (isBlankRow(y)) return y - from;
      }
      return ideal - from;                                     // solid block — cut where we must
    };

    let y = 0, first = !newPage;
    while (y < canvas.height) {
      const remaining = canvas.height - y;
      const h = remaining <= pageCanvasH ? remaining : safeCut(y, y + pageCanvasH);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      const sctx = slice.getContext('2d');
      sctx.fillStyle = '#ffffff';                 // JPEG has no alpha channel
      sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, imgW, (h * imgW) / canvas.width);
      first = false;
      y += h;
    }
  }
  return pdf;
}

export async function frameToPdfDoc(frame, { landscape = false } = {}) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: landscape ? 'landscape' : 'portrait' });
  const { canvas, keep } = await renderFrame(frame);
  addCanvasToPdf(pdf, canvas, { keep });
  return pdf;
}

/* Render one HTML string in a hidden, laid-out iframe and hand back the frame. */
function withRenderedFrame(html, fn) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    // Must be laid out (not display:none) for html2canvas to measure it.
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;opacity:0;pointer-events:none;';
    let done = false;
    const finish = (go, arg) => { if (done) return; done = true; setTimeout(() => frame.remove(), 1000); go(arg); };

    frame.onload = () => setTimeout(async () => {
      try {
        const b = frame.contentDocument?.body;
        if (b) {                       // let a wide document keep its own width
          frame.style.width = `${Math.max(b.scrollWidth, 816)}px`;
          frame.style.height = `${Math.max(b.scrollHeight, 1056)}px`;
          await new Promise(r => setTimeout(r, 120));
        }
        finish(resolve, await fn(frame));
      } catch (e) { finish(reject, e); }
    }, 350);

    document.body.appendChild(frame);
    frame.srcdoc = html;
    setTimeout(() => finish(reject, new Error('PDF render timed out')), 20000);
  });
}

/*
 * Several documents, one PDF. Each keeps its own orientation — the guest recap
 * is portrait and the care sheet is landscape, and forcing either to match the
 * other would squash a layout that was designed around its page.
 */
export async function docsToPdf(docs) {
  const { jsPDF } = await import('jspdf');
  const live = docs.filter(d => d && d.html);
  if (!live.length) throw new Error('Nothing to print.');

  let pdf = null;
  for (const d of live) {
    const { canvas, keep } = await withRenderedFrame(d.html, renderFrame);
    const orientation = (d.landscape ?? declaresLandscape(d.html)) ? 'landscape' : 'portrait';
    if (!pdf) {
      pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation });
      addCanvasToPdf(pdf, canvas, { keep });
    } else {
      // A fresh page in THIS document's orientation, then fill it.
      pdf.addPage('letter', orientation);
      addCanvasToPdf(pdf, canvas, { keep });
    }
  }
  return pdf;
}

export async function saveDocsPdf(docs, filename = 'meeting-flow') {
  const pdf = await docsToPdf(docs);
  saveBlob(pdf.output('blob'), filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export async function framePdf(frame, filename, opts = {}) {
  const pdf = await frameToPdfDoc(frame, opts);
  saveBlob(pdf.output('blob'), filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

/*
 * Render `html` off-screen and return it as an email attachment — the exact
 * same rasterisation the Export button produces, so the emailed PDF and the
 * printed one are the same document rather than two lookalikes.
 */
export function htmlToPdfAttachment(html, { filename = 'document', landscape = declaresLandscape(html) } = {}) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    // Must be laid out (not display:none) for html2canvas to measure it.
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;opacity:0;pointer-events:none;';
    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; setTimeout(() => frame.remove(), 1000); fn(arg); };

    frame.onload = () => setTimeout(async () => {
      try {
        const b = frame.contentDocument?.body;
        if (b) {                       // let a wide document keep its own width
          frame.style.width = `${Math.max(b.scrollWidth, 816)}px`;
          frame.style.height = `${Math.max(b.scrollHeight, 1056)}px`;
          await new Promise(r => setTimeout(r, 120));
        }
        const pdf = await frameToPdfDoc(frame, { landscape });
        const base64 = pdf.output('datauristring').split(',')[1];
        finish(resolve, { filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
                          content: base64, mime: 'application/pdf' });
      } catch (e) { finish(reject, e); }
    }, 350);

    document.body.appendChild(frame);
    frame.srcdoc = html;
    setTimeout(() => finish(reject, new Error('PDF render timed out')), 20000);
  });
}

/*
 * Print an already-rendered frame. The Tauri webview's window.print() is a
 * no-op, so there we rasterise to a real .pdf instead of doing nothing.
 * Returns 'printed' | 'saved-pdf' | 'downloaded'.
 */
export async function printFrame(frame, { filename = 'pillar-document', html = '', landscape = declaresLandscape(html) } = {}) {
  if (isDesktopApp()) {
    try { await framePdf(frame, filename, { landscape }); return 'saved-pdf'; }
    catch (e) {
      console.error('[printDoc] Could not build the PDF:', e);
      if (html) downloadHtml(html, filename);
      return 'downloaded';
    }
  }
  try {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    return 'printed';
  } catch {
    if (html) downloadHtml(html, filename);
    return 'downloaded';
  }
}

/* Save the rendered frame as a PDF regardless of environment. */
export async function savePdf(frame, { filename = 'pillar-document', html = '', landscape = declaresLandscape(html) } = {}) {
  try { await framePdf(frame, filename, { landscape }); return 'saved-pdf'; }
  catch (e) {
    console.error('[printDoc] Could not build the PDF:', e);
    if (html) downloadHtml(html, filename);
    return 'downloaded';
  }
}

/**
 * Render `html`, then print it (browser) or save it as a PDF (desktop app).
 * Returns 'printed' | 'saved-pdf' | 'downloaded'.
 */
export function printHtml(html, { filename = 'pillar-document' } = {}) {
  return new Promise(resolve => {
    let started = false;      // the work may only be kicked off ONCE
    let settled = false;
    let frame;
    let fallback;

    const finish = how => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      // Removing the frame mid print-dialog cancels the job, so linger.
      if (frame) setTimeout(() => frame.remove(), 60000);
      resolve(how);
    };

    try {
      frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', 'Print preview');
      // Must be laid out (not display:none) for html2canvas to measure it.
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;opacity:0;pointer-events:none;';

      /*
       * onload fires more than once: appending the frame loads about:blank,
       * assigning srcdoc loads again, and some webviews fire repeatedly as
       * subresources settle. The old guard only covered the RESOLVE — the
       * download already happened by then, so each extra load produced another
       * PDF. Latch synchronously here instead.
       */
      frame.onload = () => {
        if (started) return;
        started = true;
        setTimeout(async () => {
          if (isDesktopApp()) {
            try { await framePdf(frame, filename, { landscape: declaresLandscape(html) }); finish('saved-pdf'); }
            catch (e) {
              console.error('[printDoc] Could not build the PDF:', e);
              downloadHtml(html, filename);   // never leave the click doing nothing
              finish('downloaded');
            }
            return;
          }
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            finish('printed');
          } catch {
            downloadHtml(html, filename);
            finish('downloaded');
          }
        }, 350);
      };

      document.body.appendChild(frame);
      frame.srcdoc = html;

      // Only rescue a document that never even started rendering — a slow but
      // working PDF must not also drop an .html file alongside it.
      fallback = setTimeout(() => {
        if (settled || started) return;
        downloadHtml(html, filename);
        finish('downloaded');
      }, 15000);
    } catch {
      downloadHtml(html, filename);
      finish('downloaded');
    }
  });
}
