// Pillar → App → Home after the redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §4 Home):
// src/pages/app/HomePage.jsx on the shared workspace (layout.jsx) — cards · the one being changed · the
// phone — and css/home.css.
//
//   · New card goes FIRST and is picked, with a sort before every other card that it carries into its
//     first save; Duplicate makes a draft copy the same way
//   · search and the filters (All · On phones · Scheduled · Drafts · Ended), and dragging only while
//     every card is in view (the order is phones' order)
//   · a video upload is never lost silently: New, Duplicate, Delete, the Shortcuts tab and picking another
//     card all ask first
//   · the phone is the app's Home screen: the four round shortcuts (Members for a member, Groups — or the
//     office's word — for a visitor), ONE card, the Announcements row with the calendar's featured events
//     first, What's Happening; per-audience counts; the right badge (never "not on phones" for a card
//     that's in Announcements); a click on it opens what was clicked, from either tab; the card opened
//     as a member sees it when they tap it
//   · Shortcuts: all four forms at once, each saving itself; "Use the app's own words"; the not-set-up state
//   · the phone's numbers are HomeScreen.js's own, worked out from the app's constants
//
// After the adversarial check (2026-09-23), and the user's "make sure the phone mockups look just like
// the app":
//   · the picked kind says in words what it looks like on phones NOW, visibly, and describes the picker
//   · the list's line is the mockup's (kind · who, only when it isn't everyone · where), and the editor's
//     line comes from the same rules as the list and the phone — never "Everyone sees it now" for a card
//     phones don't show
//   · New waits for the cards to load; a video upload is asked about before a kind change drops it;
//     Delete during a first save still deletes; Delete with a filter on picks the next card SHOWN
//   · the card on top never opens to its whole announcement (the app runs its first button there); only
//     buttons the app keeps make the round button and the opened card's buttons
//   · the phone: "Hi <name>" for members, the app's own photos where the office gave none, a featured
//     event's room photo, the plate card's menu, a long shortcut word shrinking to fit, the spinner while
//     the calendar loads, YouTube's picture for the latest sermon, the Members shortcut turning the phone
//     to Visitors (where the Groups word shows), the head never pushing the switch away from the save state
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the app repo, for the checks that both sides agree
const OUT = path.join(__dirname, '.build-home'); fs.mkdirSync(OUT, { recursive: true });
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

// ── a pretend browser: key events on the window, a document for the fonts link ──
const listeners = {};
globalThis.window = {
  innerWidth: 1440,
  location: { origin: 'https://pillar.test' },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  localStorage: { getItem: () => null, setItem: () => {} },
};
globalThis.document = {
  activeElement: null,
  querySelector: () => null,
  createElement: (tag) => ({ tagName: tag }),
  getElementById: () => null,
  head: { appendChild: () => {} },
};
const key = (k, extra = {}) => { for (const fn of [...(listeners.keydown || [])]) fn({ type: 'keydown', key: k, target: {}, preventDefault() {}, ...extra }); };

// ── a pretend Supabase: the cards, the shortcuts and the calendar, with a record of every write ──
const DAY = 86400000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => iso(new Date(Date.now() + n * DAY));
const db = { app_home_cards: [], app_home_tiles: [], events: [], locations: [], sms_library: [], missing: new Set(), calls: [], slow: {} };
let n = 0;
function from(table) {
  const q = { op: 'select', row: null, eqs: [] };
  // a read (or an insert) that takes a moment: db.slow[table] for a table's reads, db.slow.insert for inserts
  const lag = () => (q.op === 'insert' ? db.slow.insert : q.op === 'select' ? db.slow[table] : 0) || 0;
  const later = () => (lag() ? wait(lag()) : Promise.resolve()).then(() => run());
  const run = () => {
    db.calls.push({ table, op: q.op, row: q.row && JSON.parse(JSON.stringify(q.row)), eqs: q.eqs.slice() });
    if (db.missing.has(table)) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
    const list = db[table];
    const hit = (r) => q.eqs.every(([k, v]) => r[k] === v);
    if (q.op === 'select') return { data: list.filter(hit).map((r) => ({ ...r })), error: null };
    if (q.op === 'insert') { const row = { id: `new${++n}`, ...q.row }; list.push(row); return { data: { ...row }, error: null }; }
    if (q.op === 'update') { const r = list.find(hit); Object.assign(r, q.row); return { data: { ...r }, error: null }; }
    if (q.op === 'upsert') {
      const r = list.find((x) => x.slot === q.row.slot);
      if (r) Object.assign(r, q.row); else list.push({ ...q.row });
      return { data: { ...q.row }, error: null };
    }
    db[table] = list.filter((r) => !hit(r));
    return { data: null, error: null };
  };
  const chain = {
    select() { return chain; }, order() { return chain; }, or() { return chain; }, lte() { return chain; }, limit() { return chain; },
    eq(k, v) { q.eqs.push([k, v]); return chain; },
    insert(row) { q.op = 'insert'; q.row = row; return chain; },
    update(row) { q.op = 'update'; q.row = row; return chain; },
    upsert(row) { q.op = 'upsert'; q.row = row; return chain; },
    delete() { q.op = 'delete'; return chain; },
    single() { return later(); },
    then(ok, bad) { return later().then(ok, bad); },
  };
  return chain;
}
const writes = (table) => db.calls.filter((c) => c.table === table && c.op !== 'select');

const React = require(path.join(DEPS, 'react'));
const h = React.createElement;
stub('./supabase', { supabase: { from, storage: { from: () => ({}) } } });
stub('./locations', { downscaleImage: async () => ({}) });
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
const asked = [];
const answers = [];
stub('../../lib/dialog', { confirmDialog: async ({ message }) => { asked.push(message); return answers.length ? answers.shift() : true; } });
stub('../../lib/videoUpload', {
  uploadVideo: () => new Promise(() => {}),   // an upload that is still on its way
  videoStill: async () => null, videoProblem: () => null, videoFacts: async () => ({}), tooHeavy: () => false,
  describeVideo: String, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: 'video/*',
});
// the office's Home photo and the Watch library, as each test sets them (seed() puts them back)
const extra = {};
stub('../../lib/pageHeaders', { listPageHeaders: async () => ({ home: extra.header }) });
stub('../../lib/appApi', { getSermons: async () => extra.sermons });
stub('../../lib/youtube', {
  youtubeThumbs: (u) => (/youtu/.test(String(u || '')) ? { max: 'https://i.ytimg.com/vi/x/maxresdefault.jpg', hq: 'https://i.ytimg.com/vi/x/hqdefault.jpg' } : null),
  youtubePicture: async (u) => (/youtu/.test(String(u || '')) ? 'https://i.ytimg.com/vi/x/maxresdefault.jpg' : null),
});
// whoever is signed in to Pillar: a member's Home says "Hi" to them
stub('../../context/AuthContext', { useAuth: () => ({ profile: extra.profile }) });
// the frame is the foundation's (tests/layout.test.cjs); here it's just the title and the tabs
stub('./AppShell', { __esModule: true, default: ({ title, tabs, children }) => h('div', { className: 'shell' },
  h('h1', null, title),
  tabs ? tabs.options.map((o) => h('button', { key: o.key, className: 'tab', 'data-tab': o.key, 'aria-pressed': tabs.value === o.key, onClick: () => tabs.onChange(o.key) }, o.label)) : null,
  children) });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
const { act } = React;
STUBS['../../lib/homeCards'] = xform(path.join(PILLAR, 'src/lib/homeCards.js'), 'homeCards.cjs');
STUBS['./homeCards'] = STUBS['../../lib/homeCards'];
STUBS['../../lib/homeTiles'] = xform(path.join(PILLAR, 'src/lib/homeTiles.js'), 'homeTiles.cjs');
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
const Home = require(xform(path.join(PILLAR, 'src/pages/app/HomePage.jsx'), 'HomePage.cjs'));
const HomePage = Home.default;

const errs = [];
const oe = console.error;
console.error = (...a) => { errs.push(a.map(String).join(' ')); };

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('  ✓', name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (node) => (typeof node === 'string' ? node : (node?.children || []).map(textOf).join(''));
const cls = (node) => String(node.props.className || '').split(/\s+/);
const has = (c) => (x) => typeof x.type === 'string' && cls(x).includes(c);

// the church, as the tests find it: eight cards in every state, one shortcut changed, two events
function seed() {
  db.app_home_cards = [
    card('c1', 10, { title: 'Fall Festival', kicker: 'This Saturday', subtitle: 'Games, food & a hayride', image_url: 'https://x.org/fest.jpg',
      body: 'Bring the whole family.', buttons: [{ label: 'RSVP', action: 'url', target: 'https://x.org/rsvp' }, { label: 'Calendar', action: 'page', target: 'Calendar' }] }),
    card('c2', 20, { kind: 'dinner' }),
    card('c3', 30, { kind: 'welcome', audience: 'signed_out' }),
    card('c4', 40, { kind: 'video', title: 'Baptism Sunday', video_url: 'https://youtu.be/abcdefgh' }),
    card('c5', 50, { kind: 'text', title: 'Pray for the Garcias', audience: 'signed_in' }),
    card('c6', 60, { title: 'Youth lock-in', image_url: 'https://x.org/y.jpg', starts_on: '2099-10-03' }),
    card('c7', 70, { title: 'VBS thank-you', image_url: 'https://x.org/v.jpg', ends_on: '2020-08-30' }),
    card('c8', 80, { kind: 'text', title: 'Choir signup', published: false }),
  ];
  db.app_home_tiles = [{ slot: 'connect', title: 'Connect', subtitle: null, image_url: null }];
  db.events = [
    { id: 'e1', title: 'Revival', calendar: 'church', is_private: false, start_date: inDays(10), end_date: null, start_time: '18:00', end_time: '20:00', location: 'Sanctuary', featured: true, image_url: 'https://x.org/rev.jpg' },
    { id: 'e2', title: 'Choir practice', calendar: 'church', is_private: false, start_date: inDays(1), end_date: null, start_time: null, end_time: null, location: 'Choir room', featured: false },
  ];
  db.locations = [];
  db.sms_library = [];
  db.missing = new Set();
  db.calls = [];
  db.slow = {};
  extra.header = 'https://x.org/header.jpg';
  extra.sermons = [
    { id: 's1', title: 'Older', date: 'Sep 7, 2026', thumbnailUrl: 'https://x.org/old.jpg', published: true },
    { id: 's2', title: 'The Son Who Stayed Home', date: 'Sep 14, 2026', thumbnailUrl: 'https://x.org/son.jpg', published: true },
    { id: 's3', title: 'A draft', date: 'Sep 21, 2026', thumbnailUrl: '', published: false },
  ];
  extra.profile = { name: 'Brody Espiritu' };
}
const card = (id, sort, o) => ({ id, kind: 'image', audience: 'everyone', kicker: null, title: null, subtitle: null, body: null,
  image_url: null, video_url: null, buttons: [], starts_on: null, ends_on: null, published: true, sort, ...o });

async function page() {
  let r;
  await act(async () => { r = TR.create(h(HomePage)); });
  await act(async () => { await wait(20); });
  const root = r.root;
  const ui = {
    r, root,
    tab: (k) => root.find((x) => x.type === 'button' && x.props['data-tab'] === k),
    list: () => root.find(has('ax-list-pane')),
    rows: () => ui.list().findAll(has('ax-row')),
    titles: () => ui.list().findAll(has('ax-row-title')).map(textOf),
    subs: () => ui.list().findAll(has('ax-row-sub')).map(textOf),
    row: (title) => ui.rows().find((x) => textOf(x.find(has('ax-row-title'))) === title),
    filter: (label) => ui.list().find((x) => x.type === 'button' && has('ax-filter')(x) && textOf(x).startsWith(label)),
    search: () => ui.list().find((x) => x.type === 'input' && x.props.type === 'search'),
    editor: () => root.find(has('ax-editor-pane')),
    title: () => root.find((x) => x.type === 'input' && x.props.id === 'ax-home-title'),
    head: () => ui.editor().find(has('ax-editor-pane-head')),
    headbtn: (label) => ui.editor().find((x) => x.type === 'button' && x.props['aria-label'] === label),
    phone: () => root.find(has('ax-home-screen')),
    shortcuts: () => ui.phone().find(has('ax-pa-shortcuts')).findAll(has('ax-pa-shortcut-word')).map(textOf),
    timely: () => ui.phone().find(has('ax-home-timely')),
    ann: () => ui.phone().findAll(has('ax-home-anncard')),
    button: (label) => root.find((x) => x.type === 'button' && textOf(x).trim() === label),
    type: (node, value) => act(async () => { node.props.onChange({ target: { value } }); }),
    press: (node) => act(async () => { await node.props.onClick({ stopPropagation() {}, preventDefault() {} }); }),
    settle: () => act(async () => { await wait(900); }),   // past the 700 ms autosave
  };
  return ui;
}

(async () => {
  await t('the workspace: the cards, the one being changed, and the phone — the tabs keep their names', async () => {
    seed();
    const ui = await page();
    assert.deepStrictEqual(ui.root.findAll((x) => x.type === 'button' && x.props['data-tab']).map(textOf), ['Cards · 8', 'Shortcuts']);
    assert.ok(ui.root.find(has('ax-work')), 'the shared workspace (layout.jsx)');
    assert.ok(ui.root.find(has('ax-list-pane')) && ui.root.find(has('ax-editor-pane')) && ui.root.find(has('ax-preview-pane')), 'three panes');
    assert.deepStrictEqual(ui.titles(), ['Fall Festival', 'Wednesday plate', 'Welcome', 'Baptism Sunday', 'Pray for the Garcias',
      'Youth lock-in', 'VBS thank-you', 'Choir signup'], 'in phones’ order');
    assert.strictEqual(ui.title().props.value, 'Fall Festival', 'the first card is open');
    // the head: the save state and the kind (five icons), the switch, Duplicate and Delete (Fitts)
    const kinds = ui.head().find(has('ax-home-kind')).findAll((x) => x.type === 'button');
    assert.deepStrictEqual(kinds.map((b) => textOf(b)), ['Picture', 'Video', 'Words', 'Plate', 'Welcome']);
    assert.strictEqual(kinds[0].props['aria-checked'], true);
    assert.ok(ui.head().find(has('ax-sw-on')), 'the On phones switch, green when on');
    assert.ok(ui.headbtn('Duplicate card') && ui.headbtn('Delete card'));
    assert.ok(ui.editor().find(has('ax-cols')), 'words on one side, the picture, buttons and dates on the other');
    // From and Until are labelled, not just aria-labels
    const labels = ui.editor().findAll((x) => x.type === 'label' && has('ax-label')(x)).map(textOf);
    assert.ok(labels.includes('From') && labels.includes('Until'), labels.join(' | '));
    await act(async () => ui.r.unmount());
  });

  await t('filters and search narrow the list; the order can only be dragged with every card in view', async () => {
    seed();
    const ui = await page();
    const chips = ui.list().findAll((x) => x.type === 'button' && has('ax-filter')(x)).map(textOf);
    assert.deepStrictEqual(chips, ['All8', 'On phones5', 'Scheduled1', 'Drafts1', 'Ended1']);
    assert.ok(ui.list().findAll(has('ax-grip')).length === 8, 'every row drags while all are in view');
    await ui.press(ui.filter('Drafts'));
    assert.deepStrictEqual(ui.titles(), ['Choir signup']);
    assert.strictEqual(ui.list().findAll(has('ax-grip')).length, 0, 'no dragging a part of the order');
    assert.strictEqual(textOf(ui.list().find(has('ax-pane-count'))), '1 of 8 cards');
    await ui.press(ui.filter('All'));
    await ui.type(ui.search(), 'garcia');
    assert.deepStrictEqual(ui.titles(), ['Pray for the Garcias']);
    await ui.type(ui.search(), '');
    assert.strictEqual(textOf(ui.list().find(has('ax-pane-count'))), '8 cards · 5 on phones');
    await act(async () => ui.r.unmount());
  });

  await t('Alt + ↑ moves a card up and saves only the sorts that changed', async () => {
    seed();
    const ui = await page();
    const row = ui.row('Baptism Sunday');
    await act(async () => { row.props.onKeyDown({ target: 'me', currentTarget: 'me', key: 'ArrowUp', altKey: true, preventDefault() {} }); });
    await act(async () => { await wait(20); });
    assert.deepStrictEqual(ui.titles().slice(0, 4), ['Fall Festival', 'Wednesday plate', 'Baptism Sunday', 'Welcome']);
    const sorts = writes('app_home_cards').map((c) => [c.eqs[0][1], c.row.sort]);
    assert.deepStrictEqual(sorts.sort(), [['c3', 40], ['c4', 30]]);
    await act(async () => ui.r.unmount());
  });

  await t('New card goes first and is picked, and carries a place before every card into its first save', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.filter('Drafts'));
    await ui.press(ui.list().find((x) => x.type === 'button' && has('ax-new')(x)));
    assert.strictEqual(ui.titles()[0], 'New card', 'first in the list (and the filter cleared so it can be seen)');
    assert.strictEqual(ui.titles().length, 9);
    assert.strictEqual(ui.title().props.value, '', 'its editor is open');
    assert.strictEqual(ui.title().props.autoFocus, true);
    await ui.type(ui.title(), 'Harvest supper');
    await ui.settle();
    const ins = writes('app_home_cards').filter((c) => c.op === 'insert');
    assert.strictEqual(ins.length, 1);
    assert.strictEqual(ins[0].row.title, 'Harvest supper');
    assert.strictEqual(ins[0].row.sort, 0, 'before Fall Festival (10)');
    assert.strictEqual(ins[0].row.published, false, 'a draft until it is switched on');
    // Duplicate: a draft copy, first, saved at once
    db.calls = [];
    await ui.press(ui.headbtn('Duplicate card'));
    assert.strictEqual(ui.titles()[0], 'Harvest supper (copy)');
    await ui.settle();
    const copy = writes('app_home_cards').filter((c) => c.op === 'insert');
    assert.strictEqual(copy.length, 1);
    assert.strictEqual(copy[0].row.sort, -10);
    assert.strictEqual(copy[0].row.published, false);
    await act(async () => ui.r.unmount());
  });

  await t('the list says where phones show each card — for the Home being looked at', async () => {
    seed();
    const ui = await page();
    // (after the check, 2026-09-23: the mockup's line — the kind's short word, who it's for only when
    // that isn't everyone ("Visitors only"), then where it is — so in the 300px list the part that
    // changes, where it is, is never the part cut off. It was "Picture · Everyone · Announcements #2".)
    assert.deepStrictEqual(ui.subs(), [
      'Picture · Announcements #2',             // the featured event leads the row
      'Plate · While reservations are open',
      'Welcome · Visitors only · Live',
      'Video · Announcements #3',
      'Words · Members only · Announcements #4',
      'Picture · Starts Oct 3, 2099',
      'Picture · Ended Aug 30, 2020',
      'Words · Draft',
    ]);
    const seg = ui.root.find(has('ax-home-as'));
    assert.deepStrictEqual(seg.findAll((x) => x.type === 'button').map(textOf), ['Members 4', 'Visitors 3'], 'how many cards each can get now');
    await ui.press(seg.findAll((x) => x.type === 'button')[1]);
    assert.deepStrictEqual(ui.subs().slice(0, 5), [
      'Picture · On phones now',
      'Plate · Only for members',
      'Welcome · Visitors only · Another card comes first',
      'Video · Announcements #2',
      'Words · Members only · Live',
    ]);
    await act(async () => ui.r.unmount());
  });

  await t('the phone is Home as the app draws it: its photo, the sermon, the shortcuts, one card, Announcements, What’s Happening', async () => {
    seed();
    const ui = await page();
    const phone = ui.phone();
    assert.ok(ui.root.find(has('ax-phone-frame')), 'the foundation’s phone (PhoneFrame)');
    assert.ok(ui.root.find(has('ax-pa-dock')), 'with the app’s dock');
    assert.ok(ui.root.find(has('ax-pa-profile')) && !ui.root.findAll(has('ax-home-signin')).length, 'a member’s round profile button');
    assert.match(String(phone.find(has('ax-home-hero-photo')).props.style.backgroundImage), /header\.jpg/, 'the office’s Home photo');
    assert.strictEqual(textOf(phone.find(has('ax-home-headline'))).replace(/ /g, ' '), 'Where EveryYourEveryLife Matters');
    // (integration: the app renamed GET INVOLVED / GET CONNECTED to FIND A GROUP on 2026-09-23 — the
    // preview says what the app says)
    assert.strictEqual(textOf(phone.find(has('ax-home-herobtns'))), 'Find a Group', 'a member’s one hero button');
    assert.strictEqual(textOf(phone.find(has('ax-home-sermon-title'))), 'The Son Who Stayed Home', 'the newest sermon members can see');
    assert.deepStrictEqual(ui.shortcuts(), ['Search', 'Pray', 'Members', 'Bulletin'], 'signed in, the third door is Members');
    // members: the plate card wins while reservations are open
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-title'))), 'Reserve a plate');
    assert.strictEqual(textOf(ui.timely().find(has('ax-pa-flag'))), 'While reservations are open');
    // the Announcements row: the featured event first, then the office's cards; Fall Festival (picked) outlined there
    assert.deepStrictEqual(ui.ann().map((c) => textOf(c.find(has('ax-home-anncard-title')))), ['Revival', 'Fall Festival', 'Baptism Sunday', 'Pray for the Garcias']);
    assert.ok(cls(ui.ann()[1]).includes('ax-pa-picked'), 'the picked card is outlined where it is');
    assert.ok(!textOf(phone).includes('NOT ON PHONES') && !textOf(phone).toLowerCase().includes('not on phones'),
      'a card in Announcements IS on phones — no badge says otherwise');
    assert.ok(cls(ui.ann()[2]).includes('video') && ui.ann()[2].find(has('ax-pa-play')), 'a video card has the play disc');
    assert.match(String(ui.ann()[2].props.style.backgroundImage), /hqdefault/, 'a YouTube video brings its own picture');
    // What's Happening: the next events not already in Announcements
    const agenda = phone.findAll(has('ax-home-agenda-title')).map(textOf);
    assert.deepStrictEqual(agenda, ['Choir practice']);
    assert.ok(textOf(phone.find(has('ax-home-agenda-meta'))).startsWith('Tomorrow'), 'the day the way people say it');
    // as a visitor: Visit + Find a Group, the office's word for Groups, the first card for them
    await ui.press(ui.root.find(has('ax-home-as')).findAll((x) => x.type === 'button')[1]);
    assert.strictEqual(textOf(ui.phone().find(has('ax-home-herobtns'))), 'VisitFind a Group');
    assert.strictEqual(textOf(ui.phone().find(has('ax-home-signin'))), 'Sign in', 'signed out, the profile button is the Sign in pill');
    assert.strictEqual(ui.root.findAll(has('ax-pa-profile')).length, 0, 'and not the round one');
    assert.deepStrictEqual(ui.shortcuts(), ['Search', 'Pray', 'Connect', 'Bulletin'], 'a visitor keeps Groups — here the office’s word');
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-title'))), 'Fall Festival');
    assert.ok(cls(ui.timely()).includes('ax-pa-picked'));
    assert.deepStrictEqual(ui.ann().map((c) => textOf(c.find(has('ax-home-anncard-title')))), ['Revival', 'Baptism Sunday']);
    await act(async () => ui.r.unmount());
  });

  await t('a picked card phones don’t show takes the card’s place, with the right reason', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.row('Choir signup'));
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-title'))), 'Choir signup');
    assert.strictEqual(textOf(ui.timely().find(has('ax-pa-flag'))), 'Draft — not on phones');
    await ui.press(ui.row('Welcome'));
    assert.strictEqual(textOf(ui.timely().find(has('ax-pa-flag'))), 'Not for members');
    await ui.press(ui.row('Youth lock-in'));
    assert.strictEqual(textOf(ui.timely().find(has('ax-pa-flag'))), 'Starts Oct 3, 2099');
    await act(async () => ui.r.unmount());
  });

  await t('the phone is a way in: a shortcut opens Shortcuts at that one, a card opens its editor — from either tab', async () => {
    seed();
    const ui = await page();
    const pray = ui.phone().findAll(has('ax-pa-shortcut')).find((x) => textOf(x).includes('Pray'));
    assert.strictEqual(pray.props.role, 'button');
    await ui.press(pray);
    assert.strictEqual(ui.tab('boxes').props['aria-pressed'], true, 'on Shortcuts');
    const slots = ui.root.findAll(has('ax-home-slot'));
    assert.strictEqual(slots.length, 4, 'all four at once');
    assert.ok(cls(slots[0]).includes('on') && slots[0].props['aria-label'] === 'Prayer', 'the one clicked is marked');
    assert.ok(cls(ui.phone().findAll(has('ax-pa-shortcut-disc'))[1]).includes('ax-pa-picked'), 'and outlined on the phone');
    // a card clicked from Shortcuts: back to Cards with it open (the old page stayed on Shortcuts)
    const baptism = ui.ann().find((c) => textOf(c).includes('Baptism Sunday'));
    await ui.press(baptism);
    assert.strictEqual(ui.tab('cards').props['aria-pressed'], true);
    assert.strictEqual(ui.title().props.value, 'Baptism Sunday');
    // Enter and Space both work on the phone
    const post = ui.phone().findAll(has('ax-pa-shortcut')).find((x) => textOf(x).includes('Bulletin'));
    await act(async () => { post.props.onKeyDown({ key: ' ', preventDefault() {}, stopPropagation() {} }); });
    assert.strictEqual(ui.tab('boxes').props['aria-pressed'], true);
    await act(async () => ui.r.unmount());
  });

  await t('clicked again, the card opens as a member sees it when they tap it — every word and both buttons', async () => {
    seed();
    const ui = await page();
    assert.ok(!ui.root.findAll(has('ax-home-sheet')).length);
    await ui.press(ui.ann()[1]);   // Fall Festival, already picked
    const sheet = ui.root.find(has('ax-home-sheet'));
    assert.strictEqual(textOf(sheet.find(has('ax-home-sheet-kicker'))), 'This Saturday');
    assert.strictEqual(textOf(sheet.find(has('ax-home-sheet-title'))), 'Fall Festival');
    assert.strictEqual(textOf(sheet.find(has('ax-home-sheet-lead'))), 'Games, food & a hayride');
    assert.strictEqual(textOf(sheet.find(has('ax-home-sheet-text'))), 'Bring the whole family.');
    const btns = sheet.findAll(has('ax-home-sheet-btn'));
    assert.deepStrictEqual(btns.map(textOf), ['RSVP', 'Calendar']);
    assert.ok(!cls(btns[0]).includes('outline') && cls(btns[1]).includes('outline'), 'the first filled, the second outlined');
    await act(async () => { key('Escape'); });
    assert.ok(!ui.root.findAll(has('ax-home-sheet')).length, 'Escape closes it');
    // typing the words it shows opens it too
    await act(async () => { ui.editor().find((x) => x.type === 'textarea').props.onFocus(); });
    assert.ok(ui.root.find(has('ax-home-sheet')));
    await ui.press(ui.button('Back to Home'));
    assert.ok(!ui.root.findAll(has('ax-home-sheet')).length);
    // the component on its own, as other pages may use it
    let lone;
    await act(async () => { lone = TR.create(h(Home.CardPreview, { card: { kind: 'text', kicker: '', title: 'Room change', body: 'Now in 204.', buttons: [] } })); });
    assert.strictEqual(textOf(lone.root.find(has('ax-home-sheet-kicker'))), 'Announcement', 'the app’s own word when there’s no kicker');
    assert.ok(!lone.root.findAll(has('ax-home-sheet-pic')).length, 'words only: no picture');
    await act(async () => { lone.unmount(); ui.r.unmount(); });
  });

  await t('Shortcuts: each form saves itself; the app’s own words come back with one click', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.tab('boxes'));
    const input = (slot) => ui.root.find((x) => x.type === 'input' && x.props.id === `ax-home-tile-${slot}`);
    assert.strictEqual(input('prayer').props.placeholder, 'Pray', 'the app’s own word shows where it would');
    assert.strictEqual(input('connect').props.value, 'Connect');
    await ui.type(input('prayer'), 'Prayer');
    await ui.settle();
    assert.deepStrictEqual(writes('app_home_tiles').map((c) => [c.op, c.row && c.row.slot, c.row && c.row.title]), [['upsert', 'prayer', 'Prayer']]);
    assert.deepStrictEqual(ui.shortcuts(), ['Search', 'Prayer', 'Members', 'Bulletin'], 'the phone says it at once');
    db.calls = [];
    const connect = ui.root.findAll(has('ax-home-slot')).find((x) => x.props['aria-label'] === 'Connect');
    await ui.press(connect.find((x) => x.type === 'button' && textOf(x).trim() === 'Use the app’s own words'));
    await ui.settle();
    assert.deepStrictEqual(writes('app_home_tiles').map((c) => [c.op, c.eqs[0] && c.eqs[0][1]]), [['delete', 'connect']], 'blank removes the row');
    // typing in the latest post: the phone marks it and draws it where it shows, even under the plate card
    const postSlot = ui.root.findAll(has('ax-home-slot')).find((x) => x.props['aria-label'] === 'Latest post');
    await act(async () => { postSlot.props.onFocus(); });
    assert.ok(cls(ui.root.findAll(has('ax-home-slot')).find((x) => x.props['aria-label'] === 'Latest post')).includes('on'));
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-title'))), 'Our latest post');
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-kicker'))), 'Facebook');
    assert.strictEqual(textOf(ui.timely().find(has('ax-pa-flag'))), 'Only when no card is on');
    await act(async () => ui.r.unmount());
  });

  await t('before app-home-tiles.sql, the shortcuts say so and nothing in them can be changed', async () => {
    seed();
    db.missing.add('app_home_tiles');
    const ui = await page();
    await ui.press(ui.tab('boxes'));
    assert.ok(textOf(ui.root.find(has('ax-note'))).includes('supabase/app-home-tiles.sql'));
    const sets = ui.root.findAll((x) => x.type === 'fieldset');
    assert.strictEqual(sets.length, 4);
    assert.ok(sets.every((s) => s.props.disabled === true), 'the picture’s buttons too');
    await act(async () => ui.r.unmount());
  });

  await t('a video on its way up is never dropped without asking — New, the tab, Duplicate, Delete, another card', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.row('Baptism Sunday'));
    const file = ui.editor().find((x) => x.type === 'input' && x.props.type === 'file' && x.props.accept === 'video/*');
    await act(async () => { await file.props.onChange({ target: { files: [{ name: 'clip.mp4', size: 10, type: 'video/mp4' }], value: 'x' } }); });
    await act(async () => { await wait(20); });
    asked.length = 0;
    answers.push(false, false, false, false, false);
    await ui.press(ui.list().find((x) => x.type === 'button' && has('ax-new')(x)));
    await ui.press(ui.tab('boxes'));
    await ui.press(ui.headbtn('Duplicate card'));
    await ui.press(ui.headbtn('Delete card'));
    await ui.press(ui.row('Fall Festival'));
    assert.deepStrictEqual(asked, [
      'A video is still uploading. Stop it and start a new card?',
      'A video is still uploading. Stop it and switch to Shortcuts?',
      'A video is still uploading. Stop it and copy this card?',
      'A video is still uploading. Stop it and delete this card?',
      'A video is still uploading. Stop it and open another card?',
    ]);
    assert.strictEqual(ui.title().props.value, 'Baptism Sunday', 'nothing happened: the upload goes on');
    assert.strictEqual(ui.titles().length, 8);
    assert.strictEqual(ui.tab('cards').props['aria-pressed'], true);
    await act(async () => ui.r.unmount());
  });

  await t('Delete happens at once, with Undo', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.row('Choir signup'));
    await ui.press(ui.headbtn('Delete card'));
    await act(async () => { await wait(10); });
    assert.deepStrictEqual(writes('app_home_cards').map((c) => [c.op, c.eqs[0][1]]), [['delete', 'c8']]);
    assert.ok(!ui.titles().includes('Choir signup'));
    const toast = ui.root.find(has('ax-toast'));
    assert.strictEqual(textOf(toast.find((x) => x.type === 'span')), '“Choir signup” deleted.');
    await ui.press(toast.find((x) => x.type === 'button'));
    await act(async () => { await wait(10); });
    assert.ok(ui.titles().includes('Choir signup'), 'back where it was');
    await act(async () => ui.r.unmount());
  });

  await t('with no cards, the words say what phones show — not the old four boxes', async () => {
    seed();
    db.app_home_cards = [];
    const ui = await page();
    const words = textOf(ui.list());
    assert.ok(words.includes('No cards yet') && words.includes('latest post'), words);
    assert.ok(!/four boxes/.test(fs.readFileSync(path.join(PILLAR, 'src/pages/app/HomePage.jsx'), 'utf8')), 'the stale "under the four boxes" is gone');
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-title'))), 'Our latest post');
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-kicker'))), 'Facebook');
    // the post's photo, until the office gives it one, is the app's own (TimelyCard.js: DINNER_PHOTO)
    assert.ok(cls(ui.timely().find(has('ax-home-timely-thumb'))).includes('ax-home-photo-community'));
    await act(async () => ui.r.unmount());
  });

  /* ─────────────── after the adversarial check (2026-09-23) ─────────────── */

  const seg = (ui, i) => ui.root.find(has('ax-home-as')).findAll((x) => x.type === 'button')[i];   // 0 Members, 1 Visitors
  const kindBtn = (ui, word) => ui.head().find(has('ax-home-kind')).findAll((x) => x.type === 'button').find((b) => textOf(b) === word);
  const hint = (ui) => ui.editor().find((x) => x.props.id === 'ax-home-kind-hint');
  const state = (ui) => ui.editor().find(has('ax-home-state'));

  await t('the picked kind says in words what it looks like on phones now — shown, not only on hover, and read out with the picker', async () => {
    seed();
    const ui = await page();
    assert.strictEqual(textOf(hint(ui)), 'Picture — a photograph with your words, over it in Announcements and beside it as the card on top.');
    assert.strictEqual(hint(ui).props['aria-live'], 'polite', 'a new kind is announced');
    assert.strictEqual(ui.head().find(has('ax-home-kind')).props['aria-describedby'], 'ax-home-kind-hint', 'the picker is described by it');
    // Words is a dark card in Announcements now (AnnouncementsShelf.js), not "a soft tint"
    await ui.press(ui.row('Pray for the Garcias'));
    assert.match(textOf(hint(ui)), /^Words — words only: a dark card in Announcements/);
    assert.ok(!/soft tint/.test(textOf(ui.editor())), 'the old wording is gone from the page');
    // each button still names itself, in the same words, on hover
    assert.match(kindBtn(ui, 'Plate').props.title, /^Wednesday plate — the app’s own plate card/);
    // switching the kind changes the words at once
    await ui.press(kindBtn(ui, 'Video'));
    assert.match(textOf(hint(ui)), /^Video — a video that plays inside the app/);
    const app = fs.existsSync(path.join(APP, 'components/AnnouncementsShelf.js')) ? fs.readFileSync(path.join(APP, 'components/AnnouncementsShelf.js'), 'utf8') : null;
    if (app) assert.match(app, /A card with no picture is a solid\s+\/\/ dark card/, 'the app: words only is a dark card');
    await act(async () => ui.r.unmount());
  });

  await t('the editor’s line says what the list and the phone say — for the Home being looked at', async () => {
    seed();
    db.app_home_cards.push(card('c9', 90, { kind: 'text', title: 'Nine' }), card('c10', 100, { kind: 'text', title: 'Ten' }));
    const ui = await page();
    // Fall Festival, as members: #2 in Announcements (the featured event is #1) — as its row says
    assert.strictEqual(textOf(state(ui)), 'On phones now — #2 in the Announcements row for members. Changes reach phones as you make them.');
    assert.ok(cls(state(ui)).includes('on'));
    assert.strictEqual(ui.subs()[0], 'Picture · Announcements #2');
    // as visitors it's the card on top
    await ui.press(seg(ui, 1));
    assert.strictEqual(textOf(state(ui)), 'On phones now — the card on top of Home for visitors. Changes reach phones as you make them.');
    // the Welcome card: never "Everyone sees it now" while phones don't show it
    await ui.press(seg(ui, 0));
    await ui.press(ui.row('Welcome'));
    assert.strictEqual(textOf(state(ui)), 'Only visitors see it — show Home as Visitors to see where it is.');
    await ui.press(seg(ui, 1));
    assert.strictEqual(textOf(state(ui)), 'Switched on, but another card comes first for visitors.');
    assert.ok(!cls(state(ui)).includes('on'), 'not green: phones don’t show it');
    // the plate card set to Everyone: visitors never see it; members see it on top
    await ui.press(ui.row('Wednesday plate'));
    assert.strictEqual(textOf(state(ui)), 'Visitors never see the plate card — it’s for members, while dinner reservations are open.');
    await ui.press(seg(ui, 0));
    assert.strictEqual(textOf(state(ui)), 'On top of Home for members while Wednesday dinner is taking reservations. Changes reach phones as you make them.');
    // the sixth of the office's cards: switched on, but Announcements shows five at most
    await ui.press(ui.row('Ten'));
    assert.strictEqual(ui.subs()[ui.titles().indexOf('Ten')], 'Words · Not in the first five');
    assert.strictEqual(textOf(state(ui)), 'Switched on, but not on members’ phones: Announcements shows five at most, and this one comes later.');
    // a card on phones that isn't whole any more: phones keep what was saved, and it says so
    await ui.press(ui.row('Fall Festival'));
    await ui.press(ui.editor().find((x) => x.type === 'button' && textOf(x).trim() === 'Remove'));
    assert.strictEqual(textOf(state(ui)), 'On phones now — #2 in the Announcements row for members. Phones keep the last saved version until: A picture card needs a picture.');
    assert.ok(cls(state(ui)).includes('bad'));
    // the save state says why too, cut short in the head with its whole words on hover
    assert.strictEqual(ui.head().find(has('ax-home-save')).props.title, 'Not saved — A picture card needs a picture.');
    // a draft says it's ready (or what stops it)
    await ui.press(ui.row('Choir signup'));
    assert.strictEqual(textOf(state(ui)), 'A draft — only you see it. Ready — switch it on to show it.');
    // a plate card for visitors reaches no one — the app shows it only to members
    await ui.press(ui.row('Wednesday plate'));
    await ui.press(ui.editor().find((x) => x.props['aria-label'] === 'Who sees it' && has('ax-seg')(x)).findAll((x) => x.type === 'button')[2]);
    assert.strictEqual(textOf(state(ui)), 'Nobody sees it: the app shows the plate card only to members. Choose Members or Everyone.');
    assert.ok(cls(state(ui)).includes('bad'));
    await act(async () => ui.r.unmount());
  });

  await t('New card waits for the cards to load — the list that arrives can’t sweep a new card away', async () => {
    seed();
    db.slow = { app_home_cards: 60 };
    let r;
    await act(async () => { r = TR.create(h(HomePage)); });
    const newBtn = () => r.root.find((x) => x.type === 'button' && has('ax-new')(x));
    assert.strictEqual(newBtn().props.disabled, true);
    assert.strictEqual(textOf(r.root.find(has('ax-new-hint'))), 'Loading the cards…', 'it says why');
    await act(async () => { key('n'); });
    await act(async () => { await newBtn().props.onClick(); });   // even called straight
    await act(async () => { await wait(120); });
    const titles = r.root.find(has('ax-list-pane')).findAll(has('ax-row-title')).map(textOf);
    assert.strictEqual(titles.length, 8);
    assert.ok(!titles.includes('New card'));
    assert.strictEqual(newBtn().props.disabled, false, 'and then it works');
    assert.strictEqual(writes('app_home_cards').length, 0, 'nothing was saved behind the list’s back');
    await act(async () => r.unmount());
  });

  await t('a video on its way up is asked about before another kind of card drops it', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.row('Baptism Sunday'));
    const file = ui.editor().find((x) => x.type === 'input' && x.props.type === 'file' && x.props.accept === 'video/*');
    await act(async () => { await file.props.onChange({ target: { files: [{ name: 'clip.mp4', size: 10, type: 'video/mp4' }], value: 'x' } }); });
    await act(async () => { await wait(20); });
    asked.length = 0;
    answers.push(false);
    await ui.press(kindBtn(ui, 'Words'));
    assert.deepStrictEqual(asked, ['A video is still uploading. Stop it and change the kind of card?']);
    assert.strictEqual(kindBtn(ui, 'Video').props['aria-checked'], true, 'still a video card');
    assert.ok(ui.editor().find(has('ax-upload')), 'and the upload goes on');
    answers.push(true);
    await ui.press(kindBtn(ui, 'Words'));
    assert.strictEqual(kindBtn(ui, 'Words').props['aria-checked'], true, 'asked, and said yes');
    // with nothing uploading, a kind is just a click
    asked.length = 0;
    await ui.press(kindBtn(ui, 'Picture'));
    assert.strictEqual(kindBtn(ui, 'Picture').props['aria-checked'], true);
    assert.deepStrictEqual(asked, []);
    await act(async () => ui.r.unmount());
  });

  await t('Delete while a card’s first save is on its way deletes it too — it can’t reach phones unseen', async () => {
    seed();
    db.slow = { insert: 60 };
    const ui = await page();
    await ui.press(ui.list().find((x) => x.type === 'button' && has('ax-new')(x)));
    await ui.press(kindBtn(ui, 'Words'));
    await ui.type(ui.title(), 'Flash sale');
    // switched on (its first save starts) and deleted at once, before that save is back
    const on = ui.head().find(has('ax-sw-on')).find((x) => x.type === 'input');
    await act(async () => { on.props.onChange({ target: { checked: true } }); });
    assert.ok(!db.app_home_cards.some((c) => c.title === 'Flash sale'), 'the insert is still on its way');
    await ui.press(ui.headbtn('Delete card'));
    await ui.settle();
    assert.ok(!db.app_home_cards.some((c) => c.title === 'Flash sale'), 'no card left behind for phones');
    const w = writes('app_home_cards');
    assert.deepStrictEqual(w.map((c) => c.op), ['insert', 'delete'], JSON.stringify(w));
    assert.strictEqual(w[1].eqs[0][1], `new${n}`, 'the delete names the id the insert got');
    assert.ok(!ui.titles().includes('Flash sale'));
    assert.strictEqual(textOf(ui.root.find(has('ax-toast')).find((x) => x.type === 'span')), '“Flash sale” deleted.', 'with Undo');
    await act(async () => ui.r.unmount());
  });

  await t('after Delete with a search or a filter on, the next card is the next one the list SHOWS', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.filter('On phones'));
    await ui.press(ui.row('Pray for the Garcias'));   // the last one shown; Youth lock-in comes next in the whole list
    await ui.press(ui.headbtn('Delete card'));
    await act(async () => { await wait(10); });
    assert.strictEqual(ui.title().props.value, 'Baptism Sunday', 'the one above it in the list as shown');
    await ui.press(ui.filter('All'));
    await ui.type(ui.search(), 'choir');
    await ui.press(ui.row('Choir signup'));
    await ui.press(ui.headbtn('Delete card'));
    await act(async () => { await wait(10); });
    assert.ok(cls(ui.root.find(has('ax-editor-pane'))).includes('is-empty'), 'nothing else shown: nothing picked');
    await act(async () => ui.r.unmount());
  });

  await t('the Members shortcut, and the Groups word, turn the phone to Visitors — where that word shows', async () => {
    seed();
    const ui = await page();
    const members = ui.phone().findAll(has('ax-pa-shortcut')).find((x) => textOf(x).includes('Members'));
    assert.strictEqual(members.props['aria-label'], 'Members always see “Members” here — change the word visitors see');
    await ui.press(members);
    assert.strictEqual(ui.tab('boxes').props['aria-pressed'], true, 'on Shortcuts');
    assert.strictEqual(seg(ui, 1).props['aria-checked'], true, 'the phone shows a visitor’s Home now');
    assert.deepStrictEqual(ui.shortcuts(), ['Search', 'Pray', 'Connect', 'Bulletin']);
    assert.ok(cls(ui.phone().findAll(has('ax-pa-shortcut-disc'))[2]).includes('ax-pa-picked'), 'the word being changed, outlined');
    const form = (name) => ui.root.findAll(has('ax-home-slot')).find((x) => x.props['aria-label'] === name);
    assert.ok(cls(form('Connect')).includes('on'));
    // typing in the Connect form does the same; the other forms leave the phone as it is
    await ui.press(seg(ui, 0));
    await act(async () => { form('Prayer').props.onFocus(); });
    assert.strictEqual(seg(ui, 0).props['aria-checked'], true);
    await act(async () => { form('Connect').props.onFocus(); });
    assert.strictEqual(seg(ui, 1).props['aria-checked'], true);
    await act(async () => ui.r.unmount());
  });

  await t('the card on top never opens to its whole announcement — a tap there does what its first button says', async () => {
    seed();
    const ui = await page();
    await ui.press(seg(ui, 1));   // visitors: Fall Festival is the card on top
    await ui.press(ui.timely());  // already picked: clicked again
    assert.ok(!ui.root.findAll(has('ax-home-sheet')).length, 'no sheet from the card on top');
    assert.ok(!ui.root.findAll((x) => x.type === 'button' && textOf(x).trim() === 'See it opened, as members do').length);
    assert.strictEqual(textOf(ui.root.find(has('ax-home-top-note'))),
      'On top of Home a tap does what “RSVP” does — its More words and second button show only when it’s opened from Announcements.');
    await act(async () => { ui.editor().find((x) => x.type === 'textarea').props.onFocus(); });
    assert.ok(!ui.root.findAll(has('ax-home-sheet')).length, 'typing its words doesn’t open one either');
    assert.match(ui.editor().findAll((x) => x.type === 'p' && has('ax-hint')(x)).map(textOf).join(' | '),
      /Members read it when they open the card from Announcements, with both buttons\. On top of Home a tap does what the first button says instead\./);
    // as members it's #2 in Announcements, and opens there
    await ui.press(seg(ui, 0));
    assert.ok(!ui.root.findAll(has('ax-home-top-note')).length);
    await ui.press(ui.ann()[1]);
    assert.ok(ui.root.find(has('ax-home-sheet')));
    // the app: the card on top runs its first button (TimelyCard.js), only Announcements opens a sheet
    if (fs.existsSync(path.join(APP, 'components/TimelyCard.js'))) {
      const timely = fs.readFileSync(path.join(APP, 'components/TimelyCard.js'), 'utf8');
      assert.match(timely, /runCardAction\(d\.act, card/);
      assert.ok(!/AnnouncementSheet/.test(timely));
    }
    await act(async () => ui.r.unmount());
  });

  await t('the round button and the opened card use only the buttons the app keeps', async () => {
    seed();
    // a blank first button (the app drops it), then a page it knows
    db.app_home_cards[0].buttons = [{ label: '  ', action: 'url', target: 'https://x.org/rsvp' }, { label: 'Calendar', action: 'page', target: 'Calendar' }];
    // a card whose only button goes nowhere the app will open — first in the order
    db.app_home_cards.unshift(card('c9', 5, { kind: 'text', title: 'Bad link', audience: 'signed_out', buttons: [{ label: 'Go', action: 'url', target: 'x.org' }] }));
    const ui = await page();
    const arrow = (node) => {
      const go = node.findAll(has('ax-pa-go'));
      if (!go.length) return null;
      const points = go[0].findAll((x) => x.type === 'polyline').map((p) => p.props.points);
      return points.includes('12 5 19 12 12 19') ? 'arrow-right' : points.includes('7 7 17 7 17 17') ? 'arrow-up-right' : 'other';
    };
    // visitors: "Bad link" is on top — no round button: the app drew none
    await ui.press(seg(ui, 1));
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-title'))), 'Bad link');
    assert.strictEqual(arrow(ui.timely()), null);
    // Fall Festival on top (Bad link is switched off): the round button follows Calendar, not the dropped link
    await ui.press(ui.row('Bad link'));
    await act(async () => { ui.head().find(has('ax-sw-on')).find((x) => x.type === 'input').props.onChange({ target: { checked: false } }); });
    await ui.settle();
    await ui.press(ui.row('Fall Festival'));
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-title'))), 'Fall Festival');
    assert.strictEqual(arrow(ui.timely()), 'arrow-right');
    // opened (as members, from Announcements): the one button the app keeps
    await ui.press(seg(ui, 0));
    await ui.press(ui.ann()[1]);
    assert.deepStrictEqual(ui.root.find(has('ax-home-sheet')).findAll(has('ax-home-sheet-btn')).map(textOf), ['Calendar']);
    await act(async () => ui.r.unmount());
  });

  await t('the phone: “Hi” and the name for members, and the app’s own photos where the office gave none', async () => {
    seed();
    extra.header = null;
    extra.sermons = [];
    const ui = await page();
    assert.strictEqual(textOf(ui.phone().find(has('ax-home-greeting'))), 'Hi Brody', 'the first name, on the profile button’s row');
    const photo = ui.phone().find(has('ax-home-hero-photo'));
    assert.ok(cls(photo).includes('ax-home-photo-hero') && !photo.props.style, 'no Home photo: the church photo that comes with the app');
    const thumb = ui.phone().find(has('ax-home-sermon-thumb'));
    assert.ok(cls(thumb).includes('ax-home-photo-hero') && !thumb.props.style, 'no sermon picture: the same');
    assert.strictEqual(textOf(ui.phone().find(has('ax-home-sermon-title'))), 'This Week\'s Message');
    assert.ok(cls(ui.timely().find(has('ax-home-timely-thumb'))).includes('ax-home-photo-community'), 'the plate card’s own photo');
    await ui.press(seg(ui, 1));
    assert.strictEqual(ui.phone().findAll(has('ax-home-greeting')).length, 0, 'a visitor isn’t greeted');
    await ui.press(ui.row('Welcome'));
    assert.ok(cls(ui.timely().find(has('ax-home-timely-thumb'))).includes('ax-home-photo-welcome'), 'the welcome card’s own photo');
    await act(async () => ui.r.unmount());
    // with no name, no greeting (the app's greetingName is empty)
    seed();
    extra.profile = null;
    const lone = await page();
    assert.strictEqual(lone.phone().findAll(has('ax-home-greeting')).length, 0);
    await act(async () => lone.r.unmount());
    // community.jpg really is the app's own photo, byte for byte
    const mine = path.join(PILLAR, 'src/pages/app/css/img/community.jpg');
    assert.ok(fs.existsSync(mine), 'css/img/community.jpg');
    const theirs = path.join(APP, 'assets/home/community.jpg');
    if (fs.existsSync(theirs)) assert.ok(fs.readFileSync(mine).equals(fs.readFileSync(theirs)), 'the same file as the app’s');
    const home = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/home.css'), 'utf8');
    assert.ok(home.includes(".ax-home-screen .ax-home-photo-community { background-image: url('./img/community.jpg'); }"));
    // (integration, 2026-09-23: the app's other bundled photos are in Pillar now — the stand-ins that
    // waited for them are gone) each one the app's own file, byte for byte, and drawn where the app draws it
    for (const [stock, mine, theirs] of [['hero', 'mainhero.jpg', 'assets/mainhero.jpg'], ['welcome', 'welcome.jpg', 'assets/home/welcome.jpg'],
      ['mac', 'mac.jpg', 'assets/events/mac.jpg'], ['lyn', 'lyn-class.jpg', 'assets/events/lyn-class.jpg']]) {
      assert.ok(home.includes(`.ax-home-screen .ax-home-photo-${stock} { background-image: url('./img/${mine}'); }`), stock);
      const file = path.join(PILLAR, `src/pages/app/css/img/${mine}`);
      assert.ok(fs.existsSync(file), mine);
      if (fs.existsSync(path.join(APP, theirs))) assert.ok(fs.readFileSync(file).equals(fs.readFileSync(path.join(APP, theirs))), `${mine} is the app’s ${theirs}`);
    }
    assert.ok(!/linear-gradient\(180deg, #8C6A4E/.test(home), 'no warm stand-in left');
    const cal = path.join(APP, 'components/ChurchEvents.js');
    if (fs.existsSync(cal)) {
      const src = fs.readFileSync(cal, 'utf8');
      assert.ok(src.includes("lynClass: require('../assets/events/lyn-class.jpg')") && src.includes("hero:     require('../assets/mainhero.jpg')"));
    }
  });

  await t('the greeting sits where the app puts it, in the app’s type', async () => {
    const home = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/home.css'), 'utf8');
    const rule = /\.ax-home-greeting \{([^}]*)\}/.exec(home)[1];
    for (const want of ['top: 65px', 'left: 32px', 'right: 74px', 'height: 44px', 'font-size: 20px', 'font-weight: 600',
      'line-height: 44px', 'letter-spacing: -0.3px', 'color: #FFFFFF', 'text-shadow: 0 1px 8px rgba(0, 0, 0, 0.35)']) {
      assert.ok(rule.includes(want), want);
    }
    const screen = path.join(APP, 'screens/HomeScreen.js');
    if (!fs.existsSync(screen)) return;
    const src = fs.readFileSync(screen, 'utf8');
    assert.match(src, /greeting: \{\s*position: 'absolute', left: 32, height: PROFILE_BTN_SIZE, lineHeight: PROFILE_BTN_SIZE,\s*fontFamily: 'BeVietnamPro_600SemiBold', fontSize: 20, letterSpacing: -0\.3, color: '#fff',\s*textShadowColor: 'rgba\(0,0,0,0\.35\)', textShadowOffset: \{ width: 0, height: 1 \}, textShadowRadius: 8,/);
    assert.match(src, /top: insets\.top \+ PROFILE_BTN_TOP, right: profileClear/);
    const btn = fs.readFileSync(path.join(APP, 'components/ProfileButton.js'), 'utf8');
    assert.match(btn, /PROFILE_BTN_TOP {3}= 6;/);
    assert.match(btn, /return PROFILE_BTN_RIGHT \+ width \+ GAP;/);   // 20 + 44 + 10 = 74
  });

  // (user, 2026-09-27: "Remove the pumpkin olympic and veterans day example cards from the app")
  await t('only the office’s Featured events are cards — the phone no longer guesses a Big Events one, and neither does this', async () => {
    const src = fs.readFileSync(path.join(PILLAR, 'src/pages/app/HomePage.jsx'), 'utf8');
    assert.ok(!/FEATURE_TITLE|cat === 'Big Events'/.test(src), 'no pinned title, no Big Events rule');
    const app = fs.readFileSync(path.join(APP, 'utils/churchCalendar.js'), 'utf8');
    assert.ok(!/FEATURE_TITLE|cat === 'Big Events'/.test(app), 'the app’s own rule (BethesdaApp utils/churchCalendar.js) matches');
  });

  await t('a featured event with no picture shows its room’s photo, else one that comes with the app (photoFor)', async () => {
    seed();
    db.events[0].image_url = null;
    db.events[0].location = 'Fellowship Hall';
    db.locations = [{ name: 'Fellowship  hall', photo_url: 'https://x.org/hall.jpg' }, { name: 'Gym', photo_url: null }];
    db.events.push(
      { id: 'e3', title: 'Mac Powell Concert', calendar: 'church', is_private: false, start_date: inDays(20), end_date: null, start_time: '19:00', end_time: null, location: '', featured: true, image_url: null },
      { id: 'e4', title: 'Harvest Home', calendar: 'church', is_private: false, start_date: inDays(25), end_date: null, start_time: null, end_time: null, location: 'Gym', featured: true, image_url: null },
    );
    const ui = await page();
    const cards = ui.ann();
    assert.deepStrictEqual(cards.slice(0, 3).map((c) => textOf(c.find(has('ax-home-anncard-title')))), ['Revival', 'Mac Powell Concert', 'Harvest Home']);
    assert.match(String(cards[0].props.style.backgroundImage), /hall\.jpg/, 'the room’s photo, the name matched loosely');
    assert.ok(cls(cards[1]).includes('ax-home-photo-mac') && !cls(cards[1]).includes('solid'), 'the concert’s own photo from the app');
    assert.ok(cls(cards[2]).includes('ax-home-photo-hero'), 'else the church');
    assert.ok(cards.slice(0, 3).every((c) => c.findAll(has('ax-home-anncard-shade')).length === 1), 'each drawn as a photo card: blur and shade');
    assert.ok(writes('locations').length === 0 && db.calls.some((c) => c.table === 'locations'), 'the rooms are only read');
    await act(async () => ui.r.unmount());
  });

  await t('the plate card says the week’s menu while a dinner is taking reservations, as the dinner function says', async () => {
    seed();
    const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
    db.sms_library = [
      { message_type: 'Dinner', last_sent_at: ago(20), created_at: ago(21), rsvp_menu: ['Old soup'] },
      { message_type: 'Dinner', last_sent_at: ago(2), created_at: ago(3), rsvp_menu: ['Chicken spaghetti', 'Green beans', 'Rolls'] },
    ];
    const ui = await page();
    assert.strictEqual(textOf(ui.timely().find(has('ax-home-timely-sub'))), 'Chicken spaghetti · Green beans');
    assert.ok(writes('sms_library').length === 0, 'only read');
    await act(async () => ui.r.unmount());
    seed();
    const none = await page();
    assert.strictEqual(textOf(none.timely().find(has('ax-home-timely-sub'))), 'Dinner before the midweek service', 'no dinner: the app’s own line');
    await act(async () => none.r.unmount());
    // the same fourteen days the rsvp-forms function counts (supabase/functions/_shared/dinnerAck.ts)
    const lib = require(STUBS['../../lib/homeCards']);
    const ack = fs.readFileSync(path.join(PILLAR, 'supabase/functions/_shared/dinnerAck.ts'), 'utf8');
    assert.strictEqual(lib.DINNER_DAYS, Number(/const ACTIVE_DAYS = (\d+);/.exec(ack)[1]));
    assert.match(ack, /\.eq\('message_type', 'Dinner'\)/);
    if (fs.existsSync(path.join(APP, 'components/TimelyCard.js'))) {
      assert.ok(fs.readFileSync(path.join(APP, 'components/TimelyCard.js'), 'utf8').includes("menu.slice(0, 2).join(' · ')"));
    }
  });

  await t('a long shortcut word shrinks to fit, as the app’s does, before it’s cut short', async () => {
    seed();
    db.app_home_tiles.push({ slot: 'prayer', title: 'Prayer Walls', subtitle: null, image_url: null });
    const ui = await page();
    const words = ui.phone().find(has('ax-pa-shortcuts')).findAll(has('ax-pa-shortcut-word'));
    const long = words.find((w) => textOf(w) === 'Prayer Walls');
    const fit = long.props.style['--ax-sc-fit'];
    assert.ok(fit >= 0.8 && fit < 1, String(fit));
    assert.ok(!words.find((w) => textOf(w) === 'Search').props.style, 'a word that fits keeps its 13.5');
    await act(async () => ui.r.unmount());
    const home = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/home.css'), 'utf8');
    assert.ok(home.includes('.ax-home-sc .ax-pa-shortcut-word { font-size: calc(13.5px * var(--ax-sc-fit, 1)); }'));
    if (fs.existsSync(path.join(APP, 'components/HomeShortcuts.js'))) {
      const sc = fs.readFileSync(path.join(APP, 'components/HomeShortcuts.js'), 'utf8');
      assert.match(sc, /numberOfLines=\{1\} adjustsFontSizeToFit minimumFontScale=\{0\.8\}/);
      assert.match(sc, /maxWidth: DISC \+ 16/);
      assert.match(sc, /const DISC = 58;/);   // 58 + 16 = the 74 a word has
    }
  });

  await t('while the calendar is read, What’s Happening shows the app’s small spinner', async () => {
    seed();
    db.slow = { events: 80 };
    let r;
    await act(async () => { r = TR.create(h(HomePage)); });
    await act(async () => { await wait(20); });
    assert.ok(r.root.find(has('ax-home-screen')).find(has('ax-home-spin')), 'the spinner where the events will be');
    await act(async () => { await wait(120); });
    const phone = r.root.find(has('ax-home-screen'));
    assert.strictEqual(phone.findAll(has('ax-home-spin')).length, 0);
    assert.deepStrictEqual(phone.findAll(has('ax-home-agenda-title')).map(textOf), ['Choir practice']);
    await act(async () => r.unmount());
    const screen = path.join(APP, 'screens/HomeScreen.js');
    if (fs.existsSync(screen)) assert.match(fs.readFileSync(screen, 'utf8'), /<ActivityIndicator color=\{C\.text2\} style=\{\{ alignSelf: 'flex-start' \}\} \/>/);
  });

  await t('the latest sermon’s picture is YouTube’s biggest when it’s a YouTube sermon — the app’s card is the upload', async () => {
    seed();
    extra.sermons = [{ id: 's9', title: 'Grace upon grace', date: 'Sep 21, 2026', thumbnailUrl: 'https://x.org/own.jpg', videoLink: 'https://youtu.be/abcdefgh', published: true }];
    const ui = await page();
    assert.match(String(ui.phone().find(has('ax-home-sermon-thumb')).props.style.backgroundImage), /maxresdefault/);
    await act(async () => ui.r.unmount());
    seed();
    extra.sermons = [{ id: 's9', title: 'Grace upon grace', date: 'Sep 21, 2026', thumbnailUrl: 'https://x.org/own.jpg', videoLink: 'https://files.x.org/grace.mp4', published: true }];
    const file = await page();
    assert.match(String(file.phone().find(has('ax-home-sermon-thumb')).props.style.backgroundImage), /own\.jpg/, 'not YouTube: the office’s picture');
    await act(async () => file.r.unmount());
  });

  await t('the head never pushes the switch and Delete away from the save state; the sheet is the app’s to the point', async () => {
    const home = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/home.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(home.includes('.ax-home-save { flex: 1 1 0; min-width: 0;'), 'the save state takes the room that’s left, never more');
    assert.ok(/\.ax-home-save > \.ax-save \{[^}]*white-space: nowrap; text-overflow: ellipsis;/.test(home), 'cut short, not wrapped onto the switch’s line');
    assert.ok(home.includes('.ax-home-save > .ax-save.error { white-space: normal; }'), 'an error wraps, so its Try again stays in view');
    assert.ok(home.includes('.ax-seg.ax-home-kind { order: 10; flex: 1 1 100%;'), 'the kind has a row of its own');
    assert.ok(!/@container editor \(max-width: 859px\)/.test(home), '— at every width, not only under 860');
    assert.ok(home.includes('.ax-home .ax-editor-pane-head > .ax-grow { display: none; }'));
    assert.ok(/\.ax-home-sheet-pic \{[^}]*height: 194px;/.test(home), 'Math.round(345 × 9 / 16)');
    assert.ok(home.includes('.ax-pa-btn.outline.ax-home-sheet-btn { border-color: var(--ax-app-text); color: var(--ax-app-text); }'));
    const shelf = path.join(APP, 'components/AnnouncementsShelf.js');
    if (fs.existsSync(shelf)) {
      assert.match(fs.readFileSync(shelf, 'utf8'), /height: Math\.round\(picW \* 9 \/ 16\)/);
      assert.match(fs.readFileSync(path.join(APP, 'components/SignInUI.js'), 'utf8'), /secondary: \{ \.\.\.btn\.lg, \.\.\.btn\.outline, borderColor: C\.text \}/);
    }
  });

  await t('every class HomePage uses is styled, with the ax- prefix and no !important', async () => {
    const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/HomePage.jsx'), 'utf8');
    const css = (f) => fs.readFileSync(path.join(PILLAR, 'src/pages/app/css', f), 'utf8');
    const home = css('home.css'); const phone = css('phone.css'); const base = css('base.css');
    assert.ok(!/!important/.test(home.replace(/\/\*[\s\S]*?\*\//g, '')), 'no !important');
    // (a custom property such as --ax-sc-fit is a value, not a class: the look-behind leaves it out)
    const used = new Set([...page.matchAll(/(?<!-)ax-[a-z0-9-]+/g)].map((m) => m[0]).filter((c) => !/-$/.test(c)));
    const ids = new Set([...page.matchAll(/id=["{`]+(ax-[a-z0-9-]+)/g)].map((m) => m[1]));
    const styled = (c) => [home, phone, base].some((s) => new RegExp(`\\.${c}(?![\\w-])`).test(s));
    const missing = [...used].filter((c) => !ids.has(c) && !c.startsWith('ax-home-tile') && !styled(c));
    assert.deepStrictEqual(missing, [], 'classes with no rule');
    // no static inline styles: only a picture's address, or a measured value in a custom property (a
    // shortcut's word fitted to its 74pt — added after the check, 2026-09-23)
    const inline = [...page.matchAll(/style=\{([^}]*\}?)/g)].map((m) => m[1]);
    assert.ok(inline.every((s) => /backgroundImage|'--ax-[a-z-]+'/.test(s)), inline.join(' | '));
  });

  await t('the phone’s numbers are HomeScreen.js’s own, worked out from the app’s constants', async () => {
    const home = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/home.css'), 'utf8');
    const screen = path.join(APP, 'screens/HomeScreen.js');
    if (!fs.existsSync(screen)) { console.log('    (the app repo isn’t beside Pillar — skipped)'); return; }
    const src = fs.readFileSync(screen, 'utf8');
    const num = (name) => Number(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`).exec(src)[1]);
    // the photo's own shape, read from the JPEG (its first SOF marker)
    const jpg = fs.readFileSync(path.join(APP, 'assets/mainhero.jpg'));
    let i = 2; let w = 0; let hgt = 0;
    while (i < jpg.length) {
      const m = jpg[i + 1]; const len = jpg.readUInt16BE(i + 2);
      if (m >= 0xC0 && m <= 0xC3) { hgt = jpg.readUInt16BE(i + 5); w = jpg.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
    const W = 393; const H = 852; const TOP = 59; const PAD = 20;
    const photoH = W / (w / hgt);
    const size = Math.min(52, (W - num('HEADLINE_INSET') * 2) / num('HEADLINE_EMS'));
    const slot = Math.round(size * 1.12);
    const thumbH = (W - PAD * 2) * 9 / 16;
    const cardH = 16 + 8 + thumbH;
    const cardTop = photoH + num('CARD_HANG') - cardH;
    const heroH = Math.round(cardTop + cardH / 2);
    const rowBottom = TOP + 6 + 44;
    const top = (btns) => rowBottom + Math.max(20, (cardTop - rowBottom - (slot + size + num('HERO_BTN_GAP') + btns)) / 2);
    const member = top(num('HERO_BTN_H'));
    const visitor = top(num('HERO_BTN_H') * 2 + num('HERO_BTNS_GAP'));
    const px = (v) => `${Math.round(v * 100) / 100}px`;
    const want = {
      hero: `height: ${px(heroH)}`, sermon: `top: ${px(cardTop)}`, thumb: `height: ${px(thumbH)}`,
      member: `top: ${px(member)}`, visitor: `top: ${px(visitor)}`,
      memberBtns: `top: ${px(member + slot + size + num('HERO_BTN_GAP'))}`, visitorBtns: `top: ${px(visitor + slot + size + num('HERO_BTN_GAP'))}`,
      section: `padding-top: ${px(num('CARD_HANG') + num('GAP_BLOCK') - (heroH - photoH))}`,
      shade: `height: ${px(Math.min(photoH, H * 0.48))}`, foot: `top: ${px(heroH * 0.45)}`, blur: `height: ${px(heroH - heroH * 0.45)}`,
      size: `font-size: ${size}px`, lineHeight: `line-height: ${slot}px`, tracking: `letter-spacing: ${Math.round(-0.042 * size * 1000) / 1000}px`,
    };
    for (const [k, v] of Object.entries(want)) assert.ok(home.includes(v), `${k}: ${v}`);
    assert.match(src, /timely: +\{ marginTop: GAP_BLOCK \}/);
    assert.ok(home.includes(`margin: ${num('GAP_BLOCK')}px 20px 0`), 'the one card sits a block’s gap under the shortcuts');
    // the Announcements cards: 0.78 of the gutter-to-gutter width, 0.66 as tall
    const shelf = fs.readFileSync(path.join(APP, 'components/AnnouncementsShelf.js'), 'utf8');
    const peek = Number(/const PEEK = ([\d.]+)/.exec(shelf)[1]);
    const cw = Math.round((W - PAD * 2) * peek);
    assert.match(shelf, /height: Math\.round\(width \* 0\.66\)/);
    assert.ok(home.includes(`width: ${cw}px; height: ${Math.round(cw * 0.66)}px`), `${cw} × ${Math.round(cw * 0.66)}`);
    // the one card's own words for the app's built-in cards
    const timely = fs.readFileSync(path.join(APP, 'components/TimelyCard.js'), 'utf8');
    const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/HomePage.jsx'), 'utf8');
    for (const w of ['Wednesday night', 'Reserve a plate', 'Dinner before the midweek service', 'Bethesda Baptist', 'Welcome to the new Bethesda App']) {
      assert.ok(timely.includes(`'${w}'`) && page.includes(`'${w}'`), w);
    }
    assert.match(timely, /const THUMB = 64;/);
    assert.ok(/\.ax-home-timely-thumb \{[^}]*width: 64px; height: 64px/.test(home));
    // and the headline words and the sermon card's own stand-in
    assert.ok(src.includes("const REEL_WORDS = ['Every', 'Your', 'Every'];") && src.includes('Life Matters') && src.includes('"This Week\'s Message"'));
    // the hero buttons' words: FIND A GROUP for members, VISIT and FIND A GROUP for visitors
    assert.ok(src.includes("{user ? 'Find a Group' : 'Visit'}") && src.includes(">Find a Group</Text>"), 'the app’s hero words');
    assert.ok(page.includes('ax-home-herobtn">Find a Group</span>') && page.includes('ax-home-herobtn-line">Find a Group</span>'));
  });

  console.error = oe;
  const other = errs.filter((m) => !/react-test-renderer is deprecated|not wrapped in act/.test(m));
  if (other.length) { console.log('React errors:', other.slice(0, 3)); process.exit(1); }
  console.log(`\n${ok} Home redesign checks passed`);
})().catch((e) => { console.error = oe; console.log('FAIL', e); process.exit(1); });
