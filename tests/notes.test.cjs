// Watch → Notes (src/pages/app/NotesView.jsx, src/lib/sermonSheets.js).
//
// A sheet saves once it has a title AND some notes. The database refuses one without notes, and the
// first version saved on the title alone, so every new sheet failed with "violates check constraint
// app_sermon_notes_check" the moment a title was typed (the office hit it, 2026-09-21).
//
// A sheet can go with one sermon: picked from the Sermons list (its title, speaker, date and video
// fill in), or started from the sermon itself (?for=<sermon id>). One sheet per sermon. A project
// that hasn't run sermon-notes-for-a-sermon.sql yet still lists and saves its notes.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the app repo, for the checks that both sides agree
const OUT = path.join(__dirname, '.build-notes'); fs.mkdirSync(OUT, { recursive: true });
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a pretend app_sermon_notes, with the database's own rules ─────────────────────────────────────
const db = { rows: [], column: true, calls: [] };
let n = 0;
function rule(row) {
  if (!String(row.title || '').trim() || !String(row.body || '').length) {
    return { code: '23514', message: 'new row for relation "app_sermon_notes" violates check constraint "app_sermon_notes_check"' };
  }
  if (row.sermon_id && db.rows.some((r) => r.sermon_id === row.sermon_id && r.id !== row.id)) {
    return { code: '23505', message: 'duplicate key value violates unique constraint "app_sermon_notes_one_per_sermon"' };
  }
  return null;
}
function from(table) {
  assert.strictEqual(table, 'app_sermon_notes');
  const q = { op: 'select', columns: '', row: null, eq: null };
  const run = () => {
    db.calls.push({ op: q.op, columns: q.columns, row: q.row && { ...q.row } });
    if (!db.column && (/sermon_id/.test(q.columns) || (q.row && 'sermon_id' in q.row))) {
      return { data: null, error: q.op === 'select'
        ? { code: '42703', message: 'column app_sermon_notes.sermon_id does not exist' }
        : { code: 'PGRST204', message: "Could not find the 'sermon_id' column of 'app_sermon_notes' in the schema cache" } };
    }
    if (q.op === 'select') return { data: db.rows.map((r) => ({ ...r })), error: null };
    if (q.op === 'insert') {
      const row = { id: `sheet${++n}`, sort: 0, ...q.row };
      const bad = rule(row);
      if (bad) return { data: null, error: bad };
      db.rows.push(row);
      return { data: { ...row }, error: null };
    }
    if (q.op === 'update') {
      const r = db.rows.find((x) => x.id === q.eq[1]);
      const bad = rule({ ...r, ...q.row });
      if (bad) return { data: null, error: bad };
      Object.assign(r, q.row);
      return { data: { ...r }, error: null };
    }
    db.rows = db.rows.filter((x) => x.id !== q.eq[1]);
    return { data: null, error: null };
  };
  const chain = {
    select(c) { q.columns = c; return chain; },
    order() { return chain; },
    eq(k, v) { q.eq = [k, v]; return chain; },
    insert(row) { q.op = 'insert'; q.row = row; return chain; },
    update(row) { q.op = 'update'; q.row = row; return chain; },
    delete() { q.op = 'delete'; return chain; },
    single() { return Promise.resolve(run()); },
    then(ok, bad) { return Promise.resolve(run()).then(ok, bad); },
  };
  return chain;
}
stub('./supabase', { supabase: { from } });

// the address bar: ?tab=notes&for=<sermon id>, as Watch → Sermons → "Write notes for this sermon" sends it
let firstSearch = '';
const search = { now: null };
stub('react-router-dom', { useSearchParams: () => {
  const [s, set] = React.useState(() => new URLSearchParams(firstSearch));
  search.now = s;
  return [s, (next) => set(new URLSearchParams(next))];
} });
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
stub('../../lib/dialog', { confirmDialog: async () => true });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });

const LIB = path.join(PILLAR, 'src/lib/sermonSheets.js');
STUBS['../../lib/sermonSheets'] = xform(LIB, 'sermonSheets.cjs');
const lib = require(STUBS['../../lib/sermonSheets']);
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
const NotesView = require(xform(path.join(PILLAR, 'src/pages/app/NotesView.jsx'), 'NotesView.cjs')).default;

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('  ✓', name); };
const textOf = (node) => (typeof node === 'string' ? node : (node?.children || []).map(textOf).join(''));

const SERMONS = [
  { id: 's1', title: 'The Life of Moses', speaker: 'Pastor Ward', date: 'Sep 14, 2026', videoLink: 'https://youtu.be/moses', thumbnailUrl: '' },
  { id: 's2', title: 'Walking by Faith', speaker: 'Pastor Ward', date: 'Sep 21, 2026', videoLink: 'https://youtu.be/faith', thumbnailUrl: 'https://x.org/t.jpg' },
  { id: 's3', title: 'Grace for Today', speaker: '', date: 'someday', videoLink: 'not a link' },
];

async function page(sermons = SERMONS, query = '') {
  firstSearch = query;
  let r;
  await act(async () => { r = TR.create(React.createElement(NotesView, { sermons })); });
  await act(async () => { await wait(20); });
  const root = r.root;
  const ui = {
    root, r,
    button: (label) => root.find((x) => x.type === 'button' && textOf(x).trim() === label),
    title: () => root.find((x) => x.type === 'input' && x.props.className === 'ax-input title'),
    body: () => root.find((x) => x.type === 'textarea'),
    inputs: () => root.findAll((x) => x.type === 'input' && /^ax-input/.test(x.props.className || '') && x.props.type !== 'search'),
    save: () => textOf(root.find((x) => x.type === 'span' && /^ax-save/.test(x.props.className || ''))),
    rows: () => root.find((x) => x.props.className === 'ax-panel tight').findAll((x) => /^ax-row-title/.test(x.props.className || '')).map(textOf),
    choices: () => root.findAll((x) => x.type === 'button' && /pickable/.test(x.props.className || '')),
    picked: () => { const p = root.findAll((x) => x.props.className === 'ax-picked'); return p.length ? textOf(p[0]) : null; },
    type: (node, value) => act(async () => { node.props.onChange({ target: { value } }); }),
    press: (node) => act(async () => { node.props.onClick(); }),
    settle: () => act(async () => { await wait(900); }),   // past the editor's 700 ms autosave
  };
  return ui;
}

(async () => {
  // ── the save that used to fail ──
  await t('a new sheet waits for its notes instead of failing on the title', async () => {
    db.rows = []; db.calls = [];
    const ui = await page();
    await ui.press(ui.button('New notes'));
    await ui.type(ui.title(), 'Walking by Faith');
    await ui.settle();
    assert.deepStrictEqual(db.calls.filter((c) => c.op !== 'select'), [], 'nothing sent before the notes have words');
    assert.strictEqual(ui.save(), 'Not saved yet. The notes are empty.');
    await ui.type(ui.body(), '1. We walk by ___, not by sight.');
    await ui.settle();
    const writes = db.calls.filter((c) => c.op !== 'select');
    assert.strictEqual(writes.length, 1, JSON.stringify(writes));
    assert.strictEqual(writes[0].op, 'insert');
    assert.strictEqual(db.rows[0].title, 'Walking by Faith');
    assert.strictEqual(ui.save(), 'Saved');
    await act(async () => ui.r.unmount());
  });

  // ── a sheet for one sermon ──
  await t('picking the sermon fills in its title, speaker, date and video, and links the sheet to it', async () => {
    db.rows = [{ id: 'old', sermon_id: 's1', title: 'The Life of Moses', body: 'God is ___.', published: true, sort: 10 }]; db.calls = [];
    const ui = await page();
    await ui.press(ui.button('New notes'));
    await ui.press(ui.button('Choose the sermon'));
    const choices = ui.choices();
    assert.deepStrictEqual(choices.map((c) => textOf(c)), [
      'The Life of MosesAlready has its own notes', 'Walking by FaithPastor Ward · Sep 21, 2026', 'Grace for Todaysomeday']);
    assert.strictEqual(choices[0].props.disabled, true, 'a sermon with notes already can’t take a second sheet');
    await ui.press(choices[1]);
    assert.strictEqual(ui.title().props.value, 'Walking by Faith');
    assert.deepStrictEqual(ui.inputs().slice(1).map((i) => i.props.value), ['Pastor Ward', '', '2026-09-21', 'https://youtu.be/faith'],
      'speaker, passage (left alone), date, and the video’s link');
    assert.strictEqual(ui.picked(), 'Walking by FaithPastor Ward · Sep 21, 2026ChangeRemove');
    await ui.type(ui.body(), 'By ___ Abraham obeyed.');
    await ui.settle();
    const saved = db.rows.find((r) => r.id !== 'old');
    assert.strictEqual(saved.sermon_id, 's2');
    assert.strictEqual(saved.video_url, 'https://youtu.be/faith');
    assert.strictEqual(saved.on_date, '2026-09-21');
    // and off again: the sheet stays, on its own
    await ui.press(ui.root.find((x) => x.props.className === 'ax-picked').find((x) => x.type === 'button' && textOf(x).trim() === 'Remove'));
    await ui.settle();
    assert.strictEqual(saved.sermon_id, null);
    assert.strictEqual(ui.button('Choose the sermon').props.className, 'ax-btn fit');
    await act(async () => ui.r.unmount());
  });

  await t('what the sermon doesn’t have, the sheet keeps: no speaker, a date that isn’t one, a link that isn’t one', async () => {
    const f = lib.fromSermon(SERMONS[2], { speaker: 'Typed by hand', on_date: '2026-10-05', video_url: 'https://x.org/v.m3u8' });
    assert.deepStrictEqual(f, { sermon_id: 's3', title: 'Grace for Today', speaker: 'Typed by hand', on_date: '2026-10-05', video_url: 'https://x.org/v.m3u8' });
    assert.strictEqual(lib.fromSermon({ id: 9, title: 'x'.repeat(200) }).title.length, 120, 'never longer than the database takes');
    assert.strictEqual(lib.fromSermon({ id: 9 }).sermon_id, '9');
  });

  await t('dates the way the app server writes them', async () => {
    for (const [given, want] of [['Sep 14, 2026', '2026-09-14'], ['September 7, 2026', '2026-09-07'], ['9/7/2026', '2026-09-07'],
      ['2026-09-14', '2026-09-14'], ['2026-09-14T04:00:00.000Z', '2026-09-14'], ['', ''], ['someday', ''], [null, '']]) {
      assert.strictEqual(lib.isoDate(given), want, String(given));
    }
  });

  await t('started from the sermon: its own notes if it has some, new ones filled in if not', async () => {
    db.rows = [{ id: 'old', sermon_id: 's1', title: 'The Life of Moses', body: 'God is ___.', published: true, sort: 10 }]; db.calls = [];
    let ui = await page(SERMONS, 'tab=notes&for=s1');
    assert.strictEqual(ui.title().props.value, 'The Life of Moses');
    assert.strictEqual(search.now.get('for'), null, 'the request is used once, then cleared');
    assert.strictEqual(search.now.get('tab'), 'notes');
    await act(async () => ui.r.unmount());

    ui = await page(SERMONS, 'tab=notes&for=s2');
    assert.deepStrictEqual(ui.rows(), ['Walking by Faith', 'The Life of Moses']);
    assert.strictEqual(ui.title().props.value, 'Walking by Faith');
    assert.strictEqual(ui.picked(), 'Walking by FaithPastor Ward · Sep 21, 2026ChangeRemove');
    assert.strictEqual(ui.save(), 'Not saved yet. The notes are empty.');
    await act(async () => ui.r.unmount());

    // the sermons arrive after the notes: it waits for them rather than dropping the request
    ui = await page([], 'tab=notes&for=s2');
    assert.strictEqual(search.now.get('for'), 's2');
    await act(async () => { ui.r.update(React.createElement(NotesView, { sermons: SERMONS })); });
    await act(async () => { await wait(20); });
    assert.strictEqual(ui.title().props.value, 'Walking by Faith');
    assert.strictEqual(search.now.get('for'), null);
    await act(async () => ui.r.unmount());
  });

  await t('a second sheet for the same sermon gets a plain answer, not a database code', async () => {
    db.rows = [{ id: 'old', sermon_id: 's1', title: 'A', body: 'b', published: false, sort: 0 }];
    await assert.rejects(() => lib.saveSheet({ title: 'B', body: 'c', sermon_id: 's1' }),
      (e) => e.message === 'That sermon already has notes. Pick them in the list to change them.');
    const links = await lib.listSheetLinks();
    assert.deepStrictEqual([...links], [['s1', 'old']]);
  });

  // ── a project that hasn't run sermon-notes-for-a-sermon.sql yet ──
  await t('without the sermon link in the database, notes still list and save — and the editor says what to run', async () => {
    db.column = false; db.rows = [{ id: 'old', title: 'A', body: 'God is ___.', published: true, sort: 0 }]; db.calls = [];
    STUBS['../../lib/sermonSheets'] = xform(LIB, 'sermonSheets.old.cjs');   // a fresh copy: it learns the database again
    const oldLib = require(STUBS['../../lib/sermonSheets']);
    const Old = require(xform(path.join(PILLAR, 'src/pages/app/NotesView.jsx'), 'NotesView.old.cjs')).default;
    firstSearch = '';
    let r;
    await act(async () => { r = TR.create(React.createElement(Old, { sermons: SERMONS })); });
    await act(async () => { await wait(20); });
    assert.strictEqual(oldLib.sermonLinkReady(), false);
    assert.ok(db.calls[0].columns.includes('sermon_id') && !db.calls[1].columns.includes('sermon_id'), 'asked once with it, then without');
    const note = r.root.findAll((x) => x.props.className === 'ax-note').map(textOf).join('');
    const btn = r.root.find((x) => x.type === 'button' && textOf(x).trim() === 'New notes');
    await act(async () => { btn.props.onClick(); });
    assert.match(r.root.findAll((x) => x.props.className === 'ax-note').map(textOf).join(''), /sermon-notes-for-a-sermon\.sql/);
    assert.strictEqual(note, '', 'nothing to say until a sheet is open');
    await act(async () => { r.root.find((x) => x.props.className === 'ax-input title').props.onChange({ target: { value: 'New' } }); });
    await act(async () => { r.root.find((x) => x.type === 'textarea').props.onChange({ target: { value: 'Be ___.' } }); });
    await act(async () => { await wait(900); });
    const insert = db.calls.find((c) => c.op === 'insert');
    assert.ok(insert && !('sermon_id' in insert.row) && !insert.columns.includes('sermon_id'), JSON.stringify(insert));
    assert.strictEqual(db.rows.length, 2);
    await act(async () => r.unmount());
    db.column = true;
  });

  // ── the three sides agree ──
  await t('Pillar, the database and the app mean the same thing by sermon_id', async () => {
    const sql = fs.readFileSync(path.join(PILLAR, 'supabase/sermon-notes-for-a-sermon.sql'), 'utf8');
    assert.match(sql, /add column if not exists sermon_id text/);
    assert.match(sql, /app_sermon_notes_one_per_sermon/);
    const base = fs.readFileSync(path.join(PILLAR, 'supabase/app-slides-notes-saved.sql'), 'utf8');
    assert.match(base, /add column if not exists sermon_id text/, 'a project set up from scratch gets it too');
    assert.match(lib.SHEET_COLUMNS, /sermon_id/);
    const app = fs.readFileSync(path.join(APP, 'utils/sermonNotes.js'), 'utf8');
    assert.match(app, /sermon_id/, 'the app reads which sermon a sheet goes with');
  });

  console.log(`\n${ok} notes checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
