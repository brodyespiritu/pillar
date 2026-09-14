import { supabase } from './supabase';
import { RSVP_SITE } from './broadcast';
/* The same field rules the public page and the rsvp-forms function use. */
import {
  PRESETS, FIELD_TYPES, LIMITS, cleanFields, randomToken, formatPhone,
} from '../../supabase/functions/_shared/rsvpForms.ts';

export { PRESETS, FIELD_TYPES, LIMITS, cleanFields, randomToken, formatPhone, RSVP_SITE };

/* The link that opens one form directly, past the chooser. */
export const formLink = slug => `${RSVP_SITE}/form/${slug}`;

const PAGE = 1000;
async function pageAll(make) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return { rows, error: null };
  }
}

/* ── Forms ── */

export async function fetchForms() {
  const { data, error } = await supabase.from('rsvp_forms').select('*').order('created_at', { ascending: false });
  if (error) return { rows: [], missing: /relation|does not exist/i.test(error.message || ''), error: error.message };
  return { rows: data || [], missing: false };
}

export async function createForm(owner, { title, description, fields, notify = [] }) {
  return supabase.from('rsvp_forms').insert({
    owner: owner || null,
    title: String(title || '').trim().slice(0, LIMITS.title),
    description: String(description || '').trim().slice(0, LIMITS.description) || null,
    fields: cleanFields(fields),
    notify,
    status: 'open',
    slug: randomToken(10),
  }).select().single();
}

export async function updateForm(id, patch) {
  const row = { ...patch, updated_at: new Date().toISOString() };
  if ('fields' in row) row.fields = cleanFields(row.fields);
  if ('title' in row) row.title = String(row.title || '').trim().slice(0, LIMITS.title);
  if ('description' in row) row.description = String(row.description || '').trim().slice(0, LIMITS.description) || null;
  return supabase.from('rsvp_forms').update(row).eq('id', id).select().single();
}

export async function deleteForm(id) {
  return supabase.from('rsvp_forms').delete().eq('id', id);
}

/* ── Responses ── */

/* How many responses each form has, without loading the answers. */
export async function fetchResponseCounts() {
  const { rows } = await pageAll((a, b) => supabase.from('rsvp_responses')
    .select('form_id, created_at').order('created_at', { ascending: false }).range(a, b));
  const counts = {};
  const latest = {};
  for (const r of rows) {
    counts[r.form_id] = (counts[r.form_id] || 0) + 1;
    if (!latest[r.form_id]) latest[r.form_id] = r.created_at;
  }
  return { counts, latest };
}

export async function fetchResponses(formId) {
  const { rows, error } = await pageAll((a, b) => supabase.from('rsvp_responses')
    .select('id, answers, name, phone, email, notified, created_at')
    .eq('form_id', formId).order('created_at', { ascending: false }).range(a, b));
  return { rows, error };
}

/* ── Who can be texted about responses ── */

/*
 * Staff with a mobile number, then everyone on the texting list who has not
 * opted out. The form stores who, never a number — the number is looked up
 * when a response arrives, so a changed phone is always the current one.
 */
export async function fetchNotifyPeople() {
  const [staff, contacts] = await Promise.all([
    supabase.from('staff').select('id, name, phone, active').order('name'),
    pageAll((a, b) => supabase.from('sms_contacts').select('id, name, phone, opted_out').order('name').order('id').range(a, b)),
  ]);
  const ten = p => String(p || '').replace(/\D/g, '').slice(-10);
  const people = [];
  for (const s of staff.data || []) {
    if (s.active === false || ten(s.phone).length !== 10) continue;
    people.push({ type: 'staff', id: s.id, name: s.name || formatPhone(s.phone), phone: formatPhone(s.phone) });
  }
  const staffPhones = new Set(people.map(p => ten(p.phone)));
  for (const c of contacts.rows || []) {
    if (c.opted_out || ten(c.phone).length !== 10 || staffPhones.has(ten(c.phone))) continue;
    people.push({ type: 'contact', id: c.id, name: c.name || formatPhone(c.phone), phone: formatPhone(c.phone) });
  }
  return people;
}

/* ── What bethesda.rsvp shows ── */

/* Asked of the same public function the site uses, so this is what visitors see. */
export async function fetchPublicListing() {
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rsvp-forms`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ── Export ── */

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function responsesCsv(form, rows) {
  const fields = cleanFields(form.fields);
  const head = ['Submitted', ...fields.map(f => f.label)];
  const lines = rows.map(r => [
    new Date(r.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    ...fields.map(f => r.answers?.[f.id] ?? ''),
  ]);
  return [head, ...lines].map(l => l.map(csvCell).join(',')).join('\n');
}
