// The NIV and the NLT for the member app's Bible reader (functions/bible-licensed, 2026-09-24): the NIV
// from the YouVersion Platform, the NLT from Tyndale's NLT API; both keys stay on the server, the app
// gets verses and the words each publisher asks to be shown with them, and their limits are kept — with
// the real rate-limit SQL in PGlite. Both services are test doubles answering in their own markup (the
// words are made up); nothing here reaches api.youversion.com or api.nlt.to.
//
// Run:  node bible-licensed.test.mjs   (Node 23.5+, TypeScript type stripping)
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HERE, SUPA, supabaseLikeDb } from './_pg.mjs';

const STUB = pathToFileURL(path.join(HERE, 'supabase-js-stub.mjs')).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('npm:@supabase/supabase-js')) return { url: STUB, shortCircuit: true };
    return next(specifier, context);
  },
});

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};

const { db, as, migrationError } = await supabaseLikeDb();
if (migrationError) { console.log('migration failed:', migrationError); process.exit(1); }
const stub = await import(STUB);
stub.world.db = db; stub.world.as = as;

const ENV = {
  SUPABASE_URL: 'http://pg.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role', SUPABASE_ANON_KEY: 'anon-key',
  MEMBER_AUTH_KEY: Buffer.alloc(32, 7).toString('base64'), YVP_APP_KEY: 'yv-app-key-123', NLT_API_KEY: 'nlt-key-456',
};
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };

// YouVersion's passage HTML, in its own markup (as its SDK's test data has it): an empty marker per
// verse, its number, then its words; a heading and a note between them; the LORD in small caps
const YV_CHAPTER = {
  id: 'PSA.23', reference: 'Psalm 23',
  content: '<div><div class="d">Of David.</div><div class="q1"><span class="yv-v" v="1"></span><span class="yv-vlbl">1</span>The <span class="nd">Lord</span> keeps watch,</div>'
    + '<div class="q2">and I lack&nbsp;nothing.</div><div class="s1 yv-h">A Made-Up Heading</div>'
    + '<div class="q1"><span class="yv-v" v="2"></span><span class="yv-vlbl">2</span>He brings me by still water<span class="yv-n f"><span class="fr">23:2 </span><span class="ft">Or </span><span class="fqa">quiet <span class="it">streams</span></span></span> ,</div>'
    + '<div class="q2">and gives me rest.</div><div class="q1"><span class="yv-v" v="3"></span><span class="yv-vlbl">3</span>&#8220;Walk on,&#8221; he says &amp; I go.</div></div>',
};
const YV_VERSION = { id: 111, abbreviation: 'NIV11', title: 'New International Version 2011', copyright: 'Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by permission. All rights reserved worldwide.' };
// Tyndale's passage HTML, in its own markup: verse_export around each verse, its number in span.vn, a
// translator's note, a chapter number and a subhead, poetry lines, a psalm title
const NLT_CHAPTER = '<!DOCTYPE html><html><body><div id="bibletext"><section><h2 class="bk_ch_vs_header">Psalm 23:1-3, NLT</h2>'
  + '<verse_export orig="psal_23_1" bk="psal" ch="23" vn="1">\n<h3 class="chapter-number"><span class="cw">Psalm</span> <span class="cw_ch">23</span></h3>\n<h4 class="subhead">The <span class="subhead-sc">Lord</span> Made Up</h4>\n<p class="psa-title">A made-up title.</p>\n<p class="poet1-vn-sp"><span class="vn">1</span>The <span class="sc">Lord</span> keeps watch;</p>\n<p class="poet2">I lack nothing.</p>\n</verse_export>'
  + '<verse_export orig="psal_23_2" bk="psal" ch="23" vn="2"><span class="vn">2</span><span class="red">He brings me by still water,<a class="a-tn">*</a><span class="tn"><span class="tn-ref">23:2</span> Or <em>quiet streams.</em></span> and gives me rest.</span> </verse_export>'
  + '<verse_export orig="psal_23_3" bk="psal" ch="23" vn="3"><span class="vn">3</span>“Walk on,” he says.<p>\n</verse_export>'
  + '<verse_export orig="psal_24_1" bk="psal" ch="24" vn="1"><span class="vn">1</span>Not this chapter.</verse_export>'
  + '</section></div></body></html>';

const asked = [];
let yvReply = (u) => (u.pathname.endsWith('/bibles/111') ? { status: 200, body: YV_VERSION } : { status: 200, body: YV_CHAPTER });
const NLT_GEN_1_1 = '<html><body><h2 class="bk_ch_vs_header">Genesis 1:1, NLT</h2><verse_export orig="gene_1_1" bk="gene" ch="1" vn="1"><span class="vn">1</span>Made-up words.</verse_export></body></html>';
const nltAnswer = (u) => ({ status: 200, text: u.searchParams.get('ref') === 'Genesis.1.1' ? NLT_GEN_1_1 : NLT_CHAPTER });
let nltReply = nltAnswer;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.origin === 'https://api.youversion.com') {
    asked.push({ who: 'yv', url: u, key: init?.headers?.['X-YVP-App-Key'] });
    const r = yvReply(u);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.origin === 'https://api.nlt.to') {
    asked.push({ who: 'nlt', url: u });
    const r = nltReply(u);
    return new Response(r.text, { status: r.status, headers: { 'Content-Type': 'text/html' } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const mod = await import(pathToFileURL(path.join(SUPA, 'functions/bible-licensed/index.ts')).href);
let ip = 10;
async function call(body, from) {
  const res = await handler(new Request('http://fn/bible-licensed', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from || `203.0.113.${ip++}` }, body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text || 'null'), text };
}
const words = (vs) => JSON.stringify(vs.map((v) => [v.verse, v.text]));

// ── set up, or not ──
let r = await call({ ping: true });
ok(r.status === 200 && JSON.stringify(r.json.versions) === '["niv","nlt"]', 'ping: the app lists both once their keys are set and a verse comes back', r.text);
ok(asked.some((a) => a.who === 'yv' && a.url.pathname.endsWith('/passages/GEN.1.1')) && asked.some((a) => a.who === 'nlt' && a.url.searchParams.get('ref') === 'Genesis.1.1'),
  '… each tried with one verse');
const tries = asked.length;
await call({ ping: true });
ok(asked.length === tries, '… and not tried again with every phone that opens the reader');
mod.forgetChecks();
yvReply = (u) => (u.pathname.includes('/passages/') ? { status: 403, body: { message: 'Forbidden' } } : { status: 200, body: YV_VERSION });
r = await call({ ping: true });
ok(JSON.stringify(r.json.versions) === '["nlt"]', "a key set but the NIV's license not accepted: not listed yet", r.text);
yvReply = (u) => (u.pathname.endsWith('/bibles/111') ? { status: 200, body: YV_VERSION } : { status: 200, body: YV_CHAPTER });
r = await call({ ping: true });
ok(JSON.stringify(r.json.versions) === '["nlt"]', '… a no is kept for a few minutes', r.text);
mod.forgetChecks();
delete ENV.NLT_API_KEY;
r = await call({ ping: true });
ok(JSON.stringify(r.json.versions) === '["niv"]', 'no key: not listed, and Tyndale not asked', r.text);
const nltAsks = asked.filter((a) => a.who === 'nlt').length;
r = await call({ version: 'nlt', book: 'PSA', chapter: 23 });
ok(r.status === 503 && asked.filter((a) => a.who === 'nlt').length === nltAsks, 'without its key nothing is asked of Tyndale', r.text);
ENV.NLT_API_KEY = 'nlt-key-456';

// ── the NIV ──
r = await call({ version: 'niv', book: 'PSA', chapter: 23 });
ok(r.status === 200 && r.json.reference === 'Psalm 23', 'Psalm 23 in the NIV, named as YouVersion names it', r.text);
ok(words(r.json.verses) === words([
  { verse: 1, text: 'The LORD keeps watch, and I lack nothing.' },
  { verse: 2, text: 'He brings me by still water, and gives me rest.' },
  { verse: 3, text: '“Walk on,” he says & I go.' },
]), 'as verses: numbers, headings and notes left out, lines joined, the LORD in capitals', JSON.stringify(r.json.verses));
ok(!JSON.stringify(r.json.verses).includes('Of David'), 'words before the first verse (a psalm title) are not a verse');
ok(r.json.notice?.text === YV_VERSION.copyright, "with the version's own copyright from YouVersion", r.text);
const passage = asked.filter((a) => a.who === 'yv' && a.url.pathname.includes('/passages/PSA')).at(-1);
ok(passage.url.pathname === '/v1/bibles/111/passages/PSA.23' && passage.url.searchParams.get('format') === 'html'
  && passage.url.searchParams.get('include_headings') === 'false' && passage.url.searchParams.get('include_notes') === 'false',
  'Bible 111, the chapter by its code, just the words asked for', passage.url.href);
ok(asked.filter((a) => a.who === 'yv').every((a) => a.key === 'yv-app-key-123'), 'the app key goes to YouVersion, in its header');
ok(!r.text.includes('yv-app-key-123'), 'the key is never in a reply');
let versionReads = asked.filter((a) => a.who === 'yv' && a.url.pathname.endsWith('/bibles/111')).length;
await call({ version: 'niv', book: 'JHN', chapter: 3 });
ok(asked.filter((a) => a.who === 'yv' && a.url.pathname.endsWith('/bibles/111')).length === versionReads,
  'its copyright is kept for a while, not asked for with every chapter');
mod.forgetAttribution();
yvReply = (u) => (u.pathname.endsWith('/bibles/111') ? { status: 200, body: { ...YV_VERSION, copyright: '', promotional_content: '' } } : { status: 200, body: YV_CHAPTER });
r = await call({ version: 'niv', book: 'PSA', chapter: 23 });
ok(r.status === 502 && !r.json.verses, 'no copyright to show with it: the NIV is not shown at all', r.text);
yvReply = (u) => (u.pathname.endsWith('/bibles/111') ? { status: 200, body: { ...YV_VERSION, copyright: null, promotional_content: 'Promo <b>line</b>.' } } : { status: 200, body: YV_CHAPTER });
r = await call({ version: 'niv', book: 'PSA', chapter: 23 });
ok(r.status === 200 && r.json.notice.text === 'Promo line.', 'no short copyright: the long one, as its SDK does', r.text);
yvReply = () => ({ status: 403, body: { message: 'Forbidden' } });
mod.forgetAttribution();
r = await call({ version: 'niv', book: 'PSA', chapter: 23 });
ok(r.status === 503 && /set up/.test(r.json.error) && r.json.reason === 'license', 'a license not accepted reads as not set up, and says why', r.text);
yvReply = () => ({ status: 401, body: { message: 'Unauthorized' } });
r = await call({ version: 'niv', book: 'PSA', chapter: 23 });
ok(r.status === 503 && r.json.reason === 'key' && !r.text.includes('yv-app-key-123'), 'a key YouVersion refuses says so — without the key', r.text);
yvReply = () => ({ status: 429, body: {} });
ok((await call({ version: 'niv', book: 'PSA', chapter: 23 })).status === 429, 'YouVersion busy: busy');
yvReply = () => ({ status: 500, body: {} });
ok((await call({ version: 'niv', book: 'PSA', chapter: 23 })).status === 502, 'YouVersion down: try again');
yvReply = (u) => (u.pathname.endsWith('/bibles/111') ? { status: 200, body: YV_VERSION } : { status: 200, body: YV_CHAPTER });

// ── the NLT ──
r = await call({ version: 'nlt', book: 'PSA', chapter: 23 });
ok(r.status === 200 && r.json.reference === 'Psalm 23:1-3', 'Psalm 23 in the NLT', r.text);
ok(words(r.json.verses) === words([
  { verse: 1, text: 'The LORD keeps watch; I lack nothing.' },
  { verse: 2, text: 'He brings me by still water, and gives me rest.' },
  { verse: 3, text: '“Walk on,” he says.' },
]), "as verses: numbers, headings, the psalm's title and the translator's notes left out; another chapter's verse too", JSON.stringify(r.json.verses));
ok(r.json.notice?.text === mod.NLT_NOTICE && /Tyndale House Foundation/.test(mod.NLT_NOTICE), "with Tyndale's copyright statement");
const nlt = asked.filter((a) => a.who === 'nlt').at(-1);
ok(nlt.url.pathname === '/api/passages' && nlt.url.searchParams.get('ref') === 'Psalms.23' && nlt.url.searchParams.get('version') === 'NLT'
  && nlt.url.searchParams.get('key') === 'nlt-key-456', 'the chapter by the name Tyndale knows it, with the key', nlt.url.href);
ok(!r.text.includes('nlt-key-456'), 'the key is never in a reply');
await call({ version: 'nlt', book: '1CO', chapter: 13 });
await call({ version: 'nlt', book: 'SNG', chapter: 2 });
await call({ version: 'nlt', book: '3JN', chapter: 1 });
ok(JSON.stringify(asked.filter((a) => a.who === 'nlt').slice(-3).map((a) => a.url.searchParams.get('ref'))) === '["1Cor.13","Song.2","3Jn.1"]',
  "numbered books and the Song by Tyndale's names");
ok(mod.NLT_BOOK.length === 66 && mod.USFM.length === 66 && new Set(mod.NLT_BOOK).size === 66, 'every book has a name for Tyndale, once');
nltReply = () => ({ status: 401, text: 'no' });
ok((await call({ version: 'nlt', book: 'PSA', chapter: 23 })).status === 503, 'a key Tyndale refuses reads as not set up');
nltReply = () => ({ status: 200, text: '<html><body>No passage</body></html>' });
r = await call({ version: 'nlt', book: 'PSA', chapter: 151 });
ok(r.status === 400, 'a chapter past any book is refused before anyone is asked', r.text);
r = await call({ version: 'nlt', book: 'PSA', chapter: 150 });
ok(r.status === 404, 'nothing came back: said so', r.text);
nltReply = nltAnswer;

// ── the HTML helpers on their own ──
ok(mod.decodeEntities('&#8220;A&#x2019;s&#8221; &amp; &nbsp;&bogus;') === '“A’s” &  &bogus;', 'entities decoded, unknown ones left alone');
ok(mod.removeElements('<p>a<span class="x">b<span class="y">c</span>d</span>e</p>', 'span', ['x']) === '<p>ae</p>', 'a nested element goes whole');
ok(mod.youversionVerses('').length === 0 && mod.nltVerses(null).length === 0, 'nothing to read, nothing made up');
ok(words(mod.youversionVerses('<div class="p"><span class="yv-v" v="5"></span><span class="yv-vlbl">5</span>One part</div><div class="s1 yv-h">Head</div><div class="p"><span class="yv-v" v="5"></span>and the rest.</div>'))
  === words([{ verse: 5, text: 'One part and the rest.' }]), 'a verse a heading splits in two comes back whole');
ok(words(mod.youversionVerses('<div class="p"><span v="7" class="yv-v"></span><span class="yv-vlbl">7</span>Either order.</div>'))
  === words([{ verse: 7, text: 'Either order.' }]), "the marker's attributes in either order");

// ── what the app may ask ──
for (const bad of [{ version: 'kjv', book: 'JHN', chapter: 3 }, { version: 'niv', book: 'john', chapter: 3 }, { version: 'niv', book: 'JHN', chapter: 0 },
  { version: 'niv', book: 'JHN', chapter: '3; drop' }, { version: 'niv', book: '<x>', chapter: 1 }, {}]) {
  const before = asked.length;
  r = await call(bad);
  ok(r.status === 400 && asked.length === before, `refused, and nobody asked: ${JSON.stringify(bad).slice(0, 40)}`, r.text);
}

// ── one phone can't use up the church's day ──
const phone = '198.51.100.7';
const codes = [];
for (let i = 0; i < 21; i++) codes.push((await call({ version: 'niv', book: 'JHN', chapter: 3 }, phone)).status);
ok(codes.slice(0, 20).every((c) => c === 200) && codes[20] === 429, 'twenty a minute from one phone, then busy', JSON.stringify(codes));
ok((await call({ version: 'niv', book: 'JHN', chapter: 3 }, '198.51.100.8')).status === 200, '… while another phone still reads');
ok((await call({ version: 'nlt', book: 'PSA', chapter: 23 }, phone)).status === 200, '… and each version counts on its own');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
