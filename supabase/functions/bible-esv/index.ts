// Supabase Edge Function — the ESV for the member app's Bible reader (user, 2026-09-21: "Add more
// version of the bible. Preferably, NKJV, NIV, ESV, etc"), from Crossway's ESV API (api.esv.org).
//
// Crossway lets a church use it free of charge for non-commercial use, with an access key of its own —
// and "You may not sell, share, or publish your access key", so the key lives here, as a secret, and
// never in the app.
//   1. api.esv.org → sign in → "Create an Application" (a church, non-commercial) → copy the key
//   2. Supabase → Edge Functions → Secrets: ESV_API_KEY = that key
//   3. cd ~/Desktop/Pillar && npx supabase functions deploy bible-esv --no-verify-jwt
// Until then the app doesn't list the ESV at all.
//
// { ping: true }              → { ok: true } once the key is set (the app lists the ESV only then)
// { q: 'John 3' | 'ps 23' }   → { reference, verses: [{ book (1–66), chapter, verse, text }] }
//
// Crossway's limits — 500 verses a query or half a book, 5,000 queries a day, no more than 1,000 an
// hour and 60 a minute — are kept under here, and per phone (IP) too, so one phone can't use up the
// church's day. The app shows the ESV's copyright line and a link to www.esv.org with every chapter.

import { macHex } from '../_shared/memberCrypto.ts';
import { adminClient, clientIp, json, memberKeys, preflight, rateHit } from '../_shared/memberAuthServer.ts';

const API = 'https://api.esv.org/v3/passage/text/';
const QUERY_OK = /^[\p{L}\p{N} .:,;'’\-–]{1,60}$/u;

// just the words and their verse numbers: no headings, notes, references or copyright in the text
const OPTIONS = {
  'include-passage-references': 'false',
  'include-verse-numbers': 'true',
  'include-first-verse-numbers': 'true',
  'include-footnotes': 'false',
  'include-footnote-body': 'false',
  'include-headings': 'false',
  'include-short-copyright': 'false',
  'include-copyright': 'false',
  'include-selahs': 'true',
  'indent-paragraphs': '0',
  'indent-poetry': 'false',
  'indent-poetry-lines': '0',
  'indent-declares': '0',
  'indent-psalm-doxology': '0',
  'line-length': '0',
};

type Verse = { book: number; chapter: number; verse: number; text: string };

/**
 * Crossway's text, "[1] In the beginning… [2] The earth…", into verses. Verse ids are BBCCCVVV; a
 * passage starts where `parsed` says, and a verse number that goes back down is the next chapter
 * ("[1]" again) unless the text names it ("[4:1]").
 */
export function versesOf(data: { parsed?: number[][]; passages?: string[] }): Verse[] {
  const start = data?.parsed?.[0]?.[0];
  if (!Number.isInteger(start)) return [];
  const book = Math.floor(start / 1000000);
  let chapter = Math.floor(start / 1000) % 1000;
  const text = (data.passages || []).join(' ');
  const marks = [...text.matchAll(/\[(?:(\d+):)?(\d+)\]/g)];
  const out: Verse[] = [];
  let last = 0;
  marks.forEach((m, i) => {
    const verse = Number(m[2]);
    if (m[1]) chapter = Number(m[1]);
    else if (out.length && verse <= last) chapter += 1;
    last = verse;
    const from = (m.index ?? 0) + m[0].length;
    const to = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : text.length;
    const words = text.slice(from, to).replace(/\s+/g, ' ').trim();
    if (words) out.push({ book, chapter, verse, text: words });
  });
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const key = Deno.env.get('ESV_API_KEY');
  const b = await req.json().catch(() => ({}));
  if (b?.ping) return key ? json({ ok: true }) : json({ error: 'The ESV isn’t set up yet.' }, 503);
  if (!key) return json({ error: 'The ESV isn’t set up yet.' }, 503);

  const q = String(b?.q ?? '').trim();
  if (!QUERY_OK.test(q)) return json({ error: 'Ask for a passage, like John 3 or John 3:16.' }, 400);

  const keys = await memberKeys();
  if (!keys) return json({ error: 'The ESV isn’t set up yet.' }, 503);
  try {
    const admin = adminClient();
    const ipId = await macHex(keys.ip, clientIp(req));
    const refused = await rateHit(admin, [
      { bucket: 'esv-ip-1m',  key: ipId,  limit: 20,   window_seconds: 60 },
      { bucket: 'esv-ip-1h',  key: ipId,  limit: 240,  window_seconds: 3600 },
      { bucket: 'esv-all-1m', key: 'all', limit: 55,   window_seconds: 60 },
      { bucket: 'esv-all-1h', key: 'all', limit: 950,  window_seconds: 3600 },
      { bucket: 'esv-all-1d', key: 'all', limit: 4800, window_seconds: 86400 },
    ]);
    if (refused) return json({ error: 'The ESV is busy right now. Please try again in a little while.' }, 429);

    const url = `${API}?${new URLSearchParams({ q, ...OPTIONS })}`;
    const res = await fetch(url, { headers: { Authorization: `Token ${key}` } });
    if (res.status === 401 || res.status === 403) return json({ error: 'The ESV isn’t set up yet.' }, 503);
    if (res.status === 429) return json({ error: 'The ESV is busy right now. Please try again in a little while.' }, 429);
    if (!res.ok) return json({ error: 'The ESV couldn’t be reached. Please try again.' }, 502);
    const data = await res.json();
    const verses = versesOf(data);
    if (!verses.length) return json({ error: `Couldn’t find “${q}”.` }, 404);
    return json({ reference: String(data.canonical || q), verses });
  } catch {
    return json({ error: 'The ESV couldn’t be reached. Please try again.' }, 502);
  }
});
