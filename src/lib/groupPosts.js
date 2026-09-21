import { supabase } from './supabase';

// The groups and ministries the app shows, and the announcement cards written for them.
//
//   public.church_groups  → supabase/groups-schema.sql + groups-kind.sql
//   public.group_posts    → supabase/group-posts.sql
//
// Both are staff-write / anon-read-published, so this reads and writes them straight through the
// signed-in staff session. Everything here is the church's own words: the app never writes any of
// it, and a member only ever sees a row the office published.

export const POST_COLUMNS =
  'id,group_id,title,body,button_label,button_url,starts_on,ends_on,published,sort,updated_at';

// An empty box in a form is nothing, not an empty string — the columns are nullable and their
// checks are written against null.
const orNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export const GROUP_COLUMNS =
  'id,name,kind,about,meets,location,audience,leaders,filter_key,published,sort';

// The kinds the app turns into filter pills. They are free text in the database — these are just
// the ones already in use, offered so the office doesn't have to remember the spelling. A pill only
// appears once two DIFFERENT kinds exist: one kind on every group is "All" under another name.
export const KINDS = ['Ministry', 'Sunday School', 'Small Group', 'Class', 'Team'];

// The calendar's own ministry keys (BethesdaApp utils/eventFilters.js). `filter_key` ties a group to
// them, which is how the app counts what that group has coming up — and what names the Men / Women /
// Kids / Youth pills. Anything else here would match no events.
export const FILTER_KEYS = [
  { key: '', label: "Not tied to the calendar" },
  { key: 'kids', label: 'Kids' },
  { key: 'youth', label: 'Youth' },
  { key: 'college', label: 'College & Young Adults' },
  { key: 'women', label: 'Women' },
  { key: 'men', label: 'Men' },
];

/** Every group, published or not — the office picks from these when writing a card. */
export async function listGroups() {
  const { data, error } = await supabase
    .from('church_groups')
    .select(GROUP_COLUMNS)
    .order('sort', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** What the office got wrong about a group, in words it can act on. */
export function groupProblems(f) {
  const out = [];
  const name = String(f.name || '').trim();
  if (!name) out.push('Give the group a name.');
  if (name.length > 80) out.push('The name has to be 80 characters or fewer.');
  if (String(f.about || '').trim().length > 1000) out.push('The description has to be 1,000 characters or fewer.');
  if (String(f.meets || '').trim().length > 120) out.push('“When it meets” has to be 120 characters or fewer.');
  if (String(f.location || '').trim().length > 120) out.push('The place has to be 120 characters or fewer.');
  if (String(f.audience || '').trim().length > 80) out.push('“Who it is for” has to be 80 characters or fewer.');
  if (String(f.kind || '').trim().length > 40) out.push('The kind has to be 40 characters or fewer.');
  const fk = String(f.filter_key || '').trim();
  if (fk && !/^[a-z][a-z0-9_-]{0,30}$/.test(fk)) out.push('The calendar key must be lower-case letters, digits, - or _.');
  (f.leaders || []).forEach((p, i) => {
    if (!String(p?.name || '').trim() && String(p?.role || '').trim()) out.push(`Leader ${i + 1} needs a name.`);
  });
  return out;
}

export function groupPatch(f) {
  return {
    name: String(f.name || '').trim(),
    kind: orNull(f.kind),
    about: orNull(f.about),
    meets: orNull(f.meets),
    location: orNull(f.location),
    audience: orNull(f.audience),
    filter_key: orNull(f.filter_key),
    // a leader is a real person with a name; a blank row is not a leader
    leaders: (f.leaders || [])
      .map((p) => ({ name: String(p?.name || '').trim(), role: String(p?.role || '').trim() }))
      .filter((p) => p.name),
    published: f.published !== false,
    sort: Number.isFinite(Number(f.sort)) ? Number(f.sort) : 0,
  };
}

export async function saveGroup(f) {
  const patch = groupPatch(f);
  const q = f.id
    ? supabase.from('church_groups').update(patch).eq('id', f.id)
    : supabase.from('church_groups').insert(patch);
  const { data, error } = await q.select(GROUP_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function setGroupPublished(id, published) {
  const { data, error } = await supabase
    .from('church_groups').update({ published }).eq('id', id).select(GROUP_COLUMNS).single();
  if (error) throw error;
  return data;
}

/** Just the order — a drag in the list. */
export async function setGroupSort(id, sort) {
  const { error } = await supabase.from('church_groups').update({ sort }).eq('id', id);
  if (error) throw error;
}

/** Deleting a group takes its cards with it (group_posts.group_id is ON DELETE CASCADE). */
export async function deleteGroup(id) {
  const { error } = await supabase.from('church_groups').delete().eq('id', id);
  if (error) throw error;
}

/** What the app will actually show as kind pills — two or more, or none at all. */
export function kindPills(groups) {
  const kinds = [];
  (groups || []).filter((g) => g.published !== false).forEach((g) => {
    const k = String(g.kind || '').trim();
    if (k && !kinds.includes(k)) kinds.push(k);
  });
  return kinds.length > 1 ? kinds.sort() : [];
}

/** Every announcement, newest first within the office's own order. Drafts included. */
export async function listPosts() {
  const { data, error } = await supabase
    .from('group_posts')
    .select(POST_COLUMNS)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * What actually goes in the table. Kept in one place so the form, the save and the database agree:
 * a button needs both a label and a web address, or it is not a button.
 */
export function postPatch(f) {
  const label = orNull(f.button_label);
  const url = orNull(f.button_url);
  const pair = label && url;
  return {
    group_id: f.group_id || null,
    title: String(f.title || '').trim(),
    body: orNull(f.body),
    button_label: pair ? label : null,
    button_url: pair ? url : null,
    starts_on: orNull(f.starts_on),
    ends_on: orNull(f.ends_on),
    published: f.published !== false,
    sort: Number.isFinite(Number(f.sort)) ? Number(f.sort) : 0,
  };
}

/** What the office got wrong, in words it can act on. Empty array means it is ready to save. */
export function postProblems(f) {
  const out = [];
  const title = String(f.title || '').trim();
  const label = orNull(f.button_label);
  const url = orNull(f.button_url);
  if (!title) out.push('Give the card a title.');
  if (title.length > 80) out.push('The title has to be 80 characters or fewer.');
  if (String(f.body || '').trim().length > 600) out.push('The message has to be 600 characters or fewer.');
  if (label && label.length > 30) out.push('The button label has to be 30 characters or fewer.');
  if (label && !url) out.push('The button needs a link, or clear the label.');
  if (url && !label) out.push('The button needs a label, or clear the link.');
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) out.push('The link has to start with http:// or https://');
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) out.push('The end date is before the start date.');
  return out;
}

export async function savePost(f) {
  const patch = postPatch(f);
  const q = f.id
    ? supabase.from('group_posts').update(patch).eq('id', f.id)
    : supabase.from('group_posts').insert(patch);
  const { data, error } = await q.select(POST_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function setPostPublished(id, published) {
  const { data, error } = await supabase
    .from('group_posts').update({ published }).eq('id', id).select(POST_COLUMNS).single();
  if (error) throw error;
  return data;
}

/** Just the order — a drag in the list. */
export async function setPostSort(id, sort) {
  const { error } = await supabase.from('group_posts').update({ sort }).eq('id', id);
  if (error) throw error;
}

export async function deletePost(id) {
  const { error } = await supabase.from('group_posts').delete().eq('id', id);
  if (error) throw error;
}

// the church's date, as the database's public.church_today() gives it
const churchDay = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at);

/** What a member sees today: published, and inside its window. Mirrors the read policy exactly. */
export function isLiveNow(p, today = new Date()) {
  if (!p.published) return false;
  const day = churchDay(today);
  if (p.starts_on && p.starts_on > day) return false;
  if (p.ends_on && p.ends_on < day) return false;
  return true;
}

/** Why it isn't showing — so nobody has to guess at a card that looks published but isn't. */
export function liveLabel(p, today = new Date()) {
  if (!p.published) return 'Draft';
  const day = churchDay(today);
  if (p.starts_on && p.starts_on > day) return `Starts ${p.starts_on}`;
  if (p.ends_on && p.ends_on < day) return `Ended ${p.ends_on}`;
  return 'Live';
}
