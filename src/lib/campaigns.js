import { tallyReplies, parseHeadcount } from './rsvp';

/*
 * Grouping replies by the message they answer.
 *
 * Lives here rather than in the page because two places need the same answer —
 * the Responses tab and the summary under the composer — and a second copy of
 * this walk is exactly how a reply ends up counted twice or filed under the
 * wrong message.
 */

/** The short form of a message, used as the campaign's name on screen. */
export const campaignLabel = body => {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'Message';
  const cut = s.slice(0, 46);
  return s.length > 46 ? `${cut.replace(/[\s,.;:-]+$/, '')}…` : cut;
};

const norm = b => String(b || '').replace(/\s+/g, ' ').trim();

/** Bodies the library marks as a Dinner — the only messages with a headcount. */
export const dinnerBodySet = (library = []) => new Set(
  library.filter(r => r.message_type === 'Dinner').map(r => norm(r.body)),
);

/** Bodies the library marks as a Poll. Answered with a number, like a dinner —
 *  which is exactly why the two have to be told apart by recency. */
export const pollBodySet = (library = []) => new Set(
  library.filter(r => r.message_type === 'Poll').map(r => norm(r.body)),
);

/**
 * Campaigns, newest reply first.
 *
 * @param threads  rows from fetchThreads
 * @param library  sms_library rows, to know which messages are dinners
 * @param nameFor  thread -> display name
 */
export function groupCampaigns(threads = [], library = [], nameFor = () => '') {
  const dinners = dinnerBodySet(library);
  const polls = pollBodySet(library);
  const map = new Map();

  for (const t of threads) {
    let asked = null;
    /*
     * The last dinner invitation this person was sent, tracked apart from
     * `asked`.
     *
     * An invitation is answered on the answerer's schedule. A fellowship text
     * goes out on Monday, a devotional goes to the same list on Thursday, and
     * the replies arrive on Sunday saying "John & Annie. 2" — a headcount for
     * the dinner, credited to the devotional, because the devotional is simply
     * what we sent most recently. Reading a reply as answering the last thing
     * sent is right for conversation and wrong for an RSVP.
     */
    /*
     * The last thing this person was ASKED — a dinner or a poll, whichever came
     * later. Both are answered with a bare number, so recency is the only thing
     * that can tell them apart: a "1" the day after a poll is a poll choice; the
     * same "1" the day after a dinner invitation is one plate.
     *
     * Tracking only the last dinner is what put poll answers under the dinner
     * text and counted them as plates.
     */
    let lastAsk = null;   // { body, kind: 'dinner' | 'poll' }
    let askedStatus = null;
    for (const m of t.messages) {
      if ((m.direction || 'out') !== 'in') {
        /*
         * An acknowledgement is not a question, so it never becomes `asked`.
         * A reminder is a question, but not about itself — it chases an earlier
         * campaign, which it records. Without that the reply landed on whatever
         * happened to be sent most recently, which is how a dinner reminder
         * ended up filed under a general announcement.
         */
        if (m.status === 'Reminder') {
          if (m.campaign) {
            asked = m.campaign; askedStatus = m.status;
            if (dinners.has(norm(m.campaign))) lastAsk = { body: m.campaign, kind: 'dinner' };
          }
          continue;
        }
        /*
         * 'Reply' joins 'AutoReply' here: both are us answering them, not us
         * asking something new. Without this a staff reply became the campaign
         * every later message from that person was filed under, so answering
         * someone minted a phantom card titled with our own words.
         */
        if (m.status !== 'AutoReply' && m.status !== 'Reply') {
          asked = m.body; askedStatus = m.status;
          if (dinners.has(norm(m.body)))    lastAsk = { body: m.body, kind: 'dinner' };
          else if (polls.has(norm(m.body))) lastAsk = { body: m.body, kind: 'poll' };
        }
        continue;
      }
      /*
       * A reply that reads as a headcount ("2", "None thanks", "Buster and
       * Carol") belongs to the invitation, however long ago it went out.
       * Anything that does not parse as one — "Who dis?", a tapback, a thank
       * you — still answers the last thing sent, which is what it is.
       *
       * Except straight after a care-intake question. Those ask things like
       * "Which one? 1. … 2. …", so the answer is a bare number that reads
       * exactly like a headcount. Whoever was just asked a numbered question is
       * answering that, not accepting a dinner invitation from last week.
       */
      const answers = lastAsk && askedStatus !== 'CareIntake' && parseHeadcount(m.body)
        ? lastAsk.body : asked;
      const key = campaignLabel(answers) || 'Other replies';
      if (!map.has(key)) map.set(key, { key, prompt: answers, replies: [] });
      map.get(key).replies.push({ ...m, thread: t, who: nameFor(t) });
    }
  }

  const out = [...map.values()].map(c => {
    const tally = tallyReplies(c.replies.map(r => ({ ...r, from: r.thread.number })));
    /* Replies arrive grouped by thread, so the list has to be put in time order
       before it can be read as one — reversing only turned the threads around,
       which left the newest reply wherever its thread happened to land. */
    c.replies.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return {
      ...c,
      tally,
      showTally: dinners.has(norm(c.prompt)),
      unread: c.replies.filter(r => !r.read_at).length,
      lastAt: c.replies.reduce((a, r) => (a > r.created_at ? a : r.created_at), ''),
    };
  });

  return out.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
}
