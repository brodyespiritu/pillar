import { supabase } from './supabase';
import { uploadCardImage } from './homeCards';

// The four boxes on the app's Home page (supabase/app-home-tiles.sql → public.app_home_tiles).
//
// Only what the office changes is stored. Leave a box's words blank and the app uses its own —
// which is what every box says today (the placeholders below are those words, kept in step with
// BethesdaApp components/HomeTiles.js). What a box OPENS is the app's and can't be changed here.

export const TILE_COLUMNS = 'slot,title,subtitle,image_url,updated_at';
export const TILE_LIMITS = { title: 24, subtitle: 60 };

export const SLOTS = [
  {
    // the app names whichever account comes first in its constants/social.js — Facebook today;
    // if the church ever puts Instagram first there, change the two words below with it
    slot: 'post',
    name: 'Latest post',
    opens: 'Opens the church’s Facebook page',
    title: 'Latest post',
    subtitle: 'See it on Facebook',
    photo: 'A church photo comes with the app; yours replaces it.',
  },
  { slot: 'prayer', name: 'Prayer', opens: 'Opens the prayer request form', title: 'Prayer', subtitle: 'We’d love to pray with you' },
  { slot: 'connect', name: 'Connect', opens: 'Opens Groups and Ministries', title: 'Connect', subtitle: 'Find your people' },
  { slot: 'bulletin', name: 'Bulletin', opens: 'Opens the Digital Bulletin', title: 'Bulletin', subtitle: 'Sunday and the week ahead' },
];

const orNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const isWebLink = (v) => /^https?:\/\/[^\s]+$/.test(String(v || '').trim());

/** What the office has changed, by slot. */
export async function listTiles() {
  const { data, error } = await supabase.from('app_home_tiles').select(TILE_COLUMNS);
  if (error) throw error;
  return data || [];
}

/** What the office got wrong. Empty: it can be saved. */
export function tileProblems(f) {
  const out = [];
  const title = String(f.title || '').trim();
  const subtitle = String(f.subtitle || '').trim();
  if (!SLOTS.some((s) => s.slot === f.slot)) out.push('That isn’t one of the four boxes.');
  if (title.length > TILE_LIMITS.title) out.push(`A box's word has to be ${TILE_LIMITS.title} characters or fewer.`);
  if (subtitle.length > TILE_LIMITS.subtitle) out.push(`The line under it has to be ${TILE_LIMITS.subtitle} characters or fewer.`);
  if (f.image_url && !isWebLink(f.image_url)) out.push('The picture has to be a web address (https://…).');
  return out;
}

export function tilePatch(f) {
  return {
    slot: f.slot,
    title: orNull(f.title),
    subtitle: orNull(f.subtitle),
    image_url: orNull(f.image_url),
  };
}

/** One box. Everything blank removes the row, so the app's own words come back. */
export async function saveTile(f) {
  const patch = tilePatch(f);
  if (!patch.title && !patch.subtitle && !patch.image_url) {
    const { error } = await supabase.from('app_home_tiles').delete().eq('slot', patch.slot);
    if (error) throw error;
    return null;
  }
  const { data, error } = await supabase.from('app_home_tiles')
    .upsert(patch, { onConflict: 'slot' }).select(TILE_COLUMNS).single();
  if (error) throw error;
  return data;
}

export const uploadTileImage = uploadCardImage;
