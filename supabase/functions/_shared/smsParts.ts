/*
 * Splitting a long text into parts Telnyx will accept.
 *
 * Moved out of cares-recap so the deacon alerts use the same packing. The deacon
 * morning summary used to go out as one unsplit text: a heavy day took it past
 * Telnyx's 10-segment limit, the whole thing was refused, and the claim said it
 * had been sent.
 *
 * Sizes are measured in SEGMENTS of the text as it goes on the wire, never in
 * characters — see smsEncoding.ts for why the two disagree.
 */

import { smsCost, toGsm } from './smsEncoding.ts';

/*
 * 9, not 10: the standard count can come in one short when an emoji or an
 * extended character lands on a segment boundary, and a part that is refused
 * is not a part that arrives late — it is a part nobody reads.
 */
export const PART_SEGMENTS = 9;

/*
 * The longest prefix of `s`, in code points, for which ok() still holds —
 * backed off to the last space where that does not leave a runt, so words are
 * only broken when a single word is longer than a whole part. Code points, not
 * UTF-16 indices, so an emoji is never cut in half.
 */
export function longestFit(s: string, ok: (head: string) => boolean): number {
  const cps = [...s];
  let lo = 0, hi = cps.length;
  while (lo < hi) {                      // cost only grows as the prefix grows
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(cps.slice(0, mid).join('').trimEnd())) lo = mid; else hi = mid - 1;
  }
  if (lo === 0 || lo === cps.length) return lo;
  for (let i = lo - 1; i > lo * 0.5; i--) if (cps[i] === ' ') return i;
  return lo;
}

/*
 * Packs lines into parts, asking fits() of the actual text each part would be.
 *
 * Measuring the rendered candidate rather than adding up lengths is the point:
 * capacity depends on encoding, and encoding belongs to the whole part. A single
 * line carrying an emoji more than halves the room for every other line in the
 * same text, which no running character count can see.
 *
 * Still packs against the space left in the current part rather than pre-chopping
 * each line — otherwise a note longer than one text pushes itself onto a fresh
 * part and leaves a near-empty one behind.
 */
export function packLines(lines: string[], fits: (part: string[]) => boolean): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) { chunks.push(cur); cur = []; } };

  for (const raw of lines) {
    let rest = raw;
    for (;;) {
      if (fits([...cur, rest])) { cur.push(rest); break; }
      const cut = longestFit(rest, head => fits([...cur, head]));
      // Too little of it fits to be worth a fragment — start the next part.
      if (cur.length && cut < 60) { flush(); continue; }
      /* Not even one character fits an empty part. That needs a header longer
         than a whole part, which cannot happen; sending it whole and letting
         the carrier decide beats looping here forever. */
      if (cut === 0) { cur.push(rest); break; }
      const cps = [...rest];
      cur.push(cps.slice(0, cut).join('').trimEnd());
      flush();
      rest = cps.slice(cut).join('').trimStart();
      if (!rest) break;
    }
  }
  flush();
  return chunks.length ? chunks : [[]];
}

/*
 * A header and its lines as one text, or as numbered parts when that is too
 * long. Every part repeats the header behind an (n/m) tag, since texts can arrive
 * out of order; the tag leads because these headers end in a colon ("Update on
 * Mary Smith:"). Everything is normalised to plain punctuation first and measured
 * after, because "…" grows into "..." and sizing the typed text would under-count
 * exactly the parts this exists to keep under the limit.
 */
export function splitMessage(header: string, lines: string[], maxSegments = PART_SEGMENTS): string[] {
  const head = toGsm(header).trim();
  const body = lines.map(toGsm).filter(l => l.trim());
  const whole = [head, ...body].join('\n').trim();
  if (smsCost(whole).segments <= maxSegments) return [whole];

  let width = 1;
  let chunks: string[][] = [];
  for (;;) {
    const widest = `(${'9'.repeat(width)}/${'9'.repeat(width)})`;
    const fits = (part: string[]) =>
      smsCost([`${widest} ${head}`, ...part].join('\n')).segments <= maxSegments;
    chunks = packLines(body, fits);
    const need = String(chunks.length).length;
    if (need <= width) break;
    width = need;
  }
  const n = chunks.length;
  return chunks.map((c, i) => [`(${i + 1}/${n}) ${head}`, ...c].join('\n').trim());
}
