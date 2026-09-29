// The ESV for the member app's Bible reader (functions/bible-esv, 2026-09-21): Crossway's key stays on
// the server, the app gets verses, and Crossway's limits are kept — with the real rate-limit SQL in
// PGlite. Crossway's API is a test double; nothing here reaches api.esv.org.
//
// Run:  node bible-esv.test.mjs   (Node 23.5+, TypeScript type stripping)
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
  MEMBER_AUTH_KEY: Buffer.alloc(32, 7).toString('base64'), ESV_API_KEY: 'esv-secret-key',
};
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };

// Crossway: John 3 as their text endpoint sends it (shortened), unless a check says otherwise
const JOHN3 = {
  canonical: 'John 3', parsed: [[43003001, 43003036]],
  passages: ['[1] Now there was a man of the Pharisees named Nicodemus, a ruler of the Jews.\n  [2] This man came to Jesus by night and said to him, “Rabbi, we know…”\n\n [3] Jesus answered him,'],
};
const asked = [];
let reply = () => ({ status: 200, body: JOHN3 });
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.esv.org/')) {
    asked.push({ url: new URL(String(url)), auth: init?.headers?.Authorization });
    const r = reply(new URL(String(url)));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const mod = await import(pathToFileURL(path.join(SUPA, 'functions/bible-esv/index.ts')).href);
let ip = 10;
async function call(body, from) {
  const res = await handler(new Request('http://fn/bible-esv', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from || `203.0.113.${ip++}` }, body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text || 'null'), text };
}

// ── set up, or not ──
let r = await call({ ping: true });
ok(r.status === 200 && r.json.ok === true, 'ping: the app lists the ESV once the key is set', r.text);
delete ENV.ESV_API_KEY;
r = await call({ ping: true });
ok(r.status === 503 && !r.json.ok, '… and not before', r.text);
r = await call({ q: 'John 3' });
ok(r.status === 503 && asked.length === 0, 'without a key nothing is asked of Crossway', r.text);
ENV.ESV_API_KEY = 'esv-secret-key';

// ── a chapter ──
r = await call({ q: 'John 3' });
ok(r.status === 200 && r.json.reference === 'John 3', 'John 3 comes back, named as Crossway names it', r.text);
ok(JSON.stringify(r.json.verses.map((v) => [v.book, v.chapter, v.verse])) === JSON.stringify([[43, 3, 1], [43, 3, 2], [43, 3, 3]]),
  'as verses: book 43, chapter 3, verses 1–3', JSON.stringify(r.json.verses));
ok(r.json.verses[1].text === 'This man came to Jesus by night and said to him, “Rabbi, we know…”', 'line breaks and indents folded away', r.json.verses[1].text);
const a = asked.at(-1);
ok(a.auth === 'Token esv-secret-key', 'the key goes to Crossway, in their header');
ok(a.url.searchParams.get('q') === 'John 3' && a.url.searchParams.get('include-headings') === 'false'
  && a.url.searchParams.get('include-footnotes') === 'false' && a.url.searchParams.get('include-verse-numbers') === 'true'
  && a.url.searchParams.get('include-short-copyright') === 'false', 'just the words and their numbers are asked for', a.url.search);
ok(!r.text.includes('esv-secret-key'), 'the key is never in a reply');

// ── reading Crossway's verse numbers ──
const two = mod.versesOf({ parsed: [[43003035, 43004002]], passages: ['[35] The Father loves the Son [36] Whoever believes [1] Now when Jesus learned [2] (although Jesus himself'] });
ok(JSON.stringify(two.map((v) => `${v.chapter}:${v.verse}`)) === JSON.stringify(['3:35', '3:36', '4:1', '4:2']), 'a number that goes back down is the next chapter', JSON.stringify(two));
const named = mod.versesOf({ parsed: [[19023001, 19024001]], passages: ['[1] The LORD is my shepherd; [6] and I shall dwell [24:1] The earth is the LORD’s'] });
ok(named.at(-1).chapter === 24 && named.at(-1).verse === 1, 'a chapter the text names ("[24:1]") is taken as named', JSON.stringify(named));
ok(mod.versesOf({ passages: ['[1] words'] }).length === 0 && mod.versesOf({ parsed: [[43003001]], passages: [] }).length === 0,
  'nothing to read, nothing made up');

// ── what the app may ask ──
// (a semicolon is fine — "John 3:16; 4:1" — and the words go to Crossway as a URL parameter, never into SQL)
for (const bad of ['', ' ', 'x'.repeat(61), '<script>', 'John 3 & 4', 'https://evil.example/', 'john\n3']) {
  const before = asked.length;
  r = await call({ q: bad });
  ok(r.status === 400 && asked.length === before, `refused, and Crossway not asked: ${JSON.stringify(bad).slice(0, 24)}`, r.text);
}
r = await call({ q: 'Psalm 23:1–6' });
ok(r.status === 200, 'a reference with an en dash is fine', r.text);

// ── when Crossway says no ──
reply = () => ({ status: 401, body: { detail: 'Invalid token.' } });
r = await call({ q: 'John 3' });
ok(r.status === 503, 'a key Crossway refuses reads as not set up', r.text);
reply = () => ({ status: 429, body: {} });
r = await call({ q: 'John 3' });
ok(r.status === 429, 'Crossway busy: busy', r.text);
reply = () => ({ status: 500, body: {} });
r = await call({ q: 'John 3' });
ok(r.status === 502, 'Crossway down: try again', r.text);
reply = () => ({ status: 200, body: { canonical: '', parsed: [], passages: [] } });
r = await call({ q: 'Hezekiah 4' });
ok(r.status === 404 && /Hezekiah 4/.test(r.json.error), 'no such passage: said so', r.text);
reply = () => ({ status: 200, body: JOHN3 });

// ── one phone can't use up the church's day ──
const phone = '198.51.100.7';
let codes = [];
for (let i = 0; i < 21; i++) codes.push((await call({ q: 'John 3' }, phone)).status);
ok(codes.slice(0, 20).every((c) => c === 200) && codes[20] === 429, 'twenty a minute from one phone, then busy', JSON.stringify(codes));
r = await call({ q: 'John 3' }, '198.51.100.8');
ok(r.status === 200, '… while another phone still reads', r.text);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
