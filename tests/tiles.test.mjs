// Pillar's side of the two new things (Pillar/src/lib/homeTiles.js and calendar.js):
// what the office may write into Home's four boxes, what clearing one does, what a featured event
// saves — and that Pillar, the app and the database agree on the same four boxes and the same limits.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the app repo, for the checks that both sides agree
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

// a recording stand-in for the database: each call says what it was asked and answers as told
const calls = [];
let answer = { data: null, error: null };
const table = (name) => {
  const q = { _t: name, _op: null, _row: null, _eq: null };
  const done = () => { calls.push({ table: name, op: q._op, row: q._row, eq: q._eq }); return answer; };
  q.select = () => ({ ...q, single: async () => done(), then: (r) => Promise.resolve(done()).then(r) });
  q.insert = (row) => { q._op = 'insert'; q._row = row; return q; };
  q.update = (row) => { q._op = 'update'; q._row = row; return q; };
  q.upsert = (row) => { q._op = 'upsert'; q._row = row; return q; };
  q.delete = () => { q._op = 'delete'; return q; };
  q.eq = (k, v) => { q._eq = [k, v]; if (q._op === 'delete') return Promise.resolve(done()); return q; };
  return q;
};
globalThis.__supabase = { from: table, rpc: async () => ({ error: null }) };
const load = async (file, replace) => {
  let src = fs.readFileSync(path.join(PILLAR, 'src/lib', file), 'utf8');
  for (const [a, b] of replace) { assert.ok(src.includes(a), `${file}: ${a}`); src = src.replace(a, b); }
  const out = path.join(OUT, file.replace(/\.js$/, '.mjs'));
  fs.writeFileSync(out, src);
  return import(pathToFileURL(out).href);
};
const tiles = await load('homeTiles.js', [
  ["import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;'],
  ["import { uploadCardImage } from './homeCards';", 'const uploadCardImage = async () => ({});'],
]);
const cal = await load('calendar.js', [
  ["import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;'],
  ["import { downscaleImage } from './locations';", 'const downscaleImage = null;'],
]);
const { SLOTS, TILE_LIMITS, tileProblems, tilePatch, saveTile } = tiles;

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

console.log('\n── the four boxes ──');

await t('the office may write a word and a line into any of the four', () => {
  for (const s of SLOTS) assert.deepStrictEqual(tileProblems({ slot: s.slot, title: 'Hello', subtitle: 'Come in' }), []);
  assert.ok(tileProblems({ slot: 'give', title: 'x' }).some((p) => /one of the four/.test(p)));
});

await t('a box says what fits on a phone, and nothing longer', () => {
  assert.deepStrictEqual(tileProblems({ slot: 'prayer', title: 'x'.repeat(TILE_LIMITS.title) }), []);
  assert.ok(tileProblems({ slot: 'prayer', title: 'x'.repeat(TILE_LIMITS.title + 1) }).length === 1);
  assert.deepStrictEqual(tileProblems({ slot: 'prayer', subtitle: 'x'.repeat(TILE_LIMITS.subtitle) }), []);
  assert.ok(tileProblems({ slot: 'prayer', subtitle: 'x'.repeat(TILE_LIMITS.subtitle + 1) }).length === 1);
});

await t('a picture has to be a picture on the web', () => {
  assert.deepStrictEqual(tileProblems({ slot: 'post', image_url: 'https://x.org/a.jpg' }), []);
  assert.ok(tileProblems({ slot: 'post', image_url: 'javascript:alert(1)' }).length === 1);
  assert.deepStrictEqual(tileProblems({ slot: 'post', image_url: '' }), [], 'no picture is fine');
});

await t('blank means the app’s own words — not an empty box', async () => {
  assert.deepStrictEqual(tilePatch({ slot: 'connect', title: '  ', subtitle: '', image_url: null }),
    { slot: 'connect', title: null, subtitle: null, image_url: null });
  calls.length = 0; answer = { data: null, error: null };
  const gone = await saveTile({ slot: 'connect', title: '', subtitle: '   ', image_url: '' });
  assert.strictEqual(gone, null);
  assert.deepStrictEqual(calls.map((c) => [c.table, c.op]), [['app_home_tiles', 'delete']], JSON.stringify(calls));
  assert.deepStrictEqual(calls[0].eq, ['slot', 'connect']);
});

await t('a box with anything in it is written once, by slot', async () => {
  calls.length = 0;
  answer = { data: { slot: 'prayer', title: 'Pray', subtitle: null, image_url: null }, error: null };
  const row = await saveTile({ slot: 'prayer', title: ' Pray ', subtitle: '', image_url: '' });
  assert.strictEqual(row.title, 'Pray');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].op, 'upsert');
  assert.deepStrictEqual(calls[0].row, { slot: 'prayer', title: 'Pray', subtitle: null, image_url: null });
});

await t('Pillar, the app and the database all mean the same four boxes', () => {
  const mine = SLOTS.map((s) => s.slot);
  const appSrc = fs.readFileSync(path.join(APP, 'utils/homeTiles.js'), 'utf8');
  const appSlots = JSON.parse(/export const SLOTS = (\[[^\]]*\])/.exec(appSrc)[1].replace(/'/g, '"'));
  assert.deepStrictEqual(appSlots, mine, `the app: ${appSlots}`);
  const sql = fs.readFileSync(path.join(PILLAR, 'supabase/app-home-tiles.sql'), 'utf8');
  const inSql = /slot in \(([^)]*)\)/.exec(sql)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepStrictEqual(inSql.sort(), [...mine].sort(), `the database: ${inSql}`);
  // and the words Pillar shows as the app's are the words the app actually uses
  const comp = fs.readFileSync(path.join(APP, 'components/HomeTiles.js'), 'utf8');
  for (const s of SLOTS) {
    if (s.slot === 'post') continue;                 // its line names whichever account is primary
    assert.ok(comp.includes(`title: '${s.title}'`), `${s.slot} title: ${s.title}`);
    assert.ok(comp.includes(s.subtitle.replace(/’/g, "'")), `${s.slot} line: ${s.subtitle}`);
  }
  // the database won't take more than Pillar's own limits
  assert.ok(sql.includes(`between 1 and ${TILE_LIMITS.title}`), 'the title limit matches');
  assert.ok(sql.includes(`<= ${TILE_LIMITS.subtitle}`), 'the subtitle limit matches');
});

console.log('\n── featured events ──');

await t('a featured event saves the tick and the picture with it', async () => {
  calls.length = 0;
  answer = { data: { id: 'e1' }, error: null };
  await cal.saveEvent({ title: 'Revival', calendar: 'church', start_date: '2026-10-01', featured: true, image_url: 'https://x.org/r.jpg' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].row.featured, true);
  assert.strictEqual(calls[0].row.image_url, 'https://x.org/r.jpg');
});

await t('featured with no picture yet sends no picture at all — the column refuses an empty one', async () => {
  calls.length = 0;
  answer = { data: { id: 'e1' }, error: null };
  await cal.saveEvent({ title: 'Work day', calendar: 'church', start_date: '2026-10-01', featured: true, image_url: '' });
  assert.strictEqual(calls[0].row.image_url, null, JSON.stringify(calls[0].row));
  // the same on an edit, and on every week of a series
  calls.length = 0;
  await cal.saveEvent({ id: 'e1', title: 'Work day', calendar: 'church', start_date: '2026-10-01', featured: true, image_url: '' });
  assert.strictEqual(calls[0].row.image_url, null);
  calls.length = 0;
  await cal.saveEvent({ title: 'Weekly', calendar: 'church', start_date: '2026-10-01', featured: true, image_url: '',
    is_recurring: true, recurrence: 'Weekly', recurrence_end: '2026-10-22' });
  assert.ok(calls[0].row.every((r) => r.image_url === null), JSON.stringify(calls[0].row[0]));
});

await t('before the migration is run, the event is still saved — just not featured', async () => {
  const refused = { data: null, error: { message: `column "featured" of relation "events" does not exist` } };
  for (const ev of [
    { title: 'New', calendar: 'church', start_date: '2026-10-01', featured: true },
    { id: 'e1', title: 'Edit', calendar: 'church', start_date: '2026-10-01', featured: true },
    { title: 'Weekly', calendar: 'church', start_date: '2026-10-01', featured: true,
      is_recurring: true, recurrence: 'Weekly', recurrence_end: '2026-10-22' },
  ]) {
    calls.length = 0;
    let n = 0;
    answer = refused;
    const saved = await (async () => {
      // first call refused, second (without the columns) accepted
      const orig = globalThis.__supabase.from;
      globalThis.__supabase.from = (name) => { n++; if (n === 2) answer = { data: { id: 'x' }, error: null }; return orig(name); };
      const out = await cal.saveEvent(ev);
      globalThis.__supabase.from = orig;
      return out;
    })();
    assert.strictEqual(saved.featuredUnsupported, true, `${ev.title}: ${JSON.stringify(saved)}`);
    assert.strictEqual(calls.length, 2, `${ev.title}: asked twice`);
    const second = Array.isArray(calls[1].row) ? calls[1].row[0] : calls[1].row;
    assert.ok(!('featured' in second) && !('image_url' in second), `${ev.title}: ${JSON.stringify(second)}`);
    assert.strictEqual(second.title, ev.title, 'the event itself is unchanged');
    if (ev.id) assert.deepStrictEqual(calls[1].eq, ['id', 'e1'], 'an edit still edits that event');
    if (Array.isArray(calls[1].row)) assert.strictEqual(calls[1].row.length, 4, 'every week of the series is still saved');
  }
});

await t('any other refusal is still reported, not quietly dropped', async () => {
  calls.length = 0;
  answer = { data: null, error: { message: 'new row violates row-level security policy' } };
  const out = await cal.saveEvent({ title: 'Nope', calendar: 'church', start_date: '2026-10-01', featured: true });
  assert.ok(!out.featuredUnsupported && out.error, JSON.stringify(out));
  assert.strictEqual(calls.length, 1, 'asked once');
});

await t("the event's picture goes to the app's own bucket, as a photograph", () => {
  const src = fs.readFileSync(path.join(PILLAR, 'src/lib/calendar.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function uploadEventPhoto'), src.indexOf('const MISSING_COLUMN'));
  assert.ok(/from\('app-media'\)/.test(fn), 'the app-media bucket');
  assert.ok(/events\//.test(fn), 'kept with the other event pictures');
  assert.ok(/downscaleImage\(/.test(fn), 'shrunk before it is sent');
  assert.ok(/getPublicUrl/.test(fn), 'and read back as a web address');
});

await t('the wizard offers it, but never on a private event', () => {
  const w = fs.readFileSync(path.join(PILLAR, 'src/pages/calendar/EventWizard.jsx'), 'utf8');
  assert.ok(/featured/.test(w) && /Featured/.test(w), 'the toggle is there');
  assert.ok(/'is_private', e\.target\.checked\);\s*if \(e\.target\.checked\) set\('featured', false\)/.test(w),
    'ticking private clears it');
  assert.ok(/disabled=\{[^}]*is_private/.test(w), 'and it cannot be ticked on a private event');
  assert.ok(/later/i.test(w), 'the office is told a picture can come later');
});

console.log(`\n${ok} tile and featured-event checks passed`);
