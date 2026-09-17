import { supabase } from './supabase';
import { sendMessage } from './email';
import { esc, C, docShell, section, metric, card, name, meta, notes } from './docTheme';

/*
 * Care updates by email: everyone in care, each with the most recent thing
 * written about them, sent to one of the email groups.
 *
 * Only staff an admin has given "Email care updates" see the button. These are
 * private pastoral details, so the list is always shown before anything goes.
 */

export const canSendCareUpdates = profile => profile?.permissions?.careUpdates === true;

const LAST_GROUP = 'pillar.careUpdates.group';
export const rememberGroup = g => { try { localStorage.setItem(LAST_GROUP, g); } catch { /* private mode */ } };
export const lastGroup = () => { try { return localStorage.getItem(LAST_GROUP) || ''; } catch { return ''; } };

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const byName = (a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), undefined, { sensitivity: 'base' });

const dayLabel = d => {
  const x = new Date(d);
  if (isNaN(x)) return '';
  const sameYear = x.getFullYear() === new Date().getFullYear();
  return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};

const where = m => [clean(m.hospital_name), m.room_number ? `Rm ${clean(m.room_number)}` : '']
  .filter(Boolean).join(', ');

/* One person: who they are, and the newest update — or their care note when nobody has logged one yet. */
export function careEntry(m) {
  const logs = (m.contact_logs || []).filter(l => clean(l.notes));
  const latest = logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  return {
    id: m.id,
    name: clean(m.full_name) || 'Unnamed',
    high: m.priority === 'High',
    about: [clean(m.category), where(m)].filter(Boolean).join(' · '),
    when: latest ? dayLabel(latest.created_at) : '',
    how: latest ? [clean(latest.type), clean(latest.logged_by_name) ? `by ${clean(latest.logged_by_name)}` : ''].filter(Boolean).join(' ') : '',
    text: latest ? clean(latest.notes) : clean(m.care_notes),
    kind: latest ? 'update' : (clean(m.care_notes) ? 'note' : 'none'),
  };
}

/* Everyone currently in care: high priority first, then everyone else, alphabetical within each. */
export function careUpdateList(members = []) {
  const active = members.filter(m => (m.status || 'Active') === 'Active').sort(byName).map(careEntry);
  return { high: active.filter(e => e.high), rest: active.filter(e => !e.high), total: active.length };
}

export function careUpdateSubject(now = new Date()) {
  return `Care updates — ${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

const stamp = e => (e.kind === 'update' ? [e.when, e.how].filter(Boolean).join(' · ')
  : e.kind === 'note' ? 'Care note — no update logged yet' : 'No update logged yet');

export function careUpdateText({ high, rest, total }, { group, sender } = {}) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const block = e => [
    `${e.name}${e.high ? ' (High priority)' : ''}${e.about ? ` — ${e.about}` : ''}`,
    stamp(e),
    e.text,
  ].filter(Boolean).join('\n');
  const part = (title, list) => (list.length ? `${title.toUpperCase()}\n\n${list.map(block).join('\n\n')}` : '');
  return [
    `Care updates — ${today}`,
    `${total} ${total === 1 ? 'person' : 'people'} in care${high.length ? ` · ${high.length} high priority` : ''}`,
    part('High priority', high),
    part(high.length ? 'Everyone else' : 'Everyone in care', rest),
    `Confidential pastoral care information${group ? ` for ${group}` : ''}. Please don't forward it.${sender ? `\n\nSent by ${sender} from Pillar.` : ''}`,
  ].filter(Boolean).join('\n\n');
}

export function careUpdateHtml({ high, rest, total }, { group, sender } = {}) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const withUpdate = [...high, ...rest].filter(e => e.kind === 'update').length;
  const entry = e => card(
    name(`${esc(e.name)}${e.high ? ` <span style="color:#b91c1c;font-weight:700;">· High priority</span>` : ''}`)
    + meta(esc(e.about))
    + meta(`<span style="color:${C.faint};">${esc(stamp(e))}</span>`)
    + notes(esc(e.text)),
    e.high ? 'gray' : 'soft',
  );
  const body = section(`High priority (${high.length})`, high.map(entry).join(''))
    + section(`${high.length ? 'Everyone else' : 'Everyone in care'} (${rest.length})`, rest.map(entry).join(''))
    + `<tr><td style="padding-top:16px;font-size:8.5pt;color:${C.mute};">Confidential pastoral care information${group ? ` for ${esc(group)}` : ''}. Please don't forward it.${sender ? ` Sent by ${esc(sender)} from Pillar.` : ''}</td></tr>`;
  return docShell({
    docTitle: 'Care Updates',
    heading: 'Care Updates',
    subheading: 'The latest update for everyone in care',
    today,
    metricsRow: metric(total, 'In care') + metric(high.length, 'High priority')
      + metric(withUpdate, 'With an update') + metric(total - withUpdate, 'No update yet'),
    body,
  });
}

const SEND_GAP_MS = 250;
const RETRIES = 1;

/* One message per person, so nobody sees who else is on the list. */
export async function sendCareUpdates({ account, recipients, subject, text, html, senderName, createdBy, onProgress }) {
  const seen = new Set();
  const list = recipients.map(r => clean(r)).filter(e => e && !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
  if (!list.length) throw new Error('This list has no email addresses.');

  const delivered = [];
  const failed = [];
  for (let i = 0; i < list.length; i++) {
    const to = list[i];
    let lastErr = '';
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (i || attempt) await new Promise(r => setTimeout(r, attempt ? 1200 : SEND_GAP_MS));
      try {
        const info = await sendMessage(account, { to, subject, body: text, htmlBody: html });
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

  if (delivered.length) {
    const { error } = await supabase.from('recap_sends').insert({
      subject, recipients: delivered, recipient_count: delivered.length,
      sender_name: senderName || null, created_by: createdBy || null,
    });
    if (error) console.warn('Care updates sent, but the send log failed:', error.message);
  }
  return { sent: delivered.length, failed };
}
