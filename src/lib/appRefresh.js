import { supabase } from './supabase';

// Tell open phones that something changed (supabase/app-live-updates.sql).
//
// Content in Pillar's own tables (the calendar, groups and their cards, Home's cards) announces
// itself by trigger. Content kept on the app server doesn't pass through the database, so after each
// save there Pillar marks its kind as changed here, and every phone with that page open reads it
// again within a second or two.
//
// A missed mark is never an error the office sees: the save itself already worked, and phones still
// pick the change up the next time they open the page.

export const APP_PARTS = ['home', 'announcements', 'calendar', 'groups', 'sermons', 'media', 'live'];

// which kind of content each app-server path holds
const BY_PATH = [
  [/^\/api\/announcements(\/|$)/, 'announcements'],
  [/^\/api\/sermons(\/|$)/, 'sermons'],
  [/^\/api\/(media-layout|custom-blocks|resources)(\/|$)/, 'media'],
  [/^\/api\/livestream(\/|$)/, 'live'],
];

/** The kind of content a write to this app-server path changes, or null when phones don't show it. */
export function partForPath(path) {
  const p = String(path || '').split('?')[0];
  const hit = BY_PATH.find(([re]) => re.test(p));
  return hit ? hit[1] : null;
}

/** Mark one kind of content as changed. Resolves true when phones were told. Never throws. */
export async function touchApp(part) {
  if (!APP_PARTS.includes(part)) return false;
  try {
    const { error } = await supabase.rpc('app_touch', { p: part });
    return !error;
  } catch {
    return false;
  }
}

/** Whether instant updates are set up (the table is there and readable). */
export async function liveUpdatesReady() {
  try {
    const { error } = await supabase.from('app_refresh').select('part').limit(1);
    return !error;
  } catch {
    return false;
  }
}
