// The big card at the top of the app's Media tab (src/pages/app/mediaLayout.js, WatchPage.jsx; user,
// 2026-09-21: "make sure I can choose what sermon is the main big card via a toggle in pillar").
// A switch on each sermon puts it there — one at a time; switching it off goes back to the newest.
// It lives in the app server's media layout beside "Suggested for You", and neither undoes the other.
const path = require('path'); const fs = require('fs'); const Module = require('module'); const assert = require('assert');
const DEPS = path.join(__dirname, 'node_modules');
const PILLAR = path.resolve(__dirname, '..');
const APP = process.env.BETHESDA_APP || path.resolve(PILLAR, '../BethesdaApp');
const OUT = path.join(__dirname, '.build-bigcard'); fs.mkdirSync(OUT, { recursive: true });
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

// the app server: it keeps whatever layout it's sent, whole
const server = { layout: { featuredSermonId: null, suggestedIds: ['a'], resourcesOrder: ['r1'] }, puts: [], fail: false };
stub('../../lib/appApi', {
  getMediaLayout: async () => JSON.parse(JSON.stringify(server.layout)),
  putMediaLayout: async (l) => {
    await wait(15);
    if (server.fail) { server.fail = false; throw new Error('The app server said no.'); }
    server.puts.push(JSON.parse(JSON.stringify(l)));
    server.layout = JSON.parse(JSON.stringify(l));
    return l;
  },
});
// the real kit (its save queue), with what it reaches for
stub('../../lib/icons', { P: new Proxy({}, { get: (_, k) => String(k) }), Icon: () => null });
stub('../../lib/dialog', { confirmDialog: async () => true });
stub('../../lib/videoUpload', { uploadVideo: async () => ({}), videoStill: async () => null, videoProblem: () => null, formatBytes: String, isVideoFile: () => false, VIDEO_ACCEPT: '' });
STUBS['./kit'] = xform(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'kit.cjs');
const { useMediaLayout } = require(xform(path.join(PILLAR, 'src/pages/app/mediaLayout.js'), 'mediaLayout.cjs'));

let hook;
function Probe() { hook = useMediaLayout(); return null; }

(async () => {
  let ok = 0; let failed = 0;
  const t = async (name, fn) => {
    try { await fn(); ok++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n').join('\n      ')); }
  };
  let r;
  await act(async () => { r = TR.create(React.createElement(Probe)); });
  await act(async () => { await wait(5); });
  const settle = () => act(async () => { await wait(60); });

  await t('with none switched on, no sermon is the big card (the app shows the newest)', () => {
    assert.strictEqual(hook.ready, true);
    assert.strictEqual(hook.bigCard, null);
    assert.strictEqual(hook.isBig('s1'), false);
  });
  await t('switching one on makes it the big card, and nothing else in the layout moves', async () => {
    await act(async () => { hook.setBig('s2', true); });
    await settle();
    assert.strictEqual(hook.isBig('s2'), true);
    assert.deepStrictEqual(server.layout, { featuredSermonId: 's2', suggestedIds: ['a'], resourcesOrder: ['r1'] });
  });
  await t('one at a time: another switched on takes its place', async () => {
    await act(async () => { hook.setBig('s3', true); });
    await settle();
    assert.strictEqual(server.layout.featuredSermonId, 's3');
    assert.strictEqual(hook.isBig('s2'), false);
  });
  await t('switching off one that isn’t the big card changes nothing', async () => {
    await act(async () => { hook.setBig('s2', false); });
    await settle();
    assert.strictEqual(server.layout.featuredSermonId, 's3');
  });
  await t('switching the big card off goes back to the newest', async () => {
    await act(async () => { hook.setBig('s3', false); });
    await settle();
    assert.strictEqual(server.layout.featuredSermonId, null);
    assert.strictEqual(hook.bigCard, null);
  });
  await t('two switches at once: each saves on top of the other, neither is lost', async () => {
    server.puts.length = 0;
    await act(async () => { hook.toggle('b', true); hook.setBig('s1', true); });
    await settle();
    assert.deepStrictEqual(server.layout, { featuredSermonId: 's1', suggestedIds: ['a', 'b'], resourcesOrder: ['r1'] });
    assert.strictEqual(server.puts.length, 2, 'one save each, in turn');
    assert.deepStrictEqual(server.puts[0].suggestedIds, ['a', 'b']);
  });
  await t('ids are kept as text, as the app looks them up', async () => {
    await act(async () => { hook.setBig(1790012374575, true); });
    await settle();
    assert.strictEqual(server.layout.featuredSermonId, '1790012374575');
    assert.strictEqual(hook.isBig('1790012374575'), true);
  });
  await t('a save the server refuses is put back, and says why', async () => {
    server.fail = true;
    await act(async () => { hook.setBig('s9', true); });
    await settle();
    assert.strictEqual(hook.isBig('s9'), false);
    assert.strictEqual(hook.bigCard, '1790012374575');
    assert.strictEqual(hook.error, 'The app server said no.');
  });

  const page = fs.readFileSync(path.join(PILLAR, 'src/pages/app/WatchPage.jsx'), 'utf8');
  // Redesign (2026-09-23, DESIGN.md §4): the placement switches moved from a row under the form into
  // the editor's head (Fitts's law) — one BigCardSwitch component, a short "Big card" chip there with
  // "Big card on Media" in full wherever there's room for its line (the More menu, a sermon opened over
  // its series). The promise is the same: every sermon has the switch, ahead of Featured, and the list
  // marks the big card.
  await t('each sermon has the switch, first in its row, and the list marks the big card', () => {
    const sw = page.slice(page.indexOf('function BigCardSwitch('), page.indexOf('function SuggestedSwitch('));
    assert.ok(/'Big card on Media'/.test(sw), 'the switch, by its full name');
    assert.ok(/onChange=\{\(on\) => sugg\.setBig\(row\.id, on\)\}/.test(sw));
    const editor = page.slice(page.indexOf('function SermonEditor('), page.indexOf('function SeriesView('));
    const head = editor.slice(editor.indexOf('switches={('));
    assert.ok(head.indexOf('bigSwitch(') > 0 && head.indexOf('bigSwitch(') < head.indexOf('featSwitch('), 'in the head, before Featured');
    assert.ok(/const bigSwitch = \(chip\) => <BigCardSwitch /.test(editor));
    assert.ok(/sugg\.isBig\(r\.id\) && 'Big card'/.test(page), 'the list says which one it is');
  });
  await t('the app shows that sermon, else the newest', () => {
    const screen = fs.readFileSync(path.join(APP, 'screens/SermonsScreen.js'), 'utf8');
    assert.ok(/const chosen = layout\.featuredSermonId != null \? byId\[String\(layout\.featuredSermonId\)\] : null;/.test(screen), 'the office’s pick, by its id');
    assert.ok(/const featured = chosen \|\| sermons\[0\];/.test(screen), 'else the newest');
  });

  await act(async () => r.unmount());
  console.log(`\n${ok} big-card checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
