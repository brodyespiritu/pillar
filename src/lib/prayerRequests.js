import { supabase } from './supabase';

// Prayer requests from the app (user, 2026-09-22: "Prayer requests should pop up in pillar like the
// bug reporting").
//
// A member's request goes through the same function as any message to the office —
// `member-contact-request` → public.member_access_requests — with "Prayer request:" at the front of
// it (BethesdaApp components/PrayerRequestSheet.js). Nothing new to set up, and closing one out sets
// `handled_at`, the column that table already has, so it stops coming back.
//
// The table is staff-only, so these are only ever read inside Pillar.

const MARK = 'Prayer request:';
export const PRAYER_COLUMNS = 'id,name,contact,message,created_at,handled_at';

/** Every prayer request nobody has closed out yet, newest first. */
export async function fetchPrayerRequests({ limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('member_access_requests')
    .select(PRAYER_COLUMNS)
    .ilike('message', `${MARK}%`)
    .is('handled_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(parsePrayer);
}

/** What they asked for, without the marker the app puts in front of it. */
export function parsePrayer(row) {
  const raw = String(row?.message || '');
  return {
    id: row.id,
    words: raw.replace(/^\s*Prayer request:\s*/i, '').trim(),
    from: String(row.name || '').trim(),
    contact: String(row.contact || '').trim(),
    at: row.created_at,
  };
}

/** "3 minutes ago" — the office shouldn't have to read a timestamp. (Its own copy: the test kit's
 *  file next door goes when testing is over.) */
export function sinceLabel(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Prayed for, or taken care of: it won't come back. */
export async function closePrayerRequest(id, staffId) {
  const { error } = await supabase
    .from('member_access_requests')
    .update({ handled_at: new Date().toISOString(), handled_by: staffId || null })
    .eq('id', id);
  if (error) throw error;
}
