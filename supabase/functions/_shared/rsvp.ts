/*
 * Counting heads from a text reply — the Deno copy of src/lib/rsvp.js.
 *
 * The Responses tab and the inbound webhook have to agree on what counts as an
 * RSVP: the tally on screen and the "Reservation received" text a person gets
 * back must never disagree about whether they answered. Kept byte-for-byte in
 * step with the browser copy, and a parity test runs both over the same corpus.
 *
 * Returns { count, basis } — or null when the message is not an RSVP at all,
 * so chatter is left out of the total rather than silently counted as zero.
 */

export type Headcount = { count: number; basis: string };

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/* An iPhone reaction arrives as a whole message quoting the original. It is
   not an answer, and its quoted text is full of numbers. */
const TAPBACK = /^(loved|liked|laughed at|emphasi[sz]ed|disliked|questioned)\s+[“"]/i;

const DECLINE = new RegExp([
  "can'?t (?:make|come|be|attend)", 'cannot (?:make|come|be|attend)',
  "won'?t be (?:able|there|attending|coming)", "won'?t make it",
  'unable to', 'not going', 'not coming', 'not (?:be )?attending', 'out of town',
  'wish i could', 'watch on youtube', 'remove my name',
  'have to miss', 'have to skip', 'not able to', 'count us out',
  // Plain refusals, which people send far more often than a phrase.
  '^no\\b', '^nope\\b', 'no thanks', '\\bnone\\b', 'not this (?:week|time|one)',
].join('|'), 'i');

const AFFIRM = /\b(?:yes|we'?ll be there|will be there|plan(?:ning)? to (?:attend|be there)|count (?:me|us) in|i'?ll be there|officially be there)\b/i;

/* Numbers that are measuring something else: "still working 7 days",
   "at 6:30", "for 2 weeks". */
const UNIT_AFTER = /^\s*(?:days?|weeks?|months?|years?|hours?|minutes?|mins?|am|pm|o'?clock|:\d)/i;

const clean = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim();

/* The first number that reads like a headcount, or null. */
function digitCount(text: string): number | null {
  const re = /(\d{1,2})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length);
    if (UNIT_AFTER.test(after)) continue;              // "7 days", "6:30"
    const n = Number(m[1]);
    if (n >= 0 && n <= 40) return n;                   // a plate count, not a phone number
  }
  return null;
}

function wordCount(text: string): number | null {
  const m = text.match(new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join('|')})\\b`, 'i'));
  return m ? WORD_NUMBERS[m[1].toLowerCase()] : null;
}

/*
 * "Bruce and Joanne", "Buster & Carol Johnson plan to attend", "Rita and I".
 * Trailing intent ("plan to attend") is stripped first so it isn't mistaken
 * for another name.
 */
function nameCount(text: string): number | null {
  const s = text
    .replace(/^\s*(?:yes|hi|hello|this is|it'?s)\b[,: ]*/i, '')
    .replace(/\b(?:plan(?:ning)? to (?:attend|be there|come)|will be there|we will be there|are coming|plan to)\b.*$/i, '')
    .replace(/\b(?:for|to)\s+(?:chicken|supper|dinner|the meal)\b.*$/i, '')
    .replace(/[.!?].*$/, '')                            // first sentence only
    .trim();
  if (!s) return null;

  const parts = s.split(/\s*(?:,|&|\+|\band\b)\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Each part must look like a person: a capitalised word, or "I"/"me"/"myself".
  const people = parts.filter(p =>
    /^(?:i|me|myself|my (?:wife|husband|son|daughter|mom|dad|mother|father))\b/i.test(p)
    || /^[A-Z][a-z'’-]+/.test(p));
  return people.length >= 2 ? people.length : null;
}

export function parseHeadcount(raw: unknown): Headcount | null {
  const text = clean(raw);
  if (!text) return null;
  if (TAPBACK.test(text)) return null;

  const digits = digitCount(text);

  // An explicit number wins, including an explicit zero.
  if (digits !== null) {
    return { count: digits, basis: digits === 0 ? 'declined' : 'number' };
  }
  if (DECLINE.test(text)) return { count: 0, basis: 'declined' };

  const words = wordCount(text);
  if (words !== null) return { count: words, basis: 'number-word' };

  const names = nameCount(text);
  if (names !== null) return { count: names, basis: 'names' };

  if (AFFIRM.test(text)) return { count: 1, basis: 'yes' };

  return null;                                          // not an RSVP
}
