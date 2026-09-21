import { supabase } from './supabase';
import { getGcsSignedUrl } from './appApi';

// Videos from the computer, into the church's video storage: the Google Cloud bucket the sermon
// videos already live in (bethesdaonline), through a one-hour upload form the app server signs
// (bethesda-admin /api/gcs-signed-url, up to 2 GB). The app plays what lands there in its own player.
//
// The file goes from this browser straight to Google — Pillar's own server can't carry anything that
// big. Google lets a page watch the upload (the progress bar) only when the bucket's CORS settings
// list Pillar's address. Without that the upload is sent anyway, unwatched, and Pillar's server checks
// afterwards that the file arrived whole (api/media-check.js).

// what the app's player (AVPlayer, through expo-video) plays, by extension
export const VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime' };
const TYPE_EXT = { 'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov' };
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/x-m4v,.mp4,.m4v,.mov';
export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;   // the signer's own limit

// where the signer's form posts (@google-cloud/storage's path-style address) and where the file lands
const UPLOAD_TO = /^https:\/\/storage\.googleapis\.com\/bethesdaonline\/?$/;
const LANDS_AT = /^https:\/\/storage\.googleapis\.com\/bethesdaonline\/sermons\/[A-Za-z0-9._-]+$/;

export const CANCELLED = 'Upload cancelled.';

// Once Google has refused to let this page watch an upload, don't ask again until Pillar reloads:
// the refusal is the bucket's CORS setting, and every attempt leaves an error in the console.
let watchable = true;
export const _resetWatch = () => { watchable = true; };   // for tests

/** How a file would be uploaded — { ext, type } — or null if the app couldn't play it. */
export function videoKind(file) {
  const ext = /\.([a-z0-9]+)$/.exec(String(file?.name || '').toLowerCase())?.[1];
  if (ext && VIDEO_TYPES[ext]) return { ext, type: VIDEO_TYPES[ext] };
  // no telling extension (a pasted or renamed file): go by what the browser says it is
  const byType = TYPE_EXT[String(file?.type || '').toLowerCase()];
  return byType ? { ext: byType, type: VIDEO_TYPES[byType] } : null;
}

/** Why this file can't be uploaded, or null. */
export function videoProblem(file) {
  if (!file) return 'No file chosen.';
  if (!videoKind(file)) return 'Choose an MP4 or MOV video — the kind phones and most cameras save.';
  if (!file.size) return 'That file is empty.';
  if (file.size > MAX_VIDEO_BYTES) return 'That video is over 2 GB. Trim it or export it smaller, then try again.';
  return null;
}

/** 84.2 MB */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Whether a link is a video file the upload could have made (worth a <video> preview). */
export const isVideoFile = (url) => /^https:\/\/[^\s?#]+\.(mp4|m4v|mov)(\?[^\s#]*)?$/i.test(String(url || ''));

/* ── moving the index to the front ──────────────────────────────────────────────────────────────
 *
 * An MP4 or MOV keeps its index (the `moov` box: where every frame is) either at the front or at
 * the very end. Cameras, phones and screen recorders usually write it at the END, because they only
 * know the whole picture when recording stops. A player streaming such a file over the web has to
 * fetch the tail before it can start, and then keeps reaching for parts it hasn't got — which is
 * why a video uploaded straight from a camera starts, stops, starts again (user, 2026-09-17).
 *
 * So Pillar moves the index to the front before sending the file — the "fast start" layout. Nothing
 * is re-encoded: the same bytes go up in a different order, with the frame positions inside the
 * index shifted by the size of the index. Only the index is read into memory; the media itself is
 * sent straight from disk. Anything unexpected and the file goes as it is.
 */
const CONTAINER = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);
const MAX_INDEX = 96 * 1024 * 1024;   // an index bigger than this stays where it is

/** The top-level boxes of an MP4/MOV, or null if it doesn't read like one. */
async function boxes(file) {
  const out = [];
  let at = 0;
  while (at + 8 <= file.size) {
    const head = new DataView(await file.slice(at, Math.min(at + 16, file.size)).arrayBuffer());
    if (head.byteLength < 8) return null;
    let size = head.getUint32(0);
    let header = 8;
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (size === 1) {
      if (head.byteLength < 16) return null;
      size = Number(head.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = file.size - at;   // the last box runs to the end
    }
    if (size < header || at + size > file.size) return null;
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
    out.push({ type, at, size });
    at += size;
    if (out.length > 64) return null;
  }
  return at === file.size ? out : null;
}

/** Shift every frame position in the index by `delta`. False if it holds something unexpected. */
function shiftIndex(bytes, delta) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const name = (at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  let ok = true;
  const walk = (start, end) => {
    let at = start;
    while (ok && at + 8 <= end) {
      let size = view.getUint32(at);
      let header = 8;
      const type = name(at + 4);
      if (size === 1) { size = Number(view.getBigUint64(at + 8)); header = 16; }
      else if (size === 0) size = end - at;
      if (size < header || at + size > end) { ok = false; return; }
      if (type === 'cmov') { ok = false; return; }        // a compressed index: leave the file alone
      if (type === 'stco' || type === 'co64') {
        const count = view.getUint32(at + header + 4);
        const wide = type === 'co64';
        let p = at + header + 8;
        if (p + count * (wide ? 8 : 4) > at + size) { ok = false; return; }
        for (let i = 0; i < count; i += 1) {
          if (wide) { view.setBigUint64(p, view.getBigUint64(p) + BigInt(delta)); p += 8; }
          else {
            const moved = view.getUint32(p) + delta;
            if (moved > 0xffffffff) { ok = false; return; }
            view.setUint32(p, moved);
            p += 4;
          }
        }
      } else if (CONTAINER.has(type)) {
        walk(at + header, at + size);
      }
      at += size;
    }
  };
  walk(0, bytes.byteLength);
  return ok;
}

/**
 * What the file actually is: how long, how big on screen, in what format, and how many megabits a
 * second a player has to pull to keep up. Null if it can't be read.
 */
export async function videoFacts(file) {
  try {
    const list = await boxes(file);
    if (!list) return null;
    const moov = list.find((b) => b.type === 'moov');
    if (!moov || moov.size > MAX_INDEX) return null;
    const bytes = new Uint8Array(await file.slice(moov.at, moov.at + moov.size).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const name = (at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    const facts = { seconds: null, width: 0, height: 0, codec: '', bitrate: null };
    const walk = (start, end) => {
      let at = start;
      while (at + 8 <= end) {
        let size = view.getUint32(at);
        let header = 8;
        const type = name(at + 4);
        if (size === 1) { size = Number(view.getBigUint64(at + 8)); header = 16; }
        else if (size === 0) size = end - at;
        if (size < header || at + size > end) return;
        if (type === 'mvhd') {
          const wide = view.getUint8(at + header) === 1;
          const scale = view.getUint32(at + header + (wide ? 20 : 12));
          const length = wide ? Number(view.getBigUint64(at + header + 24)) : view.getUint32(at + header + 16);
          if (scale > 0 && length > 0) facts.seconds = length / scale;
        } else if (type === 'stsd' && at + header + 16 <= end) {
          const entry = at + header + 8;
          const format = name(entry + 4);
          // a picture track carries its size on screen; a sound track doesn't
          if (['avc1', 'hvc1', 'hev1', 'av01', 'mp4v'].includes(format) && entry + 36 <= end) {
            facts.codec = format;
            facts.width = view.getUint16(entry + 32);
            facts.height = view.getUint16(entry + 34);
          }
        } else if (CONTAINER.has(type)) {
          walk(at + header, at + size);
        }
        at += size;
      }
    };
    walk(0, bytes.byteLength);
    if (facts.seconds) facts.bitrate = Math.round((file.size * 8) / facts.seconds);
    return facts.seconds || facts.width ? facts : null;
  } catch {
    return null;
  }
}

// What phones can actually keep up with. A church video at 1080p sits around 4–8; a camera or screen
// recording straight off a Mac or iPhone can be 30 and more, and then the video stops and starts
// however it is stored (user, 2026-09-17).
export const EASY_BITRATE = 8_000_000;
export const EASY_HEIGHT = 1080;

/** Would this video make phones wait? */
export const tooHeavy = (facts) => !!facts
  && ((facts.bitrate && facts.bitrate > EASY_BITRATE) || Math.max(facts.width, facts.height) > 1920);

/** "1440p HEVC, 1:15, about 30 Mbps" */
export function describeVideo(facts) {
  if (!facts) return '';
  const size = facts.height ? `${facts.height}p` : '';
  const codec = { hvc1: 'HEVC', hev1: 'HEVC', avc1: 'H.264', av01: 'AV1' }[facts.codec] || '';
  const length = facts.seconds ? `${Math.floor(facts.seconds / 60)}:${String(Math.round(facts.seconds % 60)).padStart(2, '0')}` : '';
  const mbps = facts.bitrate ? facts.bitrate / 1_000_000 : 0;
  const rate = mbps ? `about ${mbps >= 10 ? Math.round(mbps) : mbps.toFixed(1)} Mbps` : '';
  return [[size, codec].filter(Boolean).join(' '), length, rate].filter(Boolean).join(', ');
}

/**
 * The same video with its index first, so it plays as it arrives. Returns the file untouched when
 * it is already that way, isn't a plain MP4/MOV, or anything doesn't add up.
 */
export async function faststart(file) {
  try {
    const list = await boxes(file);
    if (!list) return file;
    const types = list.map((b) => b.type);
    if (types.includes('moof')) return file;                    // already written for streaming
    const index = list.findIndex((b) => b.type === 'moov');
    const media = list.findIndex((b) => b.type === 'mdat');
    if (index < 0 || media < 0 || index < media) return file;   // no index to move, or it leads already
    if (types.filter((t) => t === 'moov').length !== 1) return file;
    const moov = list[index];
    if (moov.size > MAX_INDEX) return file;
    const bytes = new Uint8Array(await file.slice(moov.at, moov.at + moov.size).arrayBuffer());
    if (!shiftIndex(bytes, moov.size)) return file;
    const parts = [];
    list.forEach((b, i) => { if (i < media && b.type !== 'moov') parts.push(file.slice(b.at, b.at + b.size)); });
    parts.push(bytes);
    list.forEach((b, i) => { if (i >= media && b.type !== 'moov') parts.push(file.slice(b.at, b.at + b.size)); });
    const moved = new File(parts, file.name, { type: file.type });
    return moved.size === file.size ? moved : file;             // same bytes, new order — or not at all
  } catch {
    return file;
  }
}

async function staffToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch { return null; }
}

// Send the form where the page can watch it. 'done' / 'refused' (Google answered no) / 'broken'
// (the connection failed part-way) / 'sent-unread' (all of it went, but the answer couldn't be read)
// / 'unwatched' (Google wouldn't let the page watch, so nothing was sent) / 'cancelled'.
function sendWatched(url, body, { onProgress, signal }) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let sent = 0;
    let total = 0;
    const abort = () => xhr.abort();
    const finish = (v) => { signal?.removeEventListener('abort', abort); resolve(v); };
    xhr.upload.onprogress = (e) => {
      sent = e.loaded;
      if (e.lengthComputable) { total = e.total; onProgress?.(Math.min(1, e.loaded / e.total)); }
    };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? 'done' : { refused: xhr.status });
    // before any of the file has gone, an error is the browser refusing to let the page watch
    const failed = () => finish(sent === 0 ? 'unwatched' : total && sent >= total ? 'sent-unread' : 'broken');
    xhr.onerror = failed;
    xhr.ontimeout = failed;
    xhr.onabort = () => finish('cancelled');
    signal?.addEventListener('abort', abort);
    xhr.open('POST', url);
    xhr.send(body);
  });
}

// Did the file arrive, whole? true / false, or null when nothing here can tell (a plain dev server).
async function arrived(url, size, { signal, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (const wait of [0, 1500, 4000]) {
    if (signal?.aborted) return false;
    if (wait) await pause(wait);
    let res;
    try {
      res = await fetch('/api/media-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await staffToken()}` },
        body: JSON.stringify({ url }),
      });
    } catch { continue; }
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object' || !('ok' in data || 'error' in data)) return null;   // no Pillar server here
    if (res.status >= 400 && res.status < 500) return null;   // signed out, or an address it won't check: can't tell
    if (!res.ok || !data.ok) continue;                         // the check itself failed: ask again
    if (data.found) return data.size == null || data.size === size;
  }
  return false;
}

/**
 * Upload a video. Resolves { url } — plus `unconfirmed: true` when nothing could check it arrived —
 * or { error } (with `cancelled: true` when `signal` stopped it). Never throws.
 *
 * `onProgress(fraction)` reports 0–1 while Google lets the page watch, then `onProgress(null)` if the
 * upload has to go unwatched. (`pause` replaces the waits between arrival checks, for tests.)
 */
export async function uploadVideo(file, { onProgress, signal, pause } = {}) {
  const problem = videoProblem(file);
  if (problem) return { error: problem };
  const { ext, type } = videoKind(file);

  let signed;
  try {
    // a plain name: the signer keeps only the extension, and the check above knows exactly what it makes
    signed = await getGcsSignedUrl({ filename: `video.${ext}`, contentType: type });
  } catch (e) {
    return { error: `Couldn’t start the upload: ${e.message}` };
  }
  const { uploadUrl, fields, publicUrl } = signed || {};
  if (!UPLOAD_TO.test(String(uploadUrl)) || !LANDS_AT.test(String(publicUrl)) || !fields || typeof fields !== 'object') {
    return { error: 'The app server sent back an upload address Pillar doesn’t recognise.' };
  }
  if (signal?.aborted) return { error: CANCELLED, cancelled: true };

  // a camera writes the index last; move it to the front so the video plays as it arrives
  const body = await faststart(file);
  const form = () => {
    const f = new FormData();
    Object.entries(fields).forEach(([k, v]) => f.append(k, v));
    f.append('file', body);   // last: Google reads the signed fields before the file
    return f;
  };

  let watched = 'unwatched';
  if (watchable) {
    watched = await sendWatched(uploadUrl, form(), { onProgress, signal });
    if (watched === 'unwatched') watchable = false;
  }
  if (watched === 'done') return { url: publicUrl };
  if (watched === 'cancelled') return { error: CANCELLED, cancelled: true };
  if (watched?.refused) {
    return { error: watched.refused === 403
      ? 'Google refused the upload — the upload form may have expired. Try again.'
      : `Google refused the upload (${watched.refused}). Try again.` };
  }
  if (watched === 'broken') return { error: 'The upload stopped part-way. Check the connection and try again.' };

  if (watched === 'unwatched') {
    // no progress to show: send it anyway, then ask whether it arrived
    onProgress?.(null);
    try {
      await fetch(uploadUrl, { method: 'POST', body: form(), mode: 'no-cors', signal });
    } catch {
      if (signal?.aborted) return { error: CANCELLED, cancelled: true };
      return { error: 'The upload didn’t go through. Check the connection and try again.' };
    }
  }

  const ok = await arrived(publicUrl, file.size, { signal, ...(pause ? { pause } : {}) });
  if (signal?.aborted) return { error: CANCELLED, cancelled: true };
  if (ok === true) return { url: publicUrl };
  if (ok === null) return { url: publicUrl, unconfirmed: true };
  return { error: 'The video didn’t arrive. Try again — a long video on a slow connection may need a smaller export.' };
}

/**
 * A still from the video — about a second in — as a JPEG, to use as the card's picture. Null when
 * this browser can't read the video (the upload doesn't depend on it).
 */
export function videoStill(file, { at = 1, maxEdge = 1600, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    let url;
    try { url = URL.createObjectURL(file); } catch { resolve(null); return; }
    const v = document.createElement('video');
    let done = false;
    const finish = (blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      try { v.load(); } catch { /* already gone */ }
      URL.revokeObjectURL(url);
      resolve(blob || null);
    };
    const timer = setTimeout(() => finish(null), timeout);
    const draw = () => {
      const w0 = v.videoWidth, h0 = v.videoHeight;
      if (!w0 || !h0) return finish(null);
      const scale = Math.min(1, maxEdge / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w0 * scale);
      canvas.height = Math.round(h0 * scale);
      try {
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b), 'image/jpeg', 0.82);
      } catch { finish(null); }
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      if (d > 0) v.currentTime = Math.min(at, d / 2);
    };
    v.onseeked = draw;
    // a video with no length to seek in: take its first frame
    v.onloadeddata = () => { if (!(Number.isFinite(v.duration) && v.duration > 0)) draw(); };
    v.onerror = () => finish(null);
    v.src = url;
  });
}
