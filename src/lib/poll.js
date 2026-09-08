/*
 * Reading the options out of a poll's own text.
 *
 * The same parser the inbound webhook uses (supabase/functions/_shared/poll.ts).
 * Kept in step by hand because the browser and Deno builds cannot share a file;
 * if you change one, change the other — the composer preview exists precisely so
 * a drift between them is visible before a poll goes out.
 */
/* [1] Label · 1) Label · 1. Label — the three ways people write a numbered list. */
const OPTION_RE = /(?:^|\n)\s*(?:\[(\d{1,2})\]|(\d{1,2})[).\]])\s*(.+?)\s*(?=\n|$)/g;

export function pollOptions(body = '') {
  const out = [];
  const seen = new Set();
  for (const m of String(body).matchAll(OPTION_RE)) {
    const n = Number(m[1] ?? m[2]);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    out.push({ n, label: (m[3] || '').trim() });
  }
  return out.sort((a, b) => a.n - b.n);
}

/* Is this message asking a numbered question at all? Two options is the
   smallest thing worth calling a poll — one is an announcement. */
export const isPoll = (body = '') => pollOptions(body).length >= 2;

/*
 * The number somebody replied with.
 *
 * Deliberately narrow. "2" and "Option 2" are answers; "2 please" is a dinner
 * headcount and "I'll take 2 of those" is a sentence. Anything carrying more
 * than a nod around the digit is left for a person to read, because guessing
 * wrong here silently records a preference the sender never chose.
 */
export function pollChoice(text = '', options = []) {
  const s = String(text).trim().toLowerCase()
    .replace(/^(?:option|number|choice|answer)\s*/, '')
    .replace(/[.!)\]]+$/, '')
    .trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return options.some(o => o.n === n) ? n : null;
}

