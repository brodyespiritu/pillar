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

/* Letter at 96dpi — the width the document is authored against. */
export const PAGE_W = 816;
export const PAGE_H = 1056;

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

/*
 * Lay a rendered canvas into `pdf`, splitting it across pages. Kept separate
 * from frameToPdfDoc so a Meeting Flow can stack several documents — each in
 * its own orientation — into a single file.
 */
function addCanvasToPdf(pdf, canvas, { newPage = false } = {}) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();

  /*
   * A real page margin. `@page { margin }` only governs BROWSER printing — this
   * rasterised path used to place the image at 0,0 across the full sheet, so the
   * heading sat flush against the paper edge and printers clipped it inside
   * their non-printable border. 27pt ≈ 0.375in clears that on every page.
   */
  const M = 27;
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
  addCanvasToPdf(pdf, await frameToCanvas(frame), {});
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
    const canvas = await withRenderedFrame(d.html, frameToCanvas);
    if (!pdf) {
      pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: d.landscape ? 'landscape' : 'portrait' });
      addCanvasToPdf(pdf, canvas, {});
    } else {
      // A fresh page in THIS document's orientation, then fill it.
      pdf.addPage('letter', d.landscape ? 'landscape' : 'portrait');
      addCanvasToPdf(pdf, canvas, {});
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
export function htmlToPdfAttachment(html, { filename = 'document', landscape = false } = {}) {
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
export async function printFrame(frame, { filename = 'pillar-document', html = '', landscape = false } = {}) {
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
export async function savePdf(frame, { filename = 'pillar-document', html = '', landscape = false } = {}) {
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
            try { await framePdf(frame, filename); finish('saved-pdf'); }
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
