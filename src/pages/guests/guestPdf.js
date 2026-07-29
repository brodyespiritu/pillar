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
 * Guest / prospect export — rendered with the same document theme as the
 * emailed Weekly Recap, so the printed list and the email look identical.
 */
export function exportGuestsPDF(guests, mode = 'guests') {
  const prospects = mode === 'prospects';
  const list = prospects ? guests.filter(isProspect) : guests.filter(g => !isProspect(g));
  const heading = prospects ? 'Prospects' : 'Guest List';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const person = g => card(
    name(esc(g.full_name))
    + meta(contact(g))
    + (prospects && g.address ? meta(esc(g.address)) : '')
    + meta([
      g.first_visit ? `First visit: ${fmtDate(g.first_visit)}` : '',
      g.last_visit ? `Last visit: ${fmtDate(g.last_visit)}` : '',
    ].filter(Boolean).join('   ·   '))
    + (g.type ? tag(esc(g.type), prospects) : '')
    + (g.assigned_name ? meta(`Assigned to ${esc(g.assigned_name)}`) : '')
    + notes(esc(g.notes || '')),
    prospects ? 'green' : 'gray',
  );

  // Counts mirror the recap's tile row.
  const byStatus = s => list.filter(g => (g.status || 'Active') === s).length;
  const metricsRow = prospects
    ? metric(list.length, 'Prospects') + metric(byStatus('Active'), 'Active')
      + metric(byStatus('Followed Up'), 'Followed Up') + metric(byStatus('Converted'), 'Converted')
    : metric(list.length, 'Guests') + metric(byStatus('Active'), 'Active')
      + metric(list.filter(g => g.absence_type).length, 'Returning')
      + metric(list.filter(g => g.type === 'New Member').length, 'New Members');

  const body = list.length
    ? section(`${prospects ? 'Prospects' : 'Guests'} (${list.length})`, twoCol(list.map(person)))
    : `<tr><td style="padding-top:18px;"><p style="color:#999;font-style:italic;margin:0;font-size:9pt;">No ${prospects ? 'prospects' : 'guests'} to show.</p></td></tr>`;

  const html = docShell({
    docTitle: heading,
    heading,
    subheading: prospects ? 'Outreach list' : 'Weekly guest list',
    today,
    metricsRow,
    body,
  });

  return printHtml(html, { filename: prospects ? 'prospects' : 'guest-list' });
}
