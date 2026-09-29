// Prayer requests from the app, on Pillar's Home (Pillar/src/lib/prayerRequests.js): what Pillar asks
// the office's inbox for, how a request is pulled apart, and what closing one out does — checked
// against the very message the app sends, so the two can't drift apart.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

const calls = [];
let answer = { data: [], error: null };
const table = (name) => {
  const q = { op: 'select', row: null, filters: [], likes: [], order: null, limit: null };
  const done = () => { calls.push({ table: name, ...q }); return answer; };
  const chain = () => ({
    select: () => chain(),
    ilike: (c, p) => { q.likes.push([c, p]); return chain(); },
    is: (c, v) => { q.filters.push(['is', c, v]); return chain(); },
    eq: (c, v) => { q.filters.push(['eq', c, v]); return chain(); },
    order: (c, o) => { q.order = [c, o]; return chain(); },
    limit: (n) => { q.limit = n; return chain(); },
    then: (res, rej) => Promise.resolve(done()).then(res, rej),
  });
  return { select: () => chain(), update: (row) => { q.op = 'update'; q.row = row; return chain(); } };
};
globalThis.__supabase = { from: table };

const load = async (repo, file, out, replace) => {
  let src = fs.readFileSync(path.join(repo, file), 'utf8');
  for (const [a, b] of replace) { assert.ok(src.includes(a), `${file}: ${a}`); src = src.replace(a, b); }
  const to = path.join(OUT, out);
  fs.writeFileSync(to, src);
  return import(pathToFileURL(to).href);
};

const lib = await load(PILLAR, 'src/lib/prayerRequests.js', 'prayerRequests.mjs', [
  ["import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;'],
]);

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

console.log('\n── what Pillar asks for ──');

await t('only prayer requests, only the ones still waiting, newest first', async () => {
  calls.length = 0;
  answer = { data: [], error: null };
  await lib.fetchPrayerRequests();
  const c = calls[0];
  assert.strictEqual(c.table, 'member_access_requests', 'the office’s own inbox — nothing new to set up');
  assert.deepStrictEqual(c.likes, [['message', 'Prayer request:%']], 'not a tester’s report, nor someone asking for access');
  assert.deepStrictEqual(c.filters, [['is', 'handled_at', null]], 'not the ones already prayed for');
  assert.deepStrictEqual(c.order, ['created_at', { ascending: false }]);
  assert.strictEqual(c.limit, 20);
});

await t('closing one out marks it handled, by whoever closed it', async () => {
  calls.length = 0;
  answer = { data: null, error: null };
  await lib.closePrayerRequest('p1', 'staff-3');
  const c = calls[0];
  assert.strictEqual(c.op, 'update');
  assert.ok(c.row.handled_at, 'the time it was dealt with');
  assert.strictEqual(c.row.handled_by, 'staff-3');
  assert.deepStrictEqual(c.filters, [['eq', 'id', 'p1']]);
});

console.log('\n── the app writes it, Pillar reads it ──');

await t('the app’s own prefix comes off, and the rest is what they asked for', () => {
  // the app sends prefix + what they typed (BethesdaApp components/PrayerRequestSheet.js →
  // components/OfficeMessageForm.js), with their name and contact in their own columns
  const sheet = fs.readFileSync(path.join(APP, 'components/PrayerRequestSheet.js'), 'utf8');
  const prefix = /prefix="([^"]+)"/.exec(sheet)[1];
  assert.strictEqual(prefix, 'Prayer request: ', 'the marker Pillar looks for');
  const row = {
    id: 'p2', name: 'Rae Hill', contact: 'rae@x.org', created_at: new Date().toISOString(),
    message: `${prefix}Please pray for my mother's surgery on Tuesday.`,
  };
  const p = lib.parsePrayer(row);
  assert.strictEqual(p.words, "Please pray for my mother's surgery on Tuesday.", 'just what they wrote');
  assert.deepStrictEqual([p.from, p.contact, p.id], ['Rae Hill', 'rae@x.org', 'p2']);
});

await t('nothing written still reads as a request', () => {
  const p = lib.parsePrayer({ id: 'p3', name: '', contact: '', message: 'Prayer request:', created_at: null });
  assert.deepStrictEqual([p.words, p.from, p.contact], ['', '', '']);
});

await t('Home shows it, on the phone and on a desktop', () => {
  for (const f of ['src/pages/home/HomePage.jsx', 'src/pages/home/HomeMobile.jsx']) {
    const src = fs.readFileSync(path.join(PILLAR, f), 'utf8');
    assert.ok(/import PrayerRequests from '\.\/PrayerRequests';/.test(src), `${f}: imported`);
    assert.ok(/<PrayerRequests \/>/.test(src), `${f}: on the page`);
  }
  const panel = fs.readFileSync(path.join(PILLAR, 'src/pages/home/PrayerRequests.jsx'), 'utf8');
  assert.ok(/if \(!rows \|\| rows\.length === 0\) return null;/.test(panel), 'and only while one is waiting');
});

console.log(`\n${ok} prayer-request checks passed`);
