import { supabase } from './supabase';

/*
 * Care Texts: teaching the AI that writes the texts to deacons and staff.
 *
 * The writer itself runs in the care texts' edge functions
 * (supabase/functions/_shared/careAi.ts). This is the office's side of it —
 * the rules, the mode, the corrections, and the record of what it wrote — read
 * and written straight from the app. Row-level security
 * (supabase/care-ai-writer.sql) decides who sees and changes what: Cares access
 * to read, Cares edit (or admin) to change. These two helpers only decide what
 * the page offers.
 */

export const canSeeCareTexts = profile => {
  if (!profile || profile.active === false) return false;
  if (String(profile.role || '').toLowerCase().includes('admin')) return true;
  return ['view', 'edit'].includes(String(profile.permissions?.cares || 'none'));
};

export const canTrainCareTexts = profile => {
  if (!profile || profile.active === false) return false;
  if (String(profile.role || '').toLowerCase().includes('admin')) return true;
  return String(profile.permissions?.cares || 'none') === 'edit';
};

export const MODES = [
  { key: 'off', label: 'Off', sub: 'Pillar\'s own wording, no AI.' },
  { key: 'practice', label: 'Practice', sub: 'The AI writes its version beside each text for you to review. Pillar\'s wording is still what goes out.' },
  { key: 'live', label: 'On', sub: 'The AI\'s version goes out when it passes every check. Otherwise Pillar\'s wording does.' },
];

export const KIND_LABEL = {
  deacon_alert: 'Deacon alert',
  deacon_summary: 'Deacon morning summary',
  staff_digest: 'Staff digest',
};

/* Missing tables read as "not set up", which the page says in words. */
const missing = error => error && /relation .* does not exist|could not find the table|schema cache/i.test(error.message || '');

export async function fetchCareAiSettings() {
  const { data, error } = await supabase.from('care_ai_settings').select('*').eq('id', 1).maybeSingle();
  if (missing(error)) return { setUp: false };
  if (error) return { error };
  return { setUp: true, settings: data };
}

export async function saveCareAiSettings(patch, byName = '') {
  const { data, error } = await supabase.from('care_ai_settings')
    .update({ ...patch, updated_by_name: byName || null }).eq('id', 1).select().maybeSingle();
  if (!error && !data) return { error: { message: 'You need Cares edit access to change this.' } };
  return { data, error };
}

export async function fetchCareAiDrafts({ limit = 60 } = {}) {
  const { data, error } = await supabase.from('care_ai_drafts')
    .select('id, created_at, kind, audience, label, mode, original, header, written, used, problems, cost_usd')
    .neq('mode', 'preview')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { rows: data || [], error };
}

export async function fetchCareAiExamples() {
  const { data, error } = await supabase.from('care_ai_examples')
    .select('id, created_at, audience, kind, original, wrote, should_read, why, created_by_name, draft_id')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(200);
  return { rows: data || [], error };
}

/* A correction ("should read") or an approval (the AI's own words, kept). */
export async function addCareAiExample({ draft, shouldRead, why, byName }) {
  const { data, error } = await supabase.from('care_ai_examples').insert({
    audience: draft.audience,
    kind: draft.kind,
    original: draft.original,
    wrote: draft.written || null,
    should_read: shouldRead.trim(),
    why: (why || '').trim() || null,
    draft_id: draft.id,
    created_by_name: byName || null,
  }).select().single();
  return { data, error };
}

export async function removeCareAiExample(id) {
  const { error } = await supabase.from('care_ai_examples').delete().eq('id', id);
  return { error };
}

/* The server half: whether the AI key is in, and this month's spend. */
export async function careAiStatus() {
  const { data, error } = await supabase.functions.invoke('care-ai', { body: { action: 'status' } });
  if (error) return { error: await readError(error) };
  return { data };
}

/* One past text written again — with the rules on the page, saved or not. */
export async function previewCareAi(draftId, rules) {
  const { data, error } = await supabase.functions.invoke('care-ai', { body: { action: 'preview', draftId, rules } });
  if (error) return { error: await readError(error) };
  return { data };
}

async function readError(error) {
  try {
    const body = await error.context?.json?.();
    if (body?.error) return body.error;
  } catch { /* fall through */ }
  return /failed to send|fetch/i.test(error.message || '')
    ? 'Could not reach the server. Check the connection and try again.'
    : 'Something went wrong. Try again in a moment.';
}

export const usd = n => `$${(Number(n) || 0).toFixed(2)}`;
