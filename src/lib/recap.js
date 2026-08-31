import { alertDialog } from "./dialog";
import { jsPDF } from 'jspdf';
import { supabase } from './supabase';
import { sendMessage } from './email';
import { printHtml } from './printDoc';
import {
  esc, C, FONT, h2, emptyNote, card, name, meta, notes, tag, contact,
  twoCol, metric, docShell, section,
} from './docTheme';
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

  // A decision belongs to the week it was RECORDED, not the last time the
  // person attended — otherwise someone entered as a Baptism months ago
  // reappears as this week's baptism the next Sunday they show up.
  const decided = g => inWeek(g.created_at || g.last_visit);

  const salvations = guests.filter(g => g.type === 'Salvation' && decided(g));
  const baptisms   = guests.filter(g => g.type === 'Baptism'   && decided(g));
  const newMembers = guests.filter(g => g.type === 'New Member' && decided(g));
  // Prospects: filtered by when the record was touched (created/last visit) this week
  const prospects  = guests.filter(g => isProspect(g) && (inWeek(g.created_at) || visited(g)));

  // First-timers: visited this week and their first visit is also this week.
  // The entry type is authoritative: anyone explicitly marked
  // "Returning Guest/Member" belongs in Returning even though the form
  // defaults first_visit to today (which would otherwise read as a first visit).
  const visitor = g => visited(g) && !ownSection.has(g.type) && !isProspect(g)
    && g.type !== 'Comment';   // greeter observations aren't visitors
  const firstTimers = guests.filter(g =>
    visitor(g) && g.type !== 'Returning Guest/Member' &&
    (!g.first_visit || inWeek(g.first_visit)));
  const firstIds = new Set(firstTimers.map(g => g.id));
  const returning = guests.filter(g => visitor(g) && !firstIds.has(g.id));

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
/*
 * One message per recipient, sent one at a time.
 *
 * Batched BCC was worse in every way that matters here: a single refusal took
 * out the whole batch (that is how 18 people silently missed a recap while the
 * log said 38 delivered), and one address failing was indistinguishable from
 * twenty. Per-recipient means a failure is attributable to one person, is
 * retried on its own, and is reported by name. It also gives the best inbox
 * placement, since each message is an ordinary one-to-one email.
 */
const SEND_GAP_MS = 250;      // gentle on the SMTP server between messages
const RETRIES = 1;            // one second attempt before giving up on an address

export async function sendRecap({
  account, recipients, subject, body, senderName, createdBy, recap, attachment, onProgress,
}) {
  const seen = new Set();
  const list = recipients
    .map(r => String(r).trim())
    .filter(e => e && !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
  if (!list.length) throw new Error('No recipients.');

  /* The emailed PDF is the very same document the Export button produces —
     the caller rasterises it and hands it over. buildRecapPdf remains only as
     the fallback when no attachment was supplied. */
  const attachments = attachment ? [attachment] : (recap ? [buildRecapPdf(recap)] : []);

  const delivered = [];
  const failed = [];

  for (let i = 0; i < list.length; i++) {
    const to = list[i];
    let lastErr = '';
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (i || attempt) await new Promise(r => setTimeout(r, attempt ? 1200 : SEND_GAP_MS));
      try {
        const info = await sendMessage(account, { to, subject, body, attachments });
        /* SMTP can accept the message and still reject the recipient — that
           resolves as success, which is how failures went unnoticed. */
        if ((info?.rejected || []).length) { lastErr = 'Rejected by the mail server'; continue; }
        delivered.push(to);
        lastErr = '';
        break;
      } catch (e) {
        lastErr = String(e?.message || e);
      }
    }
    if (lastErr) failed.push({ email: to, error: lastErr });
    onProgress?.({ done: i + 1, total: list.length, sent: delivered.length, failed: failed.length });
  }

  if (!delivered.length) throw new Error(failed[0]?.error || 'No recipients accepted.');

  // The log is secondary to the send — never fail a delivered recap over it,
  // but don't lose the error silently either (supabase returns, not throws).
  const { error: logErr } = await supabase.from('recap_sends').insert({
    subject, recipients: delivered, recipient_count: delivered.length,
    sender_name: senderName || null, created_by: createdBy || null,
  });
  if (logErr) console.warn('Recap sent, but logging to recap_sends failed:', logErr.message);
  return { sent: delivered.length, failed };
}

/* ══════════ Weekly Recap "PDF" (HTML → browser print) ══════════ */
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
  const plural = (n, one, many) => (n === 1 ? one : many);

  /* Absence wording comes from the entry type when set, otherwise from the
     note text — greeters often write it in prose instead of picking a field. */
  const absence = g => {
    const t = g.absence_type || (/\blong\s+absence\b/i.test(g.notes || '') ? 'Long'
      : /\bbrief\s+absence\b/i.test(g.notes || '') ? 'Brief' : '');
    if (t === 'Long') return `<div class="abs long">Returning after long absence</div>`;
    if (t === 'Brief') return `<div class="abs brief">Returning after brief absence</div>`;
    return '';
  };

  const line = (t, cls = 'sub') => (t ? `<div class="${cls}">${t}</div>` : '');
  const contactLines = g => line(esc(g.phone || '')) + line(esc(g.email || ''));

  /* Greeter comments matched to a returning guest by name. */
  const commentsFor = full => (recap.comments || []).filter(c =>
    (c.person_name || '').trim().toLowerCase() === String(full || '').trim().toLowerCase());

  const prospectCard = g => `<div class="card ${(g.return_count || 0) === 0 ? 'green' : ''}">
      <div class="nm">${esc(g.full_name)}</div>
      ${contactLines(g)}
      ${g.first_visit ? line(`First: ${fmtDate(g.first_visit)}`) : ''}
      ${g.status ? `<div class="status">${esc(g.status)}</div>` : ''}
      ${g.notes ? `<div class="note">${esc(g.notes)}</div>` : ''}
    </div>`;

  const returningCard = g => {
    const n = g.return_count || 0;
    const cs = commentsFor(g.full_name).map(c => `<div class="gc">
        &ldquo;${esc(c.comment || '')}&rdquo;${c.submitted_by ? ` <span class="gc-by">&mdash; ${esc(c.submitted_by)}</span>` : ''}
      </div>`).join('');
    return `<div class="card roomy">
      <div class="nm">${esc(g.full_name)}${n > 1 ? `<span class="pill">x${n}</span>` : ''}</div>
      ${absence(g)}
      ${g.notes ? `<div class="note">${esc(g.notes)}</div>` : ''}
      ${cs}
    </div>`;
  };

  const emptyCard = t => `<div class="card"><div class="sub">${t}</div></div>`;
  const grid = cards => `<div class="grid">${cards.join('')}</div>`;
  const sec = (title, count, inner) => (inner
    ? `<div class="sec"><div class="sec-h">${title} (${count})</div>${inner}</div>` : '');

  const personCard = (g, cls = '') => `<div class="card ${cls}">
      <div class="nm">${esc(g.full_name)}</div>
      ${contactLines(g)}
    </div>`;

  const pathway = (recap.comments || []).map(c => `<div class="card">
      <div class="nm">${esc(c.person_name || 'Someone')}</div>
      <div class="note">${esc(c.comment || '')}</div>
      ${line(`${esc(c.submitted_by || '')}${c.submitted_by && c.created_at ? ' · ' : ''}${c.created_at ? fmtDate(c.created_at) : ''}`)}
    </div>`);

  const connections = (recap.connections || []).map(c => {
    const mem = c.church_members || c.member || null;
    return `<div class="card">
      <div class="nm">${esc(c.person_name || mem?.name || 'Someone')}</div>
      ${line(esc(mem?.phone || ''))}${line(esc(mem?.email || ''))}
      ${c.ministry ? `<div class="status">${esc(c.ministry)}</div>` : ''}
    </div>`;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weekly Recap</title>
  <style>
    @page { size: letter portrait; margin: 0.5in; }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-size: 9pt; line-height: 1.4; color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    .head { display: flex; justify-content: space-between; align-items: flex-end;
            border-bottom: 2px solid #000; padding-bottom: 8px; }
    .head h1 { margin: 0; font-size: 18pt; font-weight: 800; letter-spacing: -0.03em; }
    .head .wk { font-size: 8pt; color: #666; }
    .head .right { text-align: right; font-size: 8pt; color: #666; }

    .metrics { display: flex; gap: 20px; margin: 14px 0 4px; }
    .metric .n { font-size: 20pt; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
    .metric .l { font-size: 6.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #888; }

    .cols { display: flex; gap: 20px; margin-top: 14px; }
    .col { flex: 1; min-width: 0; }
    .col-h, .sec-h {
      font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 6px;
    }

    .card { background: #f0f0f0; border-radius: 5px; padding: 7px 10px; margin-bottom: 5px;
            page-break-inside: avoid; }
    .card.roomy { padding: 8px 12px; }
    .card.green { background: #e8f5e9; }
    .card.blue  { background: #e3f2fd; }
    .nm { font-size: 9pt; font-weight: 600; color: #1a1a1a; }
    .sub { font-size: 7.5pt; color: #666; }
    .status { font-size: 6.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #888; }
    .note { font-size: 7.5pt; color: #777; font-style: italic; }
    .pill { display: inline-block; margin-left: 5px; font-size: 6.5pt; font-weight: 600;
            background: #e3e3e3; color: #555; border-radius: 8px; padding: 0 5px; }
    .abs { font-size: 7.5pt; font-weight: 600; }
    .abs.long  { color: #b71c1c; }
    .abs.brief { color: #e65100; }
    .gc { background: #e8eaf6; border-radius: 3px; padding: 3px 6px; margin-top: 3px;
          font-size: 7pt; font-style: italic; color: #555; }
    .gc-by { font-style: normal; color: #888; }

    .sec { margin-top: 18px; page-break-inside: avoid; }
    .grid { display: flex; flex-wrap: wrap; gap: 5px; }
    .grid > .card { width: 48%; margin-bottom: 0; }

    .foot { display: flex; justify-content: space-between; border-top: 1px solid #ddd;
            margin-top: 20px; padding-top: 6px; font-size: 7pt; color: #bbb; }
  </style></head><body>

    <div class="head">
      <div>
        <h1>Weekly Recap</h1>
        <div class="wk">Week of ${range}</div>
      </div>
      <div class="right">Bethesda Baptist Church<br>${today}</div>
    </div>

    <div class="metrics">
      <div class="metric"><div class="n">${m.salvations}</div><div class="l">${plural(m.salvations, 'Salvation', 'Salvations')}</div></div>
      <div class="metric"><div class="n">${m.baptisms}</div><div class="l">${plural(m.baptisms, 'Baptism', 'Baptisms')}</div></div>
      <div class="metric"><div class="n">${m.newMembers}</div><div class="l">${plural(m.newMembers, 'New Member', 'New Members')}</div></div>
      <div class="metric"><div class="n">${m.guests}</div><div class="l">${plural(m.guests, 'Guest This Week', 'Guests This Week')}</div></div>
    </div>

    <div class="cols">
      <div class="col">
        <div class="col-h">Prospects (${recap.prospects.length})</div>
        ${recap.prospects.length ? recap.prospects.map(prospectCard).join('') : emptyCard('No prospects this week')}
      </div>
      <div class="col">
        <div class="col-h">Returning Guests / Members (${recap.returning.length})</div>
        ${recap.returning.length ? recap.returning.map(returningCard).join('') : emptyCard('No returning guests this week')}
      </div>
    </div>

    ${sec('Pathway To Belonging', pathway.length, pathway.length ? grid(pathway) : '')}
    ${sec('Connections', connections.length, connections.length ? grid(connections) : '')}
    ${sec('First-Time Visitors', recap.firstTimers.length, recap.firstTimers.length ? grid(recap.firstTimers.map(g => personCard(g, 'green'))) : '')}
    ${sec('Salvations', recap.salvations.length, recap.salvations.length ? grid(recap.salvations.map(g => personCard(g))) : '')}
    ${sec('Baptisms', recap.baptisms.length, recap.baptisms.length ? grid(recap.baptisms.map(g => personCard(g, 'blue'))) : '')}
    ${sec('New Members', recap.newMembers.length, recap.newMembers.length ? grid(recap.newMembers.map(g => personCard(g))) : '')}

    <div class="foot"><span>Confidential</span><span>${today}</span></div>
  </body></html>`;
}

export function openRecapPdf(recap) {
  return printHtml(buildRecapHtml(recap), { filename: 'weekly-recap' });
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
    notes: g.notes,          // comments entered on the guest
  });

  /* ── Every group is its own full-width section, two cards per row ── */
  twoColSection('Prospects', recap.prospects || [], prospectOpts);
  twoColSection('Returning Guests / Members', recap.returning || [], returningOpts);

  /* ── Remaining sections, two columns each ── */
  twoColSection('First-Time Visitors', recap.firstTimers || [], g => ({
    name: g.full_name, meta: contact(g) || 'No contact on file', notes: g.notes, bg: [232, 245, 233],
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
    name: g.full_name, meta: contact(g) || 'No contact on file', notes: g.notes,
  }));
  twoColSection('Baptisms', recap.baptisms || [], g => ({
    name: g.full_name, meta: contact(g) || 'No contact on file', notes: g.notes, bg: [227, 242, 253],
  }));
  twoColSection('New Members', recap.newMembers || [], g => ({
    name: g.full_name, meta: contact(g) || 'No contact on file', notes: g.notes, bg: [240, 240, 240],
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
