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
//
// A sheet can go with one sermon in the Watch library (sermon_id, supabase/sermon-notes-for-a-sermon.sql):
// the app then offers it on that sermon's card. One sheet per sermon.

const BASE_COLUMNS = 'id,title,speaker,passage,on_date,video_url,body,published,sort,updated_at';
export const SHEET_COLUMNS = `${BASE_COLUMNS},sermon_id`;
export const SHEET_LIMITS = { title: 120, speaker: 80, passage: 120, body: 20000 };
export const BLANK = '___';

const MISSING = /schema cache|does not exist|find the table/i;
export const notSetUp = (e) => MISSING.test(e?.message || '') && !/sermon_id/.test(e?.message || '');
export const SETUP_HINT = 'Sermon notes need supabase/app-slides-notes-saved.sql run in the Supabase SQL editor.';
export const SERMON_HINT = 'To attach notes to a sermon, run supabase/sermon-notes-for-a-sermon.sql in the Supabase SQL editor.';

// The notes table came first and the sermon link a few days later, so a project can have the one
// without the other. Null until the first list says which.
let sermonLink = null;
export const sermonLinkReady = () => sermonLink !== false;
const noSermonColumn = (e) => /sermon_id/.test(`${e?.message || ''} ${e?.details || ''}`);

const orNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const isWebLink = (v) => /^https?:\/\/[^\s]+$/.test(String(v || '').trim());

/** How many blanks the office has left in it. */
export const countBlanks = (body) => (String(body || '').match(/_{3,}/g) || []).length;

const listed = (columns) => supabase.from('app_sermon_notes').select(columns)
  .order('on_date', { ascending: false, nullsFirst: false }).order('sort', { ascending: false });

export async function listSheets() {
  let { data, error } = await listed(SHEET_COLUMNS);
  if (error && noSermonColumn(error)) {
    sermonLink = false;
    ({ data, error } = await listed(BASE_COLUMNS));
  } else if (!error) sermonLink = true;
  if (error) throw error;
  return data || [];
}

/** Which sermons have notes: sermon id → sheet id. Empty when there are none, or no link yet. */
export async function listSheetLinks() {
  const { data, error } = await supabase.from('app_sermon_notes').select('id,sermon_id');
  if (error) return new Map();
  return new Map((data || []).filter((r) => r.sermon_id).map((r) => [String(r.sermon_id), r.id]));
}

/** What the office got wrong. Empty: it can be saved (the database asks exactly this). */
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

/** A sermon's date the way the notes keep it (2026-09-14), or '' when it can't be read. */
export function isoDate(v) {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const stamp = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);   // a timestamp: the day it names
  if (stamp) return `${stamp[1]}-${stamp[2]}-${stamp[3]}`;
  if (!s) return '';
  const d = new Date(s);                                // "Sep 14, 2026", "9/14/2026"
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * What picking a sermon fills in: the link, and its title, speaker, date and video wherever the
 * sermon has them (what's already typed stays where the sermon has nothing).
 */
export function fromSermon(sermon, f = {}) {
  const has = (v) => String(v ?? '').trim();
  return {
    sermon_id: String(sermon.id),
    title: has(sermon.title) ? has(sermon.title).slice(0, SHEET_LIMITS.title) : (f.title || ''),
    speaker: has(sermon.speaker) ? has(sermon.speaker).slice(0, SHEET_LIMITS.speaker) : (f.speaker || ''),
    on_date: isoDate(sermon.date) || f.on_date || '',
    video_url: isWebLink(sermon.videoLink) ? has(sermon.videoLink) : (f.video_url || ''),
  };
}

export function sheetPatch(f) {
  return {
    title: String(f.title || '').trim(),
    speaker: orNull(f.speaker),
    passage: orNull(f.passage),
    on_date: orNull(f.on_date),
    video_url: orNull(f.video_url),
    body: String(f.body || ''),
    published: f.published === true,
    ...(sermonLink === false ? {} : { sermon_id: orNull(f.sermon_id) }),
  };
}

const plainly = (error) => (error?.code === '23505' || /one_per_sermon/.test(error?.message || '')
  ? new Error('That sermon already has notes. Pick them in the list to change them.')
  : error);

export async function saveSheet({ id, sort, ...f }) {
  const row = { ...sheetPatch(f), ...(sort == null ? {} : { sort }) };
  const columns = sermonLink === false ? BASE_COLUMNS : SHEET_COLUMNS;
  const q = supabase.from('app_sermon_notes');
  const { data, error } = id
    ? await q.update(row).eq('id', id).select(columns).single()
    : await q.insert(row).select(columns).single();
  if (error) throw plainly(error);
  return data;
}

export async function deleteSheet(id) {
  const { error } = await supabase.from('app_sermon_notes').delete().eq('id', id);
  if (error) throw error;
}
