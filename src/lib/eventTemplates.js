import { supabase } from './supabase';

/*
 * Templates for the calendar's drag-and-drop palette.
 *
 * They live in the event_templates table so one staffer's template shows up on
 * everyone's palette. Until that table exists (supabase/event-templates-schema.sql)
 * the palette falls back to these same defaults, read-only.
 */

/** start_time/minutes null = all-day. */
export const DEFAULT_TEMPLATES = [
  { title: 'Overflow Students',       category: 'Youth & Young Adults', start_time: '18:30', minutes: 90 },
  { title: 'Silver Liners Dinner',    category: 'Dinners',              start_time: '12:00', minutes: 120 },
  { title: 'Young Adults',            category: 'Youth & Young Adults', start_time: '19:00', minutes: 90 },
  { title: 'Dinner and Small Groups', category: 'Small Groups',         start_time: '17:30', minutes: 120 },
  { title: 'Choir Rehearsal',         category: 'Worship',              start_time: '19:00', minutes: 90 },
  { title: 'Pickleball',              category: 'Other',                start_time: '18:00', minutes: 120 },
  { title: 'Baptism',                 category: 'Baptism',              start_time: '11:00', minutes: 60 },
  { title: 'Helping Hands',           category: 'Outreach',             start_time: '09:00', minutes: 180 },
  { title: 'Office Closed',           category: 'Other',                start_time: null,    minutes: null },
  { title: 'BKids',                   category: 'Other',                start_time: '18:30', minutes: 90 },
].map((t, i) => ({ ...t, id: `default-${i}`, location: '', sort: (i + 1) * 10 }));

const pad = n => String(n).padStart(2, '0');

/** "19:00" + 90 → "20:30". Clamps at 23:59 rather than rolling into the next day. */
export function addMinutes(time, minutes) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return '23:59';
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Palette label: "6:30 PM – 8:00 PM", or "All day" when the template has no time. */
export function templateSpan(tpl, fmtTime) {
  if (!tpl.start_time) return 'All day';
  return `${fmtTime(tpl.start_time)} – ${fmtTime(addMinutes(tpl.start_time, tpl.minutes || 60))}`;
}

/*
 * Build a saveable event from a template.
 * `hour` comes from the Day view's hour rows — dropping on 3pm should mean 3pm,
 * not the template's usual time. An all-day template stays all-day unless
 * dropped on a specific hour.
 */
export function templateToEvent(tpl, dateISO, calendar, hour = null) {
  const start = hour != null ? `${pad(hour)}:00` : (tpl.start_time || null);
  return {
    calendar,
    title: tpl.title,
    category: tpl.category || 'Other',
    description: '',
    start_date: dateISO,
    end_date: null,
    start_time: start,
    end_time: start ? addMinutes(start, tpl.minutes || 60) : null,
    location: tpl.location || '',
    is_private: false,
    is_recurring: false,
  };
}

/* ── Storage ── */

/** Returns { templates, readOnly } — readOnly when the table isn't set up yet. */
export async function fetchTemplates() {
  const { data, error } = await supabase
    .from('event_templates').select('*').order('sort', { ascending: true });
  if (error) return { templates: DEFAULT_TEMPLATES, readOnly: true };
  // Table exists but is empty (seed skipped) → still show something usable.
  if (!data?.length) return { templates: DEFAULT_TEMPLATES, readOnly: false };
  return { templates: data, readOnly: false };
}

export async function createTemplate(tpl) {
  return supabase.from('event_templates').insert(tpl).select().single();
}

export async function updateTemplate(id, patch) {
  return supabase.from('event_templates').update(patch).eq('id', id).select().single();
}

export async function deleteTemplate(id) {
  return supabase.from('event_templates').delete().eq('id', id);
}

export const isDefaultTemplate = t => String(t.id || '').startsWith('default-');
