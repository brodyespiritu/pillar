/*
 * Which care updates this person has already looked at.
 *
 * Kept on the device rather than the server: "have I read this" is a property
 * of a reader, not of the record, and the pastor's phone and the office desktop
 * are honestly different readers. A shared server flag would mean whoever
 * opened a card first cleared the dot for everybody.
 */

const KEY = 'pillar.care.seen';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
};

/** ISO timestamp of the newest update this device has seen for a member. */
export const seenAt = id => read()[id] || null;

export function markSeen(id, iso) {
  if (!id) return;
  try {
    const all = read();
    const stamp = iso || new Date().toISOString();
    /* Never move the marker backwards — opening an old card must not hide a
       newer update that arrived since. */
    if (!all[id] || stamp > all[id]) { all[id] = stamp; localStorage.setItem(KEY, JSON.stringify(all)); }
  } catch { /* private browsing, quota — the dot is not worth an exception */ }
}

/** The newest log on a member, whatever shape the row is in. */
export const newestUpdate = m => {
  const times = (m.contact_logs || []).map(l => l.created_at).filter(Boolean);
  return times.length ? times.sort().at(-1) : null;
};

/** Something has been written about this person that this device has not seen. */
export function hasUnseen(m) {
  const newest = newestUpdate(m);
  if (!newest) return false;
  const seen = seenAt(m.id);
  return !seen || newest > seen;
}
