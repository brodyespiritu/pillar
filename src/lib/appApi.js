/*
 * Bethesda mobile-app admin API client.
 *
 * The phone app polls this same REST backend, so any write here edits the
 * LIVE app within seconds. All writes upsert by `id` (client-generated).
 *
 * Hosted on Render's free tier: the first request after idle can take
 * 30–60s to wake, so reads use a generous timeout.
 *
 * ⚠ These endpoints currently have NO auth — this client must only ever be
 * reached through Pillar's admin-gated UI. Server-side API-key auth is a
 * follow-up (see the App module notes).
 */
export const APP_API_BASE = 'https://bethesda-admin.onrender.com';

export const genId = () => Date.now().toString();

/*
 * Write auth. Reads (GET) are open, but the server now requires an auth
 * credential on writes (POST/PUT/DELETE) — a bare write returns 401
 * {"error":"Unauthorized"}. The exact scheme is not advertised, so it is
 * configurable here: `header` (e.g. "Authorization" or "x-api-key") and
 * `prefix` (e.g. "Bearer " or ""). Provision the key via setAppApiAuth();
 * it persists in localStorage so it survives reloads.
 *
 * NOTE: for browser use the server's CORS must also allow the chosen header
 * (its preflight currently echoes requested headers, so this should work).
 */
const AUTH_KEY = 'pillar:app-api-auth';
let _auth = { key: '', header: 'Authorization', prefix: 'Bearer ' };
try { const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); if (s && typeof s === 'object') _auth = { ..._auth, ...s }; } catch { /* ignore */ }

export function setAppApiAuth({ key, header, prefix } = {}) {
  _auth = { key: key || '', header: header || _auth.header, prefix: prefix !== undefined ? prefix : _auth.prefix };
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(_auth)); } catch { /* ignore */ }
}
export const hasAppApiAuth = () => !!_auth.key;

async function req(path, { method = 'GET', body, timeout = 90000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const isWrite = method !== 'GET' && method !== 'HEAD';
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (isWrite && _auth.key) headers[_auth.header] = `${_auth.prefix}${_auth.key}`;
  try {
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
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
    form.append('image', file);
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
