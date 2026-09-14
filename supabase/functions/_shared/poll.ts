/*
 * Polls: a broadcast that asks people to reply with a number.
 *
 *   "How would you like to receive updates?
 *    [1] Immediately
 *    [2] A summary once per day"
 *
 * The options are read out of the message itself rather than stored separately,
 * so writing the poll and defining its answers are the same act. Nobody has to
 * keep a list of choices in step with the words people actually read.
 *
 * Pure functions here; the database side is pollAnswer() at the bottom.
 */

/* Numbers are stored one way outbound and another inbound; compare the tail. */
const last10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10);

/*
 * Two copies of a message are the same message when they differ only in
 * spacing. The composer logged whatever was typed — a trailing blank line
 * included — while the library keeps it trimmed, so an exact comparison said a
 * poll had never been sent and the answer was filed under an older poll.
 */
export const sameText = (a: unknown, b: unknown) =>
  String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim();
const normText = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* [1] Label · 1) Label · 1. Label — the three ways people write a numbered list. */
const OPTION_RE = /(?:^|\n)\s*(?:\[(\d{1,2})\]|(\d{1,2})[).\]])\s*(.+?)\s*(?=\n|$)/g;

export type PollOption = { n: number; label: string };

export function pollOptions(body = ''): PollOption[] {
  const out: PollOption[] = [];
  const seen = new Set<number>();
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
export function pollChoice(text = '', options: PollOption[] = []): number | null {
  const s = String(text).trim().toLowerCase()
    .replace(/^(?:option|number|choice|answer)\s*/, '')
    .replace(/[.!)\]]+$/, '')
    .trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return options.some(o => o.n === n) ? n : null;
}

/* ── Recording an answer ── */

/* Our own answers, and texts that never arrived, are not questions. */
const NOT_ASKING = new Set(['AutoReply', 'Reply', 'Notice', 'Failed', 'Blocked']);

/*
 * The last poll or dinner this number was actually asked, newest first, walked
 * the way the Responses tab walks a thread (lib/campaigns.js): a reminder asks
 * about the campaign it chases, "how many plates?" is a dinner question, and an
 * announcement in between changes nothing.
 */
export async function lastAsk(
  supabase: any,
  mine: string,
  asks: Map<string, { type: string; body: string }>,
): Promise<{ type: string; body: string } | null> {
  let { data: sent, error } = await supabase
    .from('sms_messages')
    .select('body, status, campaign, created_at')
    .eq('to10', mine)
    .neq('direction', 'in')
    .eq('channel', 'sms')
    .order('created_at', { ascending: false })
    .limit(200);

  /* Before the to10 column existed: every row carrying a known body, matched by
     number here. Slower, and blind to reminders, but never wrong about a poll. */
  if (error) {
    const legacy = await supabase
      .from('sms_messages')
      .select('body, status, campaign, created_at, to_number')
      .in('body', [...asks.values()].map(a => a.body))
      .neq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(2000);
    sent = (legacy.data || []).filter((r: any) => last10(r.to_number) === mine);
  }

  for (const r of sent || []) {
    if (NOT_ASKING.has(r.status)) continue;
    if (r.status === 'DinnerAsk') return { type: 'Dinner', body: '' };
    const asked = r.status === 'Reminder' ? r.campaign : r.body;
    const hit = asks.get(normText(asked));
    if (hit) return hit;
  }
  return null;
}

/*
 * Finds the last poll this number was sent, records their choice, and returns
 * the acknowledgement to send back. Null when the reply is not answering a poll,
 * which leaves the message for whatever handles it next.
 */
export async function pollAnswer(
  supabase: any,
  baseUrl: string,
  key: string,
  fromNumber: string,
  text: string,
): Promise<string | null> {
  /*
   * Matched on the last ten digits, not on the string.
   *
   * An outbound row carries the number as it sits in the contact list —
   * "2515099295" — while an inbound webhook reports E.164, "+12515099295".
   * An exact comparison finds nothing, which is precisely how this failed in
   * testing: the poll was sent, the reply arrived, and the lookup said the
   * person had never been polled. dinnerAck has always compared last ten.
   */
  const mine = last10(fromNumber);
  if (!mine) return null;

  /*
   * Whichever was asked LAST decides what a number means.
   *
   * A poll and a dinner invitation are both answered with a bare digit, so the
   * question is not "has this person ever been polled" but "what were they
   * asked most recently". Checking only for polls meant a "2" answering
   * tonight's dinner was recorded as a poll choice because a poll had gone out
   * a week earlier — the number landed under the wrong question entirely.
   *
   * So both kinds are loaded, the most recent send to this person wins, and a
   * dinner hands the reply straight back to dinnerAck untouched.
   */
  const { data: lib } = await supabase
    .from('sms_library').select('body, message_type').in('message_type', ['Poll', 'Dinner']);
  if (!lib?.length) return null;

  /* Keyed by the text with spacing collapsed; the value keeps the library's own
     copy, which is what an answer is recorded against. */
  const asks = new Map<string, { type: string; body: string }>();
  for (const r of lib as any[]) if (r.body) asks.set(normText(r.body), { type: r.message_type, body: r.body });
  if (!asks.size) return null;

  const latest = await lastAsk(supabase, mine, asks);
  if (!latest) return null;
  /* The last thing they were asked was a dinner — not ours to answer. */
  if (latest.type !== 'Poll') return null;

  const options = pollOptions(latest.body);
  const choice = pollChoice(text, options);
  if (choice == null) return null;

  const picked = options.find(o => o.n === choice)!;
  /* One answer per person per poll: replying again is a correction, not a
     second vote. */
  const { error } = await supabase.from('sms_poll_answers').upsert({
    poll_body: latest.body,
    to_number: fromNumber,
    choice,
    answer_text: String(text).slice(0, 200),
    answered_at: new Date().toISOString(),
  }, { onConflict: 'poll_body,to_number' });
  if (error) { console.error('poll answer:', error.message); return null; }

  /* Acknowledged the same way a dinner RSVP is, and over the same rail, so a
     poll reply is never mistaken for congregation traffic nobody answered. */
  const ack = `Thanks — recorded: ${picked.label}`;
  const res = await fetch(`${baseUrl}/functions/v1/send-prospect-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      messages: [{ to_number: fromNumber, to_name: '', body: ack }],
      channel: 'sms',
      status: 'AutoReply',
    }),
  });
  if (!res.ok) console.error('poll ack send failed:', res.status);
  return ack;
}
