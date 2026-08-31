import { supabase } from './supabase';

/*
 * Promotion playbooks — the dated run-up to an event or an ongoing ministry.
 * Requires supabase/playbooks-schema.sql.
 */

/* What a piece of promotion can be. Order is the order they appear. */
export const CHANNELS = [
  { key: 'Stage',    label: 'Stage',    color: '#8B5CF6', hint: 'Spoken from the platform' },
  { key: 'Slide',    label: 'Slide',    color: '#3B82F6', hint: 'Pre-service loop' },
  { key: 'Social',   label: 'Social',   color: '#EC4899', hint: 'Facebook / Instagram' },
  { key: 'Website',  label: 'Website',  color: '#06B6D4', hint: 'Site or app post' },
  { key: 'Bulletin', label: 'Bulletin', color: '#F59E0B', hint: 'Printed insert' },
  { key: 'Text',     label: 'Text',     color: '#10B981', hint: 'SMS to the congregation' },
  { key: 'Email',    label: 'Email',    color: '#6366F1', hint: 'Email blast' },
];
export const CHANNEL_COLOR = Object.fromEntries(CHANNELS.map(c => [c.key, c.color]));

export const STATUSES = ['Draft', 'Scheduled', 'Active', 'Complete'];
export const AUDIENCES = ['Churchwide', 'Core Next Step', 'Ministry', 'Guests'];

export const iso = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* Days until the event — negative once it has passed. */
export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseISO(dateStr) - a) / 864e5);
}

/* A ministry arc is a reference layout, not a countdown — it has no date. */
export const isTemplate = pb => pb?.kind === 'ministry' || !pb?.event_date;

/*
 * The arc runs back from the event: `arc_weeks` Sundays before it, through to
 * the event's own week. Anchoring on Sunday is what makes the grid line up
 * with how the week is actually planned.
 *
 * A template arc has the same shape with no dates attached — Week 1 through
 * Event Week, which is what makes it reusable for any event that ministry runs.
 */
export function arcWeeks(pb) {
  if (isTemplate(pb)) {
    const n = Math.max(1, pb?.arc_weeks || 4);
    return Array.from({ length: n }, (_, i) => ({
      index: i, start: null, label: i === n - 1 ? 'Event Week' : `Week ${i + 1}`,
    }));
  }
  if (!pb?.event_date) return [];
  const event = parseISO(pb.event_date);
  const eventSunday = addDays(event, -event.getDay());
  const weeks = [];
  const n = Math.max(1, pb.arc_weeks || 4);
  for (let i = n - 1; i >= 0; i--) {
    const start = addDays(eventSunday, -i * 7);
    weeks.push({ index: n - 1 - i, start, label: i === 0 ? 'Event Week' : `Week ${n - i}` });
  }
  return weeks;
}

/* Where an item sits in the grid, whichever kind of arc it belongs to. */
export function slotOf(pb, item) {
  if (isTemplate(pb)) return { week: item.week_index ?? 0, dow: item.dow ?? 0 };
  if (!item.due_date) return null;
  const weeks = arcWeeks(pb);
  const d = parseISO(item.due_date);
  for (let i = 0; i < weeks.length; i++) {
    const diff = Math.round((d - weeks[i].start) / 864e5);
    if (diff >= 0 && diff < 7) return { week: i, dow: diff };
  }
  return null;
}

export const promoLaunch = pb => (arcWeeks(pb)[0]?.start ?? null);

/* Progress through the arc, 0–1, for the bar on each card. */
export function arcProgress(pb, now = new Date()) {
  if (isTemplate(pb)) return 0;
  const weeks = arcWeeks(pb);
  if (!weeks.length || !pb.event_date) return 0;
  const start = weeks[0].start.getTime();
  const end = parseISO(pb.event_date).getTime();
  if (now.getTime() <= start) return 0;
  if (now.getTime() >= end) return 1;
  return (now.getTime() - start) / (end - start);
}

/* Draft / Scheduled / Active / Complete, read from the dates unless someone
   has set it by hand. */
export function liveStatus(pb, now = new Date()) {
  if (isTemplate(pb)) return 'Reference';
  if (pb.status === 'Draft') return 'Draft';
  const d = daysUntil(pb.event_date, now);
  if (d === null) return pb.status || 'Draft';
  if (d < 0) return 'Complete';
  const weeks = arcWeeks(pb);
  if (weeks.length && now < weeks[0].start) return 'Scheduled';
  return 'Active';
}

/*
 * Which calendar events can still take an arc — and, when none can, why not.
 *
 * "Every upcoming event already has an arc" used to be the only thing an empty
 * picker could say, so an empty calendar and a calendar that failed to load
 * both got reported as a calendar that was fully covered. The reasons call for
 * different fixes, so each one gets its own answer.
 *
 * Upcoming events by default; a search runs across the whole calendar, and when
 * nothing is upcoming the recent past is offered instead of a dead end.
 */
export function eventPicker({ events = [], error = null, arcs = [], query = '', now = new Date(), limit = 40 } = {}) {
  const taken = new Set(arcs.map(p => p.event_id).filter(Boolean));
  const today = iso(now);
  const free = events.filter(e => !taken.has(e.id));
  // Ordered here rather than trusting the caller: soonest first, and the past
  // read backwards so the most recent service is the first thing offered.
  const by = dir => (a, b) => dir * String(a.start_date).localeCompare(String(b.start_date));
  const upcoming = free.filter(e => e.start_date >= today).sort(by(1));
  const past = free.filter(e => e.start_date < today).sort(by(-1));

  const q = query.trim().toLowerCase();
  const base = q ? free : (upcoming.length ? upcoming : past);
  const rows = (q ? base.filter(e => (e.title || '').toLowerCase().includes(q)) : base).slice(0, limit);

  let empty = null;
  if (rows.length === 0) {
    if (error) empty = `Could not load the calendar — ${error}`;
    else if (events.length === 0) empty = 'No events on the church calendar yet. Add one on the Calendar page first.';
    else if (q) empty = `No events match "${query.trim()}".`;
    else empty = 'Every event on the calendar already has an arc.';
  }
  return { rows, usingPast: !q && upcoming.length === 0 && past.length > 0, empty };
}

export async function fetchPlaybooks() {
  const { data, error } = await supabase
    .from('playbooks')
    .select('*, playbook_items(id, due_date, week_index, dow, channel, title, notes, done)')
    .order('event_date', { ascending: true });
  if (error) {
    return { rows: [], missing: /relation|does not exist/i.test(error.message || '') };
  }
  return { rows: data || [], missing: false };
}

export async function fetchPlaybook(id) {
  const { data, error } = await supabase
    .from('playbooks')
    .select('*, playbook_items(id, due_date, week_index, dow, channel, title, notes, done)')
    .eq('id', id).single();
  return { data, error };
}

export function createPlaybook(pb) {
  return supabase.from('playbooks').insert(pb).select().single();
}
export function updatePlaybook(id, patch) {
  return supabase.from('playbooks').update(patch).eq('id', id).select().single();
}
export function deletePlaybook(id) {
  return supabase.from('playbooks').delete().eq('id', id);
}

export function addItem(item) {
  return supabase.from('playbook_items').insert(item).select().single();
}
export function updateItem(id, patch) {
  return supabase.from('playbook_items').update(patch).eq('id', id);
}
export function deleteItem(id) {
  return supabase.from('playbook_items').delete().eq('id', id);
}
