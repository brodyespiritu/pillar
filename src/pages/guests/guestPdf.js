import { isProspect } from '../../lib/guests';
import { printHtml } from '../../lib/printDoc';
import {
  esc, card, name, meta, notes, tag, contact,
  twoCol, metric, docShell, section,
} from '../../lib/docTheme';

const fmtDate = d => {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Date-only values must parse as LOCAL — new Date("2026-07-26") is UTC
  // midnight, which displays as the previous day in US timezones.
  const x = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
  return isNaN(x) ? '' : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};


/*
 * Prospect list export — deliberately the same sheet as the care list:
 * Georgia serif, fixed four-column table, landscape, Notes at 40%. The two get
 * printed together for a meeting, so they should read as one pack of paper
 * rather than two different documents.
 */
export function buildProspectsDoc(prospects = []) {
  // Alphabetical: with no status column left, a printed sheet is scanned by name.
  const list = [...prospects].sort((a, b) =>
    (a.full_name || '').localeCompare(b.full_name || ''));

  const exported = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const rows = list.map((g, i) => {
    const last = i === list.length - 1;
    const td = `padding:11px 12px;${last ? '' : 'border-bottom:1px solid #e5e7eb;'}vertical-align:top;`;
    // Fixed layout: nowrap content wider than its column would overlap the next.
    const nowrap = `${td}white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    const visits = [
      g.first_visit ? `First visit ${fmtDate(g.first_visit)}` : '',
      g.last_visit ? `Last visit ${fmtDate(g.last_visit)}` : '',
    ].filter(Boolean).join(' · ');

    return `<tr>
      <td style="${nowrap}font-weight:bold;">${esc(g.full_name)}${g.type
        ? `<div style="font-size:13px;color:#666;font-weight:normal;">${esc(g.type)}</div>` : ''}</td>
      <td style="${nowrap}">${esc(g.phone || '')}${g.email
        ? `<div style="font-size:13px;color:#666;">${esc(g.email)}</div>` : ''}</td>
      <td style="${td}word-wrap:break-word;overflow-wrap:break-word;">${esc(g.address || '')}</td>
      <td style="${td}word-wrap:break-word;overflow-wrap:break-word;">
        ${g.notes ? `<div style="white-space:pre-wrap;">${esc(g.notes)}</div>` : ''}
        ${visits ? `<div style="margin-top:6px;padding-left:8px;border-left:2px solid #d1d5db;font-size:13px;">
          <div style="font-size:12px;color:#6b7280;">${visits}</div>
          ${g.assigned_name ? `<div>Assigned to ${esc(g.assigned_name)}</div>` : ''}
        </div>` : ''}
      </td>
    </tr>`;
  }).join('');

  const th = 'background:#f3f4f6;text-align:left;padding:9px 12px;font-size:13px;'
    + 'text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #d1d5db;';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prospect List</title>
  <style>
    @page { size: letter landscape; margin: 0.4in; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; padding: 18px; margin: 0;
           background: #fff; width: 1056px; box-sizing: border-box; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 15px; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    @media print { body { padding: 10px; } }
  </style></head><body>
    <h1 style="font-size:28px;font-weight:bold;margin:0 0 6px;">Prospect List</h1>
    <div style="font-size:16px;color:#666;margin-bottom:22px;">
      Exported on ${exported} · ${list.length} ${list.length === 1 ? 'prospect' : 'prospects'}
    </div>
    <table>
      <colgroup>
        <col style="width:24%"><col style="width:19%"><col style="width:22%">
        <col style="width:35%">
      </colgroup>
      <thead><tr>
        <th style="${th}">Name</th><th style="${th}">Contact</th><th style="${th}">Address</th>
        <th style="${th}">Notes</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:18px 12px;color:#666;font-style:italic;">No prospects to show.</td></tr>`}</tbody>
    </table>
  </body></html>`;

  return { html, filename: 'prospect-list', heading: 'Prospect List', landscape: true };
}

/*
 * Guest / prospect export — rendered with the same document theme as the
 * emailed Weekly Recap, so the printed list and the email look identical.
 */
export function buildGuestsDoc(guests, mode = 'guests', weekLabel = '', comments = []) {
  const prospectsOnly = mode === 'prospects';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const person = (g, isP) => card(
    name(esc(g.full_name))
    + meta(contact(g))
    + (isP && g.address ? meta(esc(g.address)) : '')
    + meta([
      g.first_visit ? `First visit: ${fmtDate(g.first_visit)}` : '',
      g.last_visit ? `Last visit: ${fmtDate(g.last_visit)}` : '',
    ].filter(Boolean).join('   ·   '))
    + (g.type ? tag(esc(g.type), isP) : '')
    + (g.assigned_name ? meta(`Assigned to ${esc(g.assigned_name)}`) : '')
    + notes(esc(g.notes || '')),
    isP ? 'green' : 'gray',
  );

  /* The Prospects-tab export is unchanged: prospects only. */
  if (prospectsOnly) {
    const list = guests.filter(isProspect);
    const byStatus = s => list.filter(g => (g.status || 'Active') === s).length;
    const metricsRow = metric(list.length, 'Prospects') + metric(byStatus('Active'), 'Active')
      + metric(byStatus('Followed Up'), 'Followed Up') + metric(byStatus('Converted'), 'Converted');
    const body = list.length
      ? section(`Prospects (${list.length})`, twoCol(list.map(g => person(g, true))))
      : `<tr><td style="padding-top:18px;"><p style="color:#999;font-style:italic;margin:0;font-size:9pt;">No prospects to show.</p></td></tr>`;
    const html = docShell({ docTitle: 'Prospects', heading: 'Prospects',
      subheading: weekLabel || 'Outreach list', today, metricsRow, body });
    return { html, filename: 'prospects', heading: 'Prospects' };
  }

  /*
   * The weekly document, in fixed section order:
   *   Prospects → Returning Guests/Members → Baptisms → Guests → Comments.
   * The four named sections always render (with "None this week." when empty)
   * so the sheet reads the same way every week.
   */
  const pros      = guests.filter(isProspect);
  const rest      = guests.filter(g => !isProspect(g));
  const returning = rest.filter(g => g.type === 'Returning Guest/Member');
  const baptisms  = rest.filter(g => g.type === 'Baptism');
  const commentGuests = rest.filter(g => g.type === 'Comment');
  const others    = rest.filter(g => !['Returning Guest/Member', 'Baptism', 'Comment'].includes(g.type));

  const commentCard = c => card(
    name(esc(c.person_name || 'Someone'))
    + notes(esc(c.comment || ''))
    + meta([esc(c.submitted_by || ''), c.created_at ? fmtDate(c.created_at) : '']
        .filter(Boolean).join('   ·   ')),
    'gray',
  );
  /* Comments come from two places: guest entries typed "Comment" and the
     greeter_comments table — one section, oldest first. */
  const allComments = [
    ...commentGuests.map(g => ({ person_name: g.full_name, comment: g.notes, submitted_by: '', created_at: g.created_at })),
    ...comments,
  ].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  const metricsRow = metric(pros.length, 'Prospects') + metric(returning.length, 'Returning')
    + metric(baptisms.length, 'Baptisms') + metric(allComments.length, 'Comments');

  const titled = (label, items) => label + (items.length ? ` (${items.length})` : '');
  const body =
      section(titled('Prospects', pros), twoCol(pros.map(g => person(g, true)), 'None this week.'))
    + section(titled('Returning Guests/Members', returning), twoCol(returning.map(g => person(g, false)), 'None this week.'))
    + section(titled('Baptisms', baptisms), twoCol(baptisms.map(g => person(g, false)), 'None this week.'))
    + (others.length ? section(`Guests (${others.length})`, twoCol(others.map(g => person(g, false)))) : '')
    + section(titled('Comments', allComments), twoCol(allComments.map(commentCard), 'None this week.'));

  const html = docShell({
    docTitle: 'Guest List',
    heading: 'Guest List',
    // Name the week on the page so a printed copy is never mistaken for another.
    subheading: weekLabel || 'Weekly guest list',
    today,
    metricsRow,
    body,
  });

  return { html, filename: 'guest-list', heading: 'Guest List' };
}

/* Kept for callers that want the old print-immediately behaviour. */
export function exportGuestsPDF(guests, mode = 'guests', weekLabel = '') {
  const { html, filename } = buildGuestsDoc(guests, mode, weekLabel);
  return printHtml(html, { filename });
}
