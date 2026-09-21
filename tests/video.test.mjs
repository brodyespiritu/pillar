// Uploading a Home card's video from the computer: Pillar/api/media-check.js (the server-side
// "did it arrive?") and Pillar/src/lib/videoUpload.js (the upload itself — watched when Google allows,
// sent unwatched and checked when it doesn't).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

const BUCKET = 'https://storage.googleapis.com/bethesdaonline';
const LANDED = `${BUCKET}/sermons/1726500000000-abcdef012345.mp4`;

// ─────────────────────────────── api/media-check.js ───────────────────────────────
console.log('\n  — the server-side check —');
const STAFF = 'staff-token';
const heads = [];
let head = { status: 200, headers: { 'content-length': '529217', 'content-type': 'video/mp4' } };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) {
    const good = (opts.headers?.Authorization || '') === `Bearer ${STAFF}`;
    return { ok: good, json: async () => (good ? { id: 'u1' } : {}) };
  }
  if (u.includes('/rest/v1/staff')) return { ok: true, json: async () => [{ id: 'u1', active: staffActive }] };
  heads.push({ url: u, opts });
  if (head === 'down') throw new TypeError('fetch failed');
  const h = new Map(Object.entries(head.headers || {}));
  return { status: head.status, ok: head.status < 400, headers: { get: (k) => (h.has(k) ? h.get(k) : null) } };
};
let staffActive = true;
const { default: check } = await import(path.join(PILLAR, 'api/media-check.js'));
const call = async ({ body = { url: LANDED }, auth = `Bearer ${STAFF}`, method = 'POST' } = {}) => {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  await check({ method, headers: { authorization: auth }, body }, r);
  return r;
};

await t('staff learn whether the video arrived, and how big it is', async () => {
  heads.length = 0;
  const r = await call();
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(r.body, { ok: true, found: true, status: 200, size: 529217, type: 'video/mp4' });
  assert.strictEqual(heads.length, 1);
  assert.strictEqual(heads[0].url, LANDED);
  assert.strictEqual(heads[0].opts.method, 'HEAD', 'it only looks — nothing is downloaded');
  assert.strictEqual(heads[0].opts.redirect, 'error', 'and it follows no redirects');
});

await t('a missing video is "not found", and a missing length is unknown rather than zero', async () => {
  head = { status: 404, headers: {} };
  let r = await call();
  assert.deepStrictEqual([r.code, r.body.found, r.body.size], [200, false, null]);
  head = { status: 200, headers: { 'content-type': 'video/mp4' } };
  r = await call();
  assert.deepStrictEqual([r.body.found, r.body.size], [true, null]);
  head = 'down';
  r = await call();
  assert.strictEqual(r.code, 504);
  head = { status: 200, headers: { 'content-length': '10' } };
});

await t('only signed-in, active staff may ask', async () => {
  heads.length = 0;
  assert.strictEqual((await call({ auth: '' })).code, 401);
  assert.strictEqual((await call({ auth: 'Bearer someone-else' })).code, 401);
  staffActive = false;
  assert.strictEqual((await call()).code, 401);
  staffActive = true;
  assert.strictEqual((await call({ method: 'GET' })).code, 405);
  assert.strictEqual(heads.length, 0, 'nobody else gets a look');
});

await t('it looks only at the addresses the video signer makes — it is no general fetcher', async () => {
  heads.length = 0;
  const bad = [
    'https://example.org/video.mp4',
    'http://storage.googleapis.com/bethesdaonline/sermons/1726500000000-abcdef012345.mp4',
    'https://storage.googleapis.com/otherbucket/sermons/1726500000000-abcdef012345.mp4',
    'https://storage.googleapis.com/bethesdaonline/images/1726500000000-abcdef012345.jpg',
    'https://storage.googleapis.com/bethesdaonline/sermons/../private/secret.mp4',
    'https://storage.googleapis.com/bethesdaonline/sermons/1726500000000-abcdef012345.mp4?x=1',
    'https://storage.googleapis.com/bethesdaonline/sermons/1726500000000-abcdef012345.mp4#x',
    'https://storage.googleapis.com.evil.org/bethesdaonline/sermons/1726500000000-abcdef012345.mp4',
    'https://storage.googleapis.com/bethesdaonline/sermons/Wait Until Harvest.mp4',
    'https://storage.googleapis.com/bethesdaonline/sermons/1726500000000-ABCDEF012345.mp4',
    ` ${LANDED}`,
    `${LANDED}\n`,
    '', null, 42,
  ];
  for (const url of bad) {
    const r = await call({ body: { url } });
    assert.strictEqual(r.code, 400, `refused: ${JSON.stringify(url)}`);
  }
  assert.strictEqual((await call({ body: '{not json' })).code, 400);
  assert.strictEqual(heads.length, 0, 'none of those were fetched');
  // an extension-less upload is still one of ours
  assert.strictEqual((await call({ body: { url: `${BUCKET}/sermons/1726500000000-abcdef012345` } })).code, 200);
  // and a string body (Vercel hands some requests over unparsed) works like an object
  assert.strictEqual((await call({ body: JSON.stringify({ url: LANDED }) })).code, 200);
});

// ─────────────────────────────── src/lib/videoUpload.js ───────────────────────────────
console.log('\n  — the upload —');
let src = fs.readFileSync(path.join(PILLAR, 'src/lib/videoUpload.js'), 'utf8');
for (const [a, b] of [
  ["import { supabase } from './supabase';", 'const supabase = globalThis.__sb;'],
  ["import { getGcsSignedUrl } from './appApi';", 'const getGcsSignedUrl = (...a) => globalThis.__sign(...a);'],
]) { assert.ok(src.includes(a), a); src = src.replace(a, b); }
fs.writeFileSync(path.join(OUT, 'videoUpload.mjs'), src);

globalThis.__sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
const signs = [];
let signed = {
  uploadUrl: `${BUCKET}/`,
  fields: { key: 'sermons/1726500000000-abcdef012345.mp4', 'Content-Type': 'video/mp4', policy: 'p', 'x-goog-signature': 's' },
  publicUrl: LANDED,
};
globalThis.__sign = async (body) => { signs.push(body); if (signed instanceof Error) throw signed; return signed; };

// Google, as the page sees it
const xhrs = [];
let google = { watch: true, status: 204, stopAt: null };   // watch: false → the browser won't let the page watch
globalThis.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.status = 0; this.done = false; xhrs.push(this); }
  open(method, url) { this.method = method; this.url = url; }
  abort() { if (this.done) return; this.done = true; queueMicrotask(() => this.onabort?.()); }
  send(body) {
    this.body = body;
    // a page listening to upload progress makes the browser ask Google first (a CORS preflight)
    this.preflighted = typeof this.upload.onprogress === 'function';
    const plan = google;
    setTimeout(() => {
      if (this.done) return;
      if (!plan.watch && this.preflighted) { this.done = true; this.onerror?.(); return; }
      const total = 1000;
      for (const loaded of [250, 500, 1000]) {
        if (plan.stopAt === loaded) { this.done = true; this.onerror?.(); return; }
        this.upload.onprogress?.({ loaded, total, lengthComputable: true });
      }
      if (plan.stopAt === 'after') { this.done = true; this.onerror?.(); return; }   // sent, answer unreadable
      if (plan.hang) return;
      this.done = true; this.status = plan.status; this.onload?.();
    }, 1);
  }
};

const blind = [];                 // unwatched uploads Google received
let blindPlan = 'store';          // 'store' | 'lose' | 'offline' | 'hang'
let checkPlan = 'real';           // 'real' | 'no-server' | 401 | 500
let stored = new Map();           // url → size
const checks = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === '/api/media-check') {
    checks.push(JSON.parse(opts.body));
    assert.strictEqual(opts.headers.Authorization, 'Bearer tok', 'the check carries the staff session');
    if (checkPlan === 'no-server') return { ok: false, status: 404, json: async () => { throw new SyntaxError('html'); } };
    if (typeof checkPlan === 'number') return { ok: false, status: checkPlan, json: async () => ({ error: 'x' }) };
    const { url: asked } = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ ok: true, found: stored.has(asked), size: stored.get(asked) ?? null }) };
  }
  // an unwatched upload
  assert.strictEqual(opts.mode, 'no-cors', 'sent without asking to read the answer');
  assert.strictEqual(opts.method, 'POST');
  if (blindPlan === 'offline') throw new TypeError('Load failed');
  if (blindPlan === 'hang') {
    return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  }
  blind.push({ url: u, body: opts.body });
  const file = opts.body.get('file');
  if (blindPlan === 'store') stored.set(signed.publicUrl, file.size);
  return { type: 'opaque', status: 0, ok: false };
};

const V = await import(pathToFileURL(path.join(OUT, 'videoUpload.mjs')).href);
const clip = (name = 'Baptisms 2026.mp4', type = 'video/mp4', size = 1000) => new File([new Uint8Array(size)], name, { type });
const noWait = async () => {};
const reset = () => { xhrs.length = 0; blind.length = 0; checks.length = 0; signs.length = 0; stored = new Map();
  google = { watch: true, status: 204, stopAt: null }; blindPlan = 'store'; checkPlan = 'real'; V._resetWatch(); };

await t('what it takes: MP4, M4V and MOV — the videos phones and cameras make — up to 2 GB', () => {
  assert.deepStrictEqual(V.videoKind(clip('a.MP4', '')), { ext: 'mp4', type: 'video/mp4' });
  assert.deepStrictEqual(V.videoKind(clip('IMG_0042.MOV', 'video/quicktime')), { ext: 'mov', type: 'video/quicktime' });
  assert.deepStrictEqual(V.videoKind(clip('a.m4v', 'video/x-m4v')), { ext: 'm4v', type: 'video/mp4' });
  assert.deepStrictEqual(V.videoKind(clip('pasted', 'video/quicktime')), { ext: 'mov', type: 'video/quicktime' }, 'by type when the name says nothing');
  for (const [n, ty] of [['a.webm', 'video/webm'], ['a.avi', 'video/x-msvideo'], ['a.mkv', ''], ['notes.pdf', 'application/pdf'], ['a', '']]) {
    assert.strictEqual(V.videoKind(clip(n, ty)), null, n);
    assert.ok(/MP4 or MOV/.test(V.videoProblem(clip(n, ty))), n);
  }
  assert.ok(/empty/.test(V.videoProblem(clip('a.mp4', 'video/mp4', 0))));
  assert.ok(/over 2 GB/.test(V.videoProblem({ name: 'a.mp4', type: 'video/mp4', size: 2 * 1024 ** 3 + 1 })));
  assert.strictEqual(V.videoProblem({ name: 'a.mp4', type: 'video/mp4', size: 2 * 1024 ** 3 }), null);
  assert.strictEqual(V.videoProblem(null), 'No file chosen.');
  assert.ok(V.VIDEO_ACCEPT.includes('.mov') && V.VIDEO_ACCEPT.includes('video/mp4'));
});

await t('sizes read like people say them', () => {
  assert.strictEqual(V.formatBytes(529217), '517 KB');
  assert.strictEqual(V.formatBytes(5 * 1024 ** 2 + 300000), '5.3 MB');
  assert.strictEqual(V.formatBytes(84.2 * 1024 ** 2), '84 MB');
  assert.strictEqual(V.formatBytes(1.5 * 1024 ** 3), '1.50 GB');
  assert.strictEqual(V.formatBytes(-1), '');
});

await t('only a video file gets a preview player', () => {
  assert.ok(V.isVideoFile(LANDED));
  assert.ok(V.isVideoFile('https://x.org/a.MOV?dl=1'));
  for (const u of ['https://youtu.be/abc', 'https://x.org/live.m3u8', 'http://x.org/a.mp4', 'javascript:a.mp4', '', null]) {
    assert.ok(!V.isVideoFile(u), String(u));
  }
});

await t('watched: a progress bar all the way up, and the address it landed at', async () => {
  reset();
  const seen = [];
  const r = await V.uploadVideo(clip(), { onProgress: (p) => seen.push(p) });
  assert.deepStrictEqual(r, { url: LANDED });
  assert.deepStrictEqual(seen, [0.25, 0.5, 1]);
  assert.deepStrictEqual(signs, [{ filename: 'video.mp4', contentType: 'video/mp4' }], 'a plain name — the member\'s file name never leaves');
  const x = xhrs[0];
  assert.strictEqual(x.method, 'POST');
  assert.strictEqual(x.url, `${BUCKET}/`);
  const keys = [...x.body.keys()];
  assert.deepStrictEqual(keys, ['key', 'Content-Type', 'policy', 'x-goog-signature', 'file'], 'the signed fields, then the file');
  assert.strictEqual(x.body.get('file').name, 'Baptisms 2026.mp4');
  assert.strictEqual(checks.length, 0, 'Google said yes — nothing to check');
});

await t('a MOV is signed as QuickTime', async () => {
  reset();
  signed = { ...signed, fields: { ...signed.fields, 'Content-Type': 'video/quicktime' } };
  await V.uploadVideo(clip('IMG_0042.MOV', 'video/quicktime'));
  assert.deepStrictEqual(signs, [{ filename: 'video.mov', contentType: 'video/quicktime' }]);
  signed = { ...signed, fields: { ...signed.fields, 'Content-Type': 'video/mp4' } };
});

await t('unwatched: Google won\'t let the page watch, so it goes anyway and Pillar checks it arrived', async () => {
  reset();
  google.watch = false;
  const seen = [];
  const r = await V.uploadVideo(clip('clip.mp4', 'video/mp4', 4321), { onProgress: (p) => seen.push(p), pause: noWait });
  assert.deepStrictEqual(r, { url: LANDED });
  assert.deepStrictEqual(seen, [null], 'the bar says "working", not a number');
  assert.strictEqual(blind.length, 1);
  assert.strictEqual(blind[0].url, `${BUCKET}/`);
  assert.deepStrictEqual([...blind[0].body.keys()].at(-1), 'file');
  assert.deepStrictEqual(checks, [{ url: LANDED }]);
});

await t('once Google has refused, the next upload doesn\'t ask again (no error in the console each time)', async () => {
  reset();
  google.watch = false;
  await V.uploadVideo(clip(), { pause: noWait });
  assert.strictEqual(xhrs.length, 1, 'the first upload asked');
  const seen = [];
  const r = await V.uploadVideo(clip(), { pause: noWait, onProgress: (p) => seen.push(p) });
  assert.deepStrictEqual(r, { url: LANDED });
  assert.strictEqual(xhrs.length, 1, 'the second went straight to the unwatched upload');
  assert.deepStrictEqual(seen, [null]);
  assert.strictEqual(blind.length, 2);
});

await t('unwatched, and it never arrived: said plainly, after asking a few times', async () => {
  reset();
  google.watch = false;
  blindPlan = 'lose';
  const pauses = [];
  const r = await V.uploadVideo(clip(), { pause: async (ms) => { pauses.push(ms); } });
  assert.ok(/didn’t arrive/.test(r.error), r.error);
  assert.strictEqual(r.url, undefined);
  assert.strictEqual(checks.length, 3);
  assert.deepStrictEqual(pauses, [1500, 4000]);
});

await t('unwatched, and a different size arrived: not accepted', async () => {
  reset();
  google.watch = false;
  blindPlan = 'lose';
  stored.set(LANDED, 999);   // something else is there
  const r = await V.uploadVideo(clip('a.mp4', 'video/mp4', 1000), { pause: noWait });
  assert.ok(r.error, JSON.stringify(r));
});

await t('unwatched and offline: said plainly, nothing checked', async () => {
  reset();
  google.watch = false;
  blindPlan = 'offline';
  const r = await V.uploadVideo(clip(), { pause: noWait });
  assert.ok(/didn’t go through/.test(r.error), r.error);
  assert.strictEqual(checks.length, 0);
});

await t('where nothing can check (a plain dev server, or signed out), it is kept but marked unconfirmed', async () => {
  for (const plan of ['no-server', 401]) {
    reset();
    google.watch = false;
    checkPlan = plan;
    const r = await V.uploadVideo(clip(), { pause: noWait });
    assert.deepStrictEqual(r, { url: LANDED, unconfirmed: true }, String(plan));
    assert.strictEqual(checks.length, 1, 'asked once, then stopped asking');
  }
});

await t('a check that fails outright is asked again', async () => {
  reset();
  google.watch = false;
  checkPlan = 500;
  const r = await V.uploadVideo(clip(), { pause: noWait });
  assert.ok(r.error);
  assert.strictEqual(checks.length, 3);
});

await t('watched, all sent, but the answer unreadable: checked rather than called a failure', async () => {
  reset();
  google.stopAt = 'after';
  stored.set(LANDED, 1000);
  const r = await V.uploadVideo(clip('a.mp4', 'video/mp4', 1000), { pause: noWait });
  assert.deepStrictEqual(r, { url: LANDED });
  assert.strictEqual(blind.length, 0, 'not sent twice');
  assert.strictEqual(checks.length, 1);
});

await t('watched, and the connection broke part-way: an error, and no second copy sent', async () => {
  reset();
  google.stopAt = 500;
  const r = await V.uploadVideo(clip(), { pause: noWait });
  assert.ok(/part-way/.test(r.error), r.error);
  assert.strictEqual(blind.length, 0);
  assert.strictEqual(checks.length, 0);
});

await t('Google says no: the reason, in words', async () => {
  reset();
  google.status = 403;
  let r = await V.uploadVideo(clip());
  assert.ok(/expired/.test(r.error), r.error);
  reset();
  google.status = 400;
  r = await V.uploadVideo(clip());
  assert.ok(/\(400\)/.test(r.error), r.error);
});

await t('cancel works before, during a watched upload, and during an unwatched one', async () => {
  reset();
  let c = new AbortController(); c.abort();
  let r = await V.uploadVideo(clip(), { signal: c.signal });
  assert.deepStrictEqual(r, { error: V.CANCELLED, cancelled: true });
  assert.strictEqual(xhrs.length, 0, 'nothing sent');

  reset();
  google.hang = true;
  c = new AbortController();
  const p = V.uploadVideo(clip(), { signal: c.signal });
  await new Promise((x) => setTimeout(x, 10));
  c.abort();
  r = await p;
  assert.deepStrictEqual(r, { error: V.CANCELLED, cancelled: true });

  reset();
  google.watch = false;
  blindPlan = 'hang';
  c = new AbortController();
  const q = V.uploadVideo(clip(), { signal: c.signal, pause: noWait });
  await new Promise((x) => setTimeout(x, 10));
  c.abort();
  r = await q;
  assert.deepStrictEqual(r, { error: V.CANCELLED, cancelled: true });
  assert.strictEqual(checks.length, 0);
});

await t('a file the app can\'t play is refused before anything is signed or sent', async () => {
  reset();
  const r = await V.uploadVideo(clip('talk.webm', 'video/webm'));
  assert.ok(/MP4 or MOV/.test(r.error));
  assert.strictEqual(signs.length + xhrs.length, 0);
});

await t('an upload address that isn\'t the church\'s bucket is refused', async () => {
  const real = signed;
  for (const bad of [
    { ...real, uploadUrl: 'https://evil.example/upload' },
    { ...real, uploadUrl: 'https://storage.googleapis.com/otherbucket/' },
    { ...real, publicUrl: 'https://evil.example/x.mp4' },
    { ...real, publicUrl: 'https://storage.googleapis.com/bethesdaonline/sermons/a b.mp4' },
    { ...real, fields: null },
    null,
  ]) {
    reset();
    signed = bad;
    const r = await V.uploadVideo(clip());
    assert.ok(/doesn’t recognise/.test(r.error), JSON.stringify(bad));
    assert.strictEqual(xhrs.length + blind.length, 0, 'nothing sent');
  }
  reset();
  signed = new Error('The app server didn\'t answer.');
  const r = await V.uploadVideo(clip());
  assert.strictEqual(r.error, 'Couldn’t start the upload: The app server didn\'t answer.');
  signed = real;
});

// ─────────────────────────────── the form ───────────────────────────────
console.log('\n  — the card form —');
const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/HomePage.jsx'), 'utf8');
const kit = fs.readFileSync(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'utf8');
const lib = fs.readFileSync(path.join(PILLAR, 'src/lib/homeCards.js'), 'utf8');

await t('a video card takes a file (chosen or dropped) or a pasted link, and asks for one or the other', () => {
  assert.ok(kit.includes('accept={VIDEO_ACCEPT}') && /Choose a video/.test(kit) && /Drop a video here/.test(kit));
  assert.ok(/onDrop=\{\(e\) => \{ e\.preventDefault\(\); setOver\(false\); take\(fileFrom\(e\)\); \}\}/.test(kit), 'a dropped file uploads');
  assert.ok(/paste a link/.test(kit));
  assert.ok(/A video card needs a video — upload one or paste a link\./.test(lib));
  assert.ok(/f\.kind === 'video' && \([\s\S]*<VideoDrop/.test(page), 'the Home editor uses it for video cards');
  // the video comes before the picture it opens on
  assert.ok(page.indexOf('<VideoDrop') < page.indexOf("'Picture before it plays'"));
});

await t('an upload in progress can\'t be lost by accident', () => {
  assert.ok(/beforeunload/.test(kit.slice(kit.indexOf('export function VideoDrop'))), 'leaving the page asks first');
  assert.ok(/useEffect\(\(\) => \(\) => \{ stop\.current\?\.abort\(\);/.test(kit), 'a closed editor stops its upload');
  assert.ok(/Stop uploading this video\?/.test(kit), 'cancelling asks first');
  assert.ok(/uploading\.current && !\(await ask\('A video is still uploading\. Stop it and open another card\?'\)\)/.test(page),
    'picking another card asks first');
  assert.ok(/if \(busyRef\) busyRef\.current = !!up;/.test(kit), 'the page knows while one is uploading');
});

await t('the still only becomes the picture when the card has none — even if one was added meanwhile', () => {
  assert.ok(/if \(rows\.get\(key\)\?\.image_url\) return;/.test(page));
  assert.ok(/rows\.patch\(key, \(r\) => \(r\.image_url \? \{\} : \{ image_url: pic\.url \}\)\)/.test(page));
});

console.log(`\n${ok} video-upload checks passed`);
