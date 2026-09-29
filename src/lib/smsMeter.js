import { smsCost, toGsm } from '../../supabase/functions/_shared/smsEncoding.ts';

/*
 * What a text will cost while it is being typed, and where its segments fall.
 *
 * Telnyx bills every segment, for every person, so the composer shows the price
 * as you type and marks the text the way a carrier will split it:
 *   - a green bracket where each full segment ends,
 *   - orange on anything past the two-segment line,
 *   - yellow on a character that forces the costlier alphabet (an emoji, an
 *     accented letter), where a segment holds 70 characters instead of 160,
 *   - a green dotted underline on curly quotes, long dashes and odd spaces:
 *     Pillar sends those as plain punctuation (toGsm), so they cost nothing
 *     extra, and the price line says what they would have cost otherwise.
 *
 * Everything is measured on the text as it will go out, not as typed, so an
 * ellipsis counts as the three dots it becomes and a stray zero-width space as
 * nothing. The whole message is still sent; the marks are only for the person
 * writing it.
 */

/* Telnyx's $0.004 a segment plus the carrier's fee ($0.0035 AT&T to $0.005
   US Cellular), blended: https://telnyx.com/pricing/messaging */
export const PRICE_PER_SEGMENT = 0.0082;

/* The line the marks warn at: two segments, 306 plain characters. */
export const BUDGET_SEGMENTS = 2;

const BULLET = /[·•‣⁃]/;
const JOINER = /[‌‍]/;

/* How each typed character goes out, in order. */
function wirePieces(chars, wire, gsm) {
  const typed = chars.join('');
  if (wire === typed) return chars;                   // nothing converted (or kept as typed on purpose)
  let lineStart = true;
  const pieces = chars.map(ch => {
    let w;
    if (BULLET.test(ch)) w = lineStart ? '-' : ch;    // a bullet is straightened only where it starts a line
    else if (JOINER.test(ch)) w = gsm ? '' : ch;      // joiners go only when that makes the text plain
    else w = toGsm(ch);
    if (ch === '\n') lineStart = true;
    else if (ch !== ' ' && ch !== '\t') lineStart = false;
    return w;
  });
  // A case the rules above don't reproduce: measure what was typed rather than guess.
  return pieces.join('') === wire ? pieces : chars;
}

export function meterText(text, people = 0) {
  const typed = String(text ?? '');
  const wire = toGsm(typed);
  const total = smsCost(wire);
  const gsm = total.encoding === 'GSM-7';
  const single = gsm ? 160 : 70;
  const per = gsm ? 153 : 67;
  const segments = typed.length ? total.segments : 0;
  const multipart = segments > 1;
  const budget = BUDGET_SEGMENTS * per;

  const chars = [...typed];
  const pieces = wirePieces(chars, wire, gsm);
  const unitsOf = w => (w === '' ? 0 : gsm ? smsCost(w).units : w.length);

  const runs = [];
  const costly = [];
  const fixed = [];
  let at = 0;
  chars.forEach((ch, i) => {
    const w = pieces[i];
    const start = at;
    at += unitsOf(w);
    const isCostly = !gsm && w !== '' && smsCost(w).encoding === 'UCS-2';
    if (isCostly && ch.trim()) costly.push(ch);
    // Typed one way, sent another: a curly quote, a long dash, an ellipsis.
    const isFixed = gsm && w !== ch && ch.trim() !== '';
    if (isFixed) fixed.push(ch);
    const cls = isCostly ? 'costly' : multipart && at > budget ? 'over' : isFixed ? 'fixed' : 'plain';
    const segEnd = multipart && Math.floor(start / per) < Math.floor(at / per);
    const last = runs.at(-1);
    // A segment ending on a line break: the bracket closes the line it ends,
    // rather than opening the next one.
    if (segEnd && ch === '\n' && last) {
      last.segEnd = true;
      runs.push({ text: ch, cls, segEnd: false });
      return;
    }
    if (last && last.cls === cls && !last.segEnd) last.text += ch;
    else runs.push({ text: ch, cls, segEnd: false });
    if (segEnd) runs.at(-1).segEnd = true;
  });

  const price = n => n * people * PRICE_PER_SEGMENT;
  // Room before one more segment is billed to everyone.
  const left = !segments ? single : multipart ? segments * per - total.units : single - total.units;
  // What the same words would cost without the characters that force the costly alphabet.
  const plainSegments = costly.length
    ? smsCost(toGsm(chars.filter(c => !costly.includes(c)).join(''))).segments
    : segments;
  // What it would bill if the curly quotes and dashes went out as typed.
  const typedSegments = typed.length ? smsCost(typed).segments : 0;

  return {
    segments, units: total.units, per, single, encoding: total.encoding,
    cost: price(segments), nextCost: price(1), left,
    overBy: multipart && total.units > budget ? total.units - budget : 0,
    costly: [...new Set(costly)],
    costIfPlain: price(plainSegments), plainSegments,
    fixed: [...new Set(fixed)], fixedCount: fixed.length,
    costAsTyped: price(typedSegments), typedSegments,
    runs,
  };
}

export const money = n => `$${n.toFixed(2)}`;
