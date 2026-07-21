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

/* ── Stats ── */
export function computeGuestStats(guests) {
  const thisWeek = guests.filter(g => !isProspect(g) && inThisWeek(g.last_visit)).length;
  const prospects = guests.filter(isProspect).length;
  const recap = guests.filter(g =>
    ['Salvation', 'Baptism', 'New Member'].includes(g.type) && inThisWeek(g.created_at)).length;
  return { thisWeek, prospects, recap };
}

export function weekLabel() {
  const { start, end } = weekRange();
  const f = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}
