/*
 * Counting heads from a text reply.
 *
 * Written against the real replies to a Bethesda dinner invite, which look
 * nothing like a form: "2 please", "Cranes two", "Bruce and Joanne", "Olivers:
 * 5", "0. I'll be out of town", "Two Cooneys for chicken", and iOS tapbacks
 * like 'Loved "Good afternoon…"'.
 *
 * Returns { count, basis } — or null when the message is not an RSVP at all,
 * so chatter is left out of the total rather than silently counted as zero.
 */

const WORD_NUMBERS = {
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

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

/* The first number that reads like a headcount, or null. */
function digitCount(text) {
  const re = /(\d{1,2})(?!\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length);
    if (UNIT_AFTER.test(after)) continue;              // "7 days", "6:30"
    const n = Number(m[1]);
    if (n >= 0 && n <= 40) return n;                   // a plate count, not a phone number
  }
  return null;
}

function wordCount(text) {
  const m = text.match(new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join('|')})\\b`, 'i'));
  return m ? WORD_NUMBERS[m[1].toLowerCase()] : null;
}

/*
 * "Bruce and Joanne", "Buster & Carol Johnson plan to attend", "Rita and I".
 * Trailing intent ("plan to attend") is stripped first so it isn't mistaken
 * for another name.
 */
function nameCount(text) {
  let s = text
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

export function parseHeadcount(raw) {
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

/*
 * Roll a set of replies into a total. One reply per phone number — the latest
 * wins, so someone correcting themselves ("2" then "3") counts once, as 3.
 *
 * A person can overrule the reading: `rsvp_count` fixes the number and
 * `rsvp_excluded` drops the reply out of the tally entirely. Their decision
 * always beats the parser, and a corrected reply stops being "unclear".
 */
export function tallyReplies(replies) {
  const latest = new Map();
  for (const r of replies) {
    const key = String(r.from || r.to_number || '').replace(/\D/g, '').slice(-10);
    if (!key) continue;
    const prev = latest.get(key);
    if (!prev || new Date(r.created_at) >= new Date(prev.created_at)) latest.set(key, r);
  }

  let total = 0;
  const counted = [], declined = [], unclear = [], excluded = [];
  for (const [key, r] of latest) {
    const parsed = parseHeadcount(r.body);
    const row = {
      key, id: r.id, body: r.body, at: r.created_at, name: r.to_name || '',
      guess: parsed ? parsed.count : null,      // what the parser thought, for the UI
    };

    if (r.rsvp_excluded) { excluded.push(row); continue; }

    const manual = Number.isInteger(r.rsvp_count) ? r.rsvp_count : null;
    if (manual !== null) {
      row.count = manual;
      row.basis = 'manual';
      if (manual > 0) { total += manual; counted.push(row); } else declined.push(row);
      continue;
    }

    if (!parsed) { unclear.push(row); continue; }
    row.count = parsed.count;
    row.basis = parsed.basis;
    if (parsed.count > 0) { total += parsed.count; counted.push(row); }
    else declined.push(row);
  }
  return { total, counted, declined, unclear, excluded, replies: latest.size };
}
