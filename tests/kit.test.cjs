// Pillar/src/pages/app/kit.jsx — the save-as-you-type machinery every App page stands on: a new
// row waits until there's something in it, saves once, never twice at the same time, never inserts
// twice, keeps what was typed during a save, saves what's left when the editor closes, and lets a
// failed save be tried again. Plus the list (keyboard and drag order) and Undo.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.build-kit'); fs.mkdirSync(OUT, { recursive: true });
const babel = require(path.join(DEPS, '@babel/core'));
const xform = (src, out) => { fs.writeFileSync(path.join(OUT, out), babel.transformFileSync(src, { babelrc: false, configFile: false,
  plugins: [path.join(DEPS, '@babel/plugin-transform-modules-commonjs'), [path.join(DEPS, '@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }]] }).code); return path.join(OUT, out); };
const STUBS = {};
const stub = (req, exp) => { const f = path.join(OUT, '__stubs__', req.replace(/[^\w.-]/g, '_') + '.js'); const m = new Module(f); m.filename = f; m.loaded = true; m.exports = exp; require.cache[f] = m; STUBS[req] = f; };
const reactDir = DEPS;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (STUBS[request]) return STUBS[request];
  if (request === 'react' || request.startsWith('react/') || request === 'react-test-renderer') return origResolve.call(this, request, { ...parent, paths: [reactDir] }, ...rest);
  return origResolve.call(this, request, parent, ...rest);
};
const React = require(path.join(reactDir, 'react'));
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
let answer = true;
stub('../../lib/dialog', { confirmDialog: async () => answer });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(reactDir, 'react-test-renderer'));
const kit = require(xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs'));
const { act } = React;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a pretend table
const table = [];
const calls = [];
let slow = 60;
let failNext = 0;
async function saveRow(form) {
  calls.push({ ...form });
  await wait(slow);
  if (failNext > 0) { failNext--; throw new Error('The database said no.'); }
  if (form.id) { const r = table.find((x) => x.id === form.id); Object.assign(r, form); return { ...r }; }
  const row = { ...form, id: `id${table.length + 1}` };
  table.push(row);
  return { ...row };
}

const formOf = (r) => ({ title: r.title || '', published: r.published === true });
let api = null;
let persist = null;

function Editor({ row }) {
  const f = formOf(row);
  const auto = kit.useAutosave({ value: f, savedJson: row._saved, ready: !!f.title.trim(), save: () => persist(row._key), delay: 40 });
  Editor.last = auto;
  return React.createElement('span', null, auto.status);
}
function Page({ show = true }) {
  const rows = kit.useRows(formOf);
  const queue = kit.useSaveQueue();
  api = rows;
  persist = (key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const form = formOf(r);
    try {
      const saved = await saveRow({ ...form, id: rows.idOf(key) });
      rows.saved(key, form, saved);
    } catch (e) { rows.failed(key, e.message); throw e; }
  });
  const list = rows.rows || [];
  return show && list[0] ? React.createElement(Editor, { key: list[0]._key, row: list[0] }) : null;
}

(async () => {
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };
  // React applies a change when its act() ends — so make the change, then let time pass
  const step = async (fn, ms = 0) => { await act(async () => { fn(); }); if (ms) await act(async () => { await wait(ms); }); };
  let r;
  await act(async () => { r = TR.create(React.createElement(Page)); });
  await act(async () => { api.load([]); });

  let key;
  await t('a new row waits until there’s something in it', async () => {
    await act(async () => { key = api.add({ title: '', published: false }); });
    await act(async () => { await wait(120); });
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(Editor.last.status, 'waiting');
  });

  await t('typing saves once, a moment after the last keystroke', async () => {
    for (const s of ['S', 'Su', 'Sup', 'Supp', 'Supper']) {
      await step(() => api.patch(key, { title: s }), 10);
    }
    assert.strictEqual(calls.length, 0, 'not while typing');
    await act(async () => { await wait(160); });
    assert.deepStrictEqual(calls, [{ title: 'Supper', published: false, id: null }]);
    assert.strictEqual(Editor.last.status, 'saved');
    assert.strictEqual(table.length, 1);
  });

  await t('a switch flipped during a save waits its turn, and updates — never a second insert', async () => {
    calls.length = 0;
    await act(async () => { key = api.add({ title: '', published: false }, { first: true }); });
    await step(() => api.patch(key, { title: 'Picnic' }), 50);   // its first save is now on its way
    assert.strictEqual(calls.length, 1);
    await step(() => { api.patch(key, { published: true }); persist(key); });   // the switch saves straight away
    await act(async () => { await wait(250); });
    assert.strictEqual(table.filter((x) => x.title === 'Picnic').length, 1, 'one row');
    assert.strictEqual(calls[0].id, null);
    assert.ok(calls.slice(1).every((c) => c.id === 'id2'), JSON.stringify(calls));
    assert.strictEqual(table.find((x) => x.title === 'Picnic').published, true);
    assert.strictEqual(Editor.last.status, 'saved');
  });

  await t('what’s typed during a save is saved straight after it', async () => {
    calls.length = 0;
    slow = 120;
    await step(() => api.patch(key, { title: 'Picnic at noon' }), 60);   // saving…
    await step(() => api.patch(key, { title: 'Picnic at noon, bring a chair' }), 30);
    assert.strictEqual(Editor.last.status, 'saving');
    await act(async () => { await wait(400); });
    slow = 60;
    assert.strictEqual(table.find((x) => x.id === 'id2').title, 'Picnic at noon, bring a chair');
    assert.strictEqual(calls.length, 2, JSON.stringify(calls));
    assert.strictEqual(Editor.last.status, 'saved');
  });

  await t('a failed save says so, keeps the words, and can be tried again', async () => {
    calls.length = 0;
    failNext = 1;
    await step(() => api.patch(key, { title: 'Picnic moved' }), 160);
    assert.strictEqual(Editor.last.status, 'error');
    assert.strictEqual(Editor.last.error, 'The database said no.');
    assert.strictEqual(api.get(key)._error, 'The database said no.', 'the row shows it too');
    assert.strictEqual(api.get(key).title, 'Picnic moved');
    await act(async () => { await Editor.last.flush(); await wait(10); });
    assert.strictEqual(table.find((x) => x.id === 'id2').title, 'Picnic moved');
    assert.strictEqual(Editor.last.status, 'saved');
    assert.strictEqual(api.get(key)._error, '');
  });

  await t('closing the editor saves what’s left', async () => {
    calls.length = 0;
    await step(() => api.patch(key, { title: 'Picnic, final' }));
    await act(async () => { r.update(React.createElement(Page, { show: false })); });
    await act(async () => { await wait(120); });
    assert.strictEqual(table.find((x) => x.id === 'id2').title, 'Picnic, final');
    assert.ok(!api.dirty(api.get(key)));
  });

  await t('rows keep their key after the first save, so the editor isn’t rebuilt mid-typing', () => {
    assert.ok(key.startsWith('new-'));
    assert.strictEqual(api.get(key).id, 'id2');
    assert.strictEqual(api.idOf(key), 'id2');
  });

  // ── the list ──
  await t('the list: a click or Enter picks; Alt + ↑/↓ and a drag put it in order', async () => {
    const picks = [];
    let order = null;
    const rows = ['a', 'b', 'c'].map((k) => ({ _key: k, title: k }));
    let list;
    await act(async () => {
      list = TR.create(React.createElement(kit.RowList, {
        rows, picked: 'a', onPick: (k) => picks.push(k), onMove: (keys) => { order = keys; },
        renderRow: (row) => React.createElement('span', null, row.title),
      }));
    });
    const opts = list.root.findAll((n) => n.props && n.props.role === 'option');
    assert.strictEqual(opts.length, 3);
    await act(async () => { opts[1].props.onClick(); });
    const me = (el) => ({ target: el, currentTarget: el, preventDefault() {} });
    await act(async () => { const ev = { ...me(1), key: 'Enter' }; opts[2].props.onKeyDown(ev); });
    assert.deepStrictEqual(picks, ['b', 'c']);
    await act(async () => { const ev = { ...me(1), key: 'ArrowUp', altKey: true }; opts[2].props.onKeyDown(ev); });
    assert.deepStrictEqual(order, ['a', 'c', 'b']);
    // dragging runs on pointer events (mouse, finger, pen) — the browser's own drag and drop never
    // reordered Home's cards for the office (2026-09-21)
    const now = () => list.root.findAll((n) => n.props && n.props.role === 'option');
    const box = (top) => ({ getBoundingClientRect: () => ({ top, height: 60 }) });
    const at = (sel) => ({ closest: (q) => (q.split(',').map((x) => x.trim()).includes(sel) ? {} : null) });
    const plain = { closest: () => null };
    const ptr = (row, type, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientY: y, target: plain,
      currentTarget: box(row * 60), preventDefault() {}, ...extra });
    // a mouse: press on "c", move a little (still a click), then up past "a"'s middle
    await act(async () => { now()[2].props.onPointerDown(ptr(2, 'down', 150)); });
    await act(async () => { now()[2].props.onPointerMove(ptr(2, 'move', 152)); });
    assert.ok(!now()[2].props.className.includes('dragging'), 'a few pixels is still a click');
    await act(async () => { now()[2].props.onPointerMove(ptr(2, 'move', 130)); });
    assert.ok(now()[2].props.className.includes('dragging'), 'further, and it is dragging');
    await act(async () => { now()[0].props.onPointerMove(ptr(0, 'move', 5)); });
    assert.ok(now()[0].props.className.includes('drop-above'), 'the line shows where it lands');
    const pickedBefore = picks.length;
    await act(async () => { now()[0].props.onPointerUp(ptr(0, 'up', 5)); });
    assert.deepStrictEqual(order, ['c', 'a', 'b'], 'dropped above "a"');
    await act(async () => { now()[0].props.onClick(); });
    assert.strictEqual(picks.length, pickedBefore, 'the click that ends a drag doesn\'t pick a row');
    await new Promise((res) => setTimeout(res, 5));
    // a finger: only the handle drags (so a swipe on the row scrolls), and a row held by its switch stays put
    order = null;
    await act(async () => { now()[0].props.onPointerDown(ptr(0, 'down', 30, { pointerType: 'touch' })); });
    await act(async () => { now()[0].props.onPointerMove(ptr(0, 'move', 150, { pointerType: 'touch' })); });
    assert.ok(!now()[0].props.className.includes('dragging'), 'a finger on the row itself scrolls the page');
    await act(async () => { now()[0].props.onPointerUp(ptr(0, 'up', 150, { pointerType: 'touch' })); });
    let released = 0;
    const grip = { ...at('.ax-grip'), releasePointerCapture: () => { released++; } };
    await act(async () => { now()[0].props.onPointerDown(ptr(0, 'down', 30, { pointerType: 'touch', target: grip })); });
    assert.strictEqual(released, 1, 'the finger is let go, so the rows under it hear it move');
    await act(async () => { now()[0].props.onPointerMove(ptr(0, 'move', 60, { pointerType: 'touch' })); });
    await act(async () => { now()[2].props.onPointerMove(ptr(2, 'move', 170, { pointerType: 'touch' })); });
    assert.ok(now()[2].props.className.includes('drop-below'));
    await act(async () => { now()[2].props.onPointerUp(ptr(2, 'up', 170, { pointerType: 'touch' })); });
    assert.deepStrictEqual(order, ['b', 'c', 'a'], 'the handle drags on a touch screen: "a" below "c"');
    order = null;
    await act(async () => { now()[1].props.onPointerDown(ptr(1, 'down', 90, { target: at('button') })); });
    await act(async () => { now()[1].props.onPointerMove(ptr(1, 'move', 10)); });
    assert.ok(!now()[1].props.className.includes('dragging'), 'pressing the switch never starts a drag');
    await act(async () => { now()[1].props.onPointerUp(ptr(1, 'up', 10)); });
    assert.strictEqual(order, null);
    // let go of the pointer somewhere else entirely, and cancel: nothing moves on a cancel
    await act(async () => { now()[2].props.onPointerDown(ptr(2, 'down', 150)); });
    await act(async () => { now()[2].props.onPointerMove(ptr(2, 'move', 120)); });
    await act(async () => { now()[1].props.onPointerMove(ptr(1, 'move', 65)); });
    await act(async () => { now()[1].props.onPointerCancel(ptr(1, 'cancel', 65)); });
    assert.strictEqual(order, null, 'a cancelled drag moves nothing');
    assert.ok(!now().some((n) => /dragging|drop-/.test(n.props.className)), 'and leaves no marks');
    list.unmount();
  });

  await t('Undo: a deletion says so, and one click puts it back', async () => {
    let undone = 0;
    let show;
    function Host() { const [node, s] = kit.useUndo(); show = s; return node; }
    let h;
    await act(async () => { h = TR.create(React.createElement(Host)); });
    await act(async () => { show('“Picnic” deleted.', () => { undone++; }); });
    const text = JSON.stringify(h.toJSON());
    assert.ok(text.includes('Picnic') && text.includes('Undo'));
    const undo = h.root.findAll((n) => n.type === 'button')[0];
    await act(async () => { undo.props.onClick(); });
    assert.strictEqual(undone, 1);
    assert.strictEqual(h.toJSON(), null, 'and the message goes');
    h.unmount();
  });

  r.unmount();
  console.error = oe;
  const other = errs.filter((m) => !/react-test-renderer is deprecated|not wrapped in act/.test(m));
  if (other.length) { console.log('React errors:', other.slice(0, 3)); process.exit(1); }
  console.log(`${ok} kit checks passed`);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
