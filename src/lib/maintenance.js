import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/*
 * Scheduled texting maintenance, as the app sees it.
 *
 * The window lives in sms_maintenance (supabase/sms-maintenance-schema.sql) and
 * the send functions enforce it; this only lets a screen SAY so instead of
 * letting someone write a whole message and find out when they press send.
 *
 * Fails open, exactly as the server does: if the window cannot be read, the
 * composer stays usable, and the server still refuses to send during a window.
 */
export async function fetchMaintenance() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('sms_maintenance')
    .select('starts_at, ends_at')
    .lte('starts_at', now)
    .gt('ends_at', now)
    .order('ends_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] ?? null;
}

/*
 * One poller for the whole app.
 *
 * Several texting controls can be on screen at once — the composer, a reply box,
 * a Remind dialog — and each asking the database every minute would be several
 * queries a minute for one fact. They subscribe to a single check instead: the
 * first control on screen starts it, the last one to leave stops it.
 *
 * Re-checked every minute, so a window that starts, is extended or is ended
 * early shows up within a minute; and re-checked the moment the current one is
 * due to close, so everything comes back at 9:00 exactly, not up to a minute late.
 */
let current = null;
const listeners = new Set();
let timer = null;

async function tick() {
  const w = await fetchMaintenance().catch(() => null);
  current = w;
  listeners.forEach(tell => tell(w));
  clearTimeout(timer);
  timer = null;
  if (!listeners.size) return;              // nobody left on screen to tell
  const untilEnd = w ? new Date(w.ends_at).getTime() - Date.now() + 500 : Infinity;
  timer = setTimeout(tick, Math.max(1000, Math.min(60_000, untilEnd)));
}

/* The window open right now, or null — kept current without a reload. */
export function useMaintenance() {
  const [win, setWin] = useState(current);
  useEffect(() => {
    listeners.add(setWin);
    if (listeners.size === 1) tick();       // first on screen starts the check
    else setWin(current);                   // the rest take what is already known
    return () => {
      listeners.delete(setWin);
      if (!listeners.size) { clearTimeout(timer); timer = null; }
    };
  }, []);
  return win;
}

/*
 * "Under scheduled maintenance until 9:00PM EST".
 *
 * The time comes from the window, so an extension changes the words. \s+ rather
 * than a plain space: newer browsers put a narrow no-break space before "PM",
 * which a literal ' ' would miss.
 */
export function maintenanceLabel(win) {
  const until = new Date(win.ends_at)
    .toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    .replace(/\s+/g, '');
  return `Under scheduled maintenance until ${until} EST`;
}
