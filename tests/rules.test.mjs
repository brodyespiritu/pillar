// Pillar's side of the Home cards and instant updates (Pillar/src/lib/homeCards.js, appRefresh.js):
// the form's rules, what a save writes, what the list says about each card, which app-server saves
// tell phones — and that Pillar, the app and the database agree on every list they share.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the app repo, for the checks that both sides agree
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

// the rules under test don't touch the network; the calls that do get a recording stand-in
const rpcCalls = [];
let rpcAnswer = { error: null };
globalThis.__supabase = {
  rpc: async (name, args) => { rpcCalls.push({ name, args }); if (rpcAnswer instanceof Error) throw rpcAnswer; return rpcAnswer; },
};
const load = async (file, replace) => {
  let src = fs.readFileSync(path.join(PILLAR, 'src/lib', file), 'utf8');
  for (const [a, b] of replace) { assert.ok(src.includes(a), `${file}: ${a}`); src = src.replace(a, b); }
  const out = path.join(OUT, file.replace(/\.js$/, '.mjs'));
  fs.writeFileSync(out, src);
  return import(pathToFileURL(out).href);
};
const cards = await load('homeCards.js', [
  ["import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;'],
  ["import { downscaleImage } from './locations';", 'const downscaleImage = null;'],
]);
const refresh = await load('appRefresh.js', [["import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;']]);
const { cardProblems, cardPatch, liveLabel, isLive, churchDay, KINDS, BUILT_IN, AUDIENCES, ACTIONS, PAGES, LIMITS } = cards;

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };
const card = (o) => ({ kind: 'text', audience: 'everyone', title: 'Room change', buttons: [], ...o });

await t('each kind asks only for what it needs', () => {
  assert.deepStrictEqual(cardProblems(card({})), []);
  assert.ok(cardProblems(card({ title: '  ' })).some((p) => /title/.test(p)));
  assert.ok(cardProblems(card({ kind: 'image' })).some((p) => /needs a picture/.test(p)));
  assert.deepStrictEqual(cardProblems(card({ kind: 'image', image_url: 'https://x.org/p.jpg' })), []);
  assert.ok(cardProblems(card({ kind: 'video', image_url: 'https://x.org/p.jpg' })).some((p) => /needs a video — upload one or paste a link/.test(p)));
  assert.deepStrictEqual(cardProblems(card({ kind: 'video', video_url: 'https://youtu.be/x' })), [], 'a video may go without a picture');
  assert.deepStrictEqual(cardProblems({ kind: 'dinner' }), [], 'the plate card needs nothing written');
  assert.deepStrictEqual(cardProblems({ kind: 'welcome', audience: 'signed_out' }), []);
  assert.ok(cardProblems(card({ kind: 'poster' })).some((p) => /what kind/.test(p)));
});

await t('what a hidden field still holds never blocks a save', () => {
  // switched from a picture card with a button to the plate card: nothing left over is a problem
  assert.deepStrictEqual(cardProblems({ kind: 'dinner', image_url: 'not a url', video_url: 'nope',
    buttons: [{ label: '', action: 'url', target: 'javascript:1' }] }), []);
  // a words card doesn't use a picture, so a leftover bad one isn't its problem either
  assert.deepStrictEqual(cardProblems(card({ image_url: 'not a url' })), []);
});

await t('a button is a label and one of four known actions, and only where it can work', () => {
  const b = (x) => card({ buttons: [{ label: 'Go', action: 'url', target: 'https://x.org', ...x }] });
  assert.deepStrictEqual(cardProblems(b({})), []);
  for (const bad of ['javascript:alert(1)', 'mailto:a@b.c', 'x.org', '/bulletin', 'https://x.org/a b']) {
    assert.ok(cardProblems(b({ target: bad })).some((p) => /https:\/\//.test(p)), `${bad} refused`);
  }
  assert.ok(cardProblems(b({ label: ' ' })).some((p) => /needs a label/.test(p)));
  assert.ok(cardProblems(b({ label: 'x'.repeat(25) })).some((p) => /24 characters/.test(p)));
  assert.ok(cardProblems(b({ action: 'delete' })).some((p) => /something to do/.test(p)));
  assert.ok(cardProblems(b({ action: 'page', target: 'Admin' })).some((p) => /page to open/.test(p)));
  assert.deepStrictEqual(cardProblems(b({ action: 'page', target: 'Bulletin' })), []);
  assert.deepStrictEqual(cardProblems(b({ action: 'plate', target: '' })), []);
  assert.ok(cardProblems(b({ action: 'video' })).some((p) => /isn't a video card/.test(p)));
  assert.deepStrictEqual(cardProblems(card({ kind: 'video', video_url: 'https://youtu.be/x',
    buttons: [{ label: 'Watch', action: 'video' }] })), []);
  const three = card({ buttons: [1, 2, 3].map((i) => ({ label: `B${i}`, action: 'plate' })) });
  assert.ok(cardProblems(three).some((p) => /2 buttons at most/.test(p)));
});

await t('the end can’t come before the start', () => {
  assert.ok(cardProblems(card({ starts_on: '2026-09-20', ends_on: '2026-09-19' })).some((p) => /end date/.test(p)));
  assert.deepStrictEqual(cardProblems(card({ starts_on: '2026-09-20', ends_on: '2026-09-20' })), []);
});

await t('a save writes only what the kind uses', () => {
  const full = {
    kind: 'dinner', audience: 'signed_in', kicker: 'k', title: 't', subtitle: 's', body: 'b',
    image_url: 'https://x.org/p.jpg', video_url: 'https://youtu.be/x', buttons: [{ label: 'Go', action: 'plate' }],
    starts_on: '', ends_on: '', published: true, sort: '20',
  };
  const dinner = cardPatch(full);
  assert.deepStrictEqual([dinner.kicker, dinner.title, dinner.subtitle, dinner.body, dinner.image_url, dinner.video_url],
    [null, null, null, null, null, null], 'the app draws its own card');
  assert.deepStrictEqual(dinner.buttons, []);
  assert.strictEqual(dinner.sort, 20);
  assert.strictEqual(dinner.starts_on, null);
  const text = cardPatch({ ...full, kind: 'text' });
  assert.strictEqual(text.body, 'b'); assert.strictEqual(text.image_url, null); assert.strictEqual(text.video_url, null);
  const image = cardPatch({ ...full, kind: 'image' });
  assert.strictEqual(image.body, null); assert.strictEqual(image.image_url, 'https://x.org/p.jpg'); assert.strictEqual(image.video_url, null);
  const video = cardPatch({ ...full, kind: 'video' });
  assert.strictEqual(video.video_url, 'https://youtu.be/x'); assert.strictEqual(video.image_url, 'https://x.org/p.jpg');
});

await t('a save tidies what was typed', () => {
  const p = cardPatch(card({
    audience: 'staff', title: '  Room change  ', subtitle: '   ', published: undefined,
    buttons: [
      { label: ' Map ', action: 'url', target: ' https://x.org/map ' },
      { label: 'Plate', action: 'plate', target: 'leftover' },
    ],
  }));
  assert.strictEqual(p.audience, 'everyone', 'an unknown audience falls back to everyone');
  assert.strictEqual(p.title, 'Room change');
  assert.strictEqual(p.subtitle, null, 'blank is nothing');
  assert.strictEqual(p.published, true, 'new cards go live unless marked draft');
  assert.deepStrictEqual(p.buttons, [
    { label: 'Map', action: 'url', target: 'https://x.org/map' },
    { label: 'Plate', action: 'plate' },
  ], 'a target is kept only where the action uses one');
});

await t('the list says why a card is or isn’t on phones — by the church’s date', () => {
  const noon = new Date('2026-09-17T16:00:00Z');         // Thursday noon in Georgia
  assert.strictEqual(liveLabel({ published: false }, noon), 'Draft');
  assert.strictEqual(liveLabel({ published: true }, noon), 'Live');
  assert.strictEqual(liveLabel({ published: true, starts_on: '2026-09-18' }, noon), 'Starts 2026-09-18');
  assert.strictEqual(liveLabel({ published: true, ends_on: '2026-09-16' }, noon), 'Ended 2026-09-16');
  assert.strictEqual(liveLabel({ published: true, starts_on: '2026-09-17', ends_on: '2026-09-17' }, noon), 'Live');
  // 10:30 pm Thursday in Georgia is already Friday in UTC — the card that ends Thursday is still up
  const lateThursday = new Date('2026-09-18T02:30:00Z');
  assert.strictEqual(churchDay(lateThursday), '2026-09-17');
  assert.strictEqual(liveLabel({ published: true, ends_on: '2026-09-17' }, lateThursday), 'Live');
  assert.strictEqual(liveLabel({ published: true, starts_on: '2026-09-18' }, lateThursday), 'Starts 2026-09-18');
  assert.ok(isLive({ published: true }, noon) && !isLive({ published: false }, noon));
});

// ── the three places that must agree ──
const sql = fs.readFileSync(path.join(PILLAR, 'supabase/app-home-cards.sql'), 'utf8');
const liveSql = fs.readFileSync(path.join(PILLAR, 'supabase/app-live-updates.sql'), 'utf8');
const appCards = fs.readFileSync(path.join(APP, 'utils/homeCards.js'), 'utf8');
const appLive = fs.readFileSync(path.join(APP, 'utils/liveUpdates.js'), 'utf8');
const quoted = (s) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const from = i + a.length; return s.slice(from, s.indexOf(b, from)); };

await t('Pillar, the app and the database name the same kinds, audiences, actions and pages', () => {
  assert.deepStrictEqual(KINDS.map((k) => k.key), quoted(between(sql, 'check (kind in (', ')')));
  assert.deepStrictEqual([...BUILT_IN].sort(), ['dinner', 'welcome']);
  assert.deepStrictEqual(AUDIENCES.map((a) => a.key), quoted(between(sql, 'check (audience in (', ')')));
  assert.deepStrictEqual(ACTIONS.map((a) => a.key), quoted(between(sql, "coalesce(b ->> 'action', '') not in (", ')')));
  const sqlPages = quoted(/'action' = 'page'[\s\S]*?not in\s*\(([^)]*)\)/.exec(sql)[1]);
  assert.deepStrictEqual(PAGES.map((p) => p.key), sqlPages);
  assert.deepStrictEqual(PAGES.map((p) => p.key), quoted(between(appCards, 'export const PAGES = [', ']')));
  assert.deepStrictEqual(KINDS.map((k) => k.key), quoted(between(appCards, 'export const KINDS = [', ']')));
  assert.deepStrictEqual(AUDIENCES.map((a) => a.key), quoted(between(appCards, 'export const AUDIENCES = [', ']')));
});

await t('…and the same limits', () => {
  for (const k of ['kicker', 'title', 'subtitle', 'body']) {
    const m = new RegExp(`char_length\\(${k}\\)\\s*<=\\s*(\\d+)`).exec(sql);
    assert.ok(m, k);
    assert.strictEqual(LIMITS[k], Number(m[1]), k);
  }
  assert.strictEqual(LIMITS.label, Number(/char_length\(b ->> 'label'\) > (\d+)/.exec(sql)[1]));
  assert.strictEqual(LIMITS.buttons, Number(/jsonb_array_length\(v\) <= (\d+)/.exec(sql)[1]));
  assert.ok(/\.slice\(0, 2\)/.test(appCards), 'the app draws two buttons at most too');
});

await t('every page a button may open is a page the app has', () => {
  const appJs = fs.readFileSync(path.join(APP, 'App.js'), 'utf8');
  for (const p of PAGES) assert.ok(new RegExp(`name="${p.key}"`).test(appJs), `${p.key} is a screen`);
});

console.log('\n  — instant updates —');

await t('the kinds of content agree: Pillar, the app, the database', () => {
  const fromSql = quoted(between(liveSql, 'check (part in (', ')'));
  assert.deepStrictEqual(refresh.APP_PARTS, fromSql);
  assert.deepStrictEqual(refresh.APP_PARTS, quoted(between(appLive, 'export const PARTS = [', ']')));
  assert.deepStrictEqual(quoted(between(liveSql, 'unnest(array[', ']')), fromSql, 'and each has its row');
});

await t('a save to the app server tells phones only when phones show what it changed', () => {
  const f = refresh.partForPath;
  assert.strictEqual(f('/api/announcements'), 'announcements');
  assert.strictEqual(f('/api/announcements/171234'), 'announcements');
  assert.strictEqual(f('/api/sermons'), 'sermons');
  assert.strictEqual(f('/api/sermons/9'), 'sermons');
  for (const p of ['/api/media-layout', '/api/custom-blocks', '/api/custom-blocks/3', '/api/resources', '/api/resources/1']) {
    assert.strictEqual(f(p), 'media', p);
  }
  assert.strictEqual(f('/api/livestream'), 'live');
  for (const p of ['/api/live-card', '/api/live-card/votes', '/api/chat', '/api/notifications/send', '/api/settings',
    '/api/blocks', '/api/page-blocks', '/api/events', '/api/push-tokens/count', '/api/sermonsX', '/api/upload', '', null]) {
    assert.strictEqual(f(p), null, String(p));
  }
});

await t('telling phones asks the database, and never throws at the office', async () => {
  rpcCalls.length = 0;
  assert.strictEqual(await refresh.touchApp('bulletin'), false, 'an unknown kind is not sent');
  assert.strictEqual(rpcCalls.length, 0);
  rpcAnswer = { error: null };
  assert.strictEqual(await refresh.touchApp('announcements'), true);
  assert.deepStrictEqual(rpcCalls, [{ name: 'app_touch', args: { p: 'announcements' } }]);
  rpcAnswer = { error: { message: 'permission denied' } };
  assert.strictEqual(await refresh.touchApp('sermons'), false);
  rpcAnswer = new Error('network');
  assert.strictEqual(await refresh.touchApp('live'), false);
  rpcAnswer = { error: null };
});

await t('every app-server write goes through the one place that tells phones', () => {
  const api = fs.readFileSync(path.join(PILLAR, 'src/lib/appApi.js'), 'utf8');
  assert.ok(/async function req\(path, opts = \{\}\) \{\s*const data = await send\(path, opts\);/.test(api), 'req sends, then tells');
  assert.ok(/if \(part\) touchApp\(part\);/.test(api), 'without waiting on it');
  const direct = [...api.matchAll(/=>\s*send\(/g)];
  assert.strictEqual(direct.length, 0, 'no export skips req');
});

console.log(`\n${ok} Pillar rule checks passed`);
