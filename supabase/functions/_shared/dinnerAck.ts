/*
 * The automatic answer to a dinner RSVP.
 *
 * A reply has to be placed against a dinner before it can be acknowledged, and
 * there are two ways that happens:
 *
 *   - Someone we texted answers the invitation. Whatever we last sent them is
 *     what they are answering — the same rule the Responses tab groups by.
 *   - Someone arrives from the public RSVP link, which pre-fills RSVP and asks
 *     them to add their name and how many plates. They were never texted, so
 *     the keyword places them on whichever dinner is collecting reservations,
 *     and the name they typed becomes the name on the reply.
 *
 * Kept out of the webhook so the decision — who is owed an acknowledgement and
 * who is not — can be exercised directly.
 */
import { parseHeadcount } from './rsvp.ts';

export const DINNER_ACK = 'Reservation received. Thank you!';
export const DINNER_ASK = 'How many plates should we reserve? Reply with a number.';
export const ACK_STATUS = 'AutoReply';
export const ASK_STATUS = 'DinnerAsk';
export const REMIND_STATUS = 'Reminder';

/* The word the public RSVP link pre-fills, plus the ones people type instead. */
const KEYWORD = /^\s*(?:dinner|rsvp|reserve|reservation)\b[\s:,.\-—]*/i;

/*
 * The name someone typed alongside their headcount, so a reservation from a
 * number we have never texted shows up as a person rather than ten digits.
 * "RSVP Jane Smith 4" -> "Jane Smith".
 */
const COUNT_WORDS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/ig;
const FILLER = /\b(?:plates?|people|persons?|adults?|kids?|children|guests?|seats?|please|thanks?|thank you|for|and|me|us|total|coming|attending)\b/ig;

export function rsvpName(text: string): string {
  const s = String(text || '')
    .replace(KEYWORD, ' ')
    .replace(/\d+/g, ' ')
    .replace(COUNT_WORDS, ' ')
    .replace(FILLER, ' ')
    .replace(/[^A-Za-z'\u2019.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Needs to read like a name, not leftover punctuation or a single letter.
  if (!/[A-Za-z]{2}/.test(s)) return '';
  return s.split(' ').slice(0, 4).join(' ').slice(0, 60);
}

/* How long a dinner keeps taking reservations after it goes out. */
const ACTIVE_DAYS = 14;

/*
 * The dinner currently collecting reservations, if there is one.
 *
 * A dinner counts from whichever came last: the invitation going out, or the
 * row being written. Judging on the send alone meant a dinner whose link was
 * made on Sunday morning did not exist until the text went out that afternoon —
 * so a link shared in the meantime pointed at last week's meal.
 */
export async function activeDinner(supabase: any, now: number) {
  const cutoff = new Date(now - ACTIVE_DAYS * 864e5).toISOString();
  const { data, error } = await supabase
    .from('sms_library').select('body, last_sent_at, created_at, rsvp_menu')
    .eq('message_type', 'Dinner')
    .or(`last_sent_at.gte.${cutoff},created_at.gte.${cutoff}`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { console.error('dinner lookup failed:', error.message); return null; }

  const when = (r: any) => {
    const a = r.last_sent_at ? Date.parse(r.last_sent_at) : 0;
    const b = r.created_at ? Date.parse(r.created_at) : 0;
    return Math.max(a || 0, b || 0);
  };
  return (data || []).slice().sort((a: any, b: any) => when(b) - when(a))[0] || null;
}

/* How far back to look for the invitation a headcount answers. */
const LOOKBACK = 25;

/*
 * Is the last thing we ASKED this person a dinner invitation?
 *
 * Asked, not sent. The dinner goes out Sunday; a Silver Liners announcement goes
 * to the same list an hour later; "2" arrives Monday. That "2" answers the
 * dinner, and the Responses tab has always counted it there (groupCampaigns,
 * lastAsk). This used to read only the newest text, so the headcount was counted
 * but the person never got their "Reservation received" — the announcement was
 * simply what went out last.
 *
 * So announcements are looked past, the same way the count looks past them. A
 * poll is a question too, and a bare number after one is a poll choice, so a
 * poll stops the search. Only invitations inside the reservation window count:
 * a "2" is never acknowledged against a dinner that stopped taking bookings.
 */
async function repliedToDinner(supabase: any, last10: string, now: number = Date.now()) {
  /*
   * Our own acknowledgements and reminders are skipped — neither is a question,
   * and either would otherwise mask the invitation: an acknowledgement the
   * moment somebody corrected their number, a reminder the moment somebody
   * answered one.
   */
  /*
   * Matched on the stored last-ten-digits column, not with ilike. Most of the
   * contact list is stored formatted — "(706) 555-0100" — and the log keeps the
   * number as it was handed over, so `ilike '%7065550100'` missed nearly every
   * invitation sent from the composer and fell through to whatever older row
   * happened to be stored in E.164.
   *
   * Staff replies and texts that never arrived are skipped along with our own
   * acknowledgements: none of them is a question, and a staff "see you there!"
   * must not stop the headcount that follows it being recognised.
   */
  const cutoff = new Date(now - ACTIVE_DAYS * 864e5).toISOString();
  const { data, error: lookupErr } = await supabase
    .from('sms_messages')
    .select('body, status, campaign')
    .eq('to10', last10)
    .eq('direction', 'out')
    .eq('channel', 'sms')
    .not('status', 'in', `("${ACK_STATUS}","Reply","Notice","Failed","Blocked")`)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(LOOKBACK);
  if (lookupErr) console.error('dinner reply lookup failed:', lookupErr.message);
  const rows = data || [];
  if (!rows.length) return false;

  /*
   * Library bodies are stored trimmed while the sent copy keeps whatever the
   * composer typed, so the match is made here rather than with an equality
   * filter. A missing message_type column means dinners were never marked —
   * nothing to acknowledge, rather than an error.
   */
  const { data: lib, error } = await supabase
    .from('sms_library').select('body, message_type').in('message_type', ['Dinner', 'Poll']);
  if (error) { console.error('dinner lookup failed:', error.message); return false; }
  const bodies = (type: string) => new Set((lib || [])
    .filter((r: any) => r.message_type === type).map((r: any) => String(r.body || '').trim()));
  const dinners = bodies('Dinner');
  const polls = bodies('Poll');

  for (const row of rows) {                 // newest first
    // We asked them outright how many; a bare number answers that.
    if (row.status === ASK_STATUS) return true;
    /*
     * A reminder is a question about an earlier campaign, not about its own
     * text, so it answers for whatever it was chasing.
     */
    const asked = String((row.status === REMIND_STATUS ? row.campaign : row.body) || '').trim();
    if (dinners.has(asked)) return true;
    if (polls.has(asked)) return false;      // a number now is a poll choice
    // An announcement asks nothing: keep looking back.
  }
  return false;
}

async function send(baseUrl: string, key: string, to: string, body: string, status: string) {
  const res = await fetch(`${baseUrl}/functions/v1/send-prospect-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      messages: [{ to_number: to, to_name: '', body }],
      channel: 'sms',            // never 'care' — this is congregation traffic
      status,
    }),
  });
  if (!res.ok) { console.error('dinner reply send failed:', res.status); return false; }
  return true;
}

/*
 * Returns the message sent back, or null when nothing was owed.
 */
export async function dinnerAck(
  supabase: any, baseUrl: string, key: string, fromNumber: string, text: string,
  now: number = Date.now(),
): Promise<string | null> {
  const last10 = fromNumber.replace(/\D/g, '').slice(-10);
  if (!last10) return null;

  const raw = String(text || '');
  const keyed = KEYWORD.test(raw);
  const parsed = parseHeadcount(keyed ? raw.replace(KEYWORD, '') : raw);
  const seats = !!parsed && parsed.count > 0;

  // Ordinary chatter, with no keyword to place it — nothing to look up.
  if (!keyed && !seats) return null;

  const belongs = keyed ? !!(await activeDinner(supabase, now)) : await repliedToDinner(supabase, last10, now);
  if (!belongs) return null;

  if (seats) {
    return (await send(baseUrl, key, fromNumber, DINNER_ACK, ACK_STATUS)) ? DINNER_ACK : null;
  }

  /* Someone who declined is not owed a reservation, and never a thank-you for
     one they did not make. */
  if (parsed) return null;

  /* The keyword with no number — they tapped the link and sent it as-is. Ask,
     and file the question so their bare number lands back on this dinner. */
  return (await send(baseUrl, key, fromNumber, DINNER_ASK, ASK_STATUS)) ? DINNER_ASK : null;
}
