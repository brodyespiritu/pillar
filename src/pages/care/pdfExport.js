import { printHtml } from '../../lib/printDoc';

/*
 * Care list export — a fixed four-column table, built to the layout spec:
 * Georgia serif, Notes at 40% width, High priority in red at the top, and the
 * most recent contact log indented beneath each person's notes.
 */

const esc = (s = '') =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
const shortDate = d => (d ? new Date(d).toLocaleDateString() : '');

const mostRecentLog = m => (m.contact_logs?.length
  ? [...m.contact_logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  : null);

export function buildCareDoc(members = []) {
  // High priority first; the on-screen order is preserved within each band.
  const list = [...members].sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3));

  const exported = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const rows = list.map((m, i) => {
    const last = i === list.length - 1;
    const td = `padding:11px 12px;${last ? '' : 'border-bottom:1px solid #e5e7eb;'}vertical-align:top;`;
    // In a fixed-layout table, nowrap content wider than its column overlaps the
    // next one. Clip to an ellipsis so columns stay in their lanes.
    const nowrap = `${td}white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    const log = mostRecentLog(m);

    return `<tr>
      <td style="${nowrap}font-weight:bold;">${esc(m.full_name)}${m.family_member
        ? `<div style="font-size:13px;color:#666;font-weight:normal;">Family: ${esc(m.family_member)}</div>` : ''}</td>
      <td style="${nowrap}">${esc(m.category || '')}</td>
      <td style="${nowrap}${m.priority === 'High' ? 'color:#b91c1c;font-weight:bold;' : ''}">${esc(m.priority || '')}</td>
      <td style="${td}word-wrap:break-word;overflow-wrap:break-word;">
        ${m.care_notes ? `<div style="white-space:pre-wrap;">${esc(m.care_notes)}</div>` : ''}
        ${log ? `<div style="margin-top:6px;padding-left:8px;border-left:2px solid #d1d5db;font-size:13px;">
          <div style="font-weight:bold;color:#374151;">${shortDate(log.created_at)} · ${esc(log.type || '')}</div>
          ${log.notes ? `<div>${esc(log.notes)}</div>` : ''}
        </div>` : ''}
      </td>
    </tr>`;
  }).join('');

  const th = 'background:#f3f4f6;text-align:left;padding:9px 12px;font-size:13px;'
    + 'text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #d1d5db;';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Church Care List</title>
  <style>
    /*
     * Laid out at the width the columns actually need; both print paths scale it
     * to the sheet, as a browser does with a wide table. Five columns sit close
     * to letter width, so the printed text comes out near full size.
     */
    /* Landscape: the extra width is what lets the type run larger. */
    @page { size: letter landscape; margin: 0.4in; }
    /* The saved PDF now adds a real page margin, so this only needs enough
       inset to breathe — 40px on top of that wasted the sheet. */
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; padding: 18px; margin: 0;
           background: #fff; width: 1056px; box-sizing: border-box; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 15px; }
    /* Keep a person's row whole rather than splitting it across a page. */
    tr { break-inside: avoid; page-break-inside: avoid; }
    @media print { body { padding: 10px; } }
  </style></head><body>
    <h1 style="font-size:28px;font-weight:bold;margin:0 0 6px;">Church Care List</h1>
    <div style="font-size:16px;color:#666;margin-bottom:22px;">
      Exported on ${exported} · ${list.length} ${list.length === 1 ? 'member' : 'members'}
    </div>
    <table>
      <colgroup>
        <col style="width:28%"><col style="width:19%"><col style="width:13%">
        <col style="width:40%">
      </colgroup>
      <thead><tr>
        <th style="${th}">Name</th><th style="${th}">Category</th><th style="${th}">Priority</th>
        <th style="${th}">Notes</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:18px 12px;color:#666;font-style:italic;">No care records to show.</td></tr>`}</tbody>
    </table>
  </body></html>`;

  return { html, filename: 'care-list', heading: 'Church Care List', landscape: true };
}

/* Kept for callers that want the old print-immediately behaviour. */
export function exportMembersPDF(members) {
  const { html, filename } = buildCareDoc(members);
  return printHtml(html, { filename });
}
