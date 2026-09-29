// App → Groups after the redesign (Pillar/src/pages/app/GroupsPage.jsx, 2026-09-23 —
// Pillar-backups/redesign/DESIGN.md §4).
//
// A group's cards live WITH the group now: the group editor lists them (switches, drag) and "New card
// for this group" writes one in a panel over the editor, pre-set to that group — a group that never
// saved saves the moment it has a name, and one without a name says so on the button instead of
// doing nothing. Card order stays ONE order for every card (the Groups page strip and the Bulletin's
// Group Events), so dragging a group's cards or a filtered list moves only those. Both lists search;
// the Cards tab filters by group and keeps the "Everyone" cards. Deleting a group with cards still
// asks, and Undo brings the group AND its cards back. The button hint says what the check allows
// (http:// or https://). The phone is the member app's own Groups screen
// (BethesdaApp screens/GroupsScreen.js), with what's picked outlined.
//
// Fixes after the adversarial check (2026-09-23): the phone reads the church calendar as the app does
// ("N coming up", the next event's when / where, "This week", the empty line only with nothing at
// all), always draws the facts block, shows the app's own community.jpg when no photo is picked and
// only an https:// pick, keys its pills as the app does, and uses Be Vietnam Pro's own line height.
// The page: clicking the panel's own card on the phone keeps it, a saved group always takes a card,
// the panel never moves the Cards tab's pick, "Saving the group…" is one group's, a new card with
// only dates or a changed group isn't thrown away, and the list's foot drops N and / while the panel
// is open.
//
// Integration (2026-09-23, later): the app's Groups page was laid out again the same afternoon
// (BethesdaApp screens/GroupsScreen.js: "Groups" — one name everywhere — a short photo, cream group
// cards with a mark in the kind's colour, the kind and who it's for under the name, when / where /
// "N coming up" as facts, every leader's face and name, "Ask about joining", a Follow pill, "All
// groups", the cream "From the groups" cards with coloured tags, and "Can't find one that fits?"). The phone follows it, so the checks that pinned the old card (the
// green badge, the blue chip, "Meet the leaders:", the empty line, the count) now pin the new one —
// the same intent: the phone is the app's own screen, number for number.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the app repo, for the checks that both sides agree
const OUT = path.join(__dirname, '.build-groups'); fs.mkdirSync(OUT, { recursive: true });
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

// ── a pretend browser: key presses reach window listeners ──
const listeners = {};
globalThis.window = {
  innerWidth: 1440,
  location: { origin: 'https://pillar.test' },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  dispatchEvent: (e) => { for (const fn of [...(listeners[e.type] || [])]) fn(e); return true; },
};
const key = (k, more = {}) => ({ type: 'keydown', key: k, target: {}, preventDefault() {}, ...more });

// ── a pretend church_groups + group_posts, with the database's own rules ──
const db = { church_groups: [], group_posts: [], calls: [] };
let n = 0;
let slow = 0;   // ms each write waits before the database answers (0: at once)
function from(table) {
  assert.ok(table === 'church_groups' || table === 'group_posts', table);
  const q = { op: 'select', row: null, eq: null };
  const run = () => {
    db.calls.push({ table, op: q.op, row: q.row && { ...q.row }, eq: q.eq });
    const rows = db[table];
    if (q.op === 'select') return { data: rows.map((r) => ({ ...r })).sort((a, b) => (a.sort || 0) - (b.sort || 0)), error: null };
    const must = table === 'church_groups' ? 'name' : 'title';
    if (q.op === 'insert') {
      if (!String(q.row[must] || '').trim()) return { data: null, error: { code: '23514', message: `violates check constraint "${table}_${must}"` } };
      const row = { id: `${table === 'church_groups' ? 'g' : 'p'}${++n}`, ...q.row };
      rows.push(row);
      return { data: { ...row }, error: null };
    }
    if (q.op === 'update') {
      const r = rows.find((x) => x.id === q.eq[1]);
      if (!r) return { data: null, error: { message: 'no such row' } };
      Object.assign(r, q.row);
      return { data: { ...r }, error: null };
    }
    db[table] = rows.filter((x) => x.id !== q.eq[1]);
    // group_posts.group_id is ON DELETE CASCADE
    if (table === 'church_groups') db.group_posts = db.group_posts.filter((p) => p.group_id !== q.eq[1]);
    return { data: null, error: null };
  };
  const chain = {
    select() { return chain; },
    order() { return chain; },
    eq(k, v) { q.eq = [k, v]; return chain; },
    insert(row) { q.op = 'insert'; q.row = row; return chain; },
    update(row) { q.op = 'update'; q.row = row; return chain; },
    delete() { q.op = 'delete'; return chain; },
    single() { return slow && q.op !== 'select' ? wait(slow).then(run) : Promise.resolve(run()); },
    then(ok, bad) { return (slow && q.op !== 'select' ? wait(slow).then(run) : Promise.resolve(run())).then(ok, bad); },
  };
  return chain;
}
stub('./supabase', { supabase: { from } });

const React = require(path.join(DEPS, 'react'));
const h = React.createElement;
const asked = [];
let answer = true;
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
stub('../../lib/dialog', { confirmDialog: async ({ message }) => { asked.push(message); return answer; } });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
let photo = 'https://x.org/groups-header.jpg';
stub('../../lib/pageHeaders', { listPageHeaders: async () => (photo ? { groups: photo } : {}) });
// the church calendar as the app reads it (lib/homeCards.js listHomeEvents: raw rows, soonest first)
let calRows = [];
stub('../../lib/homeCards', { listHomeEvents: async () => calRows.map((r) => ({ ...r })) });
const dayIn = (days) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days); return d; };
const isoIn = (days) => { const d = dayIn(days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// AppShell (the frame) has its own suite — here it only has to show the tabs and the page
stub('./AppShell', { __esModule: true, default: ({ title, tabs, children }) => h('div', { className: 'shell' },
  h('h1', null, title),
  tabs ? tabs.options.map((o) => h('button', { key: o.key, 'data-tab': o.key, 'aria-pressed': tabs.value === o.key, onClick: () => tabs.onChange(o.key) }, o.label)) : null,
  children) });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
const { act } = React;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

STUBS['../../lib/groupPosts'] = xform(path.join(PILLAR, 'src/lib/groupPosts.js'), 'groupPosts.cjs');
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
const kit = require(STUBS['./kit']);
const L = require(STUBS['./layout']);
const G = require(xform(path.join(PILLAR, 'src/pages/app/GroupsPage.jsx'), 'GroupsPage.cjs'));
const GroupsPage = G.default;

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('  ✓', name); };
const textOf = (node) => (typeof node === 'string' ? node : (node?.children || []).map(textOf).join(''));
const cls = (x) => String(x.props?.className || '');
// an element (not a component) that has this class
const is = (c) => (x) => typeof x.type === 'string' && cls(x).split(/\s+/).includes(c);

// three groups (one hidden) and four cards (one a draft); ids as the table makes them
function seed() {
  n = 100;
  db.calls = [];
  calRows = [];
  slow = 0;
  db.church_groups = [
    { id: 'g1', name: 'Student Ministry', kind: 'Ministry', about: 'Grades 6–12.', meets: 'Wednesdays 6:30 PM', location: 'Youth Room', audience: 'Grades 6–12', leaders: [{ name: 'Sam Lee', role: 'Pastor' }], filter_key: 'youth', published: true, sort: 10 },
    { id: 'g2', name: 'Women’s Bible Study', kind: 'Class', about: null, meets: 'Thursdays 10 AM', location: 'Room 204', audience: null, leaders: [], filter_key: 'women', published: true, sort: 20 },
    { id: 'g3', name: 'Missions Team', kind: 'Team', about: null, meets: null, location: null, audience: null, leaders: [], filter_key: null, published: false, sort: 30 },
  ];
  db.group_posts = [
    { id: 'p1', group_id: 'g1', title: 'Lock-in', body: 'Pizza and games.', button_label: null, button_url: null, starts_on: null, ends_on: null, published: true, sort: 10 },
    { id: 'p2', group_id: null, title: 'Work day', body: 'Every group is invited.', button_label: 'Details', button_url: 'https://x.org/work', starts_on: null, ends_on: null, published: true, sort: 20 },
    { id: 'p3', group_id: 'g2', title: 'Childcare', body: null, button_label: null, button_url: null, starts_on: null, ends_on: null, published: true, sort: 30 },
    { id: 'p4', group_id: 'g1', title: 'Retreat deposits', body: null, button_label: null, button_url: null, starts_on: null, ends_on: null, published: false, sort: 40 },
  ];
}

async function page() {
  let r;
  await act(async () => { r = TR.create(h(GroupsPage)); });
  await act(async () => { await wait(20); });
  const root = r.root;
  const ui = {
    r, root,
    tabs: () => root.findAll((x) => x.type === 'button' && x.props['data-tab']).map(textOf),
    tab: (k) => act(async () => { root.find((x) => x.type === 'button' && x.props['data-tab'] === k).props.onClick(); }),
    list: () => root.find((x) => x.type === 'section' && /ax-list-pane/.test(cls(x))),
    rows: () => ui.list().findAll((x) => x.props.role === 'option'),
    rowTitles: () => ui.list().findAll((x) => /^ax-row-title/.test(cls(x))).map(textOf),
    count: () => textOf(ui.list().find((x) => cls(x) === 'ax-pane-count')),
    filters: () => ui.list().findAll(is('ax-filter')),
    editor: () => root.find((x) => x.type === 'section' && /ax-editor-pane/.test(cls(x))),
    input: (label, within = root) => within.find((x) => (x.type === 'input' || x.type === 'textarea' || x.type === 'select') && x.props['aria-label'] === label),
    button: (label, within = root) => within.find((x) => x.type === 'button' && (textOf(x).trim() === label || x.props['aria-label'] === label)),
    colB: () => ui.editor().findAllByType(L.ColB)[0],   // the group’s own (the card panel has one too)
    groupCards: () => ui.colB().findAll((x) => /^ax-row-title/.test(cls(x))).map(textOf),
    panel: () => root.findAll((x) => x.type === 'section' && x.props.role === 'dialog')[0] || null,
    phone: () => root.find(is('ax-gr-screen')),
    toast: () => root.findAll((x) => cls(x) === 'ax-toast')[0] || null,
    type: (node, value) => act(async () => { node.props.onChange({ target: { value } }); }),
    press: (node) => act(async () => { node.props.onClick(); }),
    keys: (k, more) => act(async () => { window.dispatchEvent(key(k, more)); await wait(5); }),
    settle: (ms = 900) => act(async () => { await wait(ms); }),   // past the editors' 700 ms autosave
    writes: (table) => db.calls.filter((c) => c.op !== 'select' && (!table || c.table === table)),
  };
  return ui;
}

(async () => {
  await t('both lists load at once; the tabs count them; the first group opens; the phone is the app’s Groups page', async () => {
    seed();
    const ui = await page();
    assert.deepStrictEqual(ui.tabs(), ['Groups · 3', 'Cards · 4']);
    assert.deepStrictEqual(ui.rowTitles(), ['Student Ministry', 'Women’s Bible Study', 'Missions Team']);
    assert.strictEqual(ui.count(), '3 groups · 2 in the app');
    assert.strictEqual(ui.input('Name').props.value, 'Student Ministry', 'the first group is picked (nothing to click to start)');
    const phone = ui.phone();
    const head = phone.find(is('ax-pa-photohead'));
    assert.ok(/groups-header\.jpg/.test(head.props.style.backgroundImage), 'the office’s page photo');
    assert.strictEqual(textOf(head), 'Find your peopleGroups', 'the page’s one name');
    assert.deepStrictEqual(phone.findAll(is('ax-pa-filter')).map(textOf), ['All', 'Class', 'Ministry', 'Youth', 'Women'],
      'All, a pill per kind (sorted), then per calendar ministry in the order the groups name them — members’ groups only');
    assert.deepStrictEqual(phone.findAll(is('ax-pa-heading')).map(textOf), ['From the groups', 'All groups'],
      'the sections, as a phone that follows nothing first sees them');
    const cards = phone.findAll(is('ax-gr-card'));
    assert.deepStrictEqual(cards.map((c) => textOf(c.find((x) => cls(x) === 'ax-gr-card-title'))), ['Student Ministry', 'Women’s Bible Study'],
      'the hidden group isn’t drawn');
    assert.ok(/ax-pa-picked/.test(cls(cards[0])), 'the picked group is outlined');
    assert.strictEqual(textOf(cards[0].find((x) => cls(x) === 'ax-gr-card-sub')), 'Ministry · Grades 6–12', 'the kind and who it’s for, under the name');
    assert.deepStrictEqual(cards[0].findAll((x) => cls(x) === 'ax-gr-face').map(textOf), ['SL']);
    assert.strictEqual(textOf(cards[0].find((x) => cls(x) === 'ax-gr-led-text')), 'Led by Sam Lee', 'who leads it, by name');
    assert.strictEqual(textOf(cards[0].find(is('ax-gr-follow'))), 'Follow');
    assert.deepStrictEqual(cards[0].findAll((x) => cls(x) === 'ax-gr-fact-text').map(textOf), ['Wednesdays 6:30 PM', 'Youth Room']);
    assert.strictEqual(textOf(cards[1].find((x) => cls(x) === 'ax-gr-card-sub')), 'Class', 'no one named: the kind alone');
    assert.strictEqual(cards[1].findAll(is('ax-gr-ask')).length, 0, 'it says when and where, so no “Ask about joining”');
    assert.strictEqual(textOf(phone.find(is('ax-gr-cantfind'))), 'Can’t find one that fits?Message the office', 'never a dead end');
    const strip = phone.findAll(is('ax-gr-ev'));
    assert.deepStrictEqual(strip.map((c) => textOf(c.find((x) => cls(x) === 'ax-gr-ev-title'))), ['Lock-in', 'Work day', 'Childcare'],
      'live cards for members’ groups and for everyone, in the one order — not the draft');
    assert.strictEqual(textOf(strip[0].find(is('ax-pa-tag'))), 'Student Ministry');
    // each kind its colour (HUES, alphabetical: Class, then Ministry) — on the mark, the kind's pill dot
    // and the card's tag; the ministries' pills name no category here, so they carry no dot
    assert.ok(is('ax-gr-hue-teal')(cards[0].find(is('ax-gr-mark'))) && is('ax-gr-hue-gold')(cards[1].find(is('ax-gr-mark'))));
    assert.ok(is('ax-gr-hue-teal')(strip[0].find(is('ax-pa-tag'))), 'Student Ministry’s tag wears Ministry’s colour');
    assert.strictEqual(strip[1].findAll(is('ax-pa-tag')).length, 0, 'a card for everyone has no tag');
    const dots = phone.findAll(is('ax-pa-filter')).map((f) => { const d = f.findAll(is('ax-gr-pill-dot'))[0]; return d ? cls(d).split(' ').pop() : ''; });
    assert.deepStrictEqual(dots, ['', 'ax-gr-hue-gold', 'ax-gr-hue-teal', '', '']);
    assert.strictEqual(textOf(strip[1].find((x) => /ax-gr-ev-btn/.test(cls(x)))), 'Details', 'the button: a label and a web address');
    await act(async () => ui.r.unmount());
  });

  await t('a group’s cards live with it — the group editor lists them, with their switches', async () => {
    seed();
    const ui = await page();
    assert.deepStrictEqual(ui.groupCards(), ['Lock-in', 'Retreat deposits']);
    assert.ok(textOf(ui.colB()).startsWith('Cards for this group'), textOf(ui.colB()));
    await ui.press(ui.rows()[1]);
    assert.deepStrictEqual(ui.groupCards(), ['Childcare']);
    await ui.press(ui.rows()[2]);
    assert.deepStrictEqual(ui.groupCards(), []);
    await act(async () => ui.r.unmount());
  });

  await t('“New card for this group” writes the card in a panel over the group, pre-set to it, saved as it’s typed', async () => {
    seed();
    const ui = await page();
    assert.strictEqual(ui.panel(), null);
    await ui.press(ui.button('New card for this group'));
    const panel = ui.panel();
    assert.ok(panel, 'the panel opens over the group editor');
    assert.strictEqual(ui.tabs()[1], 'Cards · 5');
    assert.ok(/For Student Ministry/.test(textOf(panel)), textOf(panel));
    assert.strictEqual(ui.input('Who it’s for', panel).props.value, 'g1', 'already the group’s');
    await ui.type(ui.input('Title', panel), 'Pizza night');
    await ui.settle();
    const ins = ui.writes('group_posts').filter((c) => c.op === 'insert');
    assert.strictEqual(ins.length, 1, JSON.stringify(ui.writes()));
    assert.strictEqual(ins[0].row.group_id, 'g1');
    assert.strictEqual(ins[0].row.sort, 50, 'one order for every card: after the last (40)');
    assert.strictEqual(ins[0].row.published, false, 'a draft until it’s switched on');
    assert.deepStrictEqual(ui.groupCards(), ['Lock-in', 'Retreat deposits', 'Pizza night']);
    const picked = ui.phone().find((x) => is('ax-gr-ev')(x) && is('ax-pa-picked')(x));
    assert.strictEqual(textOf(picked.find((x) => cls(x) === 'ax-pa-flag')), 'Draft', 'the phone shows it, flagged, until members can see it');
    await ui.press(ui.button('Done', ui.panel()));
    assert.strictEqual(ui.panel(), null);
    assert.deepStrictEqual(ui.groupCards(), ['Lock-in', 'Retreat deposits', 'Pizza night'], 'Done keeps what was written');
    // an untouched new card goes when the panel closes
    await ui.press(ui.button('New card for this group'));
    assert.strictEqual(ui.tabs()[1], 'Cards · 6');
    await ui.keys('Escape');
    assert.strictEqual(ui.panel(), null, 'Escape closes it');
    assert.strictEqual(ui.tabs()[1], 'Cards · 5', 'a card nobody wrote on isn’t left behind');
    await act(async () => ui.r.unmount());
  });

  await t('a group that hasn’t saved saves the moment its first card is asked for; without a name the button says why', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.button('New group'));
    assert.strictEqual(ui.input('Name').props.value, '');
    const btn = ui.button('New card for this group');
    assert.strictEqual(btn.props.disabled, true);
    assert.ok(textOf(ui.colB()).includes('Give the group a name first'), 'never a silently dead button');
    await ui.type(ui.input('Name'), 'Choir');
    assert.strictEqual(ui.button('New card for this group').props.disabled, false);
    assert.strictEqual(ui.writes('church_groups').length, 0, 'not saved yet (the autosave waits 700 ms)');
    await ui.press(ui.button('New card for this group'));
    await act(async () => { await wait(20); });
    const g = ui.writes('church_groups');
    assert.strictEqual(g.length, 1);
    assert.strictEqual(g[0].op, 'insert');
    assert.strictEqual(g[0].row.name, 'Choir');
    const id = db.church_groups.find((x) => x.name === 'Choir').id;
    const panel = ui.panel();
    assert.ok(panel, 'then the card, in its panel');
    assert.strictEqual(ui.input('Who it’s for', panel).props.value, id, 'for the group’s new id');
    await ui.type(ui.input('Title', panel), 'Rehearsal moved');
    await ui.settle();
    assert.strictEqual(db.group_posts.find((p) => p.title === 'Rehearsal moved').group_id, id);
    assert.strictEqual(ui.writes('church_groups').length, 1, 'the group saved once, not twice');
    // Updated after the adversarial check: this used to pin the button OFF on the SAVED group while a
    // leader had a role and no name. A saved group can always take a card — the card needs only its
    // id, not its half-typed edits (the old "Write a card for it" worked whenever the group had an
    // id). The intent — a problem other than the name is named on the button — now lives with a
    // group that has never saved, the only kind that has to save (so be whole) first.
    await ui.press(ui.button('Done', ui.panel()));
    await ui.press(ui.button('Add a leader'));
    await ui.type(ui.input('Leader 1 role'), 'Director');
    assert.strictEqual(ui.button('New card for this group').props.disabled, false, 'saved: a card whatever is half-typed');
    assert.ok(!textOf(ui.colB()).includes('Not yet'), textOf(ui.colB()));
    await ui.press(ui.button('New group'));
    await ui.type(ui.input('Name'), 'Ushers');
    await ui.press(ui.button('Add a leader'));
    await ui.type(ui.input('Leader 1 role'), 'Head usher');
    assert.strictEqual(ui.button('New card for this group').props.disabled, true);
    assert.ok(textOf(ui.colB()).includes('Not yet — Leader 1 needs a name.'), textOf(ui.colB()));
    await act(async () => ui.r.unmount());
  });

  await t('dragging a group’s cards keeps ONE order for every card', async () => {
    assert.deepStrictEqual(G.mergeOrder(['a', 'b', 'c', 'd'], ['d', 'a']), ['d', 'b', 'c', 'a']);
    assert.deepStrictEqual(G.mergeOrder(['a', 'b', 'c'], ['c', 'b']), ['a', 'c', 'b']);
    assert.deepStrictEqual(G.mergeOrder(['a', 'b'], []), ['a', 'b']);
    seed();
    const ui = await page();
    const list = ui.colB().findByType(kit.RowList);
    await act(async () => { list.props.onMove(['p4', 'p1']); await wait(20); });
    const sorts = ui.writes('group_posts').filter((c) => c.op === 'update').map((c) => [c.eq[1], c.row.sort]);
    assert.deepStrictEqual(sorts.sort(), [['p1', 40], ['p4', 10]], 'only the two that moved, into the places they held');
    assert.deepStrictEqual(db.group_posts.sort((a, b) => a.sort - b.sort).map((p) => p.id), ['p4', 'p2', 'p3', 'p1'],
      'the other groups’ cards and the Everyone card kept their places');
    assert.deepStrictEqual(ui.groupCards(), ['Retreat deposits', 'Lock-in']);
    // and a group dragged in a searched list lands among the others the same way
    await ui.type(ui.input('Search groups'), 'team');
    assert.deepStrictEqual(ui.rowTitles(), ['Missions Team']);
    await act(async () => { ui.list().findByType(kit.RowList).props.onMove(['g3']); await wait(20); });
    assert.deepStrictEqual(ui.writes('church_groups'), [], 'nothing moved, nothing written');
    await act(async () => ui.r.unmount());
  });

  await t('both lists search; groups filter by kind; cards filter by group and keep the Everyone cards', async () => {
    seed();
    const ui = await page();
    assert.deepStrictEqual(ui.filters().map(textOf), ['All3', 'Class1', 'Ministry1', 'Team1', 'Hidden1']);
    await ui.type(ui.input('Search groups'), 'bible');
    assert.deepStrictEqual(ui.rowTitles(), ['Women’s Bible Study']);
    assert.strictEqual(ui.count(), '1 of 3 groups · 2 in the app');
    await ui.type(ui.input('Search groups'), 'sam lee');
    assert.deepStrictEqual(ui.rowTitles(), ['Student Ministry'], 'a leader’s name finds their group');
    await ui.type(ui.input('Search groups'), '');
    await ui.press(ui.filters().find((b) => textOf(b) === 'Hidden1'));
    assert.deepStrictEqual(ui.rowTitles(), ['Missions Team']);

    await ui.tab('cards');
    assert.deepStrictEqual(ui.filters().map(textOf), ['All4', 'Everyone1', 'Student Ministry2', 'Women’s Bible Study1']);
    await ui.press(ui.filters().find((b) => textOf(b) === 'Everyone1'));
    assert.deepStrictEqual(ui.rowTitles(), ['Work day']);
    await ui.press(ui.filters().find((b) => textOf(b) === 'Student Ministry2'));
    assert.deepStrictEqual(ui.rowTitles(), ['Lock-in', 'Retreat deposits']);
    assert.strictEqual(ui.count(), '2 of 4 cards · 3 showing');
    await ui.press(ui.button('New card'));
    assert.strictEqual(ui.input('Who it’s for').props.value, 'g1', 'filtered to a group, a new card is that group’s');
    await ui.press(ui.filters().find((b) => /^All/.test(textOf(b))));
    await ui.type(ui.input('Search cards'), 'childcare');
    assert.deepStrictEqual(ui.rowTitles(), ['Childcare']);
    await ui.type(ui.input('Search cards'), 'bible');
    assert.deepStrictEqual(ui.rowTitles(), ['Childcare'], 'the group’s name finds its cards');
    await act(async () => ui.r.unmount());
  });

  await t('switching tabs keeps what each one had picked (nothing reloads)', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.rows()[1]);
    await ui.tab('cards');
    await ui.press(ui.rows()[2]);
    assert.strictEqual(ui.input('Title').props.value, 'Childcare');
    const reads = db.calls.filter((c) => c.op === 'select').length;
    await ui.tab('groups');
    assert.strictEqual(ui.input('Name').props.value, 'Women’s Bible Study');
    await ui.tab('cards');
    assert.strictEqual(ui.input('Title').props.value, 'Childcare');
    assert.strictEqual(db.calls.filter((c) => c.op === 'select').length, reads);
    await act(async () => ui.r.unmount());
  });

  await t('deleting a group with cards asks first, and Undo brings back the group AND its cards', async () => {
    seed();
    asked.length = 0;
    const ui = await page();
    answer = false;
    await ui.press(ui.button('Delete group'));
    assert.deepStrictEqual(asked, ['Delete “Student Ministry”? Its 2 cards go with it.']);
    assert.strictEqual(db.church_groups.length, 3, 'no — nothing happens');
    answer = true;
    await ui.press(ui.button('Delete group'));
    await act(async () => { await wait(20); });
    assert.deepStrictEqual(db.church_groups.map((g) => g.id), ['g2', 'g3']);
    assert.deepStrictEqual(db.group_posts.map((p) => p.id).sort(), ['p2', 'p3'], 'its cards went with it');
    assert.strictEqual(textOf(ui.toast()), '“Student Ministry” deleted with its 2 cards.Undo');
    await ui.press(ui.button('Undo', ui.toast()));
    await act(async () => { await wait(20); });
    const back = db.church_groups.find((g) => g.name === 'Student Ministry');
    assert.ok(back && back.id !== 'g1', 'the group again, with a new id');
    assert.deepStrictEqual(db.group_posts.filter((p) => p.group_id === back.id).map((p) => p.title).sort(), ['Lock-in', 'Retreat deposits']);
    assert.deepStrictEqual(ui.rowTitles(), ['Student Ministry', 'Women’s Bible Study', 'Missions Team'], 'where it was');
    // a group with no cards goes without a question
    asked.length = 0;
    await ui.press(ui.rows()[2]);
    await ui.press(ui.button('Delete group'));
    assert.deepStrictEqual(asked, []);
    await act(async () => ui.r.unmount());
  });

  await t('the button’s hint says what the check allows — http:// or https:// — and a wrong link says so beside it', async () => {
    seed();
    const ui = await page();
    await ui.tab('cards');
    await ui.press(ui.rows()[1]);
    const words = textOf(ui.editor());
    assert.ok(words.includes('The link has to start with http:// or https://.'), words);
    assert.ok(!/start with https:\/\/\./.test(words), 'no longer promises https:// only');
    await ui.type(ui.input('Button link'), 'ftp://x.org');
    const bad = ui.editor().findAll((x) => cls(x) === 'ax-hint bad').map(textOf);
    assert.deepStrictEqual(bad, ['The link has to start with http:// or https://']);
    await ui.type(ui.input('Button link'), 'http://x.org/a');
    await ui.settle();
    assert.strictEqual(db.group_posts.find((p) => p.id === 'p2').button_url, 'http://x.org/a', 'and http:// saves, as promised');
    await act(async () => ui.r.unmount());
  });

  await t('N makes a new group, ⌘/Ctrl+S saves it now, and the phone opens what’s clicked on it', async () => {
    seed();
    const ui = await page();
    await ui.keys('n');
    assert.deepStrictEqual(ui.rowTitles(), ['Student Ministry', 'Women’s Bible Study', 'Missions Team', 'New group']);
    await ui.type(ui.input('Name'), 'Ushers');
    await ui.keys('s', { metaKey: true });
    const g = ui.writes('church_groups');
    assert.strictEqual(g.length, 1, 'saved on the key, not 700 ms later');
    assert.strictEqual(g[0].row.name, 'Ushers');
    // the phone: a group card opens that group; a card in the strip opens the Cards tab on it
    const card = ui.phone().findAll(is('ax-gr-card'))
      .find((c) => textOf(c.find((x) => cls(x) === 'ax-gr-card-title')) === 'Women’s Bible Study');
    await ui.press(card);
    assert.strictEqual(ui.input('Name').props.value, 'Women’s Bible Study');
    const ev = ui.phone().findAll(is('ax-gr-ev')).find((c) => /Work day/.test(textOf(c)));
    await ui.press(ev);
    assert.strictEqual(ui.tabs().length, 2);
    assert.strictEqual(ui.input('Title').props.value, 'Work day');
    await act(async () => ui.r.unmount());
  });

  await t('the phone follows the app when there’s no photo, no groups, or a hidden group is picked', async () => {
    seed();
    photo = '';
    const ui = await page();
    const head = ui.phone().find(is('ax-pa-photohead'));
    assert.ok(/ax-gr-photo-none/.test(cls(head)) && !head.props.style, 'the app’s own photo stands in');
    await ui.press(ui.rows()[2]);
    const hidden = ui.phone().findAll(is('ax-gr-card')).find(is('ax-pa-picked'));
    assert.strictEqual(textOf(hidden.find((x) => cls(x) === 'ax-pa-flag')), 'Hidden', 'drawn only because it’s picked, and flagged');
    assert.strictEqual(textOf(hidden.find(is('ax-gr-ask'))), 'Ask about joining', 'nothing to say about when or where: a way to ask, right there');
    await act(async () => ui.r.unmount());
    photo = 'https://x.org/groups-header.jpg';
    db.church_groups = [];
    db.group_posts = [];
    const empty = await page();
    const names = empty.phone().findAll((x) => cls(x) === 'ax-gr-card-title').map(textOf);
    assert.deepStrictEqual(names, ['Kids', 'Youth', 'College & Young Adults', 'Women', 'Men'], 'no groups: the calendar’s ministries, as the app falls back');
    assert.deepStrictEqual(empty.phone().findAll(is('ax-pa-heading')).map(textOf), ['All groups'], 'no cards, so no “From the groups”');
    assert.deepStrictEqual(empty.phone().findAll(is('ax-pa-filter')).map(textOf), ['All', 'Kids', 'Youth', 'College & Young Adults', 'Women', 'Men'],
      'and their pills, as the app makes them from the fallback list');
    await act(async () => empty.r.unmount());
  });

  await t('the phone reads the church calendar as the app does: “N coming up”, the next event’s when and where, This week', async () => {
    seed();
    // Women’s Bible Study leaves its when and where blank, so the app borrows them from its next event
    db.church_groups[1].meets = null;
    db.church_groups[1].location = null;
    calRows = [
      { id: 'e0', title: 'Youth Car Wash', category: 'Other', start_date: isoIn(-6), end_date: isoIn(-2), start_time: null, end_time: null, location: 'Lot' },
      { id: 'e1', title: 'Lock-in', category: 'Youth & Young Adults', start_date: isoIn(3), end_date: null, start_time: '19:00:00', end_time: '22:00:00', location: 'Gym' },
      { id: 'e2', title: 'Student worship night', category: 'Worship', start_date: isoIn(10), end_date: null, start_time: '18:30:00', end_time: null, location: 'Youth Room' },
      { id: 'e3', title: 'Ladies Tea', category: 'Other', start_date: isoIn(20), end_date: null, start_time: null, end_time: null, location: 'Fellowship Hall' },
      { id: 'e4', title: 'Deacons meeting', category: 'Meetings', start_date: isoIn(1), end_date: null, start_time: '19:00:00', end_time: null, location: 'Room 1' },
    ];
    const ui = await page();
    const phone = ui.phone();
    assert.deepStrictEqual(phone.findAll(is('ax-pa-filter')).map(textOf), ['All', 'This week', 'Class', 'Ministry', 'Youth', 'Women'],
      'This week once a group’s next event is inside seven days, right after All (groupFilters)');
    const cards = phone.findAll(is('ax-gr-card'));
    const facts = (c) => c.findAll((x) => cls(x) === 'ax-gr-fact-text').map(textOf);
    assert.deepStrictEqual(facts(cards[0]), ['Wednesdays 6:30 PM', 'Youth Room', '2 coming up'],
      'the office’s own words come first; the ended car wash isn’t counted; the deacons aren’t youth');
    const tea = dayIn(20);
    assert.deepStrictEqual(facts(cards[1]),
      [`${DAY_NAMES[tea.getDay()]}, ${MONTHS3[tea.getMonth()]} ${tea.getDate()}`, 'Fellowship Hall', '1 coming up'],
      'blank when and where: the next event’s (no time → the day and date)');
    assert.strictEqual(cards[1].findAll(is('ax-gr-ask')).length, 0);
    // the editor says what the tie gives the card right now
    const lockin = dayIn(3);
    assert.ok(textOf(ui.editor()).includes(`On phones now: “2 coming up” — next, Lock-in, ${DAY_NAMES[lockin.getDay()]} at 7:00 PM.`), textOf(ui.editor()));
    await act(async () => ui.r.unmount());
    // unit: the app's own rules, ported
    const ev = G.calendarEvents([{ title: 'Men’s breakfast', category: null, start_date: '2026-10-03', end_date: null, start_time: '08:00:00', end_time: '09:30:00', location: 'Hall' }], new Date(2026, 9, 1, 9));
    assert.deepStrictEqual(ev.map((e) => [e.title, e.cat, e.times, e.location]), [['Men’s breakfast', 'Event', '8:00 AM – 9:30 AM', 'Hall']]);
    assert.strictEqual(G.meetsWhen(ev[0]), 'Saturday at 8:00 AM');
    assert.strictEqual(G.meetsWhen({ when: new Date(2026, 9, 3), times: '' }), 'Saturday, Oct 3');
    assert.strictEqual(G.meetsWhen(null), null);
    assert.strictEqual(G.calendarEvents([{ title: 'Gone', start_date: '2026-09-01' }], new Date(2026, 9, 1)).length, 0, 'what has ended is dropped');
    assert.deepStrictEqual(G.calendarFor('youth', null), { count: null, next: null, soon: false }, 'before the calendar is read: nothing said');
    assert.deepStrictEqual(G.calendarFor('', ev), { count: 0, next: null, soon: false }, 'not tied: nothing on it');
    const men = G.calendarFor('men', ev, new Date(2026, 9, 1, 9));
    assert.strictEqual(men.count, 1);
    assert.strictEqual(men.soon, true);
    assert.strictEqual(G.calendarFor('men', ev, new Date(2026, 8, 20, 9)).soon, false, 'thirteen days out is not this week');
    assert.strictEqual(G.matchesMinistry('toString', { title: 'x', cat: 'x' }), false, 'only the five ministries');
  });

  // (was: "keeps the facts block, then the empty line" — the app's card no longer has either)
  await t('a group with nothing to say about when or where: no facts, “Ask about joining” in its foot, Follow in its corner', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.rows()[2]);   // Missions Team: nothing but a name, and nothing on the calendar
    const card = ui.phone().findAll(is('ax-gr-card')).find(is('ax-pa-picked'));
    assert.strictEqual(card.findAll(is('ax-gr-facts')).length, 0, 'no facts block at all (GroupCard draws it only with something in it)');
    const foot = card.find(is('ax-gr-card-foot'));
    const kids = foot.children.filter((x) => typeof x !== 'string' && typeof x.type === 'string').map(cls);
    assert.deepStrictEqual(kids, ['ax-pa-quiet ax-gr-ask', 'ax-pa-btn ax-gr-follow']);
    assert.strictEqual(textOf(card.find((x) => cls(x) === 'ax-gr-card-sub')), 'Team');
    assert.strictEqual(card.findAll(is('ax-gr-led')).length, 0, 'nobody named, no leaders row');
    await act(async () => ui.r.unmount());
    // leaders, but no when or where: who leads it AND a way to ask (the app draws both)
    seed();
    db.church_groups[0].meets = null;
    db.church_groups[0].location = null;
    db.church_groups[0].leaders = [{ name: 'Sam Lee', role: 'Pastor' }, { name: 'Ann Cole', role: '' }, { name: 'Bo Diaz', role: '' }];
    const two = await page();
    const led = two.phone().findAll(is('ax-gr-card'))[0];
    assert.strictEqual(led.findAll(is('ax-gr-facts')).length, 0);
    assert.deepStrictEqual(led.findAll(is('ax-gr-face')).map(textOf), ['SL', 'AC', 'BD'], 'every leader’s face, side by side');
    assert.strictEqual(textOf(led.find((x) => cls(x) === 'ax-gr-led-text')), 'Led by Sam Lee, Ann Cole and Bo Diaz', 'every name, whole');
    assert.strictEqual(textOf(led.find(is('ax-gr-ask'))), 'Ask about joining');
    // when and where, but nobody named: the foot keeps Follow at its end (the room "Ask" would take before it)
    const plain = two.phone().findAll(is('ax-gr-card'))[1];
    const kids2 = plain.find(is('ax-gr-card-foot')).children.filter((x) => typeof x !== 'string' && typeof x.type === 'string').map(cls);
    assert.deepStrictEqual(kids2, ['ax-gr-foot-space', 'ax-pa-btn ax-gr-follow']);
    await act(async () => two.r.unmount());
    // ledBy, the app's own words
    assert.strictEqual(G.ledBy([{ name: 'Janet Barber' }]), 'Led by Janet Barber');
    assert.strictEqual(G.ledBy([{ name: 'Janet Barber' }, { name: 'Joey Loudermilk' }]), 'Led by Janet Barber and Joey Loudermilk');
    assert.strictEqual(G.ledBy([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]), 'Led by A, B, C and D');
    assert.strictEqual(G.ledBy([]), '');
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/groups.css'), 'utf8');
    assert.ok(/\.ax-gr-card \{[^}]*display: flex; flex-direction: column;/.test(css), 'a column, so the margins add up and never collapse');
  });

  await t('no photo, an http:// pick, or a pick with a space: phones show the app’s own community.jpg', async () => {
    for (const pick of ['', 'http://x.org/groups.jpg', 'https://x.org/a b.jpg']) {
      seed();
      photo = pick;
      const ui = await page();
      const head = ui.phone().find(is('ax-pa-photohead'));
      assert.ok(/ax-gr-photo-none/.test(cls(head)) && !head.props.style, `“${pick}” → the app’s own photo`);
      assert.ok(!/Page photos, so phones show/.test(textOf(ui.root)), 'no caption needed: the phone shows the real photo');
      await act(async () => ui.r.unmount());
    }
    photo = 'https://x.org/groups-header.jpg';
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/groups.css'), 'utf8');
    assert.ok(/\.ax-gr-photo-none \{ background-image: url\('\.\/img\/community\.jpg'\); \}/.test(css), 'the app’s own file');
    const mine = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/img/community.jpg'));
    const appFile = path.join(APP, 'assets/home/community.jpg');
    if (fs.existsSync(appFile)) assert.ok(mine.equals(fs.readFileSync(appFile)), 'byte for byte the app’s assets/home/community.jpg');
    const app = path.join(APP, 'utils/pageHeaders.js');
    if (fs.existsSync(app)) assert.ok(fs.readFileSync(app, 'utf8').includes('/^https:\\/\\/\\S+$/.test('), 'the app still keeps only https://');
  });

  await t('the phone’s pills are keyed as the app keys them — a kind named like a ministry is no clash', async () => {
    assert.deepStrictEqual(G.phonePills([{ kind: 'Youth', filter_key: 'youth' }, { kind: 'All', filter_key: 'women', soon: true }]).map((p) => p.key),
      ['all', 'week', 'kind:All', 'kind:Youth', 'who:youth', 'who:women']);
    seed();
    db.church_groups[0].kind = 'Youth';
    const said = [];
    const was = console.error;
    console.error = (...a) => { said.push(a.join(' ')); };
    try {
      const ui = await page();
      assert.deepStrictEqual(ui.phone().findAll(is('ax-pa-filter')).map(textOf), ['All', 'Class', 'Youth', 'Youth', 'Women']);
      await act(async () => ui.r.unmount());
    } finally { console.error = was; }
    assert.deepStrictEqual(said.filter((m) => /same key/i.test(m)), [], 'no duplicate React keys');
  });

  await t('clicking the panel’s own new card on the phone keeps it and opens it on the Cards tab', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.button('New card for this group'));
    assert.strictEqual(ui.tabs()[1], 'Cards · 5');
    const ev = ui.phone().findAll(is('ax-gr-ev')).find(is('ax-pa-picked'));
    assert.strictEqual(textOf(ev.find((x) => cls(x) === 'ax-pa-flag')), 'Not saved yet');
    await ui.press(ev);
    assert.strictEqual(ui.panel(), null);
    assert.strictEqual(ui.tabs()[1], 'Cards · 5', 'kept, not thrown away');
    assert.strictEqual(ui.input('Title').props.value, '', 'the Cards tab is on it');
    assert.strictEqual(ui.input('Who it’s for').props.value, 'g1');
    assert.ok(!textOf(ui.editor()).includes('Pick a card'), textOf(ui.editor()));
    await act(async () => ui.r.unmount());
  });

  await t('the card panel never moves the Cards tab’s pick — opening, closing, discarding or deleting', async () => {
    seed();
    const ui = await page();
    await ui.tab('cards');
    await ui.press(ui.rows()[2]);
    assert.strictEqual(ui.input('Title').props.value, 'Childcare');
    await ui.tab('groups');
    await ui.press(ui.button('New card for this group'));
    await ui.keys('Escape');   // untouched: it goes
    assert.strictEqual(ui.tabs()[1], 'Cards · 4');
    await ui.tab('cards');
    assert.strictEqual(ui.input('Title').props.value, 'Childcare', 'not the first card');
    await ui.tab('groups');
    await ui.press(ui.colB().findAll((x) => x.props.role === 'option')[0]);   // Lock-in, in the panel
    assert.strictEqual(ui.input('Title', ui.panel()).props.value, 'Lock-in');
    await ui.press(ui.button('Done', ui.panel()));
    await ui.tab('cards');
    assert.strictEqual(ui.input('Title').props.value, 'Childcare', 'opening one in the panel didn’t move it');
    await ui.tab('groups');
    await ui.press(ui.colB().findAll((x) => x.props.role === 'option')[0]);
    await ui.press(ui.button('Delete card', ui.panel()));
    await act(async () => { await wait(20); });
    assert.strictEqual(ui.panel(), null);
    assert.deepStrictEqual(ui.groupCards(), ['Retreat deposits']);
    await ui.tab('cards');
    assert.strictEqual(ui.input('Title').props.value, 'Childcare', 'deleting in the panel didn’t move it either');
    await ui.press(ui.button('Undo', ui.toast()));
    await act(async () => { await wait(20); });
    assert.strictEqual(ui.input('Title').props.value, 'Childcare', 'nor did Undo');
    assert.ok(ui.rowTitles().includes('Lock-in'));
    await act(async () => ui.r.unmount());
  });

  await t('a new card with only dates, or moved to another group, isn’t thrown away when the panel closes', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.button('New card for this group'));
    await ui.type(ui.input('Show from', ui.panel()), '2026-10-01');
    await ui.keys('Escape');
    assert.strictEqual(ui.tabs()[1], 'Cards · 5', 'a date is something written');
    await ui.press(ui.button('New card for this group'));
    await ui.type(ui.input('Who it’s for', ui.panel()), '');
    await ui.press(ui.button('Done', ui.panel()));
    assert.strictEqual(ui.tabs()[1], 'Cards · 6', 'so is who it’s for');
    await ui.press(ui.button('New card for this group'));
    await ui.press(ui.button('Done', ui.panel()));
    assert.strictEqual(ui.tabs()[1], 'Cards · 6', 'untouched still goes');
    await act(async () => ui.r.unmount());
  });

  await t('“Saving the group…” belongs to the group that is saving, not every group', async () => {
    seed();
    const ui = await page();
    await ui.press(ui.button('New group'));
    await ui.type(ui.input('Name'), 'Choir');
    slow = 120;
    await ui.press(ui.button('New card for this group'));
    const busy = ui.button('Saving the group…');
    assert.strictEqual(busy.props.disabled, true);
    await ui.press(ui.rows()[0]);
    assert.strictEqual(ui.button('New card for this group').props.disabled, false, 'Student Ministry isn’t waiting on Choir');
    await ui.settle(250);
    slow = 0;
    assert.strictEqual(ui.panel(), null, 'they moved on, so no panel opens over another group');
    await ui.press(ui.rows()[3]);
    assert.strictEqual(ui.input('Name').props.value, 'Choir');
    assert.strictEqual(ui.button('New card for this group').props.disabled, false);
    await act(async () => ui.r.unmount());
  });

  await t('the list’s foot offers N and / only while they work — not while the card panel is open', async () => {
    seed();
    const ui = await page();
    const caps = () => ui.list().find(is('ax-hotkeys')).findAll((x) => x.type === 'kbd').map(textOf);   // the foot's
    assert.deepStrictEqual(caps().slice(0, 2), ['N', '/']);
    assert.ok(caps().some((c) => /S$/.test(c)), 'and ⌘S, the editor saves on it');
    await ui.press(ui.button('New card for this group'));
    assert.ok(!caps().includes('N') && !caps().includes('/'), caps().join(' '));
    assert.ok(caps().some((c) => /S$/.test(c)), 'the panel saves on ⌘S too');
    await ui.keys('n');
    assert.strictEqual(ui.rowTitles().length, 3, 'and N really does nothing then');
    await act(async () => ui.r.unmount());
  });

  await t('the page keeps the rules: no static inline styles, every ax- class it uses exists, no !important', async () => {
    const src = fs.readFileSync(path.join(PILLAR, 'src/pages/app/GroupsPage.jsx'), 'utf8');
    const styles = src.split('\n').filter((l) => /style=\{/.test(l));
    assert.ok(styles.length >= 1);
    for (const l of styles) assert.ok(/backgroundImage|--ax-/.test(l), `only dynamic values inline: ${l.trim()}`);
    const css = ['phone', 'base', 'groups'].map((f) => fs.readFileSync(path.join(PILLAR, `src/pages/app/css/${f}.css`), 'utf8')).join('\n');
    const used = new Set();
    for (const m of src.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      for (const tok of (m[1] || m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^ax-[a-z0-9-]*[a-z0-9]$/.test(tok)) used.add(tok);
    }
    for (const c of used) assert.ok(new RegExp(`\\.${c}(?![\\w-])`).test(css), `.${c} has a rule`);
    const own = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/groups.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/!important/.test(own));
    // every class a selector starts from is ours (a modifier after one — .ax-row.on — may be short)
    for (const m of own.matchAll(/(?:^|[\s,>+~(])\.([a-z][\w-]*)/g)) assert.ok(m[1].startsWith('ax-'), `.${m[1]} keeps the ax- prefix`);
  });

  await t('the phone’s numbers are the app’s own (BethesdaApp screens/GroupsScreen.js)', async () => {
    const file = path.join(APP, 'screens/GroupsScreen.js');
    if (!fs.existsSync(file)) { console.log('    (the app isn’t beside Pillar — skipped)'); return; }
    const app = fs.readFileSync(file, 'utf8');
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/groups.css'), 'utf8');
    const has = (re, what) => assert.ok(re.test(app), `the app still has ${what}`);
    const rule = (sel, body) => assert.ok(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*${body}`).test(css), `${sel}: ${body}`);
    // the page: its one name, the short photo, the search, a section's gap
    has(/Text style=\{s\.kicker\}>FIND YOUR PEOPLE</, 'the kicker');
    has(/accessibilityRole="header">Groups<\/Text>/, 'the page’s one name');
    has(/const PHOTO_H = 150;/, 'the short photo (phone.css .ax-pa-photohead: 59 + 150)');
    has(/placeholder="Search groups"/, 'the search placeholder');
    has(/searchBlock: \{ paddingHorizontal: PAD, marginTop: 16 \}/, 'the search 16 under the photo');
    rule('.ax-gr-search', 'margin-top: 16px; padding: 0 20px;');
    has(/filters: +\{ flexDirection: 'row', gap: 8, paddingHorizontal: PAD, paddingTop: 14 \}/, 'the pills 14 under the search');
    rule('.ax-gr-filters', 'padding-top: 14px;');
    has(/section: +\{ marginTop: 26 \}/, 'a section');
    rule('.ax-gr-section', 'margin-top: 26px;');
    has(/restTitle: mine\.length \? 'More groups' : 'All groups'/, '“All groups” while nothing is followed');
    has(/\{ title: 'From the groups', items: strip \}/, '“From the groups” while nothing is followed');
    has(/list: \{ paddingHorizontal: PAD, marginTop: 4, gap: 12 \}/, 'the list');
    rule('.ax-gr-list', 'gap: 12px; padding: 0 20px; margin-top: 4px;');
    // a group's card: cream, the mark and the name, the facts and the foot on the name's left edge
    has(/card: \{\s*backgroundColor: C\.card, borderRadius: 20, padding: 18,\s*\}/, 'the cream card, no outline');
    rule('.ax-gr-card', 'padding: 18px; border-radius: 20px; background: var\\(--ax-app-card\\);');
    has(/cardHead: +\{ flexDirection: 'row', alignItems: 'center', gap: 12 \}/, 'the mark beside the name');
    rule('.ax-gr-card-head', 'display: flex; align-items: center; gap: 12px;');
    has(/mark: +\{ width: 44, height: 44, borderRadius: 22,/, 'the mark');
    has(/const ON_CARD = \{ light: '#FFFFFF'/, 'white on the cream (Follow, the faces, a tag)');
    has(/<View style=\{\[s\.mark, \{ backgroundColor: hue\[mode\]\.bg \}\]\}>\s*<Feather name=\{iconFor\(group\.label\)\} size=\{20\} color=\{hue\[mode\]\.fg\} \/>/,
      'the mark in its kind’s colour, the glyph in the deep tone');
    rule('.ax-gr-mark', 'width: 44px; height: 44px; border-radius: 22px;[^}]*background: var\\(--ax-gr-hue-bg\\); color: var\\(--ax-gr-hue-fg\\);');
    // the kinds' colours (HUES, the LIGHT look), in the app's order, and how a kind gets one
    // the colours live in the app's constants/hues.js since 2026-09-23 (shared, one set); the page imports them
    has(/import \{ HUES \} from '\.\.\/constants\/hues';/, 'the Groups page takes the shared colours');
    const huesSrc = fs.readFileSync(path.join(APP, 'constants/hues.js'), 'utf8');
    const hues = [...huesSrc.matchAll(/\{ key: '(\w+)',\s+light: \{ bg: '(#[0-9A-F]{6})', fg: '(#[0-9A-F]{6})' \}/g)].map((m) => m.slice(1));
    assert.strictEqual(hues.length, 5, 'five colours');
    assert.deepStrictEqual(hues.map((h) => h[0]), G.HUES, 'the same order');
    for (const [k, bg, fg] of hues) rule(`.ax-gr-hue-${k}`, `--ax-gr-hue-bg: ${bg}; --ax-gr-hue-fg: ${fg};`);
    has(/const cats = \[\.\.\.new Set\(\(groups \|\| \[\]\)\.map\(categoryOf\)\)\]\.sort\(\);/, 'the categories, alphabetical');
    has(/const hueOf = \(g\) => hues\.get\(categoryOf\(g\)\) \|\| HUES\[0\];/, 'the first colour for one it doesn’t know');
    const map = G.groupHues([{ kind: 'Team' }, { kind: '', filter_key: 'men' }, { kind: 'Class' }, { kind: '', filter_key: '' }]);
    assert.deepStrictEqual([...map.entries()], [['Class', 'gold'], ['Group', 'teal'], ['Men', 'tangerine'], ['Team', 'pink']],
      'the kind, else the ministry’s name, else “Group” — sorted, a colour each');
    has(/cardTitle: \{\s*fontFamily: 'BeVietnamPro_700Bold', fontSize: 19, lineHeight: 24, letterSpacing: -0\.4, color: C\.text,/, 'the card title');
    rule('.ax-gr-card-title', 'font-size: 19px; font-weight: 700; line-height: 24px; letter-spacing: -0.4px;');
    has(/cardSub: +\{ fontFamily: 'BeVietnamPro_500Medium', fontSize: 13\.5, lineHeight: 18, color: C\.text2, marginTop: 2 \}/, 'the line under the name');
    has(/const sub = \[group\.kind, group\.audience\]\.filter\(Boolean\)\.join\(' \\u00B7 '\);/, 'the kind, then who it’s for');
    rule('.ax-gr-card-sub', 'margin-top: 2px; font-size: 13.5px; font-weight: 500; line-height: 18px; color: var\\(--ax-app-text2\\);');
    has(/cardBody: +\{ marginLeft: 56 \}/, 'one left edge');
    rule('.ax-gr-card-body', 'margin-left: 56px;');
    has(/facts: +\{ marginTop: 12, gap: 8 \}/, 'the facts');
    rule('.ax-gr-facts', 'gap: 8px; margin-top: 12px;');
    has(/<Feather name=\{icon\} size=\{15\} color=\{C\.text2\} style=\{\{ marginTop: 3 \}\} \/>/, 'a fact’s icon');
    rule('.ax-gr-fact > .ax-pa-icon', 'margin-top: 3px; color: var\\(--ax-app-text2\\);');
    has(/factTxt: \{ flex: 1, fontFamily: 'BeVietnamPro_400Regular', fontSize: 15\.5, lineHeight: 22, color: C\.text \}/, 'a fact');
    rule('.ax-gr-fact-text', 'font-size: 15.5px; line-height: 22px; color: var\\(--ax-app-text\\);');
    has(/cardFoot: +\{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 \}/, 'the foot');
    rule('.ax-gr-card-foot', 'display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px;');
    has(/footSpace: \{ flex: 1 \}/, 'the room “Ask about joining” would take');
    rule('.ax-gr-foot-space', 'flex: 1 1 0;');
    has(/led: +\{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 \}/, 'who leads it, its own row');
    rule('.ax-gr-led', 'display: flex; align-items: flex-start; gap: 8px; margin-top: 12px;');
    has(/faces: +\{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 0, maxWidth: '45%' \}/, 'the faces, side by side');
    rule('.ax-gr-faces', 'flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 4px; max-width: 45%;');
    has(/faceTxt: +\{ fontFamily: 'BeVietnamPro_700Bold', fontSize: 11 \}/, 'a face’s initials');
    has(/\{leaders\.map\(\(p\) => <LeaderFace key=\{p\.name\} leader=\{p\} size=\{28\} \/>\)\}/, 'a 28pt face for every leader');
    rule('.ax-gr-face', 'width: 28px; height: 28px;[^}]*background: #FFFFFF; color: var\\(--ax-app-text2\\); font-size: 11px; font-weight: 700;');
    has(/ledTxt: +\{ flex: 1, fontFamily: 'BeVietnamPro_600SemiBold', fontSize: 13\.5, lineHeight: 19, color: C\.text2, paddingTop: 4 \}/, '“Led by …”');
    rule('.ax-gr-led-text', 'padding-top: 4px; font-size: 13.5px; font-weight: 600; line-height: 19px;');
    has(/<Text style=\{s\.quietTxt\}>Ask about joining<\/Text>/, '“Ask about joining”');
    has(/followWord: +\{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15 \}/, 'Follow’s words');
    has(/const size = big \? 56 : 44;/, 'Follow, 44 tall on a card');
    has(/const rest = onSheet \? C\.card : ON_CARD\[mode\];/, 'white on the card');
    rule('.ax-pa-btn.ax-gr-follow', 'align-self: flex-start; padding: 0 15px; gap: 6px; background: #FFFFFF;');
    // the office's cards: cream now (blue means "following" and nothing else)
    has(/STRIP_W = 236/, 'STRIP_W 236');
    has(/evCard: \{\s*width: STRIP_W, backgroundColor: C\.card, borderRadius: 18, padding: 16,\s*\}/, 'the strip card');
    rule('.ax-gr-ev', 'width: 236px; padding: 16px; border-radius: 18px; background: var\\(--ax-app-card\\);');
    has(/evTitle: \{ fontFamily: 'BeVietnamPro_700Bold', fontSize: 17, lineHeight: 22, letterSpacing: -0\.3/, 'the strip title');
    rule('.ax-gr-ev-title', 'font-size: 17px; font-weight: 700; line-height: 22px; letter-spacing: -0.3px;');
    has(/evTag: \{\s*alignSelf: 'flex-start', marginBottom: 10, backgroundColor: ON_CARD\[C\.mode\],/, 'the tag, white on the cream');
    has(/<View style=\{\[s\.evTag, hue && \{ backgroundColor: hue\[mode\]\.bg \}\]\}>/, 'a group’s tag in its kind’s colour');
    rule('.ax-gr-ev > .ax-pa-tag.ax-gr-tag-hue', 'background: var\\(--ax-gr-hue-bg\\); color: var\\(--ax-gr-hue-fg\\);');
    has(/filter: +\{ \.\.\.btn\.md, backgroundColor: C\.card, paddingHorizontal: 18, gap: 8 \}/, 'a pill');
    rule('.ax-gr-filters .ax-pa-filter', 'gap: 8px;');
    has(/pillDot: +\{ width: 9, height: 9, borderRadius: 5 \}/, 'a kind pill’s dot');
    rule('.ax-gr-pill-dot', 'width: 9px; height: 9px; border-radius: 5px; background: var\\(--ax-gr-hue-fg\\);');
    // never a dead end
    has(/cantFind: +\{ paddingHorizontal: PAD, marginTop: 26, gap: 10, alignItems: 'flex-start' \}/, 'the foot of the page');
    rule('.ax-gr-cantfind', 'align-items: flex-start; gap: 10px; padding: 0 20px; margin-top: 26px;');
    has(/'Can’t find one that fits\?'/, 'its words');
    has(/office: +\{ \.\.\.btn\.md, \.\.\.btn\.outline, borderColor: C\.text, paddingHorizontal: 18, gap: 8 \}/, 'the office button');
    rule('.ax-pa-btn.outline.ax-gr-office', 'padding: 0 18px; gap: 8px; border-color: var\\(--ax-app-text\\);');
    has(/<Text style=\{s\.officeTxt\}>Message the office<\/Text>/, 'its words');
    // the pills: kinds sorted, then ministries in the order the groups name them, only with 2+ (they
    // are {key, label} now, keyed as the app keys them — the labels are what these always pinned)
    const labels = (list) => G.phonePills(list).map((p) => p.label);
    assert.deepStrictEqual(labels([{ kind: 'B', filter_key: 'men' }, { kind: 'A', filter_key: 'kids' }]), ['All', 'A', 'B', 'Men', 'Kids']);
    assert.deepStrictEqual(labels([{ kind: 'A', filter_key: 'men' }, { kind: 'A', filter_key: 'men' }]), ['All'], 'one kind is “All”');
    // where the app sets no lineHeight, Be Vietnam Pro's own: 1.265 (hhea 1000 / −265 / 0)
    for (const sel of ['.ax-gr-screen .ax-pa-photohead-words .ax-pa-kicker', '.ax-gr-ev > .ax-pa-tag', '.ax-gr-face',
      '.ax-gr-cantfind-text']) rule(sel, 'line-height: 1\\.265');
    for (const style of ['kicker: {', 'evTagTxt:', 'faceTxt:', 'cantFindTxt:']) {
      const at = app.indexOf(style);
      assert.ok(at > -1 && !/lineHeight/.test(app.slice(at, app.indexOf('}', at))), `${style} still sets no lineHeight in the app`);
    }
    const font = path.join(APP, 'node_modules/@expo-google-fonts/be-vietnam-pro/700Bold/BeVietnamPro_700Bold.ttf');
    if (fs.existsSync(font)) {
      const b = fs.readFileSync(font);
      const tables = {};
      for (let i = 0; i < b.readUInt16BE(4); i++) tables[b.toString('latin1', 12 + 16 * i, 16 + 16 * i)] = b.readUInt32BE(20 + 16 * i);
      const hh = tables.hhea;
      assert.deepStrictEqual([b.readInt16BE(hh + 4), b.readInt16BE(hh + 6), b.readInt16BE(hh + 8), b.readUInt16BE(tables.head + 18)], [1000, -265, 0, 1000]);
    }
    // the calendar's ministries and the card's calendar parts, as the app has them
    const filters = fs.readFileSync(path.join(APP, 'utils/eventFilters.js'), 'utf8');
    for (const [k, f] of Object.entries(G.MINISTRY_RULES)) {
      assert.ok(filters.includes(`key: '${k}'`) && filters.includes(`words: ${String(f.words)}`), `${k}: the app's words`);
      if (f.cats) assert.ok(filters.includes(`cats: ${JSON.stringify(f.cats).replace(/"/g, "'")}`), `${k}: the app's categories`);
    }
    has(/const WEEK = 7 \* 24 \* 60 \* 60 \* 1000;/, 'WEEK');
    has(/const HORIZON = 2;/, 'the two-month horizon (listHomeEvents reads the same)');
    has(/const whenOf = \(g\) => g\?\.meets \|\| meetsWhen\(g\?\.next\) \|\| '';/, 'the office’s when first, else the next event’s');
    has(/const whereOf = \(g\) => g\?\.location \|\| g\?\.next\?\.location \|\| '';/, 'the office’s where first');
    has(/\{count > 0 \? <Fact icon="calendar">\{`\$\{count\} coming up`\}<\/Fact> : null\}/, '“N coming up”, a fact');
    has(/const bare = !next && !when && !where;/, '“Ask about joining” only with nothing to say about when or where');
    has(/if \(groups\.some\(\(g\) => g\.soon\)\) out\.push\(\{ key: 'week', label: 'This week' \}\);/, 'This week');
    has(/const PHOTO = require\('\.\.\/assets\/home\/community\.jpg'\);/, 'the app’s own photo');
    assert.strictEqual(G.iconFor('Choir'), 'music');
    assert.strictEqual(G.iconFor('Children’s Ministry'), 'smile');
    assert.strictEqual(G.initialsOf('  Mary Ann Smith '), 'MA');
  });

  console.log(`${ok} Groups redesign checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
