import { alertDialog } from "./dialog";
import { jsPDF } from 'jspdf';
import { supabase } from './supabase';
import { sendMessage } from './email';
// The recap covers the same window as the guest list — the guest week, which
// runs Sunday 7:00 AM → the following Sunday 7:00 AM. Gathering happens Sunday
// morning and the recap goes out that afternoon, so "this week" is exactly what
// was collected that morning, and it always matches what the list shows.
import { guestWeekRange as weekRange, guestWeekSpan as weekLabel, isProspect } from './guests';
import { attachMinistry } from './members';

/*
 * Greeter Ministry Recap — Pillar-native adaptation.
 *
 * Stack mapping vs. the original spec:
 *  - EmailConfig table          → Supabase `email_config` (shared saved greeters)
 *  - RecapEmailSends table      → `recap_sends` (send log; foundation for view-tracking)
 *  - generateRecapPdf + ZitePdf → buildRecapHtml() rendered through the browser
 *                                 print engine (window.print), Pillar's PDF mechanism
 *  - Resend / Gmail API         → the connected account via the Tauri SMTP bridge
 *
 * "This week" = the guest week (Sunday 7:00 AM → Sunday 7:00 AM, from guests.js).
 */

/*
 * The recap's week is DAY-granular: Sunday 00:00 → Saturday 23:59:59.999
 * local, derived from the guest week's starting Sunday. Two reasons:
 *  - date-only values ("2026-07-26") carry no time; parsing them as local
 *    midnight would land before the 7:00 AM boundary and drop them, and
 *    deriving the end from weekRange().end (next Sunday 6:59 AM) would make
 *    Sundays match TWO consecutive weeks.
 *  - timestamps from Sunday 00:00–06:59 (late-night entry) would otherwise
 *    fall into the previous week, whose recap already went out — lost forever.
 * Day granularity gives every record exactly one recap week.
 */
const inWeek = dateStr => {
  if (!dateStr) return false;
  const { start } = weekRange();
  const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const dayEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
  const s = String(dateStr);
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Date-only strings parse as LOCAL (new Date("2026-07-26") is UTC midnight
  // = the previous evening in US timezones); timestamps parse exactly.
  const d = dateOnly ? new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) : new Date(s);
  return d >= dayStart && d <= dayEnd;
};

/* ── Saved greeter emails (shared across staff) ── */
export async function fetchGreeters() {
  const { data, error } = await supabase
    .from('email_config').select('*').eq('group_name', 'greeters').order('created_at');
  if (error) return { rows: [], missing: /relation|does not exist/i.test(error.message || '') };
  return { rows: data || [], missing: false };
}
export async function addGreeter({ email, name }) {
  return supabase.from('email_config')
    .insert({ group_name: 'greeters', email: email.trim(), name: name?.trim() || null })
    .select().single();
}
export async function removeGreeter(id) {
  return supabase.from('email_config').delete().eq('id', id);
}

/* ── Active staff emails ── */
export async function fetchStaffEmails() {
  const { data } = await supabase.from('staff').select('name, email, active');
  return (data || [])
    .filter(s => s.active !== false && s.email?.trim())
    .map(s => ({ email: s.email.trim(), name: s.name || '' }));
}

/* ── Greeter comments ("Pathway to Belonging") ── */
async function fetchWeekComments() {
  const { data } = await supabase.from('greeter_comments').select('*').order('created_at', { ascending: false });
  return (data || []).filter(c => inWeek(c.created_at));
}
export async function addGreeterComment({ person_name, comment, submitted_by }) {
  return supabase.from('greeter_comments')
    .insert({ person_name: person_name?.trim() || null, comment: comment?.trim() || null, submitted_by: submitted_by || null })
    .select().single();
}

/* ── New connections (ministry sign-ups) ── */
async function fetchWeekConnections() {
  // Pull the linked member so the recap can show phone/email alongside the name.
  let { data, error } = await supabase.from('new_connections')
    .select('*, church_members(name, phone, email)')
    .order('created_at', { ascending: false });
  if (error) {
    // No FK relationship exposed — fall back to the bare rows rather than losing the section.
    ({ data } = await supabase.from('new_connections').select('*').order('created_at', { ascending: false }));
  }
  return (data || []).filter(c => inWeek(c.created_at));
}
/*
 * Records a new connection AND attaches the person to that ministry on their
 * Members profile. Returns { data, error, member }.
 */
export async function addNewConnection({ person_name, ministry, submitted_by }) {
  const attached = await attachMinistry(person_name, ministry);
  if (attached.error) return { error: attached.error };
  const { data, error } = await supabase.from('new_connections')
    .insert({
      person_name: person_name?.trim() || null,
      ministry,
      member_id: attached.data?.id || null,
      submitted_by: submitted_by || null,
    })
    .select().single();
  return { data, error, member: attached.data, created: attached.created };
}

/* ── Sort guests into recap groups ── */
export function computeRecap(guests, comments = [], connections = []) {
  const visited = g => inWeek(g.last_visit);
  const ownSection = new Set(['Salvation', 'Baptism', 'New Member']);

  const salvations = guests.filter(g => g.type === 'Salvation' && visited(g));
  const baptisms   = guests.filter(g => g.type === 'Baptism'   && visited(g));
  const newMembers = guests.filter(g => g.type === 'New Member' && visited(g));
  // Prospects: filtered by when the record was touched (created/last visit) this week
  const prospects  = guests.filter(g => isProspect(g) && (inWeek(g.created_at) || visited(g)));

  // First-timers: visited this week and their first visit is also this week.
  // The entry type is authoritative: anyone explicitly marked
  // "Returning Guest/Member" belongs in Returning even though the form
  // defaults first_visit to today (which would otherwise read as a first visit).
  const firstTimers = guests.filter(g =>
    visited(g) && !ownSection.has(g.type) && !isProspect(g) &&
    g.type !== 'Returning Guest/Member' &&
    (!g.first_visit || inWeek(g.first_visit)));
  const firstIds = new Set(firstTimers.map(g => g.id));
  const returning = guests.filter(g =>
    visited(g) && !ownSection.has(g.type) && !isProspect(g) && !firstIds.has(g.id));

  const guestsThisWeek = guests.filter(visited).length;

  return {
    salvations, baptisms, newMembers, prospects, returning, firstTimers, comments, connections,
    metrics: {
      salvations: salvations.length, baptisms: baptisms.length,
      newMembers: newMembers.length, guests: guestsThisWeek,
    },
  };
}

export async function loadRecap(guests) {
  const [comments, connections] = await Promise.all([fetchWeekComments(), fetchWeekConnections()]);
  return computeRecap(guests, comments, connections);
}

/* ── Email subject + body (plain text — SMTP bridge sends text) ── */
export function recapSubject() {
  return `Greeter Ministry Recap – ${weekLabel()}`;
}
export function recapBody(recap, senderName) {
  const m = recap.metrics;
  const lines = [
    `Greeter Ministry Recap for the week of ${weekLabel()}.`,
    ``,
    `This week at a glance`,
    `• Guests tracked: ${m.guests}`,
    `• Returning guests / members: ${recap.returning.length}`,
    `• New prospects: ${recap.prospects.length}`,
    `• Salvations: ${m.salvations}    Baptisms: ${m.baptisms}    New members: ${m.newMembers}`,
  ];
  if (recap.firstTimers.length) {
    lines.push('', `First-time visitors: ${recap.firstTimers.map(g => g.full_name).join(', ')}`);
  }
  if ((recap.connections || []).length) {
    lines.push('', `New connections: ${recap.connections.map(c => `${c.person_name || 'Someone'} → ${c.ministry}`).join(', ')}`);
  }
  lines.push(
    '',
    `The full Weekly Recap — prospect details, returning guests, new connections, and Pathway to Belonging comments — is attached as a PDF (also printable from the Guests dashboard).`,
    '',
    `— ${senderName || 'Bethesda Church'}`,
  );
  return lines.join('\n');
}

/* ── Send + log (auto-attaches the Weekly Recap PDF) ── */
export async function sendRecap({ account, recipients, subject, body, senderName, createdBy, recap }) {
  const to = recipients.join(', ');
  const attachments = recap ? [buildRecapPdf(recap)] : [];
  // The recap travels as the PDF attachment only — the body is a short plain-
  // text note, so the email reads clean and the PDF is the single source.
  await sendMessage(account, { to, subject, body, attachments });   // throws on failure
  // The log is secondary to the send — never fail a delivered recap over it,
  // but don't lose the error silently either (supabase returns, not throws).
  const { error: logErr } = await supabase.from('recap_sends').insert({
    subject, recipients, recipient_count: recipients.length,
    sender_name: senderName || null, created_by: createdBy || null,
  });
  if (logErr) console.warn('Recap sent, but logging to recap_sends failed:', logErr.message);
}

/* ══════════ Weekly Recap "PDF" (HTML → browser print) ══════════ */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = d => {
  if (!d) return '';
  const s = String(d);
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Date-only values must parse as LOCAL — new Date("2026-07-26") is UTC
  // midnight, which displays as the PREVIOUS day in US timezones.
  const x = dateOnly ? new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) : new Date(s);
  return isNaN(x) ? '' : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function buildRecapHtml(recap) {
  const range = weekLabel();
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const m = recap.metrics;

  /* Everything below is table-based with inline styles: flexbox and CSS grid
     are ignored by Outlook and several webmail clients, so the same markup has
     to survive both the browser print engine and an email client. */
  const C = {
    ink: '#1a1a1a', mute: '#555', faint: '#888', line: '#ddd', rule: '#ccc',
    gray: '#f0f0f0', soft: '#f7f7f7', green: '#e8f5e9', blue: '#e3f2fd',
  };
  const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  const h2 = t => `<h2 style="font-size:11pt;margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid ${C.rule};font-family:${FONT};color:${C.ink};">${t}</h2>`;
  const empty = '<p style="color:#999;font-style:italic;margin:0;font-size:9pt;">None this week.</p>';

  /* A card. `tone` picks the background. */
  const card = (inner, tone = 'soft') => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;margin-bottom:7px;">
    <tr><td style="background:${C[tone]};border-radius:6px;padding:8px 10px;font-family:${FONT};font-size:9pt;color:${C.ink};">${inner}</td></tr></table>`;
  const name = t => `<div style="font-weight:700;font-size:9.5pt;">${t}</div>`;
  const meta = t => (t ? `<div style="color:${C.mute};margin-top:2px;">${t}</div>` : '');
  const notes = t => (t ? `<div style="font-style:italic;color:#444;margin-top:4px;">${t}</div>` : '');
  const tag = (t, green) => `<span style="display:inline-block;font-size:7pt;font-weight:600;background:${green ? '#c8e6c9' : '#fff'};border:1px solid ${green ? '#a5d6a7' : C.rule};border-radius:999px;padding:1px 8px;margin-top:5px;">${t}</span>`;
  const contact = g => [g.phone, g.email].filter(Boolean).map(esc).join(' · ');

  /* Lay a list of cards into two columns, the way the printed recap reads. */
  const twoCol = items => {
    if (!items.length) return empty;
    let out = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">';
    for (let i = 0; i < items.length; i += 2) {
      out += `<tr><td width="50%" valign="top" style="padding-right:4px;">${items[i]}</td>`
        + `<td width="50%" valign="top" style="padding-left:4px;">${items[i + 1] || ''}</td></tr>`;
    }
    return out + '</table>';
  };

  const metric = (n, label) => `<td width="25%" valign="top" style="padding:0 5px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">
      <tr><td align="center" style="border:1px solid ${C.line};border-radius:6px;padding:10px;font-family:${FONT};">
        <div style="font-size:20pt;font-weight:700;line-height:1;color:${C.ink};">${n}</div>
        <div style="font-size:7pt;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-top:5px;">${label}</div>
      </td></tr></table></td>`;

  const prospectCard = g => {
    const firstTime = g.first_visit && inWeek(g.first_visit);
    return card(
      name(esc(g.full_name) + (firstTime ? ' ' + tag('First visit', true) : ''))
      + meta(contact(g))
      + (g.first_visit ? meta(`First visit: ${fmtDate(g.first_visit)}`) : '')
      + (g.status ? tag(esc(g.status)) : '')
      + notes(esc(g.notes || '')),
      firstTime ? 'green' : 'gray',
    );
  };

  const absenceLabel = g => {
    if (g.absence_type === 'Long') return `<div style="font-size:7.5pt;font-weight:700;color:#b00020;margin-top:3px;">Returning after long absence</div>`;
    if (g.absence_type === 'Brief') return `<div style="font-size:7.5pt;font-weight:700;color:#b26a00;margin-top:3px;">Returning after brief absence</div>`;
    return '';
  };
  const returningCard = g => card(
    name(esc(g.full_name)) + absenceLabel(g) + meta(contact(g)),
  );

  /* A person card used for salvations / baptisms / new members / first-timers. */
  const personCard = (g, tone) => card(
    name(esc(g.full_name)) + meta(contact(g) || 'No contact on file'),
    tone,
  );

  const commentCard = c => card(
    name(esc(c.person_name || 'Someone'))
    + notes(esc(c.comment || ''))
    + (c.submitted_by ? meta(`— ${esc(c.submitted_by)} · ${fmtDate(c.created_at)}`) : ''),
    'gray',
  );

  /* Connections carry the member's contact details when we have them. */
  const connectionCard = c => {
    const mem = c.church_members || c.member || null;
    return card(
      name(esc(c.person_name || mem?.name || 'Someone'))
      + meta([mem?.phone, mem?.email].filter(Boolean).map(esc).join(' · '))
      + (c.ministry ? tag(esc(c.ministry), true) : '')
      + (c.submitted_by ? meta(`— ${esc(c.submitted_by)}`) : ''),
      'green',
    );
  };

  const section = (title, inner) => inner
    ? `<tr><td style="padding-top:18px;">${h2(title)}${inner}</td></tr>` : '';

  const prospectsInner = recap.prospects.length ? recap.prospects.map(prospectCard).join('') : empty;
  const returningInner = recap.returning.length ? recap.returning.map(returningCard).join('') : empty;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>Weekly Recap</title>
  <style>@page { size: letter portrait; margin: 0.5in; }</style></head>
  <body style="margin:0;padding:0;background:#fff;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;max-width:760px;margin:0 auto;font-family:${FONT};font-size:9pt;color:${C.ink};">

    <tr><td style="border-bottom:2px solid #111;padding-bottom:10px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td valign="bottom"><div style="font-size:24pt;font-weight:700;letter-spacing:-0.5px;">Weekly Recap</div>
          <div style="font-size:9pt;color:${C.mute};margin-top:2px;">Week of ${range}</div></td>
        <td valign="bottom" align="right" style="font-size:9pt;color:#444;line-height:1.5;">
          <b style="color:#111;">Bethesda Baptist Church</b><br>${today}</td>
      </tr></table>
    </td></tr>

    <tr><td style="padding-top:14px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><tr>
        ${metric(m.salvations, 'Salvations')}
        ${metric(m.baptisms, 'Baptisms')}
        ${metric(m.newMembers, 'New Members')}
        ${metric(m.guests, 'Guests This Week')}
      </tr></table>
    </td></tr>

    <tr><td style="padding-top:18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><tr>
        <td width="50%" valign="top" style="padding-right:8px;">
          ${h2(`Prospects (${recap.prospects.length})`)}${prospectsInner}</td>
        <td width="50%" valign="top" style="padding-left:8px;">
          ${h2(`Returning Guests / Members (${recap.returning.length})`)}${returningInner}</td>
      </tr></table>
    </td></tr>

    ${section(`First-Time Visitors (${recap.firstTimers.length})`, recap.firstTimers.length ? twoCol(recap.firstTimers.map(g => personCard(g, 'green'))) : '')}
    ${section(`Pathway To Belonging (${recap.comments.length})`, recap.comments.length ? twoCol(recap.comments.map(commentCard)) : '')}
    ${section(`Connections (${(recap.connections || []).length})`, (recap.connections || []).length ? twoCol(recap.connections.map(connectionCard)) : '')}
    ${section(`Salvations (${recap.salvations.length})`, recap.salvations.length ? twoCol(recap.salvations.map(g => personCard(g, 'soft'))) : '')}
    ${section(`Baptisms (${recap.baptisms.length})`, recap.baptisms.length ? twoCol(recap.baptisms.map(g => personCard(g, 'blue'))) : '')}
    ${section(`New Members (${recap.newMembers.length})`, recap.newMembers.length ? twoCol(recap.newMembers.map(g => personCard(g, 'gray'))) : '')}

    <tr><td style="padding-top:22px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${C.line};font-size:7.5pt;color:${C.faint};">
        <tr><td style="padding-top:8px;">Confidential</td><td align="right" style="padding-top:8px;">${today}</td></tr>
      </table>
    </td></tr>

  </table></body></html>`;
}
export function openRecapPdf(recap) {
  const w = window.open('', '_blank');
  if (!w) { alertDialog('Please allow pop-ups to open the Recap PDF.'); return; }
  w.document.write(buildRecapHtml(recap));
  w.document.close();
  setTimeout(() => w.print(), 500);
}

/* ══════════ Real PDF file (jsPDF) — for auto-attaching to the email ══════════ */
function u8ToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Returns { filename, mime, content(base64) } ready for the mail bridge. */
export function buildRecapPdf(recap) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 40, CW = PW - M * 2, BOTTOM = PH - 46;
  const GAP = 12, COLW = (CW - GAP) / 2;          // two columns, same as the HTML
  let y = M;

  const range = weekLabel();
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const ensure = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };
  const contact = g => [g.phone, g.email].filter(Boolean).join('   ·   ');

  /* ── Header ── */
  font('bold', 22); doc.setTextColor(17, 17, 17);
  doc.text('Weekly Recap', M, y + 18);
  font('normal', 9); doc.setTextColor(85, 85, 85);
  doc.text(`Week of ${range}`, M, y + 31);
  font('bold', 9); doc.setTextColor(17, 17, 17);
  doc.text('Bethesda Baptist Church', PW - M, y + 16, { align: 'right' });
  font('normal', 9); doc.setTextColor(70, 70, 70);
  doc.text(today, PW - M, y + 28, { align: 'right' });
  y += 38;
  doc.setDrawColor(17, 17, 17); doc.setLineWidth(2); doc.line(M, y, PW - M, y);
  y += 18;

  /* ── Metrics ── */
  const metrics = [
    ['Salvations', recap.metrics.salvations], ['Baptisms', recap.metrics.baptisms],
    ['New Members', recap.metrics.newMembers], ['Guests This Week', recap.metrics.guests],
  ];
  const gap = 10, bw = (CW - gap * 3) / 4, bh = 48;
  ensure(bh);
  metrics.forEach(([label, n], i) => {
    const x = M + i * (bw + gap);
    doc.setDrawColor(221, 221, 221); doc.setLineWidth(1); doc.roundedRect(x, y, bw, bh, 5, 5);
    font('bold', 20); doc.setTextColor(17, 17, 17); doc.text(String(n), x + bw / 2, y + 26, { align: 'center' });
    font('normal', 7); doc.setTextColor(110, 110, 110); doc.text(label.toUpperCase(), x + bw / 2, y + 40, { align: 'center' });
  });
  y += bh + 20;

  const headingAt = (t, x, w, yy) => {
    font('bold', 11); doc.setTextColor(17, 17, 17); doc.text(t, x, yy + 10);
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.8); doc.line(x, yy + 15, x + w, yy + 15);
    return yy + 24;
  };

  /* Height of a card at a given width — measured before drawing so paired
     cards can share a baseline and page breaks land correctly. */
  const cardHeight = (o, w) => {
    font('italic', 8.5);
    const notes = o.notes ? doc.splitTextToSize(String(o.notes), w - 24) : [];
    font('bold', 9.5);
    const nameLines = doc.splitTextToSize(String(o.name || ''), w - 24);
    let h = 12 + nameLines.length * 12;
    if (o.badge) h += 11;
    if (o.meta) {
      font('normal', 8.5);
      h += doc.splitTextToSize(String(o.meta), w - 24).length * 12;   // meta wraps too
    }
    if (o.tag) h += 13;
    if (notes.length) h += notes.length * 11 + 2;
    return h + 8;
  };

  const drawCard = (o, x, yy, w) => {
    const h = cardHeight(o, w);
    const bg = o.bg || [247, 247, 247];
    doc.setFillColor(bg[0], bg[1], bg[2]); doc.roundedRect(x, yy, w, h, 5, 5, 'F');
    let ty = yy + 16;
    font('bold', 9.5); doc.setTextColor(20, 20, 20);
    const nameLines = doc.splitTextToSize(String(o.name || ''), w - 24);
    doc.text(nameLines, x + 12, ty); ty += nameLines.length * 12;
    if (o.badge) {
      font('bold', 7.5); doc.setTextColor(o.badge.color[0], o.badge.color[1], o.badge.color[2]);
      doc.text(o.badge.text, x + 12, ty); ty += 11;
    }
    if (o.meta) {
      font('normal', 8.5); doc.setTextColor(85, 85, 85);
      const metaLines = doc.splitTextToSize(String(o.meta), w - 24);
      doc.text(metaLines, x + 12, ty); ty += metaLines.length * 12;
    }
    if (o.tag) { font('bold', 7); doc.setTextColor(90, 90, 90); doc.text(String(o.tag).toUpperCase(), x + 12, ty + 1); ty += 13; }
    if (o.notes) {
      font('italic', 8.5); doc.setTextColor(68, 68, 68);
      doc.text(doc.splitTextToSize(String(o.notes), w - 24), x + 12, ty);
    }
    return h;
  };

  /* A section whose cards flow across two columns, like the HTML grid. */
  const twoColSection = (title, items, toOpts) => {
    if (!items.length) return;
    // Keep the heading with its first row of cards — a heading stranded at the
    // bottom of a page reads like the section is empty.
    const firstRowH = Math.max(
      cardHeight(toOpts(items[0]), COLW),
      items[1] ? cardHeight(toOpts(items[1]), COLW) : 0,
    );
    ensure(24 + firstRowH);
    y = headingAt(`${title} (${items.length})`, M, CW, y);
    for (let i = 0; i < items.length; i += 2) {
      const a = toOpts(items[i]);
      const b = items[i + 1] ? toOpts(items[i + 1]) : null;
      const h = Math.max(cardHeight(a, COLW), b ? cardHeight(b, COLW) : 0);
      ensure(h);
      drawCard(a, M, y, COLW);
      if (b) drawCard(b, M + COLW + GAP, y, COLW);
      y += h + 7;
    }
    y += 6;
  };

  /* ── Prospects | Returning, side by side (mirrors the HTML top block) ── */
  const prospectOpts = g => {
    const firstTime = g.first_visit && inWeek(g.first_visit);
    return {
      name: g.full_name,
      badge: firstTime ? { text: 'FIRST VISIT', color: [46, 125, 50] } : null,
      meta: [contact(g), g.first_visit ? `First visit: ${fmtDate(g.first_visit)}` : ''].filter(Boolean).join('   ·   '),
      tag: g.status, notes: g.notes,
      bg: firstTime ? [232, 245, 233] : [240, 240, 240],
    };
  };
  const returningOpts = g => ({
    name: g.full_name,
    badge: g.absence_type === 'Long' ? { text: 'Returning after long absence', color: [176, 0, 32] }
      : g.absence_type === 'Brief' ? { text: 'Returning after brief absence', color: [178, 106, 0] } : null,
    meta: contact(g),
  });

  // Row-paired drawing so long lists page-break instead of running off the
  // bottom: row i holds prospect[i] on the left and returning[i] on the right,
  // ensure()d as a unit. A plain per-column forEach drew everything past
  // ~7 cards off-page — silently missing from the emailed PDF.
  ensure(60);
  const topY = y;
  headingAt(`Prospects (${recap.prospects.length})`, M, COLW, topY);
  y = headingAt(`Returning Guests / Members (${recap.returning.length})`, M + COLW + GAP, COLW, topY);
  const emptyNote = (x, yy) => {
    font('italic', 9); doc.setTextColor(150, 150, 150); doc.text('None this week.', x, yy + 8);
  };
  if (!recap.prospects.length) emptyNote(M, y);
  if (!recap.returning.length) emptyNote(M + COLW + GAP, y);
  const topRows = Math.max(recap.prospects.length, recap.returning.length);
  for (let i = 0; i < topRows; i++) {
    const a = i < recap.prospects.length ? prospectOpts(recap.prospects[i]) : null;
    const b = i < recap.returning.length ? returningOpts(recap.returning[i]) : null;
    const h = Math.max(a ? cardHeight(a, COLW) : 0, b ? cardHeight(b, COLW) : 0);
    ensure(h);
    if (a) drawCard(a, M, y, COLW);
    if (b) drawCard(b, M + COLW + GAP, y, COLW);
    y += h + 7;
  }
  if (!topRows) y += 18;   // just the empty notes
  y += 12;

  /* ── Remaining sections, two columns each ── */
  twoColSection('First-Time Visitors', recap.firstTimers || [], g => ({
    name: g.full_name, meta: contact(g) || 'No contact on file', bg: [232, 245, 233],
  }));
  twoColSection('Pathway To Belonging', recap.comments || [], c => ({
    name: c.person_name || 'Someone', notes: c.comment,
    meta: c.submitted_by ? `— ${c.submitted_by}${c.created_at ? ` · ${fmtDate(c.created_at)}` : ''}` : '',
    bg: [240, 240, 240],
  }));
  twoColSection('Connections', recap.connections || [], c => {
    const mem = c.church_members || c.member || null;
    return {
      name: c.person_name || mem?.name || 'Someone',
      meta: [mem?.phone, mem?.email].filter(Boolean).join('   ·   '),
      tag: c.ministry, bg: [232, 245, 233],
    };
  });
  twoColSection('Salvations', recap.salvations || [], g => ({
    name: g.full_name, meta: contact(g) || 'No contact on file',
  }));
  twoColSection('Baptisms', recap.baptisms || [], g => ({
    name: g.full_name, meta: contact(g) || 'No contact on file', bg: [227, 242, 253],
  }));
  twoColSection('New Members', recap.newMembers || [], g => ({
    name: g.full_name, meta: contact(g) || 'No contact on file', bg: [240, 240, 240],
  }));

  /* ── Footer on every page ── */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font('normal', 7.5); doc.setTextColor(140, 140, 140);
    doc.text('Confidential', M, PH - 28);
    doc.text(today, PW - M, PH - 28, { align: 'right' });
  }

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  const n = new Date();   // local date — toISOString() is UTC and flips to Monday on Sunday-evening sends
  const stamp = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  return { filename: `weekly-recap-${stamp}.pdf`, mime: 'application/pdf', content: u8ToBase64(bytes) };
}
