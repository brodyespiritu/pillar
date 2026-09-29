// Supabase Edge Function — licensed Bibles for the member app's reader (user, 2026-09-24: "I have an API
// key from youversion. Can we add NIV, NLT, ESV now?"):
//
//   NIV  the YouVersion Platform (api.youversion.com), Bible 111 — Biblica's NIV 2011, licensed through
//        YouVersion once the church's app has accepted its license agreement in the Platform portal
//   NLT  Tyndale's own NLT API (api.nlt.to) — YouVersion doesn't carry the NLT
//   (the ESV has its own function, bible-esv — YouVersion doesn't carry the ESV either)
//
// The keys live here, as secrets, never in the app:
//   1. NIV: platform.youversion.com → the church's app → accept the NIV's license → copy the App Key →
//      Supabase → Edge Functions → Secrets: YVP_APP_KEY
//   2. NLT: api.nlt.to → sign up → copy the key → Secrets: NLT_API_KEY
//   3. cd ~/Desktop/Pillar && npx supabase functions deploy bible-licensed --no-verify-jwt
// A version whose key isn't set isn't listed in the app at all.
//
// { ping: true }                            → { versions: ['niv', 'nlt'] }   (the ones that answer)
// { version: 'niv', book: 'JHN', chapter }  → { reference, verses: [{ verse, text }], notice: { text } }
//
// Every chapter goes back with the text its publisher asks to be shown with it: the NIV's is YouVersion's
// own for that version ("always display a Bible Version's copyright attribution"), re-read every few hours
// so it stays current; without one, the NIV isn't shown at all. Both publishers' limits are kept under
// here, and per phone (IP) too, so one phone can't use up the church's day.

import { macHex } from '../_shared/memberCrypto.ts';
import { adminClient, clientIp, json, memberKeys, preflight, rateHit } from '../_shared/memberAuthServer.ts';

export const USFM = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
  'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI',
  'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];
// how api.nlt.to names each book, in the same order (checked against it book by book, 2026-09-24)
export const NLT_BOOK = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes',
  'Song', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah',
  'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1Cor', '2Cor', 'Galatians', 'Ephesians', 'Philippians',
  'Colossians', '1Th', '2Th', '1Tim', '2Tim', 'Titus', 'Philemon', 'Hebrews', 'James', '1Pet', '2Pet',
  '1Jn', '2Jn', '3Jn', 'Jude', 'Revelation',
];

const YV = 'https://api.youversion.com/v1';
const NIV_ID = 111;   // New International Version 2011 (NIV11), Biblica — YouVersion's Bible directory
const NLT_API = 'https://api.nlt.to/api/passages';
export const NLT_NOTICE = 'Scripture quotations are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.';
const ATTRIBUTION_TTL = 6 * 60 * 60 * 1000;

const NAME = { niv: 'The NIV', nlt: 'The NLT' } as const;
type Version = keyof typeof NAME;
type Verse = { verse: number; text: string };

// ── the publishers' HTML, down to verses ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const hasClass = (openTag: string, name: string) => {
  const c = /\bclass\s*=\s*"([^"]*)"/i.exec(openTag);
  return !!c && c[1].split(/\s+/).includes(name);
};

/** Removes every `<tag>` whose class includes one of `names`, with everything inside it (nested alike). */
export function removeElements(html: string, tag: string, names: string[]): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  let out = '';
  let at = 0;
  for (;;) {
    open.lastIndex = at;
    let m: RegExpExecArray | null;
    let found: RegExpExecArray | null = null;
    while ((m = open.exec(html))) { if (names.some((n) => hasClass(m![0], n))) { found = m; break; } }
    if (!found) return out + html.slice(at);
    out += html.slice(at, found.index);
    // walk to its own closing tag
    const any = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    any.lastIndex = found.index + found[0].length;
    let depth = 1;
    let end = html.length;
    let t: RegExpExecArray | null;
    while ((t = any.exec(html))) {
      if (t[1]) depth -= 1; else if (!t[0].endsWith('/>')) depth += 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    at = end;
  }
}

/** The words of `<span class="…">` elements in capitals: small caps for the LORD, as printed. */
function capitals(html: string, names: string[]): string {
  return html.replace(/<span\b([^>]*)>([^<]*)<\/span>/gi, (m, attrs: string, words: string) =>
    (names.some((n) => hasClass(`<span${attrs}>`, n)) ? words.toUpperCase() : m));
}

/** Tags to spaces, entities to characters, the spacing a reader expects. */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?’”)\]])/g, '$1')
    .replace(/([“‘(\[])\s+/g, '$1')
    .trim();
}

/**
 * YouVersion's passage HTML: each verse starts at an empty marker, `<span class="yv-v" v="16"></span>`,
 * then its number (`yv-vlbl`), then its words, until the next marker; headings are `yv-h`, notes `yv-n`.
 */
export function youversionVerses(html: string): Verse[] {
  let h = removeElements(String(html || ''), 'span', ['yv-n', 'yv-vlbl']);
  h = removeElements(h, 'div', ['yv-h']);
  h = capitals(h, ['nd', 'sc']);
  const marker = /<span\b(?=[^>]*\bclass\s*=\s*"(?:[^"]*\s)?yv-v(?:\s[^"]*)?")(?=[^>]*\bv\s*=\s*"([^"]+)")[^>]*>\s*<\/span>/gi;
  const marks = [...h.matchAll(marker)];
  const out: Verse[] = [];
  marks.forEach((m, i) => {
    const verse = parseInt(m[1], 10);
    const from = (m.index ?? 0) + m[0].length;
    const to = i + 1 < marks.length ? (marks[i + 1].index ?? h.length) : h.length;
    const text = plainText(h.slice(from, to));
    if (Number.isInteger(verse) && verse > 0 && text) {
      const prev = out[out.length - 1];
      if (prev && prev.verse === verse) prev.text = `${prev.text} ${text}`;   // a verse split by a heading
      else out.push({ verse, text });
    }
  });
  return out;
}

/**
 * Tyndale's passage HTML: `<verse_export ch="3" vn="16">` around each verse, its number in `span.vn`,
 * translator's notes as `a.a-tn` + `span.tn`, chapter numbers and section headings as h2–h4, and a
 * psalm's own title as `p.psa-title` (a heading here, as the other Bibles in the app have none).
 */
export function nltVerses(html: string, chapter?: number): Verse[] {
  const out: Verse[] = [];
  for (const m of String(html || '').matchAll(/<verse_export\b([^>]*)>([\s\S]*?)<\/verse_export>/gi)) {
    const vn = /\bvn\s*=\s*"(\d+)"/i.exec(m[1]);
    const ch = /\bch\s*=\s*"(\d+)"/i.exec(m[1]);
    if (!vn || (chapter && ch && Number(ch[1]) !== chapter)) continue;
    let h = m[2].replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ' ');
    h = removeElements(h, 'p', ['psa-title']);
    h = removeElements(h, 'a', ['a-tn']);
    h = removeElements(h, 'span', ['tn', 'vn']);
    h = capitals(h, ['sc']);
    const text = plainText(h);
    if (text) out.push({ verse: Number(vn[1]), text });
  }
  return out;
}

// ── the NIV's attribution: YouVersion's own words for the version, kept for a few hours ─────────────
let nivNotice: { text: string; at: number } | null = null;
async function nivAttribution(key: string): Promise<string | null> {
  if (nivNotice && Date.now() - nivNotice.at < ATTRIBUTION_TTL) return nivNotice.text;
  const res = await fetch(`${YV}/bibles/${NIV_ID}`, { headers: { 'X-YVP-App-Key': key } });
  if (!res.ok) return nivNotice?.text ?? null;
  const v = await res.json().catch(() => null);
  const text = plainText(String(v?.copyright || v?.promotional_content || ''));
  if (!text) return null;
  nivNotice = { text, at: Date.now() };
  return text;
}
export function forgetAttribution() { nivNotice = null; }

// ── is it really there? A key can be set before its Bible is: the NIV answers only once its license is
// accepted for the church's app. So the app is told about a version only once a verse actually comes
// back — asked at most every ten minutes (a yes kept an hour), not every time a phone opens the reader.
const works = new Map<Version, { ok: boolean; at: number }>();
export function forgetChecks() { works.clear(); }
async function answers(v: Version, key: string): Promise<boolean> {
  const was = works.get(v);
  if (was && Date.now() - was.at < (was.ok ? 60 : 10) * 60 * 1000) return was.ok;
  let ok = false;
  try {
    if (v === 'niv') {
      const res = await fetch(`${YV}/bibles/${NIV_ID}/passages/GEN.1.1?format=html&include_headings=false&include_notes=false`,
        { headers: { 'X-YVP-App-Key': key } });
      ok = res.ok && youversionVerses((await res.json())?.content).length > 0;
    } else {
      const res = await fetch(`${NLT_API}?${new URLSearchParams({ ref: 'Genesis.1.1', version: 'NLT', key })}`);
      ok = res.ok && nltVerses(await res.text(), 1).length > 0;
    }
  } catch { ok = false; }
  works.set(v, { ok, at: Date.now() });
  return ok;
}

// ── the service ──────────────────────────────────────────────────────────────────────────────────────
const LIMITS: Record<Version, { perMinute: number; perHour: number; perDay: number }> = {
  niv: { perMinute: 120, perHour: 3000, perDay: 20000 },   // YouVersion publishes no limit; well inside any
  nlt: { perMinute: 60,  perHour: 1000, perDay: 4800 },    // Tyndale: 5,000 requests a day with a key
};

const keyFor = (v: Version) => Deno.env.get(v === 'niv' ? 'YVP_APP_KEY' : 'NLT_API_KEY');
const notSetUp = (v: Version) => json({ error: `${NAME[v]} isn’t set up yet.` }, 503);
const busy = (v: Version) => json({ error: `${NAME[v]} is busy right now. Please try again in a little while.` }, 429);
const unreachable = (v: Version) => json({ error: `${NAME[v]} couldn’t be reached. Please try again.` }, 502);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const b = await req.json().catch(() => ({}));
  if (b?.ping) {
    const all = ['niv', 'nlt'] as Version[];
    const up = await Promise.all(all.map((v) => { const k = keyFor(v); return k ? answers(v, k) : false; }));
    return json({ versions: all.filter((_, i) => up[i]) });
  }

  const version = String(b?.version ?? '') as Version;
  if (!(version in NAME)) return json({ error: 'Ask for the NIV or the NLT.' }, 400);
  const key = keyFor(version);
  if (!key) return notSetUp(version);
  const at = USFM.indexOf(String(b?.book ?? ''));
  const chapter = Number(b?.chapter);
  if (at < 0 || !Number.isInteger(chapter) || chapter < 1 || chapter > 150) {
    return json({ error: 'Ask for a book and chapter, like JHN 3.' }, 400);
  }

  const keys = await memberKeys();
  if (!keys) return notSetUp(version);
  try {
    const admin = adminClient();
    const ipId = await macHex(keys.ip, clientIp(req));
    const L = LIMITS[version];
    const refused = await rateHit(admin, [
      { bucket: `${version}-ip-1m`,  key: ipId,  limit: 20,           window_seconds: 60 },
      { bucket: `${version}-ip-1h`,  key: ipId,  limit: 240,          window_seconds: 3600 },
      { bucket: `${version}-all-1m`, key: 'all', limit: L.perMinute,  window_seconds: 60 },
      { bucket: `${version}-all-1h`, key: 'all', limit: L.perHour,    window_seconds: 3600 },
      { bucket: `${version}-all-1d`, key: 'all', limit: L.perDay,     window_seconds: 86400 },
    ]);
    if (refused) return busy(version);

    if (version === 'niv') {
      const url = `${YV}/bibles/${NIV_ID}/passages/${USFM[at]}.${chapter}?format=html&include_headings=false&include_notes=false`;
      const res = await fetch(url, { headers: { 'X-YVP-App-Key': key } });
      // said apart, so whoever sets it up can tell which to fix (never the key itself)
      if (res.status === 401) return json({ error: 'The NIV isn’t set up yet: YouVersion didn’t accept the app key.', reason: 'key' }, 503);
      if (res.status === 403) return json({ error: 'The NIV isn’t set up yet: its license isn’t accepted for the church’s app on the YouVersion Platform.', reason: 'license' }, 503);
      if (res.status === 429) return busy(version);
      if (res.status === 404) return json({ error: `Couldn’t find ${USFM[at]} ${chapter}.` }, 404);
      if (!res.ok) return unreachable(version);
      const data = await res.json();
      const verses = youversionVerses(data?.content);
      if (!verses.length) return json({ error: `Couldn’t find ${USFM[at]} ${chapter}.` }, 404);
      const notice = await nivAttribution(key);
      if (!notice) return unreachable(version);   // never shown without its copyright
      return json({ reference: String(data?.reference || `${USFM[at]} ${chapter}`), verses, notice: { text: notice } });
    }

    const url = `${NLT_API}?${new URLSearchParams({ ref: `${NLT_BOOK[at]}.${chapter}`, version: 'NLT', key })}`;
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) return notSetUp(version);
    if (res.status === 429) return busy(version);
    if (!res.ok) return unreachable(version);
    const html = await res.text();
    const verses = nltVerses(html, chapter);
    if (!verses.length) return json({ error: `Couldn’t find ${USFM[at]} ${chapter}.` }, 404);
    const heading = /class="bk_ch_vs_header"[^>]*>([^<]*)</i.exec(html)?.[1] || '';
    const reference = decodeEntities(heading).replace(/,\s*NLT\s*$/i, '').trim() || `${NLT_BOOK[at]} ${chapter}`;
    return json({ reference, verses, notice: { text: NLT_NOTICE } });
  } catch {
    return unreachable(version);
  }
});
