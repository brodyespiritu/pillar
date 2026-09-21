/*
 * Bethesda mobile-app admin API client.
 *
 * The phone app polls this same REST backend, so any write here edits the
 * LIVE app within seconds. All writes upsert by `id` (client-generated).
 *
 * Hosted on Render's free tier: the first request after idle can take
 * 30–60s to wake, so reads use a generous timeout.
 *
 * Reads (GET) are open. WRITES need the app server's key, and that key never comes
 * near the browser — Pillar's own serverless function holds it (api/app-write.js) and
 * only forwards a write for a signed-in, active staff member. See writeViaPillar below.
 */
import { supabase } from './supabase';
import { partForPath, touchApp } from './appRefresh';

export const APP_API_BASE = 'https://bethesda-admin.onrender.com';

export const genId = () => Date.now().toString();

/*
 * Fallback write auth, for a plain `vite dev` server (no /api functions) or before the
 * proxy is deployed: a key kept in this browser's localStorage, sent straight to the app
 * server. App → App Settings → App API access still sets it. In production nobody needs it.
 */
const AUTH_KEY = 'pillar:app-api-auth';
let _auth = { key: '', header: 'Authorization', prefix: 'Bearer ' };
try { const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); if (s && typeof s === 'object') _auth = { ..._auth, ...s }; } catch { /* ignore */ }

export function setAppApiAuth({ key, header, prefix } = {}) {
  _auth = { key: key || '', header: header || _auth.header, prefix: prefix !== undefined ? prefix : _auth.prefix };
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(_auth)); } catch { /* ignore */ }
}
export const hasAppApiAuth = () => !!_auth.key;

const PROXY = '/api/app-write';
let _proxy = null;   // null: untried · true: Pillar's server writes · false: not available here

async function staffToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch { return null; }
}

/*
 * Ask Pillar's own server to make this write with the app key it holds.
 * Returns { handled: false } when there is no such endpoint (a plain dev server) or nobody is
 * signed in, so the caller can fall back to the browser-held key.
 */
async function writeViaPillar(path, method, body, signal) {
  if (_proxy === false) return { handled: false };
  const token = await staffToken();
  if (!token) return { handled: false };
  const send = () => fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path, method, body }),
    signal,
  });
  let res;
  try { res = await send(); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    return { handled: false };            // no Pillar server on this origin
  }
  const read = async (r) => {
    const text = await r.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  };
  let data = await read(res);
  const isOurs = data && typeof data === 'object' && ('ok' in data || 'error' in data);
  if (res.status === 404 && !isOurs) { _proxy = false; return { handled: false }; }
  _proxy = true;
  if (res.status === 504) {                // Render was asleep: wake it with an open read, then retry once
    await fetch(`${APP_API_BASE}/api/settings`, { signal }).catch(() => {});
    res = await send();
    data = await read(res);
  }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  return { handled: true, data: data && typeof data === 'object' && 'data' in data ? data.data : data };
}

/*
 * Every call to the app server. A write that changes something phones show also marks it changed
 * (lib/appRefresh.js), so phones with that page open read it again at once — without holding up
 * the save.
 */
async function req(path, opts = {}) {
  const data = await send(path, opts);
  const method = opts.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    const part = partForPath(path);
    if (part) touchApp(part);
  }
  return data;
}

async function send(path, { method = 'GET', body, timeout = 90000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const isWrite = method !== 'GET' && method !== 'HEAD';
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (isWrite && _auth.key) headers[_auth.header] = `${_auth.prefix}${_auth.key}`;
  try {
    // Vercel caps a function's request at ~4.5MB; anything bigger goes straight to the app server.
    const big = isWrite && body !== undefined && JSON.stringify(body).length > 3_500_000;
    if (isWrite && !big) {
      const viaPillar = await writeViaPillar(path, method, body, ctrl.signal);
      if (viaPillar.handled) return viaPillar.data;
    }
    const res = await fetch(`${APP_API_BASE}${path}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Write blocked (401): the app server requires an auth key that isn’t set yet. Provision it in App settings once the key is issued.');
    }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The app server timed out. It may be waking up — try again in a moment.');
    // WebKit's "Load failed" / Chromium's "Failed to fetch": the reply never became
    // readable. For writes that is the server refusing the credential — its write-auth
    // 401 carries no CORS header, so the browser hides the status (verified 2026-09-14:
    // a keyless DELETE gets 401 with no Access-Control-Allow-Origin, unlike its routes).
    if (e instanceof TypeError) {
      if (isWrite) {
        throw new Error(_auth.key
          ? 'The app server refused this change — the key in App → App Settings → App API access may be wrong or use the wrong header.'
          : 'This change needs Pillar\'s server, which holds the app key. Sign in to Pillar again and retry; if it keeps failing, check APP_API_KEY in Vercel.');
      }
      throw new Error('Couldn’t reach the app server. Check your connection and try again.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Pillar's server whether the key it holds is the one the app server wants.
 * → { keyLength, hadWhitespace, upstream, accepted } or null when there is no Pillar server here.
 */
export async function checkAppApiKey() {
  const token = await staffToken();
  if (!token) return null;
  try {
    const res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ check: true }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { error: (data && data.error) || `Check failed (${res.status})` };
    return data?.check || null;
  } catch { return null; }
}

/* ── Livestream ── */
export const getLivestream = () => req('/api/livestream');
export const putLivestream = (data) => req('/api/livestream', { method: 'PUT', body: data });

/* ── Sermons ── */
export const getSermons = () => req('/api/sermons');
export const saveSermon = (s) => req('/api/sermons', { method: 'POST', body: s });
export const deleteSermon = (id) => req(`/api/sermons/${id}`, { method: 'DELETE' });

/* ── Announcements ── */
export const getAnnouncements = () => req('/api/announcements');
export const saveAnnouncement = (a) => req('/api/announcements', { method: 'POST', body: a });
export const deleteAnnouncement = (id) => req(`/api/announcements/${id}`, { method: 'DELETE' });

/* ── Events ── */
export const getEvents = () => req('/api/events');
export const saveEvent = (e) => req('/api/events', { method: 'POST', body: e });
export const deleteEvent = (id) => req(`/api/events/${id}`, { method: 'DELETE' });

/* ── Media page ── */
export const getMediaLayout = () => req('/api/media-layout');
export const putMediaLayout = (l) => req('/api/media-layout', { method: 'PUT', body: l });
export const getCustomBlocks = () => req('/api/custom-blocks');
export const saveCustomBlock = (b) => req('/api/custom-blocks', { method: 'POST', body: b });
export const deleteCustomBlock = (id) => req(`/api/custom-blocks/${id}`, { method: 'DELETE' });
export const getResources = () => req('/api/resources');
export const saveResource = (r) => req('/api/resources', { method: 'POST', body: r });
export const deleteResource = (id) => req(`/api/resources/${id}`, { method: 'DELETE' });

/* ── Live cards ── */
export const getLiveCardTemplates = () => req('/api/live-card-templates');
export const saveLiveCardTemplate = (t) => req('/api/live-card-templates', { method: 'POST', body: t });
export const deleteLiveCardTemplate = (id) => req(`/api/live-card-templates/${id}`, { method: 'DELETE' });
export const getLiveCard = () => req('/api/live-card');
export const pushLiveCard = (card) => req('/api/live-card', { method: 'POST', body: card });
export const clearLiveCard = () => req('/api/live-card', { method: 'DELETE' });
export const getLiveCardVotes = () => req('/api/live-card/votes');

/* ── Live chat (in-memory, read-only for moderation) ── */
export const getChat = () => req('/api/chat');

/* ── Notifications ── */
export const getPushCount = () => req('/api/push-tokens/count');
export const sendNotification = (payload) => req('/api/notifications/send', { method: 'POST', body: payload });

/* ── Settings & page blocks ── */
export const getSettings = () => req('/api/settings');
export const putSettings = (s) => req('/api/settings', { method: 'PUT', body: s });
export const getPageBlocks = () => req('/api/page-blocks');
export const putPageBlocks = (b) => req('/api/page-blocks', { method: 'PUT', body: b });
/* Home-screen block layout the app actually renders: [{id,label,enabled}] */
export const getBlocks = () => req('/api/blocks');
export const putBlocks = (b) => req('/api/blocks', { method: 'PUT', body: b });

/* ── Ministry cards (write support unverified — probe before exposing an editor) ── */
export const getMinistryCards = () => req('/api/ministry-cards');
export const saveMinistryCard = (c) => req('/api/ministry-cards', { method: 'POST', body: c });

/* ── Uploads ── */
/** Upload an image file → returns a hosted URL (server field may be `url`/`imageUrl`). */
export async function uploadImage(file, timeout = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const form = new FormData();
    // `file`, the field the server's upload middleware accepts (the app's own admin,
    // screens/Admin/SermonManager.js, sends the same). Any other field name — this
    // used to send `image` — is rejected before the route runs: a bare HTML 500.
    form.append('file', file);
    const res = await fetch(`${APP_API_BASE}/api/upload`, { method: 'POST', body: form, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data.url || data.imageUrl || data.secure_url || data.location || null;
  } finally {
    clearTimeout(timer);
  }
}

/** Request a signed GCS URL for a direct video upload. */
export const getGcsSignedUrl = (payload) => req('/api/gcs-signed-url', { method: 'POST', body: payload });
