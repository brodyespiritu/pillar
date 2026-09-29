import { supabase } from './supabase';

// Requests members send from their own profile in the app (supabase/member-requests.sql, 2026-09-21):
//   · change — the details they typed over (name, email, mobile) and/or a new photo. Approve puts them
//     on the member's record; until then the app shows the member "Updating…".
//   · delete — why they'd like their app account deleted, for the office to take care of.
// Closing one out sets handled_at, so it leaves the list and the member's "Updating…" goes away.

const COLUMNS = 'id,kind,message,photo,changes,created_at,member:church_members(id,name,email,phone,photo_url)';
export const DETAIL_LABELS = { name: 'Name', email: 'Email', phone: 'Mobile' };

/** What's waiting, oldest first. null when member-requests.sql hasn't been run yet. */
export async function fetchMemberRequests({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('member_requests')
    .select(COLUMNS)
    .is('handled_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /member_requests/.test(error.message || '')) return null;
    throw error;
  }
  return data || [];
}

/** The details a change request would put on the record: [{ key, label, from, to }]. */
export function detailChanges(req) {
  const c = req?.changes && typeof req.changes === 'object' ? req.changes : {};
  return Object.keys(DETAIL_LABELS).filter((k) => c[k]).map((k) => ({
    key: k, label: DETAIL_LABELS[k], from: String(req.member?.[k] ?? ''), to: String(c[k]),
  }));
}

/** One line for the list: "Name, Mobile and a new photo", or the start of a deletion's reason. */
export function summary(req) {
  if (req?.kind === 'delete') return req.message || 'Asked to delete their app account';
  const parts = detailChanges(req).map((d) => d.label);
  if (req?.photo) parts.push(parts.length ? 'a new photo' : 'A new photo');
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
  return said || req?.message || 'A change';
}

/** Approve a change: what they asked for goes on their record, then the request is closed. */
export async function approveRequest(req, staffId) {
  const patch = {};
  for (const d of detailChanges(req)) patch[d.key] = d.to;
  if (req.photo) patch.photo_url = req.photo;
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('church_members').update(patch).eq('id', req.member.id);
    if (error) throw error;
  }
  await closeRequest(req.id, staffId, 'approved');
}

/** Close one out: 'done' (taken care of), 'declined', or 'approved' (from approveRequest). */
export async function closeRequest(id, staffId, outcome) {
  const { error } = await supabase
    .from('member_requests')
    .update({ handled_at: new Date().toISOString(), handled_by: staffId || null, outcome })
    .eq('id', id);
  if (error) throw error;
}

/** "3 minutes ago" — its own copy, so this stays when the test kit's reports go. */
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
