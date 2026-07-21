import { alertDialog } from "./dialog";
import { jsPDF } from 'jspdf';
import { supabase } from './supabase';
import { sendMessage } from './email';
import { weekRange, weekLabel, isProspect } from './guests';
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
 * "This week" = Sunday–Saturday (weekRange from guests.js).
 */

const inWeek = dateStr => {
  if (!dateStr) return false;
  const { start, end } = weekRange();
  const d = new Date(dateStr);
  return d >= start && d <= end;
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
  const { data } = await supabase.from('new_connections').select('*').order('created_at', { ascending: false });
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

  // First-timers: visited this week and their first visit is also this week
  const firstTimers = guests.filter(g =>
    visited(g) && !ownSection.has(g.type) && !isProspect(g) &&
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
  await sendMessage(account, { to, subject, body, attachments });   // throws on failure
  await supabase.from('recap_sends').insert({
    subject, recipients, recipient_count: recipients.length,
    sender_name: senderName || null, created_by: createdBy || null,
  });
}

/* ══════════ Weekly Recap "PDF" (HTML → browser print) ══════════ */
const esc = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export function buildRecapHtml(recap) {
  const { start, end } = weekRange();
  const range = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const m = recap.metrics;

  const metric = (n, label) => `<div class="metric"><div class="metric-n">${n}</div><div class="metric-l">${label}</div></div>`;

  const prospectCard = g => {
    const firstTime = g.first_visit && inWeek(g.first_visit);
    return `<div class="card ${firstTime ? 'green' : 'gray'}">
      <div class="card-name">${esc(g.full_name)}${firstTime ? ' <span class="tag green-tag">First visit</span>' : ''}</div>
      <div class="card-meta">${[g.phone, g.email].filter(Boolean).map(esc).join(' · ')}</div>
      ${g.first_visit ? `<div class="card-meta">First visit: ${fmtDate(g.first_visit)}</div>` : ''}
      ${g.status ? `<span class="tag">${esc(g.status)}</span>` : ''}
      ${g.notes ? `<div class="card-notes">${esc(g.notes)}</div>` : ''}
    </div>`;
  };

  const absenceLabel = g => g.absence_type === 'Long'
    ? '<span class="abs red">Returning after long absence</span>'
    : g.absence_type === 'Brief'
      ? '<span class="abs orange">Returning after brief absence</span>' : '';
  const returningCard = g => `<div class="rcard">
      <span class="rcard-name">${esc(g.full_name)}</span>
      ${absenceLabel(g)}
    </div>`;

  const section = (title, inner, cls = '') => inner
    ? `<div class="section ${cls}"><h2>${title}</h2>${inner}</div>` : '';

  const prospectsCol = recap.prospects.length
    ? `<div class="col"><h2>Prospects (${recap.prospects.length})</h2>${recap.prospects.map(prospectCard).join('')}</div>`
    : `<div class="col"><h2>Prospects</h2><p class="empty">None this week.</p></div>`;
  const returningCol = `<div class="col"><h2>Returning Guests / Members (${recap.returning.length})</h2>${
    recap.returning.length ? recap.returning.map(returningCard).join('') : '<p class="empty">None this week.</p>'}</div>`;

  const pathway = recap.comments.length
    ? `<div class="grid2">${recap.comments.map(c => `<div class="card gray">
        <div class="card-name">${esc(c.person_name || 'Someone')}</div>
        <div class="card-notes">${esc(c.comment || '')}</div>
        ${c.submitted_by ? `<div class="card-meta">— ${esc(c.submitted_by)}</div>` : ''}
      </div>`).join('')}</div>` : '';

  const salvationsHtml = recap.salvations.length
    ? `<div class="grid2">${recap.salvations.map(g => `<div class="card">
        <div class="card-name">${esc(g.full_name)}</div>
        <div class="card-meta">${[g.phone, g.email].filter(Boolean).map(esc).join(' · ') || 'No contact on file'}</div>
      </div>`).join('')}</div>` : '';

  const connectionsHtml = (recap.connections || []).length
    ? `<div class="grid2">${recap.connections.map(c => `<div class="card green">
        <div class="card-name">${esc(c.person_name || 'Someone')}</div>
        <span class="tag green-tag">${esc(c.ministry || 'Ministry')}</span>
        ${c.submitted_by ? `<div class="card-meta">— ${esc(c.submitted_by)}</div>` : ''}
      </div>`).join('')}</div>` : '';

  const baptisms = recap.baptisms.length
    ? `<div class="grid2">${recap.baptisms.map(g => `<div class="card blue">
        <div class="card-name">${esc(g.full_name)}</div>
        <div class="card-meta">${[g.phone, g.email].filter(Boolean).map(esc).join(' · ')}</div>
      </div>`).join('')}</div>` : '';

  const members = recap.newMembers.length
    ? `<div class="grid2">${recap.newMembers.map(g => `<div class="card gray">
        <div class="card-name">${esc(g.full_name)}</div>
        <div class="card-meta">${[g.phone, g.email].filter(Boolean).map(esc).join(' · ')}</div>
      </div>`).join('')}</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weekly Recap</title>
  <style>
    @page { size: letter portrait; margin: 0.5in; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 9pt; color: #1a1a1a; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
    .head h1 { font-size: 24pt; margin: 0; letter-spacing: -0.5px; }
    .head .right { text-align: right; font-size: 9pt; color: #444; line-height: 1.5; }
    .head .right b { color: #111; }
    .metrics { display: flex; gap: 10px; margin-bottom: 18px; }
    .metric { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 10px; text-align: center; }
    .metric-n { font-size: 20pt; font-weight: 700; line-height: 1; }
    .metric-l { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 5px; }
    .cols { display: flex; gap: 16px; }
    .col { flex: 1; min-width: 0; }
    h2 { font-size: 11pt; margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
    .card, .rcard { page-break-inside: avoid; border-radius: 6px; padding: 8px 10px; margin-bottom: 7px; background: #f7f7f7; }
    .card.gray { background: #f0f0f0; }
    .card.green { background: #e8f5e9; }
    .card.blue { background: #e3f2fd; }
    .card-name { font-weight: 700; font-size: 9.5pt; }
    .card-meta { color: #555; margin-top: 2px; }
    .card-notes { font-style: italic; color: #444; margin-top: 4px; }
    .tag { display: inline-block; font-size: 7pt; font-weight: 600; background: #fff; border: 1px solid #ccc; border-radius: 999px; padding: 1px 8px; margin-top: 5px; }
    .green-tag { background: #c8e6c9; border-color: #a5d6a7; font-style: normal; }
    .rcard { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .rcard-name { font-weight: 600; }
    .abs { font-size: 7pt; font-weight: 700; padding: 1px 7px; border-radius: 999px; }
    .abs.red { color: #b00020; background: #fde7e9; }
    .abs.orange { color: #b26a00; background: #fff2df; }
    .section { margin-top: 18px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .empty { color: #999; font-style: italic; }
    .foot { display: flex; justify-content: space-between; margin-top: 22px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 7.5pt; color: #888; }
  </style></head><body>
    <div class="head">
      <h1>Weekly Recap</h1>
      <div class="right"><b>Week of ${range}</b><br>Bethesda Church<br>${today}</div>
    </div>
    <div class="metrics">
      ${metric(m.salvations, 'Salvations')}
      ${metric(m.baptisms, 'Baptisms')}
      ${metric(m.newMembers, 'New Members')}
      ${metric(m.guests, 'Guests This Week')}
    </div>
    <div class="cols">${prospectsCol}${returningCol}</div>
    ${section('Pathway To Belonging', pathway)}
    ${section('New Connections', connectionsHtml)}
    ${section('Salvations', salvationsHtml)}
    ${section('Baptisms', baptisms)}
    ${section('New Members', members)}
    <div class="foot"><span>Confidential</span><span>${today}</span></div>
  </body></html>`;
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
  let y = M;

  const { start, end } = weekRange();
  const range = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const ensure = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };

  // Header
  font('bold', 22); doc.setTextColor(17, 17, 17);
  doc.text('Weekly Recap', M, y + 18);
  font('normal', 9); doc.setTextColor(70, 70, 70);
  doc.text(`Week of ${range}`, PW - M, y + 4, { align: 'right' });
  doc.setTextColor(17, 17, 17); doc.text('Bethesda Church', PW - M, y + 16, { align: 'right' });
  doc.setTextColor(70, 70, 70); doc.text(today, PW - M, y + 28, { align: 'right' });
  y += 34;
  doc.setDrawColor(17, 17, 17); doc.setLineWidth(2); doc.line(M, y, PW - M, y);
  y += 18;

  // Metrics bar
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

  const heading = t => {
    ensure(28);
    font('bold', 12); doc.setTextColor(17, 17, 17); doc.text(t, M, y + 10);
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.8); doc.line(M, y + 15, PW - M, y + 15);
    y += 24;
  };

  const card = ({ name, meta = [], notes, tag, bg = [247, 247, 247], badge }) => {
    const metaLine = meta.filter(Boolean).join('   ·   ');
    font('italic', 8.5);
    const notesLines = notes ? doc.splitTextToSize(notes, CW - 24) : [];
    let h = 12 + 12;                 // top pad + name
    if (metaLine) h += 12;
    if (tag) h += 13;
    if (notesLines.length) h += notesLines.length * 11 + 2;
    h += 8;
    ensure(h);
    doc.setFillColor(bg[0], bg[1], bg[2]); doc.roundedRect(M, y, CW, h, 5, 5, 'F');
    let ty = y + 16;
    font('bold', 9.5); doc.setTextColor(20, 20, 20); doc.text(String(name), M + 12, ty);
    if (badge) { font('bold', 7.5); doc.setTextColor(badge.color[0], badge.color[1], badge.color[2]); doc.text(badge.text, PW - M - 12, ty, { align: 'right' }); }
    ty += 12;
    if (metaLine) { font('normal', 8.5); doc.setTextColor(85, 85, 85); doc.text(metaLine, M + 12, ty); ty += 12; }
    if (tag) { font('bold', 7); doc.setTextColor(90, 90, 90); doc.text(String(tag).toUpperCase(), M + 12, ty + 1); ty += 13; }
    if (notesLines.length) { font('italic', 8.5); doc.setTextColor(68, 68, 68); doc.text(notesLines, M + 12, ty); }
    y += h + 7;
  };

  const list = (title, items, render, { always = false, empty = 'None this week.' } = {}) => {
    if (!items.length && !always) return;
    heading(title);
    if (!items.length) {
      font('italic', 9); doc.setTextColor(150, 150, 150); doc.text(empty, M, y + 4); y += 16;
      return;
    }
    items.forEach(render);
    y += 6;
  };

  list(`Prospects (${recap.prospects.length})`, recap.prospects, g => {
    const firstTime = g.first_visit && inWeek(g.first_visit);
    card({
      name: g.full_name,
      meta: [g.phone, g.email, g.first_visit ? `First visit ${fmtDate(g.first_visit)}` : ''],
      notes: g.notes, tag: g.status,
      bg: firstTime ? [232, 245, 233] : [240, 240, 240],
      badge: firstTime ? { text: 'FIRST VISIT', color: [46, 125, 50] } : null,
    });
  }, { always: true });

  list(`Returning Guests / Members (${recap.returning.length})`, recap.returning, g => {
    const badge = g.absence_type === 'Long' ? { text: 'LONG ABSENCE', color: [176, 0, 32] }
      : g.absence_type === 'Brief' ? { text: 'BRIEF ABSENCE', color: [178, 106, 0] } : null;
    card({ name: g.full_name, badge });
  }, { always: true });

  list('Pathway To Belonging', recap.comments, c =>
    card({ name: c.person_name || 'Someone', notes: c.comment, meta: c.submitted_by ? [`— ${c.submitted_by}`] : [], bg: [240, 240, 240] }));

  list('New Connections', recap.connections || [], c =>
    card({
      name: c.person_name || 'Someone', tag: c.ministry,
      meta: c.submitted_by ? [`— ${c.submitted_by}`] : [],
      bg: [232, 245, 233], badge: { text: 'CONNECTED', color: [46, 125, 50] },
    }));

  list('Salvations', recap.salvations, g =>
    card({ name: g.full_name, meta: [g.phone, g.email].filter(Boolean).length ? [g.phone, g.email] : ['No contact on file'] }));

  list('Baptisms', recap.baptisms, g =>
    card({ name: g.full_name, meta: [g.phone, g.email], bg: [227, 242, 253] }));

  list('New Members', recap.newMembers, g =>
    card({ name: g.full_name, meta: [g.phone, g.email], bg: [240, 240, 240] }));

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font('normal', 7.5); doc.setTextColor(140, 140, 140);
    doc.text('Confidential', M, PH - 28);
    doc.text(today, PW - M, PH - 28, { align: 'right' });
  }

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `weekly-recap-${stamp}.pdf`, mime: 'application/pdf', content: u8ToBase64(bytes) };
}
