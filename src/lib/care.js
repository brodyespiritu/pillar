import { supabase } from './supabase';

export const CATEGORIES = [
  'Hospitalized', 'Grieving', 'New Member', 'Homebound', 'Crisis',
  'Pain', 'Sick', 'Cancer', 'Prayer Request', 'Follow Up', 'Surgery',
  'Test/Treatment', 'Recovering', 'Other',
];

export const PRIORITIES = ['High', 'Medium', 'Low'];
export const STATUSES   = ['Active', 'Inactive', 'Resolved'];
export const LOG_TYPES  = ['Phone Call', 'Text Message', 'Dinner/Meal', 'Update/Visit'];

// Categories that reveal medical fields
export const MEDICAL_CATEGORIES = ['Hospitalized', 'Surgery'];

export const CATEGORY_COLORS = {
  Hospitalized:     '#E5484D',
  Grieving:         '#8B5CF6',
  'New Member':     '#10B981',
  Homebound:        '#F59E0B',
  Crisis:           '#DC2626',
  Pain:             '#EC4899',
  Sick:             '#F97316',
  Cancer:           '#A78BFA',
  'Prayer Request': '#3B82F6',
  'Follow Up':      '#06B6D4',
  Surgery:          '#E5484D',
  'Test/Treatment': '#8B5CF6',
  Recovering:       '#10B981',
  Other:            '#6B7280',
};

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };


/* Care texts to staff are sent only by the cares-recap edge function, on the
   care channel, to the admin-managed Cares list. The browser used to carry its
   own sender here — unused, and it would have logged care details where every
   staff member can read them and skipped the server's care-audience check. */

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

/*
 * The reason someone joined the list is the first sentence of the care note
 * ("Broken wrist"); anything after it is extra detail we append. With no note
 * at all, the category is the closest thing to a reason.
 */
export function splitReason(careNotes, category) {
  const note = clean(careNotes);
  if (!note) return { reason: clean(category) || 'Care need', extra: '' };
  const m = note.match(/^(.+?[.!?])\s+(.*)$/);
  return m ? { reason: m[1].replace(/[.!?]$/, ''), extra: m[2] } : { reason: note, extra: '' };
}

/* ── Profile photos ──
   Care records store only a name, so the photo comes from matching the church
   directory. Two people with the same name resolve to no photo rather than to
   the wrong face. */

export const normalizeName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function fetchCarePhotos() {
  const { data, error } = await supabase.from('church_members').select('name, photo_url');
  if (error) return new Map();
  const byName = new Map();
  for (const m of data || []) {
    const key = normalizeName(m.name);
    if (!key) continue;
    if (byName.has(key)) byName.set(key, null);        // ambiguous → don't guess
    else byName.set(key, m.photo_url || null);
  }
  return byName;
}

export const carePhotoFor = (photos, name) => photos?.get(normalizeName(name)) || '';

/* Appointment & surgery watcher — shared verbatim with the nightly
   cares-recap edge function so the text and the screen never disagree. */
export {
  SURGERY_RE, APPT_RE, extractSurgeryType, parseTimeFrom, parseDateFrom,
  relativeDayLabel, extractCareEvents, upcomingCareEvents, extractApptType,
} from '../../supabase/functions/_shared/careEvents';

/* ── Reads ─────────────────────────────────────────── */
// High priority always to top, then most-recent
const byPriorityThenRecent = rows => [...rows].sort((a, b) => {
  const p = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
  if (p !== 0) return p;
  return new Date(b.created_at) - new Date(a.created_at);
});

export async function fetchMembers() {
  const { data, error } = await supabase
    .from('care_members')
    .select('*, contact_logs(id, type, notes, logged_by_name, created_at)')
    .order('created_at', { ascending: false });
  if (!error) return byPriorityThenRecent(data || []);

  /*
   * The embedded select is a single point of failure: a stale PostgREST schema
   * cache or a relationship hiccup used to blank the entire care list. Fall
   * back to two plain queries and stitch them, so both the members AND their
   * contact logs still show for everyone.
   */
  console.warn('[care] embedded contact_logs failed, falling back:', error.message);
  const [mem, logs] = await Promise.all([
    supabase.from('care_members').select('*').order('created_at', { ascending: false }),
    supabase.from('contact_logs').select('id, member_id, type, notes, logged_by_name, created_at'),
  ]);
  if (mem.error) { console.error(mem.error); return []; }
  if (logs.error) console.warn('[care] contact_logs unreadable:', logs.error.message);

  const byMember = new Map();
  for (const l of logs.data || []) {
    if (!byMember.has(l.member_id)) byMember.set(l.member_id, []);
    byMember.get(l.member_id).push(l);
  }
  return byPriorityThenRecent((mem.data || []).map(m => ({ ...m, contact_logs: byMember.get(m.id) || [] })));
}

/* ── Member CRUD ───────────────────────────────────── */

/*
 * What actually changed, in words.
 *
 * The digest used to be able to say only "Also edited: Pansy Loudermilk",
 * because nothing anywhere recorded what an edit consisted of — the row was
 * overwritten and the old values were gone. A name with no change attached is
 * worse than silence: it tells a reader something happened and then makes them
 * open the record to find out what, which is the work the digest exists to save.
 *
 * Only fields a person would talk about are compared. Nobody needs to be told
 * that updated_at moved.
 */
const WATCHED = [
  ['category',      'Care type'],
  ['status',        'Status'],
  ['priority',      'Priority'],
  ['care_notes',    'Note'],
  ['hospital_name', 'Hospital'],
  ['room_number',   'Room'],
  ['floor',         'Floor'],
  ['surgery_type',  'Surgery'],
  ['surgery_date',  'Surgery date'],
  ['admission_date','Admitted'],
  ['assigned_name', 'Assigned to'],
  ['phone',         'Phone'],
  ['address',       'Address'],
];

const shown = v => {
  const s = String(v ?? '').trim();
  return s || '(blank)';
};

export function describeChanges(before = {}, after = {}) {
  const out = [];
  for (const [key, label] of WATCHED) {
    if (!(key in after)) continue;                 // not part of this save
    const a = String(before?.[key] ?? '').trim();
    const b = String(after?.[key] ?? '').trim();
    if (a === b) continue;
    /* A note is quoted rather than shown as "x -> y": the new wording is the
       information, and the old wording is just noise once it is replaced. */
    out.push(key === 'care_notes'
      ? `Note: ${shown(b)}`
      : `${label}: ${shown(a)} \u2192 ${shown(b)}`);
  }
  return out;
}

export async function saveMember(member, before = null) {
  const payload = { ...member };
  delete payload.contact_logs;
  // strip empty date strings → null
  ['admission_date', 'surgery_date'].forEach(k => {
    if (payload[k] === '') payload[k] = null;
  });
  // empty uuid / foreign keys → null (avoids "invalid input syntax for type uuid")
  ['assigned_to'].forEach(k => {
    if (payload[k] === '' || payload[k] === undefined) payload[k] = null;
  });
  if (member.id) {
    const { data, error } = await supabase
      .from('care_members').update(payload).eq('id', member.id).select().single();
    /* Recorded after the write, and never allowed to fail the save — an edit
       that went through must not report an error because its note did not. */
    if (!error && before) {
      const details = describeChanges(before, payload);
      if (details.length) {
        await supabase.from('change_log').insert({
          member_name: data?.full_name || member.full_name || '',
          action: 'Updated',
          details: details.join('; '),
        }).then(r => r.error && console.warn('[care] change_log:', r.error.message));
      }
    }
    return { data, error };
  }
  delete payload.id;
  const { data, error } = await supabase
    .from('care_members').insert(payload).select().single();
  return { data, error };
}

export async function deleteMember(id) {
  return supabase.from('care_members').delete().eq('id', id);
}

/* ── Contact logs ──────────────────────────────────── */
/*
 * Somebody moving out of the hospital, read out of a follow-up note.
 *
 * A category is set the day a person is added and then almost never revisited,
 * because the person writing the update is describing what changed, not
 * re-filing the record. So somebody admitted in March, moved to rehab in April
 * and home in May still carries a "Hospitalized" tag in June — the tag stops
 * describing them and starts misleading whoever reads the list.
 *
 * Only the move out of hospital is read, and only when the note says it
 * happened. What it deliberately does not do is guess in the other direction:
 * a note about someone going back in is left alone, because upgrading a
 * person's severity automatically is a decision a human should make.
 */

/* The move itself: transferred/moved/discharged/went, to somewhere that is
   rehab or nursing care. Bounded to one clause so it cannot span sentences. */
const MOVED_TO_REHAB = new RegExp(
  '\\b(?:mov(?:ed|ing)|transferr?ed|discharg(?:ed|ing)|releas(?:ed|ing)|went|sent|admitted|placed|now)\\b'
  + '[^.!?;]{0,44}'
  + '\\b(?:rehab\\w*|skilled nursing|nursing (?:home|facility|center)|\\bsnf\\b|'
  + 'physical therapy|recovery (?:center|unit|facility)|long[- ]?term care|step[- ]?down)\\b',
  'i',
);

/* Or simply sent home, which is the same movement. */
const DISCHARGED_HOME = /\b(?:discharged|released|went|came|home)\b[^.!?;]{0,24}\b(?:home|to (?:her|his|their) (?:house|home)|from the hospital)\b/i;

/* Said about a future move, not a completed one. Scoped to the clause so
   "moved to rehab and will start therapy Monday" still counts as a move. */
const FUTURE = /\b(?:will|going to|hop(?:es?|ing) to|plans? to|may|might|should|expects? to|scheduled to|if|when)\b[^.!?;]{0,30}\b(?:mov\w*|transferr?\w*|discharg\w*|releas\w*|go|going|come|coming)\b/i;

/* Back in, or never left — either way the hospital tag still fits. */
const STILL_HOSPITAL = /\b(?:back (?:in|at|to) the hospital|re-?admitted|still (?:in|at) the hospital|returned to the hospital|not (?:been )?discharged)\b/i;

/*
 * The category a note argues for, or null to leave the record alone.
 * Exported so the decision can be exercised directly rather than only through
 * a database write.
 */
export function categoryAfterNote(category, notes) {
  const s = String(notes || '');
  if (!s.trim()) return null;
  if (category !== 'Hospitalized') return null;
  if (STILL_HOSPITAL.test(s)) return null;
  if (!MOVED_TO_REHAB.test(s) && !DISCHARGED_HOME.test(s)) return null;
  if (FUTURE.test(s)) return null;
  return 'Recovering';
}

/*
 * Saving a log can also retire a tag the log itself contradicts. `member` is
 * optional — without it the log is written and nothing is re-filed, which is
 * what any older caller gets.
 */
export async function addLog(log, member = null) {
  const res = await supabase.from('contact_logs').insert(log).select().single();
  if (res.error || !member) return res;

  const next = categoryAfterNote(member.category, log.notes);
  if (next && next !== member.category) {
    const { error } = await supabase.from('care_members')
      .update({ category: next }).eq('id', member.id);
    if (!error) return { ...res, categoryChanged: { from: member.category, to: next } };
  }
  return res;
}

export async function deleteLog(id) {
  return supabase.from('contact_logs').delete().eq('id', id);
}

/* ── Derived stats for QuickBoxes + AI summary ─────── */
/*
 * What counts as urgent, in one place. The phone grid groups by these and the
 * desktop filter cards count by them, so a person cannot read as urgent on one
 * layout and calm on the other.
 *
 * Recovering is excluded deliberately: somebody flagged High while they were in
 * hospital should stop shouting once they are on the mend.
 */
export const needsAttention = m => m.priority === 'High' && m.category !== 'Recovering';
export const notVisited     = m => !(m.contact_logs?.length);

export function computeStats(members) {
  const active      = members.filter(m => m.status === 'Active');
  const needsAttn   = members.filter(needsAttention);
  const notVisited_ = members.filter(notVisited);
  const hospitalized = members.filter(m => m.category === 'Hospitalized');
  const surgeries   = members.filter(m => m.category === 'Surgery');
  const prayer      = members.filter(m => m.category === 'Prayer Request');
  return {
    active: active.length,
    needsAttention: needsAttn.length,
    notVisited: notVisited_.length,
    hospitalized: hospitalized.length,
    surgeries: surgeries.length,
    prayer: prayer.length,
    total: members.length,
  };
}

export function buildSummary(members) {
  const s = computeStats(members);
  if (s.active === 0) {
    return 'No active care cases at the moment. Your congregation is well supported!';
  }
  const parts = [`You have ${s.active} active care case${s.active === 1 ? '' : 's'}`];
  const clauses = [];
  if (s.hospitalized) clauses.push(`${s.hospitalized} hospitalization${s.hospitalized === 1 ? '' : 's'}`);
  if (s.surgeries)    clauses.push(`${s.surgeries} upcoming surger${s.surgeries === 1 ? 'y' : 'ies'}`);
  if (clauses.length) parts[0] += `, including ${clauses.join(' and ')}`;
  parts[0] += '.';

  if (s.prayer) parts.push(`${s.prayer} prayer request${s.prayer === 1 ? '' : 's'} need attention.`);

  const stale = members.filter(m => {
    if (!m.contact_logs?.length) return false;
    const last = Math.max(...m.contact_logs.map(l => new Date(l.created_at)));
    return (Date.now() - last) > 7 * 864e5;
  });
  const never = members.filter(m => !(m.contact_logs?.length) && m.status === 'Active');
  const uncontacted = stale.length + never.length;
  if (uncontacted) parts.push(`${uncontacted} ${uncontacted === 1 ? 'person hasn\'t' : "people haven't"} been contacted in over a week.`);

  const recent = [...members]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3).map(m => m.full_name);
  if (recent.length) parts.push(`Recently added: ${recent.join(', ')}.`);

  return parts.join(' ');
}

export function lastContacted(member) {
  if (!member.contact_logs?.length) return null;
  return member.contact_logs
    .map(l => l.created_at)
    .sort((a, b) => new Date(b) - new Date(a))[0];
}
