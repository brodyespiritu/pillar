/*
 * A report, as a printed sheet.
 *
 * Same Georgia serif and column rules as the care and prospect lists, so a
 * report handed round a meeting sits with the rest of the church's paperwork
 * rather than looking like a screenshot of a web page.
 */

const esc = (s = '') =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildReportDoc({ title, subtitle, columns = [], rows = [], withExtra = false }) {
  const exported = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const th = 'background:#f3f4f6;text-align:left;padding:9px 12px;font-size:12px;'
    + 'text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #d1d5db;';

  const body = rows.map((r, i) => {
    const last = i === rows.length - 1;
    const td = `padding:10px 12px;${last ? '' : 'border-bottom:1px solid #e5e7eb;'}vertical-align:top;`;
    return `<tr>
      <td style="${td}font-weight:bold;">${esc(r.name)}</td>
      <td style="${td}white-space:nowrap;">${esc(r.detail || '')}</td>
      ${withExtra ? `<td style="${td}color:${r.extra ? '#111' : '#9ca3af'};">${esc(r.extra || 'no email on file')}</td>` : ''}
    </tr>`;
  }).join('');

  const widths = withExtra
    ? '<col style="width:34%"><col style="width:23%"><col style="width:43%">'
    : '<col style="width:45%"><col style="width:55%">';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: letter portrait; margin: 0.5in; }
    body { font-family: Georgia,'Times New Roman',serif; color:#111; margin:0; padding:0; background:#fff; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:13.5px; }
    /* Keep a person's row whole rather than splitting it across a page. */
    tr { break-inside: avoid; page-break-inside: avoid; }
  </style></head><body>
    <h1 style="font-size:24px;font-weight:bold;margin:0 0 6px;">${esc(title)}</h1>
    <div style="font-size:13px;color:#555;margin-bottom:18px;">
      ${esc(subtitle)} &middot; ${esc(exported)} &middot; ${rows.length} ${rows.length === 1 ? 'person' : 'people'}
    </div>
    <table>
      <colgroup>${widths}</colgroup>
      <thead><tr>${columns.map(c => `<th style="${th}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${columns.length}" style="padding:18px 12px;color:#666;font-style:italic;">Nothing to show.</td></tr>`}</tbody>
    </table>
  </body></html>`;

  return { html, filename: String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report' };
}
