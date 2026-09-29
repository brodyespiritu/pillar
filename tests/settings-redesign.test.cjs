// Pillar → App → Settings and Notifications after the redesign (2026-09-23,
// Pillar-backups/redesign/DESIGN.md §4), rendered with react-test-renderer:
//
// Review fixes (2026-09-23): Settings fits the mockup's one screen — an iPhone pane and an Android pane,
// then Page photos beside the website — and its phones are the app as it is: signed out (the "Sign in"
// pill, not the profile disc), the newest sermon and the office's shortcut words under the card, an
// Android status bar on the Android phone, the Groups crop ending under its search bar. Off always takes
// effect, even while an edit blocks saving; a switch saves when it's flipped; the "Not on phones" mark
// follows the database; the connection test can't cross a website save; a photo address box can't save
// what Escape put away; only a missing table asks for the SQL.
//
// Settings — a grid of panels instead of one long column. Update needed shows iPhone and Android side
// by side, each phone beside its fields, the card drawn as the app draws it (BethesdaApp
// components/UpdateNeeded.js). The newest-APK pill lights up. The switch never reads "On" while the
// card can't be saved on, and says why right under it. A generic load error offers a retry instead of
// "run the SQL". Page photos: each previewed as the top of its page in the app; a typed address saves
// when the box is left or Enter is pressed — never letter by letter — and only a https:// one; Remove
// has Undo; the save state is the kit's SaveState. The website retries a failed load; ⌘S saves what's
// waiting at once; the connection test saves the website first.
//
// Notifications — the form and the locked phone side by side (no drawer), the real day and time, the
// app's own icon, ⌘/Ctrl+Enter sends (and still asks first, in the same words), the draft is kept and
// guarded, and the phone count reads the same everywhere.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const OUT = path.join(__dirname, '.build-settings'); fs.mkdirSync(OUT, { recursive: true });
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

// ── a pretend browser: the window's key and unload events, sessionStorage, a document ──
const listeners = {};
const session = new Map();
globalThis.window = {
  location: { origin: 'https://pillar.example' },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  dispatchEvent: (e) => { for (const fn of [...(listeners[e.type] || [])]) fn(e); return true; },
  sessionStorage: { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => { session.set(k, String(v)); }, removeItem: (k) => { session.delete(k); } },
};
globalThis.document = {
  activeElement: null,
  querySelector: () => null,
  createElement: (tag) => ({ tagName: tag }),
  getElementById: () => null,
  head: { appendChild: () => {} },
};
const guarded = () => (listeners.beforeunload ? listeners.beforeunload.size : 0);

const React = require(path.join(DEPS, 'react'));
const h = React.createElement;
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
const asked = []; const answers = [];
stub('../../lib/dialog', { confirmDialog: async ({ message }) => { asked.push(message); return answers.length ? answers.shift() : true; } });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
// AppShell's frame (TopNav, the sidebar) is layout.test's; here it only carries the title, the line and the page
stub('./AppShell', { __esModule: true, default: ({ title, subtitle, actions, children }) => h('div', { className: 'shell', 'data-title': title, 'data-sub': subtitle }, actions, children) });

// ── the app server (appApi) ──
const api = { settings: { churchName: 'Bethesda Baptist Church', tagline: 'Where every life matters', heroImageUrl: '', other: 7 },
  failSettings: 0, puts: [], count: 214, failCount: false, sent: [], failSend: '', log: [], slowPut: 0,
  sermons: [
    { id: 1, title: 'Older', date: '2026-09-06', videoLink: 'https://youtu.be/aaaaaaaaaaa' },
    { id: 2, title: 'Faith that Works', date: '2026-09-20', thumbnailUrl: '', videoLink: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
    { id: 3, title: 'Next week (draft)', date: '2026-09-27', published: false },
  ] };
stub('../../lib/appApi', {
  getSettings: async () => { api.log.push('get'); if (api.failSettings > 0) { api.failSettings--; throw new Error('The app server timed out. It may be waking up — try again in a moment.'); } return { ...api.settings }; },
  putSettings: async (s) => {
    api.log.push('put:start');
    if (api.slowPut) await new Promise((r) => setTimeout(r, api.slowPut));
    api.puts.push(s); api.settings = { ...s }; api.log.push('put:end'); return s;
  },
  checkAppApiKey: async () => ({ accepted: true }),
  setAppApiAuth: () => {}, hasAppApiAuth: () => false,
  uploadImage: async () => 'https://img.example/site.jpg',
  getPushCount: async () => { if (api.failCount) throw new Error('nope'); return { count: api.count }; },
  // Watch's sermons: the newest published one is Home's big card (a draft dated later isn't)
  getSermons: async () => api.sermons,
  // the app server says what it carried (bethesda-admin pushTarget.js) — one from before that says nothing
  sendNotification: async (p) => {
    if (api.failSend) throw new Error(api.failSend);
    api.sent.push(p);
    return api.oldServer ? { ok: true, sent: api.count } : { ok: true, sent: api.count, data: p.data ? { v: 1, ...p.data } : {} };
  },
});
// the office's shortcut words (Home → Shortcuts): Pray renamed, Bulletin left blank (the app's own)
const tiles = [{ slot: 'prayer', title: 'Prayer wall' }, { slot: 'bulletin', title: '' }];
stub('../../lib/homeTiles', { listTiles: async () => tiles });
const uploads = [];
stub('../../lib/homeCards', { uploadCardImage: async (f) => { uploads.push(f); return { url: 'https://abc.supabase.co/storage/v1/object/public/app-media/home/x.jpg' }; } });

// ── Supabase: app_update_notice and app_page_headers ──
const db = {
  notice: [{ platform: 'ios', active: true, min_build: 16, link: 'itms-beta://', message: null }],
  noticeError: null,
  headers: [{ page: 'home', image_url: 'https://img.example/home.jpg' }, { page: 'groups', image_url: 'https://img.example/groups.jpg' }],
  headerError: null, upsertError: null, upserts: [],
};
stub('./supabase', { supabase: { from: (table) => ({
  select: () => Promise.resolve(table === 'app_update_notice'
    ? (db.noticeError ? { data: null, error: db.noticeError } : { data: db.notice.map((r) => ({ ...r })), error: null })
    : (db.headerError ? { data: null, error: db.headerError } : { data: db.headers.map((r) => ({ ...r })), error: null })),
  upsert: (row, opts) => {
    if (db.upsertError) { const e = db.upsertError; return Promise.resolve({ error: e }); }
    db.upserts.push({ table, row, opts });
    return Promise.resolve({ error: null });
  },
}) } });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
STUBS['../../lib/updateNotice'] = xform(path.join(PILLAR, 'src/lib/updateNotice.js'), 'updateNotice.cjs');
STUBS['../../lib/pageHeaders'] = xform(path.join(PILLAR, 'src/lib/pageHeaders.js'), 'pageHeaders.cjs');
STUBS['../../lib/youtube'] = xform(path.join(PILLAR, 'src/lib/youtube.js'), 'youtube.cjs');
const Settings = require(xform(path.join(PILLAR, 'src/pages/app/SettingsPage.jsx'), 'SettingsPage.cjs'));
// Notifications' second tab, the Update popup (PopupPanel.jsx — its own suite is popup-panel.test.cjs):
// the page reads its tab from the address (?tab=popup)
const query = new URLSearchParams();
stub('react-router-dom', { useSearchParams: () => [query, () => {}] });
STUBS['./SettingsPage'] = path.join(OUT, 'SettingsPage.cjs');
STUBS['../../lib/testPopups'] = xform(path.join(PILLAR, 'src/lib/testPopups.js'), 'testPopups.cjs');
STUBS['./PopupPanel'] = xform(path.join(PILLAR, 'src/pages/app/PopupPanel.jsx'), 'PopupPanel.cjs');
// "When it's tapped, open" (src/lib/pushTargets.js — its own suite is pushtargets.test.mjs): the
// announcements it offers, from the Bulletin (the app server) and Home's cards (Supabase)
const pushAnns = {
  bulletin: [{ id: '1782618176547', title: 'Fall Festival', date: 'Oct 12', published: true }, { id: '9', title: 'Hidden', published: false }],
  cards: [
    { id: 'c1', kind: 'text', title: 'Baptism Sunday', audience: 'everyone', published: true },
    { id: 'c2', kind: 'image', title: 'Members meeting', audience: 'signed_in', published: true },
    { id: 'c3', kind: 'dinner', title: 'Wednesday dinner', audience: 'signed_in', published: true },
  ],
};
stub('./appApi', { getAnnouncements: async () => pushAnns.bulletin });
stub('./homeCards', { listCards: async () => pushAnns.cards, isLive: (c) => !!c.published });
STUBS['../../lib/pushTargets'] = xform(path.join(PILLAR, 'src/lib/pushTargets.js'), 'pushTargets.cjs');
const Notify = require(xform(path.join(PILLAR, 'src/pages/app/NotificationsPage.jsx'), 'NotificationsPage.cjs'));
const UN = require(STUBS['../../lib/updateNotice']);
const { act } = React;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// what the renderer hands a ref: something to focus, click and measure
const focused = []; const clicked = [];
const nodeMock = (el) => ({
  style: {}, scrollHeight: 0, isConnected: true,
  focus: () => { focused.push(el.props.id || el.props.className || el.type); },
  click: () => { clicked.push(el.props.type || el.type); },
  getBoundingClientRect: () => ({ width: 300 }),
});
const render = async (el) => { let r; await act(async () => { r = TR.create(el, { createNodeMock: nodeMock }); }); await act(async () => { await wait(0); }); return r; };
const cls = (n) => String((n.props && n.props.className) || '').split(' ');
const byClass = (root, c) => root.findAll((n) => typeof n.type === 'string' && cls(n).includes(c));
const one = (root, c) => { const all = byClass(root, c); assert.ok(all.length, `.${c} is there`); return all[0]; };
// the elements a host element draws directly (through any components in between)
const hostKids = (inst) => (inst.children || []).flatMap((c) => (typeof c === 'string' ? [] : typeof c.type === 'string' ? [c] : hostKids(c)));
const words = (inst) => (typeof inst === 'string' ? inst : (inst.children || []).map(words).join(''));
const buttonNamed = (root, name) => root.find((n) => n.type === 'button' && words(n).trim() === name);
const key = (k, extra = {}) => {
  const e = { type: 'keydown', key: k, target: { closest: () => null }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  window.dispatchEvent(e);
  return e;
};
const radios = (root) => root.findAll((n) => n.type === 'button' && n.props.role === 'radio');
const picked = (scope) => words(radios(scope).find((b) => b.props['aria-checked'])) || '';
const platform = (root, name) => root.find((n) => n.type === 'section' && cls(n).includes('ax-set-platform') && n.props['aria-label'] === name);
const toggleOf = (scope) => scope.find((n) => n.type === 'input' && n.props.type === 'checkbox');
const input = (scope, id) => scope.find((n) => n.type === 'input' && n.props.id === id);

(async () => {
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

  /* ═══════════════════════════════ Settings ═══════════════════════════════ */
  let r = await render(h(Settings.default));

  // (review fix: Update needed is now a pane per platform — the mockup's one screen had no room for a
  // pane around two boxes — so there are four panes, the first two inside the Update needed group)
  await t('Settings is a grid of panels: Update needed across the top, Page photos beside the folded website and connection', async () => {
    const grid = one(r.root, 'ax-set');
    const panes = byClass(grid, 'ax-set-pane');
    assert.strictEqual(panes.length, 4);
    const update = one(grid, 'ax-set-update');
    assert.strictEqual(update.props['aria-label'], 'Update needed');
    assert.deepStrictEqual(hostKids(update).map((p) => p.props['aria-label']), ['iPhone', 'Android']);
    assert.ok(cls(panes[0]).includes('ax-set-platform') && cls(panes[1]).includes('ax-set-platform'));
    assert.ok(cls(panes[2]).includes('ax-set-photos-pane') && cls(panes[3]).includes('ax-set-more'));
    const folds = r.root.findAll((n) => n.type === 'details');
    assert.deepStrictEqual(folds.map((d) => words(d.find((n) => n.type === 'summary')).replace(/Saved|Saving…/g, '').trim()),
      ['Church website', 'Connection to the app server']);
    assert.deepStrictEqual(folds.map((d) => !!d.props.open), [true, false], 'the website starts open, the connection folded (Hick)');
    assert.ok(byClass(r.root, 'ax-hotkeys').length, 'the ⌘S hint sits in the head');
  });

  await t('Update needed: iPhone and Android side by side, each phone beside its fields, drawn as the app draws the card', async () => {
    const ios = platform(r.root, 'iPhone'); const android = platform(r.root, 'Android');
    for (const p of [ios, android]) {
      const body = one(p, 'ax-set-platform-body');
      const kids = hostKids(body);
      assert.ok(cls(kids[0]).includes('ax-set-platform-fields') && cls(kids[1]).includes('ax-set-phone'), 'fields, then the phone beside them');
      const card = one(p, 'ax-set-upcard');
      assert.ok(cls(card).includes('ax-pa-popup'), 'the app’s centred card');
      assert.strictEqual(words(one(card, 'ax-set-uptitle')), 'Update needed');
      assert.strictEqual(words(one(card, 'ax-set-upbody')), UN.DEFAULT_MESSAGE, 'the app’s own words when the office wrote none');
      const btn = one(card, 'ax-set-upbtn');
      assert.ok(cls(btn).includes('ax-pa-btn') && cls(btn).includes('lg') && cls(btn).includes('block'), 'one large pill across it (btn.lg)');
      assert.strictEqual(words(btn), 'Update the app');
      assert.ok(one(p, 'ax-pa-scrim').props.className.includes('strong'), 'over a 62% scrim');
      assert.ok(byClass(p, 'ax-set-home').length, 'over the app’s Home');
      assert.ok(byClass(p, 'ax-pa-dockbar').length, 'dock and all');
    }
    assert.ok(byClass(android, 'ax-phone-screen')[0].props.className.includes('ax-set-android'), 'the Android phone is drawn as one');
    // the app's source says the same words and the same card
    const card = fs.readFileSync(path.join(APP, 'components/UpdateNeeded.js'), 'utf8');
    assert.match(card, /rgba\(0,0,0,0\.62\)/); assert.match(card, /borderRadius: 24, padding: 24/); assert.match(card, /width: 56, height: 56/);
    assert.match(card, /fontSize: 22/); assert.match(card, /fontSize: 16, lineHeight: 24/); assert.match(card, /\.\.\.btn\.lg/);
  });

  await t('the typed message shows on the card as it’s typed', async () => {
    const ios = platform(r.root, 'iPhone');
    await act(async () => { input(ios, 'ax-set-ios-message').props.onChange({ target: { value: 'Please update — Sunday’s build is out.' } }); });
    assert.strictEqual(words(one(platform(r.root, 'iPhone'), 'ax-set-upbody')), 'Please update — Sunday’s build is out.');
  });

  await t('the newest-APK pill lights up — for an empty link, for a pasted APK link, and when it’s chosen', async () => {
    let android = platform(r.root, 'Android');
    assert.strictEqual(picked(android), 'Newest APK');
    await act(async () => { buttonNamed(android, 'Play Store').props.onClick(); });
    android = platform(r.root, 'Android');
    assert.strictEqual(picked(android), 'Play Store');
    assert.match(input(android, 'ax-set-android-link').props.value, /^https:\/\/play\.google\.com\//);
    await act(async () => { buttonNamed(android, 'Newest APK').props.onClick(); });
    android = platform(r.root, 'Android');
    assert.strictEqual(picked(android), 'Newest APK');
    assert.strictEqual(input(android, 'ax-set-android-link').props.value, '', 'the store link makes way for the APK’s');
    assert.ok(focused.includes('ax-set-android-link'), 'and the cursor waits where it’s pasted');
    await act(async () => { input(android, 'ax-set-android-link').props.onChange({ target: { value: 'https://expo.dev/artifacts/eas/2PKP.apk' } }); });
    assert.strictEqual(picked(platform(r.root, 'Android')), 'Newest APK');
    assert.strictEqual(picked(platform(r.root, 'iPhone')), 'TestFlight');
  });

  await t('the switch can’t read “On” while the card couldn’t be saved on — it says why, right under it', async () => {
    db.upserts.length = 0;
    let android = platform(r.root, 'Android');
    await act(async () => { input(android, 'ax-set-android-link').props.onChange({ target: { value: '' } }); });
    // switching on with no build: refused, and the reason shows
    await act(async () => { toggleOf(platform(r.root, 'Android')).props.onChange({ target: { checked: true } }); });
    android = platform(r.root, 'Android');
    assert.strictEqual(toggleOf(android).props.checked, false, 'it stays Off');
    assert.match(words(one(android, 'ax-set-block')), /which build is the newest/);
    assert.ok(words(one(android, 'ax-toggle-label')).startsWith('Off'));
    assert.ok(words(android).includes('Nobody sees the card.'));
    assert.ok(byClass(android, 'ax-set-flag').length, 'the phone says it isn’t on phones');
    // give it a build: now it's the link that's missing
    await act(async () => { input(android, 'ax-set-android-build').props.onChange({ target: { value: '7a' } }); });
    android = platform(r.root, 'Android');
    assert.strictEqual(input(android, 'ax-set-android-build').props.value, '7', 'digits only');
    assert.match(words(one(android, 'ax-set-block')), /where the button goes/);
    await act(async () => { input(android, 'ax-set-android-link').props.onChange({ target: { value: 'https://expo.dev/artifacts/eas/2PKP.apk' } }); });
    assert.strictEqual(byClass(platform(r.root, 'Android'), 'ax-set-block').length, 0, 'nothing in the way any more');
    await act(async () => { toggleOf(platform(r.root, 'Android')).props.onChange({ target: { checked: true } }); });
    android = platform(r.root, 'Android');
    assert.strictEqual(toggleOf(android).props.checked, true);
    assert.ok(words(one(android, 'ax-toggle-label')).startsWith('On — older versions are asked to update'));
    assert.ok(words(android).includes('Phones on build 6 or older see the card. Build 7 is up to date, so it doesn’t.'));
    // (review fix: a switch saves when it's flipped, not after the typing pause — and the mark follows
    // the database, so it goes once that save has landed)
    await act(async () => { await wait(0); });
    assert.strictEqual(db.upserts.filter((u) => u.table === 'app_update_notice').length, 1, 'saved on the flip');
    assert.strictEqual(byClass(platform(r.root, 'Android'), 'ax-set-flag').length, 0, 'on phones: no mark');
    await act(async () => { await wait(800); });
    const saved = db.upserts.filter((u) => u.table === 'app_update_notice' && u.row.platform === 'android');
    assert.deepStrictEqual(saved[saved.length - 1].row, { platform: 'android', active: true, min_build: 7, link: 'https://expo.dev/artifacts/eas/2PKP.apk', message: null });
    // an edit that blocks saving while it's on: the switch no longer says On
    db.upserts.length = 0;
    await act(async () => { input(platform(r.root, 'Android'), 'ax-set-android-build').props.onChange({ target: { value: '' } }); });
    android = platform(r.root, 'Android');
    assert.strictEqual(toggleOf(android).props.checked, true);
    assert.ok(!words(one(android, 'ax-toggle-label')).startsWith('On'), 'not “On” while it can’t be saved');
    assert.match(words(one(android, 'ax-set-block')), /which build/);
    await act(async () => { await wait(800); });
    assert.strictEqual(db.upserts.filter((u) => u.table === 'app_update_notice').length, 0, 'and nothing half-made is saved');
    await act(async () => { input(platform(r.root, 'Android'), 'ax-set-android-build').props.onChange({ target: { value: '7' } }); });
    await act(async () => { await wait(800); });
  });

  await t('Page photos: each previewed as the top of its page in the app, the app’s own marked where none is chosen', async () => {
    const slots = byClass(r.root, 'ax-set-photo');
    assert.strictEqual(slots.length, 3);
    const [home, dir, groups] = slots;
    assert.match(one(home, 'ax-set-hero').props.style.backgroundImage, /home\.jpg/);
    assert.ok(words(home).includes('Where Every') && words(home).includes('Life Matters'), 'Home’s own headline');
    // (the app renamed GET CONNECTED to FIND A GROUP on 2026-09-23 — the preview says what the app says)
    assert.ok(words(home).includes('Visit') && words(home).includes('Find a Group'), 'and its hero pills');
    assert.match(fs.readFileSync(path.join(APP, 'screens/HomeScreen.js'), 'utf8'), /color: '#fff' \}\]\}>Find a Group<\/Text>/);
    assert.ok(byClass(dir, 'ax-set-ownflag').length, 'Directory has none chosen: the app’s own');
    assert.ok(words(dir).includes('Members') && words(dir).includes('Directory') && words(dir).includes('Search members by name'));
    assert.ok(one(dir, 'ax-pa-photohead').props.className.includes('dir'));
    assert.match(one(groups, 'ax-pa-photohead').props.style.backgroundImage, /groups\.jpg/);
    // (the app's page is "Groups" everywhere since 2026-09-23 — GroupsScreen.js)
    assert.ok(words(groups).includes('Find your people') && words(one(groups, 'ax-pa-title')) === 'Groups');
    assert.match(fs.readFileSync(path.join(APP, 'screens/GroupsScreen.js'), 'utf8'), /accessibilityRole="header">Groups<\/Text>/);
    assert.ok(byClass(r.root, 'ax-set-home').length >= 3, 'Home is under both Update needed cards too');
    assert.match(one(platform(r.root, 'iPhone'), 'ax-set-hero').props.style.backgroundImage, /home\.jpg/, 'with the office’s own Home photo');
  });

  await t('a typed picture address saves when the box is left or Enter is pressed — never letter by letter, and only https://', async () => {
    db.upserts.length = 0;
    let dir = byClass(r.root, 'ax-set-photo')[1];
    await act(async () => { buttonNamed(dir, 'Use a picture that’s already online').props.onClick(); });
    const box = () => byClass(r.root, 'ax-set-photo')[1].find((n) => n.type === 'input' && n.props.inputMode === 'url');
    for (const v of ['h', 'ht', 'http', 'http://img.example/d.jpg']) await act(async () => { box().props.onChange({ target: { value: v } }); });
    assert.strictEqual(db.upserts.length, 0, 'nothing saved while typing');
    await act(async () => { box().props.onBlur(); });
    dir = byClass(r.root, 'ax-set-photo')[1];
    assert.strictEqual(db.upserts.length, 0, 'http:// is refused (the database takes only https)');
    assert.match(words(one(dir, 'bad')), /https:\/\//);
    await act(async () => { box().props.onChange({ target: { value: 'https://img.example/d.jpg' } }); });
    await act(async () => { box().props.onKeyDown({ key: 'Enter', preventDefault() {} }); });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual(db.upserts.map((u) => u.row), [{ page: 'directory', image_url: 'https://img.example/d.jpg' }]);
    const pane = one(r.root, 'ax-set-photos-pane');
    assert.ok(words(pane).includes('Saved — on phones in a moment'), 'the kit’s SaveState, with the old words');
    assert.ok(byClass(pane, 'ax-save').length);
    assert.match(one(byClass(r.root, 'ax-set-photo')[1], 'ax-pa-photohead').props.style.backgroundImage, /d\.jpg/);
  });

  await t('“Use the app’s own” removes a photo at once, with Undo', async () => {
    db.upserts.length = 0;
    await act(async () => { buttonNamed(byClass(r.root, 'ax-set-photo')[0], 'Use the app’s own').props.onClick(); });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual(db.upserts.map((u) => u.row), [{ page: 'home', image_url: null }]);
    const toast = one(r.root, 'ax-toast');
    assert.ok(words(toast).includes('Home photo removed — the app’s own is back.'));
    await act(async () => { buttonNamed(toast, 'Undo').props.onClick(); });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual(db.upserts[1].row, { page: 'home', image_url: 'https://img.example/home.jpg' }, 'Undo puts the same photo back');
    assert.match(one(byClass(r.root, 'ax-set-photo')[0], 'ax-set-hero').props.style.backgroundImage, /home\.jpg/);
  });

  await t('a photo dropped on the phone uploads and saves; a failed save goes back, with Try again', async () => {
    db.upserts.length = 0; uploads.length = 0;
    const drop = one(byClass(r.root, 'ax-set-photo')[2], 'ax-set-drop');
    await act(async () => { drop.props.onDrop({ preventDefault() {}, dataTransfer: { files: [{ type: 'image/jpeg', name: 'g.jpg' }] } }); });
    await act(async () => { await wait(0); });
    assert.strictEqual(uploads.length, 1);
    assert.strictEqual(db.upserts[0].row.page, 'groups');
    assert.match(db.upserts[0].row.image_url, /supabase\.co/);
    await act(async () => { one(byClass(r.root, 'ax-set-photo')[2], 'ax-set-drop').props.onDrop({ preventDefault() {}, dataTransfer: { files: [{ type: 'application/pdf' }] } }); });
    assert.match(words(one(byClass(r.root, 'ax-set-photo')[2], 'bad')), /isn’t a picture/);
    db.upsertError = { message: 'new row violates check constraint' };
    await act(async () => { buttonNamed(byClass(r.root, 'ax-set-photo')[2], 'Use the app’s own').props.onClick(); });
    await act(async () => { await wait(0); });
    const pane = one(r.root, 'ax-set-photos-pane');
    assert.ok(words(pane).includes('Not saved: new row violates check constraint'));
    assert.match(one(byClass(r.root, 'ax-set-photo')[2], 'ax-pa-photohead').props.style.backgroundImage, /supabase\.co/, 'the photo goes back');
    db.upsertError = null;
    await act(async () => { buttonNamed(pane, 'Try again').props.onClick(); });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual(db.upserts[db.upserts.length - 1].row, { page: 'groups', image_url: null });
  });

  await t('⌘S saves what’s waiting at once (the website’s name here), without waiting for the pause', async () => {
    api.puts.length = 0;
    await act(async () => { r.root.find((n) => n.type === 'input' && n.props.id === 'ax-set-church').props.onChange({ target: { value: 'Bethesda Baptist' } }); });
    const e = key('s', { metaKey: true });
    await act(async () => { await wait(0); });
    assert.ok(e.defaultPrevented, 'never the browser’s Save dialog');
    assert.strictEqual(api.puts.length, 1, 'saved on the key, not 700ms later');
    assert.deepStrictEqual(api.puts[0], { ...api.settings, churchName: 'Bethesda Baptist', other: 7 }, 'and everything else goes back untouched');
    await act(async () => { await wait(800); });
    assert.strictEqual(api.puts.length, 1, 'once');
  });

  await t('the connection test saves the website first, then reads and writes the settings straight back', async () => {
    api.puts.length = 0;
    await act(async () => { r.root.find((n) => n.type === 'input' && n.props.id === 'ax-set-tagline').props.onChange({ target: { value: 'Every life matters' } }); });
    await act(async () => { buttonNamed(r.root, 'Test the connection').props.onClick(); });
    await act(async () => { await wait(0); });
    assert.strictEqual(api.puts.length, 2);
    assert.strictEqual(api.puts[0].tagline, 'Every life matters', 'the typed tagline first');
    assert.deepStrictEqual(api.puts[1], api.puts[0], 'then the same settings straight back');
    assert.ok(words(r.root).includes('Working — a test change reached the app server just now.'));
  });

  /* ── review fixes (2026-09-23) ── */

  await t('the phones are the app as it is: signed out with “Sign in”, the newest sermon, the office’s shortcut words', async () => {
    const ios = platform(r.root, 'iPhone');
    // ProfileButton.js signed out: the glass pill with the 16pt user icon and "Sign in" — not the disc
    assert.strictEqual(byClass(ios, 'ax-pa-profile').length, 0, 'no profile disc over a signed-out Home');
    assert.strictEqual(words(one(ios, 'ax-set-signin')), 'Sign in');
    const pb = fs.readFileSync(path.join(APP, 'components/ProfileButton.js'), 'utf8');
    assert.match(pb, /size=\{signedOut \? 16 : 18\}/); assert.match(pb, /Geist_600SemiBold', fontSize: 14/);
    assert.match(pb, /gap: 7, paddingLeft: 13, paddingRight: 15/);
    // the newest published sermon (not the later draft), with its YouTube picture — HomeScreen.js
    // LatestSermonCard shows the sermon's own title and thumbnail
    assert.strictEqual(words(one(ios, 'ax-set-sermon-title')), 'Faith that Works');
    assert.match(one(ios, 'ax-set-sermon-thumb').props.style.backgroundImage, /i\.ytimg\.com\/vi\/bbbbbbbbbbb\/hqdefault\.jpg/);
    // HomeShortcuts.js: own.title || the app's word — Search is fixed
    assert.deepStrictEqual(byClass(ios, 'ax-pa-shortcut-word').map(words), ['Search', 'Prayer wall', 'Groups', 'Bulletin']);
    assert.match(fs.readFileSync(path.join(APP, 'components/HomeShortcuts.js'), 'utf8'), /own\.title \|\| d\.word/);
    // the Home crop in Page photos is the same signed-out Home; the Directory and Groups keep the disc
    const [home, dir, groups] = byClass(r.root, 'ax-set-photo');
    assert.strictEqual(byClass(home, 'ax-pa-profile').length, 0);
    assert.strictEqual(words(one(home, 'ax-set-signin')), 'Sign in');
    assert.strictEqual(byClass(dir, 'ax-pa-profile').length, 1);
    assert.strictEqual(byClass(groups, 'ax-pa-profile').length, 1);
  });

  await t('with no sermon, the card has the app’s own words; with no words from the office, the app’s own', async () => {
    const keep = api.sermons; const keepTiles = tiles.splice(0);
    api.sermons = [];
    const r2 = await render(h(Settings.default));
    const ios = platform(r2.root, 'iPhone');
    assert.strictEqual(words(one(ios, 'ax-set-sermon-title')), 'This Week’s Message'.replace('’', "'"));
    assert.strictEqual(one(ios, 'ax-set-sermon-thumb').props.style, undefined, 'no picture: the dark the app shows while one loads');
    assert.deepStrictEqual(byClass(ios, 'ax-pa-shortcut-word').map(words), ['Search', 'Pray', 'Groups', 'Bulletin']);
    await act(async () => { r2.unmount(); });
    api.sermons = keep; tiles.push(...keepTiles);
  });

  await t('the Android phone has Android’s status bar, and the headline sits where HomeScreen puts it under one', async () => {
    const android = platform(r.root, 'Android');
    assert.ok(cls(byClass(android, 'ax-phone-screen')[0]).includes('ax-set-android'));
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/settings.css'), 'utf8');
    assert.match(css, /\.ax-set-android \.ax-pa-time \{ justify-self: start;/, 'the time at the far left');
    assert.match(css, /\.ax-set-android \.ax-pa-status \{[^}]*height: 24px;[^}]*Roboto/, 'a 24dp status bar, in Roboto');
    // HomeScreen.js centres the headline between the profile row (insets.top + 6 + 44) and the card
    const home = fs.readFileSync(path.join(APP, 'screens/HomeScreen.js'), 'utf8');
    const num = (re) => Number(re.exec(home)[1]);
    const gap = num(/HERO_BTN_GAP = (\d+)/); const bh = num(/HERO_BTN_H\s+= (\d+)/); const bgap = num(/HERO_BTNS_GAP = (\d+)/);
    const pbTop = Number(/PROFILE_BTN_TOP\s+= (\d+)/.exec(fs.readFileSync(path.join(APP, 'components/ProfileButton.js'), 'utf8'))[1]);
    const cardTop = 393 / (2 / 3) + 128 - (16 + 8 + (393 - 40) * 9 / 16);
    const at = (top) => { const row = top + pbTop + 44; const head = row + Math.max(20, (cardTop - row - (58 + 52 + gap + bh * 2 + bgap)) / 2); return [head, head + 58 + 52 + gap]; };
    const [iHead, iBtn] = at(59); const [aHead, aBtn] = at(24);
    const px = (sel) => Number(new RegExp(`^${sel.replace(/\./g, '\\.')} \\{[^}]*top: ([\\d.]+)px`, 'm').exec(css)[1]);
    assert.ok(Math.abs(px('.ax-set-headline') - iHead) < 0.01 && Math.abs(px('.ax-set-herobtns') - iBtn) < 0.01, 'iPhone: 176.97 / 312.97');
    assert.ok(Math.abs(px('.ax-set-android .ax-set-headline') - aHead) < 0.01 && Math.abs(px('.ax-set-android .ax-set-herobtns') - aBtn) < 0.01, 'Android: 159.47 / 295.47');
    assert.ok(Math.abs(px('.ax-set-android .ax-set-signin') - (24 + pbTop)) < 0.01, 'Sign in 6 under the status bar');
  });

  await t('each page’s top ends just past what sits under its photo — Groups’ at its search bar, no empty page under it', async () => {
    const frames = byClass(r.root, 'ax-set-photo').map((slot) => one(slot, 'ax-phone-frame'));
    assert.deepStrictEqual(frames.map((f) => f.props.style['--ax-phone-h']), ['378px', '378px', '276px']);
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/settings.css'), 'utf8');
    const num = (src, re, what) => { const m = re.exec(src); assert.ok(m, what); return Number(m[1]); };
    // Groups (GroupsScreen.js): the short photo, the search 16 under it
    const groups = fs.readFileSync(path.join(APP, 'screens/GroupsScreen.js'), 'utf8');
    const photoH = num(groups, /const PHOTO_H = (\d+)/, 'Groups’ photo height');
    const gTop = num(groups, /searchBlock: \{ paddingHorizontal: PAD, marginTop: (\d+) \}/, 'its search’s gap');
    const searchH = num(groups, /\n  search: \{\s*flexDirection: 'row', alignItems: 'center', gap: 12, height: (\d+)/, 'its search’s height');
    const gEnd = 59 + photoH + gTop + searchH;
    assert.ok(gEnd <= 276 && 276 - gEnd < 6, `Groups ends just under its search (${gEnd})`);
    // (integration, 2026-09-23: the shared header and search in phone.css are the app's short ones now —
    // the Groups phone on the Groups page uses them too — so the crops no longer override them; the
    // check is the same, on the rules that draw them)
    const phoneCss = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/phone.css'), 'utf8');
    assert.ok(new RegExp(`\\.ax-pa-photohead \\{[^}]*height: ${59 + photoH}px;`).test(phoneCss), 'the header as tall as the app’s');
    assert.ok(new RegExp(`\\.ax-pa-search \\{[^}]*height: ${searchH}px; padding: 0 18px;`).test(phoneCss), 'the search as tall as the app’s');
    assert.ok(!/\.ax-set-crop \.ax-pa-(photohead|search)/.test(css), 'and the crops add nothing of their own');
    assert.ok(css.includes(`.ax-set-gr-search { margin-top: ${gTop}px; }`));
    // the Directory (DirectoryScreen.js): lead, search, then its pills
    const dir = fs.readFileSync(path.join(APP, 'screens/DirectoryScreen.js'), 'utf8');
    assert.strictEqual(num(dir, /const PHOTO_H = (\d+)/, 'the Directory’s photo'), photoH, 'the same header as Groups');
    const dSearch = num(dir, /search: \{\s*flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, paddingHorizontal: 18, marginTop: (\d+)/, 'the Directory search');
    const pillsTop = num(dir, /pills: \{ flexDirection: 'row', gap: 8, paddingHorizontal: PAD, paddingTop: (\d+) \}/, 'its pills');
    const dEnd = 59 + photoH + 18 + 26 + dSearch + 48 + pillsTop + 40;
    assert.ok(dEnd <= 378 && 378 - dEnd < 6, `the Directory ends just under its pills (${dEnd})`);
    assert.ok(css.includes(`.ax-set-dir-search { margin-top: ${dSearch}px;`));
    assert.deepStrictEqual(byClass(r.root, 'ax-set-dir-pill').map(words), ['Everyone', 'A–Z', 'Shares contact']);
    // Home: Visit (btn.lg, 56) whole, Find a Group (16 under it) not begun
    assert.ok(312.97 + 56 <= 378 && 312.97 + 56 + 16 > 378);
  });

  await t('with no photo chosen, Groups shows the app’s own — the very file — and each page says it’s the app’s own', async () => {
    // (review: the app shows its bundled photo when the office chose none; Groups' is in Pillar)
    const slots = byClass(r.root, 'ax-set-photo');
    for (const slot of slots) {
      const pic = slot.find((n) => typeof n.type === 'string' && (cls(n).includes('ax-set-hero') || cls(n).includes('ax-pa-photohead')));
      const chosen = !!(pic.props.style && pic.props.style.backgroundImage);
      assert.strictEqual(byClass(slot, 'ax-set-ownflag').length > 0, !chosen, 'the mark only where none is chosen');
    }
    const g = slots[2];   // Groups: its photo was taken away (and not undone) two checks back
    assert.strictEqual(one(g, 'ax-pa-photohead').props.style, undefined);
    assert.ok(cls(one(g, 'ax-pa-photohead')).includes('ax-set-own-groups'));
    assert.strictEqual(words(one(g, 'ax-set-ownflag')), 'App’s own');
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/settings.css'), 'utf8');
    assert.match(css, /\.ax-pa-photohead\.ax-set-own-groups \{ background-image: url\('\.\/img\/community\.jpg'\); \}/);
    assert.ok(fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/img/community.jpg')).equals(fs.readFileSync(path.join(APP, 'assets/home/community.jpg'))), 'the app’s own file');
    assert.match(fs.readFileSync(path.join(APP, 'screens/GroupsScreen.js'), 'utf8'), /const PHOTO = require\('\.\.\/assets\/home\/community\.jpg'\)/);
    assert.ok(!cls(one(slots[1], 'ax-pa-photohead')).includes('ax-set-own-groups'), 'Groups’ file is Groups’ alone');
    // (integration, 2026-09-23: the app's other two bundled photos are in Pillar now too — the
    // Directory's welcome.jpg and Home's mainhero.jpg, which is also the sermon card's stand-in — so a
    // page with no photo chosen shows the app's own, not a dark stand-in)
    const own = (slot) => slot.find((n) => typeof n.type === 'string' && (cls(n).includes('ax-set-hero') || cls(n).includes('ax-pa-photohead')));
    for (const slot of slots) {
      const pic = own(slot);
      const chosen = !!(pic.props.style && pic.props.style.backgroundImage);
      assert.strictEqual(/ax-set-own-(hero|dir|groups)/.test(cls(pic)), !chosen, `${cls(pic)}: the app’s own photo only where none is chosen`);
    }
    assert.match(css, /\.ax-pa-photohead\.ax-set-own-dir \{ background-image: url\('\.\/img\/welcome\.jpg'\); \}/);
    assert.match(css, /\.ax-set-hero\.ax-set-own-hero, \.ax-set-sermon-thumb\.ax-set-own-hero \{ background-image: url\('\.\/img\/mainhero\.jpg'\); \}/);
    for (const [mine, theirs] of [['welcome.jpg', 'assets/home/welcome.jpg'], ['mainhero.jpg', 'assets/mainhero.jpg']]) {
      assert.ok(fs.readFileSync(path.join(PILLAR, `src/pages/app/css/img/${mine}`)).equals(fs.readFileSync(path.join(APP, theirs))), `${mine} is the app’s own file`);
    }
    assert.match(fs.readFileSync(path.join(APP, 'screens/DirectoryScreen.js'), 'utf8'), /const PHOTO = require\('\.\.\/assets\/home\/welcome\.jpg'\)/);
    assert.match(fs.readFileSync(path.join(APP, 'screens/HomeScreen.js'), 'utf8'), /const thumb = isHttp\(url\) \? \{ uri: url \} : PHOTO;/, 'the sermon card falls back to the church photo');
  });

  await t('the long newest-build advice shows while that box is in use — and screen readers always have it', async () => {
    const ios = () => platform(r.root, 'iPhone');
    const hint = () => one(ios(), 'ax-set-buildhint');
    const build = () => input(ios(), 'ax-set-ios-build');
    assert.ok(!cls(hint()).includes('open'));
    assert.strictEqual(words(hint()), UN.PLATFORMS[0].buildHint);
    assert.strictEqual(build().props['aria-describedby'], hint().props.id);
    await act(async () => { build().props.onFocus(); });
    assert.ok(cls(hint()).includes('open'));
    await act(async () => { build().props.onBlur(); });
    assert.ok(!cls(hint()).includes('open'));
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/settings.css'), 'utf8');
    assert.match(css, /\.ax-set-buildhint:not\(\.open\) \{ display: none; \}/);
  });

  await t('Off always takes effect: switched off while an edit blocks saving, phones stop seeing the card at once', async () => {
    await act(async () => { await wait(800); });
    db.upserts.length = 0;
    const ios = () => platform(r.root, 'iPhone');
    assert.strictEqual(toggleOf(ios()).props.checked, true);
    await act(async () => { input(ios(), 'ax-set-ios-link').props.onChange({ target: { value: 'htp://oops' } }); });
    await act(async () => { await wait(800); });
    assert.strictEqual(db.upserts.length, 0, 'the mistyped link isn’t saved');
    await act(async () => { toggleOf(ios()).props.onChange({ target: { checked: false } }); });
    await act(async () => { await wait(0); });
    assert.strictEqual(db.upserts.length, 1, 'switched off on the spot');
    const row = db.upserts[0].row;
    assert.deepStrictEqual({ platform: row.platform, active: row.active, link: row.link, min_build: row.min_build },
      { platform: 'ios', active: false, link: 'itms-beta://', min_build: 16 }, 'the row phones had, switched off — not the typo');
    assert.strictEqual(words(one(ios(), 'ax-toggle-label')).replace('Nobody sees the card.', ''), 'Off');
    assert.ok(words(ios()).includes('Nobody sees the card.'));
    assert.ok(byClass(ios(), 'ax-set-flag').length, 'the phone says it isn’t on phones');
    assert.strictEqual(input(ios(), 'ax-set-ios-link').props.value, 'htp://oops', 'the typed edit is kept');
    assert.match(words(one(ios(), 'ax-set-head')), /Not saved yet/, 'and still waits to be saved');
    // fixed, it saves — still off
    await act(async () => { input(ios(), 'ax-set-ios-link').props.onChange({ target: { value: `itms-apps://apps.apple.com/app/id${UN.APP_STORE_ID}` } }); });
    await act(async () => { await wait(800); });
    assert.deepStrictEqual([db.upserts[1].row.active, db.upserts[1].row.link], [false, `itms-apps://apps.apple.com/app/id${UN.APP_STORE_ID}`]);
    // back as it was, for what follows: TestFlight, on — saved when flipped
    await act(async () => { buttonNamed(ios(), 'TestFlight').props.onClick(); });
    await act(async () => { toggleOf(ios()).props.onChange({ target: { checked: true } }); });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual([db.upserts[db.upserts.length - 1].row.active, db.upserts[db.upserts.length - 1].row.link], [true, 'itms-beta://']);
    assert.strictEqual(byClass(ios(), 'ax-set-flag').length, 0);
  });

  await t('an Off that doesn’t reach the database says so — phones still see the card — with Try again', async () => {
    await act(async () => { await wait(800); });
    db.upserts.length = 0;
    const ios = () => platform(r.root, 'iPhone');
    await act(async () => { input(ios(), 'ax-set-ios-link').props.onChange({ target: { value: 'htp://oops' } }); });
    db.upsertError = { message: 'network down' };
    await act(async () => { toggleOf(ios()).props.onChange({ target: { checked: false } }); });
    await act(async () => { await wait(0); });
    assert.ok(words(ios()).includes('Not switched off on phones: network down'));
    assert.ok(words(one(ios(), 'ax-toggle-label')).startsWith('Off — not saved yet'));
    assert.ok(words(ios()).includes('Phones still see the card until this saves.'), 'not “Nobody sees the card.”');
    assert.strictEqual(byClass(ios(), 'ax-set-flag').length, 0, 'no “Not on phones” mark: it still is');
    assert.ok(guarded() >= 1, 'and leaving asks first');
    db.upsertError = null;
    const retry = ios().find((n) => n.type === 'button' && cls(n).includes('ax-set-retry'));
    await act(async () => { retry.props.onClick(); });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual([db.upserts[0].row.active, db.upserts[0].row.link], [false, 'itms-beta://']);
    assert.ok(!words(ios()).includes('Not switched off'));
    assert.ok(byClass(ios(), 'ax-set-flag').length);
    // put it back
    await act(async () => { input(ios(), 'ax-set-ios-link').props.onChange({ target: { value: 'itms-beta://' } }); });
    await act(async () => { toggleOf(ios()).props.onChange({ target: { checked: true } }); });
    await act(async () => { await wait(0); });
    assert.strictEqual(db.upserts[db.upserts.length - 1].row.active, true);
  });

  await t('the connection test can’t cross a website save that’s still on its way', async () => {
    await act(async () => { await wait(800); });
    api.slowPut = 30; api.log.length = 0; api.puts.length = 0;
    await act(async () => { r.root.find((n) => n.type === 'input' && n.props.id === 'ax-set-tagline').props.onChange({ target: { value: 'Every life matters here' } }); });
    await act(async () => {
      key('s', { metaKey: true });                                  // the website's save sets off (30ms)…
      await wait(0);
      buttonNamed(r.root, 'Test the connection').props.onClick();   // …and the test is asked for meanwhile
    });
    await act(async () => { await wait(120); });
    assert.deepStrictEqual(api.log.slice(0, 5), ['put:start', 'put:end', 'get', 'put:start', 'put:end'], 'the test reads only after the save has landed');
    // (the kit may save the same form once more after a save that was asked for mid-flight — same words)
    assert.ok(api.puts.length >= 2 && api.puts.every((p) => p.tagline === 'Every life matters here'), 'every write carries the new tagline');
    assert.strictEqual(api.settings.tagline, 'Every life matters here', 'so nothing writes back the old one');
    api.slowPut = 0;
  });

  await t('a photo address: Escape puts it away unsaved, Enter saves once, and leaving it empty or unchanged just closes it', async () => {
    const dir = () => byClass(r.root, 'ax-set-photo')[1];
    const box = () => dir().find((n) => n.type === 'input' && n.props.inputMode === 'url');
    const hasBox = () => dir().findAll((n) => n.type === 'input' && n.props.inputMode === 'url').length > 0;
    db.upserts.length = 0;
    // Escape, then the blur the browser sends as the box goes (to the handler of the render before)
    await act(async () => { buttonNamed(dir(), 'Use a picture that’s already online').props.onClick(); });
    await act(async () => { box().props.onChange({ target: { value: 'https://img.example/esc.jpg' } }); });
    let late = box().props.onBlur;
    await act(async () => { box().props.onKeyDown({ key: 'Escape', preventDefault() {} }); });
    assert.ok(!hasBox());
    await act(async () => { late(); });
    await act(async () => { await wait(0); });
    assert.strictEqual(db.upserts.length, 0, 'what Escape put away is never saved');
    // Enter, then that same late blur: one save
    await act(async () => { buttonNamed(dir(), 'Use a picture that’s already online').props.onClick(); });
    await act(async () => { box().props.onChange({ target: { value: 'https://img.example/enter.jpg' } }); });
    late = box().props.onBlur;
    await act(async () => { box().props.onKeyDown({ key: 'Enter', preventDefault() {} }); });
    await act(async () => { late(); });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual(db.upserts.map((u) => u.row), [{ page: 'directory', image_url: 'https://img.example/enter.jpg' }], 'saved once');
    // unchanged (the box opens with the address in it), then emptied: each just closes
    await act(async () => { buttonNamed(dir(), 'Use a picture that’s already online').props.onClick(); });
    assert.strictEqual(box().props.value, 'https://img.example/enter.jpg');
    await act(async () => { box().props.onBlur(); });
    assert.ok(!hasBox(), 'left unchanged: put away');
    await act(async () => { buttonNamed(dir(), 'Use a picture that’s already online').props.onClick(); });
    await act(async () => { box().props.onChange({ target: { value: '  ' } }); });
    await act(async () => { box().props.onBlur(); });
    assert.ok(!hasBox(), 'left empty: put away');
    assert.strictEqual(db.upserts.length, 1);
  });

  await t('the website picture: one row — drop or choose, its address, and Remove with Undo', async () => {
    api.puts.length = 0;
    const web = () => r.root.findAll((n) => n.type === 'details')[0];
    const row = () => one(web(), 'ax-set-webpic');
    await act(async () => { row().props.onDrop({ preventDefault() {}, dataTransfer: { files: [{ type: 'image/png', name: 'site.png' }] } }); });
    await act(async () => { await wait(800); });
    assert.strictEqual(api.puts[api.puts.length - 1].heroImageUrl, 'https://img.example/site.jpg', 'uploaded to the app server and saved');
    assert.match(one(web(), 'ax-set-webthumb').props.style.backgroundImage, /site\.jpg/);
    await act(async () => { buttonNamed(web(), 'Use a picture that’s already online').props.onClick(); });
    const address = web().find((n) => n.type === 'input' && n.props['aria-label'] === 'Picture address');
    assert.strictEqual(address.props.value, 'https://img.example/site.jpg');
    await act(async () => { buttonNamed(web(), 'Remove').props.onClick(); });
    await act(async () => { await wait(800); });
    assert.strictEqual(api.puts[api.puts.length - 1].heroImageUrl, '');
    const toast = one(r.root, 'ax-toast');
    assert.ok(words(toast).includes('Website picture removed.'));
    await act(async () => { buttonNamed(toast, 'Undo').props.onClick(); });
    await act(async () => { await wait(800); });
    assert.strictEqual(api.puts[api.puts.length - 1].heroImageUrl, 'https://img.example/site.jpg', 'Undo puts it back');
    await act(async () => { one(web(), 'ax-set-webpic').props.onDrop({ preventDefault() {}, dataTransfer: { files: [{ type: 'text/plain' }] } }); });
    assert.match(words(one(web(), 'bad')), /isn’t a picture/);
  });

  await act(async () => { r.unmount(); });

  await t('loads that fail say so and offer to try again — Update needed no longer says “run the SQL” for them', async () => {
    db.noticeError = { code: '500', message: 'JWT expired' };
    api.failSettings = 1;
    db.headerError = { code: '500', message: 'The page photos didn’t load' };
    r = await render(h(Settings.default));
    const upd = one(r.root, 'ax-set-update');
    assert.ok(words(upd).includes('JWT expired'));
    assert.ok(!words(upd).includes('app-update-notice.sql'), 'not the misleading setup message');
    const web = r.root.findAll((n) => n.type === 'details')[0];
    assert.ok(words(web).includes('It may be waking up'));
    assert.ok(words(one(r.root, 'ax-set-photos-pane')).includes('The page photos didn’t load'));
    db.noticeError = null; db.headerError = null;
    await act(async () => { buttonNamed(upd, 'Try again').props.onClick(); });
    await act(async () => { buttonNamed(web, 'Try again').props.onClick(); });
    await act(async () => { buttonNamed(one(r.root, 'ax-set-photos-pane'), 'Try again').props.onClick(); });
    await act(async () => { await wait(0); });
    assert.strictEqual(byClass(r.root, 'ax-set-platform').length, 2, 'Update needed is back');
    assert.ok(r.root.find((n) => n.type === 'input' && n.props.id === 'ax-set-church'), 'the website’s fields are back');
    assert.strictEqual(byClass(r.root, 'ax-set-photo').length, 3);
    await act(async () => { r.unmount(); });
    // a table that isn't there yet still says how to set it up
    db.noticeError = { code: '42P01', message: 'relation "app_update_notice" does not exist' };
    r = await render(h(Settings.default));
    assert.ok(words(one(r.root, 'ax-set-update')).includes('Run supabase/app-update-notice.sql'));
    await act(async () => { r.unmount(); });
    db.noticeError = null;
  });

  await t('only a missing table asks for the SQL — an error that merely names the table offers Try again (a 44px target)', async () => {
    db.noticeError = { code: '42501', message: 'permission denied for table app_update_notice' };
    db.headerError = { code: '42501', message: 'permission denied for table app_page_headers' };
    r = await render(h(Settings.default));
    const upd = one(r.root, 'ax-set-update');
    assert.ok(words(upd).includes('permission denied for table app_update_notice'));
    assert.ok(!words(upd).includes('app-update-notice.sql'));
    const photosPane = one(r.root, 'ax-set-photos-pane');
    assert.ok(words(photosPane).includes('permission denied for table app_page_headers'));
    assert.ok(!words(photosPane).includes('app-page-headers.sql'));
    const retries = r.root.findAll((n) => n.type === 'button' && cls(n).includes('ax-set-retry'));
    assert.ok(retries.length >= 2 && retries.every((b) => words(b) === 'Try again'));
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/settings.css'), 'utf8');
    assert.match(css, /\.ax-alert \.ax-set-retry \{[^}]*min-height: 44px/);
    await act(async () => { r.unmount(); });
    // PostgREST's "not in the schema cache" is a missing table
    db.noticeError = { code: 'PGRST205', message: "Could not find the table 'public.app_update_notice' in the schema cache" };
    db.headerError = { code: 'PGRST205', message: "Could not find the table 'public.app_page_headers' in the schema cache" };
    r = await render(h(Settings.default));
    assert.ok(words(one(r.root, 'ax-set-update')).includes('Run supabase/app-update-notice.sql'));
    assert.ok(words(one(r.root, 'ax-set-photos-pane')).includes('Run supabase/app-page-headers.sql'));
    await act(async () => { r.unmount(); });
    db.noticeError = null; db.headerError = null;
    assert.strictEqual(UN.tableMissing({ code: '42P01', message: 'relation "app_update_notice" does not exist' }), true);
    assert.strictEqual(UN.tableMissing({ code: '42501', message: 'permission denied for table app_update_notice' }), false);
    assert.strictEqual(UN.tableMissing(null), false);
  });

  await t('⌘/Ctrl+S never opens the browser’s Save dialog on Notifications either: AppShell takes it on every App page', async () => {
    // (review: the Notifications page has no ⌘S of its own — it doesn't need one; its draft is already
    // kept. AppShell's map swallows the key for every App page; layout.test proves it on a live key.)
    const shell = fs.readFileSync(path.join(PILLAR, 'src/pages/app/AppShell.jsx'), 'utf8');
    assert.match(shell, /useHotkeys\(\{ '\[': flip, 'mod\+s': \(\) => \{\} \}\)/);
    const nsrc = fs.readFileSync(path.join(PILLAR, 'src/pages/app/NotificationsPage.jsx'), 'utf8');
    assert.match(nsrc, /<AppShell title="Notifications"/);
  });

  await t('Settings keeps the words the app and the tests pin, and no fixed inline styles', async () => {
    const src = fs.readFileSync(path.join(PILLAR, 'src/pages/app/SettingsPage.jsx'), 'utf8');
    assert.ok(src.includes('<UpdateNeeded />'));
    // (review fix: while an Off hasn't reached the database yet the line says phones still see it; the
    // pinned On and Off words are unchanged)
    assert.match(src, /sub=\{offLate \? 'Phones still see the card until this saves\.' : f\.active \? whoSees\(f\.min_build\) : 'Nobody sees the card\.'\}/);
    assert.ok(!/style=\{\{/.test(src), 'no style={{…}} — only a picture’s url, through pictureOf');
    const nsrc = fs.readFileSync(path.join(PILLAR, 'src/pages/app/NotificationsPage.jsx'), 'utf8');
    assert.ok(!/style=\{\{|style=\{/.test(nsrc), 'Notifications has no inline styles at all');
    for (const f of ['settings.css', 'notifications.css', 'popup.css']) {
      const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!/!important/.test(css), `${f}: never !important`);
      const selectors = css.split('}').map((b) => b.split('{')[0].trim()).filter((s) => s && !s.startsWith('@'));
      // every rule hangs off an ax- class (a state like .on or .over rides on one, as in base.css)
      for (const s of selectors) for (const part of s.split(',')) {
        const compounds = part.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
        assert.ok(/^\.ax-/.test(compounds[0]), `${f}: “${part.trim()}” starts from an ax- class`);
        for (const c of compounds) {
          const classes = c.match(/\.[\w-]+/g) || [];
          assert.ok(!classes.length || classes.some((x) => x.startsWith('.ax-')), `${f}: “${c}” in “${part.trim()}” rides on an ax- class`);
        }
      }
    }
  });

  /* ═══════════════════════════════ Notifications ═══════════════════════════════ */
  session.clear();
  r = await render(h(Notify.default));

  await t('Notifications: the form and the locked phone side by side — a workspace with no drawer', async () => {
    const work = one(r.root, 'ax-work');
    assert.ok(!cls(work).includes('has-preview'), 'no drawer: the phone keeps its column down to 760');
    assert.ok(cls(work).includes('ax-nt'), 'the Notification tab, when the address names none');
    const panes = hostKids(work).filter((c) => cls(c).includes('ax-pane'));
    assert.ok(cls(panes[0]).includes('ax-editor-pane') && cls(panes[1]).includes('ax-preview-pane'));
    assert.strictEqual(r.root.findByProps({ className: 'shell' }).props['data-sub'], 'A message to 214 phones, straight to the lock screen.');
    const title = r.root.find((n) => n.type === 'input' && n.props.id === 'ax-nt-title');
    assert.strictEqual(title.props.maxLength, 80);
    assert.strictEqual(r.root.find((n) => n.type === 'textarea').props.maxLength, 300);
  });

  await t('the lock screen shows the real day and time, and the app’s own icon', async () => {
    const now = new Date();
    assert.strictEqual(words(one(r.root, 'ax-nt-date')), Notify.lockDate(now));
    assert.strictEqual(words(one(r.root, 'ax-nt-clock')), Notify.lockTime(now));
    assert.strictEqual(Notify.lockDate(new Date(2026, 8, 23, 21, 5)), 'Wednesday, September 23');
    assert.strictEqual(Notify.lockTime(new Date(2026, 8, 23, 21, 5)), '9:05');
    assert.strictEqual(Notify.lockTime(new Date(2026, 8, 23, 0, 0)), '12:00');
    const icon = one(r.root, 'ax-nt-icon');
    const rects = icon.findAll((n) => n.type === 'rect').map((n) => n.props);
    assert.strictEqual(rects[0].fill, '#F1742E', 'the orange square');
    // the white cross at the loading logo's own place (BethesdaApp assets/applogosvg.svg)
    const svg = fs.readFileSync(path.join(APP, 'assets/applogosvg.svg'), 'utf8');
    assert.ok(svg.includes('M 81.46875 26.125 L 101.335938 26.125') && svg.includes('M 55.074219 54.796875'));
    assert.deepStrictEqual(rects.slice(1).map((p) => [p.x, p.y, p.fill]), [['81.46875', '26.125', '#FFFFFF'], ['55.101562', '54.796875', '#FFFFFF']]);
    assert.ok(words(r.root).includes(`“${Notify.APP_NAME}”`), 'and the name iPhones give it');
    assert.match(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'), new RegExp(`"name": "${Notify.APP_NAME}"`));
    const lock = r.root.find((n) => typeof n.type === 'string' && cls(n).includes('ax-phone-screen'));
    assert.ok(cls(lock).includes('ax-nt-lock'));
  });

  await t('what’s typed shows on the lock screen as it’s typed, with the counters', async () => {
    await act(async () => { r.root.find((n) => n.type === 'input' && n.props.id === 'ax-nt-title').props.onChange({ target: { value: 'Hello' } }); });
    assert.strictEqual(words(one(r.root, 'ax-nt-push-title')), 'Hello');
    assert.strictEqual(words(one(r.root, 'ax-nt-push-body')), 'Your message shows here.');
    assert.ok(words(r.root).includes('5/80'));
    assert.ok(words(r.root).includes('Write the message too.'), 'a Send that can’t go says why');
    await act(async () => { r.root.find((n) => n.type === 'textarea').props.onChange({ target: { value: 'Service starts at 10.' } }); });
    assert.strictEqual(words(one(r.root, 'ax-nt-push-body')), 'Service starts at 10.');
    assert.ok(words(r.root).includes('21/300'));
  });

  await t('the draft is kept while they’re elsewhere in Pillar, and closing the tab with one typed asks first', async () => {
    assert.ok(guarded() >= 1, 'a beforeunload guard while a message is typed');
    assert.deepStrictEqual(JSON.parse(session.get('pillar.app.notify.draft')), { title: 'Hello', body: 'Service starts at 10.', opens: { kind: 'app', page: 'Home', ann: '' } });
    await act(async () => { r.unmount(); });
    assert.strictEqual(guarded(), 0);
    r = await render(h(Notify.default));
    assert.strictEqual(r.root.find((n) => n.type === 'input' && n.props.id === 'ax-nt-title').props.value, 'Hello', 'back where they left it');
    assert.strictEqual(r.root.find((n) => n.type === 'textarea').props.value, 'Service starts at 10.');
  });

  await t('⌘/Ctrl+Enter sends — from inside a box — and still asks first, in the same words', async () => {
    asked.length = 0; api.sent.length = 0;
    answers.push(false);
    const e = key('Enter', { metaKey: true, target: { closest: (s) => (s.includes('textarea') ? {} : null) } });
    await act(async () => { await wait(0); });
    assert.ok(e.defaultPrevented);
    assert.deepStrictEqual(asked, ['Send “Hello” to 214 phones now? It can’t be taken back.']);
    assert.strictEqual(api.sent.length, 0, 'No sends nothing');
    answers.push(true);
    key('Enter', { ctrlKey: true });
    await act(async () => { await wait(0); });
    assert.deepStrictEqual(api.sent, [{ title: 'Hello', body: 'Service starts at 10.' }]);
    assert.ok(words(one(r.root, 'ax-note')).includes('Sent to 214 phones.'));
    assert.strictEqual(r.root.find((n) => n.type === 'input' && n.props.id === 'ax-nt-title').props.value, '', 'the form is clear for the next');
    assert.ok(!session.has('pillar.app.notify.draft'), 'and so is the kept draft');
    assert.strictEqual(guarded(), 0, 'nothing typed, nothing to guard');
    key('Enter', { metaKey: true });
    await act(async () => { await wait(0); });
    assert.strictEqual(asked.length, 2, 'an empty form asks nothing and sends nothing');
    await act(async () => { buttonNamed(r.root, 'Write another').props.onClick(); });
    assert.strictEqual(byClass(r.root, 'ax-note').length, 0);
    assert.ok(focused.includes('ax-nt-title'), 'Write another puts the cursor in the title');
  });

  await t('a failed send says why, and Escape puts it away', async () => {
    api.failSend = 'The app server timed out.';
    await act(async () => { r.root.find((n) => n.type === 'input' && n.props.id === 'ax-nt-title').props.onChange({ target: { value: 'Snow day' } }); });
    await act(async () => { r.root.find((n) => n.type === 'textarea').props.onChange({ target: { value: 'No service today.' } }); });
    await act(async () => { buttonNamed(r.root, 'Send now').props.onClick(); });
    await act(async () => { await wait(0); });
    assert.ok(words(one(r.root, 'ax-alert')).includes('The app server timed out.'));
    assert.strictEqual(r.root.find((n) => n.type === 'input' && n.props.id === 'ax-nt-title').props.value, 'Snow day', 'nothing typed is lost');
    key('Escape');
    await act(async () => { await wait(0); });
    assert.strictEqual(byClass(r.root, 'ax-alert').length, 0);
    api.failSend = '';
    await act(async () => { r.unmount(); });
  });

  const tapGroup = () => r.root.find((n) => n.type === 'div' && n.props.role === 'radiogroup' && n.props['aria-label'] === 'When it’s tapped, open');
  const opensList = () => r.root.findAll((n) => n.type === 'select' && n.props.id === 'ax-nt-opens')[0];
  const typeMessage = async (title, body) => {
    await act(async () => { input(r.root, 'ax-nt-title').props.onChange({ target: { value: title } }); });
    await act(async () => { r.root.find((n) => n.type === 'textarea').props.onChange({ target: { value: body } }); });
  };
  const sendIt = async () => {
    await act(async () => { buttonNamed(r.root, 'Send now').props.onClick(); });
    await act(async () => { await wait(0); });
  };

  await t('When it’s tapped: the app by default — three choices under the words, and a list only once one is needed', async () => {
    session.clear();
    r = await render(h(Notify.default));
    assert.deepStrictEqual(radios(tapGroup()).map(words), ['The app', 'A page', 'An announcement']);
    assert.strictEqual(picked(tapGroup()), 'The app');
    assert.ok(words(r.root).includes('Tapping it opens the app where they left it.'));
    assert.strictEqual(opensList(), undefined, 'no list to read until a choice needs one (Hick)');
  });

  await t('A page: the nine pages; the “are you sure” and the notification both say where it goes', async () => {
    await act(async () => { buttonNamed(tapGroup(), 'A page').props.onClick(); });
    assert.deepStrictEqual(opensList().findAll((n) => n.type === 'option').map(words),
      ['Home', 'Watch', 'Bible', 'Digital Bulletin', 'Calendar', 'Groups', 'Directory', 'Give', 'My Profile']);
    await act(async () => { opensList().props.onChange({ target: { value: 'Bulletin' } }); });
    assert.ok(words(r.root).includes('Tapping it opens the Digital Bulletin.'));
    await typeMessage('Fall Festival', 'Sign up today.');
    assert.deepStrictEqual(JSON.parse(session.get('pillar.app.notify.draft')).opens, { kind: 'page', page: 'Bulletin', ann: '' }, 'kept with the draft');
    asked.length = 0; api.sent.length = 0; answers.push(true);
    await sendIt();
    assert.deepStrictEqual(asked, ['Send “Fall Festival” to 214 phones now? It can’t be taken back. Tapping it opens the Digital Bulletin.']);
    assert.deepStrictEqual(api.sent, [{ title: 'Fall Festival', body: 'Sign up today.', data: { page: 'Bulletin' } }]);
    assert.strictEqual(words(one(r.root, 'ax-note')).replace('Write another', ''), 'Sent to 214 phones.');
    assert.strictEqual(picked(tapGroup()), 'The app', 'the next one starts from the app again');
  });

  await t('An announcement: the ones on phones now, by where they live; Send waits until one is picked', async () => {
    await act(async () => { buttonNamed(r.root, 'Write another').props.onClick(); });
    await act(async () => { buttonNamed(tapGroup(), 'An announcement').props.onClick(); });
    await act(async () => { await wait(0); });
    const groups = opensList().findAll((n) => n.type === 'optgroup')
      .map((g) => [g.props.label, g.findAll((n) => n.type === 'option').map(words)]);
    assert.deepStrictEqual(groups, [['Digital Bulletin', ['Fall Festival — Oct 12']], ['Home', ['Baptism Sunday', 'Members meeting — Members only']]],
      'switched-off notices and the app’s own plate card aren’t offered');
    await typeMessage('Members meeting', 'Sunday after the service.');
    assert.ok(buttonNamed(r.root, 'Send now').props.disabled, 'nothing picked: nothing to send yet');
    assert.strictEqual(words(one(r.root, 'ax-nt-missing')), 'Choose the announcement it opens too.');
    await act(async () => { opensList().props.onChange({ target: { value: 'card:c2' } }); });
    assert.ok(words(r.root).includes('Tapping it opens “Members meeting” over Home. Only signed-in members see this card — anyone else lands on Home.'));
    asked.length = 0; api.sent.length = 0; answers.push(true);
    await sendIt();
    assert.deepStrictEqual(api.sent[0].data, { page: 'Home', card: 'c2' });
    assert.match(asked[0], /It can’t be taken back\. Tapping it opens “Members meeting” on Home\.$/);
  });

  await t('an app server from before this: it still sends, and says a tap will just open the app', async () => {
    api.oldServer = true;
    await act(async () => { buttonNamed(r.root, 'Write another').props.onClick(); });
    await act(async () => { buttonNamed(tapGroup(), 'A page').props.onClick(); });
    await act(async () => { opensList().props.onChange({ target: { value: 'Groups' } }); });
    await typeMessage('Groups', 'Find yours.');
    answers.push(true);
    await sendIt();
    assert.ok(words(one(r.root, 'ax-note')).includes('Sent to 214 phones. The app server hasn’t been updated to carry where it opens yet, so tapping it just opens the app.'));
    api.oldServer = false;
    await act(async () => { r.unmount(); });
  });

  await t('the phone count reads the same everywhere: one phone, or every phone when it can’t be counted', async () => {
    session.clear();
    api.count = 1;
    r = await render(h(Notify.default));
    assert.strictEqual(r.root.findByProps({ className: 'shell' }).props['data-sub'], 'A message to 1 phone, straight to the lock screen.');
    await act(async () => { r.unmount(); });
    api.failCount = true;
    r = await render(h(Notify.default));
    assert.strictEqual(r.root.findByProps({ className: 'shell' }).props['data-sub'], 'A message to every phone with the app, straight to the lock screen.');
    assert.ok(words(r.root).includes('Goes to every phone with the app at once, and can’t be taken back.'));
    await act(async () => { r.unmount(); });
    assert.strictEqual(Notify.phonesFor(214), '214 phones');
  });

  console.error = oe;
  const real = errs.filter((e) => !/act\(|not wrapped in act|react-test-renderer is deprecated/.test(e));
  if (real.length) { console.log(real.join('\n')); throw new Error('React warned while rendering'); }
  console.log(`\n${ok} settings & notifications checks passed`);
})().catch((e) => { console.log('  ✗', e.stack || e.message); process.exit(1); });   // (the lock screen's clock would keep it running)
