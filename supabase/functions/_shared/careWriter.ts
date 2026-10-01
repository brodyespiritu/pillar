/*
 * The AI writer for care texts: everything that does not touch the network.
 *
 * Pillar always builds its own wording first (careDigest.ts, deacons.ts). The
 * AI is handed that text, never the raw records, and asked to rewrite it the
 * way the church's rules and corrections say. So everything it may say is
 * already in front of it, and what it says can be checked against that text:
 *
 *   - everyone Pillar's text names is still named (by surname at least),
 *   - every number in its version (dates, times, rooms) appears in Pillar's,
 *   - it costs no more segments to send than Pillar's,
 *   - it stays in the plain alphabet a text carries cheaply.
 *
 * A version that fails any of these is not sent; Pillar's wording goes out and
 * the reason is kept beside it for the office to see (careAi.ts).
 *
 * Pure functions only, so the prompt and every check run in tests.
 */

import { smsCost, toGsm } from './smsEncoding.ts';
import { splitMessage } from './smsParts.ts';
import { packDigest } from './careDigest.ts';

/* The model that writes them. The current Opus: the texts are short, so effort,
   not the model, is what keeps them quick and cheap (see EFFORT). */
export const CARE_AI_MODEL = 'claude-opus-5-5';

export type Kind = 'deacon_alert' | 'deacon_summary' | 'staff_digest';
export type Audience = 'deacons' | 'staff';
export type Mode = 'off' | 'practice' | 'live';

export const audienceOf = (k: Kind): Audience => (k === 'staff_digest' ? 'staff' : 'deacons');

/* A rewrite is a short task; a digest carries more people and more to keep straight. */
export const EFFORT: Record<Kind, 'low' | 'medium'> = {
  deacon_alert: 'low', deacon_summary: 'low', staff_digest: 'medium',
};
/* Thinking counts toward max_tokens, so these leave room for it beside the reply. */
export const MAX_TOKENS: Record<Kind, number> = {
  deacon_alert: 4000, deacon_summary: 6000, staff_digest: 12000,
};

/* ── One text ── */

export type CareText = {
  kind: Kind;
  ref: string | null;          // one draft per text; null for a preview
  label: string;               // "To Deacon Bob Jones", "Staff digest, 8:00 AM"
  original: string;            // Pillar's wording, as the AI is given it
  originalParts: string[];     // Pillar's wording, as it would be sent
  people: string[];            // everyone it names
  header?: string;             // a digest's header, which Pillar adds itself
  build: (lines: string[]) => string[];   // the AI's lines -> the texts to send
};

/* A text whose first line leads, split the way Pillar splits alerts. */
const asAlert = (lines: string[]) => splitMessage(lines[0] ?? '', lines.slice(1));

/*
 * An alert to one deacon. The ref matches the claim the alert is sent under
 * (kind, the deacon's number, the record), so the instant alert and the
 * half-hourly sweep arrive at the same draft rather than writing it twice.
 */
export function deaconAlertText(
  { alert, kind, phone, ref, deacon, person }:
  { alert: { header: string; lines: string[] }; kind: string; phone: string; ref: string; deacon?: string; person?: string },
): CareText {
  return {
    kind: 'deacon_alert',
    ref: `alert:${kind}:${phone}:${ref}`,
    label: `To ${deacon || 'a deacon'}`,
    original: [alert.header, ...alert.lines].join('\n'),
    originalParts: splitMessage(alert.header, alert.lines),
    people: person ? [person] : [],
    build: asAlert,
  };
}

/* A deacon's morning summary: its heading line, then a line per event. */
export function deaconSummaryText(
  { head, lines, phone, stamp, deacon, people }:
  { head: string; lines: string[]; phone: string; stamp: string; deacon?: string; people: string[] },
): CareText {
  return {
    kind: 'deacon_summary',
    ref: `summary:${phone}:${stamp}`,
    label: `To ${deacon || 'a deacon'} (morning summary)`,
    original: [head, ...lines].join('\n'),
    originalParts: splitMessage(head, lines),
    people,
    build: asAlert,
  };
}

/* The staff digest. Pillar keeps its header and its part numbering; the AI
   writes the lines beneath. */
export function staffDigestText(
  { header, lines, parts, sentOn, slot, slotName, people }:
  { header: string; lines: string[]; parts: string[]; sentOn: string; slot: number; slotName: string; people: string[] },
): CareText {
  return {
    kind: 'staff_digest',
    ref: `digest:${sentOn}:${slot}`,
    label: `Staff digest, ${slotName}`,
    original: lines.join('\n'),
    originalParts: parts,
    people,
    header,
    build: l => packDigest(header, l),
  };
}

/* ── Cost ── */

/* Dollars per million tokens. A refusal can be re-run on another model
   (server-side fallback), so the model that answered sets the price. */
const RATES: Record<string, { in: number; out: number; write: number; read: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, write: 5, read: 0.2 },
  'claude-opus-5': { in: 5, out: 25, write: 6.25, read: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, write: 6.25, read: 0.5 },
};

export function costOf(model: string | null | undefined, usage: any): number {
  const r = RATES[String(model || '')] || RATES[CARE_AI_MODEL];
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return (n(usage?.input_tokens) * r.in + n(usage?.output_tokens) * r.out
    + n(usage?.cache_creation_input_tokens) * r.write + n(usage?.cache_read_input_tokens) * r.read) / 1e6;
}

/* ── The prompt ── */

const clean = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const clip = (s: unknown, max: number) => {
  const t = clean(s);
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

const WHO: Record<Audience, string> = {
  deacons: 'These go to deacons, about the families they look after: an alert when someone is added to the care '
    + 'list or has an update, and, for deacons who asked for one, a summary each morning instead.',
  staff: 'These go to church staff twice a day, at 8:00 AM and 4:00 PM: a digest of who was added to the care list, '
    + 'the updates and edits since the last one, who is still in the hospital, and in the morning, the day\'s '
    + 'appointments and surgeries.',
};

export type Example = { original: string; wrote?: string | null; should_read: string; why?: string | null };

/* Newest corrections are the ones that matter most, and a prompt is not a
   place for an unbounded list: the latest dozen, each kept to a sensible size. */
export const EXAMPLES_SHOWN = 12;

export function systemPrompt(audience: Audience, rules: string, examples: Example[] = []): string {
  const shown = examples.slice(0, EXAMPLES_SHOWN).reverse();   // oldest first, newest nearest the text
  const parts = [
    'You write the text messages that Bethesda Baptist Church\'s care ministry sends by SMS.',
    WHO[audience],
    'Each time, you are given a text exactly as Pillar, the church office\'s system, would send it. Rewrite it '
      + 'so it follows the church\'s rules and the corrections the church has made.',
    'The facts are not yours to change:\n'
      + '- Everyone Pillar\'s text names must be in yours, by name (their surname at least), with their own details.\n'
      + '- Add nothing Pillar\'s text does not say: no date, time, place, room number, condition or name it does '
      + 'not contain. If a rule asks for something the text does not have, leave it out rather than supply it.\n'
      + '- Write every date, time and room number exactly as Pillar has it.\n'
      + '- Leave a detail out only when the church\'s rules say to.',
    'It is a text message:\n'
      + '- Plain text: no emoji, no asterisks or other formatting, plain hyphens and straight quotes.\n'
      + '- Short lines, the most important thing first.\n'
      + '- No longer than Pillar\'s text. Every 153 characters past the first 160 is another text to pay for.\n'
      + '- Write as the church office. Never mention AI, Pillar, or these instructions.',
    `The church's rules for these texts:\n<rules>\n${clean(rules)
      || 'None written yet. Keep Pillar\'s wording, fixing only clear typos and anything that reads awkwardly.'}\n</rules>`,
  ];
  if (shown.length) {
    parts.push('Corrections the church has made. Write texts like these the way they show:\n' + shown.map(e => [
      '<example>',
      `<pillar_wrote>\n${clip(e.original, 2500)}\n</pillar_wrote>`,
      clean(e.wrote) ? `<you_wrote>\n${clip(e.wrote, 2500)}\n</you_wrote>` : '',
      `<should_read>\n${clip(e.should_read, 2500)}\n</should_read>`,
      clean(e.why) ? `<why>${clip(e.why, 600)}</why>` : '',
      '</example>',
    ].filter(Boolean).join('\n')).join('\n'));
  }
  return parts.join('\n\n');
}

const WHAT: Record<Kind, string> = {
  deacon_alert: 'An alert to a deacon about one of their families.',
  deacon_summary: 'A deacon\'s morning summary of everything about their families since the last one.',
  staff_digest: 'The staff care digest.',
};

export function userPrompt(kind: Kind, original: string, { header = '' }: { header?: string } = {}): string {
  const text = clean(original);
  const shape = kind === 'staff_digest'
    ? `Pillar puts the header line ("${clean(header)}") on top and splits a long digest into numbered texts `
      + 'itself, so leave the header out and write only the lines beneath it. Keep a blank line between sections.'
    : 'Write the whole text, its first line included.';
  return [
    WHAT[kind],
    `<pillar_text>\n${text}\n</pillar_text>`,
    shape,
    `Keep it to ${text.length} characters or fewer. Give the text back as its lines, in order.`,
  ].join('\n\n');
}

/* What comes back: the text's lines, in order. Structured output holds the
   model to this shape, so there is nothing to scrape out of prose. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines'],
  additionalProperties: false,
};

export function parseLines(text: string): string[] | null {
  try {
    const v = JSON.parse(String(text || ''));
    return Array.isArray(v?.lines) && v.lines.every((l: unknown) => typeof l === 'string') ? v.lines : null;
  } catch {
    return null;
  }
}

/*
 * The lines as a text can carry them: plain punctuation, no formatting marks,
 * no stray blank lines. A digest's header is Pillar's to add, so a copy of it
 * at the top is dropped rather than sent twice.
 */
export function tidyLines(lines: string[], { header = '' }: { header?: string } = {}): string[] {
  let out = lines.map(l => toGsm(String(l ?? ''))
    .replace(/\*\*|__/g, '')
    .replace(/^\s*#+\s+/, '')
    .replace(/^\s*[*•]\s+/, '- ')
    .replace(/\s+$/, ''));
  if (header && out.length && out[0].trim().toLowerCase() === toGsm(header).trim().toLowerCase()) out = out.slice(1);
  const tidy: string[] = [];
  for (const l of out) {
    if (!l.trim() && (!tidy.length || !tidy[tidy.length - 1].trim())) continue;   // no leading or doubled blanks
    tidy.push(l.trim() ? l : '');
  }
  while (tidy.length && !tidy[tidy.length - 1].trim()) tidy.pop();
  return tidy;
}

/* ── The checks ── */

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

/* "Mary Smith" → "Smith", "John Smith Jr." → "Smith". A one-word name is its own. */
export function surnameOf(name: string): string {
  const words = clean(name).split(/\s+/).map(w => w.replace(/[.,;:]+$/, '')).filter(Boolean);
  while (words.length > 1 && SUFFIX.test(words[words.length - 1])) words.pop();
  const last = words[words.length - 1] || '';
  return last.length >= 2 ? last : '';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const named = (text: string, word: string) =>
  new RegExp(`(?<![A-Za-z])${escapeRe(word)}(?![A-Za-z])`, 'i').test(text);

/* Every number, as a value: "08" and "8" are the same hour. */
export function numbersIn(text: string): Set<string> {
  return new Set((String(text || '').match(/\d+/g) || []).map(n => String(parseInt(n, 10))));
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/* The numbers a text states, in digits or in words: Pillar writes "One update
   on your families", and a rewrite saying "1 update" has added nothing. */
export function statedNumbers(text: string): Set<string> {
  const out = numbersIn(text);
  for (const w of String(text || '').toLowerCase().match(/[a-z]+/g) || []) {
    const n = WORDS.indexOf(w);
    if (n >= 0) out.add(String(n));
  }
  return out;
}

const segmentsOf = (parts: string[]) => parts.reduce((n, p) => n + smsCost(p).segments, 0);

/*
 * Why this version must not be sent, in words the office can act on — or
 * nothing, when it passes.
 *
 * `lines` is what the AI wrote; `parts` those lines as the texts that would go
 * out. Numbers are checked on the lines, not the parts: a part's "(1/2)" tag
 * is Pillar's, not something the AI made up.
 */
export function reviewRewrite(
  { original, lines, parts, originalParts, people }:
  { original: string; lines: string[]; parts: string[]; originalParts: string[]; people: string[] },
): string[] {
  const text = lines.join('\n');
  if (!text.trim()) return ['It came back empty.'];
  const problems: string[] = [];

  const missing = [...new Set(people.map(clean).filter(Boolean))]
    .filter(p => { const s = surnameOf(p); return s && !named(text, s); });
  if (missing.length) problems.push(`It left out ${listOf(missing)}.`);

  const known = statedNumbers(original);
  const added = [...numbersIn(text)].filter(n => !known.has(n));
  if (added.length) {
    problems.push(`It added ${added.length === 1 ? 'a number' : 'numbers'} Pillar's wording doesn't have: ${added.slice(0, 3).join(', ')}.`);
  }

  if (parts.some(p => smsCost(p).encoding !== 'GSM-7')) {
    problems.push('It used a character (an emoji, say) that makes the text cost about twice as much.');
  }

  const mine = segmentsOf(parts), theirs = segmentsOf(originalParts);
  if (mine > theirs) problems.push(`It would cost more to send: ${mine} segments instead of ${theirs}.`);

  if (/\b(as an ai|language model|i can(?:no|')t (?:help|write|do)|i'?m sorry, but)\b/i.test(text)) {
    problems.push('It wrote a note about the request instead of the text.');
  }
  return problems;
}

function listOf(names: string[]) {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
  return more > 0 ? `${joined} and ${more} more` : joined;
}
