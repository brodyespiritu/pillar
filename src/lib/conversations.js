import { supabase } from './supabase';
import { sendProspectSms } from './sms';

/* Two-way SMS conversations, threaded by the other party's phone number.
 * Rows live in sms_messages (direction 'out' = we sent, 'in' = they replied).
 * Requires supabase/sms-inbound-schema.sql + the telnyx-inbound webhook. */

export const normPhone = p => String(p || '').replace(/\D/g, '').slice(-10);

export function formatPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  const n = d.length > 10 ? d.slice(-10) : d;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return p || '';
}

/** All threads (grouped by number), newest activity first. */
/*
 * PostgREST caps a response at 1000 rows. This query is ordered OLDEST first,
 * so once the log passed a thousand messages the cap returned the oldest
 * thousand and silently dropped everything newer — every reply vanished and
 * Refresh kept re-fetching the same stale page. Page through instead.
 */
const PAGE = 1000;

export async function fetchThreads() {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sms_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id')                     // stable tiebreak so paging can't skip rows
      .range(from, from + PAGE - 1);
    if (error) {
      if (all.length) break;           // keep what we have rather than showing nothing
      return { rows: [], missing: /relation|column|does not exist/i.test(error.message || '') };
    }
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const data = all;

  const map = new Map();
  for (const m of data || []) {
    const key = normPhone(m.to_number);
    if (!key) continue;
    let t = map.get(key);
    if (!t) { t = { key, number: m.to_number, name: '', messages: [], hasInbound: false, unreadIds: [] }; map.set(key, t); }
    t.messages.push(m);
    if (m.to_name && !t.name) t.name = m.to_name;
    if (m.to_number) t.number = m.to_number;
    const dir = m.direction || 'out';
    if (dir === 'in') { t.hasInbound = true; if (!m.read_at) t.unreadIds.push(m.id); }
    t.lastAt = m.created_at;
    t.lastBody = m.body;
    t.lastDir = dir;
  }
  const rows = [...map.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  return { rows, missing: false };
}

/** Send a single text; logs to sms_messages via the Telnyx edge function. */
export async function sendText({ number, name, body }) {
  return sendProspectSms([{ to_number: number, to_name: name || '', body }]);
}

/** Mark inbound replies as read. */
export async function markRead(ids) {
  if (!ids?.length) return;
  await supabase.from('sms_messages').update({ read_at: new Date().toISOString() }).in('id', ids);
}

/* A person's decision about one reply's headcount. `count` null with
   excluded false hands it back to the automatic reading. */
export async function setRsvp(id, { count = null, excluded = false } = {}) {
  return supabase.from('sms_messages')
    .update({ rsvp_count: count, rsvp_excluded: excluded })
    .eq('id', id);
}
