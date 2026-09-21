import { supabase } from './supabase';

// Series and Featured on the app's Media page (supabase/app-media-series.sql).
//
// The sermons and videos themselves live on the app server (lib/appApi.js). These two lists only
// say how they are ARRANGED: which series exist and what is in each, and what sits right below the
// big card at the top of Media. Everything here stores app-server ids as plain text.

export const SERIES_COLUMNS = 'id,name,subtitle,image_url,items,published,sort,updated_at';
export const SERIES_LIMITS = { name: 60, subtitle: 120 };
export const KINDS = ['sermon', 'video'];

const MISSING = /schema cache|does not exist|find the table/i;
/** True when the church hasn't run supabase/app-media-series.sql yet. */
export const notSetUp = (e) => MISSING.test(e?.message || '');
export const SETUP_HINT =
  'Series and Featured need supabase/app-media-series.sql run in the Supabase SQL editor.';

const orNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const isWebLink = (v) => /^https?:\/\/[^\s]+$/.test(String(v || '').trim());

/** The items of a series, cleaned: [{ id, kind }] with no blanks and no repeats. */
export function cleanItems(items) {
  const seen = new Set();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((it) => {
    const id = String(it?.id ?? '').trim();
    const kind = KINDS.includes(it?.kind) ? it.kind : 'sermon';
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind });
  });
  return out;
}

/* ── series ── */

export async function listSeries() {
  const { data, error } = await supabase.from('app_media_series').select(SERIES_COLUMNS).order('sort');
  if (error) throw error;
  return (data || []).map((r) => ({ ...r, items: cleanItems(r.items) }));
}

/** What the office got wrong. Empty: it can be saved. */
export function seriesProblems(f) {
  const out = [];
  const name = String(f.name || '').trim();
  if (!name) out.push('A series needs a name.');
  if (name.length > SERIES_LIMITS.name) out.push(`A series name has to be ${SERIES_LIMITS.name} characters or fewer.`);
  if (String(f.subtitle || '').length > SERIES_LIMITS.subtitle) out.push(`The line under it has to be ${SERIES_LIMITS.subtitle} characters or fewer.`);
  if (f.image_url && !isWebLink(f.image_url)) out.push('The cover has to be a web address (https://…).');
  return out;
}

/** True when this series is ready to show in the app. */
export const seriesReady = (f) => seriesProblems(f).length === 0 && cleanItems(f.items).length > 0;

export function seriesPatch(f) {
  return {
    name: String(f.name || '').trim(),
    subtitle: orNull(f.subtitle),
    image_url: orNull(f.image_url),
    items: cleanItems(f.items),
    published: f.published === true,
  };
}

export async function saveSeries({ id, sort, ...f }) {
  const row = { ...seriesPatch(f), ...(sort == null ? {} : { sort }) };
  if (id) {
    const { data, error } = await supabase.from('app_media_series').update(row).eq('id', id).select(SERIES_COLUMNS).single();
    if (error) throw error;
    return { ...data, items: cleanItems(data.items) };
  }
  const { data, error } = await supabase.from('app_media_series').insert(row).select(SERIES_COLUMNS).single();
  if (error) throw error;
  return { ...data, items: cleanItems(data.items) };
}

export async function setSeriesSort(id, sort) {
  const { error } = await supabase.from('app_media_series').update({ sort }).eq('id', id);
  if (error) throw error;
}

export async function deleteSeries(id) {
  const { error } = await supabase.from('app_media_series').delete().eq('id', id);
  if (error) throw error;
}

/* ── featured: what sits right below the big card ── */

/** The featured ids in order: [{ item_id, kind, sort }]. */
export async function listFeatured() {
  const { data, error } = await supabase.from('app_media_featured').select('item_id,kind,sort').order('sort');
  if (error) throw error;
  return data || [];
}

/** Switch one sermon or video on or off. Off removes the row, so nothing is left behind. */
export async function setFeatured(itemId, kind, on, sort = 0) {
  const id = String(itemId || '').trim();
  if (!id) throw new Error('That item has no id yet — save it first.');
  if (!on) {
    const { error } = await supabase.from('app_media_featured').delete().eq('item_id', id);
    if (error) throw error;
    return null;
  }
  const row = { item_id: id, kind: KINDS.includes(kind) ? kind : 'video', sort };
  const { data, error } = await supabase.from('app_media_featured')
    .upsert(row, { onConflict: 'item_id' }).select('item_id,kind,sort').single();
  if (error) throw error;
  return data;
}

/** Put the featured list in this order (the app shows them top to bottom). */
export async function orderFeatured(ids) {
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase.from('app_media_featured').update({ sort: (i + 1) * 10 }).eq('item_id', ids[i]);
    if (error) throw error;
  }
}
