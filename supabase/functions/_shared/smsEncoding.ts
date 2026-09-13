/*
 * What a text costs to send, and how to keep it cheap.
 *
 * SHARED WITH THE WEB APP. src/lib/broadcast.js imports this exact file, so the
 * cost a person sees in the composer is computed by the same code that decides
 * what Telnyx is sent. Keep it free of Deno APIs and of imports.
 *
 * KEEP EVERY REGEX BELOW IN \u ESCAPES. Several of these characters are
 * invisible or look exactly like an ordinary space. Written raw, a single
 * editor "tidy" that turns one of them into a real space makes a class such as
 * [\u00A0\u2000-\u200A] into a range starting at the space, which matches
 * nearly every character — every text would then go out blank, while the log,
 * which keeps the body as typed, looked entirely normal. This repo has shipped
 * raw control bytes inside an SMS regex before.
 *
 * An SMS goes out in one of two alphabets, chosen for the WHOLE message. GSM-7
 * fits 160 characters in a single segment and 153 a segment once the message
 * is split. If even one character falls outside it, every character is sent as
 * UCS-2 instead: 70 in one segment, 67 a segment once split. So one curly
 * apostrophe more than halves the room for everything else in the text.
 *
 * That is exactly how the 4:00 PM care digest on Sep 12 2026 failed. It was
 * 1,376 characters - 9 segments in GSM-7 - but its header carried an em dash
 * and the notes seven iPhone apostrophes, so it went as UCS-2 and needed 21.
 * Telnyx refused it: "The SMS message would be divided into 21 parts. The
 * maximum is 10." Over the preceding 30 days, 4,912 texts went out as UCS-2
 * for no reason but punctuation, and billed 40% more segments than they needed.
 */

/* GSM 03.38 basic character set. Each costs one septet. */
const GSM_BASIC = new Set([
  ...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
]);

/* GSM 03.38 extension table. Still GSM-7, but each costs two septets - an
   escape and the character - so they must be counted twice, not once.
   The standard also lists form feed here, but Telnyx's own published counter
   treats it as non-GSM. Leaving it out can only over-count, which costs a spare
   part; counting it the other way could get a message refused. */
const GSM_EXTENDED = new Set([...'^{}\\[~]|€']);

export type SmsCost = {
  encoding: 'GSM-7' | 'UCS-2';
  /* Septets for GSM-7; UTF-16 code units for UCS-2, where an emoji is two. */
  units: number;
  segments: number;
};

/*
 * How many segments a carrier will bill and deliver this text as.
 *
 * Counted the standard way, which can come in one short of the true figure: an
 * extended character or an emoji may not be split across a segment boundary,
 * so a segment occasionally holds one unit less. Anything that sizes text to a
 * hard limit should keep a segment of margin rather than rely on the last one.
 */
export function smsCost(text: string): SmsCost {
  const s = String(text ?? '');
  let septets = 0;
  for (const ch of s) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENDED.has(ch)) septets += 2;
    else {
      const units = s.length;
      return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
    }
  }
  return { encoding: 'GSM-7', units: septets, segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
}

/*
 * Typographic punctuation, replaced by the plain character it stands for.
 *
 * Nearly every non-GSM character in Pillar's texts is one of these. iPhones
 * turn ' into a curly apostrophe and -- into an em dash as people type, and the
 * app's own copy has used em dashes. Swapping them does not change what a
 * sentence says.
 *
 * Bullets are straightened only where they START a line, marking a list item.
 * Between words - "services 8:30 [dot] 11:00" - a hyphen would turn a list into
 * a range and tell people the service runs from 8:30 to 11:00, so an inline
 * bullet is left exactly as typed.
 *
 * Order matters: spaces are normalised before the bullet rule, so a bullet
 * after a no-break space at the start of a line is still recognised.
 *
 * Anything genuinely outside the alphabet - an emoji, a name like Zoë - is left
 * as written. That text simply goes as UCS-2, and anything that splits text
 * measures with smsCost, so it is sized for that too.
 */
const PLAIN: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"],              // curly single quotes, primes
  [/[`\u00B4\u02BC]/g, "'"],                                // backtick, acute accent, modifier apostrophe
  [/[\u201C\u201D\u201E\u201F\u2033\u2036\u00AB\u00BB]/g, '"'],  // curly double quotes, guillemets
  [/[\u2039\u203A]/g, "'"],                                      // single guillemets
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-'],        // hyphens, en and em dashes, minus
  [/\u2026/g, '...'],                                            // ellipsis
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000\f\v]/g, ' '],         // no-break, typographic and page-break spaces
  [/[\u00AD\u200B\u2060\uFEFF]/g, ''],                           // soft hyphen, zero-width characters
  [/^([ \t]*)[\u00B7\u2022\u2023\u2043]/gm, '$1-'],              // a bullet starting a line, and only there
];

export function toGsm(text: string): string {
  const typed = String(text ?? '');
  let s = typed;
  for (const [re, to] of PLAIN) s = s.replace(re, to);
  /*
   * Joiners go only when that is what makes the text GSM-7. Inside an emoji
   * they glue a sequence together - a family, a mending heart - and deleting
   * them splits it into separate pictures while saving nothing, because the
   * emoji keeps the text UCS-2 regardless. A stray one in plain words is the
   * only non-GSM character there, and removing it halves the cost.
   */
  const unjoined = s.replace(/[\u200C\u200D]/g, '');
  if (unjoined !== s && smsCost(unjoined).encoding === 'GSM-7') s = unjoined;
  /*
   * Never more expensive than what was typed. Every swap above is one character
   * for one, or for none, except the ellipsis, which becomes three. That pays
   * for itself whenever it lets the text go GSM-7, but in a text that stays
   * UCS-2 for some other reason it only adds length, and in one made mostly of
   * ellipses it can add a segment. If the plain version would bill more
   * segments, the text goes out as typed.
   */
  return smsCost(s).segments <= smsCost(typed).segments ? s : typed;
}
