/*
 * Address prediction via Google Places, proxied through /api/places so the
 * API key stays on the server. Every call fails soft — if the key isn't
 * configured or the network is down, the form just behaves as plain text
 * boxes instead of breaking.
 */

/** Suggestions for a partially typed place. `kind` is 'address' or 'school'. */
export async function placeSuggest(query, signal, kind = 'address') {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  try {
    const r = await fetch(`/api/places?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`, { signal });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.suggestions) ? j.suggestions : [];
  } catch {
    return [];   // aborted, offline, or not configured
  }
}

/** Full structured address for a chosen suggestion. */
export async function placeDetails(placeId) {
  if (!placeId) return null;
  try {
    const r = await fetch(`/api/places?place_id=${encodeURIComponent(placeId)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.error ? null : j;
  } catch {
    return null;
  }
}
