import { alertDialog } from "../../lib/dialog";
import { jsPDF } from 'jspdf';
import { blockTitle } from './blocks';
import { printHtml } from '../../lib/printDoc';

const esc = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function fmtServiceDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* Human line under each block for print/PDF. */
function blockDetail(b) {
  if (b.kind === 'music')  return b.musicKey ? `Key of ${b.musicKey}` : '';
  return b.notes || '';
}
function blockKindLabel(b) {
  return b.kind === 'music' ? 'Music' : b.kind === 'sermon' ? 'Sermon' : (b.label ? '' : 'Item');
}

/* ══════════ Printable HTML (window.print) ══════════ */
export function buildServiceHtml(plan) {
  const rows = plan.blocks.map((b, i) => {
    const detail = blockDetail(b);
    const kind = b.kind === 'music' ? 'Music' : b.kind === 'sermon' ? 'Sermon' : '';
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="main">
        <div class="bt">${esc(blockTitle(b))}${kind ? ` <span class="kind">${kind}</span>` : ''}</div>
        ${detail ? `<div class="bd">${esc(detail)}</div>` : ''}
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(plan.title || 'Service Order')}</title>
  <style>
    @page { size: letter portrait; margin: 0.7in; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; }
    .head { border-bottom: 3px solid #0B3558; padding-bottom: 14px; margin-bottom: 20px; }
    .head h1 { font-size: 26pt; margin: 0 0 4px; color: #0B3558; letter-spacing: -0.5px; }
    .head .meta { font-size: 11pt; color: #476788; font-weight: 600; }
    .head .meta b { color: #111; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 11px 8px; border-bottom: 1px solid #e6ebf1; vertical-align: top; page-break-inside: avoid; }
    td.num { width: 34px; font-size: 13pt; font-weight: 800; color: #006BFF; }
    .bt { font-size: 12.5pt; font-weight: 700; }
    .kind { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #476788; background: #EAF2FF; border-radius: 999px; padding: 2px 8px; margin-left: 6px; vertical-align: middle; }
    .bd { font-size: 10pt; color: #555; margin-top: 3px; white-space: pre-wrap; }
    .empty { color: #999; font-style: italic; padding: 20px 0; }
    .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 8.5pt; color: #888; display: flex; justify-content: space-between; }
  </style></head><body>
    <div class="head">
      <h1>${esc(plan.title || 'Sunday Service')}</h1>
      <div class="meta"><b>${esc(plan.service || '')}</b>${plan.service && plan.date ? ' &nbsp;·&nbsp; ' : ''}${esc(fmtServiceDate(plan.date))}</div>
    </div>
    ${plan.blocks.length ? `<table>${rows}</table>` : '<p class="empty">No items in this service order yet.</p>'}
    <div class="foot"><span>Bethesda Church</span><span>Service Order</span></div>
  </body></html>`;
}

export function openServicePrint(plan) {
  return printHtml(buildServiceHtml(plan), { filename: 'service-order' });
}

/* ══════════ Real PDF (jsPDF) — download + email attachment ══════════ */
function u8ToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function renderServicePdf(plan) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 50, CW = PW - M * 2, BOTTOM = PH - 50;
  let y = M;
  const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const ensure = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };

  // Header
  font('bold', 24); doc.setTextColor(11, 53, 88);
  doc.text(plan.title || 'Sunday Service', M, y + 20);
  y += 32;
  font('bold', 11); doc.setTextColor(71, 103, 136);
  const meta = [plan.service, fmtServiceDate(plan.date)].filter(Boolean).join('   ·   ');
  doc.text(meta, M, y);
  y += 12;
  doc.setDrawColor(11, 53, 88); doc.setLineWidth(2.5); doc.line(M, y, PW - M, y);
  y += 22;

  if (!plan.blocks.length) {
    font('italic', 11); doc.setTextColor(150, 150, 150);
    doc.text('No items in this service order yet.', M, y);
  }

  plan.blocks.forEach((b, i) => {
    const title = blockTitle(b);
    const detail = b.kind === 'music' ? (b.musicKey ? `Key of ${b.musicKey}` : '') : (b.notes || '');
    const kind = b.kind === 'music' ? 'MUSIC' : b.kind === 'sermon' ? 'SERMON' : '';
    font('normal', 10);
    const detailLines = detail ? doc.splitTextToSize(detail, CW - 34) : [];
    let h = 20 + detailLines.length * 12 + 8;
    ensure(h);
    // number
    font('bold', 13); doc.setTextColor(0, 107, 255);
    doc.text(String(i + 1), M, y + 12);
    // title
    font('bold', 12.5); doc.setTextColor(17, 17, 17);
    doc.text(title, M + 26, y + 12);
    if (kind) {
      const tw = doc.getTextWidth(title);
      font('bold', 7.5); doc.setTextColor(71, 103, 136);
      doc.text(kind, M + 26 + tw + 8, y + 11);
    }
    // detail
    if (detailLines.length) {
      font('normal', 10); doc.setTextColor(85, 85, 85);
      doc.text(detailLines, M + 26, y + 26);
    }
    y += h;
    doc.setDrawColor(230, 235, 241); doc.setLineWidth(0.7); doc.line(M, y - 4, PW - M, y - 4);
    y += 4;
  });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font('normal', 8); doc.setTextColor(140, 140, 140);
    doc.text('Bethesda Church', M, PH - 30);
    doc.text('Service Order', PW - M, PH - 30, { align: 'right' });
  }
  return doc;
}

const pdfName = plan => {
  const t = (plan.title || 'service-order').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${t || 'service-order'}-${plan.date || 'plan'}.pdf`;
};

export function downloadServicePdf(plan) {
  renderServicePdf(plan).save(pdfName(plan));
}

/** { filename, mime, content(base64) } for the mail bridge. */
export function buildServicePdfFile(plan) {
  const bytes = new Uint8Array(renderServicePdf(plan).output('arraybuffer'));
  return { filename: pdfName(plan), mime: 'application/pdf', content: u8ToBase64(bytes) };
}
