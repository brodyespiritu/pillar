// Reports from testers, on Pillar's Home (Pillar/src/lib/appReports.js): what is asked for, how a
// message is pulled apart, and what closing one out does — checked against the very message the
// app's test kit builds, so the two can't drift apart.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the app repo, for the checks that both sides agree
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

const calls = [];
let answer = { data: [], error: null };
const table = (name) => {
  const q = { op: 'select', row: null, filters: [], likes: [], order: null, limit: null };
  const done = () => { calls.push({ table: name, ...q }); return answer; };
  const chain = () => ({
    select: () => chain(),
    like: (c, p) => { q.likes.push([c, p]); return chain(); },
    is: (c, v) => { q.filters.push(['is', c, v]); return chain(); },
    eq: (c, v) => { q.filters.push(['eq', c, v]); return chain(); },
    order: (c, o) => { q.order = [c, o]; return chain(); },
    limit: (n) => { q.limit = n; return chain(); },
    single: async () => done(),
    then: (res, rej) => Promise.resolve(done()).then(res, rej),
  });
  return {
    select: () => chain(),
    update: (row) => { q.op = 'update'; q.row = row; return chain(); },
  };
};
const rpcs = [];
let rpcAnswer = { data: 'reply-1', error: null };
globalThis.__supabase = { from: table, rpc: async (name, args) => { rpcs.push({ name, args }); return rpcAnswer; } };

const load = async (repo, file, out, replace) => {
  let src = fs.readFileSync(path.join(repo, file), 'utf8');
  for (const [a, b] of replace) { assert.ok(src.includes(a), `${file}: ${a}`); src = src.replace(a, b); }
  const to = path.join(OUT, out);
  fs.writeFileSync(to, src);
  return import(pathToFileURL(to).href);
};

const lib = await load(PILLAR, 'src/lib/appReports.js', 'appReports.mjs', [
  ["import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;'],
]);
// the app's own side of the wire
const kit = await load(APP, 'components/testkit/report.js', 'kitReport.mjs', [
  ["import { Platform } from 'react-native';", "const Platform = { OS: 'ios', Version: '18.0' };"],
  // the build number now rides along in a report (BethesdaApp utils/updateNotice.js versionLabel, 2026-09-23)
  ["import { versionLabel } from '../../utils/updateNotice';", "const versionLabel = () => 'Version 1.0.0 (15)';"],
  ["import * as ImagePicker from 'expo-image-picker';", 'const ImagePicker = {};'],
  ["import { captureScreen, captureRef } from 'react-native-view-shot';", 'const captureScreen = null, captureRef = null;'],
  ["import Constants from 'expo-constants';", "const Constants = { expoConfig: { version: '1.0.0' } };"],
  ["import { getServerUrl } from '../../screens/Admin/adminStorage';", 'const getServerUrl = () => "";'],
]);

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

console.log('\n── what Pillar asks for ──');

await t('only what testers sent, only what is still open, newest first', async () => {
  calls.length = 0;
  answer = { data: [], error: null };
  await lib.fetchReports();
  const c = calls[0];
  assert.strictEqual(c.table, 'member_access_requests');
  assert.deepStrictEqual(c.likes, [['message', '[TEST]%']], 'a tester’s, not someone asking the office for access');
  assert.deepStrictEqual(c.filters, [['is', 'handled_at', null]], 'not the ones already closed out');
  assert.deepStrictEqual(c.order, ['created_at', { ascending: false }]);
  assert.strictEqual(c.limit, 500, 'every open one — the panel shows four, and all of them on request');
});

await t('"See all" is a real button, and it shows every report (user, 2026-09-23: "I cant click")', () => {
  const src = fs.readFileSync(path.join(PILLAR, 'src/pages/home/AppReports.jsx'), 'utf8');
  assert.match(src, /<button type="button" className="ar-more" onClick=\{\(\) => setAll\(\(v\) => !v\)\}\s+aria-expanded=\{all\} aria-controls="ar-list">/);
  assert.match(src, /const shown = all \? rows : rows\.slice\(0, FEW\);/);
  assert.match(src, /\{all \? 'Show fewer' : `See all \$\{rows\.length\}`\}/);
  assert.ok(!/<div className="ar-more">/.test(src), 'not plain text any more');
  const css = fs.readFileSync(path.join(PILLAR, 'src/pages/home/AppReports.css'), 'utf8');
  assert.match(css, /\.ar-list\.all \{ max-height: min\(60vh, 560px\); overflow-y: auto;/, 'a long list scrolls inside the panel');
  assert.match(css, /\.ar-more \{[^}]*min-height: 38px;[^}]*cursor: pointer;/);
});

await t('closing one out marks it handled, by whoever closed it', async () => {
  calls.length = 0;
  answer = { data: null, error: null };
  await lib.closeReport('r1', 'staff-9');
  const c = calls[0];
  assert.strictEqual(c.op, 'update');
  assert.ok(c.row.handled_at, 'the time it was dealt with');
  assert.strictEqual(c.row.handled_by, 'staff-9');
  assert.deepStrictEqual(c.filters, [['eq', 'id', 'r1']]);
});

console.log('\n── the app and Pillar agree on the message ──');

await t('a bug report comes apart exactly as the app put it together', () => {
  const message = `${'[TEST] Bug'}: ${kit.body({
    kind: 'bug',
    words: 'The Groups page came up empty after I tapped Connect.',
    link: 'https://storage.googleapis.com/bethesdaonline/images/1-a.jpg',
    screen: 'Groups',
    user: 'Sample Tester',
  })}`;
  const r = lib.parseReport({ id: 'r1', name: 'Sample Tester', contact: 'a@b.org', message, created_at: new Date().toISOString() });
  assert.strictEqual(r.kind, 'bug');
  assert.strictEqual(r.words, 'The Groups page came up empty after I tapped Connect.', r.words);
  assert.strictEqual(r.link, 'https://storage.googleapis.com/bethesdaonline/images/1-a.jpg');
  assert.strictEqual(r.facts.screen, 'Groups', JSON.stringify(r.facts));
  assert.strictEqual(r.facts.phone, 'ios 18.0');
  assert.strictEqual(r.facts.app, '1.0.0 (15)');   // the build rides along since 2026-09-23 (who is on an old build)
  assert.strictEqual(r.facts['signed in as'], 'Sample Tester');
  assert.ok(r.facts.when, 'and when they sent it');
  assert.strictEqual(r.from, 'Sample Tester');
});

await t('a report carries the sending phone\'s reply code, so Implemented can answer it there (2026-09-24)', () => {
  const code = 'Ab3dEfGh1jKlMn0pQrStUv-_';
  const message = `[TEST] Bug: ${kit.body({ words: 'Watch froze.', screen: 'Sermons', code })}`;
  const r = lib.parseReport({ id: 'r9', message, created_at: new Date().toISOString() });
  assert.strictEqual(r.canReply, true);
  assert.strictEqual(r.facts['reply code'], code);
  assert.strictEqual(r.words, 'Watch froze.', 'the code never lands in the words');
  const older = lib.parseReport({ id: 'r10', message: `[TEST] Bug: ${kit.body({ words: 'Old build.', screen: 'Home' })}`, created_at: new Date().toISOString() });
  assert.strictEqual(older.canReply, false, 'an older build sent none');
  const card = fs.readFileSync(path.join(PILLAR, 'src/pages/home/AppReports.jsx'), 'utf8');
  assert.ok(!/reply code/i.test(card.slice(card.indexOf('<dl className="ar-facts">'), card.indexOf('</dl>'))), 'the card never shows the code');
});

await t('Implemented sends the office\'s words to that phone and closes the report (supabase/app-report-replies.sql)', async () => {
  rpcs.length = 0;
  rpcAnswer = { data: 'reply-1', error: null };
  const id = await lib.replyToReport('r9', { message: '  The Watch page opens straight away now.  ', kind: 'fixed', said: 'Watch froze.' });
  assert.strictEqual(id, 'reply-1');
  assert.deepStrictEqual(rpcs[0], { name: 'app_report_reply', args: {
    p_request: 'r9', p_message: 'The Watch page opens straight away now.', p_kind: 'fixed', p_said: 'Watch froze.' } });
  await lib.replyToReport('r9', { message: 'x', kind: 'anything' });
  assert.strictEqual(rpcs[1].args.p_kind, 'fixed', 'only fixed or added');
  rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.app_report_reply' } };
  await assert.rejects(lib.replyToReport('r9', { message: 'x' }), /run supabase\/app-report-replies\.sql/);
  rpcAnswer = { data: null, error: { code: 'P0001', message: 'This report came from an older version of the app, so a reply can\'t reach their phone.' } };
  await assert.rejects(lib.replyToReport('r9', { message: 'x' }), /older version of the app/);
});

await t('the card: a third button, Implemented — a type box, the card their phone will show, Send', () => {
  const src = fs.readFileSync(path.join(PILLAR, 'src/pages/home/AppReports.jsx'), 'utf8');
  const foot = src.slice(src.indexOf('{!open.canReply ? ('), src.indexOf('</>\n            )}'));
  assert.deepStrictEqual([...foot.matchAll(/className="(ar-plain|ar-keep|ar-done)"/g)].map((m) => m[1]), ['ar-plain', 'ar-keep', 'ar-done'],
    'Keep it, Close it out, then Implemented — the one filled button');
  assert.match(foot, /<Icon d=\{P\.check\} size=\{17\} \/>Implemented/);
  assert.match(foot, /disabled=\{busy \|\| !open\.canReply\}/, 'not for a report an older build sent');
  assert.match(src, /<textarea id="ar-impl-text" className="ar-impl-text" rows=\{4\} maxLength=\{MAX\} autoFocus/);
  assert.match(src, /\[\['fixed', 'Bug fixed'\], \['added', 'Idea added'\]\]/);
  assert.match(src, /const CARD_TITLE = \{ fixed: 'Your bug is fixed', added: 'Your idea is in the app' \};/);
  assert.match(src, /await replyToReport\(open\.id, \{ message: words, kind: replyKind, said: open\.words \}\);/);
  assert.match(src, /\{busy \? 'Sending…' : 'Send to their phone'\}/);
  // the app's card says exactly what the preview says
  const appCard = fs.readFileSync(path.join(APP, 'components/testkit/ReplyCard.js'), 'utf8');
  assert.ok(appCard.includes("'Your idea is in the app' : 'Your bug is fixed'"), 'same titles on the phone');
});

await t('praise is told apart from a bug', () => {
  const message = `[TEST] Praise: ${kit.body({ words: 'The sermon page is lovely.', screen: 'Sermons' })}`;
  const r = lib.parseReport({ id: 'r2', message, created_at: new Date().toISOString() });
  assert.strictEqual(r.kind, 'praise');
  assert.strictEqual(r.words, 'The sermon page is lovely.');
  assert.strictEqual(r.link, '', 'no picture with it');
});

await t('a report with no picture and nothing written still reads', () => {
  const r = lib.parseReport({ id: 'r3', message: '[TEST] Bug: ', created_at: new Date().toISOString() });
  assert.strictEqual(r.words, '');
  assert.strictEqual(r.link, '');
  assert.deepStrictEqual(r.facts, {});
});

await t('an attachment that never made it is flagged, not left in the words', () => {
  const message = `[TEST] Bug: ${kit.body({ words: 'Something went wrong on Give.', lost: true, screen: 'Give' })}`;
  const r = lib.parseReport({ id: 'r4', message, created_at: new Date().toISOString() });
  assert.strictEqual(r.words, 'Something went wrong on Give.', r.words);
  assert.strictEqual(r.lost, true, 'Pillar says so instead');
  assert.strictEqual(r.link, '');
});

await t('a recording is known from a picture, so one plays and the other is shown', () => {
  assert.strictEqual(lib.isVideo('https://x.org/sermons/1-a.mp4'), true);
  assert.strictEqual(lib.isVideo('https://x.org/a.MOV'), true);
  assert.strictEqual(lib.isVideo('https://x.org/images/1-a.jpg'), false);
  const v = lib.parseReport({ id: 'v', message: '[TEST] Bug: x\n\nWhat it looks like: https://x.org/a.mp4', created_at: new Date().toISOString() });
  assert.strictEqual(v.video, true);
});

await t('someone asking the office for access is not a report', () => {
  const rows = [{ message: 'Please add my email, I’m new.' }];
  assert.ok(!rows[0].message.startsWith('[TEST]'), 'the filter Pillar sends would leave it alone');
});

console.log('\n── who sees them ──');

await t('only the tester running the test', () => {
  assert.strictEqual(lib.isTheTester({ name: 'Brody Espiritu' }), true);
  assert.strictEqual(lib.isTheTester({ name: ' brody espiritu ' }), true);
  // however the staff row happens to spell it — an exact match would just hide the panel silently
  assert.strictEqual(lib.isTheTester({ name: 'Brody' }), true);
  assert.strictEqual(lib.isTheTester({ name: 'Brody E.' }), true);
  assert.strictEqual(lib.isTheTester({ name: 'Someone Else' }), false);
  assert.strictEqual(lib.isTheTester({ name: 'Brodyn Smith' }), false, 'and not someone who merely starts the same');
  assert.strictEqual(lib.isTheTester(null), false);
});

await t('“4 min ago”, not a timestamp', () => {
  const ago = (mins) => lib.sinceLabel(new Date(Date.now() - mins * 60000).toISOString());
  assert.strictEqual(ago(0), 'just now');
  assert.strictEqual(ago(4), '4 min ago');
  assert.strictEqual(ago(90), '2 hours ago');
  assert.strictEqual(ago(60 * 26), '1 day ago');
  assert.strictEqual(lib.sinceLabel('nonsense'), '');
});

console.log('\n── it comes out cleanly ──');

await t('Home is the only page that mounts it — on a computer and on a phone — and it says so', () => {
  const home = fs.readFileSync(path.join(PILLAR, 'src/pages/home/HomePage.jsx'), 'utf8');
  assert.strictEqual(home.split('\n').filter((l) => /TESTING —/.test(l)).length, 2, 'both lines marked');
  // the phone's Home too (user, 2026-09-21: "make sure I can see it in pillar"): the import and the mount
  const phone = fs.readFileSync(path.join(PILLAR, 'src/pages/home/HomeMobile.jsx'), 'utf8');
  assert.strictEqual(phone.split('\n').filter((l) => /TESTING —/.test(l)).length, 2, 'both lines marked on the phone');
  const css = fs.readFileSync(path.join(PILLAR, 'src/pages/home/HomeMobile.css'), 'utf8');
  assert.ok(css.split('\n').filter((l) => /\.ar\b/.test(l)).every((l) => /TESTING/.test(l)), 'and its one style line');
  const users = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { walk(f); return; }
    if (!/\.jsx?$/.test(e.name)) return;
    const rel = path.relative(PILLAR, f);
    if (/appreports/i.test(e.name) || /AppReports|appReports/.test(fs.readFileSync(f, 'utf8'))) users.push(rel);
  });
  walk(path.join(PILLAR, 'src'));
  assert.deepStrictEqual(users.sort(), [
    'src/lib/appReports.js', 'src/pages/home/AppReports.jsx', 'src/pages/home/HomeMobile.jsx', 'src/pages/home/HomePage.jsx',
  ], `nothing else knows about it: ${users}`);
});

console.log(`\n${ok} tester-report checks passed`);
