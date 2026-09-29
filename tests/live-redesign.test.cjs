// Pillar/src/pages/app/LivePage.jsx and css/live.css — App → Live as a control room (redesign,
// 2026-09-23, Pillar-backups/redesign/DESIGN.md §4, the approved mockup Live.dc.html): the stream,
// what's on screen and the saved cards, the composer with a phone beside it, and the chat, on one
// screen.
//
// What it keeps (the inventory's live-* features): the go-live switch asks first and needs a link,
// the stream is ONE whole-object PUT (typing never loses isLive), 'pillar-app-live' fires for the
// sidebar's badge, card payloads keep the shapes the app reads with fresh genId() ids, Save for
// later / Show / Take down / Remove with Undo.
// What's new: words instead of silently dead buttons, Edit on a saved card (it autosaves to the same
// id), a poll's percentages and total, Try again on load errors, the chat slower when not live, the
// app's username/message chat fields, and a phone that draws the card exactly as the app's live
// player does — its numbers read out of BethesdaApp's MediaPlayer.js and checked against live.css.
// After the checker's pass (2026-09-23): words that say what phones really do with a card ("sent",
// 12 seconds), Show always one click (Show again), the stream's isLive re-read and never undone from
// here, reads that overlap a write dropped, an edit that can't save never thrown away, Undo that
// can't write into a saved card, the chat drawer at every width where the chat has no column, and a
// leave guard that matches what isn't saved.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');   // the member app, read only
const OUT = path.join(__dirname, '.build-live'); fs.mkdirSync(OUT, { recursive: true });
let WORK_W = 1300;   // how wide the workspace measures (the chat is a drawer under 1140, and 1140–1559 with Preview)
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
const events = [];   // what the page told the window ('pillar-app-live')
globalThis.window = {
  innerWidth: 1440,
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  dispatchEvent: (e) => { events.push(e); for (const fn of [...(listeners[e.type] || [])]) fn(e); return true; },
};
globalThis.document = {
  activeElement: null,
  querySelector: () => null,
  createElement: (tag) => ({ tagName: tag }),
  getElementById: () => null,
  head: { appendChild: () => {} },
};
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} };
// the polls' intervals, to check how often the page asks
const intervals = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...a) => { intervals.push(ms); return realSetInterval(fn, ms, ...a); };

const React = require(path.join(DEPS, 'react'));
const h = React.createElement;
const { act } = React;
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
const asked = [];
let confirmAnswer = true;
stub('../../lib/dialog', { confirmDialog: async ({ message }) => { asked.push(message); return confirmAnswer; } });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
stub('./AppShell', { __esModule: true, default: ({ title, actions, children }) => h('div', { className: 'shell', 'data-title': title }, h('div', { className: 'head-actions' }, actions), children) });

// ── a pretend app server (the real one upserts saved cards by the client's id, as the fixtures do) ──
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const TEMPLATES = [
  { id: 't1', type: 'scripture', reference: 'John 3:16', text: 'For God so loved the world…', note: 'This morning’s text' },
  { id: 't2', type: 'poll', question: 'Which service do you attend?', options: ['Early', 'Late', 'Online'] },
  { id: 't3', type: 'informative', title: 'Welcome, guests!', body: 'Say hello in the chat.', buttonLabel: 'Give online', destination: 'Give' },
];
const server = {};
function reset(over = {}) {
  Object.assign(server, {
    livestream: { isLive: false, liveStreamUrl: '', liveTitle: 'Sunday Morning Worship', liveNotes: 'Welcome, songs, the message.' },
    liveCard: null, votes: { votes: {} }, templates: clone(TEMPLATES),
    chat: [{ id: 'c1', name: 'Test Member 1', text: 'Good morning!', at: '2026-09-20T15:02:00.000Z' }, { id: 'c2', username: 'Sample Viewer', message: 'Amen', timestamp: 1790000000000 }],
    calls: [], failLive: 0, failTemplates: 0, cardDelay: 0,
  }, over);
}
let ids = 0;
const call = (name, arg) => server.calls.push(arg === undefined ? [name] : [name, clone(arg)]);
stub('../../lib/appApi', {
  genId: () => `g${++ids}`,
  getLivestream: async () => { call('getLivestream'); if (server.failLive > 0) { server.failLive--; throw new Error('The app server is waking up. Try again.'); } return clone(server.livestream); },
  putLivestream: async (d) => { call('putLivestream', d); server.livestream = clone(d); return {}; },
  // a slow read answers what was true when it was asked (server.cardDelay)
  getLiveCard: async () => { const c = clone(server.liveCard); if (server.cardDelay) await wait(server.cardDelay); return c; },
  pushLiveCard: async (c) => { call('pushLiveCard', c); server.liveCard = clone(c); return { ok: true }; },
  clearLiveCard: async () => { call('clearLiveCard'); server.liveCard = null; return { ok: true }; },
  getLiveCardVotes: async () => clone(server.votes),
  getLiveCardTemplates: async () => { call('getLiveCardTemplates'); if (server.failTemplates > 0) { server.failTemplates--; throw new Error('Couldn’t reach the app server.'); } return clone(server.templates); },
  saveLiveCardTemplate: async (t) => {
    call('saveLiveCardTemplate', t);
    const at = server.templates.findIndex((x) => x.id === t.id);
    if (at >= 0) server.templates[at] = clone(t); else server.templates.unshift(clone(t));
    return { ok: true };
  },
  deleteLiveCardTemplate: async (id) => { call('deleteLiveCardTemplate', id); server.templates = server.templates.filter((x) => x.id !== id); return { ok: true }; },
  getChat: async () => { call('getChat'); return clone(server.chat); },
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
const Live = require(xform(path.join(PILLAR, 'src/pages/app/LivePage.jsx'), 'LivePage.cjs'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const realError = console.error;

// ── finding and using things ──
const focused = [];
const nodeMock = (el) => {
  const cls = String(el.props.className || '');
  return {
    cls, isConnected: true, scrollHeight: 900, scrollTop: 0, clientHeight: 300, style: {},
    getBoundingClientRect: () => ({ width: cls.includes('ax-phone-frame') ? 300 : cls.split(' ').includes('ax-work') ? WORK_W : 1300 }),
    focus: () => { focused.push(el.type === 'input' ? (el.props.type === 'search' ? 'search' : 'input') : cls || el.type); },
    querySelector: () => (cls.includes('ax-live-form') ? { focus: () => focused.push('composer field') } : null),
  };
};
const has = (n, c) => typeof n.type === 'string' && String(n.props.className || '').split(' ').includes(c);
const byClass = (root, c) => root.findAll((n) => has(n, c));
const one = (root, c) => { const l = byClass(root, c); assert.ok(l.length, `.${c} is there`); return l[0]; };
const words = (inst) => (typeof inst === 'string' ? inst : (inst.children || []).map(words).join(''));
const button = (root, label) => {
  const l = root.findAll((n) => n.type === 'button' && words(n).trim() === label);
  assert.ok(l.length, `a “${label}” button`);
  return l[0];
};
const byLabel = (root, label) => root.find((n) => n.type === 'button' && n.props['aria-label'] === label);
const input = (root, id) => root.find((n) => (n.type === 'input' || n.type === 'textarea') && n.props.id === id);
const type = async (el, value) => { await act(async () => { el.props.onChange({ target: { value } }); }); };
const click = async (el) => { await act(async () => { el.props.onClick({ stopPropagation() {}, preventDefault() {} }); }); await act(async () => { await wait(5); }); };
const key = async (k, extra = {}) => {
  const e = { type: 'keydown', key: k, target: { closest: () => null }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  await act(async () => { for (const fn of [...(listeners.keydown || [])]) fn(e); });
  return e;
};
const settle = async () => { await act(async () => { await wait(20); }); };
const why = (root) => words(one(root, 'ax-live-why'));
const work = (root) => one(root, 'ax-work');
const calls = (name) => server.calls.filter((c) => c[0] === name);

async function mount() {
  let r;
  await act(async () => { r = TR.create(h(Live.default), { createNodeMock: nodeMock }); });
  await settle();
  return r;
}

(async () => {
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

  await t('the control room: stream · show · write a card · phone · chat, in one workspace that fills the window', async () => {
    reset(); Live.forgetDraft(); events.length = 0;
    const r = await mount();
    const root = r.root;
    const w = work(root);
    assert.ok(has(w, 'ax-live'), 'the workspace is the Live grid');
    const panes = byClass(w, 'ax-pane').map((c) => String(c.props.className || ''));
    // the order is the one-column order on a phone: stream, show, write, phone, chat
    assert.deepStrictEqual(panes.map((c) => c.split(' ').find((x) => x.startsWith('ax-live-'))),
      ['ax-live-stream', 'ax-live-show', 'ax-live-compose', 'ax-live-phone', 'ax-live-chat']);
    assert.ok(has(one(root, 'ax-live-compose'), 'ax-editor-pane'), 'the composer is the workspace editor pane');
    assert.strictEqual(input(root, 'ax-live-title').props.value, 'Sunday Morning Worship');
    assert.ok(/Not live/.test(words(one(root, 'ax-live-status'))));
    assert.deepStrictEqual(events.filter((e) => e.type === 'pillar-app-live').map((e) => e.detail), [false], 'the sidebar hears whether it is live');
    assert.strictEqual(byClass(root, 'ax-live-tile').length, 3, 'every saved card is a tile');
    assert.strictEqual(byClass(root, 'ax-live-msg').length, 2);
    // the notes fold away (Hick) and say whether there are any
    const notes = root.find((n) => n.type === 'details');
    assert.ok(!notes.props.open && /Notes for the stream/.test(words(notes)) && /Written/.test(words(notes)));
    // search on the saved cards, and filter chips by kind
    assert.strictEqual(byClass(root, 'ax-search').length, 1);
    assert.deepStrictEqual(byClass(root, 'ax-filter').map((b) => words(b)), ['All3', 'Scripture1', 'Announcements1', 'Polls1']);
    // nothing on screen: the box says so, and that phones pick cards up only while live
    assert.ok(/Nothing on screen/.test(words(one(root, 'ax-live-now'))) && /only while you’re live/.test(words(one(root, 'ax-live-now'))));
    await act(async () => { r.unmount(); });
  });

  await t('going live: needs the link, asks first, and PUTs the whole stream; ending asks nothing', async () => {
    reset(); Live.forgetDraft(); events.length = 0; asked.length = 0;
    const r = await mount();
    const root = r.root;
    const sw = () => one(root, 'ax-live-status').find((n) => n.type === 'input' && n.props.type === 'checkbox');
    assert.ok(/Add the stream link below before going live/.test(words(one(root, 'ax-live-status'))), 'says what the switch needs before it is tried');
    await act(async () => { sw().props.onChange({ target: { checked: true } }); });
    assert.ok(/Add the stream link first\./.test(words(one(root, 'ax-live-stream'))));
    assert.strictEqual(calls('putLivestream').length, 0);
    assert.strictEqual(asked.length, 0);
    await type(input(root, 'ax-live-link'), 'https://example.org/live/index.m3u8');
    await act(async () => { sw().props.onChange({ target: { checked: true } }); await wait(10); });
    assert.deepStrictEqual(asked, ['Go live now? The whole app switches to live mode for everyone within seconds.']);
    const put = calls('putLivestream').pop()[1];
    assert.deepStrictEqual(put, { isLive: true, liveStreamUrl: 'https://example.org/live/index.m3u8', liveTitle: 'Sunday Morning Worship', liveNotes: 'Welcome, songs, the message.' });
    assert.strictEqual(events.filter((e) => e.type === 'pillar-app-live').pop().detail, true);
    assert.ok(/You’re live/.test(words(one(root, 'ax-live-status'))) && has(one(root, 'ax-live-status'), 'on'));
    // no autosave doubles the switch's write
    await act(async () => { await wait(800); });
    assert.strictEqual(calls('putLivestream').length, 1);
    // ending: no question, isLive false
    await act(async () => { sw().props.onChange({ target: { checked: false } }); await wait(10); });
    assert.strictEqual(asked.length, 1);
    assert.strictEqual(calls('putLivestream').pop()[1].isLive, false);
    assert.strictEqual(events.filter((e) => e.type === 'pillar-app-live').pop().detail, false);
    // a No keeps it off
    confirmAnswer = false;
    await act(async () => { sw().props.onChange({ target: { checked: true } }); await wait(10); });
    confirmAnswer = true;
    assert.strictEqual(calls('putLivestream').length, 2);
    await act(async () => { r.unmount(); });
  });

  await t('the stream details save as you type, into the whole object (isLive is never lost)', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: 'Old', liveNotes: '' } }); Live.forgetDraft();
    const r = await mount();
    await type(input(r.root, 'ax-live-title'), 'Sunday worship');
    await act(async () => { await wait(800); });
    assert.deepStrictEqual(calls('putLivestream').pop()[1], { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: 'Sunday worship', liveNotes: '' });
    // ⌘S saves now, without waiting
    await type(input(r.root, 'ax-live-title'), 'Sunday worship!');
    await key('s', { metaKey: true });
    await settle();
    assert.strictEqual(calls('putLivestream').pop()[1].liveTitle, 'Sunday worship!');
    await act(async () => { r.unmount(); });
  });

  await t('a load error says so, with Try again (no page reload)', async () => {
    reset({ failLive: 1, failTemplates: 1 }); Live.forgetDraft();
    const r = await mount();
    const stream = one(r.root, 'ax-live-stream');
    assert.ok(/waking up/.test(words(stream)));
    assert.ok(has(button(stream, 'Try again'), 'ax-live-retry'), 'a 44px target, like the page’s other retries');
    await click(button(stream, 'Try again'));
    await settle();
    assert.strictEqual(input(r.root, 'ax-live-title').props.value, 'Sunday Morning Worship');
    // the saved cards: a failed load isn't "no saved cards"
    const tiles = one(r.root, 'ax-live-tiles');
    assert.ok(/Couldn’t load the saved cards/.test(words(tiles)));
    await click(button(tiles, 'Try again'));
    await settle();
    assert.strictEqual(byClass(r.root, 'ax-live-tile').length, 3);
    await act(async () => { r.unmount(); });
  });

  await t('a verse card: words for what’s missing, Show now pushes the app’s shape with a fresh id', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: '', liveNotes: '' } }); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    assert.strictEqual(why(root), 'A verse card needs the reference and the verse.');
    assert.ok(button(root, 'Show now').props.disabled && button(root, 'Save for later').props.disabled);
    assert.strictEqual(button(root, 'Show now').props['aria-describedby'], 'ax-live-why', 'the reason is tied to the button');
    await type(input(root, 'ax-live-ref'), ' Luke 15:24 ');
    assert.strictEqual(why(root), 'Add the words of the verse.');
    await type(input(root, 'ax-live-verse'), 'For this my son was dead, and is alive again.');
    assert.ok(!button(root, 'Show now').props.disabled);
    await click(button(root, 'Show now'));
    const pushed = calls('pushLiveCard').pop()[1];
    assert.deepStrictEqual(pushed, { id: pushed.id, type: 'scripture', reference: 'Luke 15:24', text: 'For this my son was dead, and is alive again.', note: '' });
    assert.ok(/^g\d+$/.test(pushed.id), 'genId() stamps it');
    // (was "On screen now": a phone shows a card for 12 s as it arrives — MediaPlayer.js — so the box
    // says it was sent, and for how long phones show it)
    assert.ok(/Sent to phones/.test(words(one(root, 'ax-live-now'))) && /Luke 15:24/.test(words(one(root, 'ax-live-now'))));
    assert.ok(/12 seconds as it arrives; anyone who opens the stream later won’t see it/.test(words(one(root, 'ax-live-now'))));
    assert.ok(/Sent to phones/.test(why(root)), 'the draft stays, and says it went out');
    // Save for later keeps it and clears the composer (same kind)
    await click(button(root, 'Save for later'));
    const kept = calls('saveLiveCardTemplate').pop()[1];
    assert.strictEqual(kept.reference, 'Luke 15:24');
    assert.notStrictEqual(kept.id, pushed.id, 'a fresh id for the saved card');
    assert.strictEqual(input(root, 'ax-live-ref').props.value, '');
    await settle();
    assert.strictEqual(byClass(root, 'ax-live-tile').length, 4);
    // Take down
    await click(button(one(root, 'ax-live-now'), 'Take down'));
    assert.strictEqual(calls('clearLiveCard').length, 1);
    assert.ok(/Nothing on screen/.test(words(one(root, 'ax-live-now'))));
    await act(async () => { r.unmount(); });
  });

  await t('an announcement: a button needs a label, and “No button” drops a stale one', async () => {
    reset(); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    await click(root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n) === 'Announcement'));
    assert.strictEqual(why(root), 'An announcement needs a title.');
    await type(input(root, 'ax-live-atitle'), 'Give online');
    await click(root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n) === 'Give'));
    assert.ok(/The button needs a label/.test(why(root)));
    assert.ok(button(root, 'Show now').props.disabled);
    const label = root.find((n) => n.type === 'input' && n.props['aria-label'] === 'Button label');
    await type(label, 'Give now');
    assert.ok(!button(root, 'Show now').props.disabled);
    await click(button(root, 'Show now'));
    assert.deepStrictEqual(calls('pushLiveCard').pop()[1].buttonLabel, 'Give now');
    await click(root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n) === 'No button'));
    await click(button(root, 'Show now'));
    const c = calls('pushLiveCard').pop()[1];
    assert.deepStrictEqual({ ...c, id: 'x' }, { id: 'x', type: 'informative', title: 'Give online', body: '', buttonLabel: '', destination: '' });
    await act(async () => { r.unmount(); });
  });

  await t('a poll: two to five answers, empty ones dropped', async () => {
    reset(); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    await click(root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n) === 'Poll'));
    await type(input(root, 'ax-live-q'), 'Where are you from?');
    const answer = (i) => root.find((n) => n.type === 'input' && n.props['aria-label'] === `Answer ${i}`);
    await type(answer(1), 'Here in town');
    assert.strictEqual(why(root), 'A poll needs at least two answers.');
    await type(answer(2), 'Nearby');
    await click(button(root, 'Add an answer'));
    await type(answer(3), '  ');
    await click(button(root, 'Show now'));
    const c = calls('pushLiveCard').pop()[1];
    assert.deepStrictEqual(c.options, ['Here in town', 'Nearby']);
    assert.strictEqual(c.question, 'Where are you from?');
    await act(async () => { r.unmount(); });
  });

  await t('a saved card: Show is one click (a fresh id, so phones pop it again), Edit autosaves to the same card', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: '', liveNotes: '' } }); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    const tile = (name) => byClass(root, 'ax-live-tile').find((x) => words(x).includes(name));
    await click(button(tile('John 3:16'), 'Show'));
    const pushed = calls('pushLiveCard').pop()[1];
    assert.notStrictEqual(pushed.id, 't1');
    assert.deepStrictEqual({ ...pushed, id: 't1' }, TEMPLATES[0], 'exactly as saved, but its id');
    // the tile says it went out, and stays one click from going out again (it used to be a disabled
    // "On screen" — but phones hide a card after 12 s, so most of the time nobody was seeing it)
    assert.ok(has(tile('John 3:16'), 'on') && /Sent to phones/.test(words(tile('John 3:16'))), 'the tile says it went out');
    const again = button(tile('John 3:16'), 'Show again');
    assert.ok(!again.props.disabled && /12 seconds/.test(again.props.title));
    await click(again);
    const second = calls('pushLiveCard').pop()[1];
    assert.ok(second.id !== pushed.id && second.id !== 't1', 'a fresh id again, so phones pop it up again');
    // something half-written waits while a saved card is edited
    await type(input(root, 'ax-live-ref'), 'Psalm 23');
    await click(byLabel(root, 'Edit “John 3:16”'));
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'John 3:16');
    assert.ok(/Editing/.test(words(one(root, 'ax-live-compose'))), 'the composer says it holds a saved card');
    assert.ok(focused.includes('composer field'), 'the keyboard goes to the composer');
    assert.ok(!root.findAll((n) => n.type === 'button' && words(n).trim() === 'Save for later').length, 'autosave, no Save button');
    await type(input(root, 'ax-live-verse'), 'For God so loved the world.');
    await act(async () => { await wait(800); });
    const saved = calls('saveLiveCardTemplate').pop()[1];
    assert.deepStrictEqual(saved, { id: 't1', type: 'scripture', reference: 'John 3:16', text: 'For God so loved the world.', note: 'This morning’s text' });
    assert.strictEqual(server.templates.length, 3, 'the same card, not a copy');
    // an invalid edit waits (and says why) instead of saving
    await type(input(root, 'ax-live-verse'), '');
    await act(async () => { await wait(800); });
    assert.strictEqual(calls('saveLiveCardTemplate').length, 1);
    assert.ok(/Not saved yet/.test(words(one(root, 'ax-live-compose'))));
    await type(input(root, 'ax-live-verse'), 'For God so loved the world…');
    await click(button(one(root, 'ax-live-compose'), 'Done'));
    assert.strictEqual(calls('saveLiveCardTemplate').pop()[1].text, 'For God so loved the world…', 'Done saves what was left');
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'Psalm 23', 'and brings back what was being written');
    await act(async () => { r.unmount(); });
  });

  await t('remove a saved card at once, with Undo (same id back)', async () => {
    reset(); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    await click(byLabel(root, 'Remove “Which service do you attend?”'));
    assert.deepStrictEqual(calls('deleteLiveCardTemplate').pop(), ['deleteLiveCardTemplate', 't2']);
    assert.strictEqual(byClass(root, 'ax-live-tile').length, 2);
    const toast = one(root, 'ax-toast');
    assert.ok(/“Which service do you attend\?” removed\./.test(words(toast)));
    await click(button(toast, 'Undo'));
    assert.deepStrictEqual(calls('saveLiveCardTemplate').pop()[1], TEMPLATES[1]);
    await settle();
    assert.strictEqual(byClass(root, 'ax-live-tile').length, 3);
    await act(async () => { r.unmount(); });
  });

  await t('search and filter the saved cards; N, / and Esc from the keyboard', async () => {
    reset(); Live.forgetDraft(); focused.length = 0;
    const r = await mount();
    const root = r.root;
    const search = root.find((n) => n.type === 'input' && n.props.type === 'search');
    await type(search, 'guests');
    assert.deepStrictEqual(byClass(root, 'ax-live-tile').map((x) => words(one(x, 'ax-row-title'))), ['Welcome, guests!']);
    await type(search, 'online');   // an answer and a button label both match
    assert.strictEqual(byClass(root, 'ax-live-tile').length, 2);
    await type(search, '');
    await click(root.find((n) => has(n, 'ax-filter') && words(n).startsWith('Polls')));
    assert.deepStrictEqual(byClass(root, 'ax-live-tile').map((x) => words(one(x, 'ax-row-title'))), ['Which service do you attend?']);
    await key('/');
    assert.ok(focused.includes('search'));
    await key('n');
    assert.ok(focused.includes('composer field'));
    // Preview opens the phone beside the composer; Esc closes it
    await click(button(one(root, 'ax-live-compose'), 'Preview'));
    assert.ok(has(work(root), 'phone-open'));
    await key('Escape');
    assert.ok(!has(work(root), 'phone-open'));
    // (the chat drawer — the head's Chat, Esc, the scrim — has its own test below: at this width,
    // 1300, the chat is a column unless Preview is open)
    await act(async () => { r.unmount(); });
  });

  await t('a poll on screen: percentages as the app rounds them, the count, and the total — only its own votes', async () => {
    const poll = { id: 'p9', type: 'poll', question: 'Where are you from?', options: ['Here in town', 'Nearby town', 'Farther'] };
    reset({ liveCard: poll, votes: { cardId: 'p9', votes: { 0: 21, 1: 11, 2: 4 } } }); Live.forgetDraft();
    const r = await mount();
    const now = one(r.root, 'ax-live-now');
    assert.deepStrictEqual(byClass(now, 'ax-live-bar-n').map(words), ['58% · 21', '31% · 11', '11% · 4']);
    assert.strictEqual(words(one(now, 'ax-live-total')), '36 votes');
    assert.strictEqual(one(now, 'ax-live-bar-track').children[0].props.style.width, '58%', 'the bar width is the one inline value');
    await act(async () => { r.unmount(); });
    // a previous card's votes don't show
    reset({ liveCard: poll, votes: { cardId: 'old', votes: { 0: 5 } } });
    const r2 = await mount();
    assert.strictEqual(words(one(r2.root, 'ax-live-total')), 'No votes yet');
    await act(async () => { r2.unmount(); });
    assert.deepStrictEqual(Live.tally(['A', 'B'], { 0: 1, 1: 2 }), { total: 3, rows: [{ label: 'A', n: 1, pct: 33 }, { label: 'B', n: 2, pct: 67 }] });
    assert.deepStrictEqual(Live.votesFor({ id: 'a' }, { votes: { 0: 1 } }), { 0: 1 }, 'a server that doesn’t say which card: taken as is');
  });

  await t('the chat: the app’s own fields, times, and slower polling when not live', async () => {
    reset(); Live.forgetDraft(); intervals.length = 0;
    const r = await mount();
    const msgs = byClass(r.root, 'ax-live-msg');
    assert.strictEqual(words(one(msgs[1], 'ax-live-msg-who')), 'Sample Viewer', 'the app posts { username, message }');
    assert.strictEqual(words(one(msgs[1], 'ax-live-msg-text')), 'Amen');
    assert.ok(byClass(msgs[0], 'ax-live-msg-at').length === 1, 'a time when the message has one');
    assert.ok(intervals.includes(Live.CHAT_EVERY.off) && !intervals.includes(Live.CHAT_EVERY.live), 'not live: every 30 s');
    assert.ok(intervals.includes(Live.CARD_EVERY));
    // going live speeds it up
    await type(input(r.root, 'ax-live-link'), 'https://x/index.m3u8');
    await act(async () => { one(r.root, 'ax-live-status').find((n) => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); await wait(10); });
    assert.ok(intervals.includes(Live.CHAT_EVERY.live), 'live: every 7 s');
    assert.deepStrictEqual([Live.CHAT_EVERY.live, Live.CHAT_EVERY.off, Live.CARD_EVERY], [7000, 30000, 5000]);
    await act(async () => { r.unmount(); });
  });

  await t('the phone draws the card as the app’s live player does', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: '', liveNotes: '' } }); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    const phone = () => one(root, 'ax-live-phone');
    // the player: no status bar words, no dock, no profile button; the stream's title (else 'Live Service')
    assert.strictEqual(words(one(phone(), 'ax-live-title')), 'Live Service');
    assert.strictEqual(byClass(phone(), 'ax-pa-dockbar').length, 0);
    assert.strictEqual(byClass(phone(), 'ax-pa-profile').length, 0);
    assert.ok(has(one(phone(), 'ax-phone-screen'), 'ax-live-screen'));
    assert.strictEqual(byClass(phone(), 'ax-live-card').length, 0, 'nothing written, nothing on screen: no card');
    assert.ok(/Nothing on viewers’ screens/.test(words(phone())));
    // the live service's own screen (BethesdaApp components/LiveOverlay.js): who's watching — "–", since
    // Pillar can't read the count — then LIVE, the title, ✕; the comment row with the chat's round button
    // and the Bible; no play, pause or skips (user, 2026-09-23: "JUST FOR livestream UI")
    for (const c of ['ax-live-top', 'ax-live-bottom', 'ax-live-shade-top', 'ax-live-shade-bottom', 'ax-live-row', 'ax-live-exit']) assert.strictEqual(byClass(phone(), c).length, 1, c);
    const meta = one(phone(), 'ax-live-meta');
    assert.strictEqual(meta.children[0].props.className, 'ax-live-viewers', 'the count comes first, then LIVE, as in the app');
    assert.strictEqual(words(one(meta, 'ax-live-viewers-n')), '–');
    assert.strictEqual(words(one(meta, 'ax-live-livebadge')), 'LIVE');
    assert.ok(/phones show how many are watching/.test(words(phone())));
    assert.strictEqual(words(one(phone(), 'ax-live-field')), 'Your comment');
    assert.strictEqual(byClass(phone(), 'ax-live-round').length, 2, 'the chat and the Bible');
    assert.ok(has(byClass(phone(), 'ax-live-round')[1], 'bible'), 'the Bible last, in the brand orange');
    for (const gone of ['ax-live-play', 'ax-live-skip', 'ax-live-ctlrow', 'ax-live-topbar']) assert.strictEqual(byClass(phone(), gone).length, 0, `no ${gone}`);
    assert.strictEqual(byClass(phone(), 'ax-live-notes').length, 0, 'no notes on this stream: no Notes');
    // the chat as the app takes it: only messages with a name and words (the other fixture uses other keys)
    assert.deepStrictEqual(byClass(phone(), 'ax-live-bubble').map(words), ['Sample ViewerAmen']);
    await type(input(root, 'ax-live-title'), 'Sunday Worship');
    assert.strictEqual(words(one(phone(), 'ax-live-title')), 'Sunday Worship');
    // the title as the app takes it — liveTitle || 'Live Service', not trimmed: spaces are a blank title
    await type(input(root, 'ax-live-title'), '   ');
    assert.strictEqual(words(one(phone(), 'ax-live-title')), '   ');
    await type(input(root, 'ax-live-title'), 'Sunday Worship');
    // a verse: VERSE badge, the save mark, the reference, the words in quotes, the note
    await type(input(root, 'ax-live-ref'), 'Luke 15:24');
    await type(input(root, 'ax-live-verse'), 'He was lost, and is found.');
    await type(input(root, 'ax-live-note'), 'Pastor’s key verse');
    let card = one(phone(), 'ax-live-card');
    // the live screen doesn't fade, so a card lands with it: just above the comment row, the chat above it
    for (const c of ['ax-live-top', 'ax-live-row', 'ax-live-viewers']) assert.strictEqual(byClass(phone(), c).length, 1, `${c} stays with a card`);
    const foot = one(phone(), 'ax-live-bottom').children.map((n) => n.props.className || n.children[0]?.props?.className);
    assert.deepStrictEqual(foot, ['ax-live-bubbles', 'ax-live-cardwrap', 'ax-live-row'], 'the chat, the card, then the row');
    assert.strictEqual(byClass(phone(), 'ax-live-video').length, 1);
    assert.ok(/each phone hides it after 12 seconds/.test(words(phone())));
    assert.strictEqual(words(one(card, 'ax-live-badge')), 'VERSE');
    assert.strictEqual(byClass(card, 'ax-live-save').length, 1);
    assert.strictEqual(words(one(card, 'ax-live-ref')), 'Luke 15:24');
    assert.strictEqual(words(one(card, 'ax-live-text')), '"He was lost, and is found."');
    assert.strictEqual(words(one(card, 'ax-live-note')), 'Pastor’s key verse');
    assert.ok(/Your card/.test(words(phone())));
    // an announcement: INFO, no save mark, the button only with a label
    await click(root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n) === 'Announcement'));
    await type(input(root, 'ax-live-atitle'), 'Fall Festival');
    card = one(phone(), 'ax-live-card');
    assert.strictEqual(words(one(card, 'ax-live-badge')), 'INFO');
    assert.ok(has(one(card, 'ax-live-badge'), 'informative'));
    assert.strictEqual(byClass(card, 'ax-live-save').length + byClass(card, 'ax-live-infobtn').length, 0);
    await click(root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n) === 'Give'));
    await type(root.find((n) => n.type === 'input' && n.props['aria-label'] === 'Button label'), 'Give now');
    assert.strictEqual(words(one(one(phone(), 'ax-live-card'), 'ax-live-infobtn')), 'Give now');
    // a poll: POLL, the answers, Tap to vote
    await click(root.find((n) => n.type === 'button' && n.props.role === 'radio' && words(n) === 'Poll'));
    await type(input(root, 'ax-live-q'), 'How did you hear about us?');
    await type(root.find((n) => n.type === 'input' && n.props['aria-label'] === 'Answer 1'), 'A friend');
    card = one(phone(), 'ax-live-card');
    assert.strictEqual(words(one(card, 'ax-live-badge')), 'POLL');
    assert.deepStrictEqual(byClass(card, 'ax-live-opt').map(words), ['A friend']);
    assert.strictEqual(words(one(card, 'ax-live-tap')), 'Tap to vote');
    await act(async () => { r.unmount(); });
    // with nothing written, the phone shows what's on screen now
    reset({ liveCard: { id: 'x1', type: 'scripture', reference: 'Psalm 23:1', text: 'The LORD is my shepherd.', note: '' } }); Live.forgetDraft();
    const r2 = await mount();
    assert.strictEqual(words(one(one(r2.root, 'ax-live-phone'), 'ax-live-ref')), 'Psalm 23:1');
    // (was "On screen now"/"What viewers see right now": phones showed it for 12 s as it arrived)
    assert.ok(/Last card sent/.test(words(one(r2.root, 'ax-live-phone'))));
    assert.ok(/12 seconds as it arrives; anyone who opens the stream later won’t see it/.test(words(one(r2.root, 'ax-live-phone'))));
    await act(async () => { r2.unmount(); });
  });

  await t('what’s being written survives leaving the page and coming back', async () => {
    reset(); Live.forgetDraft();
    const r = await mount();
    await type(input(r.root, 'ax-live-ref'), 'Romans 8:28');
    await act(async () => { r.unmount(); });
    const r2 = await mount();
    assert.strictEqual(input(r2.root, 'ax-live-ref').props.value, 'Romans 8:28');
    await click(button(one(r2.root, 'ax-live-compose'), 'Clear'));
    assert.strictEqual(input(r2.root, 'ax-live-ref').props.value, '');
    await click(button(one(r2.root, 'ax-toast'), 'Undo'));
    assert.strictEqual(input(r2.root, 'ax-live-ref').props.value, 'Romans 8:28', 'Clear has Undo');
    await act(async () => { r2.unmount(); });
    Live.forgetDraft();
  });

  await t('Undo of a Clear never writes into a saved card opened since — it goes back where Done brings it from', async () => {
    reset(); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    await type(input(root, 'ax-live-ref'), 'Romans 8:28');
    await click(button(one(root, 'ax-live-compose'), 'Clear'));
    await click(byLabel(root, 'Edit “Which service do you attend?”'));
    assert.strictEqual(input(root, 'ax-live-q').props.value, 'Which service do you attend?');
    // (the checker's case: this Undo used to put Romans 8:28 in the composer, and the poll's autosave
    // wrote it into the poll)
    await click(button(one(root, 'ax-toast'), 'Undo'));
    assert.strictEqual(input(root, 'ax-live-q').props.value, 'Which service do you attend?', 'the saved card stays as it was');
    await act(async () => { await wait(800); });
    assert.strictEqual(calls('saveLiveCardTemplate').length, 0, 'nothing written into it');
    assert.deepStrictEqual(server.templates.find((x) => x.id === 't2'), TEMPLATES[1]);
    await click(button(one(root, 'ax-live-compose'), 'Done'));
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'Romans 8:28', 'the cleared card is back once the saved one is done');
    await act(async () => { r.unmount(); });
    Live.forgetDraft();
  });

  await t('a saved card’s edit that can’t save is never thrown away by leaving it: it stays, says why, and can be put back', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: '', liveNotes: '' } }); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    const tile = (name) => byClass(root, 'ax-live-tile').find((x) => words(x).includes(name));
    await click(byLabel(root, 'Edit “John 3:16”'));
    await type(input(root, 'ax-live-ref'), 'John 3:17');
    await type(input(root, 'ax-live-verse'), '');
    // Done: the composer stays, the line says why, the keyboard goes to what's missing
    focused.length = 0;
    await click(button(one(root, 'ax-live-compose'), 'Done'));
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'John 3:17', 'still in the composer');
    assert.ok(/Editing/.test(words(one(root, 'ax-live-compose'))));
    assert.ok(has(one(root, 'ax-live-why'), 'held') && /^Not saved: Add the words of the verse\. Fix it to keep your changes, or put back the saved card\.$/.test(why(root)));
    assert.ok(focused.includes('composer field'), 'the keyboard goes to the verse');
    // Edit on another card and N wait the same way
    await click(byLabel(root, 'Edit “Welcome, guests!”'));
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'John 3:17');
    await key('n');
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'John 3:17');
    // its own tile's Show sends neither the half-edit nor the old words
    await click(button(tile('John 3:16'), 'Show'));
    assert.strictEqual(calls('pushLiveCard').length, 0);
    assert.strictEqual(calls('saveLiveCardTemplate').length, 0, 'nothing saved — and nothing lost');
    // put back the saved card, with Undo
    await click(button(one(root, 'ax-live-why'), 'put back the saved card'));
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'John 3:16');
    assert.strictEqual(input(root, 'ax-live-verse').props.value, TEMPLATES[0].text);
    assert.ok(has(one(root, 'ax-live-why'), 'ok'));
    await click(button(one(root, 'ax-toast'), 'Undo'));
    assert.strictEqual(input(root, 'ax-live-ref').props.value, 'John 3:17', 'Undo brings the edit back');
    // fixed, Done saves it and leaves
    await type(input(root, 'ax-live-verse'), 'That whosoever believeth…');
    await click(button(one(root, 'ax-live-compose'), 'Done'));
    assert.deepStrictEqual(calls('saveLiveCardTemplate').pop()[1], { id: 't1', type: 'scripture', reference: 'John 3:17', text: 'That whosoever believeth…', note: 'This morning’s text' });
    assert.ok(!/Editing/.test(words(one(root, 'ax-live-compose'))) && input(root, 'ax-live-ref').props.value === '');
    // an unchanged card that wouldn't pass today's rules (an old one) still closes: nothing to lose
    server.templates.push({ id: 't9', type: 'informative', title: 'Old card', body: '', buttonLabel: '', destination: 'Give' });
    await act(async () => { r.unmount(); });
    const r2 = await mount();
    await click(byLabel(r2.root, 'Edit “Old card”'));
    assert.ok(/The button needs a label/.test(why(r2.root)));
    await click(button(one(r2.root, 'ax-live-compose'), 'Done'));
    assert.ok(!/Editing/.test(words(one(r2.root, 'ax-live-compose'))));
    await act(async () => { r2.unmount(); });
  });

  await t('Show on the tile of the card in the composer sends what it says now, not the last save', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: '', liveNotes: '' } }); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    await click(byLabel(root, 'Edit “John 3:16”'));
    await type(input(root, 'ax-live-note'), 'Read it together');
    const tile = byClass(root, 'ax-live-tile').find((x) => words(x).includes('John 3:16'));
    assert.ok(/In the composer/.test(words(tile)));
    await click(button(tile, 'Show'));   // well inside the 700 ms autosave
    const pushed = calls('pushLiveCard').pop()[1];
    assert.strictEqual(pushed.note, 'Read it together');
    assert.ok(pushed.id !== 't1');
    assert.strictEqual(calls('saveLiveCardTemplate').pop()[1].note, 'Read it together', 'and the edit is saved with it');
    await act(async () => { r.unmount(); });
  });

  await t('the stream’s isLive is the server’s: a details save never undoes a switch flipped elsewhere, and a re-read shows it', async () => {
    reset({ livestream: { isLive: false, liveStreamUrl: 'https://x/index.m3u8', liveTitle: 'Old', liveNotes: '' } }); Live.forgetDraft(); events.length = 0;
    const r = await mount();
    const root = r.root;
    const lives = () => events.filter((e) => e.type === 'pillar-app-live').map((e) => e.detail);
    // another tab goes live after this page loaded; a title typed here must not switch it off
    server.livestream = { ...server.livestream, isLive: true };
    await type(input(root, 'ax-live-title'), 'New title');
    await act(async () => { await wait(800); });
    assert.deepStrictEqual(calls('putLivestream').pop()[1], { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: 'New title', liveNotes: '' }, 'isLive read just before the PUT');
    assert.ok(/You’re live/.test(words(one(root, 'ax-live-status'))), 'and the page learns it');
    assert.strictEqual(lives().pop(), true, 'the sidebar too');
    // switched off and renamed elsewhere: the next re-read (here, the window's focus) shows both
    server.livestream = { ...server.livestream, isLive: false, liveTitle: 'Renamed elsewhere' };
    await act(async () => { window.dispatchEvent({ type: 'focus' }); await wait(10); });
    assert.ok(/Not live/.test(words(one(root, 'ax-live-status'))));
    assert.strictEqual(input(root, 'ax-live-title').props.value, 'Renamed elsewhere', 'nothing waiting to save here: the server’s words too');
    assert.strictEqual(lives().pop(), false);
    const puts = calls('putLivestream').length;
    await act(async () => { await wait(800); });
    assert.strictEqual(calls('putLivestream').length, puts, 'taking the server’s words writes nothing back');
    // while something typed here waits to save, only isLive is taken; what's typed stays and saves
    await type(input(root, 'ax-live-title'), 'Typing…');
    server.livestream = { ...server.livestream, isLive: true };
    await act(async () => { window.dispatchEvent({ type: 'focus' }); await wait(10); });
    assert.strictEqual(input(root, 'ax-live-title').props.value, 'Typing…');
    assert.ok(/You’re live/.test(words(one(root, 'ax-live-status'))));
    await act(async () => { await wait(800); });
    assert.deepStrictEqual(calls('putLivestream').pop()[1], { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: 'Typing…', liveNotes: '' });
    assert.ok(intervals.includes(Live.STREAM_EVERY) && Live.STREAM_EVERY === 15000, 'and every 15 s');
    await act(async () => { r.unmount(); });
  });

  await t('a read that was on its way when Show or Take down happened never flips them back', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: '', liveNotes: '' } }); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    const tile = (name) => byClass(root, 'ax-live-tile').find((x) => words(x).includes(name));
    server.cardDelay = 60;
    await act(async () => { window.dispatchEvent({ type: 'focus' }); });   // a read sets off: nothing sent yet
    await click(button(tile('John 3:16'), 'Show'));                        // Show lands before it answers
    await act(async () => { await wait(100); });
    assert.ok(/John 3:16/.test(words(one(root, 'ax-live-now'))) && has(tile('John 3:16'), 'on'), 'the old answer is dropped');
    await act(async () => { window.dispatchEvent({ type: 'focus' }); });   // a read that will still see it
    await click(button(one(root, 'ax-live-now'), 'Take down'));
    await act(async () => { await wait(100); });
    assert.ok(/Nothing on screen/.test(words(one(root, 'ax-live-now'))));
    // an ordinary read afterwards still lands
    server.cardDelay = 0;
    server.liveCard = { id: 'else', type: 'scripture', reference: 'Psalm 1:1', text: 'Blessed is the man…', note: '' };
    await act(async () => { window.dispatchEvent({ type: 'focus' }); await wait(10); });
    assert.ok(/Psalm 1:1/.test(words(one(root, 'ax-live-now'))));
    await act(async () => { r.unmount(); });
  });

  await t('“Leave site?” only while something here isn’t saved anywhere', async () => {
    reset({ livestream: { isLive: true, liveStreamUrl: 'https://x/index.m3u8', liveTitle: '', liveNotes: '' } }); Live.forgetDraft();
    const guard = () => (listeners.beforeunload ? listeners.beforeunload.size : 0);
    const r = await mount();
    const root = r.root;
    assert.strictEqual(guard(), 0, 'nothing typed');
    await type(input(root, 'ax-live-ref'), 'Luke 15:24');
    assert.strictEqual(guard(), 1, 'a card being written');
    await type(input(root, 'ax-live-verse'), 'He was lost, and is found.');
    await click(button(root, 'Show now'));
    assert.strictEqual(guard(), 0, 'sent as it reads: nothing to lose (it used to ask on every tab close)');
    await type(input(root, 'ax-live-note'), 'Key verse');
    assert.strictEqual(guard(), 1, 'changed since it went out');
    await click(button(one(root, 'ax-live-compose'), 'Clear'));
    assert.strictEqual(guard(), 0);
    // the stream's details while their 700 ms autosave waits (it used to leave these unguarded)
    await type(input(root, 'ax-live-title'), 'Sunday');
    assert.strictEqual(guard(), 1, 'a title not saved yet');
    await act(async () => { await wait(800); });
    assert.strictEqual(guard(), 0, 'saved');
    // a saved card's edit waiting to save, or unable to
    await click(byLabel(root, 'Edit “John 3:16”'));
    assert.strictEqual(guard(), 0, 'opened, unchanged');
    await type(input(root, 'ax-live-note'), 'Changed');
    assert.strictEqual(guard(), 1, 'an edit waiting on its autosave');
    await act(async () => { await wait(800); });
    assert.strictEqual(guard(), 0, 'saved to the card');
    await type(input(root, 'ax-live-verse'), '');
    assert.strictEqual(guard(), 1, 'an edit that can’t save yet');
    await act(async () => { r.unmount(); });
    assert.strictEqual(guard(), 0);
    Live.forgetDraft();
  });

  await t('the Show pane: “/ search” only with saved cards to search, and one quiet live region (never the tally)', async () => {
    const poll = { id: 'p9', type: 'poll', question: 'Where are you from?', options: ['Here', 'Away'] };
    reset({ templates: [], liveCard: poll, votes: { cardId: 'p9', votes: { 0: 2, 1: 1 } } }); Live.forgetDraft();
    const r = await mount();
    const root = r.root;
    const keys = () => one(root, 'ax-live-show').findAll((n) => n.type === 'kbd').map(words);
    assert.ok(!keys().includes('/') && keys().includes('N'), 'no search box, no “/ search”');
    // one live region, the summary — the box and its tally aren't (they re-render every 5 s)
    const regions = root.findAll((n) => typeof n.type === 'string' && n.props['aria-live']);
    assert.deepStrictEqual(regions.map((n) => [n.props.className, words(n)]), [['ax-live-sr', 'Sent to phones: Where are you from?']]);
    assert.strictEqual(one(root, 'ax-live-now').props['aria-live'], undefined);
    assert.strictEqual(byClass(regions[0], 'ax-live-tally').length, 0);
    // a saved card: now there's something to search
    await type(input(root, 'ax-live-ref'), 'Micah 6:8');
    await type(input(root, 'ax-live-verse'), 'Do justly, love mercy, walk humbly.');
    await click(button(root, 'Save for later'));
    await settle();
    assert.ok(keys().includes('/'));
    await act(async () => { r.unmount(); });
  });

  await t('the chat drawer: wherever the chat has no column — under 1140, and 1140–1559 while Preview has it', async () => {
    reset(); Live.forgetDraft(); focused.length = 0;
    const opener = { focus: () => focused.push('chat button'), isConnected: true };
    // 1000: two columns, the chat a drawer; Esc and the scrim close it, the keyboard comes back
    WORK_W = 1000;
    let r = await mount();
    let root = r.root;
    document.activeElement = opener;
    await click(one(root, 'ax-live-chat-toggle'));
    assert.ok(has(work(root), 'chat-open') && byClass(root, 'ax-live-scrim').length === 1);
    assert.ok(focused.includes('ax-headbtn ax-live-chat-close'), 'the keyboard goes to its ×');
    await key('Escape');
    assert.ok(!has(work(root), 'chat-open') && byClass(root, 'ax-live-scrim').length === 0);
    assert.strictEqual(focused[focused.length - 1], 'chat button', 'and back to Chat when it closes (not <body>)');
    await click(one(root, 'ax-live-chat-toggle'));
    await click(one(root, 'ax-live-scrim'));
    assert.ok(!has(work(root), 'chat-open'));
    // Preview here adds the phone as a column (css) — the chat drawer still opens; Esc: chat, then phone
    await click(button(one(root, 'ax-live-compose'), 'Preview'));
    await click(one(root, 'ax-live-chat-toggle'));
    assert.ok(has(work(root), 'chat-open') && has(work(root), 'phone-open'));
    await key('Escape');
    assert.ok(!has(work(root), 'chat-open') && has(work(root), 'phone-open'), 'the chat first');
    await key('Escape');
    assert.ok(!has(work(root), 'phone-open'), 'then the preview');
    await act(async () => { r.unmount(); });

    // 1300: the chat has a column — until Preview takes it; then Chat is in the head and opens it
    WORK_W = 1300;
    r = await mount();
    root = r.root;
    await click(one(root, 'ax-live-chat-toggle'));
    assert.ok(!has(work(root), 'chat-open'), 'nothing to open: the chat is on screen');
    await click(button(one(root, 'ax-live-compose'), 'Preview'));
    assert.ok(has(work(root), 'phone-open') && has(one(root, 'ax-live-chat-toggle'), 'with-phone'), 'the head shows Chat (css/live.css)');
    await click(one(root, 'ax-live-chat-toggle'));
    assert.ok(has(work(root), 'chat-open'), 'it used to be hidden with no way to read it');
    // closing Preview gives the chat its column back — not an open drawer nobody sees, eating Esc
    await click(button(one(root, 'ax-live-compose'), 'Preview'));
    assert.ok(!has(work(root), 'chat-open') && !has(work(root), 'phone-open'));
    await act(async () => { r.unmount(); });

    // 1600: everything has a column
    WORK_W = 1600;
    r = await mount();
    root = r.root;
    await click(button(one(root, 'ax-live-compose'), 'Preview'));
    await click(one(root, 'ax-live-chat-toggle'));
    assert.ok(!has(work(root), 'phone-open') && !has(work(root), 'chat-open'));
    await act(async () => { r.unmount(); });
    WORK_W = 1300; document.activeElement = null;
    assert.deepStrictEqual([[700, true], [1000, false], [1139, false], [1140, false], [1300, true], [1559, true], [1560, true]].map(([w, p]) => Live.chatIsDrawer(w, p)),
      [false, true, true, false, true, true, false]);
  });

  await t('the pure rules: problems, shapes, blanks', async () => {
    const d = (o) => ({ ...Live.BLANK, ...o });
    assert.strictEqual(Live.cardProblem(d({ reference: 'John 1:1', text: 'In the beginning' })), '');
    assert.strictEqual(Live.cardProblem(d({ type: 'informative', title: 'Hi', destination: 'Give' })), 'The button needs a label, like “Give now” — or choose No button.');
    assert.strictEqual(Live.cardProblem(d({ type: 'poll', question: '', options: ['a', 'b'] })), 'A poll needs a question.');
    assert.deepStrictEqual(Live.buildCard(d({ type: 'informative', title: ' Hi ', buttonLabel: 'Stale', destination: '' }), 'i'), { id: 'i', type: 'informative', title: 'Hi', body: '', buttonLabel: '', destination: '' });
    assert.ok(Live.isBlank(d({ title: 'only on another kind' })), 'blank means the kind that is picked');
    assert.deepStrictEqual(Live.draftOf({ type: 'poll', question: 'Q', options: ['one'] }).options, ['one', ''], 'a loaded poll always has two answer boxes');
    assert.strictEqual(Live.detailOf(TEMPLATES[2]), 'Announcement · button: Give');
    assert.strictEqual(Live.detailOf(TEMPLATES[1]), 'Poll · 3 answers');
    assert.strictEqual(Live.fingerprint({ id: 'a', type: 'x', b: 1 }), Live.fingerprint({ b: 1, type: 'x', id: 'z' }), 'the same card whatever its id or key order');
    assert.strictEqual(Live.who({ user: 'U' }), 'U');
    assert.strictEqual(Live.who({}), 'Guest');
    assert.strictEqual(Live.clock({}), '');
    assert.deepStrictEqual([d({}), d({ reference: 'J' }), d({ type: 'informative' }), d({ type: 'informative', title: 'T', destination: 'Give' }),
      d({ type: 'poll', question: 'Q', options: ['a', ''] }), d({ type: 'poll', question: 'Q', options: ['a', 'b'] })].map(Live.problemField),
    ['ax-live-ref', 'ax-live-verse', 'ax-live-atitle', 'ax-live-blabel', 'ax-live-a2', '']);
  });

  await t('live.css: the app’s own numbers (MediaPlayer.js), the ax- prefix, no !important, the control-room widths', async () => {
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/live.css'), 'utf8');
    assert.ok(!/!important/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no !important (the header comment names the rule)');
    const classes = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c));
    assert.ok(classes.length > 50);
    const STATES = ['on', 'phone-open', 'chat-open', 'with-phone', 'informative', 'poll', 'q', 'plain', 'ok', 'held', 'editing', 'title', 'joined', 'bible'];
    assert.deepStrictEqual([...new Set(classes.filter((c) => !c.startsWith('ax-') && !STATES.includes(c)))], [], 'every class is ax- (or a state on one)');
    const src = fs.readFileSync(path.join(APP, 'screens/MediaPlayer.js'), 'utf8');
    const rule = (sel) => { const m = css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`)); assert.ok(m, `${sel} in live.css`); return m[1]; };
    const style = (name) => { const m = src.match(new RegExp(`\\n\\s*${name}:\\s*\\{([\\s\\S]*?)\\}`)); assert.ok(m, `${name} in MediaPlayer.js`); return m[1]; };
    const num = (block, prop) => { const m = block.match(new RegExp(`${prop}:\\s*([\\d.]+)`)); return m ? Number(m[1]) : null; };
    // the live service's own screen (components/LiveOverlay.js) and its badge (components/LiveBadge.js)
    const ov = fs.readFileSync(path.join(APP, 'components/LiveOverlay.js'), 'utf8');
    const ovStyle = (name) => { const m = ov.match(new RegExp(`\\n\\s*${name}:\\s*\\{([\\s\\S]*?)\\}`)); assert.ok(m, `${name} in LiveOverlay.js`); return m[1]; };
    const lb = fs.readFileSync(path.join(APP, 'components/LiveBadge.js'), 'utf8');
    const px = (block, prop) => { const m = block.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)px`)); return m ? Number(m[1]) : null; };
    // where the card sits: 20 in either side, 12 above the comment row — the row's top is insets.bottom
    // (34 on this phone) + 8 + its 48 (LiveOverlay composerTop), so the card's foot is 102 up
    assert.ok(/verseCardWrap:\s*\{\s*position: 'absolute', left: 20, right: 20 \}/.test(src));
    assert.ok(/\{ bottom: composerTop\(insets, isLandscape\) \+ 12, zIndex: 1000 \}/.test(src));
    assert.ok(/export const composerTop = \(insets, landscape\) => \(landscape \? Math\.max\(insets\.bottom, 12\) : insets\.bottom\) \+ 8 \+ ROW_H;/.test(ov) && /const ROW_H  = 48;/.test(ov));
    assert.ok(/padding: 0 16px 42px/.test(rule('.ax-live-bottom')) && /height: 48px/.test(rule('.ax-live-field')) && /margin: 0 4px 12px/.test(rule('.ax-live-cardwrap')),
      '42 under the row, the row 48, the card 12 above it and 4 more in than the row (20 from the edge)');
    // the card, its badge, its words, the button and a poll's answers
    const vc = style('verseCard');
    assert.deepStrictEqual([num(vc, 'borderRadius'), num(vc, 'padding')], [px(rule('.ax-live-card'), 'border-radius'), px(rule('.ax-live-card'), 'padding')]);
    assert.ok(/rgba\(18,18,18,0\.96\)/.test(vc.replace(/\s/g, '')) && /rgba\(18, 18, 18, 0\.96\)/.test(rule('.ax-live-card')));
    assert.strictEqual(num(style('verseCardTop'), 'marginBottom'), px(rule('.ax-live-card-top'), 'margin-bottom'));
    const badge = style('verseCardBadgeText');
    assert.deepStrictEqual([num(badge, 'fontSize'), num(badge, 'letterSpacing')], [px(rule('.ax-live-badge > span'), 'font-size'), px(rule('.ax-live-badge > span'), 'letter-spacing')]);
    const ref = style('verseCardRef');
    assert.deepStrictEqual([num(ref, 'fontSize'), num(ref, 'marginBottom')], [px(rule('.ax-live-ref'), 'font-size'), px(rule('.ax-live-ref'), 'margin-bottom')]);
    const text = style('verseCardText');
    assert.deepStrictEqual([num(text, 'fontSize'), num(text, 'lineHeight'), num(text, 'marginBottom')],
      [px(rule('.ax-live-text'), 'font-size'), px(rule('.ax-live-text'), 'line-height'), px(rule('.ax-live-text'), 'margin-bottom')]);
    // italic in the app's style, but no italic Geist is loaded (App.js FONTS) and iOS never slants a
    // face that has none — an iPhone draws the verse upright, so the browser mustn't fake a slant
    assert.ok(/fontStyle: 'italic'/.test(text) && /font-style: italic/.test(rule('.ax-live-text')));
    assert.ok(/font-synthesis: none/.test(rule('.ax-live-text')), 'upright, as on the iPhone');
    const appJs = fs.readFileSync(path.join(APP, 'App.js'), 'utf8');
    assert.ok(/const FONTS = \{[^}]*Geist_400Regular/.test(appJs) && !/Geist_\d+\w*_Italic/.test(appJs), 'the app still loads no italic Geist');
    // who's watching (LiveOverlay viewers, viewersTxt) and the LIVE badge (LiveBadge.js)
    assert.strictEqual(num(ovStyle('viewers'), 'gap'), px(rule('.ax-live-viewers'), 'gap'));
    assert.strictEqual(num(ovStyle('viewersTxt'), 'fontSize'), px(rule('.ax-live-viewers-n'), 'font-size'));
    assert.ok(/viewers != null \? \(/.test(ov), 'the app draws the count while it has one');
    assert.ok(/export const LIVE_RED = '#D53E28';/.test(lb) && /background: #D53E28/.test(rule('.ax-live-livebadge')));
    const lbs = lb.slice(lb.indexOf('const s = StyleSheet.create'));
    assert.ok(/borderRadius: 8,/.test(lbs) && /paddingHorizontal: 9, paddingVertical: 4, gap: 5/.test(lbs) && /padding: 4px 9px; border-radius: 8px/.test(rule('.ax-live-livebadge')));
    assert.ok(/fontSize: 12/.test(lbs) && /font-size: 12px/.test(rule('.ax-live-livebadge')));
    // a card's 12 seconds; a recorded message's controls still fade — the live screen never does
    assert.ok(/verseTimer\.current = setTimeout\(\(\) => dismissCard\(\), 12000\)/.test(src) && Live.CARD_SECONDS === 12);
    assert.ok(/ctrlTimer\.current = setTimeout\(hideControls, 3500\)/.test(src));
    assert.ok(!/ctrlOpacity|hideControls/.test(ov), 'the live screen stays up');
    // the chat's bubbles, and the comment row
    const bub = ovStyle('bubble');
    assert.deepStrictEqual([num(bub, 'marginTop'), num(bub, 'borderRadius'), num(bub, 'paddingHorizontal'), num(bub, 'paddingVertical')], [8, 16, 14, 9]);
    assert.ok(/margin-top: 8px; padding: 9px 14px; border-radius: 16px; background: rgba\(28, 24, 22, 0\.78\)/.test(rule('.ax-live-bubble')) && /const GLASS      = 'rgba\(28,24,22,0\.78\)';/.test(ov));
    assert.deepStrictEqual([num(ovStyle('who'), 'fontSize'), num(ovStyle('who'), 'lineHeight')], [px(rule('.ax-live-who'), 'font-size'), px(rule('.ax-live-who'), 'line-height')]);
    assert.deepStrictEqual([num(ovStyle('said'), 'fontSize'), num(ovStyle('said'), 'lineHeight')], [px(rule('.ax-live-said'), 'font-size'), px(rule('.ax-live-said'), 'line-height')]);
    assert.ok(/borderRadius: 16, paddingHorizontal: 16/.test(ovStyle('field')) && /border-radius: 16px/.test(rule('.ax-live-field')));
    assert.ok(/const GLASS_BTN  = 'rgba\(28,24,22,0\.86\)';/.test(ov) && /rgba\(28, 24, 22, 0\.86\)/.test(rule('.ax-live-round')));
    assert.ok(/<MaterialCommunityIcons name="book-open-variant" size=\{24\} color=\{ORANGE\} \/>/.test(ov) && /const ORANGE = '#F05A0F';/.test(ov) && /color: #F05A0F/.test(rule('.ax-live-round.bible')));
    const note = style('verseCardNote');
    assert.deepStrictEqual([num(note, 'fontSize'), num(note, 'marginBottom')], [px(rule('.ax-live-note'), 'font-size'), px(rule('.ax-live-note'), 'margin-bottom')]);
    const info = style('infoActionBtn');
    assert.ok(/#3b82f6/.test(info) && /#3b82f6/.test(rule('.ax-live-infobtn')));
    assert.strictEqual(num(info, 'borderRadius'), px(rule('.ax-live-infobtn'), 'border-radius'));
    assert.strictEqual(num(style('infoActionBtnTxt'), 'fontSize'), px(rule('.ax-live-infobtn > span'), 'font-size'));
    const opt = style('pollOption');
    assert.deepStrictEqual([num(opt, 'borderRadius'), num(opt, 'padding'), num(opt, 'marginBottom')],
      [px(rule('.ax-live-opt'), 'border-radius'), px(rule('.ax-live-opt'), 'padding'), px(rule('.ax-live-opt'), 'margin-bottom')]);
    assert.strictEqual(num(style('pollOptionTxt'), 'fontSize'), px(rule('.ax-live-opt > span'), 'font-size'));
    // the badge colours and words, as the app has them
    for (const [c, word] of [['#3b82f6', 'INFO'], ['#a855f7', 'POLL'], ['#E84A0A', 'VERSE']]) {
      assert.ok(src.includes(c) && src.includes(`>${word}<`), `${word} in the app`);
      assert.ok(css.includes(c), `${c} in live.css`);
    }
    assert.ok(src.includes('Tap to vote'));
    // the live screen: the title's size, the top's and the foot's padding, the shades
    assert.deepStrictEqual([num(ovStyle('title'), 'fontSize'), num(ovStyle('title'), 'lineHeight')], [px(rule('.ax-live-title'), 'font-size'), px(rule('.ax-live-title'), 'line-height')]);
    assert.ok(/paddingTop: landscape \? 12 : insets\.top \+ 6, paddingLeft: pad, paddingRight: padR - 10/.test(ov) && /padding: 65px 6px 0 16px/.test(rule('.ax-live-top')), 'insets.top (59) + 6; 16 in, the ✕ box 6');
    assert.ok(/const bottomPad = \(kb \|\| \(landscape \? Math\.max\(insets\.bottom, 12\) : insets\.bottom\)\) \+ 8;/.test(ov), 'insets.bottom (34) + 8 = 42 under the row');
    assert.ok(/colors=\{\['rgba\(0,0,0,0\.55\)', 'rgba\(0,0,0,0\)'\]\}/.test(ov) && /height: \(landscape \? 12 : insets\.top\) \+ 150/.test(ov));
    assert.ok(/height: 209px/.test(rule('.ax-live-shade-top')) && /rgba\(0, 0, 0, 0\.55\)/.test(rule('.ax-live-shade-top')));
    assert.ok(/colors=\{\['rgba\(0,0,0,0\)', 'rgba\(0,0,0,0\.6\)'\]\}/.test(ov) && /height: Math\.round\(height \* 0\.45\)/.test(ov));
    assert.ok(/height: 45%/.test(rule('.ax-live-shade-bottom')) && /rgba\(0, 0, 0, 0\.6\)/.test(rule('.ax-live-shade-bottom')));
    // the player hides the status bar and the dock and the profile button
    assert.ok(/<StatusBar barStyle="light-content" hidden=\{!pipMode && !sheetOpen && !listening\} \/>/.test(src));
    assert.ok(/isPlayerOpen && !isPip/.test(fs.readFileSync(path.join(APP, 'components/ProfileButton.js'), 'utf8')));
    // the control room's widths: the phone's column at 1560, two columns under 1140, one under 760 —
    // and the chat a drawer from 1140 to 1559 while Preview has its column
    const live = fs.readFileSync(path.join(PILLAR, 'src/pages/app/LivePage.jsx'), 'utf8');
    assert.deepStrictEqual([Live.ONE_COLUMN, Live.TWO_COLUMNS, Live.PHONE_COLUMN], [760, 1140, 1560]);
    assert.ok(css.includes('@container page (min-width: 1560px)') && css.includes('@container page (max-width: 1139px)') && css.includes('@container page (max-width: 759px)'));
    assert.ok(css.includes('@container page (min-width: 1140px) and (max-width: 1559px)'));
    const mid = css.slice(css.indexOf('@container page (min-width: 1140px) and (max-width: 1559px)'));
    assert.ok(/\.ax-work\.ax-live\.phone-open > \.ax-live-chat \{[^}]*position: absolute/.test(mid) && /\.ax-live-chat-toggle\.with-phone/.test(mid), 'Preview makes the chat a drawer, not gone');
    assert.ok(!/phone-open > \.ax-live-(stream|show)[^{]*\{[^}]*display: none/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'Preview never hides the stream or the show pane');
    assert.ok(!/LiveChatOverlay/.test(css), 'the chat overlay isn\'t drawn, so the header doesn\'t claim it');
    // house rules in the page: no inline static style (the one inline value is a bar's width), no import.meta
    assert.ok(!/import\.meta/.test(live));
    assert.deepStrictEqual([...live.matchAll(/style=\{\{(.*?)\}\}/g)].map((m) => m[1].trim()), ['width: `${r.pct}%`']);
  });

  console.error = oe;
  const bad = errs.filter((m) => !/react-test-renderer is deprecated|not wrapped in act/.test(m));
  if (bad.length) { console.log(bad.join('\n')); throw new Error(`${bad.length} React error(s)`); }
  console.log(`\nlive-redesign: ${ok} passed`);
  process.exit(0);
})().catch((e) => { realError(e); process.exit(1); });
