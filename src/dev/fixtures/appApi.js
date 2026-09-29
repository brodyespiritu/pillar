// DEV ONLY. An in-memory stand-in for src/lib/appApi.js (the church's live app server), swapped in by the
// `pillar-fixtures` plugin in vite.config.js — only under `vite --mode fixtures` (npm run dev:fixtures).
// It exports exactly the names the real client does (tests/fixtures.test.mjs keeps them in step), so every
// page that imports '../../lib/appApi' works unchanged, and nothing here can reach the app server, send a
// notification or upload a video.
//
// Every call waits 80–250 ms (2 s with ?fx=slow) so "Saving…" is visible; the polled reads (livestream
// every 60 s, the live card and votes every 5 s, chat every 7 s) are cheap and never log. ?fx=fail makes
// every write throw. See src/dev/fixtures/data.js for the sample content and the other knobs.
import { FX, clone, pic, serverSeed, wait } from './data.js';
import { supabase } from './supabase.js';

export const APP_API_BASE = 'https://fixtures.invalid';

// the real one is Date.now() as text; this one never hands out the same id twice in one millisecond
let lastId = 0;
export const genId = () => {
  lastId = Math.max(Date.now(), lastId + 1);
  return String(lastId);
};

const server = serverSeed();

// the app-server key (Settings → Developer options) lives only in this tab
let auth = { key: '', header: 'Authorization', prefix: 'Bearer ' };
export function setAppApiAuth({ key, header, prefix } = {}) {
  auth = { key: key || '', header: header || auth.header, prefix: prefix !== undefined ? prefix : auth.prefix };
}
export const hasAppApiAuth = () => !!auth.key;

/* ── the plumbing every call shares ── */

const read = async (v) => { await wait(); return clone(v); };

// what the real client does after a write phones show (lib/appRefresh.js): mark the part changed
const touch = (part) => { if (part) supabase.rpc('app_touch', { p: part }); };

async function write(part, change) {
  await wait();
  if (FX.fail) throw new Error('The app server said no. (fixtures: ?fx=fail)');
  const out = change();
  touch(part);
  return clone(out);
}

// the app server upserts by the client's id
const upsertIn = (list, item) => {
  const row = clone({ ...item, id: String(item?.id ?? genId()) });
  const at = server[list].findIndex((x) => String(x.id) === row.id);
  if (at >= 0) server[list][at] = row; else server[list].unshift(row);
  return row;
};
const removeFrom = (list, id) => {
  server[list] = server[list].filter((x) => String(x.id) !== String(id));
  return { ok: true };
};

export async function checkAppApiKey() {
  await wait();
  return { keyLength: 40, hadWhitespace: false, upstream: 200, accepted: true };
}

/* ── Livestream ── */
export const getLivestream = () => read(server.livestream);
export const putLivestream = (data) => write('live', () => (server.livestream = { ...server.livestream, ...clone(data) }));

/* ── Sermons ── */
export const getSermons = () => read(server.sermons);
export const saveSermon = (s) => write('sermons', () => upsertIn('sermons', s));
export const deleteSermon = (id) => write('sermons', () => removeFrom('sermons', id));

/* ── Announcements ── */
export const getAnnouncements = () => read(server.announcements);
export const saveAnnouncement = (a) => write('announcements', () => upsertIn('announcements', a));
export const deleteAnnouncement = (id) => write('announcements', () => removeFrom('announcements', id));

/* ── Events ── */
export const getEvents = () => read(server.events);
export const saveEvent = (e) => write(null, () => upsertIn('events', e));
export const deleteEvent = (id) => write(null, () => removeFrom('events', id));

/* ── Media page ── */
export const getMediaLayout = () => read(server.mediaLayout);
export const putMediaLayout = (l) => write('media', () => (server.mediaLayout = clone(l) || {}));
export const getCustomBlocks = () => read(server.customBlocks);
export const saveCustomBlock = (b) => write('media', () => upsertIn('customBlocks', b));
export const deleteCustomBlock = (id) => write('media', () => removeFrom('customBlocks', id));
export const getResources = () => read(server.resources);
export const saveResource = (r) => write('media', () => upsertIn('resources', r));
export const deleteResource = (id) => write('media', () => removeFrom('resources', id));

/* ── Live cards ── */
export const getLiveCardTemplates = () => read(server.liveTemplates);
export const saveLiveCardTemplate = (t) => write(null, () => upsertIn('liveTemplates', t));
export const deleteLiveCardTemplate = (id) => write(null, () => removeFrom('liveTemplates', id));
export const getLiveCard = () => read(server.liveCard);
export const pushLiveCard = (card) => write(null, () => {
  server.liveCard = clone(card);
  server.votes = {};
  return { ok: true };
});
export const clearLiveCard = () => write(null, () => { server.liveCard = null; server.votes = {}; return { ok: true }; });
export async function getLiveCardVotes() {
  // a poll on screen gathers a few votes between polls, so the tallies move
  const c = server.liveCard;
  if (c?.type === 'poll') {
    (c.options || []).forEach((_, i) => { server.votes[i] = (server.votes[i] || 0) + Math.floor(Math.random() * 3); });
  }
  return read({ votes: server.votes });
}

/* ── Live chat (read-only for moderation) ── */
const CHATTER = ['Amen!', 'Hello from the sample overflow room.', 'Great word this morning.', 'Praying with you all.', 'Can you turn the volume up a little?', 'Joining from out of town today.'];
export async function getChat() {
  // while live, someone says something every few polls
  if (server.livestream.isLive && Math.random() < 0.4 && server.chat.length < 80) {
    const n = server.chat.length + 1;
    server.chat.push({ id: `c${n}-${Date.now()}`, name: `Test Member ${(n % 9) + 1}`, text: CHATTER[n % CHATTER.length], at: new Date().toISOString() });
  }
  return read(server.chat);
}

/* ── Notifications: recorded here, never sent ── */
export const getPushCount = () => read({ count: server.pushCount });
export const sendNotification = (payload) => write(null, () => {
  server.sent.push({ ...clone(payload), at: new Date().toISOString() });
  console.info('[fixtures] Notification recorded, NOT sent:', payload?.title || '(no title)');
  return { ok: true, sent: server.pushCount, fixtures: true };
});

/* ── Settings & page blocks ── */
export const getSettings = () => read(server.settings);
export const putSettings = (s) => write(null, () => (server.settings = clone(s) || {}));
export const getPageBlocks = () => read(server.pageBlocks);
export const putPageBlocks = (b) => write(null, () => (server.pageBlocks = clone(b) || []));
export const getBlocks = () => read(server.blocks);
export const putBlocks = (b) => write(null, () => (server.blocks = clone(b) || []));

/* ── Ministry cards ── */
export const getMinistryCards = () => read(server.ministryCards);
export const saveMinistryCard = (c) => write(null, () => upsertIn('ministryCards', c));

/* ── Uploads ── */
/** A picture goes to the dev server's memory (see vite.config.js) and comes back as its address. */
export async function uploadImage(file) {
  await wait();
  if (FX.fail) throw new Error('Upload failed (fixtures: ?fx=fail)');
  try {
    const res = await fetch(`/__fixtures/upload?name=${encodeURIComponent(file?.name || 'picture')}`, {
      method: 'POST', headers: { 'Content-Type': file?.type || 'application/octet-stream' }, body: file,
    });
    const out = await res.json();
    if (!res.ok || !out?.path) throw new Error(out?.error || `Upload failed (${res.status})`);
    return `${globalThis.location.origin}${out.path}`;
  } catch {
    return pic(`upload-${Date.now()}`, 1600, 900);   // no dev server to hold it: a stand-in picture
  }
}

/** Video uploads would go to the church's Google bucket, so here they stop with a plain message. */
export async function getGcsSignedUrl() {
  await wait();
  throw new Error('Video uploads are off in fixtures — paste a video link instead.');
}
