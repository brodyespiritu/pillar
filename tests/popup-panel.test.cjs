// Pillar → App → Notifications → Update popup (PopupPanel.jsx — TESTING, goes with the app's test kit),
// rendered with react-test-renderer (user, 2026-09-24: "allow me to post a popup card to all users that
// looks like the give popup. I should be able to type anything, have bullet points, dashes, bold font,
// italics, underline, etc." … "It needs to be orange, similar to the orange background in settings").
//
// The tab and its address, the formatting toolbar and what it asks the browser to do, a paste that keeps
// only the popup's formatting, the orange card in the phone as the app draws it (BethesdaApp
// components/testkit/UpdatePopup.js), posting / changing / taking down — each with Undo, never "are you
// sure" — the draft kept, and the words when the SQL hasn't been run. The converter itself is
// popups.test.mjs; the database, supabase/tests/test-popups.test.mjs.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const OUT = path.join(__dirname, '.build-popup'); fs.mkdirSync(OUT, { recursive: true });
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
const session = new Map();
globalThis.window = {
  location: { origin: 'https://pillar.example' },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  dispatchEvent: (e) => { for (const fn of [...(listeners[e.type] || [])]) fn(e); return true; },
  sessionStorage: { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => { session.set(k, String(v)); }, removeItem: (k) => { session.delete(k); } },
  getSelection: () => ({ anchorNode: null }),
};
// what the toolbar asks of the browser (a contenteditable's formatting is the browser's own)
const commands = [];
const docListeners = {};
globalThis.document = {
  activeElement: null,
  querySelector: () => null,
  createElement: (tag) => ({ tagName: tag }),
  getElementById: () => null,
  head: { appendChild: () => {} },
  addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (docListeners[type]) docListeners[type].delete(fn); },
  execCommand: (name, ui, arg) => { commands.push(arg === undefined ? [name] : [name, arg]); return true; },
  queryCommandState: () => false,
};
const guarded = () => (listeners.beforeunload ? listeners.beforeunload.size : 0);

const React = require(path.join(DEPS, 'react'));
const h = React.createElement;
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
stub('../../lib/dialog', { confirmDialog: async () => { throw new Error('the Update popup never asks first — it offers Undo'); } });
stub('./AppShell', { __esModule: true, default: ({ title, subtitle, tabs, children }) => h('div', { className: 'shell', 'data-title': title, 'data-sub': subtitle, 'data-tab': tabs && tabs.value },
  tabs ? tabs.options.map((o) => h('button', { key: o.key, type: 'button', role: 'radio', 'aria-checked': tabs.value === o.key, onClick: () => tabs.onChange(o.key) }, o.label)) : null, children) });
stub('./SettingsPage', { AppHome: () => h('div', { className: 'ax-set-home' }) });
stub('../../lib/appApi', { getPushCount: async () => ({ count: 214 }), sendNotification: async () => ({ ok: true }) });
let query = new URLSearchParams();
const addresses = [];
stub('react-router-dom', { useSearchParams: () => [query, (next, opts) => { query = new URLSearchParams(next); addresses.push([String(query), opts]); rerender(); }] });

// ── Supabase: app_test_popups and its four functions ──
const db = {
  rows: [
    { id: 'up-1', title: 'Recent updates', body: { v: 1, blocks: [{ t: 'p', s: [{ x: 'The Watch page is faster.' }] }, { t: 'bullet', s: [{ x: 'Journal', b: 1 }] }] }, live: true, posted_at: '2026-09-24T15:00:00Z' },
    { id: 'old-1', title: 'Last week', body: { v: 1, blocks: [{ t: 'dash', s: [{ x: 'Bible versions' }] }] }, live: false, posted_at: '2026-09-17T15:00:00Z' },
  ],
  missing: false, calls: [], n: 0,
};
const MISSING = { message: 'relation "public.app_test_popups" does not exist', code: '42P01' };
stub('./supabase', { supabase: {
  from: () => {
    const chain = { select: () => chain, order: () => chain, limit: () => chain,
      then: (res, rej) => Promise.resolve(db.missing ? { data: null, error: MISSING }
        : { data: [...db.rows].sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at))).map((r) => ({ ...r })), error: null }).then(res, rej) };
    return chain;
  },
  rpc: async (name, args) => {
    db.calls.push({ name, args });
    if (db.missing) return { data: null, error: { message: `Could not find the function public.${name} in the schema cache` } };
    const at = new Date(Date.UTC(2026, 8, 24, 16, db.n++)).toISOString();
    if (name === 'app_test_popup_post') {
      db.rows.forEach((r) => { r.live = false; });
      const id = `new-${db.n}`;
      db.rows.push({ id, title: args.p_title, body: args.p_body, live: true, posted_at: at });
      return { data: id, error: null };
    }
    if (name === 'app_test_popup_edit') {
      const r = db.rows.find((x) => x.id === args.p_id && x.live);
      if (!r) return { data: null, error: { message: 'That popup isn’t up any more.' } };
      Object.assign(r, { title: args.p_title, body: args.p_body });
      return { data: null, error: null };
    }
    if (name === 'app_test_popup_take_down') { db.rows.forEach((r) => { r.live = false; }); return { data: null, error: null }; }
    if (name === 'app_test_popup_restore') {
      if (db.rows.some((r) => r.live && r.id !== args.p_id)) return { data: null, error: { message: 'Another popup is up now — take it down first.' } };
      db.rows.find((r) => r.id === args.p_id).live = true;
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'unknown' } };
  },
} });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
STUBS['../../lib/testPopups'] = xform(path.join(PILLAR, 'src/lib/testPopups.js'), 'testPopups.cjs');
const L = require(STUBS['../../lib/testPopups']);
STUBS['./PopupPanel'] = xform(path.join(PILLAR, 'src/pages/app/PopupPanel.jsx'), 'PopupPanel.cjs');
// the Notification tab's "When it's tapped" (src/lib/pushTargets.js — pushtargets.test.mjs): nothing to offer here
stub('./appApi', { getAnnouncements: async () => [] });
stub('./homeCards', { listCards: async () => [], isLive: () => false });
STUBS['../../lib/pushTargets'] = xform(path.join(PILLAR, 'src/lib/pushTargets.js'), 'pushTargets.cjs');
const Notify = require(xform(path.join(PILLAR, 'src/pages/app/NotificationsPage.jsx'), 'NotificationsPage.cjs'));
const { act } = React;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the renderer's refs: the word box is a contenteditable the test writes into as a browser would
const box = { innerHTML: '', focused: 0, lists: [] };
const focused = [];
const nodeMock = (el) => {
  if (el.props.contentEditable) {
    return Object.assign(box, {
      focus: () => { box.focused++; },
      contains: () => true,
      querySelector: (sel) => (sel === 'li' && /<li/.test(box.innerHTML) ? {} : null),
    });
  }
  return { style: {}, isConnected: true, focus: () => { focused.push(el.props.id || el.type); }, getBoundingClientRect: () => ({ width: 300 }) };
};
let r;
let rerender = () => {};
const render = async (el) => {
  let out; await act(async () => { out = TR.create(el, { createNodeMock: nodeMock }); }); await act(async () => { await wait(0); });
  rerender = () => { out.update(h(el.type, el.props)); };   // a new element: the page reads the address again
  return out;
};
const cls = (n) => String((n.props && n.props.className) || '').split(' ');
const byClass = (root, c) => root.findAll((n) => typeof n.type === 'string' && cls(n).includes(c));
const one = (root, c) => { const all = byClass(root, c); assert.ok(all.length, `.${c} is there`); return all[0]; };
const words = (inst) => (typeof inst === 'string' ? inst : (inst.children || []).map(words).join(''));
const buttonNamed = (root, name) => root.find((n) => n.type === 'button' && words(n).trim() === name);
const tool = (root, label) => root.find((n) => n.type === 'button' && n.props['aria-label'] === label);
const titleBox = () => r.root.find((n) => n.type === 'input' && n.props.id === 'ax-pp-title');
const area = () => r.root.find((n) => n.type === 'div' && n.props.contentEditable);
const settle = () => act(async () => { await wait(0); });
// typing into the word box: the browser changes its HTML, then fires input
const type = async (html) => { box.innerHTML = html; await act(async () => { area().props.onInput(); }); };
const key = (k, extra = {}) => {
  const e = { type: 'keydown', key: k, target: { closest: () => null }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  window.dispatchEvent(e);
  return e;
};
const toast = () => byClass(r.root, 'ax-toast')[0];

(async () => {
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

  console.log('\n── the tab ──');
  r = await render(h(Notify.default));

  await t('Notifications has two tabs; Update popup is ?tab=popup, and a reload lands back on it', async () => {
    const shell = r.root.findByProps({ className: 'shell' });
    assert.deepStrictEqual(shell.children.filter((n) => n.type === 'button' && n.props.role === 'radio').map(words), ['Notification', 'Update popup'], 'the page’s tabs');
    assert.strictEqual(shell.props['data-tab'], 'push');
    await act(async () => { buttonNamed(r.root, 'Update popup').props.onClick(); });
    await settle();
    assert.deepStrictEqual(addresses.at(-1), ['tab=popup', { replace: true }], 'in the address, without a Back step for each click');
    assert.strictEqual(r.root.findByProps({ className: 'shell' }).props['data-sub'], 'Testing · a card every phone shows once, in the test kit’s orange.');
    assert.ok(byClass(r.root, 'ax-pp').length && !byClass(r.root, 'ax-nt').length, 'the popup’s workspace, not the lock screen');
  });

  console.log('\n── what’s on phones now ──');

  await t('the one that’s up: its title, the start of its words, when — with Edit and Take it down beside it', async () => {
    const live = one(r.root, 'ax-pp-live');
    assert.strictEqual(words(one(live, 'ax-pp-live-title')), 'Recent updates');
    assert.strictEqual(words(one(live, 'ax-pp-live-sum')), 'The Watch page is faster.');
    assert.match(words(one(live, 'ax-pp-live-when')), /^Up since Sep 24/);
    assert.ok(buttonNamed(live, 'Edit') && buttonNamed(live, 'Take it down'));
    assert.match(words(one(r.root, 'ax-save')), /“Recent updates” is up on phones — since Sep 24/);
    const earlier = one(r.root, 'ax-pp-earlier');
    assert.deepStrictEqual(byClass(earlier, 'ax-pp-earlier-title').map(words), ['Last week']);
  });

  await t('nothing typed: the phone shows the one that’s up, as phones show it now', async () => {
    const card = one(r.root, 'ax-pp-card');
    assert.strictEqual(words(one(card, 'ax-pp-title')), 'Recent updates');
    assert.ok(words(one(card, 'ax-pp-body')).includes('The Watch page is faster.'));
    assert.strictEqual(byClass(r.root, 'ax-set-flag').length, 0, 'it IS on phones');
  });

  console.log('\n── the words and their formatting ──');

  await t('a toolbar every word processor has: B I U S, a heading, three lists, clear — shortcuts in the tooltips', async () => {
    const bar = r.root.find((n) => n.props.role === 'toolbar');
    const labels = bar.findAll((n) => n.type === 'button').map((b) => b.props['aria-label']);
    assert.deepStrictEqual(labels, ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Heading', 'Bullet points', 'Dashes', 'Numbered list', 'Clear formatting']);
    assert.match(tool(r.root, 'Bold').props.title, /^Bold \((⌘|Ctrl\+)B\)$/);
    // a click on a button never takes the picked words away
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    tool(r.root, 'Italic').props.onMouseDown(e);
    assert.ok(e.defaultPrevented);
  });

  await t('each button formats in place (the browser’s own commands), and the draft follows', async () => {
    commands.length = 0;
    await act(async () => { tool(r.root, 'Bold').props.onClick(); });
    await act(async () => { tool(r.root, 'Underline').props.onClick(); });
    await act(async () => { tool(r.root, 'Strikethrough').props.onClick(); });
    await act(async () => { tool(r.root, 'Heading').props.onClick(); });
    await act(async () => { tool(r.root, 'Numbered list').props.onClick(); });
    await act(async () => { tool(r.root, 'Clear formatting').props.onClick(); });
    assert.deepStrictEqual(commands.filter((c) => c[0] !== 'styleWithCSS'),
      [['bold'], ['underline'], ['strikeThrough'], ['formatBlock', '<h3>'], ['insertOrderedList'], ['removeFormat']]);
    assert.ok(box.focused >= 6, 'the words keep the cursor');
  });

  await t('typed words show on the phone as typed — bold, italic, underline, strike, a heading, bullets, dashes, numbers', async () => {
    await act(async () => { titleBox().props.onChange({ target: { value: 'New this week' } }); });
    await type('<h3>Watch</h3><div>It’s <b>faster</b>, <i>simpler</i> and <u>clearer</u>. <s>Slow</s></div><div><br></div>'
      + '<ul><li>Journal</li><li>Verses</li></ul><ul class="ax-rt-dash"><li>fixed</li></ul><ol><li>Open</li><li>Tap</li></ol>');
    const card = one(r.root, 'ax-pp-card');
    assert.strictEqual(words(one(card, 'ax-pp-title')), 'New this week');
    assert.strictEqual(words(one(card, 'ax-pp-h')), 'Watch');
    assert.deepStrictEqual(['ax-pp-b', 'ax-pp-i', 'ax-pp-u', 'ax-pp-k'].map((c) => words(one(card, c))), ['faster', 'simpler', 'clearer', 'Slow']);
    assert.deepStrictEqual(byClass(card, 'ax-pp-mark').map(words), ['•', '•', '–', '1.', '2.']);
    assert.strictEqual(byClass(card, 'ax-pp-gap').length, 1, 'the empty line');
    assert.ok(byClass(r.root, 'ax-set-flag').length, 'marked Not on phones until it’s posted');
    assert.ok(words(r.root).includes('13/80'));
    assert.ok(words(r.root).includes(`${L.docLength(L.htmlToDoc(box.innerHTML))}/3000`));
  });

  await t('a paste keeps its words and the popup’s formatting — never a script, a style or a link', async () => {
    commands.length = 0;
    const e = { preventDefault() { this.done = true; }, clipboardData: { getData: (k) => (k === 'text/html'
      ? '<p style="color:red"><b>Hi</b> <a href="javascript:x">there</a><script>steal()</script></p>' : 'Hi there') } };
    await act(async () => { area().props.onPaste(e); });
    assert.ok(e.done, 'the browser’s own paste is stopped');
    assert.deepStrictEqual(commands, [['insertHTML', '<div><b>Hi</b> there</div>']]);
    commands.length = 0;
    const plain = { preventDefault() {}, clipboardData: { getData: (k) => (k === 'text/html' ? '' : '- one\n- two') } };
    await act(async () => { area().props.onPaste(plain); });
    assert.deepStrictEqual(commands, [['insertHTML', '<ul class="ax-rt-dash"><li>one</li><li>two</li></ul>']], 'typed dashes become a dash list');
  });

  await t('the draft is kept while they’re elsewhere in Pillar, and closing the tab with one typed asks first', async () => {
    assert.ok(guarded() >= 1);
    const kept = JSON.parse(session.get('pillar.app.popup.draft'));
    assert.strictEqual(kept.title, 'New this week');
    assert.strictEqual(kept.doc.blocks[0].t, 'h');
    await act(async () => { r.unmount(); });
    assert.strictEqual(guarded(), 0);
    box.innerHTML = '';
    r = await render(h(Notify.default));
    assert.strictEqual(titleBox().props.value, 'New this week', 'back where they left it');
    assert.ok(box.innerHTML.startsWith('<h3>Watch</h3>'), 'the words back in the box, formatted');
  });

  console.log('\n── posting, changing, taking down ──');

  await t('Post: every phone, in place of the one that was up — no “are you sure”, an Undo instead', async () => {
    db.calls.length = 0;
    assert.ok(words(r.root).includes('Replaces “Recent updates”. Every phone shows the new one once.'), 'what posting does, beside the button');
    key('Enter', { metaKey: true });
    await settle(); await settle();
    assert.strictEqual(db.calls[0].name, 'app_test_popup_post');
    assert.strictEqual(db.calls[0].args.p_title, 'New this week');
    assert.deepStrictEqual(db.calls[0].args.p_body.blocks.map((x) => x.t), ['h', 'p', 'p', 'bullet', 'bullet', 'dash', 'number', 'number'], 'the document, never HTML');
    assert.deepStrictEqual(db.calls[0].args.p_body.blocks[1].s[1], { x: 'faster', b: 1 });
    assert.ok(words(one(r.root, 'ax-note')).includes('Up on every phone.'));
    assert.strictEqual(words(toast()).replace('Undo', ''), 'Posted — “Recent updates” came down.');
    assert.strictEqual(titleBox().props.value, '', 'the form is clear for the next');
    assert.ok(!session.has('pillar.app.popup.draft'));
    assert.strictEqual(words(one(one(r.root, 'ax-pp-live'), 'ax-pp-live-title')), 'New this week');
  });

  await t('Undo: the new one down, the old one back — the same one, so phones that put it away aren’t shown it again', async () => {
    db.calls.length = 0;
    await act(async () => { buttonNamed(toast(), 'Undo').props.onClick(); });
    await settle(); await settle();
    assert.deepStrictEqual(db.calls.map((c) => [c.name, c.args && c.args.p_id]), [['app_test_popup_take_down', undefined], ['app_test_popup_restore', 'up-1']]);
    assert.strictEqual(words(one(one(r.root, 'ax-pp-live'), 'ax-pp-live-title')), 'Recent updates');
  });

  await t('Edit: its words in the box, Update it changes it where it is', async () => {
    await act(async () => { buttonNamed(one(r.root, 'ax-pp-live'), 'Edit').props.onClick(); });
    assert.strictEqual(titleBox().props.value, 'Recent updates');
    assert.strictEqual(box.innerHTML, '<div>The Watch page is faster.</div><ul><li><b>Journal</b></li></ul>');
    assert.ok(buttonNamed(r.root, 'Cancel') && buttonNamed(r.root, 'Post as new') && buttonNamed(r.root, 'Update it'));
    assert.ok(words(r.root).includes('Changing the one that’s up'));
    db.calls.length = 0;
    await act(async () => { titleBox().props.onChange({ target: { value: 'Recent updates!' } }); });
    await act(async () => { buttonNamed(r.root, 'Update it').props.onClick(); });
    await settle();
    assert.deepStrictEqual(db.calls.map((c) => [c.name, c.args.p_id, c.args.p_title]), [['app_test_popup_edit', 'up-1', 'Recent updates!']]);
    assert.ok(words(one(r.root, 'ax-note')).includes('Changed on phones.'));
    assert.ok(!byClass(r.root, 'ax-pp-live').length || words(one(r.root, 'ax-pp-live-title')) === 'Recent updates!');
  });

  await t('Take it down: off every phone at once, with Undo', async () => {
    db.calls.length = 0;
    await act(async () => { buttonNamed(one(r.root, 'ax-pp-live'), 'Take it down').props.onClick(); });
    await settle();
    assert.deepStrictEqual(db.calls.map((c) => c.name), ['app_test_popup_take_down']);
    assert.strictEqual(words(toast()).replace('Undo', ''), '“Recent updates!” is off every phone.');
    assert.ok(words(one(r.root, 'ax-pp-none')).includes('Nothing is up.'));
    assert.match(words(one(r.root, 'ax-save')), /Nothing up on phones/);
    await act(async () => { buttonNamed(toast(), 'Undo').props.onClick(); });
    await settle(); await settle();
    assert.deepStrictEqual(db.calls.at(-1), { name: 'app_test_popup_restore', args: { p_id: 'up-1' } });
    assert.strictEqual(words(one(r.root, 'ax-pp-live-title')), 'Recent updates!');
  });

  await t('Use again: an earlier one’s words in the box, to post as a new one', async () => {
    const rows = one(r.root, 'ax-pp-earlier').findAll((n) => n.type === 'li');
    assert.deepStrictEqual(rows.map((li) => words(one(li, 'ax-pp-earlier-title'))), ['New this week', 'Last week'], 'the one just undone is kept too, newest first');
    await act(async () => { buttonNamed(rows[1], 'Use again').props.onClick(); });
    assert.strictEqual(titleBox().props.value, 'Last week');
    assert.strictEqual(box.innerHTML, '<ul class="ax-rt-dash"><li>Bible versions</li></ul>');
    assert.ok(buttonNamed(r.root, 'Post to every phone') && !byClass(r.root, 'ax-pp-send').some((n) => words(n).includes('Update it')), 'a new one, not an edit');
  });

  await t('a Post that can’t go says why (Hick) — never a silently dead button', async () => {
    await type('<div><br></div>');
    assert.ok(buttonNamed(r.root, 'Post to every phone').props.disabled);
    assert.ok(words(one(r.root, 'ax-nt-missing')).includes('Write what’s new too.'));
    await act(async () => { titleBox().props.onChange({ target: { value: '' } }); });
    await type('<div>Words</div>');
    assert.ok(words(one(r.root, 'ax-nt-missing')).includes('Give it a title too.'));
  });

  await t('before the SQL is run: it says which file to run', async () => {
    await act(async () => { r.unmount(); });
    db.missing = true;
    session.clear();
    r = await render(h(Notify.default));
    assert.ok(words(one(r.root, 'ax-alert')).includes('app-test-popups.sql'), words(one(r.root, 'ax-alert')));
    db.missing = false;
    await act(async () => { r.unmount(); });
  });

  console.log('\n── Pillar and the app agree ──');

  await t('the phone’s card is the app’s: the orange, the label, the bolt, Got it, 452 of words before they scroll', async () => {
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/popup.css'), 'utf8');
    const kit = fs.readFileSync(path.join(APP, 'components/testkit/TestingOnly.js'), 'utf8');
    const card = fs.readFileSync(path.join(APP, 'components/testkit/UpdatePopup.js'), 'utf8');
    assert.ok(kit.includes("light: { bg: '#FFF0E5', edge: '#F7B48A', ink: '#A94405' },") && kit.includes("const ORANGE = '#F2660C';"));
    assert.ok(css.includes('border: 1.5px solid #F7B48A; background: #FFF0E5;') && css.includes('color: #A94405;') && css.includes('color: #F2660C;'));
    assert.ok(card.includes("scrim:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)'") && css.includes('.ax-pa-scrim.ax-pp-scrim { background: rgba(0, 0, 0, 0.45); }'));
    assert.ok(card.includes('Math.max(160, height - 400)') && css.includes('max-height: 452px;'), 'an 852-point iPhone leaves the words 452');
    assert.ok(card.includes('<Feather name="zap"') && card.includes('<Feather name="tool"'));
    const panel = fs.readFileSync(path.join(PILLAR, 'src/pages/app/PopupPanel.jsx'), 'utf8');
    assert.ok(panel.includes('<PhoneIcon name="zap"') && panel.includes('<PhoneIcon name="tool"') && panel.includes('Got it'));
    assert.ok(!/style=\{/.test(panel), 'no inline styles');
    assert.ok(panel.includes("TESTING · goes when the app's test kit does"), 'marked for removal with the kit');
    // the app reads the same table the SQL makes, only the live one
    assert.ok(card.includes(".from('app_test_popups').select('id, title, body').eq('live', true).limit(1)"));
    const rich = fs.readFileSync(path.join(APP, 'components/testkit/RichText.js'), 'utf8');
    assert.ok(rich.includes("const KINDS = ['p', 'h', 'bullet', 'dash', 'number'];") && L.BLOCK_TYPES.join() === 'p,h,bullet,dash,number');
  });

  console.error = oe;
  const real = errs.filter((e) => !/act\(|not wrapped in act|react-test-renderer is deprecated/.test(e));
  if (real.length) { console.log(real.join('\n')); throw new Error('React warned while rendering'); }
  console.log(`\n${ok} update popup page checks passed`);
})().catch((e) => { console.log('  ✗', e.stack || e.message); process.exit(1); });   // (the lock screen's clock would keep it running)
