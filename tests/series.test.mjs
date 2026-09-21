// Pillar's side of Series and Featured (Pillar/src/lib/mediaSeries.js): what a series may hold,
// what a save writes, what the Featured switch does — and that Pillar, the app and the database
// agree on the same two kinds of thing.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the app repo, for the checks that both sides agree
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

const calls = [];
let answer = { data: null, error: null };
const table = (name) => {
  const q = { _op: 'select', _row: null, _eq: null, _order: null };
  const done = () => { calls.push({ table: name, op: q._op, row: q._row, eq: q._eq, order: q._order }); return answer; };
  // every step is both chainable and awaitable, the way supabase-js behaves
  const chain = () => ({
    select: () => chain(),
    order: (c) => { q._order = c; return chain(); },
    eq: (k, v) => { q._eq = [k, v]; return chain(); },
    single: async () => done(),
    then: (res, rej) => Promise.resolve(done()).then(res, rej),
  });
  return {
    select: () => chain(),
    insert: (row) => { q._op = 'insert'; q._row = row; return chain(); },
    update: (row) => { q._op = 'update'; q._row = row; return chain(); },
    upsert: (row) => { q._op = 'upsert'; q._row = row; return chain(); },
    delete: () => { q._op = 'delete'; return chain(); },
  };
};
globalThis.__supabase = { from: table };
const src = fs.readFileSync(path.join(PILLAR, 'src/lib/mediaSeries.js'), 'utf8')
  .replace("import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;');
const out = path.join(OUT, 'mediaSeries.mjs');
fs.writeFileSync(out, src);
const lib = await import(pathToFileURL(out).href);
const { cleanItems, seriesProblems, seriesReady, seriesPatch, saveSeries, setFeatured, listSeries, notSetUp, SERIES_LIMITS, KINDS } = lib;

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

console.log('\n── what a series may hold ──');

await t('a series needs a name and at least one thing in it before it can go on Media', () => {
  assert.deepStrictEqual(seriesProblems({ name: 'Life of Moses' }), []);
  assert.ok(seriesProblems({ name: '   ' }).some((p) => /needs a name/.test(p)));
  assert.strictEqual(seriesReady({ name: 'Empty', items: [] }), false, 'nothing in it');
  assert.strictEqual(seriesReady({ name: 'Full', items: [{ id: '1', kind: 'sermon' }] }), true);
});

await t('a name or a line longer than the row can show is refused', () => {
  assert.deepStrictEqual(seriesProblems({ name: 'x'.repeat(SERIES_LIMITS.name) }), []);
  assert.strictEqual(seriesProblems({ name: 'x'.repeat(SERIES_LIMITS.name + 1) }).length, 1);
  assert.strictEqual(seriesProblems({ name: 'ok', subtitle: 'x'.repeat(SERIES_LIMITS.subtitle + 1) }).length, 1);
});

await t('a cover has to be a picture on the web', () => {
  assert.deepStrictEqual(seriesProblems({ name: 'ok', image_url: 'https://x.org/a.jpg' }), []);
  assert.strictEqual(seriesProblems({ name: 'ok', image_url: 'javascript:alert(1)' }).length, 1);
});

await t('sermons and videos both go in, once each, in order', () => {
  assert.deepStrictEqual(
    cleanItems([{ id: ' 1 ', kind: 'video' }, { id: '2', kind: 'sermon' }, { id: '1', kind: 'sermon' }, { id: '', kind: 'sermon' }, { id: '3', kind: 'nonsense' }, null]),
    [{ id: '1', kind: 'video' }, { id: '2', kind: 'sermon' }, { id: '3', kind: 'sermon' }]);
  assert.deepStrictEqual(KINDS, ['sermon', 'video']);
});

console.log('\n── saving one ──');

await t('a new series is inserted; an existing one is changed in place', async () => {
  calls.length = 0;
  answer = { data: { id: 'a', name: 'Moses', items: [] }, error: null };
  await saveSeries({ name: ' Moses ', subtitle: '', image_url: '', items: [{ id: '1', kind: 'sermon' }], published: true, sort: 10 });
  assert.strictEqual(calls[0].op, 'insert');
  assert.deepStrictEqual(calls[0].row, { name: 'Moses', subtitle: null, image_url: null, items: [{ id: '1', kind: 'sermon' }], published: true, sort: 10 });
  calls.length = 0;
  await saveSeries({ id: 'a', name: 'Moses', items: [], published: false });
  assert.strictEqual(calls[0].op, 'update');
  assert.deepStrictEqual(calls[0].eq, ['id', 'a']);
});

await t('a blank line or cover is stored as nothing at all', () => {
  assert.deepStrictEqual(seriesPatch({ name: ' A ', subtitle: '  ', image_url: '' }),
    { name: 'A', subtitle: null, image_url: null, items: [], published: false });
});

await t('the list comes back in the office’s order, cleaned', async () => {
  calls.length = 0;
  answer = { data: [{ id: 'a', name: 'A', items: [{ id: '1', kind: 'video' }, { id: '1', kind: 'sermon' }] }], error: null };
  const got = await listSeries();
  assert.strictEqual(calls[0].order, 'sort');
  assert.deepStrictEqual(got[0].items, [{ id: '1', kind: 'video' }], 'no repeats reach the page');
});

console.log('\n── the Featured switch ──');

await t('switching on writes one row; switching off takes it away', async () => {
  calls.length = 0;
  answer = { data: { item_id: '100', kind: 'sermon', sort: 10 }, error: null };
  await setFeatured('100', 'sermon', true, 10);
  assert.strictEqual(calls[0].op, 'upsert');
  assert.deepStrictEqual(calls[0].row, { item_id: '100', kind: 'sermon', sort: 10 });
  calls.length = 0;
  const gone = await setFeatured('100', 'sermon', false);
  assert.strictEqual(gone, null);
  assert.strictEqual(calls[0].op, 'delete');
  assert.deepStrictEqual(calls[0].eq, ['item_id', '100']);
});

await t('something that was never saved can’t be featured', async () => {
  calls.length = 0;
  await assert.rejects(() => setFeatured('', 'video', true), /save it first/i);
  assert.strictEqual(calls.length, 0, 'nothing was written');
});

await t('a kind the app doesn’t draw becomes a video, not a crash', async () => {
  calls.length = 0;
  answer = { data: {}, error: null };
  await setFeatured('7', 'nonsense', true);
  assert.strictEqual(calls[0].row.kind, 'video');
});

await t('before the migration is run, Pillar says which file to run', () => {
  assert.ok(notSetUp({ message: `relation "public.app_media_series" does not exist` }));
  assert.ok(notSetUp({ message: `Could not find the table 'public.app_media_featured' in the schema cache` }));
  assert.ok(!notSetUp({ message: 'new row violates row-level security policy' }));
});

console.log('\n── everyone agrees ──');

await t('Pillar, the app and the database mean the same two kinds', () => {
  const sql = fs.readFileSync(path.join(PILLAR, 'supabase/app-media-series.sql'), 'utf8');
  const inSql = /kind in \(([^)]*)\)/.exec(sql)[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
  assert.deepStrictEqual(inSql, [...KINDS].sort(), `the database: ${inSql}`);
  const appSrc = fs.readFileSync(path.join(APP, 'utils/mediaShelves.js'), 'utf8');
  const appKinds = JSON.parse(/const KINDS = (\[[^\]]*\])/.exec(appSrc)[1].replace(/'/g, '"')).sort();
  assert.deepStrictEqual(appKinds, [...KINDS].sort(), `the app: ${appKinds}`);
  // and the database won't take a name longer than Pillar's own limit
  assert.ok(sql.includes(`between 1 and ${SERIES_LIMITS.name}`), 'the name limit matches');
  assert.ok(sql.includes(`<= ${SERIES_LIMITS.subtitle}`), 'the subtitle limit matches');
});

await t('Watch has a Series view, and the old Featured tab is gone', () => {
  const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/WatchPage.jsx'), 'utf8');
  const tabs = /const TABS = \[([\s\S]*?)\];/.exec(page)[1];
  assert.ok(/key: 'series'/.test(tabs), 'a Series view');
  assert.ok(!/key: 'featured'/.test(tabs), 'no separate Featured view');
  assert.ok(/function FeaturedSwitch/.test(page), 'a switch instead');
  // both lists can be featured, and both can be put in a series
  assert.ok(/kind="sermon"/.test(page) && /kind="video"/.test(page));
  assert.ok(/Suggested for You/.test(page), 'the suggested row can still be set');
});

console.log(`\n${ok} series and featured checks passed`);
