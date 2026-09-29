import { supabase } from './supabase';

// ── TESTING · goes when the app's test kit does ───────────────────────────────
//
// What testers send from the orange circle in the app (BethesdaApp components/testkit/). They arrive
// through the same function as a member's message to the office — `member-contact-request` →
// public.member_access_requests — so there was nothing new to set up. The test kit marks its own
// with "[TEST] Bug:" or "[TEST] Praise:", which is how they're told apart from someone asking the
// office to add their details.
//
// Closing one out sets handled_at, the column that table already has, so it stops coming back.

export const REPORT_COLUMNS = 'id,name,contact,message,created_at,handled_at';
const MARK = '[TEST]';

/** Everything a tester sent that hasn't been closed out, newest first — all of it, so "See all" can
 *  show every one (user, 2026-09-23: "I need the ability to see all the bug reports on pillar"). */
export async function fetchReports({ limit = 500 } = {}) {
  const { data, error } = await supabase
    .from('member_access_requests')
    .select(REPORT_COLUMNS)
    .like('message', `${MARK}%`)
    .is('handled_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(parseReport);
}

/** A recording the tester made with the phone, rather than a picture. */
export const isVideo = (url) => /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(String(url || ''));

/** Pull one report apart: what it is, what they said, the picture, and what the app filled in. */
export function parseReport(row) {
  const raw = String(row?.message || '');
  const kind = /^\[TEST\]\s*Praise/i.test(raw) ? 'praise' : 'bug';
  const body = raw.replace(/^\[TEST\]\s*(Bug|Praise)\s*:\s*/i, '');
  const [said, rest = ''] = body.split(/\n?— — —\n?/);
  const link = (/What it looks like:\s*(\S+)/i.exec(said) || [])[1] || '';
  // the two lines the app adds are read separately, so they don't clutter what the tester wrote
  const words = said
    .replace(/\n?What it looks like:.*$/is, '')
    .replace(/\n?\(They attached something, but it could?n[’']t be uploaded\.\)/i, '')
    .trim();
  const facts = {};
  rest.split('\n').forEach((line) => {
    const m = /^([A-Za-z ]+):\s*(.+)$/.exec(line.trim());
    if (m) facts[m[1].trim().toLowerCase()] = m[2].trim();
  });
  // the sending phone's reply code (BethesdaApp components/testkit/replies.js) — builds before
  // 2026-09-24 don't send one, and a reply can't reach those phones
  const code = facts['reply code'] || '';
  return {
    id: row.id,
    kind,
    words,
    canReply: /^[A-Za-z0-9_-]{16,64}$/.test(code),
    link,
    video: isVideo(link),
    lost: /couldn’t be uploaded|couldn't be uploaded/i.test(said),
    facts,                       // screen · phone · app · when · signed in as
    from: String(row.name || '').trim(),
    contact: String(row.contact || '').trim(),
    at: row.created_at,
  };
}

/**
 * Implemented: the office's words go to the phone that sent the report — a card there says the bug is
 * fixed or the idea is in the app — and the report is closed out (supabase/app-report-replies.sql).
 * `kind` 'fixed' | 'added'; `said` is what the tester wrote, shown back to them.
 */
export async function replyToReport(id, { message, kind = 'fixed', said = '' }) {
  const { data, error } = await supabase.rpc('app_report_reply', {
    p_request: id, p_message: String(message || '').trim(), p_kind: kind === 'added' ? 'added' : 'fixed', p_said: String(said || '').slice(0, 300),
  });
  if (error) {
    if (/PGRST202|could not find the function|does not exist/i.test(`${error.code || ''} ${error.message || ''}`)) {
      throw new Error('Implemented needs one step in Supabase first: run supabase/app-report-replies.sql in the SQL Editor.');
    }
    throw new Error(error.message || 'It wouldn’t send. Try again in a moment.');
  }
  return data;
}

/** Done with it: it won't come back. */
export async function closeReport(id, staffId) {
  const { error } = await supabase
    .from('member_access_requests')
    .update({ handled_at: new Date().toISOString(), handled_by: staffId || null })
    .eq('id', id);
  if (error) throw error;
}

/** "3 minutes ago" — the office shouldn't have to read a timestamp. */
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

/**
 * Only this person is shown them — it's their test. Matched loosely on purpose: the staff row might
 * say "Brody", "Brody E." or the full name, and an exact match would just hide the panel with no
 * way of telling why.
 */
export const isTheTester = (profile) => /\bbrody\b/i.test(String(profile?.name || ''));
