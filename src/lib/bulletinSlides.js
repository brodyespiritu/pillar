import { supabase } from './supabase';
import { uploadCardImage } from './homeCards';

// The slides shown in the service, for the app's Digital Bulletin
// (supabase/app-slides-notes-saved.sql → app_bulletin_slides).
//
// A slide can be pinned to a Sunday; one with no date belongs to whichever Sunday the bulletin is
// showing, which is what the office usually wants. Pictures go where the Home cards' do.

export const SLIDE_COLUMNS = 'id,image_url,caption,on_date,published,sort,updated_at';
export const CAPTION_MAX = 200;

const MISSING = /schema cache|does not exist|find the table/i;
export const notSetUp = (e) => MISSING.test(e?.message || '');
export const SETUP_HINT = 'Slides need supabase/app-slides-notes-saved.sql run in the Supabase SQL editor.';

const orNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const isWebLink = (v) => /^https?:\/\/[^\s]+$/.test(String(v || '').trim());

export async function listSlides() {
  const { data, error } = await supabase.from('app_bulletin_slides').select(SLIDE_COLUMNS).order('sort');
  if (error) throw error;
  return data || [];
}

/** What the office got wrong. Empty: it can be saved. */
export function slideProblems(f) {
  const out = [];
  if (!isWebLink(f.image_url)) out.push('A slide needs a picture.');
  if (String(f.caption || '').length > CAPTION_MAX) out.push(`A caption has to be ${CAPTION_MAX} characters or fewer.`);
  if (f.on_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.on_date)) out.push('The Sunday has to be a date.');
  return out;
}
export const slideReady = (f) => slideProblems(f).length === 0;

export function slidePatch(f) {
  return {
    image_url: String(f.image_url || '').trim(),
    caption: orNull(f.caption),
    on_date: orNull(f.on_date),
    published: f.published === true,
  };
}

export async function saveSlide({ id, sort, ...f }) {
  const row = { ...slidePatch(f), ...(sort == null ? {} : { sort }) };
  const q = supabase.from('app_bulletin_slides');
  const { data, error } = id
    ? await q.update(row).eq('id', id).select(SLIDE_COLUMNS).single()
    : await q.insert(row).select(SLIDE_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function setSlideSort(id, sort) {
  const { error } = await supabase.from('app_bulletin_slides').update({ sort }).eq('id', id);
  if (error) throw error;
}

export async function deleteSlide(id) {
  const { error } = await supabase.from('app_bulletin_slides').delete().eq('id', id);
  if (error) throw error;
}

export const uploadSlide = uploadCardImage;
