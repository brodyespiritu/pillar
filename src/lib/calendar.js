import { supabase } from './supabase';

/* ── Categories (9) ── */
export const CATEGORIES = [
  { key: 'Meetings',              color: '#8B5CF6' },
  { key: 'Youth & Young Adults',  color: '#F59E0B' },
  { key: 'Dinners',              color: '#10B981' },
  { key: 'Big Events',           color: '#F43F5E' },
  { key: 'Baptism',              color: '#0EA5E9' },
  { key: 'Worship',              color: '#F97316' },
  { key: 'Small Groups',         color: '#6366F1' },
  { key: 'Outreach',             color: '#14B8A6' },
  { key: 'Other',                color: '#6B7280' },
];
export const CAT_COLOR = Object.fromEntries(CATEGORIES.map(c => [c.key, c.color]));
export const catColor = k => CAT_COLOR[k] || '#6B7280';

export const RECURRENCE = ['Weekly', 'Every 2 Weeks', 'Monthly'];

/* ── Date helpers (all work on local date, ISO yyyy-mm-dd strings) ── */
export const iso = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
export const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth   = d => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const startOfWeek  = d => addDays(d, -d.getDay());
export const sameDay = (a, b) => iso(a) === iso(b);
export const isToday = d => sameDay(d, new Date());

export const monthLabel = d => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export const dayLabel   = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

/* Build a 6-week (42-day) month grid starting Sunday */
export function monthGrid(d) {
  const first = startOfWeek(startOfMonth(d));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/* Does an event cover a given day? */
export function eventCoversDay(ev, day) {
  const s = parseISO(ev.start_date);
  const e = ev.end_date ? parseISO(ev.end_date) : s;
  const dISO = iso(day);
  return iso(s) <= dISO && dISO <= iso(e);
}

/* ── Reads ── */

/*
 * Same query as fetchEvents, but it says why the list came back empty. An
 * empty calendar and a calendar that failed to load look identical to the
 * caller otherwise, and screens end up asserting the wrong reason.
 */
export async function fetchEventsResult(calendar) {
  let q = supabase.from('events').select('*');
  if (calendar) q = q.eq('calendar', calendar);
  const { data, error } = await q.order('start_date', { ascending: true });
  if (error) { console.error(error); return { rows: [], error: error.message || 'Could not load the calendar.' }; }
  return { rows: data || [], error: null };
}

export async function fetchEvents(calendar) {
  return (await fetchEventsResult(calendar)).rows;
}

/* ── Save (expands recurring into a series) ── */
export async function saveEvent(ev) {
  const base = { ...ev };
  ['end_date', 'recurrence_end', 'start_time', 'end_time'].forEach(k => { if (base[k] === '') base[k] = null; });
  if (base.created_by === '' || base.created_by === undefined) base.created_by = null;

  // Editing existing single row
  if (base.id) {
    const { data, error } = await supabase.from('events').update(base).eq('id', base.id).select().single();
    return { data, error };
  }
  delete base.id;

  // Non-recurring → single insert
  if (!base.is_recurring || !base.recurrence || !base.recurrence_end) {
    const { data, error } = await supabase.from('events').insert(base).select().single();
    return { data, error };
  }

  // Recurring → generate occurrences (cap 100)
  const seriesId = crypto.randomUUID();
  const rows = [];
  const step = base.recurrence === 'Weekly' ? { unit: 'd', n: 7 }
    : base.recurrence === 'Every 2 Weeks' ? { unit: 'd', n: 14 }
    : { unit: 'm', n: 1 };
  let cur = parseISO(base.start_date);
  const until = parseISO(base.recurrence_end);
  const spanDays = base.end_date ? (parseISO(base.end_date) - parseISO(base.start_date)) / 864e5 : 0;
  let guard = 0;
  while (cur <= until && guard < 100) {
    rows.push({
      ...base,
      series_id: seriesId,
      start_date: iso(cur),
      end_date: base.end_date ? iso(addDays(cur, spanDays)) : null,
    });
    cur = step.unit === 'd' ? addDays(cur, step.n) : addMonths(cur, step.n);
    guard++;
  }
  const { data, error } = await supabase.from('events').insert(rows).select();
  return { data, error };
}

/* ── Delete (3-tier) ── */
export async function deleteEvent(ev, mode = 'single') {
  if (mode === 'single' || !ev.series_id) {
    return supabase.from('events').delete().eq('id', ev.id);
  }
  if (mode === 'future') {
    return supabase.from('events').delete().eq('series_id', ev.series_id).gte('start_date', ev.start_date);
  }
  return supabase.from('events').delete().eq('series_id', ev.series_id); // entire series
}

/* ── Upcoming (next events from today) ── */
export function upcomingEvents(events, limit = 8) {
  const todayISO = iso(new Date());
  return events
    .filter(e => (e.end_date || e.start_date) >= todayISO)
    .sort((a, b) => (a.start_date + (a.start_time || '')).localeCompare(b.start_date + (b.start_time || '')))
    .slice(0, limit);
}

/* ── ICS export for one event ── */
export function downloadICS(ev) {
  const dt = (d, t) => {
    const base = d.replace(/-/g, '');
    return t ? `${base}T${t.replace(':', '')}00` : base;
  };
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pillar//Calendar//EN', 'BEGIN:VEVENT',
    `UID:${ev.id}@pillar`,
    `DTSTART:${dt(ev.start_date, ev.start_time)}`,
    `DTEND:${dt(ev.end_date || ev.start_date, ev.end_time || ev.start_time)}`,
    `SUMMARY:${ev.title}`,
    ev.location ? `LOCATION:${ev.location}` : '',
    ev.description ? `DESCRIPTION:${ev.description}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${ev.title.replace(/\s+/g, '-')}.ics`;
  a.click();
}
