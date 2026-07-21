import { alertDialog } from "../../lib/dialog";
import { lastContacted } from '../../lib/care';

/* Client-side PDF export — opens a print-ready HTML document */
export function exportMembersPDF(members) {
  const rows = members.map(m => {
    const lc = lastContacted(m);
    const recentLog = m.contact_logs?.length
      ? [...m.contact_logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
      : null;
    const high = m.priority === 'High';
    return `
      <tr style="${high ? 'color:#c0392b;font-weight:bold;' : ''}">
        <td>${esc(m.full_name)}${m.family_member ? ` <span style="color:#888;font-weight:normal">(${esc(m.family_member)})</span>` : ''}</td>
        <td>${esc(m.category)}</td>
        <td>${esc(m.priority)}</td>
        <td>${esc(m.assigned_name || '—')}</td>
        <td>${lc ? new Date(lc).toLocaleDateString() : 'Never'}</td>
        <td>${esc(m.care_notes || '')}${recentLog ? `<br><em style="color:#666">${esc(recentLog.type)}: ${esc(recentLog.notes || '')}</em>` : ''}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Care List</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; margin: 40px; color: #1a1a1a; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { text-align: left; border-bottom: 2px solid #333; padding: 8px 6px; }
      td { border-bottom: 1px solid #ddd; padding: 8px 6px; vertical-align: top; }
    </style></head><body>
      <h1>Bethesda Baptist Church — Care List</h1>
      <div class="meta">${members.length} members · Generated ${new Date().toLocaleString()}</div>
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Priority</th><th>Assigned</th><th>Last Contacted</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alertDialog('Please allow pop-ups to export the PDF.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
