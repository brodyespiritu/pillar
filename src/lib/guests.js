import { supabase } from './supabase';

/* ── Entry types (7 categories) ── */
export const GUEST_TYPES = [
  { key: 'Returning Guest/Member', label: 'Returning Guest/Member', color: '#3B82F6', desc: 'Someone who already attends, showing up again' },
  { key: 'Prospect',               label: 'Prospect',               color: '#14B8A6', desc: 'Identified for outreach & follow-up' },
  { key: 'Salvation',              label: 'Salvation',              color: '#8B5CF6', desc: 'A new salvation decision' },
  { key: 'Baptism',                label: 'Baptism',                color: '#06B6D4', desc: 'Someone being baptized' },
  { key: 'New Member',             label: 'New Member',             color: '#10B981', desc: 'Officially joining the church' },
  { key: 'New Connection',         label: 'New Connection',         color: '#EC4899', desc: 'A quick connection made during service' },
  { key: 'Comment',                label: 'Comment',                color: '#F59E0B', desc: 'A greeter observation about someone' },
];

export const TYPE_COLORS = Object.fromEntries(GUEST_TYPES.map(t => [t.key, t.color]));
TYPE_COLORS['Potential Prospect'] = '#F59E0B';

export const STATUSES = ['Active', 'Followed Up', 'Converted', 'Inactive'];
export const STATUS_COLORS = {
  Active:        '#10B981',
  'Followed Up': '#3B82F6',
  Converted:     '#8B5CF6',
  Inactive:      '#6B7280',
};

export const RELATIONS = [
  'Son', 'Daughter', 'Brother', 'Sister', 'Twins', 'Mother', 'Father',
  'Grandson', 'Granddaughter', 'Nephew', 'Niece', 'Cousin', 'Family Member',
];

const PROSPECT_TYPES = ['Prospect', 'Potential Prospect'];
export const isProspect = g => PROSPECT_TYPES.includes(g.type) && !g.not_prospect;

/* ── Name formatting ── */
export function composeFullName(first, last, spouse, family = []) {
  let base = (first || '').trim();
  if (spouse?.trim()) base += ` + ${spouse.trim()}`;
  if (last?.trim())   base += `, ${last.trim()}`;
  const kids = (family || [])
    .filter(f => f.name?.trim())
    .map(f => `with ${(f.relation || 'family member').toLowerCase()} ${f.name.trim()}${f.age ? ` (${f.age})` : ''}`);
  return kids.length ? `${base}. ${kids.join(', ')}` : base;
}

/* ── Grade levels, narrowed to the school that was chosen ── */
const ALL_GRADES = ['Pre-K', 'K', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

export function gradeOptions(school = '') {
  const s = String(school).toLowerCase();
  // Order matters — "Junior High" contains "high", so check it first.
  if (/\b(university|college)\b/.test(s)) return ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];
  if (/\b(pre-?school|pre-?k|early learning|daycare|nursery)\b/.test(s)) return ['Pre-K', 'K'];
  if (/\b(elementary|primary)\b/.test(s)) return ['Pre-K', 'K', '1st', '2nd', '3rd', '4th', '5th'];
  if (/\b(middle|jr\.? high|junior high)\b/.test(s)) return ['6th', '7th', '8th'];
  if (/\b(intermediate)\b/.test(s)) return ['3rd', '4th', '5th', '6th'];
  if (/\bhigh\b/.test(s)) return ['9th', '10th', '11th', '12th'];
  return ALL_GRADES;   // unknown or K-12 school — offer everything
}

/* ── Address parts ↔ the single stored `address` string ──
   The form collects street / apt / city / state / ZIP separately; they're
   joined for storage so search, exports and the recap keep working unchanged. */
const STATE_ZIP = /^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/;

export function splitAddress(str) {
  const out = { street: '', line2: '', city: '', state: '', zip: '' };
  const parts = String(str || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return out;
  const rest = [...parts];
  const m = STATE_ZIP.exec(rest[rest.length - 1] || '');
  if (m && rest.length > 1) {
    out.state = m[1].toUpperCase();
    out.zip = m[2] || '';
    rest.pop();
    if (rest.length > 1) out.city = rest.pop();
  }
  out.street = rest.shift() || '';
  out.line2 = rest.join(', ');
  return out;
}

export function joinAddress({ street, line2, city, state, zip } = {}) {
  const clean = v => String(v || '').trim();
  const streetPart = [clean(street), clean(line2)].filter(Boolean).join(', ');
  const regionPart = [clean(state).toUpperCase(), clean(zip)].filter(Boolean).join(' ');
  const cityPart = [clean(city), regionPart].filter(Boolean).join(', ');
  return [streetPart, cityPart].filter(Boolean).join(', ');
}

/* ── Reads ── */
export async function fetchGuests() {
  const { data, error } = await supabase
    .from('guests').select('*').order('last_visit', { ascending: false, nullsFirst: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

/* ── CRUD ── */
export async function saveGuest(guest) {
  const payload = { ...guest };
  ['first_visit', 'last_visit'].forEach(k => { if (payload[k] === '') payload[k] = null; });
  if (payload.assigned_to === '' || payload.assigned_to === undefined) payload.assigned_to = null;
  if (guest.id) {
    const { data, error } = await supabase.from('guests').update(payload).eq('id', guest.id).select().single();
    return { data, error };
  }
  delete payload.id;
  const { data, error } = await supabase.from('guests').insert(payload).select().single();
  return { data, error };
}

export async function deleteGuests(ids) {
  return supabase.from('guests').delete().in('id', ids);
}

/* ── Week helpers (Sunday–Saturday) ── */
export function weekRange(d = new Date()) {
  const day = d.getDay();
  const start = new Date(d); start.setDate(d.getDate() - day); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
  return { start, end };
}
const inThisWeek = dateStr => {
  if (!dateStr) return false;
  const { start, end } = weekRange();
  const d = new Date(dateStr);
  return d >= start && d <= end;
};

/* ── Guest week: runs Sunday 7:00 AM → the following Sunday 7:00 AM ──
   The live guest list only shows the current week, so it "resets" on its own
   the moment 7:00 AM Sunday passes. Nothing is deleted — earlier weeks stay
   in the table and are readable as history. */
export const WEEK_RESET_HOUR = 7;

/** Start of the guest week containing `d` — the most recent Sunday 7:00 AM. */
export function guestWeekStart(d = new Date()) {
  const s = new Date(d);
  s.setDate(s.getDate() - s.getDay());      // back to Sunday
  s.setHours(WEEK_RESET_HOUR, 0, 0, 0);     // Sunday 7:00 AM
  if (s > d) {                              // still before this week's reset
    s.setDate(s.getDate() - 7);
    s.setHours(WEEK_RESET_HOUR, 0, 0, 0);   // re-set after the shift (DST-safe)
  }
  return s;
}

/** End of the week that began at `start` (exclusive — it's the next reset). */
export function guestWeekEnd(start) {
  const e = new Date(start);
  e.setDate(e.getDate() + 7);
  e.setHours(WEEK_RESET_HOUR, 0, 0, 0);
  return e;
}

/** Does this guest belong to the week beginning at `start`? */
export function inGuestWeek(g, start = guestWeekStart()) {
  if (!g?.created_at) return false;
  const t = new Date(g.created_at);
  return t >= start && t < guestWeekEnd(start);
}

export function guestWeekLabel(start = guestWeekStart()) {
  return `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Past guest weeks, newest first — one history entry per week covering both
    guests and prospects recorded in it. */
export function listGuestWeeks(guests) {
  const current = guestWeekStart().getTime();
  const weeks = new Map();
  for (const g of guests) {
    if (!g.created_at) continue;
    const t = guestWeekStart(new Date(g.created_at)).getTime();
    if (t >= current) continue;             // this week isn't history yet
    const w = weeks.get(t) || { guests: 0, prospects: 0 };
    if (isProspect(g)) w.prospects++; else w.guests++;
    weeks.set(t, w);
  }
  return [...weeks.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([t, w]) => ({
      start: new Date(t),
      guests: w.guests,
      prospects: w.prospects,
      count: w.guests + w.prospects,
      label: guestWeekLabel(new Date(t)),
    }));
}

/** Milliseconds until the next Sunday 7:00 AM reset. */
export function msUntilNextReset(d = new Date()) {
  return guestWeekEnd(guestWeekStart(d)) - d;
}

/** Filter window for a guest week — `end` is inclusive, for date comparisons. */
export function guestWeekRange(d = new Date()) {
  const start = guestWeekStart(d);
  return { start, end: new Date(guestWeekEnd(start).getTime() - 1) };
}

/** "Jul 26 – Aug 1, 2026" — the Sunday-through-Saturday span a week covers. */
export function guestWeekSpan(d = new Date()) {
  const start = guestWeekStart(d);
  const last = new Date(start);
  last.setDate(last.getDate() + 6);
  const f = (x, opts) => x.toLocaleDateString('en-US', opts);
  return `${f(start, { month: 'short', day: 'numeric' })} – ${f(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/* ── Stats ── */
/* Scoped to the guest week (Sunday 7:00 AM →) so the cards agree with the list. */
export function computeGuestStats(guests, weekStart = guestWeekStart()) {
  const inWk = g => inGuestWeek(g, weekStart);
  const thisWeek  = guests.filter(g => !isProspect(g) && inWk(g)).length;
  const prospects = guests.filter(g => isProspect(g) && inWk(g)).length;
  const recap = guests.filter(g =>
    ['Salvation', 'Baptism', 'New Member'].includes(g.type) && inWk(g)).length;
  return { thisWeek, prospects, recap };
}

export function weekLabel() {
  const { start, end } = weekRange();
  const f = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}
