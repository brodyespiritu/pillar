// Pillar/src/pages/app/layout.jsx and AppShell.jsx — the App section's frame and workspace after the
// redesign (2026-09-23, Pillar-backups/redesign/DESIGN.md §2–3): list · editor · phone side by side,
// the phone a drawer (Preview, Escape) when there's no room, one pane at a time on a narrow screen
// (Back), keyboard shortcuts that never fire while someone types, the sub-panel that makes a sermon
// inside its series, the phone drawn like the member app (with its dock), and the sidebar that folds
// to a rail and remembers it.
//
// Foundation fixes (review, 2026-09-23): the widths reproduce the approved mockup at 1440 × 900
// (WIDE 1140, RAIL_BELOW 1415), the drawer is only a drawer with `hasPreview`, every Pillar dialog
// owns the keyboard (and ⌘S still never opens the browser's Save), the ⌘S hint only when something
// saves on it, the keyboard goes back where it was when a drawer or panel closes, a sub-panel opens
// in its title, and the app fonts load from App pages only.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');   // React, the renderer and Babel, pinned in ./package.json
const PILLAR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.build-layout'); fs.mkdirSync(OUT, { recursive: true });
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

// ── a pretend browser: the window's key and resize events, localStorage, a document with dialogs ──
const listeners = {};
const store = new Map();
let modalUp = false;   // false, or the class of the Pillar dialog that is up ('.dlg-overlay', '.setm-overlay'…)
globalThis.window = {
  innerWidth: 1280,
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || new Set()).add(fn); },
  removeEventListener: (type, fn) => { if (listeners[type]) listeners[type].delete(fn); },
  dispatchEvent: (e) => { for (const fn of [...(listeners[e.type] || [])]) fn(e); return true; },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
};
const appended = [];   // what went into <head>
globalThis.document = {
  activeElement: null,
  querySelector: (sel) => (modalUp && sel.split(',').map((x) => x.trim()).includes(modalUp) ? {} : null),
  createElement: (tag) => ({ tagName: tag }),
  getElementById: (id) => appended.find((el) => el.id === id) || null,
  head: { appendChild: (el) => { appended.push(el); } },
};
const observers = [];
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe(el) { this.el = el; } disconnect() { this.gone = true; } };

const React = require(path.join(DEPS, 'react'));
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
stub('../../lib/dialog', { confirmDialog: async () => true });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
let ACTIVE = '/app/watch';
stub('react-router-dom', {
  NavLink: ({ to, className, children, ...rest }) => React.createElement('a',
    { href: to, className: typeof className === 'function' ? className({ isActive: to === ACTIVE }) : className, ...rest }, children),
});
stub('../../components/TopNav', { __esModule: true, default: () => null });
let liveAnswer = { isLive: true };
const liveCalls = [];
stub('../../lib/appApi', { getLivestream: async () => { liveCalls.push(1); return liveAnswer; } });
stub('../../lib/appRefresh', { liveUpdatesReady: async () => true });
stub('./appx.css', {});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require(path.join(DEPS, 'react-test-renderer'));
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
STUBS['./layout'] = xform(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'layout.cjs');
const L = require(STUBS['./layout']);
const { act } = React;
const h = React.createElement;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// what the renderer hands a ref: enough of an element for layout.jsx to measure and focus
const focused = [];
// a pretend element that takes the keyboard (and says so in `focused`)
const focusable = (name) => { const el = { isConnected: true, focus: () => { focused.push(name); document.activeElement = el; } }; return el; };
const asked = [];   // the selectors a sub-panel looked for its first field with
let hasTitle = true;
const nodeMock = (width = 1300) => (el) => {
  const cls = String(el.props.className || '');
  const node = {
    cls,
    isConnected: true,
    getBoundingClientRect: () => ({ width: cls.includes('ax-phone-frame') ? 300 : width }),
    focus: () => { focused.push(el.type === 'input' ? 'search' : cls || el.type); document.activeElement = node; },
    querySelector: (sel) => {
      if (!cls.includes('ax-subpanel')) return null;
      asked.push(sel);
      if (/\.title/.test(sel)) return hasTitle ? { focus: () => focused.push('title field') } : null;
      return /input/.test(sel) ? { focus: () => focused.push('first field') } : null;
    },
  };
  return node;
};
const resize = async (w) => { await act(async () => { observers.filter((o) => !o.gone && o.el && o.el.cls && o.el.cls.includes('ax-work')).forEach((o) => o.cb([{ contentRect: { width: w } }])); }); };
const key = (k, extra = {}) => {
  const e = { type: 'keydown', key: k, target: { closest: () => null }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  window.dispatchEvent(e);
  return e;
};
const typing = { closest: (sel) => (sel.includes('input') ? {} : null) };
const byClass = (root, c) => root.findAll((n) => typeof n.type === 'string' && String(n.props.className || '').split(' ').includes(c));
const text = (node) => JSON.stringify(node.toJSON());
// the words inside one rendered element
const words = (inst) => inst.children.map((c) => (typeof c === 'string' ? c : words(c))).join('');

(async () => {
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };

  // ── keys ──
  await t('shortcuts never fire while someone types (⌘S and Escape still do), nor while any Pillar dialog is up', async () => {
    const got = [];
    function Keys({ on = true }) {
      L.useHotkeys({ n: () => got.push('n'), '/': () => got.push('/'), 'mod+s': () => got.push('save'), escape: () => got.push('esc') }, on);
      return null;
    }
    let r;
    await act(async () => { r = TR.create(h(Keys)); });
    const n = key('n');
    assert.ok(n.defaultPrevented, 'a handled key keeps its default (N is not typed into a box it opens)');
    key('N', { shiftKey: true });
    key('n', { target: typing });
    key('/', { target: typing });
    key('n', { repeat: true });
    key('s', { metaKey: true, target: typing });
    key('s', { ctrlKey: true });
    const esc = key('Escape', { target: typing });
    assert.ok(!esc.defaultPrevented, 'Escape is left for other layers too');
    key('Escape', { defaultPrevented: true });   // a search box already used it to clear itself
    assert.deepStrictEqual(got, ['n', 'n', 'save', 'save', 'esc']);
    // every Pillar dialog, sheet or menu that can be up over an App page — the Settings modal TopNav
    // opens included — owns the keyboard: nothing here runs, not even Escape or ⌘S…
    for (const up of ['.dlg-overlay', '.setm-overlay', '.dpv-overlay', '.hm-modal-overlay', '.modal-overlay', '.mn-scrim', '.ctl-overlay', '.tn-backdrop']) {
      assert.ok(L.MODAL_UP.split(',').map((x) => x.trim()).includes(up), `${up} counts as a dialog`);
      modalUp = up;
      const plainN = key('n'); const save = key('s', { metaKey: true }); key('Escape');
      assert.ok(!plainN.defaultPrevented, `${up}: N is left to the dialog`);
      // …but ⌘S still never opens the browser's own Save Page dialog
      assert.ok(save.defaultPrevented, `${up}: ⌘S's default is still prevented`);
    }
    modalUp = false;
    assert.deepStrictEqual(got, ['n', 'n', 'save', 'save', 'esc'], 'a Pillar dialog owns the keyboard while it is up');
    await act(async () => { r.update(h(Keys, { on: false })); });
    key('n');
    assert.strictEqual(got.length, 5, 'switched off, nothing fires');
    await act(async () => { r.unmount(); });
    assert.strictEqual((listeners.keydown || new Set()).size, 0, 'and it lets go of the window when it goes');
    assert.strictEqual(L.comboOf({ key: 'S', metaKey: true }), 'mod+s');
    assert.strictEqual(L.comboOf({ key: 'Esc' }), 'escape');
    let hint;
    await act(async () => { hint = TR.create(h(L.HotkeyHint, { keys: ['n', false, 'mod+s'] })); });
    assert.ok(/new/.test(text(hint)) && /save now/.test(text(hint)) && !/search/.test(text(hint)));
    await act(async () => { hint.unmount(); });
  });

  // ── the workspace ──
  let picks; let picked;
  const rows = ['Sermon one', 'Sermon two'];
  function Page({ detail = false, sub = false, onDone, onBack, filter = 'all', onFilter, search = '', onSearch, onNew, newDisabled, footer, children, hasPreview = true, onSave, subSave, hotkeys }) {
    return h(L.Workspace, { detail, hasPreview },
      h(L.ListPane, {
        newLabel: 'New sermon', onNew, newDisabled, newHint: 'Give the series a name first.', search, onSearch,
        searchPlaceholder: 'Search sermons…', filters: [{ key: 'all', label: 'All', count: 2 }, { key: 'drafts', label: 'Drafts', count: 0 }],
        filter, onFilter, count: '2 sermons', footer, hotkeys,
      }, rows.map((r) => h('div', { key: r, className: 'ax-row' }, r))),
      h(L.EditorPane, {
        status: h('span', { className: 'ax-save' }, 'Saved'), switches: h('span', { className: 'ax-switch' }), onBack, onSave,
        actions: h('button', { className: 'ax-headbtn danger', 'aria-label': 'Delete' }), empty: h('p', null, 'Pick a sermon'),
      }, children === undefined ? h(L.Cols, null, h(L.ColA, { title: 'Words' }, h(L.Fields, { min: 180 }, h('input', { className: 'ax-input' }), h(L.Span, null, 'Notes'))),
        h(L.ColB, { title: 'Media' }, 'video'), sub ? h(L.SubPanel, { title: 'New sermon', sub: 'Joins “Prodigal Sons” as #5', status: 'Saved', onDone, onSave: subSave }, h('input', { className: 'ax-input title' })) : null)
        : children),
      h(L.PreviewPane, { label: 'On phones', note: 'Watch tab' }, h(L.PhoneFrame, { dock: 'watch' }, h('div', { className: 'ax-pa-title' }, 'Watch'))));
  }

  await t('the panes: list · editor · phone, each with the parts a page fills in', async () => {
    picks = []; picked = [];
    let r;
    await act(async () => {
      r = TR.create(h(Page, { onNew: () => picks.push('new'), onSearch: (v) => picked.push(v), onFilter: (k) => picked.push(`filter:${k}`) }), { createNodeMock: nodeMock(1300) });
    });
    const root = r.root;
    assert.strictEqual(byClass(root, 'ax-work').length, 1);
    assert.strictEqual(byClass(root, 'ax-list-pane').length, 1);
    assert.strictEqual(byClass(root, 'ax-editor-pane').length, 1);
    assert.strictEqual(byClass(root, 'ax-preview-pane').length, 1);
    assert.strictEqual(byClass(root, 'ax-list-pane')[0].type, 'section');
    assert.strictEqual(byClass(root, 'ax-preview-pane')[0].type, 'aside');
    assert.strictEqual(byClass(root, 'ax-cols').length, 1);
    assert.strictEqual(byClass(root, 'ax-col-a').length, 1);
    assert.strictEqual(byClass(root, 'ax-col-b').length, 1);
    assert.strictEqual(byClass(root, 'ax-fields')[0].props.style['--ax-field-min'], '180px', 'a field width is the one inline value');
    assert.strictEqual(byClass(root, 'ax-span').length, 1);
    assert.ok(/WORDS|Words/.test(text(r)) && /Media/.test(text(r)));
    // the editor's head: status, switches, then actions — and it is not the empty state
    const head = byClass(root, 'ax-editor-pane-head')[0];
    assert.ok(byClass(head, 'ax-editor-status').length && byClass(head, 'ax-editor-switches').length && byClass(head, 'ax-editor-actions').length);
    assert.ok(!/Pick a sermon/.test(text(r)));
    // the hotkey hint is the list's foot unless a page says otherwise — and it offers only what works
    // here: no editor saves on ⌘S in this page, so no "save now"
    assert.ok(byClass(root, 'ax-hotkeys').length === 1 && /new/.test(text(r)) && /search/.test(text(r)));
    assert.ok(!/save now/.test(text(r)), 'no ⌘S in the hint when nothing saves on it');
    assert.strictEqual(byClass(root, 'ax-pane-count')[0].children.join(''), '2 sermons');
    // the preview says what it shows
    assert.ok(/On phones/.test(text(r)) && /Watch tab/.test(text(r)));
    await act(async () => { r.unmount(); });
  });

  await t('nothing picked: the editor shows its empty state', async () => {
    let r;
    await act(async () => { r = TR.create(h(Page, { children: null }), { createNodeMock: nodeMock() }); });
    assert.ok(/Pick a sermon/.test(text(r)));
    assert.ok(byClass(r.root, 'ax-editor-pane')[0].props.className.includes('is-empty'));
    assert.strictEqual(byClass(r.root, 'ax-preview-toggle').length, 0, 'no head, so no Preview button');
    await act(async () => { r.unmount(); });
  });

  await t('the list: New, search (/ jumps to it, Escape clears it), filter chips, N for new', async () => {
    picks = []; picked = []; focused.length = 0;
    let r;
    const props = { onNew: () => picks.push('new'), onSearch: (v) => picked.push(v), onFilter: (k) => picked.push(`filter:${k}`) };
    await act(async () => { r = TR.create(h(Page, props), { createNodeMock: nodeMock() }); });
    const btn = byClass(r.root, 'ax-new')[0];
    assert.ok(/New sermon/.test(words(btn)));
    await act(async () => { btn.props.onClick(); });
    const input = r.root.findAll((n) => n.type === 'input' && n.props.type === 'search')[0];
    assert.strictEqual(input.props.placeholder, 'Search sermons…');
    await act(async () => { input.props.onChange({ target: { value: 'harvest' } }); });
    const chips = byClass(r.root, 'ax-filter');
    assert.strictEqual(chips.length, 2);
    assert.strictEqual(chips[0].props['aria-checked'], true);
    assert.ok(/2/.test(words(chips[0])), 'a chip carries its count');
    await act(async () => { chips[1].props.onClick(); });
    assert.deepStrictEqual(picked, ['harvest', 'filter:drafts']);
    await act(async () => { key('n'); });
    assert.deepStrictEqual(picks, ['new', 'new'], 'N makes a new one');
    await act(async () => { key('/'); });
    assert.ok(focused.includes('search'), '/ jumps to the search');
    // with words in it, Escape clears the box (and stops there)
    await act(async () => { r.update(h(Page, { ...props, search: 'harvest' })); });
    const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    await act(async () => { r.root.findAll((n) => n.type === 'input' && n.props.type === 'search')[0].props.onKeyDown(e); });
    assert.strictEqual(picked[picked.length - 1], '');
    assert.ok(e.defaultPrevented);
    // New can be off — and then it says why, and N does nothing
    await act(async () => { r.update(h(Page, { ...props, newDisabled: true })); });
    assert.strictEqual(byClass(r.root, 'ax-new')[0].props.disabled, true);
    assert.ok(/Give the series a name first/.test(text(r)), 'a dead button says why (Hick)');
    await act(async () => { key('n'); });
    assert.strictEqual(picks.length, 2);
    // a page can drop the hint
    await act(async () => { r.update(h(Page, { ...props, footer: null })); });
    assert.strictEqual(byClass(r.root, 'ax-hotkeys').length, 0);
    await act(async () => { r.unmount(); });
  });

  await t('⌘S saves the item being edited, and only then does the hint offer it; a second list offers nothing it can\'t do', async () => {
    let r; const saved = [];
    const base = { onNew: () => {}, onSearch: () => {} };
    await act(async () => { r = TR.create(h(Page, base), { createNodeMock: nodeMock() }); });
    assert.ok(!/save now/.test(text(r)), 'nothing saves on ⌘S yet, so the hint doesn\'t say it does');
    await act(async () => { r.update(h(Page, { ...base, onSave: () => saved.push('sermon') })); });
    assert.ok(/save now/.test(words(byClass(r.root, 'ax-hotkeys')[0])), 'an editor that saves on ⌘S puts it in the hint');
    const e = key('s', { metaKey: true, target: typing });
    assert.ok(e.defaultPrevented, 'the browser\'s Save dialog stays shut');
    assert.deepStrictEqual(saved, ['sermon'], '⌘S saves now, even from inside a field');
    // nothing picked: the empty editor has nothing to save, and the hint drops ⌘S again
    await act(async () => { r.update(h(Page, { ...base, onSave: () => saved.push('sermon'), children: null })); });
    assert.ok(!/save now/.test(text(r)));
    key('s', { metaKey: true });
    assert.deepStrictEqual(saved, ['sermon']);
    // a sub-panel's own onSave: ⌘S saves what's being made in it, and the series it goes into
    await act(async () => { r.update(h(Page, { ...base, onSave: () => saved.push('series'), sub: true, subSave: () => saved.push('new sermon') })); });
    key('s', { ctrlKey: true });
    assert.deepStrictEqual(saved.slice(1).sort(), ['new sermon', 'series']);
    // hotkeys off (a second list on the page): no N and no / in its hint — ⌘S is the editor's and stays
    await act(async () => { r.update(h(Page, { ...base, onSave: () => {}, hotkeys: false })); });
    const hint = words(byClass(r.root, 'ax-hotkeys')[0]);
    assert.ok(!/new|search/.test(hint) && /save now/.test(hint), hint);
    assert.strictEqual(byClass(r.root, 'ax-search-key').length, 0, 'and its search box doesn\'t show the / key');
    // nothing to offer at all: no empty foot bar
    await act(async () => { r.update(h(Page, { ...base, hotkeys: false })); });
    assert.strictEqual(byClass(r.root, 'ax-pane-foot').length, 0, 'no hint, no foot');
    await act(async () => { r.unmount(); });
  });

  await t('the search box: its own × clears it and keeps the keyboard there (no browser decorations)', async () => {
    const said = []; focused.length = 0;
    let r;
    await act(async () => { r = TR.create(h(L.SearchBox, { value: '', onChange: (v) => said.push(v) }), { createNodeMock: nodeMock() }); });
    assert.strictEqual(r.root.findAll((n) => n.props && n.props.className === 'ax-search-clear').length, 0, 'nothing typed: no ×, the / key instead');
    assert.strictEqual(byClass(r.root, 'ax-search-key').length, 1);
    await act(async () => { r.update(h(L.SearchBox, { value: 'harvest', onChange: (v) => said.push(v) })); });
    const x = byClass(r.root, 'ax-search-clear')[0];
    assert.strictEqual(x.props['aria-label'], 'Clear the search');
    await act(async () => { x.props.onClick(); });
    assert.deepStrictEqual(said, ['']);
    assert.ok(focused.includes('search'), 'the keyboard stays in the box');
    await act(async () => { r.unmount(); });
  });

  await t('no room for three: the phone is a drawer — Preview opens it, Escape, × or a click beside it close it', async () => {
    let r; let seen;
    function Spy() { seen = L.usePreview(); return null; }
    await act(async () => { r = TR.create(h(Page, { children: h(Spy) }), { createNodeMock: nodeMock(1300) }); });
    assert.strictEqual(seen.drawer, false, 'wide: the phone has its own column');
    assert.strictEqual(seen.width, 1300);
    // the approved mockup at 1440 × 900 with the full sidebar leaves a 1164px workspace: all three
    await resize(1164);
    assert.strictEqual(seen.drawer, false, 'the mockup’s 1164: list · editor · phone');
    assert.strictEqual(L.WIDE, 1140);
    await resize(1139);
    assert.strictEqual(seen.drawer, true, 'under 1140 the phone becomes a drawer');
    await resize(900);
    assert.strictEqual(seen.drawer, true, 'narrower than 1180: a drawer');
    assert.strictEqual(seen.narrow, false);
    const toggle = byClass(r.root, 'ax-preview-toggle')[0];
    assert.ok(toggle, 'the editor head carries Preview (CSS shows it only while the phone is a drawer)');
    // a phone on it, not a telephone handset (P.phone reads as "call")
    const glyph = toggle.findAll((n) => n.type === 'svg')[0];
    assert.ok(glyph && /ax-pa-icon/.test(glyph.props.className), 'the Preview button draws a smartphone');
    focused.length = 0;
    document.activeElement = focusable('Preview button');
    await act(async () => { toggle.props.onClick(); });
    assert.ok(byClass(r.root, 'ax-work')[0].props.className.includes('preview-open'));
    assert.ok(byClass(r.root, 'ax-preview-pane')[0].props.className.includes('open'));
    assert.strictEqual(byClass(r.root, 'ax-preview-toggle')[0].props['aria-expanded'], true);
    assert.ok(focused.some((f) => /ax-preview-close/.test(f)), 'opening it puts the keyboard on its ×');
    await act(async () => { key('Escape'); });
    assert.ok(!byClass(r.root, 'ax-preview-pane')[0].props.className.includes('open'), 'Escape closes it');
    assert.strictEqual(focused[focused.length - 1], 'Preview button', 'and the keyboard goes back to Preview, not to <body>');
    await act(async () => { seen.toggle(); });
    await act(async () => { byClass(r.root, 'ax-preview-close')[0].props.onClick(); });
    assert.ok(!seen.open, 'its × closes it');
    await act(async () => { seen.setOpen(true); });
    await act(async () => { byClass(r.root, 'ax-drawer-scrim')[0].props.onClick(); });
    assert.ok(!seen.open && byClass(r.root, 'ax-drawer-scrim').length === 0, 'a click beside it closes it');
    // open, then the window widens past 1140: the phone has its column again, and the drawer is shut —
    // so it isn't already open the next time the window narrows
    await act(async () => { seen.setOpen(true); });
    assert.ok(seen.open);
    await resize(1300);
    assert.ok(!seen.open && !byClass(r.root, 'ax-work')[0].props.className.includes('preview-open'));
    await resize(900);
    assert.ok(!seen.open, 'narrow again: still shut');
    await resize(700);
    assert.strictEqual(seen.narrow, true, 'under 760: one pane at a time');
    await act(async () => { r.unmount(); });
  });

  await t('without hasPreview the phone is never a drawer: it keeps its column (CSS stacks it under 760)', async () => {
    let r; let seen;
    function Spy() { seen = L.usePreview(); return null; }
    await act(async () => { r = TR.create(h(Page, { hasPreview: false, children: h(Spy) }), { createNodeMock: nodeMock(900) }); });
    assert.strictEqual(seen.width, 900);
    assert.strictEqual(seen.drawer, false, 'no drawer at 900');
    assert.strictEqual(byClass(r.root, 'ax-preview-toggle').length, 0, 'so no Preview button');
    assert.ok(!byClass(r.root, 'ax-work')[0].props.className.includes('has-preview'), 'and the CSS drawer rules, which need .has-preview, leave it be');
    await act(async () => { seen.setOpen(true); });
    assert.strictEqual(seen.open, false, 'nothing can open a drawer that isn\'t one');
    assert.ok(!byClass(r.root, 'ax-preview-pane')[0].props.className.includes('open'));
    await act(async () => { r.unmount(); });
  });

  await t('one pane at a time: `detail` shows the editor, and Back goes back to the list', async () => {
    let back = 0;
    let r;
    await act(async () => { r = TR.create(h(Page, { detail: false, onBack: () => { back++; } }), { createNodeMock: nodeMock(700) }); });
    assert.ok(!byClass(r.root, 'ax-work')[0].props.className.includes('detail'));
    await act(async () => { r.update(h(Page, { detail: true, onBack: () => { back++; } })); });
    assert.ok(byClass(r.root, 'ax-work')[0].props.className.includes('detail'), 'picked: the editor is the pane');
    const b = byClass(r.root, 'ax-back')[0];
    assert.ok(b && /Back/.test(words(b)), 'Back (CSS shows it only on a narrow workspace)');
    await act(async () => { b.props.onClick(); });
    assert.strictEqual(back, 1);
    await act(async () => { r.unmount(); });
  });

  await t('a sub-panel over the editor: its title is ready, Done / Escape / a click beside it close it', async () => {
    let done = 0; let seen;
    function Spy() { seen = L.usePreview(); return null; }
    focused.length = 0; asked.length = 0; hasTitle = true;
    let r;
    const page = (extra) => h(Page, { sub: true, onDone: () => { done++; }, ...extra });
    document.activeElement = focusable('New sermon in this series');
    await act(async () => { r = TR.create(page(), { createNodeMock: nodeMock() }); });
    const panel = byClass(r.root, 'ax-subpanel')[0];
    assert.strictEqual(panel.props.role, 'dialog');
    assert.strictEqual(panel.props['aria-modal'], undefined, 'non-modal: the list beside it still works');
    assert.ok(/New sermon/.test(text(r)) && /Joins/.test(text(r)) && /Saved/.test(text(r)));
    assert.deepStrictEqual(focused, ['title field'], 'the title takes the keyboard');
    // with no title field, the first field a person TYPES in — never a switch, a choice or a search box
    hasTitle = false; asked.length = 0; focused.length = 0;
    let other;
    await act(async () => { other = TR.create(h(L.SubPanel, { title: 'New card' }, 'x'), { createNodeMock: nodeMock() }); });
    assert.deepStrictEqual(focused, ['first field']);
    const typeable = asked[asked.length - 1];
    assert.ok(/input\[type="text"\]/.test(typeable) && /textarea/.test(typeable), typeable);
    assert.ok(!/checkbox|radio|search|file/.test(typeable), 'switches, choices and search boxes are skipped');
    await act(async () => { other.unmount(); });
    hasTitle = true;
    await act(async () => { byClass(r.root, 'ax-subpanel-done')[0].props.onClick(); });
    assert.strictEqual(done, 1, 'Done');
    assert.ok(/Done/.test(JSON.stringify(byClass(r.root, 'ax-subpanel-done')[0].props.children)));
    await act(async () => { key('Escape', { target: typing }); });
    assert.strictEqual(done, 2, 'Escape, even from a field');
    await act(async () => { byClass(r.root, 'ax-subpanel-scrim')[0].props.onClick(); });
    assert.strictEqual(done, 3, 'a click beside it');
    // while it's open the list's N doesn't make something else behind it
    let made = 0;
    await act(async () => { r.update(page({ onNew: () => { made++; } })); });
    await act(async () => { key('n'); });
    assert.strictEqual(made, 0, 'N waits while the panel is open');
    // …and its search box doesn't offer "/" meanwhile (integration: the key waited, the badge didn't)
    await act(async () => { r.update(page({ onNew: () => { made++; }, onSearch: () => {} })); });
    assert.strictEqual(byClass(r.root, 'ax-search-key').length, 0, 'no / on the search box while the panel is open');
    await act(async () => { r.update(h(Page, { onNew: () => { made++; } })); });
    await act(async () => { key('n'); });
    assert.strictEqual(made, 1, 'and works again once it closes');
    await act(async () => { r.update(h(Page, { onSearch: () => {} })); });
    assert.strictEqual(byClass(r.root, 'ax-search-key').length, 1, 'and the / is back on the box');
    // closed, it gives the keyboard back to what opened it
    focused.length = 0;
    document.activeElement = focusable('New sermon in this series');
    await act(async () => { r.update(page()); });
    await act(async () => { r.update(h(Page, {})); });
    assert.strictEqual(focused[focused.length - 1], 'New sermon in this series', 'back to the button, not <body>');
    // with the phone drawer open (a narrow workspace), Escape closes the drawer first and leaves the panel
    await act(async () => { r.update(h(L.Workspace, { hasPreview: true }, h(L.EditorPane, null, h(Spy), h(L.SubPanel, { title: 'New card', onDone: () => { done++; } }, 'x')), h(L.PreviewPane, null, 'phone'))); });
    await resize(900);
    await act(async () => { seen.setOpen(true); });
    assert.ok(seen.open);
    await act(async () => { key('Escape'); });
    assert.strictEqual(done, 3, 'the drawer went, the panel stayed');
    assert.strictEqual(seen.open, false);
    await act(async () => { r.unmount(); });
  });

  await t('a section: titled, and a collapsible one folds away', async () => {
    let r;
    await act(async () => {
      r = TR.create(h('div', null,
        h(L.Section, { title: 'Schedule', right: 'optional' }, h('p', null, 'From')),
        h(L.Section, { title: 'More', collapsible: true, defaultOpen: false }, h('p', null, 'Rare'))));
    });
    const sections = byClass(r.root, 'ax-section');
    assert.strictEqual(sections[0].type, 'section');
    assert.strictEqual(sections[1].type, 'details');
    assert.strictEqual(sections[1].props.open, false, 'starts folded');
    await act(async () => { sections[1].props.onToggle({ currentTarget: { open: true } }); });
    assert.strictEqual(byClass(r.root, 'ax-section')[1].props.open, true);
    assert.ok(/Schedule/.test(text(r)) && /optional/.test(text(r)));
    await act(async () => { r.unmount(); });
  });

  // ── the phone ──
  await t('the phone draws the app: children in its screen, the status bar, the profile button and the dock', async () => {
    let r;
    await act(async () => { r = TR.create(h(L.PhoneFrame, { dock: 'watch' }, h('p', { className: 'ax-pa-title' }, 'Watch')), { createNodeMock: nodeMock() }); });
    const frame = byClass(r.root, 'ax-phone-frame')[0];
    assert.strictEqual(frame.props.style['--ax-phone-scale'], Math.round((300 / 417) * 10000) / 10000, 'one scale, from the width it was given');
    assert.strictEqual(frame.props.style['--ax-phone-h'], '852px');
    const screen = byClass(r.root, 'ax-phone-screen')[0];
    assert.ok(screen.props.className.includes('ax-phone-app'), 'the app\'s tokens and fonts (css/phone.css)');
    assert.ok(/Watch/.test(text(r)));
    assert.strictEqual(byClass(r.root, 'ax-phone-scroll').length, 1);
    assert.ok(byClass(r.root, 'ax-pa-status')[0].props.className.includes('dark'));
    assert.ok(/9:41/.test(text(r)));
    assert.strictEqual(byClass(r.root, 'ax-pa-profile').length, 1, 'every screen has the profile button');
    assert.strictEqual(byClass(r.root, 'ax-pa-back').length, 0);
    // the dock: Home, Watch, Bible, Give in the pill; the page you're on has a dot for its word
    const tabs = byClass(r.root, 'ax-pa-dock-tab');
    assert.strictEqual(tabs.length, 4);
    const words = byClass(r.root, 'ax-pa-dock-word').map((n) => n.children.join(''));
    assert.deepStrictEqual(words, ['Home', 'Bible', 'Give']);
    assert.ok(tabs[1].props.className.includes('on') && byClass(tabs[1], 'ax-pa-dock-dot').length === 1);
    assert.strictEqual(byClass(r.root, 'ax-pa-dock-more').length, 1, 'and the round More beside it');
    await act(async () => {
      r.update(h(L.PhoneFrame, { dock: 'more', statusBar: 'light', back: true, profile: false, scale: 0.5, height: 700, overlay: h('div', { className: 'ax-pa-scrim' }) }, 'x'));
    });
    assert.ok(byClass(r.root, 'ax-pa-dock-more')[0].props.className.includes('on'), 'a page behind More lights More');
    assert.strictEqual(byClass(r.root, 'ax-pa-dock-dot').length, 0);
    assert.ok(byClass(r.root, 'ax-pa-status')[0].props.className.includes('light'));
    assert.strictEqual(byClass(r.root, 'ax-pa-back').length, 1);
    assert.strictEqual(byClass(r.root, 'ax-pa-profile').length, 0);
    const fixed = byClass(r.root, 'ax-phone-frame')[0];
    assert.ok(fixed.props.className.includes('fixed'));
    assert.strictEqual(fixed.props.style['--ax-phone-scale'], 0.5);
    assert.strictEqual(fixed.props.style['--ax-phone-h'], '700px');
    assert.strictEqual(byClass(r.root, 'ax-phone-overlay').length, 1);
    await act(async () => { r.update(h(L.PhoneFrame, null, 'no dock')); });
    assert.strictEqual(byClass(r.root, 'ax-pa-dockbar').length, 0);
    let icon; let none;
    await act(async () => { icon = TR.create(h(L.PhoneIcon, { name: 'search', size: 21 })); none = TR.create(h(L.PhoneIcon, { name: 'nope' })); });
    assert.strictEqual(icon.toJSON().props.width, 21);
    assert.strictEqual(none.toJSON(), null);
    await act(async () => { r.unmount(); });
  });

  // ── the frame ──
  const AppShell = require(xform(path.join(PILLAR, 'src/pages/app/AppShell.jsx'), 'AppShell.cjs'));
  const Shell = (props) => h(AppShell.default, { title: 'Watch', subtitle: 'Everything on the app’s Media tab. Changes save as you type.', ...props }, h('div', { className: 'ax-work' }));

  await t('the head is one compact row: title and a line on the left, normal-size tabs on the right', async () => {
    let r;
    const tabs = { value: 'sermons', onChange: () => {}, options: [{ key: 'sermons', label: 'Sermons' }, { key: 'series', label: 'Series' }] };
    await act(async () => { r = TR.create(h(Shell, { tabs, fill: true }), { createNodeMock: nodeMock() }); });
    await act(async () => { await wait(5); });
    const head = r.root.find((n) => n.type === 'header');
    assert.ok(head.props.className.includes('ax-head'));
    assert.strictEqual(byClass(head, 'ax-title')[0].type, 'h1');
    const sub = byClass(head, 'ax-sub')[0];
    assert.strictEqual(sub.props.title, 'Everything on the app’s Media tab. Changes save as you type.', 'the whole line on hover when it is cut short');
    const seg = byClass(head, 'ax-seg')[0];
    assert.ok(seg && !seg.props.className.includes('big'), 'tabs at normal size');
    assert.strictEqual(seg.props['aria-label'], 'Show');
    assert.ok(byClass(r.root, 'ax-main')[0].props.className.includes('fill'), 'fill: the page is the window’s height');
    assert.ok(byClass(r.root, 'ax-page')[0].props.className.includes('fill'));
    assert.strictEqual(byClass(r.root, 'ax-head-actions').length, 0);
    await act(async () => { r.update(h(Shell, { actions: h('button', null, 'x') })); });
    assert.ok(!byClass(r.root, 'ax-page')[0].props.className.includes('fill'));
    assert.strictEqual(byClass(r.root, 'ax-head-actions').length, 1, 'the actions slot is still there');
    // the pages, the LIVE mark (a pill beside the name, a dot on the rail and the phone strip), the connection
    const links = byClass(r.root, 'ax-nav')[0].findAll((n) => n.type === 'a');
    assert.deepStrictEqual(links.map((a) => a.props.href), AppShell.PAGES.map((p) => p.to));
    assert.deepStrictEqual(AppShell.PAGES.map((p) => p.label), ['Home', 'Bulletin', 'Groups', 'Watch', 'Live', 'Notifications', 'Settings']);
    assert.strictEqual(links.find((a) => a.props.href === '/app/watch').props.className, 'active');
    assert.strictEqual(byClass(r.root, 'ax-nav-live').length, 1);
    assert.strictEqual(links.find((a) => a.props.href === '/app/live').props['aria-label'], 'Live — live now');
    assert.ok(/Changes reach open phones within a second or two\./.test(text(r)));
    await act(async () => { window.dispatchEvent({ type: 'pillar-app-live', detail: false }); });
    assert.strictEqual(byClass(r.root, 'ax-nav-live').length, 0, 'the Live page says so the moment it changes');
    assert.strictEqual(byClass(r.root, 'ax-nav-dot').length, 0);
    // on a phone the pages are a strip (CSS shows it at ≤ 767px)
    const strip = byClass(r.root, 'ax-strip')[0];
    assert.strictEqual(strip.findAll((n) => n.type === 'a').length, 7);
    await act(async () => { r.unmount(); });
    assert.ok(liveCalls.length >= 1, 'it asks the app server whether the stream is live');
  });

  await t('the sidebar folds to a rail — [ or its button — and remembers', async () => {
    store.clear();
    window.innerWidth = 1280;
    let r;
    await act(async () => { r = TR.create(h(Shell), { createNodeMock: nodeMock() }); });
    const wrap = () => r.root.find((n) => typeof n.type === 'string' && String(n.props.className || '').includes('ax-wrap'));
    assert.ok(wrap().props.className.includes('rail'), 'a 1280px window starts folded when nobody has chosen');
    const live = wrap().findAll((n) => n.type === 'a' && n.props.href === '/app/home')[0];
    assert.strictEqual(live.props.title, 'Home', 'folded, each icon is named on hover');
    await act(async () => { key('['); });
    assert.ok(!wrap().props.className.includes('rail'), '[ unfolds it');
    assert.strictEqual(store.get('pillar.app.rail'), 'full', 'and it is remembered');
    await act(async () => { key('[', { target: typing }); });
    assert.ok(!wrap().props.className.includes('rail'), 'not while typing');
    const btn = byClass(r.root, 'ax-rail-toggle')[0];
    assert.strictEqual(btn.props['aria-label'], 'Show only icons');
    await act(async () => { btn.props.onClick(); });
    assert.ok(wrap().props.className.includes('rail'));
    assert.strictEqual(store.get('pillar.app.rail'), 'rail');
    assert.strictEqual(byClass(r.root, 'ax-rail-toggle')[0].props['aria-label'], 'Show page names');
    await act(async () => { r.unmount(); });
    // a wide window, but the choice was "folded": it stays folded
    window.innerWidth = 1920;
    await act(async () => { r = TR.create(h(Shell), { createNodeMock: nodeMock() }); });
    assert.ok(wrap().props.className.includes('rail'));
    await act(async () => { r.unmount(); });
    // nothing chosen on a wide window: open, and it follows the window until someone chooses
    store.clear();
    await act(async () => { r = TR.create(h(Shell), { createNodeMock: nodeMock() }); });
    assert.ok(!wrap().props.className.includes('rail'), 'a wide window starts with the names');
    window.innerWidth = 1200;
    await act(async () => { window.dispatchEvent({ type: 'resize' }); });
    assert.ok(wrap().props.className.includes('rail'), 'narrowed, it folds');
    // where it folds: the widest window on which the full sidebar would push the phone into a drawer.
    // 1440 (the approved mockup) keeps the names AND all three panes: 1440 − 232 − 44 = 1164 ≥ 1140
    assert.strictEqual(AppShell.RAIL_BELOW, L.WIDE + 2 * AppShell.PAGE_GUTTER + AppShell.SIDE_W - 1);
    assert.strictEqual(AppShell.RAIL_BELOW, 1415);
    for (const [w, folded] of [[1440, false], [1416, false], [1415, true], [1400, true], [1366, true], [1280, true]]) {
      window.innerWidth = w;
      await act(async () => { window.dispatchEvent({ type: 'resize' }); });
      assert.strictEqual(wrap().props.className.includes('rail'), folded, `${w}px starts ${folded ? 'folded' : 'with the names'}`);
      if (!folded) assert.ok(w - AppShell.SIDE_W - 2 * AppShell.PAGE_GUTTER >= L.WIDE, `${w}: three panes beside the full sidebar`);
    }
    // ⌘S never opens the browser's own Save dialog in here
    const e = key('s', { metaKey: true });
    assert.ok(e.defaultPrevented);
    await act(async () => { r.unmount(); });
  });

  // the files the foundation promised: per-page CSS pulled in by appx.css, no StubPage, one import list.
  // (Review fix: appx.css is now only @imports — the phone look, then the shared rules in css/base.css,
  // then each page — so a page rule wins on order alone. The app fonts moved out of the CSS, whose
  // one global bundle made every Pillar page wait on them, into a <link> App pages add.)
  await t('appx.css is the load order: the phone look, the shared rules, then each page\'s own CSS', async () => {
    const css = fs.readFileSync(path.join(PILLAR, 'src/pages/app/appx.css'), 'utf8');
    const imports = css.split('\n').filter((l) => l.startsWith('@import')).map((l) => l.replace(/;$/, ''));
    const order = ['phone', 'base', 'home', 'bulletin', 'groups', 'watch', 'live', 'notifications', 'popup', 'settings'];   // popup: Notifications' Update popup tab (TESTING)
    assert.deepStrictEqual(imports, order.map((f) => `@import './css/${f}.css'`), 'phone.css, base.css, then the pages — in that order');
    for (const f of order) assert.ok(fs.existsSync(path.join(PILLAR, `src/pages/app/css/${f}.css`)), `${f}.css`);
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.trim() && !l.startsWith('@import'));
    assert.deepStrictEqual(rules, [], 'nothing but @imports: the shared rules live in css/base.css');
    assert.ok(!/fonts\.googleapis/.test(css), 'no fonts @import in the CSS');
    const base = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/base.css'), 'utf8');
    assert.ok(/\.ax-work \{ container: work \/ inline-size;/.test(base) && /\.ax-wrap \{/.test(base), 'the frame and the workspace are in base.css');
    for (const f of order.slice(2)) {
      const page = fs.readFileSync(path.join(PILLAR, `src/pages/app/css/${f}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!/!important/.test(page), `${f}.css never needs !important`);
    }
    // the fonts: one <link>, added by App pages (AppShell and PhoneFrame have both rendered by now)
    const links = appended.filter((el) => el.tagName === 'link');
    assert.strictEqual(links.length, 1, 'added once, however many phones and pages');
    assert.strictEqual(links[0].rel, 'stylesheet');
    assert.strictEqual(links[0].href, L.APP_FONTS);
    assert.ok(/family=Be\+Vietnam\+Pro:wght@400;500;600;700&family=Geist:wght@400;600;700/.test(L.APP_FONTS), 'the app\'s weights of both faces');
    assert.strictEqual(L.loadAppFonts(), true);
    assert.strictEqual(appended.filter((el) => el.tagName === 'link').length, 1);
    assert.ok(!fs.existsSync(path.join(PILLAR, 'src/pages/app/StubPage.jsx')), 'the unrouted StubPage is gone');
    const layout = fs.readFileSync(path.join(PILLAR, 'src/pages/app/layout.jsx'), 'utf8');
    const from = [...layout.matchAll(/^import [^;]* from '([^']+)';/gms)].map((m) => m[1]);
    assert.ok(from.every((f) => ['react', '../../lib/icons', './kit'].includes(f)), `layout.jsx imports only react, icons and kit: ${from}`);
    const phone = fs.readFileSync(path.join(PILLAR, 'src/pages/app/css/phone.css'), 'utf8');
    // the member app's LIGHT tokens (BethesdaApp context/ThemeContext.js, constants/site.js)
    for (const [k, v] of [['bg', '#FFFFFF'], ['card', '#F6F4F0'], ['text', '#1A1511'], ['text2', '#6B6055'], ['text3', '#7A6E62'], ['line', '#E9E5DF'], ['pill', '#171310']]) {
      assert.ok(phone.includes(`--ax-app-${k}: ${v};`), `--ax-app-${k}`);
    }
    // the photo header's words stop where the app's do, so a long title wraps where the phone wraps it:
    // Groups pads PAD + useProfileButtonClearance() (20 + 20 + 44 + 10 = 94), the Directory
    // PAD + max(0, clearance − PAD) = 74 with its own kicker (11.5, +1.8). (Integration, 2026-09-23:
    // the app's Groups page went short — PHOTO_H 150, its words 20 from the foot, not 22, the kicker 6
    // over the title — so the header follows it; the intent, the app's own numbers, is unchanged.)
    assert.ok(/\.ax-pa-photohead-words \{[^}]*padding: 0 94px 20px 20px;/.test(phone), 'Groups: 94 on the right, 20 below');
    assert.ok(/\.ax-pa-photohead \{[^}]*height: 209px;/.test(phone), 'the header: 59 under the status bar + PHOTO_H 150');
    assert.ok(/\.ax-pa-photohead-words \.ax-pa-kicker \{ margin-bottom: 6px;/.test(phone), 'Groups: the kicker 6 over the title');
    assert.ok(/\.ax-pa-photohead\.dir \.ax-pa-photohead-words \.ax-pa-kicker \{ margin-bottom: 8px; \}/.test(phone), 'the Directory: 8');
    assert.ok(/\.ax-pa-photohead\.dir \.ax-pa-photohead-words \{ padding: 0 74px 20px 20px; \}/.test(phone), 'Directory: 74 and 20');
    assert.ok(/\.ax-pa-photohead\.dir \.ax-pa-kicker \{ font-size: 11\.5px; letter-spacing: 1\.8px; \}/.test(phone));
    assert.ok(/\.ax-pa-ui \{ font-family: var\(--ax-app-font-ui\); \}/.test(phone), 'Geist for the player and live chat');
    const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
    if (fs.existsSync(path.join(APP, 'screens/GroupsScreen.js'))) {
      const groups = fs.readFileSync(path.join(APP, 'screens/GroupsScreen.js'), 'utf8');
      const dir = fs.readFileSync(path.join(APP, 'screens/DirectoryScreen.js'), 'utf8');
      const btn = fs.readFileSync(path.join(APP, 'components/ProfileButton.js'), 'utf8');
      assert.match(groups, /paddingRight: PAD \+ clearance/);
      assert.match(groups, /head: +\{[^}]*paddingBottom: 20/);
      assert.match(groups, /const PHOTO_H = 150;/);
      assert.match(groups, /kicker: \{[^}]*marginBottom: 6,/);
      assert.match(dir, /const PHOTO_H = 150;/);
      assert.match(dir, /kicker: \{[^}]*marginBottom: 8,/);
      assert.match(dir, /paddingRight: PAD \+ Math\.max\(0, profileClear - PAD\)/);
      assert.match(dir, /photoHead: \{[^}]*paddingBottom: 20/);
      assert.match(dir, /fontSize: 11\.5, letterSpacing: 1\.8/);
      assert.match(btn, /PROFILE_BTN_RIGHT = 20/);
      assert.match(btn, /const GAP = 10/);
      // the player and its live cards really are Geist; the live service's own screen over the picture
      // (components/LiveOverlay.js, 2026-09-23 — it replaced LiveChatOverlay.js) is the app's Be Vietnam Pro
      assert.ok((fs.readFileSync(path.join(APP, 'screens/MediaPlayer.js'), 'utf8').match(/Geist_/g) || []).length >= 10, 'screens/MediaPlayer.js is Geist');
      const overlay = fs.readFileSync(path.join(APP, 'components/LiveOverlay.js'), 'utf8');
      assert.ok(!/Geist_/.test(overlay) && (overlay.match(/BeVietnamPro_/g) || []).length >= 8, 'components/LiveOverlay.js is Be Vietnam Pro');
    }
  });

  // Integration (2026-09-23): the pre-workspace rules (.ax-split and its panels, the old phone
  // drawings — .ax-phone-*, .ax-cp-*, .ax-gcard-*, .ax-push-*, .ax-update-* …) and the phone kit's
  // unused pieces were dead once every page moved to the workspace and PhoneFrame, and went. This keeps
  // it that way: every ax- class the App section's CSS styles is one an App file can put on the page
  // (by name, or by a name built from a prefix, `ax-home-photo-${stock}`).
  await t('no dead CSS: every class the App section styles is one of its pages can set', async () => {
    const dir = path.join(PILLAR, 'src/pages/app');
    const js = fs.readdirSync(dir).filter((f) => /\.jsx?$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const names = new Set(js.match(/ax-[a-z0-9-]+/g));
    const prefixes = [...js.matchAll(/(ax-[a-z0-9-]*-)\$\{/g)].map((m) => m[1]);
    const dead = [];
    for (const f of fs.readdirSync(path.join(dir, 'css')).filter((x) => x.endsWith('.css'))) {
      const css = fs.readFileSync(path.join(dir, 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const c of new Set(css.match(/\.ax-[a-z0-9-]+/g))) {
        const name = c.slice(1);
        if (!names.has(name) && !prefixes.some((p) => name.startsWith(p))) dead.push(`${f} ${c}`);
      }
    }
    assert.deepStrictEqual(dead, [], 'styled but never used');
    assert.ok(!/export function Choices/.test(fs.readFileSync(path.join(dir, 'kit.jsx'), 'utf8')), 'kit.jsx keeps no unused component');
  });

  console.error = oe;
  const other = errs.filter((m) => !/react-test-renderer is deprecated|not wrapped in act/.test(m));
  if (other.length) { console.log('React errors:', other.slice(0, 3)); process.exit(1); }
  console.log(`${ok} layout checks passed`);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
