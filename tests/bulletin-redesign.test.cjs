// App → Bulletin after the redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4 Bulletin):
// src/pages/app/BulletinPage.jsx, SlidesView.jsx and css/bulletin.css.
//
//   · Announcements and Slides are the same workspace as every App page (list | editor | phone)
//   · the Slides tab's state lives in the page: switching tabs never reloads it or forgets the pick,
//     and its first slide is picked on load
//   · a drop of MANY pictures makes one slide per picture, in file-name order, after the others
//   · the phone is the member app's own Digital Bulletin (BethesdaApp screens/BulletinScreen.js): its
//     folds, with the one being edited open, the picked item outlined — and bulletin.css copies the
//     app's own numbers (checked here against the app's source)
//   · length counters on the announcement fields; the draft badge is a class, not an inline style;
//     one Undo toast for the page; N / search / ⌘S
// Everything the page did before still holds: new announcements go FIRST, tag chips (8, click again
// to clear), "Not saved" lines, counts in the list heads, the whole row sent on every save.
//
// After the adversarial check (2026-09-23): the counters guide but never cut (no maxLength); a drop
// during an upload joins the batch; a drop that misses the list is refused, never opened; an
// editor upload saves after the office moves on; Delete waits for a first save on its way; a slides
// batch's trouble shows on Announcements too; the Calendar and Group Events folds say what the app
// says; the slides row is clipped where the app's is; the loading mark is iOS's own.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the member app, to prove the phone copies it
const OUT = path.join(__dirname, '.build-bulletin'); fs.mkdirSync(OUT, { recursive: true });
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

// ── a pretend browser ──
const listeners = {};
globalThis.window = {
  location: { origin: 'https://pillar.test' },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  dispatchEvent: (e) => { for (const fn of [...(listeners[e.type] || [])]) fn(e); return true; },
};
const head = [];
globalThis.document = {
  activeElement: null,
  querySelector: () => null,   // no Pillar dialog is up
  createElement: (tag) => ({ tagName: tag }),
  getElementById: (id) => head.find((el) => el.id === id) || null,
  head: { appendChild: (el) => { head.push(el); } },
};
const key = (k, extra = {}) => {
  const e = { type: 'keydown', key: k, target: { closest: () => null }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  window.dispatchEvent(e);
  return e;
};

const React = require(path.join(DEPS, 'react'));
const h = React.createElement;

// ── the app server's announcements ──
const server = { list: [], calls: [], delay: 0 };
let idn = 0;
stub('../../lib/appApi', {
  genId: () => String(1790000000000 + (++idn)),
  getAnnouncements: async () => { server.calls.push(['get']); return server.list.map((a) => ({ ...a })); },
  saveAnnouncement: async (a) => {
    server.calls.push(['save', { ...a }]);
    const at = server.list.findIndex((x) => x.id === a.id);
    if (at >= 0) server.list[at] = { ...a }; else server.list.unshift({ ...a });
    if (server.delay) await new Promise((r) => setTimeout(r, server.delay));   // it has landed; the answer is slow
    return a;
  },
  deleteAnnouncement: async (id) => { server.calls.push(['delete', id]); server.list = server.list.filter((x) => x.id !== id); },
});

// ── a pretend app_bulletin_slides (supabase-js's chain), group_posts, and the picture store ──
const db = { rows: [], calls: [], delay: 0, selectDelay: 0 };
const posts = { rows: [], reads: 0, fail: false };
let sn = 0;
function from(table) {
  if (table === 'group_posts') {   // lib/groupPosts listPosts (the real one): select → order → order → await
    const chain = {
      select() { return chain; },
      order() { return chain; },
      then(ok, bad) {
        posts.reads++;
        return Promise.resolve(posts.fail ? { data: null, error: new Error('permission denied') } : { data: posts.rows.map((p) => ({ ...p })), error: null }).then(ok, bad);
      },
    };
    return chain;
  }
  assert.strictEqual(table, 'app_bulletin_slides');
  const q = { op: 'select', row: null, eq: null };
  const run = () => {
    db.calls.push({ op: q.op, row: q.row && { ...q.row }, eq: q.eq });
    if (q.op === 'select') return { data: [...db.rows].sort((a, b) => a.sort - b.sort).map((r) => ({ ...r })), error: null };
    if (q.op === 'insert') { const row = { id: `slide${++sn}`, sort: 0, ...q.row }; db.rows.push(row); return { data: { ...row }, error: null }; }
    if (q.op === 'update') { const r = db.rows.find((x) => x.id === q.eq[1]); Object.assign(r, q.row); return { data: { ...r }, error: null }; }
    db.rows = db.rows.filter((x) => x.id !== q.eq[1]);
    return { data: null, error: null };
  };
  const chain = {
    select() { return chain; },
    order() { return chain; },
    eq(k, v) { q.eq = [k, v]; return chain; },
    insert(row) { q.op = 'insert'; q.row = row; return chain; },
    update(row) { q.op = 'update'; q.row = row; return chain; },
    delete() { q.op = 'delete'; return chain; },
    // the write lands at once; with db.delay its answer comes back late (a first insert "on its way")
    single() { const res = run(); return db.delay ? new Promise((r) => setTimeout(() => r(res), db.delay)) : Promise.resolve(res); },
    then(ok, bad) {
      const slow = q.op === 'select' && db.selectDelay;
      return (slow ? new Promise((r) => setTimeout(() => r(run()), db.selectDelay)) : Promise.resolve(run())).then(ok, bad);
    },
  };
  return chain;
}
stub('./supabase', { supabase: { from } });
const uploads = [];
stub('./homeCards', {
  uploadCardImage: async (file) => {
    uploads.push(file.name);
    await new Promise((r) => setTimeout(r, file.slow || 5));
    return file.broken ? { error: 'The upload failed' } : { url: `https://x.supabase.co/storage/v1/object/public/app-media/home/${encodeURIComponent(file.name)}.jpg` };
  },
});
// the calendar, as lib/homeCards listHomeEvents reads it (the app's fetchCalendar): the rows from the
// day asked for. The query's own filter is homeCards' (and its suite's) business; the page's week
// count must drop what's over itself, as the app's normalize does — so this hands back every row
const calendar = { rows: [], asked: [], fail: false, delay: 0 };
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
stub('../../lib/homeCards', {
  listHomeEvents: async (now) => {
    calendar.asked.push(isoOf(now));
    if (calendar.delay) await new Promise((r) => setTimeout(r, calendar.delay));
    if (calendar.fail) throw new Error('permission denied for table events');
    return calendar.rows.map((e) => ({ ...e }));
  },
});

stub('react-router-dom', { Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children) });
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
stub('../../lib/dialog', { confirmDialog: async () => true });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
// AppShell's own frame (sidebar, TopNav, the live poll) has its own suite (layout.test.cjs): here it
// is only the title, the line under it and the tabs
stub('./AppShell', {
  __esModule: true,
  default: ({ title, subtitle, tabs, fill, children }) => h('div', { className: `shell${fill ? ' fill' : ''}` },
    h('h1', null, title), h('p', { className: 'sub' }, subtitle),
    tabs ? tabs.options.map((o) => h('button', { key: o.key, type: 'button', className: `tab${tabs.value === o.key ? ' on' : ''}`, onClick: () => tabs.onChange(o.key) }, o.label)) : null,
    children),
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
const { act } = React;
STUBS['../../lib/bulletinSlides'] = xform(path.join(PILLAR, 'src/lib/bulletinSlides.js'), 'bulletinSlides.cjs');
STUBS['../../lib/groupPosts'] = xform(path.join(PILLAR, 'src/lib/groupPosts.js'), 'groupPosts.cjs');   // the real isLiveNow
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
STUBS['./SlidesView'] = xform(path.join(PILLAR, 'src/pages/app/SlidesView.jsx'), 'SlidesView.cjs');
const Page = require(xform(path.join(PILLAR, 'src/pages/app/BulletinPage.jsx'), 'BulletinPage.cjs'));
const BulletinPage = Page.default;
const Slides = require(STUBS['./SlidesView']);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cls = (n) => String((n.props && n.props.className) || '');
const has = (n, c) => typeof n.type === 'string' && cls(n).split(' ').includes(c);
const words = (node) => (typeof node === 'string' ? node : (node.children || []).map(words).join(''));
const pad = (n) => String(n).padStart(2, '0');
const sunday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d; })();
const SUNDAY = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
const today0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const plus = (from, n) => { const d = new Date(from); d.setDate(d.getDate() + n); return isoOf(d); };

// This Week's Calendar, as the app counts it: from TODAY (what's over has gone) to Saturday
const EVENTS = [
  { id: 'ended-before-sunday', start_date: plus(sunday, -3), end_date: plus(sunday, -1) },
  { id: 'yesterday', start_date: plus(today0, -1), end_date: null },        // over: never counted
  { id: 'today', start_date: plus(today0, 0), end_date: null },             // ✓
  { id: 'running-through-today', start_date: plus(sunday, -2), end_date: plus(today0, 0) },   // ✓
  { id: 'saturday', start_date: plus(sunday, 6), end_date: null },          // ✓
  { id: 'next-sunday', start_date: plus(sunday, 7), end_date: null },       // next week's
];
// Group Events, as the app's anon read gets them: published, inside the window, with a title
const POSTS = [
  { id: 'p1', title: 'Choir retreat', published: true, starts_on: null, ends_on: null, sort: 0 },       // ✓
  { id: 'p2', title: 'A draft', published: false, starts_on: null, ends_on: null, sort: 1 },
  { id: 'p3', title: 'Long over', published: true, starts_on: null, ends_on: '2000-01-01', sort: 2 },
  { id: 'p4', title: 'Not yet', published: true, starts_on: '2999-01-01', ends_on: null, sort: 3 },
  { id: 'p5', title: '   ', published: true, starts_on: null, ends_on: null, sort: 4 },
  { id: 'p6', title: 'Men’s breakfast', published: true, starts_on: '2000-01-01', ends_on: '2999-12-31', sort: 5 },   // ✓
];

function seed() {
  idn = 0; sn = 0; uploads.length = 0;
  server.delay = 0; db.delay = 0; db.selectDelay = 0;
  calendar.rows = EVENTS.map((e) => ({ ...e })); calendar.asked = []; calendar.fail = false; calendar.delay = 0;
  posts.rows = POSTS.map((p) => ({ ...p })); posts.reads = 0; posts.fail = false;
  server.calls = [];
  server.list = [
    ['Fall Family Picnic', 'Bring a side dish.', 'Event', 'Sun, Oct 5'],
    ['Wednesday Night Supper', 'Plates at 5:30.', 'Dinner', 'Every Wed.'],
    ['Youth Lock-in', 'Four more drivers.', 'Youth', 'Fri 7 PM'],
    ['Serve Day Sign-ups', 'Pick a team.', 'Serve', 'Oct 10'],
    ['Choir Rehearsals Begin', 'All voices welcome.', 'Worship', 'Thursdays'],
    ['Missions Offering (draft)', 'Still being written.', 'Missions', ''],
  ].map(([title, body, tag, date], i) => ({ id: String(1783000000100 + i), title, body, tag, date, published: i !== 5, link: `old-tap-${i}` }));
  db.calls = [];
  db.rows = [
    { id: 'a1', image_url: 'https://x.org/1.jpg', caption: 'Welcome!', on_date: null, published: true, sort: 10 },
    { id: 'a2', image_url: 'https://x.org/2.jpg', caption: 'The picnic', on_date: SUNDAY, published: true, sort: 20 },
    { id: 'a3', image_url: 'https://x.org/3.jpg', caption: 'Last month', on_date: '2020-01-05', published: true, sort: 30 },
    { id: 'a4', image_url: 'https://x.org/4.jpg', caption: 'Hidden one', on_date: null, published: false, sort: 40 },
  ];
  sn = 4;
}

// a file drag from the computer, fired at the window as a browser would (target = what's under the
// pointer; `zone` is the selector its .closest() finds, or nothing)
const dragEvent = (type, zone, files = [], extra = {}) => {
  const e = {
    type, relatedTarget: {}, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    target: { nodeType: 1, closest: (sel) => (zone && sel === zone ? { className: zone } : null) },
    dataTransfer: { types: ['Files'], files, dropEffect: 'copy' },
    ...extra,
  };
  window.dispatchEvent(e);
  return e;
};

// `setup` runs after the seed (a slow table, a failing read…); `settle` = how long to let it load
async function page({ setup, settle = 20 } = {}) {
  seed();
  if (setup) setup();
  let r;
  await act(async () => { r = TR.create(h(BulletinPage)); });
  if (settle) await act(async () => { await wait(settle); });
  const root = r.root;
  const all = (c) => root.findAll((n) => has(n, c));
  const ui = {
    r, root, all,
    one: (c) => { const f = all(c); assert.strictEqual(f.length, 1, `one .${c} (found ${f.length})`); return f[0]; },
    tab: (label) => root.find((n) => n.type === 'button' && cls(n).startsWith('tab') && words(n) === label),
    button: (label) => root.find((n) => n.type === 'button' && words(n).trim() === label),
    rows: () => root.findAll((n) => typeof n.type === 'string' && n.props.role === 'option').map((o) => words(o.findAll((x) => has(x, 'ax-row-title'))[0])),
    row: (title) => root.find((n) => typeof n.type === 'string' && n.props.role === 'option' && words(n).includes(title)),
    picked: () => { const o = root.findAll((n) => typeof n.type === 'string' && n.props.role === 'option' && n.props['aria-selected']); return o.length ? words(o[0].findAll((x) => has(x, 'ax-row-title'))[0]) : null; },
    input: (id) => root.find((n) => (n.type === 'input' || n.type === 'textarea') && String(n.props.id || '').startsWith(`ax-bl-${id}-`)),
    field: (label) => root.find((n) => has(n, 'ax-field') && n.findAll((x) => has(x, 'ax-label') && words(x).startsWith(label)).length),
    headSwitch: () => root.find((n) => has(n, 'ax-editor-switches')).find((n) => n.type === 'input'),
    toast: () => all('ax-toast'),
    alerts: () => all('ax-alert').map(words).join(' '),
    drop: async (zone, files) => { let e; await act(async () => { e = dragEvent('drop', zone, files); }); return e; },   // (act's thenable doesn't chain)
    phone: () => root.find((n) => has(n, 'ax-phone-frame')),
    fold: (title) => ui.phone().find((n) => has(n, 'ax-bl-fold') && words(n.find((x) => has(x, 'ax-bl-fold-title'))) === title),
    type: (node, value) => act(async () => { node.props.onChange({ target: { value } }); }),
    press: (node) => act(async () => { node.props.onClick({ stopPropagation() {}, preventDefault() {} }); }),
    settle: (ms = 900) => act(async () => { await wait(ms); }),   // past the editor's 700 ms autosave
  };
  return ui;
}

(async () => {
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

  await t('both tabs load at once: the first announcement AND the first slide are picked; the page fills the window', async () => {
    const ui = await page();
    assert.ok(ui.root.find((n) => cls(n) === 'shell fill'), 'AppShell `fill`: the workspace is the window’s height');
    assert.ok(ui.one('ax-work').props.className.includes('has-preview'), 'a phone that becomes a drawer on a narrower screen');
    assert.deepStrictEqual(server.calls.filter((c) => c[0] === 'get').length, 1);
    assert.strictEqual(db.calls.filter((c) => c.op === 'select').length, 1, 'the slides were read once, with the page');
    assert.strictEqual(ui.rows().length, 6);
    assert.strictEqual(ui.picked(), 'Fall Family Picnic');
    assert.strictEqual(words(ui.one('ax-pane-count')), '6 announcements · 5 in the Bulletin', 'the count line in the list head');
    const chips = ui.all('ax-filter').map(words);
    assert.deepStrictEqual(chips, ['All6', 'In the Bulletin5', 'Drafts1'], 'filter chips with their counts');
    // the phone: the Announcements fold is open with what members see; the Slides fold counts this Sunday's
    assert.strictEqual(words(ui.fold('Announcements').find((n) => has(n, 'ax-bl-fold-count'))), '5 this week');
    assert.strictEqual(ui.phone().findAll((n) => has(n, 'ax-bl-notice')).length, 5, 'the draft isn’t on phones');
    assert.strictEqual(words(ui.fold('Slides').find((n) => has(n, 'ax-bl-fold-count'))), '2 slides', 'no date or this Sunday — not another Sunday, not a hidden one');
    assert.strictEqual(ui.fold('Slides').findAll((n) => has(n, 'ax-bl-fold-body')).length, 0, 'the other tab’s fold is closed');
    assert.ok(ui.phone().find((n) => has(n, 'ax-bl-notice') && cls(n).includes('ax-pa-picked')), 'the picked announcement is outlined on the phone');
    await act(async () => { ui.r.unmount(); });
  });

  await t('switching to Slides and back never reloads them or forgets the pick', async () => {
    const ui = await page();
    await ui.press(ui.tab('Slides'));
    assert.strictEqual(db.calls.filter((c) => c.op === 'select').length, 1, 'no second read');
    assert.deepStrictEqual(ui.rows(), ['Welcome!', 'The picnic', 'Last month', 'Hidden one']);
    assert.strictEqual(ui.picked(), 'Welcome!', 'the first slide is picked (the old page opened on "Pick a slide")');
    await ui.press(ui.row('Last month'));
    await ui.press(ui.tab('Announcements'));
    await ui.press(ui.row('Youth Lock-in'));
    await ui.press(ui.tab('Slides'));
    assert.strictEqual(ui.picked(), 'Last month', 'the slide picked before is still picked');
    assert.strictEqual(db.calls.filter((c) => c.op === 'select').length, 1);
    await ui.press(ui.tab('Announcements'));
    assert.strictEqual(ui.picked(), 'Youth Lock-in');
    await act(async () => { ui.r.unmount(); });
  });

  await t('a new announcement goes FIRST as a draft, saves once it has a title — the whole row, old fields and all', async () => {
    const ui = await page();
    await act(async () => { ui.button('New announcement').props.onClick(); });
    assert.strictEqual(ui.rows()[0], 'New announcement');
    assert.strictEqual(ui.picked(), 'New announcement');
    assert.strictEqual(ui.input('title').props.autoFocus, true, 'the title takes the keyboard');
    assert.ok(/Not saved — give it a title/.test(words(ui.one('ax-editor-status'))));
    await ui.settle();
    assert.strictEqual(server.calls.filter((c) => c[0] === 'save').length, 0, 'nothing is sent without a title');
    await ui.type(ui.input('title'), 'Baby Shower');
    await ui.settle();
    const saves = server.calls.filter((c) => c[0] === 'save');
    assert.strictEqual(saves.length, 1);
    assert.strictEqual(saves[0][1].published, false, 'a draft until it is switched on');
    assert.strictEqual(saves[0][1].title, 'Baby Shower');
    // an old announcement: what Pillar doesn't edit (its old tap destination) rides along on every save
    await ui.press(ui.row('Youth Lock-in'));
    await ui.type(ui.input('body'), 'Six more drivers.');
    await ui.settle();
    const last = server.calls.filter((c) => c[0] === 'save').pop()[1];
    assert.deepStrictEqual([last.id, last.body, last.link], ['1783000000102', 'Six more drivers.', 'old-tap-2']);
    await act(async () => { ui.r.unmount(); });
  });

  // (was "counts its length (and stops at it)": the redesign had put a maxLength on every field, which
  // cut a pasted message off without a word and froze an older, longer one. DESIGN §4 asks only for
  // counters and the app server has no limits — so the counters stay, and nothing is cut)
  await t('every announcement field counts its length but never cuts it: 1,200 pasted characters are kept, warned about and saved', async () => {
    const ui = await page();
    const max = Page.NOTICE_MAX;
    for (const [id, label] of [['title', 'Title'], ['body', 'Message'], ['tag', 'Tag'], ['date', 'When']]) {
      const f = ui.field(label);
      const count = words(f.find((n) => has(n, 'ax-count')));
      const value = ui.root.find((n) => (n.type === 'input' || n.type === 'textarea') && String(n.props.id || '').startsWith(`ax-bl-${id}-`)).props;
      assert.strictEqual(count, `${value.value.length}/${max[id]}`, `${label} shows its count`);
      assert.strictEqual(value.maxLength, undefined, `${label} has no maxLength: the browser would cut a paste off silently`);
    }
    assert.strictEqual(ui.all('ax-bl-long').length, 0, 'nothing is too long yet');
    const long = 'Bring a side dish. '.repeat(64).slice(0, 1200);
    await ui.type(ui.input('body'), long);
    assert.strictEqual(ui.input('body').props.value.length, 1200, 'every character pasted is kept');
    const count = ui.field('Message').find((n) => has(n, 'ax-count'));
    assert.strictEqual(words(count), '1200/1000');
    assert.ok(cls(count).includes('near'), 'the counter turns amber');
    assert.strictEqual(words(ui.one('ax-bl-long')), 'That’s 200 over 1000 — it still saves, but a shorter message reads better on a phone.');
    await ui.settle();
    const saved = server.calls.filter((c) => c[0] === 'save').pop()[1];
    assert.strictEqual(saved.body.length, 1200, 'and all of it is saved');
    assert.strictEqual(saved.title, 'Fall Family Picnic');
    // a title past 80 is kept too, with the same warning under it
    await ui.type(ui.input('title'), 'T'.repeat(85));
    assert.strictEqual(ui.input('title').props.value.length, 85);
    assert.ok(ui.all('ax-bl-long').some((n) => /^That’s 5 over 80 — it still saves, but a shorter title/.test(words(n))));
    await ui.type(ui.input('title'), 'Fall Family Picnic');
    // tag chips: the tags already used, up to 8, uppercased; clicking the one that's on takes it off
    const chips = () => ui.all('ax-chip');
    assert.deepStrictEqual(chips().map(words), ['EVENT', 'DINNER', 'YOUTH', 'SERVE', 'WORSHIP', 'MISSIONS']);
    assert.ok(cls(chips()[0]).includes(' on'), 'the picked announcement’s own tag is on');
    await ui.press(chips()[0]);
    assert.strictEqual(ui.input('tag').props.value, '', 'clicking the chip that is on clears the tag');
    await ui.press(chips().find((c) => words(c) === 'DINNER'));
    assert.strictEqual(ui.input('tag').props.value, 'DINNER');
    // switching on an announcement with no title is refused, with the reason
    await act(async () => { ui.button('New announcement').props.onClick(); });
    await act(async () => { ui.headSwitch().props.onChange({ target: { checked: true } }); });
    assert.ok(/Give the announcement a title before it goes in the Bulletin\./.test(words(ui.one('ax-alert'))));
    assert.strictEqual(ui.headSwitch().props.checked, false);
    await act(async () => { ui.r.unmount(); });
  });

  await t('one Undo toast for the whole page: deleting an announcement, then a slide, replaces it; Undo keeps the announcement’s id', async () => {
    const ui = await page();
    await ui.press(ui.row('Serve Day Sign-ups'));
    await act(async () => { ui.root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Delete announcement').props.onClick(); });
    await act(async () => { await wait(10); });
    assert.ok(!ui.rows().includes('Serve Day Sign-ups'));
    assert.deepStrictEqual(server.calls.find((c) => c[0] === 'delete'), ['delete', '1783000000103']);
    assert.strictEqual(ui.picked(), 'Choir Rehearsals Begin', 'the next one is picked');
    assert.strictEqual(ui.toast().length, 1);
    assert.ok(/“Serve Day Sign-ups” deleted\./.test(words(ui.toast()[0])));
    await act(async () => { ui.toast()[0].find((n) => n.type === 'button').props.onClick(); });
    await act(async () => { await wait(10); });
    assert.strictEqual(ui.rows()[3], 'Serve Day Sign-ups', 'back where it was');
    assert.strictEqual(server.list.find((a) => a.title === 'Serve Day Sign-ups').id, '1783000000103', 'the same id — links to it reconnect');
    assert.strictEqual(server.list.find((a) => a.title === 'Serve Day Sign-ups').link, 'old-tap-3');
    // a slide's delete uses the same toast (it used to be SlidesView's own, lost on a tab switch)
    await ui.press(ui.tab('Slides'));
    await act(async () => { ui.root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Delete slide').props.onClick(); });
    await act(async () => { await wait(10); });
    assert.strictEqual(ui.toast().length, 1, 'still one toast');
    assert.strictEqual(words(ui.toast()[0]).replace('Undo', ''), 'Slide deleted.');
    await ui.press(ui.tab('Announcements'));
    assert.strictEqual(ui.toast().length, 1, 'the toast outlives a tab switch');
    await act(async () => { ui.r.unmount(); });
  });

  await t('many pictures in one drop: one slide each, in file-name order, after the others — then one click shows them all', async () => {
    const ui = await page();
    await ui.press(ui.tab('Slides'));
    const file = (name, type = 'image/jpeg') => ({ name, type });
    const files = [file('slide 10.jpg'), file('slide 2.png', 'image/png'), file('notes.pdf', 'application/pdf'), file('slide 1.webp', 'image/webp')];
    // (was a drop on the .ax-bl-dropzone div's own onDrop: the whole list pane takes drops now, through
    // one window listener — see "a drop that misses")
    const e = await ui.drop('.ax-bl-list', files);
    assert.ok(e.defaultPrevented, 'the browser doesn’t open the dropped file');
    await act(async () => { await wait(60); });
    assert.deepStrictEqual(ui.rows().slice(4), ['Slide 5', 'Slide 6', 'Slide 7'], 'three new slides at the end (the PDF is left out)');
    const added = db.rows.filter((r) => /^slide[5-7]$/.test(r.id)).sort((a, b) => a.sort - b.sort);
    assert.deepStrictEqual(added.map((r) => decodeURIComponent(r.image_url.split('/').pop())), ['slide 1.webp.jpg', 'slide 2.png.jpg', 'slide 10.jpg.jpg'], 'in file-name order: 1, 2, 10');
    assert.deepStrictEqual(added.map((r) => r.sort), [50, 60, 70], 'ascending, after the last slide');
    assert.ok(added.every((r) => r.published === false), 'hidden until someone says so, like a New slide');
    assert.strictEqual(ui.picked(), 'Slide 5', 'the first new one is picked');
    assert.ok(/“notes\.pdf” isn’t a picture/.test(ui.all('ax-alert').map(words).join(' ')), 'what was left out, and why');
    const drop = ui.one('ax-bl-drop');
    assert.ok(/3 new slides — hidden for now/.test(words(drop)));
    await act(async () => { ui.button('Show all 3 in the Bulletin').props.onClick(); });
    await act(async () => { await wait(20); });
    assert.ok(db.rows.filter((r) => /^slide[5-7]$/.test(r.id)).every((r) => r.published === true), 'all three are in the Bulletin');
    assert.ok(!/hidden for now/.test(words(ui.one('ax-bl-drop'))), 'and the card goes back to taking pictures');
    assert.strictEqual(words(ui.fold('Slides').find((n) => has(n, 'ax-bl-fold-count'))), '5 slides', 'the phone counts them');
    // a picture that won't upload leaves no empty slide behind
    const before = db.rows.length;
    await ui.drop('.ax-bl-list', [{ name: 'huge.png', type: 'image/png', broken: true }]);
    await act(async () => { await wait(30); });
    assert.strictEqual(db.rows.length, before);
    assert.strictEqual(ui.rows().length, 7);
    assert.ok(/1 picture couldn’t be added: “huge\.png” \(The upload failed\)/.test(ui.all('ax-alert').map(words).join(' ')));
    await act(async () => { ui.r.unmount(); });
  });

  await t('search and filters on both lists; a filtered slide list can’t be dragged (it would lose the hidden ones)', async () => {
    const ui = await page();
    await ui.type(ui.root.find((n) => n.type === 'input' && n.props.type === 'search'), 'supper');
    assert.deepStrictEqual(ui.rows(), ['Wednesday Night Supper']);
    await act(async () => { ui.button('New announcement').props.onClick(); });
    assert.strictEqual(ui.rows()[0], 'New announcement', 'New clears the search so the new one shows');
    await ui.press(ui.root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n).startsWith('Drafts')));
    assert.deepStrictEqual(ui.rows(), ['New announcement', 'Missions Offering (draft)']);
    await ui.press(ui.tab('Slides'));
    assert.ok(ui.root.findAll((n) => has(n, 'ax-grip')).length === 4, 'the whole list drags');
    await ui.type(ui.root.find((n) => n.type === 'input' && n.props.type === 'search'), 'pic');
    assert.deepStrictEqual(ui.rows(), ['The picnic']);
    assert.strictEqual(ui.root.findAll((n) => has(n, 'ax-grip')).length, 0, 'no dragging while it is searched');
    assert.ok(/Clear the search and filter to drag/.test(words(ui.one('ax-list-hint'))));
    await act(async () => { ui.r.unmount(); });
  });

  await t('the Slides phone: the slides row with the picked one outlined, flagged when members won’t see it; its folds open the other tab', async () => {
    const ui = await page();
    await ui.press(ui.tab('Slides'));
    const shots = () => ui.phone().findAll((n) => has(n, 'ax-bl-slide-shot'));
    assert.strictEqual(shots().length, 2);
    assert.ok(cls(shots()[0]).includes('ax-pa-picked'), 'the picked slide is outlined');
    assert.deepStrictEqual(shots()[0].props.style, { backgroundImage: 'url("https://x.org/1.jpg")' }, 'the only inline style: the picture');
    await ui.press(ui.row('Hidden one'));
    const hidden = shots().find((n) => cls(n).includes('ax-pa-picked'));
    assert.strictEqual(words(hidden.find((n) => has(n, 'ax-pa-flag'))), 'Not in the Bulletin');
    // a slide pinned to another Sunday: the phone shows the Bulletin as it looked (or will look) that Sunday
    await ui.press(ui.row('Last month'));
    const then = shots().find((n) => cls(n).includes('ax-pa-picked'));
    assert.strictEqual(then.findAll((n) => has(n, 'ax-pa-flag')).length, 0, 'members saw it that Sunday');
    assert.strictEqual(words(ui.phone().find((n) => has(n, 'ax-bl-plate-date'))), 'Sunday, Jan 5');
    assert.strictEqual(words(ui.phone().find((n) => has(n, 'ax-bl-plate-kicker'))), 'THIS SUNDAY', 'as the app said on the day');
    assert.deepStrictEqual(shots().map((n) => n.props.style.backgroundImage), ['url("https://x.org/1.jpg")', 'url("https://x.org/3.jpg")'], 'that Sunday’s slides, and the undated one');
    assert.ok(ui.all('ax-hint').some((n) => words(n) === 'As it looked on Sunday, Jan 5 — the Sunday this slide belongs to.'));
    // pinned to a day that isn't a Sunday, it would never show: the editor and the phone both say so
    const date = ui.root.find((n) => n.type === 'input' && n.props.type === 'date');
    await ui.type(date, '2020-01-08');
    assert.ok(ui.all('ax-hint').some((n) => /^That’s a Wednesday\. The app shows a slide only on the Sunday it belongs to/.test(words(n))));
    assert.strictEqual(words(shots().find((n) => cls(n).includes('ax-pa-picked')).find((n) => has(n, 'ax-pa-flag'))), 'Not a Sunday');
    assert.notStrictEqual(words(ui.phone().find((n) => has(n, 'ax-bl-plate-date'))), 'Wednesday, Jan 8', 'the phone stays on a real Sunday');
    // clicking a slide on the phone picks it in the list
    const first = ui.phone().findAll((n) => has(n, 'ax-bl-slide'))[0];
    await ui.press(first);
    assert.strictEqual(ui.picked(), 'Welcome!');
    // the Announcements fold is closed here, with its count; clicking it opens that tab
    const notices = ui.fold('Announcements');
    assert.strictEqual(notices.findAll((n) => has(n, 'ax-bl-fold-body')).length, 0);
    await ui.press(notices.find((n) => has(n, 'ax-bl-fold-head')));
    assert.ok(cls(ui.tab('Announcements')).includes(' on'));
    // the draft, when picked, shows on the phone with Pillar's flag — a class, not the old inline style
    await ui.press(ui.row('Missions Offering (draft)'));
    const draft = ui.phone().find((n) => has(n, 'ax-bl-notice') && cls(n).includes('ax-pa-picked'));
    const flag = draft.find((n) => has(n, 'ax-pa-flag'));
    assert.strictEqual(words(flag), 'Not in the Bulletin');
    assert.strictEqual(flag.props.style, undefined);
    await act(async () => { ui.r.unmount(); });
  });

  await t('N makes a new one on the tab you are on; ⌘S saves now', async () => {
    const ui = await page();
    await act(async () => { key('n'); });
    assert.strictEqual(ui.rows()[0], 'New announcement');
    await ui.type(ui.input('title'), 'Quick one');
    await act(async () => { key('s', { metaKey: true }); });
    await act(async () => { await wait(10); });
    assert.ok(server.calls.some((c) => c[0] === 'save' && c[1].title === 'Quick one'), '⌘S saved it without waiting');
    await ui.press(ui.tab('Slides'));
    await act(async () => { key('n'); });
    assert.strictEqual(ui.rows().length, 5, 'a new slide, at the end');
    assert.strictEqual(ui.picked(), 'Slide 5');
    await act(async () => { ui.r.unmount(); });
  });

  await t('the Calendar and Group Events folds count what the app counts, in its words; a read Pillar can’t make leaves the line off', async () => {
    // the counting itself, against the app's rules (BulletinScreen weekOf + churchCalendar normalize;
    // the group_posts read policy + utils/groupPosts clean + its limit of 50)
    assert.strictEqual(Page.weekCount(EVENTS, new Date()), 3, 'today, running through today, Saturday — not yesterday, not last week, not next Sunday');
    assert.strictEqual(Page.groupCount(POSTS, new Date()), 2, 'published, in their window, with a title');
    assert.strictEqual(Page.groupCount(Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, title: `Card ${i}`, published: true })), new Date()), 50, 'the app reads 50 at most');
    const countOf = (ui, title) => { const c = ui.fold(title).findAll((n) => has(n, 'ax-bl-fold-count')); return c.length ? words(c[0]) : null; };

    const ui = await page();
    assert.strictEqual(countOf(ui, "This Week's Calendar"), '3 on the calendar');
    assert.strictEqual(countOf(ui, 'Group Events'), '2 from the groups');
    assert.deepStrictEqual(calendar.asked, [isoOf(new Date())], 'the calendar is read once, from today, as the app reads it');
    assert.strictEqual(posts.reads, 1);
    await ui.press(ui.tab('Slides'));
    await ui.press(ui.tab('Announcements'));
    assert.deepStrictEqual([calendar.asked.length, posts.reads], [1, 1], 'a tab switch reads nothing again');
    // a slide pinned to another Sunday draws that Sunday: its week is read for it, and only the count
    // line waits for that read — the phone never blanks to a spinner
    await ui.press(ui.tab('Slides'));
    await ui.press(ui.row('Last month'));
    assert.ok(ui.phone().findAll((n) => has(n, 'ax-bl-slide-shot')).length > 0, 'the slides stay drawn');
    await ui.settle(20);
    assert.deepStrictEqual(calendar.asked, [isoOf(new Date()), '2020-01-05']);
    assert.strictEqual(countOf(ui, "This Week's Calendar"), 'Nothing on the calendar', 'nothing on that week');
    await ui.press(ui.row('Welcome!'));
    assert.strictEqual(countOf(ui, "This Week's Calendar"), '3 on the calendar', 'back to this week, without reading it again');
    assert.strictEqual(calendar.asked.length, 2);
    await act(async () => { ui.r.unmount(); });

    // nothing on: the app's own "Nothing …" lines
    const empty = await page({ setup: () => { calendar.rows = []; posts.rows = []; } });
    assert.strictEqual(countOf(empty, "This Week's Calendar"), 'Nothing on the calendar');
    assert.strictEqual(countOf(empty, 'Group Events'), 'Nothing from the groups');
    await act(async () => { empty.r.unmount(); });

    // Pillar can't read them: no count line at all (never invented words), and the phone still draws
    const failed = await page({ setup: () => { calendar.fail = true; posts.fail = true; } });
    assert.strictEqual(countOf(failed, "This Week's Calendar"), null);
    assert.strictEqual(countOf(failed, 'Group Events'), null);
    assert.strictEqual(countOf(failed, 'Announcements'), '5 this week');
    await act(async () => { failed.r.unmount(); });
  });

  await t('the phone waits, as the app does, for the announcements AND the calendar — with iOS’s own activity indicator', async () => {
    const ui = await page({ setup: () => { calendar.delay = 60; } });
    const spin = ui.phone().findAll((n) => has(n, 'ax-bl-activity'));
    assert.strictEqual(spin.length, 1, 'the app’s `loading` holds for its calendar too');
    const spokes = spin[0].findAll((n) => n.type === 'line');
    assert.strictEqual(spokes.length, 8, 'eight spokes, as UIActivityIndicatorView draws');
    const fade = spokes.map((n) => Number(n.props.opacity));
    assert.ok(fade.every((o, i) => i === 0 || o > fade[i - 1]) && fade[7] === 1, 'each a step darker, to the head');
    assert.strictEqual(spin[0].props['aria-label'], 'Loading');
    assert.strictEqual(ui.phone().findAll((n) => has(n, 'ax-bl-fold')).length, 0);
    await ui.settle(90);
    assert.strictEqual(ui.phone().findAll((n) => has(n, 'ax-bl-activity')).length, 0);
    assert.strictEqual(ui.phone().findAll((n) => has(n, 'ax-bl-fold')).length, 4);
    await act(async () => { ui.r.unmount(); });
  });

  await t('pictures dropped while a batch is still going up join it: one card, one count, one “Show all”', async () => {
    const ui = await page();
    await ui.press(ui.tab('Slides'));
    const slow = (name) => ({ name, type: 'image/jpeg', slow: 40 });
    await ui.drop('.ax-bl-list', [slow('a 1.jpg'), slow('a 2.jpg'), slow('a 3.jpg')]);
    await ui.settle(10);
    assert.ok(/Adding 3 slides…/.test(words(ui.one('ax-bl-drop'))));
    assert.strictEqual(ui.picked(), 'Slide 5', 'the first new one is picked');
    await ui.drop('.ax-bl-list', [slow('b 1.jpg'), slow('b 2.jpg')]);
    const busy = words(ui.one('ax-bl-drop'));
    assert.ok(/Adding 5 slides…/.test(busy), `the same card counts all five (${busy})`);
    assert.ok(/0 of 5 uploaded/.test(busy), 'the first three are still being counted');
    assert.strictEqual(ui.picked(), 'Slide 5', 'joining doesn’t move the pick');
    assert.deepStrictEqual(ui.rows().slice(4), ['Slide 5', 'Slide 6', 'Slide 7', 'Slide 8', 'Slide 9'], 'after the others, in order');
    await ui.settle(200);
    assert.ok(/5 new slides — hidden for now/.test(words(ui.one('ax-bl-drop'))), 'one offer for both drops');
    const added = () => db.rows.filter((r) => /\/(a|b)%20\d\.jpg\.jpg$/.test(r.image_url));
    assert.strictEqual(added().length, 5);
    assert.ok(added().every((r) => r.published === false));
    assert.deepStrictEqual(added().sort((x, y) => x.sort - y.sort).map((r) => decodeURIComponent(r.image_url.split('/').pop())),
      ['a 1.jpg.jpg', 'a 2.jpg.jpg', 'a 3.jpg.jpg', 'b 1.jpg.jpg', 'b 2.jpg.jpg']);
    await act(async () => { ui.button('Show all 5 in the Bulletin').props.onClick(); });
    await ui.settle(20);
    assert.ok(added().every((r) => r.published === true), 'all five are in the Bulletin');
    // a drop after a batch has finished but before its "Show all": the offer grows to cover both
    await ui.drop('.ax-bl-list', [{ name: 'c 1.jpg', type: 'image/jpeg' }]);
    await ui.settle(30);
    assert.ok(/1 new slide — hidden for now/.test(words(ui.one('ax-bl-drop'))));
    await ui.drop('.ax-bl-list', [{ name: 'c 2.jpg', type: 'image/jpeg' }]);
    await ui.settle(30);
    assert.ok(/2 new slides — hidden for now/.test(words(ui.one('ax-bl-drop'))));
    await act(async () => { ui.r.unmount(); });
  });

  await t('a drop that misses the list is refused, never opened in place of Pillar — on both tabs; a box that took it is left alone', async () => {
    const ui = await page();
    const pic = [{ name: 'stray.jpg', type: 'image/jpeg' }];
    const before = db.rows.length;
    // Announcements: nowhere takes pictures, and the browser mustn't navigate to one
    let e;
    await act(async () => { e = dragEvent('dragover', null); });
    assert.ok(e.defaultPrevented && e.dataTransfer.dropEffect === 'none', 'the pointer says no');
    e = await ui.drop(null, pic);
    assert.ok(e.defaultPrevented, 'the browser doesn’t open it');
    await ui.press(ui.tab('Slides'));
    // over the list pane — its head, its padding, anywhere — the whole pane lights up and takes it
    await act(async () => { e = dragEvent('dragover', '.ax-bl-list'); });
    assert.ok(e.defaultPrevented && e.dataTransfer.dropEffect === 'copy');
    assert.ok(cls(ui.one('ax-bl-list')).split(' ').includes('over'), 'the whole list pane is the target');
    assert.ok(/Let go to add them/.test(words(ui.one('ax-bl-drop'))));
    // off it (the editor, the phone…): refused, and the list stops lighting up
    await act(async () => { e = dragEvent('dragover', null); });
    assert.ok(e.defaultPrevented && e.dataTransfer.dropEffect === 'none');
    assert.ok(!cls(ui.one('ax-bl-list')).split(' ').includes('over'));
    e = await ui.drop(null, pic);
    assert.ok(e.defaultPrevented);
    await ui.settle(30);
    assert.strictEqual(db.rows.length, before, 'nothing added');
    assert.strictEqual(ui.rows().length, 4);
    // a box below that takes its own drop (the editor's picture box) is left alone — never taken twice
    await act(async () => { e = dragEvent('dragover', null, [], { defaultPrevented: true }); });
    assert.strictEqual(e.dataTransfer.dropEffect, 'copy', 'its answer stands');
    await ui.drop('.ax-bl-list', pic);
    await act(async () => { dragEvent('drop', '.ax-bl-list', [{ name: 'taken.jpg', type: 'image/jpeg' }], { defaultPrevented: true }); });
    await ui.settle(30);
    assert.ok(!uploads.includes('taken.jpg'), 'a drop something else took isn’t added again');
    assert.ok(uploads.includes('stray.jpg'), 'the one dropped on the list is');
    // leaving the window clears the light
    await act(async () => { dragEvent('dragover', '.ax-bl-list'); });
    await act(async () => { dragEvent('dragleave', null, [], { relatedTarget: null }); });
    assert.ok(!cls(ui.one('ax-bl-list')).split(' ').includes('over'));
    await act(async () => { ui.r.unmount(); });
    // the listener goes with the page
    assert.strictEqual([...(listeners.drop || [])].length, 0, 'no drop listener left behind');

    // slides still loading: the drop is refused with a reason, not silently
    const loading = await page({ setup: () => { db.selectDelay = 60; } });
    await loading.press(loading.tab('Slides'));
    e = await loading.drop('.ax-bl-list', pic);
    assert.ok(e.defaultPrevented);
    assert.ok(/The slides are still loading — drop the pictures again in a moment\./.test(loading.alerts()));
    await loading.settle(90);
    await act(async () => { loading.r.unmount(); });
  });

  await t('a slides batch’s trouble shows on Announcements too, one click from Slides', async () => {
    const ui = await page();
    await ui.press(ui.tab('Slides'));
    await ui.drop('.ax-bl-list', [{ name: 'huge.png', type: 'image/png', broken: true, slow: 30 }, { name: 'notes.pdf', type: 'application/pdf' }]);
    await ui.press(ui.tab('Announcements'));   // "Keep working — even on Announcements"
    await ui.settle(60);
    assert.ok(/Slides: 1 picture couldn’t be added: “huge\.png” \(The upload failed\)\. “notes\.pdf” isn’t a picture/.test(ui.alerts()), ui.alerts());
    await ui.press(ui.button('See the slides'));
    assert.ok(cls(ui.tab('Slides')).includes(' on'), 'one click to the Slides tab');
    assert.ok(/^1 picture couldn’t be added/.test(ui.alerts()), 'said plainly there');
    await act(async () => { ui.all('ax-alert')[0].find((n) => n.type === 'button' && words(n) === 'Dismiss').props.onClick(); });
    assert.strictEqual(ui.alerts(), '');
    await act(async () => { ui.r.unmount(); });
  });

  await t('a picture chosen in the editor saves when its upload lands — even after the office has picked another slide', async () => {
    const ui = await page();
    await ui.press(ui.tab('Slides'));
    assert.strictEqual(ui.picked(), 'Welcome!');
    const box = () => ui.root.find((n) => n.type === 'input' && n.props.type === 'file' && !n.props.multiple);
    await act(async () => { box().props.onChange({ target: { files: [{ name: 'new welcome.png', type: 'image/png', slow: 40 }], value: '' } }); });
    await ui.press(ui.row('The picnic'));   // moves on while it's still going up: that editor (and its autosave) is gone
    await ui.settle(80);
    const a1 = db.calls.filter((c) => c.op === 'update' && c.eq && c.eq[1] === 'a1');
    assert.strictEqual(a1.length, 1, 'the first slide is saved, once');
    assert.ok(/new%20welcome\.png\.jpg$/.test(a1[0].row.image_url));
    assert.strictEqual(db.rows.find((r) => r.id === 'a1').image_url, a1[0].row.image_url, 'the database has the new picture');
    assert.ok(!/Not saved/.test(words(ui.row('Welcome!'))));
    // with the editor still open it's saved once too — the autosave finds nothing left to do
    await act(async () => { box().props.onChange({ target: { files: [{ name: 'picnic 2.png', type: 'image/png' }], value: '' } }); });
    await ui.settle();
    assert.strictEqual(db.calls.filter((c) => c.op === 'update' && c.eq && c.eq[1] === 'a2').length, 1);
    await act(async () => { ui.r.unmount(); });
  });

  await t('Delete while a first save is on its way waits for it, then deletes what it made — announcements and slides', async () => {
    const ui = await page();
    await act(async () => { ui.button('New announcement').props.onClick(); });
    await ui.type(ui.input('title'), 'Gone in a moment');
    server.delay = 40;
    await act(async () => { key('s', { metaKey: true }); });   // ⌘S: the first save sets off at once
    await ui.settle(5);
    const sent = server.calls.find((c) => c[0] === 'save' && c[1].title === 'Gone in a moment');
    assert.ok(sent, 'on its way');
    await act(async () => { ui.root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Delete announcement').props.onClick(); });
    await ui.settle(80);
    assert.deepStrictEqual(server.calls.filter((c) => c[0] === 'delete').map((c) => c[1]), [sent[1].id], 'the one it made is deleted');
    assert.ok(!server.list.some((a) => a.id === sent[1].id), 'no draft comes back on the next load');
    assert.ok(!ui.rows().includes('Gone in a moment'));
    assert.strictEqual(ui.toast().length, 1, 'Undo is offered, as for any delete');
    // a draft that never left: nothing to delete
    server.delay = 0;
    await act(async () => { ui.button('New announcement').props.onClick(); });
    await act(async () => { ui.root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Delete announcement').props.onClick(); });
    await ui.settle(10);
    assert.strictEqual(server.calls.filter((c) => c[0] === 'delete').length, 1);

    // a new slide whose picture is up and whose insert has landed, but not answered
    await ui.press(ui.tab('Slides'));
    await act(async () => { key('n'); });
    db.delay = 40;
    await act(async () => {
      ui.root.find((n) => n.type === 'input' && n.props.type === 'file' && !n.props.multiple)
        .props.onChange({ target: { files: [{ name: 'quick.jpg', type: 'image/jpeg' }], value: '' } });
    });
    await ui.settle(15);
    assert.ok(db.rows.some((r) => /quick\.jpg/.test(r.image_url)), 'the insert has landed');
    await act(async () => { ui.root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Delete slide').props.onClick(); });
    await ui.settle(100);
    assert.ok(!db.rows.some((r) => /quick\.jpg/.test(r.image_url)), 'the hidden slide it made is deleted too');
    assert.ok(db.calls.some((c) => c.op === 'delete' && c.eq && c.eq[1] === 'slide5'));
    db.delay = 0;
    await act(async () => { ui.r.unmount(); });
  });

  await t('no static inline styles in the page’s code; nothing tests can’t load', async () => {
    for (const f of ['BulletinPage.jsx', 'SlidesView.jsx']) {
      const src = fs.readFileSync(path.join(PILLAR, 'src/pages/app', f), 'utf8');
      assert.ok(!/import\.meta/.test(src), `${f}: no import.meta`);
      const styles = [...src.matchAll(/style=\{/g)].map((m) => src.slice(m.index, m.index + 90));
      assert.ok(styles.length > 0);
      for (const s of styles) assert.ok(/^style=\{(f\.image_url \? \{ backgroundImage: cssUrl|\{ width: `\$\{pct\}%` \}\})/.test(s), `${f}: only a picture or a progress width inline (${s})`);
      assert.ok(!/position: 'static'|background: '#fff'/.test(src), `${f}: the old badge’s inline style is gone`);
    }
    assert.strictEqual(Slides.nextSort([{ sort: 10 }, { sort: 40 }]), 50, 'after the last one, even with a gap');
    assert.strictEqual(Slides.nextSort([]), 10);
    assert.strictEqual(Slides.dayWords('2026-09-20'), 'Sunday, Sep 20');
  });

  await t('the phone copies the member app’s Bulletin: bulletin.css has BulletinScreen.js’s own numbers, fonts and colours', () => {
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/bulletin.css'), 'utf8');
    const appSrc = path.join(APP, 'screens/BulletinScreen.js');
    if (!fs.existsSync(appSrc)) { console.log('    (the app repo isn’t beside Pillar — set BETHESDA_APP to check against it)'); return; }
    const app = fs.readFileSync(appSrc, 'utf8');
    const styleOf = (name) => {
      const m = new RegExp(`\\n\\s+${name}:\\s*\\{([^}]*)\\}`).exec(app);
      assert.ok(m, `the app still has s.${name}`);
      const out = {};
      for (const [, k, v] of m[1].matchAll(/(\w+):\s*('[^']*'|[^,]+)/g)) out[k] = v.trim();
      return out;
    };
    const ruleOf = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`).exec(css);
      assert.ok(m, `bulletin.css has ${sel}`);
      const out = {};
      for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
      for (const box of ['margin', 'padding']) {
        if (!out[box]) continue;
        const v = out[box].split(/\s+/);
        const [t, r, b, l] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v;
        Object.assign(out, { [`${box}-top`]: t, [`${box}-right`]: r, [`${box}-bottom`]: b, [`${box}-left`]: l });
      }
      return out;
    };
    const px = (v) => (v === '0' ? 0 : Number(String(v).replace(/px$/, '')));
    const NUM = { marginTop: 'margin-top', marginBottom: 'margin-bottom', paddingTop: 'padding-top', paddingBottom: 'padding-bottom',
      paddingRight: 'padding-right', padding: 'padding-top', borderRadius: 'border-radius', width: 'width', height: 'height',
      minHeight: 'min-height', gap: 'gap', fontSize: 'font-size', lineHeight: 'line-height', letterSpacing: 'letter-spacing' };
    const COLOUR = { 'C.text': 'var(--ax-app-text)', 'C.text2': 'var(--ax-app-text2)', 'C.text3': 'var(--ax-app-text3)', 'C.card': 'var(--ax-app-card)',
      'C.bg': 'var(--ax-app-bg)', 'C.panel': 'var(--ax-app-panel)', 'site.orangeD': 'var(--ax-app-orange-d)', "'#fff'": '#FFFFFF', "'rgba(255,255,255,0.72)'": 'rgba(255, 255, 255, 0.72)' };
    const PAIRS = {
      plate: '.ax-bl-plate', plateKicker: '.ax-bl-plate-kicker', plateDate: '.ax-bl-plate-date', folds: '.ax-bl-folds',
      fold: '.ax-bl-fold', foldHead: '.ax-bl-fold-head', disc: '.ax-bl-disc', foldTitle: '.ax-bl-fold-title', foldCount: '.ax-bl-fold-count',
      foldBody: '.ax-bl-fold-body', lNotice: '.ax-bl-notice', noticeHead: '.ax-bl-notice-head', tag: '.ax-bl-tag', noticeWhen: '.ax-bl-when',
      lNoticeTitle: '.ax-bl-notice-title', noticeBody: '.ax-bl-notice-body', empty: '.ax-bl-empty', slideRow: '.ax-bl-slides', slide: '.ax-bl-slide',
      slideShot: '.ax-bl-slide-shot', slideCap: '.ax-bl-slide-cap', take: '.ax-bl-take', takeBox: '.ax-bl-take-box', mailDisc: '.ax-bl-take-disc',
      mailTitle: '.ax-bl-take-title', mailSub: '.ax-bl-take-sub',
    };
    let checked = 0;
    for (const [name, sel] of Object.entries(PAIRS)) {
      const a = styleOf(name);
      const c = ruleOf(sel);
      for (const [k, v] of Object.entries(a)) {
        if (NUM[k] && /^-?\d+(\.\d+)?$/.test(v)) {
          // (slideRow's padding used to be skipped here: the row was widened 7pt past the fold on every
          // side for the picked outline, so it showed more than the app. It's the app's own now)
          assert.strictEqual(px(c[NUM[k]]), Number(v), `${sel} ${NUM[k]}: the app's ${name}.${k} is ${v}`);
          checked++;
        }
        if (k === 'fontFamily') {
          const w = /_(\d{3})/.exec(v);
          assert.strictEqual(c['font-weight'], w[1], `${sel}: ${v} is Be Vietnam Pro ${w[1]}`);
          checked++;
        }
        if ((k === 'color' || k === 'backgroundColor') && COLOUR[v]) {
          const got = String(c[k === 'color' ? 'color' : 'background'] || '');
          assert.ok(k === 'color' ? got === COLOUR[v] : got.startsWith(COLOUR[v]), `${sel} ${k}: the app's ${v} (bulletin.css has ${got || 'nothing'})`);
          checked++;
        }
      }
    }
    assert.ok(checked > 60, `checked ${checked} of the app's values`);
    // the slides row is the fold body's own box, as the app's ScrollView is: nothing reaches past it
    const row = ruleOf('.ax-bl-slides');
    assert.ok(!row.margin && !row['margin-left'], 'no negative margin: the row is clipped where the app’s is');
    assert.deepStrictEqual([row['padding-top'], row['padding-right'], row['padding-bottom'], row['padding-left']], ['0', '4px', '0', '0']);
    assert.ok(/\n\.ax-bl-slide-shot\.ax-pa-picked \{ outline-offset: -3px; \}/.test(css), 'the picked slide’s outline is drawn inside the picture');
    assert.ok(/\.ax-bl-slide\[role="button"\]:focus-visible \.ax-bl-slide-shot \{[^}]*outline-offset: -3px;/.test(css), 'and so is the focus ring');
    // the loading mark is iOS's ActivityIndicator: 20pt, stepping round in eight, in text3
    const spin = ruleOf('.ax-bl-activity');
    assert.deepStrictEqual([spin.width, spin.height, spin.color], ['20px', '20px', 'var(--ax-app-text3)']);
    assert.ok(/steps\(8, end\)/.test(spin.animation), 'eight steps, one per spoke');
    assert.ok(/ActivityIndicator color=\{C\.text3\}/.test(app), 'the app’s own is text3');
    // the fold icons, what an empty fold says and the count lines are the app's own words
    const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/BulletinPage.jsx'), 'utf8');
    for (const said of ['Nothing from the office yet this week.', 'The slides shown in the service will appear here once the office posts them.',
      'From the service', 'this week', 'THIS PAST SUNDAY', 'A copy to your inbox', 'Print it for the week',
      ' on the calendar`', "'Nothing on the calendar'", ' from the groups`', "'Nothing from the groups'"]) {
      assert.ok(app.includes(said), `the app says “${said}”`);
      assert.ok(page.includes(said), `and so does the phone: “${said}”`);
    }
    for (const invented of ['From Pillar’s Calendar', 'From the groups’ cards']) {
      assert.ok(!page.includes(invented), `the phone no longer says “${invented}”, which the app never does`);
    }
    for (const icon of ['bell', 'calendar', 'users', 'monitor']) assert.ok(app.includes(`icon="${icon}"`), `the app's ${icon} fold`);
  });

  console.error = oe;
  const bad = errs.filter((e) => !/act\(|not wrapped|react-test-renderer is deprecated/.test(e));
  assert.deepStrictEqual(bad, [], 'React said nothing wrong');
  console.log(`${ok} bulletin checks passed`);
})().catch((e) => { process.stderr.write(`${e && e.stack ? e.stack : e}\n`); process.exit(1); });
