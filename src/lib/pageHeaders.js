import { supabase } from './supabase';

// The photos at the top of the app's pages (supabase/app-page-headers.sql, 2026-09-21). A page with no
// picture here keeps the app's own. Saving one reaches open phones within a second or two.

// (the Groups page has one name in the app since 2026-09-23 — BethesdaApp screens/GroupsScreen.js:
// "one name for this page everywhere" — so here too)
export const PAGES = [
  { key: 'home', label: 'Home', hint: 'The big photo at the top of Home.' },
  { key: 'directory', label: 'Directory', hint: 'The photo above the church directory.' },
  { key: 'groups', label: 'Groups', hint: 'The photo above Groups.' },
];

/**
 * { home: url, … } for the pages that have one; null when app-page-headers.sql hasn't been run — the
 * table isn't there (42P01, PostgREST's PGRST205 "…schema cache"). Any other error is thrown, even
 * one that names the table ("permission denied for table app_page_headers"): Settings shows it with
 * Try again rather than asking for the SQL again (Pillar review, 2026-09-23).
 */
export async function listPageHeaders() {
  const { data, error } = await supabase.from('app_page_headers').select('page,image_url');
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(String(error.message || ''))) return null;
    throw error;
  }
  const out = {};
  for (const r of data || []) if (r?.image_url) out[r.page] = r.image_url;
  return out;
}

/** Set a page's photo, or clear it (the app's own photo comes back). */
export async function setPageHeader(page, url) {
  const { error } = await supabase
    .from('app_page_headers')
    .upsert({ page, image_url: url || null }, { onConflict: 'page' });
  if (error) throw error;
}
