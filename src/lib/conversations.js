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
export async function fetchThreads() {
  const { data, error } = await supabase
    .from('sms_messages')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    return { rows: [], missing: /relation|column|does not exist/i.test(error.message || '') };
  }

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
