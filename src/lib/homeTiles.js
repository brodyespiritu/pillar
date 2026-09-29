import { supabase } from './supabase';
import { uploadCardImage } from './homeCards';

// The app Home page's shortcuts and latest post (supabase/app-home-tiles.sql → public.app_home_tiles).
//
// Since the Home redesign (2026-09-23) three of these are ROUND BUTTONS under the latest sermon —
// Prayer, Connect and Bulletin — and show one word each (BethesdaApp components/HomeShortcuts.js);
// the office's word replaces the app's. The fourth, the latest post, is no longer a box: it is the card
// Home shows when there is nothing else for right now (components/TimelyCard.js), with its words and
// picture. The slots and the table are unchanged, so nothing the office wrote was lost.
//
// Only what the office changes is stored. Leave the words blank and the app uses its own (the
// placeholders below are those words). What each one OPENS is the app's and can't be changed here.

export const TILE_COLUMNS = 'slot,title,subtitle,image_url,updated_at';
export const TILE_LIMITS = { title: 24, subtitle: 60, button: 12 };   // a round button's word sits under a 58pt disc

export const SLOTS = [
  {
    // the app names whichever account comes first in its constants/social.js — Facebook today;
    // if the church ever puts Instagram first there, change the two words below with it
    slot: 'post',
    name: 'Latest post',
    opens: 'Home’s card when there’s nothing else for right now — opens the church’s Facebook page',
    title: 'Our latest post',
    subtitle: 'See it on Facebook',
    photo: 'A church photo comes with the app; yours replaces it.',
  },
  { slot: 'prayer', name: 'Prayer', opens: 'Round button · opens the prayer request form', title: 'Pray', button: true },
  { slot: 'connect', name: 'Connect', opens: 'Round button · opens Groups', title: 'Groups', button: true },
  { slot: 'bulletin', name: 'Bulletin', opens: 'Round button · opens the Digital Bulletin', title: 'Bulletin', button: true },
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
  const slot = SLOTS.find((s) => s.slot === f.slot);
  if (!slot) out.push('That isn’t one of Home’s shortcuts.');
  if (slot?.button && title.length > TILE_LIMITS.button) out.push(`A button’s word has to be ${TILE_LIMITS.button} characters or fewer — it sits under a small round button.`);
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
