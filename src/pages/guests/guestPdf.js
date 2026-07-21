import { alertDialog } from "../../lib/dialog";
import { isProspect } from '../../lib/guests';

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function exportGuestsPDF(guests, mode = 'guests') {
  const list = mode === 'prospects' ? guests.filter(isProspect) : guests.filter(g => !isProspect(g));
  const title = mode === 'prospects' ? 'Prospects — Outreach List' : 'Guest List';
  const showAddr = mode === 'prospects';

  const rows = list.map(g => `
    <tr>
      <td>${esc(g.full_name)}</td>
      <td>${esc(g.type)}</td>
      <td>${esc(g.phone || '')}</td>
      <td>${esc(g.email || '')}</td>
      ${showAddr ? `<td>${esc(g.address || '')}</td>` : ''}
      <td>${g.last_visit ? new Date(g.last_visit).toLocaleDateString() : ''}</td>
      <td>${esc(g.status || '')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; margin: 40px; color: #1a1a1a; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { text-align: left; border-bottom: 2px solid #333; padding: 8px 6px; }
      td { border-bottom: 1px solid #ddd; padding: 8px 6px; vertical-align: top; }
    </style></head><body>
      <h1>Bethesda Baptist Church — ${title}</h1>
      <div class="meta">${list.length} entries · Generated ${new Date().toLocaleString()}</div>
      <table>
        <thead><tr>
          <th>Name</th><th>Type</th><th>Phone</th><th>Email</th>
          ${showAddr ? '<th>Address</th>' : ''}<th>Last Visit</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alertDialog('Please allow pop-ups to export the PDF.'); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 300);
}
