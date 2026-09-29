// App → Watch after the redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4;
// src/pages/app/WatchPage.jsx, NotesView.jsx, mediaLayout.js).
//
// The user: "Allow user to create a sermon within a series instead of going to a different screen.
// Improve efficiency as much as possible." — and, of the phone previews: "make sure the phone mockups
// look just like the app". These checks render the whole Watch page against a pretend app server and
// a pretend database and hold it to that:
//   · a new sermon is made inside its series — no tab switch, the series word filled in, not in the
//     app — and joins the series (which saves) the moment it has a title; with no series name the
//     button says what's missing and makes nothing; an untouched one goes away again on Done
//   · Series and Notes are loaded once for the page: switching tabs neither asks again nor forgets
//     the pick, and a series' items say "Loading…" (never "deleted") while the app server is quiet
//   · every list has search and filters; "In series" chips open that series; Add from Watch suggests
//     the sermons whose series word is the series' name; the videos count counts videos
//   · a new series goes first and stays first; the leave guard covers series; N makes a new one
//   · a video uploading makes leaving it ask first (the Home pattern)
//   · the phone is the app's Watch tab: the office's big card with its TALL picture, the picked
//     sermon outlined where it really is (Featured…), the notes page two points at a time
// …and what the review after the redesign found (2026-09-23), each held here:
//   · New waits while its list loads (a load replaces every row: what was made before it was wiped)
//   · without the Series/Featured tables, Sermons and Videos say why Featured is off
//   · the sermon head keeps all four switches at a laptop's width and on a phone (they wrap); only a
//     tablet folds three under More; Back names the list it goes back to
//   · a sermon over its series: its "In the app" says why it won't in the panel, nothing stale later;
//     a blank one goes away however the panel closes; one whose save is on its way stays and joins
//   · two quick changes to a series' items both count
//   · the phone: a resource's cover as the app reads it (and Pillar now writes it there), only what
//     the app shows (published), titles as they are, no dock tab on All messages, a series flag that
//     adds no line, a church file black on the notes page; the notes' ‹ › 44px to hit
//   · notes filled in from their sermon don't hold the tab open
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const OUT = path.join(__dirname, '.build-watch'); fs.mkdirSync(OUT, { recursive: true });
const babel = require(path.join(DEPS, '@babel/core'));
const xform = (src, out) => { fs.writeFileSync(path.join(OUT, out), babel.transformFileSync(src, { babelrc: false, configFile: false,
  plugins: [path.join(DEPS, '@babel/plugin-transform-modules-commonjs'), [path.join(DEPS, '@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }]] }).code); return path.join(OUT, out); };
const STUBS = {};
const stub = (req, exp) => { const f = path.join(OUT, '__stubs__', req.replace(/[^\w.-]/g, '_') + '.js'); const m = new Module(f); m.filename = f; m.loaded = true; m.exports = exp; require.cache[f] = m; STUBS[req] = f; };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (STUBS[request]) return STUBS[request];
  if (request === 'react' || request.startsWith('react/') || request === 'react-test-renderer') return origResolve.call(this, request, { ...parent, paths: [DEPS] }, ...rest);
  return origResolve.call(this, request, parent, ...rest);
};
const React = require(path.join(DEPS, 'react'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
const { act } = React;
const h = React.createElement;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── a pretend browser window: its listeners (keys, beforeunload) ──
const listeners = {};
globalThis.window = {
  location: { origin: 'https://pillar.test' },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
};
const key = (k) => act(async () => {
  for (const fn of [...(listeners.keydown || [])]) fn({ key: k, target: {}, preventDefault() {}, defaultPrevented: false });
});

// ── the app server (lib/appApi): sermons, videos, resources, the media layout ──
const TALL = 'https://x.org/son-tall.jpg';
const WIDE = 'https://x.org/son-wide.jpg';
const seed = () => ({
  sermons: [
    { id: 's1', title: 'The Son Who Stayed Home', speaker: 'Steve Stewart', date: 'Sep 14, 2026', series: 'Prodigal Sons', duration: '42 min', thumbnailUrl: WIDE, thumbnailTallUrl: TALL, videoLink: '', published: true, extra: 'kept' },
    { id: 's2', title: 'Where is Heaven?', speaker: 'Steve Stewart', date: 'Sep 7, 2026', series: 'Heaven', thumbnailUrl: 'https://x.org/heaven.jpg', published: true },
    { id: 's4', title: 'The Lost Coin', speaker: 'Steve Stewart', date: 'Aug 31, 2026', series: 'Prodigal Sons', published: true },
    { id: 's3', title: 'Draft sermon', speaker: '', date: '', series: '', published: false },
  ],
  blocks: [{ id: 'v1', title: 'Welcome video', subtitle: 'New here?', videoUrl: '', thumbnail: '', playInContainer: true, published: true }],
  resources: [{ id: 'r1', title: 'Study guide', subtitle: '', type: 'Study Guide', coverUrl: '', link: '', published: true }],
  layout: { featuredSermonId: 's1', suggestedIds: [], resourcesOrder: [] },
});
let server = seed();
// `gate` holds the sermons' and videos' first load back (a cold app server); `saveGate` holds a
// sermon's save while it's on its way (a slow one) — each until the test lets it go
const api = { saves: [], gate: null, saveGate: null };
const held = () => (api.gate ? api.gate : Promise.resolve());
let seq = 100;
stub('../../lib/appApi', {
  genId: () => String(++seq),
  getSermons: async () => { await held(); return clone(server.sermons); },
  getCustomBlocks: async () => { await held(); return clone(server.blocks); },
  getResources: async () => clone(server.resources),
  saveSermon: async (s) => {
    if (api.saveGate) await api.saveGate;
    api.saves.push({ kind: 'sermon', ...clone(s) });
    const at = server.sermons.findIndex((x) => x.id === s.id); if (at >= 0) server.sermons[at] = clone(s); else server.sermons.unshift(clone(s));
    return s;
  },
  deleteSermon: async (id) => { server.sermons = server.sermons.filter((x) => x.id !== id); },
  saveCustomBlock: async (b) => { api.saves.push({ kind: 'video', ...clone(b) }); return b; },
  deleteCustomBlock: async () => {},
  // the app server keeps a resource exactly as it's sent (bethesda-admin server.js, POST /api/resources)
  saveResource: async (r) => {
    api.saves.push({ kind: 'resource', ...clone(r) });
    const at = server.resources.findIndex((x) => x.id === r.id); if (at >= 0) server.resources[at] = clone(r); else server.resources.unshift(clone(r));
    return r;
  },
  deleteResource: async () => {},
  uploadImage: async () => 'https://x.org/up.jpg',
  getMediaLayout: async () => clone(server.layout),
  putMediaLayout: async (l) => { server.layout = clone(l); return l; },
});

// ── the database (lib/supabase): series, featured, notes ──
// `missing`: tables a church hasn't made yet (supabase/app-media-series.sql not run)
const db = { app_media_series: [], app_media_featured: [], app_sermon_notes: [], calls: [], missing: new Set() };
const resetDb = () => {
  db.app_media_series = [
    { id: 'ser1', name: 'Prodigal Sons', subtitle: 'Three sons, one Father', image_url: null, items: [{ id: 's1', kind: 'sermon' }], published: true, sort: 10 },
    { id: 'ser2', name: 'Heaven', subtitle: null, image_url: null, items: [{ id: 's2', kind: 'sermon' }], published: true, sort: 20 },
  ];
  db.app_media_featured = [{ item_id: 's2', kind: 'sermon', sort: 10 }];
  db.app_sermon_notes = [];
  db.calls = [];
  db.missing = new Set();
};
let rowSeq = 0;
function from(table) {
  const q = { op: 'select', row: null, eq: null };
  const run = () => {
    db.calls.push({ table, op: q.op, row: q.row && clone(q.row), eq: q.eq });
    if (db.missing.has(table)) return { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
    const rows = db[table];
    if (q.op === 'select') return { data: clone(rows), error: null };
    if (q.op === 'insert') { const row = { id: `${table}-${++rowSeq}`, ...clone(q.row) }; rows.push(row); return { data: clone(row), error: null }; }
    if (q.op === 'update') { const r = rows.find((x) => x.id === q.eq[1]); Object.assign(r, clone(q.row)); return { data: clone(r), error: null }; }
    if (q.op === 'upsert') { const at = rows.findIndex((x) => x.item_id === q.row.item_id); if (at >= 0) rows[at] = clone(q.row); else rows.push(clone(q.row)); return { data: clone(q.row), error: null }; }
    db[table] = rows.filter((x) => (q.eq[0] === 'id' ? x.id : x.item_id) !== q.eq[1]);
    return { data: null, error: null };
  };
  const chain = {
    select() { return chain; }, order() { return chain; }, eq(k, v) { q.eq = [k, v]; return chain; },
    insert(r) { q.op = 'insert'; q.row = r; return chain; }, update(r) { q.op = 'update'; q.row = r; return chain; },
    upsert(r) { q.op = 'upsert'; q.row = r; return chain; }, delete() { q.op = 'delete'; return chain; },
    single() { return Promise.resolve(run()); }, then(ok, bad) { return Promise.resolve(run()).then(ok, bad); },
  };
  return chain;
}
stub('./supabase', { supabase: { from } });

// ── the address bar (?tab=…&for=…), Pillar's frame, icons, the confirm dialog, uploads ──
// one address bar for every component that reads it, as react-router's is
const search = { now: new URLSearchParams(), subs: new Set() };
stub('react-router-dom', { useSearchParams: () => {
  const [, force] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => { search.subs.add(force); return () => { search.subs.delete(force); }; }, []);
  return [search.now, (next) => { search.now = new URLSearchParams(next); search.subs.forEach((f) => f()); }];
} });
const shell = { tabs: null };
stub('./AppShell', { __esModule: true, default: ({ tabs, children }) => { shell.tabs = tabs; return h('div', { className: 'shell' }, children); } });
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
const asked = [];
let answer = false;
stub('../../lib/dialog', { confirmDialog: async ({ message }) => { asked.push(message); return answer; } });
stub('../../lib/videoUpload', {
  uploadVideo: () => new Promise(() => {}),   // an upload that is still on its way
  videoStill: async () => null, videoProblem: () => null, videoFacts: async () => ({}), tooHeavy: () => false,
  describeVideo: () => '', formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: 'video/mp4',
});
STUBS['../../lib/mediaSeries'] = xform(path.join(PILLAR, 'src/lib/mediaSeries.js'), 'mediaSeries.cjs');
STUBS['../../lib/sermonSheets'] = xform(path.join(PILLAR, 'src/lib/sermonSheets.js'), 'sermonSheets.cjs');
STUBS['../../lib/youtube'] = xform(path.join(PILLAR, 'src/lib/youtube.js'), 'youtube.cjs');
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
STUBS['./mediaLayout'] = xform(path.join(PILLAR, 'src/pages/app/mediaLayout.js'), 'mediaLayout.cjs');
STUBS['./NotesView'] = xform(path.join(PILLAR, 'src/pages/app/NotesView.jsx'), 'NotesView.cjs');
const Watch = require(xform(path.join(PILLAR, 'src/pages/app/WatchPage.jsx'), 'WatchPage.cjs'));
const WatchPage = Watch.default;
const Notes = require(STUBS['./NotesView']);

const textOf = (node) => (typeof node === 'string' ? node : (node?.children || []).map(textOf).join(''));
const cls = (x, c) => typeof x.props.className === 'string' && x.props.className.split(' ').includes(c);

// A page on a screen of a given size: the workspace measures `work` px wide (layout.jsx Workspace,
// through ResizeObserver) and each phone 300. Without it nothing is measured (the checks above: every
// ref is null in the renderer). Enough of an element for what the page does with its refs.
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const nodeMock = (work) => (el) => {
  const c = String(el.props.className || '');
  return {
    style: {}, scrollHeight: 100, isConnected: true,
    getBoundingClientRect: () => ({ width: c.includes('ax-phone-frame') ? 300 : c.split(' ').includes('ax-work') ? work : 1300, height: 600, top: 0, left: 0 }),
    focus() {}, contains: () => false, querySelector: () => null,
  };
};

async function page(query = '', { work } = {}) {
  search.now = new URLSearchParams(query);
  let r;
  await act(async () => { r = TR.create(h(WatchPage), work ? { createNodeMock: nodeMock(work) } : undefined); });
  await act(async () => { await wait(20); });
  const root = r.root;
  const ui = {
    r, root,
    all: (pred) => root.findAll(pred),
    button: (label, within = root) => within.find((x) => x.type === 'button' && textOf(x).trim() === label),
    buttons: (label, within = root) => within.findAll((x) => x.type === 'button' && textOf(x).trim() === label),
    list: () => root.find((x) => x.type === 'section' && cls(x, 'ax-list-pane')),
    editor: () => root.find((x) => x.type === 'section' && cls(x, 'ax-editor-pane')),
    dialog: () => { const d = root.findAll((x) => x.type === 'section' && x.props.role === 'dialog'); return d[0] || null; },
    rows: () => ui.list().findAll((x) => cls(x, 'ax-row-title')).map(textOf),
    row: (title) => ui.list().find((x) => x.props.role === 'option' && textOf(x.findAll((y) => cls(y, 'ax-row-title'))[0] || '') === title),
    count: () => textOf(ui.list().find((x) => cls(x, 'ax-pane-count'))),
    title: (within = ui.editor()) => within.find((x) => x.type === 'input' && x.props.className === 'ax-input title'),
    inputByLabel: (label, within = ui.editor()) => {
      const field = within.find((x) => cls(x, 'ax-field') && x.findAll((y) => cls(y, 'ax-label') && textOf(y).startsWith(label)).length > 0
        && textOf(x.findAll((y) => cls(y, 'ax-label'))[0]).startsWith(label));
      return field.find((x) => x.type === 'input');
    },
    type: (node, value) => act(async () => { node.props.onChange({ target: { value } }); }),
    press: (node) => act(async () => { await node.props.onClick({ stopPropagation() {} }); }),
    tab: (t) => act(async () => { await shell.tabs.onChange(t); }),
    settle: (ms = 900) => act(async () => { await wait(ms); }),   // past the 700 ms autosave
    unmount: () => act(async () => r.unmount()),
  };
  return ui;
}
const reset = () => { server = seed(); resetDb(); api.saves = []; api.gate = null; api.saveGate = null; asked.length = 0; answer = false; };

(async () => {
  let ok = 0; let failed = 0;
  const t = async (name, fn) => {
    reset();
    try { await fn(); ok++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', String(e && e.stack || e).split('\n').slice(0, 6).join('\n      ')); }
  };

  console.log('\n── a new sermon, made inside its series ──');

  await t('New sermon in this series: no tab switch, the series word filled in, not in the app, a panel over the series', async () => {
    const ui = await page('tab=series');
    assert.strictEqual(ui.title().props.value, 'Prodigal Sons', 'the first series opens by itself');
    await ui.press(ui.button('New sermon in this series'));
    assert.strictEqual(search.now.get('tab'), 'series', 'still on Series');
    const panel = ui.dialog();
    assert.ok(panel, 'the sermon editor opens in a panel over the series');
    assert.strictEqual(textOf(panel.find((x) => cls(x, 'ax-subpanel-title'))), 'New sermon');
    assert.match(textOf(panel.find((x) => cls(x, 'ax-subpanel-sub'))), /Joins “Prodigal Sons” as #2 the moment it has a title/);
    assert.strictEqual(ui.inputByLabel('Series word', panel).props.value, 'Prodigal Sons', 'the series word filled in');
    // the FULL editor: words, video, both pictures, and every switch
    assert.ok(panel.findAll((x) => x.props.label === 'Thumbnail · tall (optional)').length === 1, 'the tall picture too');
    for (const s of ['In the app', 'Big card on Media', 'Featured', 'Suggested for You']) {
      assert.ok(panel.findAll((x) => x.type === 'input' && x.props['aria-label'] === s).length === 1, `the ${s} switch`);
    }
    const live = panel.find((x) => x.type === 'input' && x.props['aria-label'] === 'In the app');
    assert.strictEqual(live.props.checked, false, 'not in the app yet');
    assert.strictEqual(api.saves.length, 0, 'nothing is sent before it has a title');
    await ui.unmount();
  });

  await t('the moment it has a title it saves, joins the end of the series, and the series saves', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('New sermon in this series'));
    await ui.type(ui.title(ui.dialog()), 'The Father Who Ran');
    await ui.settle();
    await ui.settle(100);
    const saved = api.saves.find((x) => x.kind === 'sermon');
    assert.ok(saved, 'the sermon was saved');
    assert.strictEqual(saved.title, 'The Father Who Ran');
    assert.strictEqual(saved.series, 'Prodigal Sons');
    assert.strictEqual(saved.published, false, 'a draft until someone switches it on');
    const update = db.calls.filter((c) => c.table === 'app_media_series' && c.op === 'update').pop();
    assert.ok(update, 'the series saved');
    assert.deepStrictEqual(update.row.items, [{ id: 's1', kind: 'sermon' }, { id: saved.id, kind: 'sermon' }], 'appended, as a sermon');
    assert.deepStrictEqual(db.app_media_series[0].items.map((i) => i.id), ['s1', saved.id]);
    const panel = ui.dialog();
    assert.match(textOf(panel.find((x) => cls(x, 'ax-subpanel-sub'))), /In “Prodigal Sons” as #2\./);
    assert.match(textOf(panel.find((x) => typeof x.props.className === 'string' && /^ax-save/.test(x.props.className))), /Saved · added to the series/);
    // and it's in the series' own list, highlighted while it's open
    const items = ui.editor().find((x) => cls(x, 'ax-watch-items'));
    assert.deepStrictEqual(items.findAll((x) => cls(x, 'ax-row-title')).map(textOf), ['The Son Who Stayed Home', 'The Father Who Ran']);
    // Done closes the panel; the sermon stays (it's on the Sermons tab too)
    await ui.press(ui.button('Done', ui.dialog()));
    assert.strictEqual(ui.dialog(), null);
    await ui.tab('sermons');
    assert.ok(ui.rows().includes('The Father Who Ran'), 'on the Sermons tab too');
    await ui.unmount();
  });

  await t('with no name yet the button says what’s missing, and makes nothing', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('New series'));
    const btn = ui.button('Name the series first');
    assert.strictEqual(btn.props.disabled, false, 'not a dead button');
    assert.ok(/primary/.test(btn.props.className));
    await ui.press(btn);
    assert.strictEqual(ui.dialog(), null, 'no panel');
    assert.ok(ui.all((x) => cls(x, 'ax-hint') && cls(x, 'bad') && /give the series a name first/.test(textOf(x))).length === 1, 'and it says so');
    await ui.tab('sermons');
    assert.strictEqual(ui.count(), '4 sermons · 3 in the app', 'no sermon was made');
    await ui.unmount();
  });

  await t('Done on a new sermon nobody typed into takes it away again', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('New sermon in this series'));
    await ui.press(ui.button('Done', ui.dialog()));
    await ui.tab('sermons');
    assert.strictEqual(ui.count(), '4 sermons · 3 in the app');
    assert.ok(!ui.rows().includes('Untitled'));
    await ui.unmount();
  });

  console.log('\n── Series and Notes, lifted into the page ──');

  await t('switching tabs neither loads Series and Notes again nor forgets the series picked', async () => {
    const ui = await page('tab=series');
    const loads = (table) => db.calls.filter((c) => c.table === table && c.op === 'select').length;
    assert.strictEqual(loads('app_media_series'), 1);
    assert.strictEqual(loads('app_sermon_notes'), 1, 'notes load with the page (they say which sermons have notes)');
    await ui.press(ui.row('Heaven'));
    assert.strictEqual(ui.title().props.value, 'Heaven');
    await ui.tab('sermons');
    await ui.tab('notes');
    await ui.tab('series');
    assert.strictEqual(ui.title().props.value, 'Heaven', 'the pick survived');
    assert.strictEqual(loads('app_media_series'), 1, 'not asked again');
    assert.strictEqual(loads('app_sermon_notes'), 1, 'not asked again');
    await ui.unmount();
  });

  await t('a series’ items say “Loading…” while the app server hasn’t answered — never “deleted”', async () => {
    let open;
    api.gate = new Promise((r) => { open = r; });
    const ui = await page('tab=series');
    const items = () => ui.editor().find((x) => cls(x, 'ax-watch-items'));
    const said = textOf(items());
    assert.match(said, /Loading…/);
    assert.ok(!/No longer on Watch|deleted/.test(said), said);
    assert.strictEqual(ui.button('New sermon in this series').props.disabled, true, 'no sermon before the list is here to hold it');
    await act(async () => { open(); await wait(20); });
    assert.match(textOf(items()), /The Son Who Stayed Home/);
    assert.match(textOf(items()), /Sermon · Sep 14, 2026/);
    await ui.unmount();
  });

  await t('a series item that really is gone says so', async () => {
    db.app_media_series[0].items.push({ id: 'gone', kind: 'sermon' });
    const ui = await page('tab=series');
    assert.match(textOf(ui.editor().find((x) => cls(x, 'ax-watch-items'))), /No longer on Watch.*It was deleted — take it out/);
    await ui.unmount();
  });

  await t('Add from Watch: sermons whose series word is the series’ name first, a click adds it to the end', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('Add from Watch'));
    const panel = ui.dialog();
    const sections = panel.findAll((x) => x.type === 'section' && cls(x, 'ax-section'));
    assert.strictEqual(textOf(sections[0].find((x) => cls(x, 'ax-section-title'))), 'Suggested');
    assert.deepStrictEqual(sections[0].findAll((x) => cls(x, 'ax-row-title')).map(textOf), ['The Lost Coin']);
    assert.ok(textOf(sections[1]).includes('Welcome video'), 'videos too');
    // the kind filter
    await ui.press(panel.find((x) => x.type === 'button' && x.props.role === 'radio' && textOf(x).startsWith('Videos')));
    assert.deepStrictEqual(ui.dialog().findAll((x) => cls(x, 'ax-row-title')).map(textOf), ['Welcome video']);
    await ui.press(ui.dialog().find((x) => x.type === 'button' && x.props.role === 'radio' && textOf(x).startsWith('All')));
    await ui.press(ui.dialog().find((x) => x.type === 'button' && cls(x, 'pickable') && textOf(x).startsWith('The Lost Coin')));
    await ui.settle();
    assert.deepStrictEqual(db.app_media_series[0].items, [{ id: 's1', kind: 'sermon' }, { id: 's4', kind: 'sermon' }]);
    await ui.unmount();
  });

  await t('a new series goes first, and its sort keeps it first after a reload', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('New series'));
    assert.strictEqual(ui.rows()[0], 'Untitled series');
    await ui.type(ui.title(), 'Advent');
    const guarded = (listeners.beforeunload || new Set()).size;
    assert.ok(guarded >= 1, 'a named series not saved yet keeps the tab from closing');
    await ui.settle();
    const insert = db.calls.find((c) => c.table === 'app_media_series' && c.op === 'insert');
    assert.ok(insert && insert.row.sort < 10, `sort ${insert && insert.row.sort} is below every other series`);
    assert.strictEqual((listeners.beforeunload || new Set()).size, 0, 'saved: nothing to warn about');
    await ui.unmount();
  });

  console.log('\n── Sermons ──');

  await t('search and filters on the list; the count; the list marks the big card', async () => {
    const ui = await page();
    assert.strictEqual(ui.count(), '4 sermons · 3 in the app');
    assert.deepStrictEqual(ui.list().findAll((x) => x.props.role === 'radio').map(textOf),
      ['All4', 'In the app3', 'Drafts1', 'Big card', 'Featured1', 'Suggested0']);
    await ui.press(ui.list().find((x) => x.props.role === 'radio' && textOf(x).startsWith('Drafts')));
    assert.deepStrictEqual(ui.rows(), ['Draft sermon']);
    await ui.press(ui.list().find((x) => x.props.role === 'radio' && textOf(x).startsWith('All')));
    await ui.type(ui.list().find((x) => x.type === 'input' && x.props.type === 'search'), 'heaven');
    assert.deepStrictEqual(ui.rows(), ['Where is Heaven?']);
    await ui.type(ui.list().find((x) => x.type === 'input' && x.props.type === 'search'), '');
    assert.match(textOf(ui.row('The Son Who Stayed Home')), /Big card/);
    await ui.unmount();
  });

  await t('N makes a new sermon at the top, picked, not in the app', async () => {
    const ui = await page();
    await key('n');
    assert.strictEqual(ui.count(), '5 sermons · 3 in the app');
    assert.strictEqual(ui.rows()[0], 'Untitled');
    assert.strictEqual(ui.title().props.value, '');
    await ui.unmount();
  });

  await t('the editor’s head: save state, In the app, Big card, Featured, Suggested, Delete — the words beside the media', async () => {
    const ui = await page();
    const head = ui.editor().find((x) => cls(x, 'ax-editor-pane-head'));
    const switches = head.findAll((x) => x.type === 'input' && x.props.type === 'checkbox').map((x) => x.props['aria-label']);
    assert.deepStrictEqual(switches, ['In the app', 'Big card', 'Featured', 'Suggested']);
    assert.ok(head.findAll((x) => x.type === 'button' && x.props['aria-label'] === 'Delete sermon').length === 1);
    assert.match(textOf(head), /Saved/);
    const cols = ui.editor().findAll((x) => cls(x, 'ax-col-title')).map(textOf);
    assert.deepStrictEqual(cols, ['Words', 'Media']);
    await ui.unmount();
  });

  await t('“In series” chips come from the Series rows and open that series', async () => {
    const ui = await page();
    const chip = ui.editor().find((x) => x.type === 'button' && cls(x, 'ax-watch-chip'));
    assert.strictEqual(textOf(chip), 'Prodigal Sons');
    await ui.press(chip);
    assert.strictEqual(search.now.get('tab'), 'series');
    assert.strictEqual(ui.title().props.value, 'Prodigal Sons');
    await ui.unmount();
  });

  await t('Fill-in notes opens Notes for that sermon, filled in from it, with no reload', async () => {
    const ui = await page();
    await ui.press(ui.button('Write notes for this sermon'));
    await act(async () => { await wait(20); });
    assert.strictEqual(search.now.get('tab'), 'notes');
    assert.strictEqual(search.now.get('for'), null, 'used once, then cleared');
    assert.strictEqual(ui.title().props.value, 'The Son Who Stayed Home');
    assert.strictEqual(db.calls.filter((c) => c.table === 'app_sermon_notes' && c.op === 'select').length, 1);
    await ui.unmount();
  });

  await t('a video on its way up: leaving the sermon asks first, and No stays', async () => {
    const ui = await page();
    const file = ui.editor().findAll((x) => x.type === 'input' && x.props.type === 'file' && x.props.accept === 'video/mp4')[0];
    await act(async () => { await file.props.onChange({ target: { files: [{ name: 'sermon.mp4', size: 10 }], value: '' } }); await wait(10); });
    assert.match(textOf(ui.editor()), /Cancel upload/, 'uploading');
    await ui.press(ui.row('Where is Heaven?'));
    assert.deepStrictEqual(asked, ['A video is still uploading. Stop it and go on?']);
    assert.strictEqual(ui.title().props.value, 'The Son Who Stayed Home', 'No: still on it');
    await ui.tab('series');
    assert.strictEqual(asked.length, 2, 'a tab switch asks too');
    assert.strictEqual(search.now.get('tab'), null, 'and stays');
    answer = true;
    await ui.press(ui.row('Where is Heaven?'));
    assert.strictEqual(ui.title().props.value, 'Where is Heaven?', 'Yes: gone to the other one');
    await ui.unmount();
  });

  console.log('\n── Videos ──');

  await t('the videos count counts videos only (it counted featured sermons too)', async () => {
    const ui = await page('tab=videos');
    assert.strictEqual(ui.count(), '1 video · 0 featured', 'the featured sermon isn’t a featured video');
    await ui.press(ui.list().find((x) => x.type === 'button' && cls(x, 'ax-star')));
    await ui.settle(50);
    assert.strictEqual(ui.count(), '1 video · 1 featured');
    await ui.unmount();
  });

  console.log('\n── the phone is the app ──');

  await t('the big card is the office’s pick, drawn with its TALL picture, outlined while it’s the one picked', async () => {
    const ui = await page();
    const big = ui.root.find((x) => cls(x, 'ax-wp-big'));
    assert.ok(cls(big, 'ax-pa-picked'), 'outlined');
    const fill = big.find((x) => cls(x, 'ax-wp-fill'));
    assert.ok(String(fill.props.style.backgroundImage).includes('son-tall.jpg'), fill.props.style.backgroundImage);
    assert.strictEqual(textOf(big.find((x) => cls(x, 'ax-wp-big-kicker'))), 'PRODIGAL SONS');
    assert.strictEqual(textOf(big.find((x) => cls(x, 'ax-wp-big-title'))), 'The Son Who Stayed Home');
    assert.match(textOf(big.find((x) => cls(x, 'ax-wp-big-meta'))), /^Steve Stewart · .+ · 42 min$/);
    assert.ok(big.findAll((x) => cls(x, 'ax-pa-play')).length === 1, 'the play disc');
    assert.match(textOf(big.find((x) => cls(x, 'ax-pa-btn'))), /Sermon notes/);
    assert.match(textOf(ui.root.find((x) => cls(x, 'ax-watch-place'))), /the big card at the top/);
    // the page around it: the app's title, Featured with its big 16:9 card, the series row, All messages
    const heads = ui.root.findAll((x) => cls(x, 'ax-pa-heading')).map(textOf);
    assert.deepStrictEqual(heads, ['Featured', 'Prodigal Sons', 'Heaven', 'Resources', 'All messages']);
    await ui.unmount();
  });

  await t('another sermon is outlined where it really is — here, the Featured row', async () => {
    const ui = await page();
    await ui.press(ui.row('Where is Heaven?'));
    const picked = ui.root.findAll((x) => cls(x, 'ax-pa-picked'));
    assert.ok(picked.length >= 1 && cls(picked[0], 'ax-wp-media'), 'a Featured card');
    assert.match(textOf(ui.root.find((x) => cls(x, 'ax-watch-place'))), /On phones: Featured · the “Heaven” row · All messages/);
    await ui.unmount();
  });

  await t('a draft is drawn where it would go, flagged “Not in the app yet”', async () => {
    const ui = await page();
    await ui.press(ui.row('Draft sermon'));
    assert.ok(ui.root.findAll((x) => cls(x, 'ax-pa-flag') && textOf(x) === 'Not in the app yet').length === 1);
    assert.match(textOf(ui.root.find((x) => cls(x, 'ax-watch-place'))), /Not in the app yet\./);
    await ui.unmount();
  });

  await t('the model follows SermonsScreen.js: big card, Featured less the big card, Recommended at most 7, series rows', () => {
    const rows = (list) => list.map((r) => ({ ...r, _saved: '{}' }));
    const m = Watch.watchModel({
      sermons: rows([{ id: 'a', title: 'A', published: true }, { id: 'b', title: 'B', published: true }, ...Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, title: `X${i}`, published: true }))]),
      blocks: [], resources: [],
      layout: { featuredSermonId: null, suggestedIds: ['a', 'b', ...Array.from({ length: 9 }, (_, i) => `x${i}`)] },
      featured: [{ item_id: 'a', kind: 'sermon', sort: 10 }, { item_id: 'b', kind: 'sermon', sort: 20 }],
      series: [],
    }, null);
    assert.strictEqual(m.big.id, 'a', 'with none chosen, the newest');
    assert.deepStrictEqual(m.featuredRow.map((c) => c.id), ['b'], 'Featured leaves out the big card');
    assert.strictEqual(m.suggested.length, 7, 'at most seven');
    assert.ok(!m.suggested.some((s) => s.id === 'a' || s.id === 'b'), 'not the big card, not Featured');
    assert.strictEqual(m.suggestedMore, true, 'See all when there are more');
    // and the app still does it this way
    const screen = fs.readFileSync(path.join(APP, 'screens/SermonsScreen.js'), 'utf8');
    assert.ok(/const featPic = featured \? \(featured\.thumbnailTallUrl \|\| featured\.thumbnailUrl \|\| ''\) : '';/.test(screen));
    assert.ok(/const suggested = suggestedOrdered\.slice\(0, 7\);/.test(screen));
    assert.ok(/const FEAT_CARD_H = H \* 0\.62 - 56;/.test(screen), 'the big card is 472pt tall on an 852pt phone');
  });

  await t('the app’s own words: “Today”, “Sunday”, “Sep 14”, “42 min”', () => {
    const now = new Date(2026, 8, 23);   // a Wednesday
    assert.strictEqual(Watch.sermonWhen('Sep 23, 2026', now), 'Today');
    assert.strictEqual(Watch.sermonWhen('Sep 22, 2026', now), 'Yesterday');
    assert.strictEqual(Watch.sermonWhen('Sep 20, 2026', now), 'Sunday');
    assert.strictEqual(Watch.sermonWhen('Sep 14, 2026', now), 'Sep 14');
    assert.strictEqual(Watch.sermonWhen('Sep 14, 2025', now), 'Sep 14, 2025');
    assert.strictEqual(Watch.shortLength('42:10'), '42 min');
    assert.strictEqual(Watch.sermonMeta({ speaker: 'Steve', date: 'Sep 14, 2026', duration: '1:05:00' }, now), 'Steve · Sep 14 · 1 hr 5 min');
  });

  await t('the notes page cuts the outline as the app does: a numbered line starts a point, two to a page', () => {
    const pts = Notes.sheetPoints('1. God is ___ in all things.\nHe never ___.\n2. His mercy is ___.\n3. Go and ___.');
    assert.strictEqual(pts.length, 3);
    assert.deepStrictEqual(pts[0].blanks, [0, 1]);
    assert.deepStrictEqual(pts[2].blanks, [3]);
    const app = fs.readFileSync(path.join(APP, 'utils/sermonNotes.js'), 'utf8');
    assert.ok(app.includes("const NUMBERED = /^\\s*(\\d{1,3}|[IVX]{1,5})[.)]\\s/;"), 'the same rule as the app');
  });

  console.log('\n── what the review after the redesign found ──');

  await t('New waits while its list loads — a load replaces every row, so one made before it landed was wiped', async () => {
    let open;
    api.gate = new Promise((r) => { open = r; });
    const ui = await page();
    const btn = (label) => ui.button(label, ui.list());
    assert.strictEqual(btn('New sermon').props.disabled, true, 'not before the list is here');
    assert.strictEqual(textOf(ui.list().find((x) => cls(x, 'ax-new-hint'))), 'Waiting for the app server…', 'and it says why (Hick: never a silently dead button)');
    await key('n');
    await ui.tab('videos');
    assert.strictEqual(btn('New video').props.disabled, true, 'Videos waits too');
    await act(async () => { open(); await wait(20); });
    assert.strictEqual(btn('New video').props.disabled, false);
    await ui.tab('sermons');
    assert.strictEqual(btn('New sermon').props.disabled, false, 'then it works');
    assert.strictEqual(ui.count(), '4 sermons · 3 in the app', 'N made nothing while it waited');
    // Series and Notes wait for their own lists the same way (and for their tables)
    const src = fs.readFileSync(path.join(PILLAR, 'src/pages/app/WatchPage.jsx'), 'utf8');
    assert.ok(src.includes('newDisabled={!s.setUp || list === null}'), 'Series');
    const notesSrc = fs.readFileSync(path.join(PILLAR, 'src/pages/app/NotesView.jsx'), 'utf8');
    assert.ok(notesSrc.includes('newDisabled={!notes.setUp || list === null}'), 'Notes');
    await ui.unmount();
  });

  await t('without the Series and Featured tables, Sermons and Videos say why Featured is off', async () => {
    db.missing = new Set(['app_media_featured', 'app_media_series']);
    const HINT = 'Series and Featured need supabase/app-media-series.sql run in the Supabase SQL editor.';
    const ui = await page();
    const alerts = () => ui.all((x) => cls(x, 'ax-alert')).map(textOf);
    assert.deepStrictEqual(alerts(), [HINT], 'Sermons says so (the head’s chip has no room for it)');
    const chip = ui.editor().find((x) => x.type === 'input' && x.props['aria-label'] === 'Featured');
    assert.strictEqual(chip.props.disabled, true, 'the Featured chip is off');
    await ui.tab('videos');
    assert.deepStrictEqual(alerts(), [HINT], 'Videos too');
    await ui.tab('series');
    assert.deepStrictEqual(alerts(), [HINT], 'Series once, not twice');
    await ui.tab('resources');
    assert.deepStrictEqual(alerts(), [], 'Resources has nothing to do with it');
    await ui.unmount();
  });

  await t('the sermon head keeps all four switches at a laptop’s width and on a phone; only a tablet folds three under More', async () => {
    const head = (ui) => ui.editor().find((x) => cls(x, 'ax-editor-pane-head'));
    const switches = (ui) => head(ui).findAll((x) => x.type === 'input' && x.props.type === 'checkbox').map((x) => x.props['aria-label']);
    const more = (ui) => head(ui).findAll((x) => x.type === 'button' && /^More/.test(x.props['aria-label'] || ''));
    const back = (ui) => textOf(head(ui).find((x) => x.type === 'button' && cls(x, 'ax-back'))).trim();
    // 1440 × 900 with the full sidebar: a 1164px workspace — the approved Main mockup, a 536px editor
    let ui = await page('', { work: 1164 });
    assert.deepStrictEqual(switches(ui), ['In the app', 'Big card', 'Featured', 'Suggested']);
    assert.strictEqual(more(ui).length, 0, 'none of them a menu away');
    assert.strictEqual(head(ui).findAll((x) => x.props['aria-label'] === 'Delete sermon').length, 1);
    await ui.unmount();
    // a phone, one pane at a time (the approved PhoneEditor mockup): all four, and Back says where
    ui = await page('', { work: 358 });
    assert.deepStrictEqual(switches(ui), ['In the app', 'Big card', 'Featured', 'Suggested']);
    assert.strictEqual(more(ui).length, 0);
    assert.strictEqual(back(ui), 'Sermons', '‹ Sermons, as the mockup has it');
    await ui.unmount();
    // a tablet, the phone a drawer (the approved Tablet mockup — the one width it approved More at)
    ui = await page('', { work: 908 });
    assert.deepStrictEqual(switches(ui), ['In the app', 'Big card']);
    assert.strictEqual(more(ui).length, 1);
    assert.strictEqual(more(ui)[0].props['aria-label'], 'More: Featured, Suggested, Delete');
    await ui.press(more(ui)[0]);
    const menu = head(ui).find((x) => cls(x, 'ax-watch-menu'));
    assert.deepStrictEqual(menu.findAll((x) => x.type === 'input' && x.props.type === 'checkbox').map((x) => x.props['aria-label']), ['Featured', 'Suggested for You']);
    assert.strictEqual(ui.buttons('Delete sermon', menu).length, 1);
    await ui.unmount();
    // the head wraps by itself: the switches flow on after the save state, and on a phone take a row
    // of their own under Back, Preview and Delete (css/watch.css); nothing copies the panes' widths
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/watch.css'), 'utf8');
    assert.match(css, /\.ax-watch \.ax-editor-pane-head > \.ax-editor-switches \{ display: contents; \}/);
    assert.match(css, /@container work \(max-width: 759px\) \{\s*\.ax-watch \.ax-editor-pane-head > \.ax-editor-switches \{ display: flex; order: 1; flex: 1 1 100%; \}/);
    const base = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/base.css'), 'utf8');
    assert.match(base, /\.ax-editor-pane-head \{[^}]*flex-wrap: wrap;/, 'the head wraps');
    const src = fs.readFileSync(path.join(PILLAR, 'src/pages/app/WatchPage.jsx'), 'utf8');
    const room = src.slice(src.indexOf('function useHeadRoom('), src.indexOf('function usePanelLive('));
    assert.ok(!/0\.258|0\.22|360|380/.test(room), 'no pane widths copied out of base.css');
  });

  await t('Back names the list it goes back to — on every Watch view, the empty ones too', async () => {
    const ui = await page();
    const back = () => textOf(ui.editor().find((x) => x.type === 'button' && cls(x, 'ax-back'))).trim();
    assert.strictEqual(back(), 'Sermons');
    for (const [tab, word] of [['series', 'Series'], ['videos', 'Videos'], ['resources', 'Resources'], ['notes', 'Notes']]) {
      await ui.tab(tab);
      assert.strictEqual(back(), word, tab);
    }
    assert.ok(cls(ui.editor(), 'is-empty'), 'Notes has no sheet here: the empty pane says it too');
    await ui.unmount();
  });

  await t('a sermon over its series: “In the app” says why it won’t, in the panel — and nothing turns up later on Sermons', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('New sermon in this series'));
    const live = () => ui.dialog().find((x) => x.type === 'input' && x.props['aria-label'] === 'In the app');
    await act(async () => { await live().props.onChange({ target: { checked: true } }); });
    const said = ui.dialog().findAll((x) => cls(x, 'ax-alert')).map(textOf);
    assert.ok(said.some((s) => s.startsWith('Give the sermon a title before members can see it.')), JSON.stringify(said));
    assert.strictEqual(live().props.checked, false, 'still off');
    await ui.press(ui.button('Done', ui.dialog()));
    await ui.tab('sermons');
    assert.deepStrictEqual(ui.all((x) => cls(x, 'ax-alert')).map(textOf), [], 'nothing stale on Sermons');
    await ui.unmount();
  });

  await t('a new sermon nobody typed into goes away however its panel closes — another series, the button again, Add from Watch, New series, deleting the series', async () => {
    const ui = await page('tab=series');
    const sermons = async () => { await ui.tab('sermons'); const c = ui.count(); const rows = ui.rows(); await ui.tab('series'); return [c, rows.includes('Untitled')]; };
    const FOUR = ['4 sermons · 3 in the app', false];
    await ui.press(ui.button('New sermon in this series'));
    await ui.press(ui.row('Heaven'));
    assert.strictEqual(ui.dialog(), null);
    assert.deepStrictEqual(await sermons(), FOUR, 'another series picked');
    await ui.press(ui.button('New sermon in this series'));
    await ui.press(ui.button('New sermon in this series'));
    await ui.press(ui.button('Done', ui.dialog()));
    assert.deepStrictEqual(await sermons(), FOUR, 'the button twice, then Done');
    await ui.press(ui.button('New sermon in this series'));
    await ui.press(ui.button('Add from Watch'));
    assert.strictEqual(textOf(ui.dialog().find((x) => cls(x, 'ax-subpanel-title'))), 'Add from Watch');
    assert.deepStrictEqual(await sermons(), FOUR, 'Add from Watch in its place');
    await ui.press(ui.button('Done', ui.dialog()));
    await ui.press(ui.button('New sermon in this series'));
    await ui.press(ui.button('New series'));
    assert.deepStrictEqual(await sermons(), FOUR, 'New series');
    await ui.press(ui.row('Heaven'));
    await ui.press(ui.button('New sermon in this series'));
    await ui.press(ui.editor().find((x) => x.type === 'button' && x.props['aria-label'] === 'Delete series'));
    assert.deepStrictEqual(await sermons(), FOUR, 'the series deleted');
    await ui.unmount();
  });

  await t('Done while its first save is still on the way: the sermon stays, and joins the series once the save lands', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('New sermon in this series'));
    let land;
    api.saveGate = new Promise((r) => { land = r; });
    await ui.type(ui.title(ui.dialog()), 'The Father Who Ran');
    await ui.settle();                                 // the autosave has sent it; the server hasn't answered
    await ui.type(ui.title(ui.dialog()), '');          // the title cleared again…
    await ui.press(ui.button('Done', ui.dialog()));     // …and the panel closed
    assert.strictEqual(ui.dialog(), null);
    await act(async () => { land(); await wait(30); });
    await ui.settle(100);
    const made = server.sermons.find((x) => x.title === 'The Father Who Ran');
    assert.ok(made, 'the server has it');
    assert.deepStrictEqual(db.app_media_series[0].items.map((i) => i.id), ['s1', made.id], 'so its series has it too');
    await ui.tab('sermons');
    assert.strictEqual(ui.count(), '5 sermons · 3 in the app', 'and Pillar still lists it — it didn’t vanish while the server kept it');
    await ui.unmount();
  });

  await t('two quick changes to a series’ items both count — each is made to the items as they are then', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('Add from Watch'));
    const add = (title) => ui.dialog().find((x) => x.type === 'button' && cls(x, 'pickable') && textOf(x).startsWith(title)).props.onClick;
    const coin = add('The Lost Coin');
    const heaven = add('Where is Heaven?');
    await act(async () => { coin(); heaven(); });   // both before the page draws again
    await ui.settle();
    assert.deepStrictEqual(db.app_media_series[0].items.map((i) => i.id), ['s1', 's4', 's2'], 'neither lost');
    await ui.press(ui.button('Done', ui.dialog()));
    const outs = ui.editor().find((x) => cls(x, 'ax-watch-items'))
      .findAll((x) => x.type === 'button' && x.props['aria-label'] === 'Take it out of the series').map((b) => b.props.onClick);
    await act(async () => { outs[0]({ stopPropagation() {} }); outs[1]({ stopPropagation() {} }); });
    await ui.settle();
    assert.deepStrictEqual(db.app_media_series[0].items.map((i) => i.id), ['s2'], 'both out, neither put back');
    await ui.unmount();
  });

  await t('a resource’s cover is written where phones look for it, and the phone shows only what phones show', async () => {
    const COVER = 'https://x.org/cover.jpg';
    server.resources = [{ id: 'r1', title: 'Study guide', subtitle: '', type: 'Study Guide', coverUrl: COVER, link: '', published: true }];
    const ui = await page('tab=resources');
    const pic = () => ui.root.find((x) => cls(x, 'ax-wp-res-pic'));
    assert.ok(!(pic().props.style && pic().props.style.backgroundImage), 'kept only as coverUrl: phones draw the gradient, and so does this one');
    assert.ok(cls(pic(), 'ax-wp-grad-0'));
    assert.match(textOf(ui.editor()), /Phones don’t show this cover yet/);
    await ui.press(ui.button('Show this cover on phones'));
    await ui.settle();
    const sent = api.saves.filter((x) => x.kind === 'resource').pop();
    assert.strictEqual(sent.thumbnailUrl, COVER, 'where the app reads it');
    assert.strictEqual(sent.coverUrl, COVER, 'and where Pillar keeps it');
    assert.ok(String(pic().props.style.backgroundImage).includes('cover.jpg'), 'now the phone shows it');
    assert.ok(!/Phones don’t show this cover/.test(textOf(ui.editor())), 'and the note has gone');
    // taking the cover away takes it from both — the old one never comes back
    await ui.press(ui.button('Remove', ui.editor()));
    await ui.settle();
    const off = api.saves.filter((x) => x.kind === 'resource').pop();
    assert.deepStrictEqual([off.coverUrl, off.thumbnailUrl], ['', '']);
    // any other change carries the cover too, so an old resource reaches phones from its next change
    server.resources = [{ id: 'r2', title: 'Old guide', type: 'Series', coverUrl: COVER, link: '', published: true }];
    await ui.unmount();
    const again = await page('tab=resources');
    await again.type(again.title(), 'Old guide, revised');
    await again.settle();
    assert.strictEqual(api.saves.filter((x) => x.kind === 'resource').pop().thumbnailUrl, COVER);
    const screen = fs.readFileSync(path.join(APP, 'screens/SermonsScreen.js'), 'utf8');
    assert.ok(/r\.thumbnailUrl \? \(\s*<Thumb uri=\{r\.thumbnailUrl\}/.test(screen), 'the app draws a resource’s thumbnailUrl');
    await again.unmount();
  });

  await t('the phone draws only what the app shows: a sermon the server has with no “published” is hidden there', () => {
    const rows = (list) => list.map((r) => ({ ...r, _saved: '{}' }));
    const m = Watch.watchModel({
      sermons: rows([{ id: 'a', title: 'No switch at all' }, { id: 'b', title: 'Switched on', published: true }]),
      blocks: rows([{ id: 'v', title: 'A video' }]), resources: rows([{ id: 'r', title: 'A guide' }]),
      layout: {}, featured: [{ item_id: 'v', kind: 'video', sort: 10 }], series: [],
    }, null);
    assert.strictEqual(m.big.id, 'b', 'the newest the app shows, not the hidden one');
    assert.deepStrictEqual(m.all3.map((s) => s.id), ['b']);
    assert.deepStrictEqual(m.featuredRow, [], 'a video without it isn’t featured on phones');
    assert.deepStrictEqual(m.resources, []);
    const picked = Watch.watchModel({ sermons: rows([{ id: 'a', title: 'No switch at all' }]), blocks: [], resources: [], layout: {}, featured: [], series: [] },
      { kind: 'sermon', id: 'a' });
    assert.strictEqual(picked.flag, 'Not in the app yet', 'picked, it’s drawn where it would go — flagged, like a draft');
    const app = fs.readFileSync(path.join(APP, 'screens/SermonsScreen.js'), 'utf8');
    assert.ok(app.includes('const published = (list) => (Array.isArray(list) ? list.filter((x) => x && x.published) : []);'), 'the app keeps x && x.published');
  });

  await t('the phone prints titles as they are — no “Untitled”, no “The sermon’s title” (the app has no such words)', async () => {
    server.layout.featuredSermonId = null;   // the newest is the big card: here, a new one with no title yet
    const ui = await page();
    await key('n');
    const phone = ui.root.find((x) => cls(x, 'ax-phone-screen'));
    assert.strictEqual(textOf(phone.find((x) => cls(x, 'ax-wp-big-title'))), '');
    assert.ok(!/Untitled|The sermon’s title/.test(textOf(phone)), textOf(phone));
    assert.strictEqual(phone.findAll((x) => cls(x, 'ax-pa-flag') && textOf(x) === 'Not in the app yet').length, 1, 'Pillar’s flag says what it is');
    await ui.unmount();
  });

  await t('All messages is a route of its own: the dock marks no tab there', async () => {
    server.sermons.push({ id: 's5', title: 'An older message', speaker: 'Steve Stewart', date: 'Aug 24, 2026', series: '', published: true });
    const ui = await page();
    await ui.press(ui.row('An older message'));
    const phone = () => ui.root.find((x) => cls(x, 'ax-phone-frame'));
    assert.strictEqual(phone().findAll((x) => cls(x, 'ax-wp-page')).length, 1, 'All messages');
    assert.strictEqual(phone().findAll((x) => cls(x, 'ax-pa-dock-tab') && cls(x, 'on')).length, 0, 'no tab picked');
    assert.deepStrictEqual(phone().findAll((x) => cls(x, 'ax-pa-dock-word')).map(textOf), ['Home', 'Watch', 'Bible', 'Give']);
    assert.strictEqual(phone().findAll((x) => cls(x, 'ax-pa-back')).length, 1, 'and its glass Back');
    await ui.press(ui.row('The Son Who Stayed Home'));
    assert.strictEqual(phone().findAll((x) => cls(x, 'ax-pa-dock-tab') && cls(x, 'on')).length, 1, 'on the Watch tab itself, Watch is picked');
    const app = fs.readFileSync(path.join(APP, 'App.js'), 'utf8');
    assert.ok(/<Tab\.Screen name="Messages"\s+component=\{AllMessagesScreen\} \/>/.test(app), 'its own route');
    assert.ok(/const moreRoute\s+= \['Groups', 'Directory', 'Calendar', 'Profile'\]\.includes/.test(app), 'not a More page either');
    await ui.unmount();
  });

  await t('a series not in the app yet: its flag floats over the gap above it, adding no line to the row', async () => {
    const ui = await page('tab=series');
    await ui.press(ui.button('New series'));
    const section = ui.root.find((x) => x.type === 'section' && cls(x, 'ax-wp-section') && cls(x, 'ax-pa-picked'));
    const flag = section.children.find((c) => typeof c !== 'string' && cls(c, 'ax-pa-flag'));
    assert.ok(flag, 'the flag sits right in the section');
    assert.strictEqual(textOf(flag), 'Not in the app yet');
    assert.strictEqual(ui.root.findAll((x) => cls(x, 'ax-wp-flagline')).length, 0, 'no line of its own');
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/watch.css'), 'utf8');
    assert.match(css, /\.ax-wp-section > \.ax-pa-flag \{ top: -26px; left: 20px; \}/);
    assert.ok(!/ax-wp-flagline/.test(css));
    await ui.unmount();
  });

  await t('the notes page: a church file is black until it plays (no poster), YouTube shows its own still', async () => {
    db.app_sermon_notes = [{ id: 'n1', sermon_id: 's1', title: 'The Son Who Stayed Home', speaker: '', passage: '', on_date: '',
      video_url: 'https://x.org/sermon.mp4', body: '1. God is ___.', published: true, sort: 10 }];
    const ui = await page('tab=notes');
    const band = () => ui.root.find((x) => cls(x, 'ax-wn-video'));
    assert.ok(!(band().props.style && band().props.style.backgroundImage), 'no picture over the file, though its sermon has one');
    assert.ok(!/No video with these notes/.test(textOf(band())));
    assert.strictEqual(ui.root.findAll((x) => cls(x, 'ax-wn-media')).length, 1, 'the file’s own controls under it');
    await ui.type(ui.editor().find((x) => x.type === 'input' && x.props['aria-label'] === 'Video link'), 'https://youtu.be/F30BN2xi5z0');
    assert.ok(String(band().props.style.backgroundImage).includes('i.ytimg.com/vi/F30BN2xi5z0/hqdefault.jpg'), 'YouTube: its still');
    const app = fs.readFileSync(path.join(APP, 'screens/Bible/NotesSheet.js'), 'utf8');
    assert.ok(/<VideoView key=\{viewKey\} player=\{player\} style=\{s\.video\} contentFit="contain" nativeControls=\{false\} allowsFullscreen \/>/.test(app), 'the app’s file player');
    assert.ok(!/poster/i.test(app), 'with no poster');
    await ui.unmount();
  });

  await t('notes only filled in from their sermon don’t hold the tab open; typing into them does', async () => {
    const ui = await page();
    await ui.press(ui.button('Write notes for this sermon'));
    await act(async () => { await wait(20); });
    assert.strictEqual(ui.title().props.value, 'The Son Who Stayed Home', 'filled in from the sermon');
    const guards = () => (listeners.beforeunload || new Set()).size;
    assert.strictEqual(guards(), 0, 'nothing of the office’s own yet: no “Leave site?”');
    await ui.type(ui.root.find((x) => x.type === 'textarea'), '1. God is ___.');
    assert.strictEqual(guards(), 1, 'typed: now it asks');
    await ui.settle();
    assert.strictEqual(guards(), 0, 'saved: nothing left to ask about');
    await ui.unmount();
  });

  await t('the notes phone’s ‹ › are real buttons: 44 screen px to hit, whatever the phone’s scale', () => {
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/watch.css'), 'utf8');
    assert.match(css, /\.ax-wn-step \{\s*position: relative;/);
    const rule = /\.ax-wn-step::after \{([^}]*)\}/.exec(css);
    assert.ok(rule, 'a hit area around each');
    assert.match(rule[1], /inset: min\(0px, calc\(\(48px - 44px \/ var\(--ax-phone-scale, 1\)\) \/ 2\)\)/);
    // the laptop's 300px phone (a scale of 300 / 417): 61pt around the 48pt button, 44px on the screen
    const scale = 300 / 417;
    const inset = Math.min(0, (48 - 44 / scale) / 2);
    assert.ok(Math.abs((48 - 2 * inset) * scale - 44) < 0.01);
  });

  console.log(`\n${ok} Watch redesign checks passed${failed ? `, ${failed} failed` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
