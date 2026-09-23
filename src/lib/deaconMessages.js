import { supabase } from './supabase';
import { normPhone, formatPhone, sepLabel } from './conversations';
import { readableSendError } from '../../supabase/functions/_shared/sendErrors.ts';

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

export { formatPhone, sepLabel, readableSendError };

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
 * A failed attempt that a later retry delivered is not a failure anyone needs to
 * read about. The care job re-sends whatever did not arrive on its next half-hour
 * run, so a provider outage leaves a row of red attempts ahead of the text that
 * finally went through — on Sep 23, three of them for one message. They fold
 * into that one message, with a note saying it went through on a retry.
 *
 * Only attempts within a day of each other count as the same message: an
 * identical alert sent the following week is a new text, not a retry.
 */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const byTime = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
const gaveUp = tries => ({
  ...tries[tries.length - 1], retries: tries.length - 1, firstTriedAt: tries[0].created_at, undelivered: true,
});
const apart = (a, b) => new Date(b.created_at) - new Date(a.created_at);

export function foldRetries(messages = []) {
  const out = [];
  const pending = new Map();   // text → failed attempts still waiting for a delivery
  for (const m of [...messages].sort(byTime)) {
    const outbound = m.direction !== 'in';
    const key = String(m.body || '');
    if (outbound && m.status === 'Failed') {
      const tries = pending.get(key);
      if (tries && apart(tries[0], m) <= RETRY_WINDOW_MS) tries.push(m);
      else {
        if (tries) out.push(gaveUp(tries));
        pending.set(key, [m]);
      }
      continue;
    }
    if (outbound && pending.has(key)) {
      const tries = pending.get(key);
      pending.delete(key);
      if (apart(tries[0], m) <= RETRY_WINDOW_MS) {
        out.push({ ...m, retries: tries.length, firstTriedAt: tries[0].created_at, delayedBy: tries[tries.length - 1].error });
        continue;
      }
      out.push(gaveUp(tries));
    }
    out.push(m);
  }
  // Attempts no later text ever answered really did fail.
  for (const tries of pending.values()) out.push(gaveUp(tries));
  return out.sort(byTime);
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
    const items = foldRetries(t.messages);
    const last = items[items.length - 1] || null;
    return {
      ...t,
      items,
      label: t.name || formatPhone(t.phone10),
      last,
      lastAt: last?.created_at || null,
      sent: items.filter(m => m.direction !== 'in' && !m.undelivered).length,
      replies: items.filter(m => m.direction === 'in').length,
      failed: items.filter(m => m.undelivered).length,
      late: items.filter(m => m.retries > 0 && !m.undelivered).length,
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
