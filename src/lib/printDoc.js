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

function isDesktopApp() {
  return typeof window !== 'undefined'
    && !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.isTauri);
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

/* Rasterise the rendered document into a paginated letter-size PDF. */
async function framePdf(frame, filename) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const doc = frame.contentDocument;
  const target = doc.body;

  const canvas = await html2canvas(target, {
    scale: 2,   // crisp text; JPEG below keeps the file small
    backgroundColor: '#ffffff',
    windowWidth: target.scrollWidth,
    windowHeight: target.scrollHeight,
    logging: false,
  });

  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const imgW = pw;
  const imgH = (canvas.height * imgW) / canvas.width;

  if (imgH <= ph) {
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, imgH);
  } else {
    // Slice the tall canvas into page-height strips.
    const pageCanvasH = Math.floor((ph * canvas.width) / pw);
    let y = 0, first = true;
    while (y < canvas.height) {
      const h = Math.min(pageCanvasH, canvas.height - y);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      const sctx = slice.getContext('2d');
      sctx.fillStyle = '#ffffff';                 // JPEG has no alpha channel
      sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, (h * imgW) / canvas.width);
      first = false;
      y += h;
    }
  }
  saveBlob(pdf.output('blob'), filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

/**
 * Render `html`, then print it (browser) or save it as a PDF (desktop app).
 * Returns 'printed' | 'saved-pdf' | 'downloaded'.
 */
export function printHtml(html, { filename = 'pillar-document' } = {}) {
  return new Promise(resolve => {
    let settled = false;
    let frame;
    const finish = how => {
      if (settled) return;
      settled = true;
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

      frame.onload = () => {
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

      // Never leave the user with nothing if the frame won't load or render.
      setTimeout(() => { if (!settled) { downloadHtml(html, filename); finish('downloaded'); } }, 15000);
    } catch {
      downloadHtml(html, filename);
      finish('downloaded');
    }
  });
}
