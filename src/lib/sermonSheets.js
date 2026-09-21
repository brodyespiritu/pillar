import { supabase } from './supabase';

// The fill-in-the-blank sermon notes the congregation gets on the app's Bible page
// (supabase/app-slides-notes-saved.sql → app_sermon_notes).
//
// The office types the outline and marks every blank with three underscores:
//
//     God is ___ in all things.
//
// The app draws the words as words and each blank as a box the member taps and types into, then
// keeps what they typed against their own record. Nothing else in the sheet is special.

export const SHEET_COLUMNS = 'id,title,speaker,passage,on_date,video_url,body,published,sort,updated_at';
export const SHEET_LIMITS = { title: 120, speaker: 80, passage: 120, body: 20000 };
export const BLANK = '___';

const MISSING = /schema cache|does not exist|find the table/i;
export const notSetUp = (e) => MISSING.test(e?.message || '');
export const SETUP_HINT = 'Sermon notes need supabase/app-slides-notes-saved.sql run in the Supabase SQL editor.';

const orNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const isWebLink = (v) => /^https?:\/\/[^\s]+$/.test(String(v || '').trim());

/** How many blanks the office has left in it. */
export const countBlanks = (body) => (String(body || '').match(/_{3,}/g) || []).length;

export async function listSheets() {
  const { data, error } = await supabase.from('app_sermon_notes').select(SHEET_COLUMNS)
    .order('on_date', { ascending: false, nullsFirst: false }).order('sort', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** What the office got wrong. Empty: it can be saved. */
export function sheetProblems(f) {
  const out = [];
  const title = String(f.title || '').trim();
  if (!title) out.push('The notes need a title.');
  if (title.length > SHEET_LIMITS.title) out.push(`The title has to be ${SHEET_LIMITS.title} characters or fewer.`);
  if (String(f.speaker || '').length > SHEET_LIMITS.speaker) out.push('That speaker’s name is too long.');
  if (String(f.passage || '').length > SHEET_LIMITS.passage) out.push('That passage is too long.');
  if (!String(f.body || '').trim()) out.push('The notes are empty.');
  if (String(f.body || '').length > SHEET_LIMITS.body) out.push('The notes are longer than the app can hold.');
  if (f.video_url && !isWebLink(f.video_url)) out.push('The video has to be a web address (https://…).');
  if (f.on_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.on_date)) out.push('The date has to be a date.');
  return out;
}
export const sheetReady = (f) => sheetProblems(f).length === 0;

export function sheetPatch(f) {
  return {
    title: String(f.title || '').trim(),
    speaker: orNull(f.speaker),
    passage: orNull(f.passage),
    on_date: orNull(f.on_date),
    video_url: orNull(f.video_url),
    body: String(f.body || ''),
    published: f.published === true,
  };
}

export async function saveSheet({ id, sort, ...f }) {
  const row = { ...sheetPatch(f), ...(sort == null ? {} : { sort }) };
  const q = supabase.from('app_sermon_notes');
  const { data, error } = id
    ? await q.update(row).eq('id', id).select(SHEET_COLUMNS).single()
    : await q.insert(row).select(SHEET_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function deleteSheet(id) {
  const { error } = await supabase.from('app_sermon_notes').delete().eq('id', id);
  if (error) throw error;
}
