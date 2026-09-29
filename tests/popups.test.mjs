// The update popup (Pillar/src/lib/testPopups.js — TESTING, goes with the app's test kit): what the
// editor's HTML becomes, what the editor opens with, and what Pillar asks of the database. The HTML here
// is what browsers actually write into a contenteditable (Chrome's <div>s, Safari's styled <span>s) and
// what gets pasted into one (a Word document, a web page with a script in it).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const OUT = path.join(import.meta.dirname, 'build');
fs.mkdirSync(OUT, { recursive: true });

const rpcs = [];
let rpcAnswer = { data: 'popup-1', error: null };
let rows = { data: [], error: null };
const queries = [];
globalThis.__supabase = {
  rpc: async (name, args) => { rpcs.push({ name, args }); return rpcAnswer; },
  from: (table) => {
    const q = { table, order: null, limit: null };
    const chain = {
      select: (cols) => { q.cols = cols; return chain; },
      order: (c, o) => { q.order = [c, o]; return chain; },
      limit: (n) => { q.limit = n; return chain; },
      then: (res, rej) => { queries.push(q); return Promise.resolve(rows).then(res, rej); },
    };
    return chain;
  },
};
let src = fs.readFileSync(path.join(PILLAR, 'src/lib/testPopups.js'), 'utf8');
assert.ok(src.includes("import { supabase } from './supabase';"));
src = src.replace("import { supabase } from './supabase';", 'const supabase = globalThis.__supabase;');
fs.writeFileSync(path.join(OUT, 'testPopups.mjs'), src);
const L = await import(pathToFileURL(path.join(OUT, 'testPopups.mjs')).href);

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };
const doc = (...blocks) => ({ v: 1, blocks });

console.log('\n── what the editor writes, as the phone gets it ──');

await t('Chrome: a line a <div>, an empty line a <div><br></div>, formatting as tags', () => {
  const d = L.htmlToDoc('Here’s what’s new:<div><br></div><div>The <b>Watch</b> page is <i>faster</i> and <u>simpler</u>.</div><div><strike>Old thing</strike></div>');
  assert.deepStrictEqual(d, doc(
    { t: 'p', s: [{ x: 'Here’s what’s new:' }] },
    { t: 'p', s: [] },
    { t: 'p', s: [{ x: 'The ' }, { x: 'Watch', b: 1 }, { x: ' page is ' }, { x: 'faster', i: 1 }, { x: ' and ' }, { x: 'simpler', u: 1 }, { x: '.' }] },
    { t: 'p', s: [{ x: 'Old thing', k: 1 }] },
  ));
});

await t('bullets, dashes and numbers — and a heading', () => {
  const d = L.htmlToDoc('<h3>New this week</h3><ul><li>Faster <b>Watch</b></li><li>Journal</li></ul><ul class="dash"><li>fixed a bug</li></ul><ol><li>Open it</li><li>Tap it</li></ol>');
  assert.deepStrictEqual(d.blocks.map((b) => [b.t, b.s.map((r) => r.x).join('')]), [
    ['h', 'New this week'], ['bullet', 'Faster Watch'], ['bullet', 'Journal'], ['dash', 'fixed a bug'], ['number', 'Open it'], ['number', 'Tap it'],
  ]);
  assert.deepStrictEqual(d.blocks[1].s, [{ x: 'Faster ' }, { x: 'Watch', b: 1 }]);
});

await t('Safari and pasted text: bold, italic, underline and strike written as styles', () => {
  const d = L.htmlToDoc('<span style="font-weight: 700;">Bold</span> <span style="font-style: italic">it</span> <span style="text-decoration: underline line-through;">both</span> <strong style="font-weight: normal">plain</strong>');
  assert.deepStrictEqual(d.blocks[0].s, [{ x: 'Bold', b: 1 }, { x: ' ' }, { x: 'it', i: 1 }, { x: ' ' }, { x: 'both', u: 1, k: 1 }, { x: ' plain' }]);
});

await t('formatting nests: bold and italic together, and it ends where its tag ends', () => {
  const d = L.htmlToDoc('<b>all <i>both</i> bold</b> after');
  assert.deepStrictEqual(d.blocks[0].s, [{ x: 'all ', b: 1 }, { x: 'both', b: 1, i: 1 }, { x: ' bold', b: 1 }, { x: ' after' }]);
});

await t('nothing but words and those marks survive — no script, no style, no link, no attribute', () => {
  const d = L.htmlToDoc('<div onclick="steal()">Hi<script>alert(1)</script><style>b{}</style> <a href="javascript:x">there</a><img src=x onerror=alert(1)><iframe src="evil"></iframe>!</div>');
  assert.deepStrictEqual(d, doc({ t: 'p', s: [{ x: 'Hi there!' }] }));
  assert.ok(!JSON.stringify(L.htmlToDoc('<p style="color:red" class="MsoNormal"><o:p>Word</o:p> text</p>')).match(/color|Mso|o:p/));
});

await t('a Word paste: its spacing and entities made plain', () => {
  const d = L.htmlToDoc('<p class="MsoNormal">Line&nbsp;one&#8217;s   text\n  wraps</p>\n<p class="MsoNormal">&lt;two&gt; &amp; more</p>');
  assert.deepStrictEqual(d.blocks.map((b) => b.s.map((r) => r.x).join('')), ['Line one’s text wraps', '<two> & more']);
});

await t('empty lines: at most one in a row, none at the start or the end', () => {
  const d = L.htmlToDoc('<div><br></div><div><br></div>One<div><br></div><div><br></div><div><br></div><div>Two</div><div><br></div>');
  assert.deepStrictEqual(d.blocks.map((b) => (b.s.length ? b.s[0].x : '')), ['One', '', 'Two']);
});

await t('tidy makes any object safe: unknown kinds become paragraphs, unknown marks and junk go', () => {
  const d = L.tidy({ blocks: [{ t: 'script', s: [{ x: 'a\u0007b', b: true, color: 'red', href: 'x' }] }, { t: 'number', s: 'nope' }, null, { t: 'h', s: [{ x: 'H' }] }] });
  assert.deepStrictEqual(d, doc({ t: 'p', s: [{ x: 'ab', b: 1 }] }, { t: 'h', s: [{ x: 'H' }] }));
  assert.deepStrictEqual(L.tidy(null), doc());
});

await t('a plain-text paste: "- " dashes, "• " bullets, "1. " numbers, the rest paragraphs', () => {
  const d = L.textToDoc('What’s new:\r\n\n- faster Watch\n• Journal\n* Verses\n2) Sign in\n12. Settings\n   \nThanks!');
  assert.deepStrictEqual(d.blocks.map((b) => [b.t, b.s.map((r) => r.x).join('')]), [
    ['p', 'What’s new:'], ['p', ''], ['dash', 'faster Watch'], ['bullet', 'Journal'], ['bullet', 'Verses'],
    ['number', 'Sign in'], ['number', 'Settings'], ['p', ''], ['p', 'Thanks!'],
  ]);
  assert.strictEqual(L.docSummary(d), 'What’s new:');
  assert.strictEqual(L.docSummary(L.textToDoc('x'.repeat(200)), 20), `${'x'.repeat(19)}…`);
});

console.log('\n── what the editor opens with ──');

await t('the document back to editor HTML, and round again unchanged', () => {
  const d = doc(
    { t: 'h', s: [{ x: 'New <this> week' }] },
    { t: 'p', s: [{ x: 'The ' }, { x: 'Watch', b: 1, i: 1 }, { x: ' page' }] },
    { t: 'p', s: [] },
    { t: 'bullet', s: [{ x: 'one' }] }, { t: 'bullet', s: [{ x: 'two', u: 1 }] },
    { t: 'dash', s: [{ x: 'dash', k: 1 }] },
    { t: 'number', s: [{ x: 'first' }] },
  );
  const html = L.docToHtml(d);
  assert.strictEqual(html, '<h3>New &lt;this&gt; week</h3><div>The <b><i>Watch</i></b> page</div><div><br></div><ul><li>one</li><li><u>two</u></li></ul><ul class="ax-rt-dash"><li><s>dash</s></li></ul><ol><li>first</li></ol>');
  assert.deepStrictEqual(L.htmlToDoc(html), d, 'what the editor saves is what it opened');
});

await t('counting: the words alone', () => {
  const d = L.htmlToDoc('<b>Hello</b> there<ul><li>x</li></ul>');
  assert.strictEqual(L.docText(d), 'Hello there\nx');
  assert.strictEqual(L.docLength(d), 12);
  assert.ok(L.docEmpty(L.htmlToDoc('<div><br></div> &nbsp; ')) && !L.docEmpty(d));
});

console.log('\n── what Pillar asks of the database ──');

await t('posting: the title and the tidy document, through app_test_popup_post', async () => {
  rpcs.length = 0;
  await L.postPopup({ title: '  Recent updates ', body: L.htmlToDoc('<b>New</b><script>x</script>') });
  assert.deepStrictEqual(rpcs, [{ name: 'app_test_popup_post', args: { p_title: 'Recent updates', p_body: doc({ t: 'p', s: [{ x: 'New', b: 1 }] }) } }]);
});

await t('nothing sent that the phone would refuse to show', async () => {
  rpcs.length = 0;
  await assert.rejects(() => L.postPopup({ title: ' ', body: L.htmlToDoc('x') }), /title/);
  await assert.rejects(() => L.postPopup({ title: 'T', body: L.htmlToDoc('<div><br></div>') }), /Write what’s new/);
  await assert.rejects(() => L.postPopup({ title: 'x'.repeat(81), body: L.htmlToDoc('x') }), /under 80/);
  await assert.rejects(() => L.postPopup({ title: 'T', body: L.htmlToDoc('y'.repeat(3001)) }), /3,000/);
  assert.strictEqual(rpcs.length, 0);
});

await t('editing the one that is up, and taking it down', async () => {
  rpcs.length = 0;
  await L.editPopup('popup-1', { title: 'Fixed', body: L.htmlToDoc('Typo gone') });
  await L.takeDownPopup();
  await L.restorePopup('popup-1');
  assert.deepStrictEqual(rpcs.map((r) => r.name), ['app_test_popup_edit', 'app_test_popup_take_down', 'app_test_popup_restore']);
  assert.deepStrictEqual(rpcs[2].args, { p_id: 'popup-1' }, 'Undo puts the same one back');
  assert.strictEqual(rpcs[0].args.p_id, 'popup-1');
});

await t('reading: the live one and the last few, newest first, each document tidied', async () => {
  rows = { data: [
    { id: 'a', title: 'Now', body: { blocks: [{ t: 'p', s: [{ x: 'up', evil: 1 }] }] }, live: true, posted_at: '2026-09-24' },
    { id: 'b', title: 'Before', body: doc({ t: 'p', s: [{ x: 'old' }] }), live: false, posted_at: '2026-09-23' },
  ], error: null };
  const got = await L.fetchPopups();
  assert.strictEqual(got.live.id, 'a');
  assert.deepStrictEqual(got.live.body, doc({ t: 'p', s: [{ x: 'up' }] }));
  assert.deepStrictEqual(got.earlier.map((r) => r.id), ['b']);
  assert.strictEqual(queries.at(-1).table, 'app_test_popups');
});

await t('before the SQL is run: says what to run', async () => {
  rpcAnswer = { data: null, error: { message: 'Could not find the function public.app_test_popup_post in the schema cache' } };
  await assert.rejects(() => L.postPopup({ title: 'T', body: L.htmlToDoc('x') }), /app-test-popups\.sql/);
  rpcAnswer = { data: null, error: { message: 'Only church staff can post the update popup.' } };
  await assert.rejects(() => L.postPopup({ title: 'T', body: L.htmlToDoc('x') }), /Only church staff/);
  rpcAnswer = { data: 'popup-1', error: null };
});

console.log(`\n${ok} popup checks passed`);
