// The fixtures harness (vite.config.js `pillarFixtures`, src/dev/fixtures/*, `npm run dev:fixtures`):
// the in-memory stand-ins that let every App page be opened at any window size without a real sign-in and
// without touching the church's Supabase project or its app server. These checks keep it SAFE (it can only
// ever run in the dev server's fixtures mode, and real code never imports it) and keep it HONEST (the fake
// app-server client exports exactly what the real one does, and the fake Supabase answers every call the
// real code makes — so a lib that starts using a new query method fails here, by name, instead of in a
// browser).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const SRC = path.join(PILLAR, 'src');
const FIX = path.join(SRC, 'dev', 'fixtures');
const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
});

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

/* ── (a) it exists only in the dev server, in fixtures mode ── */

console.log('\n── only `vite --mode fixtures` (the dev server) ever loads it ──');

const configModule = await import(pathToFileURL(path.join(PILLAR, 'vite.config.js')).href);
const configFor = async (command, mode) => {
  const make = configModule.default;
  const cfg = typeof make === 'function' ? await make({ command, mode, isSsrBuild: false, isPreview: false }) : make;
  return (cfg.plugins || []).flat(Infinity).filter(Boolean).map((p) => p.name);
};

await t('`vite build` (production, and any other mode) never registers the plugin', async () => {
  for (const mode of ['production', 'development', 'fixtures']) {
    assert.ok(!(await configFor('build', mode)).includes('pillar-fixtures'), `build --mode ${mode}`);
  }
});

await t('the plain dev server (`npm run dev`) never registers it either', async () => {
  assert.ok(!(await configFor('serve', 'development')).includes('pillar-fixtures'));
  assert.ok(!(await configFor('serve', 'production')).includes('pillar-fixtures'));
});

await t('`vite --mode fixtures` registers it, and its own `apply` agrees only with serve + fixtures', async () => {
  assert.ok((await configFor('serve', 'fixtures')).includes('pillar-fixtures'));
  const plugin = configModule.pillarFixtures();
  assert.strictEqual(typeof plugin.apply, 'function');
  assert.strictEqual(plugin.apply({}, { command: 'serve', mode: 'fixtures' }), true);
  assert.strictEqual(plugin.apply({}, { command: 'build', mode: 'fixtures' }), false);
  assert.strictEqual(plugin.apply({}, { command: 'serve', mode: 'development' }), false);
  assert.strictEqual(plugin.apply({}, { command: 'build', mode: 'production' }), false);
});

await t('it swaps exactly src/lib/supabase.js and src/lib/appApi.js, and leaves the fakes’ own imports alone', async () => {
  const plugin = configModule.pillarFixtures();
  // stands in for Vite's resolver: a relative import resolves next to its importer
  const ctx = { resolve: async (source, importer) => (source.startsWith('.') ? { id: `${path.resolve(path.dirname(importer), source)}${path.extname(source) ? '' : '.js'}` } : { id: source, external: true }) };
  const swap = (source, importer) => plugin.resolveId.call(ctx, source, path.join(PILLAR, importer), {});
  assert.strictEqual(await swap('../lib/supabase', 'src/context/AuthContext.jsx'), path.join(FIX, 'supabase.js'));
  assert.strictEqual(await swap('./supabase', 'src/lib/homeCards.js'), path.join(FIX, 'supabase.js'));
  assert.strictEqual(await swap('../../lib/appApi', 'src/pages/app/WatchPage.jsx'), path.join(FIX, 'appApi.js'));
  assert.strictEqual(await swap('./appApi', 'src/lib/videoUpload.js'), path.join(FIX, 'appApi.js'));
  assert.strictEqual(await swap('./supabase.js', 'src/dev/fixtures/appApi.js'), null, 'the fakes import each other untouched');
  assert.strictEqual(await swap('@supabase/supabase-js', 'src/lib/supabase.js'), null);
  assert.strictEqual(await swap('./homeCards', 'src/lib/homeTiles.js'), null);
  for (const f of ['supabase.js', 'appApi.js', 'data.js']) assert.ok(fs.existsSync(path.join(FIX, f)), f);
});

await t('npm scripts: `dev:fixtures` is the only way in, and `build` stays a plain production build', () => {
  const pkg = JSON.parse(read(path.join(PILLAR, 'package.json')));
  assert.strictEqual(pkg.scripts['dev:fixtures'], 'vite --mode fixtures --port 1422');
  assert.strictEqual(pkg.scripts.build, 'vite build');
  assert.strictEqual(pkg.scripts.dev, 'vite');
  const launch = JSON.parse(read(path.join(PILLAR, '.claude', 'launch.json')));
  const entry = launch.configurations.find((c) => c.name === 'pillar-fixtures');
  assert.ok(entry, 'Pillar/.claude/launch.json has pillar-fixtures');
  assert.deepStrictEqual([entry.runtimeExecutable, entry.runtimeArgs, entry.port], ['npm', ['run', 'dev:fixtures'], 1422]);
  assert.ok(launch.configurations.some((c) => c.name === 'pillar-dev'), 'the existing entries stay');
});

/* ── (b) real code never reaches src/dev ── */

console.log('\n── nothing outside src/dev/ knows the fixtures exist ──');

await t('no file under src/ outside src/dev/ mentions dev/fixtures or imports from src/dev', () => {
  const offenders = walk(SRC)
    .filter((p) => !p.startsWith(path.join(SRC, 'dev') + path.sep))
    .filter((p) => /\.(jsx?|tsx?|css|html|json)$/.test(p))
    .filter((p) => { const s = read(p); return s.includes('dev/fixtures') || /from\s+['"](\.\.?\/)+dev\//.test(s) || /PILLAR_FIXTURES|pillar-fixtures/.test(s); })
    .map((p) => path.relative(PILLAR, p));
  assert.deepStrictEqual(offenders, [], `these reach into the fixtures: ${offenders.join(', ')}`);
  for (const f of ['index.html', 'src/main.jsx', 'src/App.jsx', 'src/lib/supabase.js', 'src/lib/appApi.js']) {
    assert.ok(!/fixtures/i.test(read(path.join(PILLAR, f))), `${f} stays untouched by the harness`);
  }
});

await t('no fixture file uses import.meta.env (it would tie them to Vite and break these Node checks)', () => {
  for (const f of fs.readdirSync(FIX)) assert.ok(!/import\.meta/.test(read(path.join(FIX, f))), f);
});

/* ── (c) the fake app-server client can never drift from the real one ── */

console.log('\n── the fake app server exports exactly what the real one does ──');

const exportsOf = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:const|let|var|async\s+function\*?|function\*?|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => names.add(s.split(/\s+as\s+/).pop()));
  }
  return names;
};

await t('src/dev/fixtures/appApi.js exports the same names as src/lib/appApi.js', () => {
  const real = exportsOf(read(path.join(SRC, 'lib', 'appApi.js')));
  const fake = exportsOf(read(path.join(FIX, 'appApi.js')));
  assert.ok(real.size >= 40, `found only ${real.size} exports in the real client — did its export style change?`);
  const missing = [...real].filter((n) => !fake.has(n));
  const extra = [...fake].filter((n) => !real.has(n));
  assert.deepStrictEqual(missing, [], `the fake app server is missing: ${missing.join(', ')} (Vite would fail to import them)`);
  assert.deepStrictEqual(extra, [], `the fake app server exports what the real one doesn't: ${extra.join(', ')}`);
});

await t('src/dev/fixtures/supabase.js exports `supabase`, like src/lib/supabase.js', () => {
  const real = exportsOf(read(path.join(SRC, 'lib', 'supabase.js')));
  const fake = exportsOf(read(path.join(FIX, 'supabase.js')));
  for (const n of real) assert.ok(fake.has(n), `the fake Supabase is missing export ${n}`);
});

/* ── (d) the fake Supabase answers every call the real code makes ── */

console.log('\n── the fake Supabase speaks every method Pillar uses ──');

// the fakes read ?fx= from location and upload with fetch: neither exists here, and no call may go out
globalThis.fetch = async (url) => { throw new Error(`the fixtures tried to fetch ${url}`); };
const { supabase } = await import(pathToFileURL(path.join(FIX, 'supabase.js')).href);

const users = walk(SRC)
  .filter((p) => /\.(jsx?|tsx?)$/.test(p) && !p.startsWith(path.join(SRC, 'dev') + path.sep))
  .filter((p) => /import\s*\{\s*supabase\s*\}\s*from\s*['"][./]*(?:lib\/)?supabase['"]/.test(read(p)));
const usersSrc = users.map(read).join('\n');

// every query-builder method supabase-js has (PostgrestQueryBuilder + FilterBuilder + TransformBuilder)
const BUILDER = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf',
  'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'overlaps',
  'textSearch', 'match', 'not', 'or', 'filter',
  'order', 'limit', 'range', 'abortSignal', 'single', 'maybeSingle', 'csv', 'geojson', 'explain', 'rollback', 'returns',
  'throwOnError', 'setHeader', 'overrideTypes',
];

await t(`every query method the ${users.length} files that import supabase call is implemented`, () => {
  assert.ok(users.length >= 30, `found only ${users.length} files importing supabase`);
  const used = BUILDER.filter((m) => new RegExp(`\\.${m}\\s*\\(`).test(usersSrc));
  const q = supabase.from('any_table');
  const missing = used.filter((m) => typeof q[m] !== 'function');
  assert.deepStrictEqual(missing, [], `the fake Supabase query is missing: ${missing.join(', ')}`);
  for (const m of ['select', 'order', 'eq', 'limit', 'single', 'maybeSingle', 'insert', 'update', 'upsert', 'delete', 'in', 'is', 'range', 'neq']) {
    assert.strictEqual(typeof q[m], 'function', m);
  }
});

await t('every supabase.<x>, supabase.auth.<x>, .storage.from().<x> and .functions.<x> they call exists', () => {
  const top = new Set([...usersSrc.matchAll(/\bsupabase\s*\.\s*(\w+)/g)].map((m) => m[1]));
  const missingTop = [...top].filter((n) => !(n in supabase));
  assert.deepStrictEqual(missingTop, [], `the fake Supabase is missing: ${missingTop.join(', ')}`);
  for (const [, ns, n] of usersSrc.matchAll(/\bsupabase\s*\.\s*(auth|functions)\s*\.\s*(\w+)/g)) {
    assert.strictEqual(typeof supabase[ns][n], 'function', `supabase.${ns}.${n}`);
  }
  const bucket = supabase.storage.from('app-media');
  for (const [, n] of usersSrc.matchAll(/\.storage\s*\.\s*from\([^)]*\)\s*\.\s*(\w+)/g)) {
    assert.strictEqual(typeof bucket[n], 'function', `storage.from(…).${n}`);
  }
  // Pillar's remote-control channel (context/ControlContext.jsx): on(…).on(…).subscribe(), send, removeChannel
  const ch = supabase.channel('pillar-control-test', { config: { broadcast: { self: false } } });
  assert.strictEqual(ch.on('broadcast', { event: 'x' }, () => {}).on('broadcast', {}, () => {}).subscribe(), ch);
  assert.strictEqual(typeof ch.send, 'function');
  assert.strictEqual(typeof supabase.removeChannel, 'function');
});

await t('a query is chainable AND awaitable, and writes give their rows back after .select()', async () => {
  const made = await supabase.from('app_home_cards').insert({ kind: 'text', title: 'Fixture check' }).select('id,title').single();
  assert.strictEqual(made.error, null);
  assert.strictEqual(made.data.title, 'Fixture check');
  assert.ok(made.data.id, 'a new row gets an id');
  const changed = await supabase.from('app_home_cards').update({ title: 'Changed' }).eq('id', made.data.id).select('id,title').single();
  assert.strictEqual(changed.data.title, 'Changed');
  const bare = await supabase.from('app_home_cards').update({ sort: 5 }).eq('id', made.data.id);
  assert.deepStrictEqual([bare.data, bare.error], [null, null], 'no .select(): no rows, like supabase-js');
  const tile = await supabase.from('app_home_tiles').upsert({ slot: 'prayer', title: 'Pray' }, { onConflict: 'slot' }).select('slot,title').single();
  const again = await supabase.from('app_home_tiles').upsert({ slot: 'prayer', title: 'Prayer' }, { onConflict: 'slot' }).select('slot,title').single();
  assert.deepStrictEqual([tile.data.title, again.data.title], ['Pray', 'Prayer']);
  const tiles = await supabase.from('app_home_tiles').select('slot').eq('slot', 'prayer');
  assert.strictEqual(tiles.data.length, 1, 'upsert on the conflict column never makes a second row');
  await supabase.from('app_home_cards').delete().eq('id', made.data.id);
  const gone = await supabase.from('app_home_cards').select('id').eq('id', made.data.id).maybeSingle();
  assert.deepStrictEqual([gone.data, gone.error], [null, null]);
  const none = await supabase.from('app_home_cards').select('id').eq('id', 'nope').single();
  assert.strictEqual(none.error?.code, 'PGRST116', 'single() with no row errors the way PostgREST does');
  const sorted = await supabase.from('church_groups').select('name,sort').order('sort', { ascending: false }).limit(3);
  assert.deepStrictEqual(sorted.data.map((g) => g.sort), [80, 70, 60]);
  const dup = await supabase.from('app_sermon_notes').insert({ title: 'Twice', body: 'x', sermon_id: '1780000000101' }).select().single();
  assert.strictEqual(dup.error?.code, '23505', 'one sheet per sermon, like the SQL');
});

/* ── the sign-in gate: already signed in, an onboarded Admin, any PIN ── */

console.log('\n── the harness opens straight onto the App pages ──');

await t('signed in as an onboarded Admin (App.jsx’s gates), and any 4-digit PIN unlocks', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  assert.ok(session?.user?.id && session.access_token);
  const { data: profile } = await supabase.from('staff').select('*').eq('id', session.user.id).single();
  assert.ok(/admin/i.test(profile.role), 'normalizeRole(profile.role) === "Admin"');
  assert.notStrictEqual(profile.onboarded, false);
  assert.deepStrictEqual(await supabase.rpc('verify_pin', { input: '0000' }), { data: true, error: null });
  assert.deepStrictEqual(await supabase.rpc('app_touch', { p: 'home' }), { data: null, error: null });
  const sub = supabase.auth.onAuthStateChange(() => {});
  assert.strictEqual(typeof sub.data.subscription.unsubscribe, 'function');
  sub.data.subscription.unsubscribe();
});

await t('every table the App pages read has sample rows', async () => {
  const want = { app_home_cards: 6, app_home_tiles: 1, app_media_series: 3, app_media_featured: 1, app_sermon_notes: 2,
    app_bulletin_slides: 8, church_groups: 8, group_posts: 10, app_update_notice: 2, app_page_headers: 1, app_refresh: 1 };
  for (const [table, n] of Object.entries(want)) {
    const { data, error } = await supabase.from(table).select('*');
    assert.strictEqual(error, null, table);
    assert.ok(data.length >= n, `${table}: ${data.length} rows, want ${n}+`);
  }
  const cards = (await supabase.from('app_home_cards').select('*')).data;
  for (const k of ['image', 'video', 'text']) assert.ok(cards.some((c) => c.kind === k), `a ${k} card`);
  assert.ok(cards.some((c) => !c.published), 'a draft card');
  assert.ok(cards.some((c) => c.starts_on) && cards.some((c) => c.ends_on), 'scheduled and ended cards');
  assert.ok(new Set(cards.map((c) => c.audience)).size >= 2, 'more than one audience');
});

/* ── the fake app server ── */

console.log('\n── the fake app server behaves, and never sends anything ──');

const api = await import(pathToFileURL(path.join(FIX, 'appApi.js')).href);

await t('sample sermons, videos, resources, announcements, live and settings are all there', async () => {
  const sermons = await api.getSermons();
  assert.ok(sermons.length >= 20, `${sermons.length} sermons`);
  assert.ok(sermons.some((s) => /youtube\.com/.test(s.videoLink)) && sermons.some((s) => /\.mp4$/.test(s.videoLink)), 'YouTube and file links');
  assert.ok(sermons.some((s) => !s.published), 'a draft sermon');
  assert.strictEqual((await api.getCustomBlocks()).length, 6);
  assert.strictEqual((await api.getResources()).length, 5);
  assert.strictEqual((await api.getAnnouncements()).length, 6);
  const live = await api.getLivestream();
  assert.strictEqual(typeof live.isLive, 'boolean');
  assert.ok((await api.getPushCount()).count > 0);
  const layout = await api.getMediaLayout();
  assert.ok(sermons.some((s) => s.id === layout.featuredSermonId), 'the big card is one of the sermons');
  assert.ok(Array.isArray(layout.suggestedIds));
  assert.ok((await api.getSettings()).churchName);
  const series = (await supabase.from('app_media_series').select('*')).data;
  const known = new Set([...sermons, ...(await api.getCustomBlocks())].map((x) => x.id));
  assert.ok(series[0].items.every((it) => known.has(it.id)), 'series items point at sample sermons and videos');
});

await t('saves and deletes round-trip; sending a notification and uploading a video never leave the page', async () => {
  const id = api.genId();
  assert.notStrictEqual(api.genId(), api.genId(), 'ids never repeat');
  await api.saveSermon({ id, title: 'Fixture sermon', speaker: 'Sample Speaker 1', published: false });
  assert.ok((await api.getSermons()).some((s) => s.id === id));
  await api.deleteSermon(id);
  assert.ok(!(await api.getSermons()).some((s) => s.id === id));
  const info = console.info; console.info = () => {};
  try { assert.ok((await api.sendNotification({ title: 'Test', body: 'Only recorded' })).fixtures); } finally { console.info = info; }
  await assert.rejects(api.getGcsSignedUrl({ filename: 'video.mp4' }), /off in fixtures/);
  assert.strictEqual(api.APP_API_BASE, 'https://fixtures.invalid');
});

/* ── the sample church is obviously made up ── */

await t('every person in the sample data is an obvious stand-in (never real members)', async () => {
  const people = [
    ...(await api.getSermons()).map((s) => s.speaker),
    ...(await api.getChat()).map((m) => m.name || m.user || m.username),   // username: the app server's own shape
    ...(await supabase.from('staff').select('name')).data.map((s) => s.name),
    ...(await supabase.from('church_groups').select('leaders')).data.flatMap((g) => g.leaders.map((l) => l.name)),
  ];
  const odd = people.filter((n) => !/^(Sample (Speaker|Leader|Staff) \d+|Test Member \d+|Preview Admin|Guest)$/.test(n));
  assert.deepStrictEqual(odd, [], `names that don't look like samples: ${odd.join(', ')}`);
});

console.log(`\n${ok} fixtures checks passed`);
process.exit(0);
