import { supabase } from './supabase';
import { normPhone, formatPhone, sepLabel } from './conversations';

/*
 * What each deacon was told.
 *
 * Deacon alerts go out on the care channel, which sms-care-isolation.sql keeps
 * out of the congregation log — hospitals, diagnoses and names do not belong in
 * a view every staff member can open. sms-deacon-visibility.sql opens one slice
 * of it: messages addressed to a deacon's own number, for staff who hold Cares
 * access. The rule lives in row-level security; this module only asks.
 *
 * Reading is all it does. Replying to a deacon is an ordinary text, and the
 * composer already sends those.
 */

export const canSeeDeaconMessages = profile => {
  if (!profile || profile.active === false) return false;
  if (String(profile.role || '').toLowerCase().includes('admin')) return true;
  return ['view', 'edit'].includes(String(profile.permissions?.cares || 'none'));
};

export { formatPhone, sepLabel };

/* Both directions store the other party's number, so one number is one deacon's thread. */
const FETCH_PAGE = 1000;

export async function fetchDeaconMessages() {
  const rows = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('sms_messages')
      .select('id, to_number, to10, to_name, body, status, direction, error, created_at, campaign')
      .eq('channel', 'care')
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, from + FETCH_PAGE - 1);
    if (error) {
      // No rows readable at all: either the rule has not been run yet, or this
      // person may not see care traffic. The page says so rather than looking empty.
      return rows.length ? { rows, blocked: false, partial: true } : { rows: [], blocked: true };
    }
    rows.push(...(data || []));
    if (!data || data.length < FETCH_PAGE) break;
  }
  return { rows, blocked: false };
}

/*
 * One thread per deacon, newest activity first. Deacons the directory knows but
 * who have never been texted are kept — "nothing has gone to them" is an answer
 * the office needs as much as the messages themselves.
 */
export function buildDeaconThreads(rows = [], deacons = []) {
  const byPhone = new Map();
  const touch = (phone10, name) => {
    if (!byPhone.has(phone10)) byPhone.set(phone10, { phone10, name: name || '', messages: [] });
    const t = byPhone.get(phone10);
    if (!t.name && name) t.name = name;
    return t;
  };
  for (const d of deacons) if (d.phone10) touch(d.phone10, d.name);
  for (const m of rows) {
    const phone10 = m.to10 || normPhone(m.to_number);
    if (!phone10) continue;
    touch(phone10, m.to_name).messages.push(m);
  }

  const threads = [...byPhone.values()].map(t => {
    const last = t.messages[t.messages.length - 1] || null;
    return {
      ...t,
      label: t.name || formatPhone(t.phone10),
      last,
      lastAt: last?.created_at || null,
      sent: t.messages.filter(m => m.direction !== 'in').length,
      replies: t.messages.filter(m => m.direction === 'in').length,
      failed: t.messages.filter(m => m.status === 'Failed').length,
    };
  });
  /* Most recent first; deacons with nothing yet fall to the bottom, by name. */
  return threads.sort((a, b) => {
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return a.label.localeCompare(b.label);
  });
}

export const dayLabel = iso => sepLabel(iso);

export const timeLabel = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/* "Sep 14, 4:00 PM" for a rail's last-activity stamp. */
export const stampLabel = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
