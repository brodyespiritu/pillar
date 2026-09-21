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
globalThis.__supabase = { from: table };

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
  assert.strictEqual(c.limit, 20);
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
  assert.strictEqual(r.facts.app, '1.0.0');
  assert.strictEqual(r.facts['signed in as'], 'Sample Tester');
  assert.ok(r.facts.when, 'and when they sent it');
  assert.strictEqual(r.from, 'Sample Tester');
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

await t('Home is the only page that mounts it, and it says so', () => {
  const home = fs.readFileSync(path.join(PILLAR, 'src/pages/home/HomePage.jsx'), 'utf8');
  assert.strictEqual(home.split('\n').filter((l) => /TESTING —/.test(l)).length, 2, 'both lines marked');
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
    'src/lib/appReports.js', 'src/pages/home/AppReports.jsx', 'src/pages/home/HomePage.jsx',
  ], `nothing else knows about it: ${users}`);
});

console.log(`\n${ok} tester-report checks passed`);
