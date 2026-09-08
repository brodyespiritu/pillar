// Supabase Edge Function — receive inbound SMS replies from Telnyx.
//
// Deploy (public — Telnyx calls it, not the app):
//   supabase functions deploy telnyx-inbound --no-verify-jwt
// Then set this URL as the Inbound Webhook on your Telnyx Messaging Profile:
//   https://<PROJECT_REF>.supabase.co/functions/v1/telnyx-inbound
//
// Stores each received message on sms_messages with direction='in' so the
// Guests → Conversations popup threads it under the sender's number.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { careIntake, reply } from '../_shared/careFlow.ts';
import { keyword } from '../_shared/careReply.ts';
import { dinnerAck, rsvpName } from '../_shared/dinnerAck.ts';
import { pollAnswer } from '../_shared/poll.ts';
import { CARE_SIGNAL } from '../_shared/careIntake.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Carrier-standard opt-out / opt-in keywords (the whole message must be one).
const STOP_WORDS  = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];
const START_WORDS = ['start', 'unstop', 'yes'];

/*
 * Somebody texted STOP (or START).
 *
 * Two records to keep in step, because a person can be both: a staff member's
 * Cares-alert preference, and a congregation contact's opt-out flag. This used
 * to update only staff, which meant an ordinary member who opted out stayed in
 * the contact list, kept inflating the recipient count, and was attempted on
 * every broadcast — Telnyx refused each one, so nobody was ever texted against
 * their wishes, but Pillar never knew.
 *
 * Matches on the last 10 digits so formatting differences in the stored number
 * do not cause a miss.
 */
async function applyOptOut(supabase: any, fromNumber: string, optOut: boolean) {
  const last10 = fromNumber.replace(/\D/g, '').slice(-10);
  if (!last10) return null;
  let touched = 0;

  /* ── Staff: the Cares alert preference ── */
  const { data: staff } = await supabase
    .from('staff')
    .select('id, phone, preferences')
    .ilike('phone', `%${last10}`);

  for (const s of staff || []) {
    const prefs = { ...(s.preferences || {}), caresSmsOptIn: !optOut, caresStopOptedOut: optOut };
    // Resuming means the next message should carry the opt-out notice again.
    if (!optOut) delete prefs.caresStopNoticeSent;
    await supabase.from('staff').update({ preferences: prefs }).eq('id', s.id);
    touched += 1;
  }

  /* ── Congregation contacts: the opt-out flag ── */
  const { data: contacts } = await supabase
    .from('sms_contacts')
    .select('id')
    .ilike('phone', `%${last10}`);

  if (contacts?.length) {
    const { error } = await supabase
      .from('sms_contacts')
      .update({ opted_out: optOut, opted_out_at: optOut ? new Date().toISOString() : null })
      .in('id', contacts.map((c: any) => c.id));
    /* Never fatal: the provider has already suppressed them either way, and a
       failure here must not stop the webhook acknowledging. */
    if (error) console.error('could not flag contact opt-out:', error.message);
    else touched += contacts.length;
  }

  return touched || null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');

  try {
    const evt = await req.json();
    const p = evt?.data?.payload ?? {};
    const type = evt?.data?.event_type;

    // Only act on inbound messages; ack everything else (delivery receipts, etc.)
    if (type !== 'message.received') {
      return new Response(JSON.stringify({ ok: true, ignored: type }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fromNumber = p?.from?.phone_number || '';
    const toNumber   = Array.isArray(p?.to) ? (p.to[0]?.phone_number || '') : (p?.to?.phone_number || '');
    const text = p?.text ?? '';
    if (!fromNumber) return new Response(JSON.stringify({ ok: true, skipped: 'no from' }));

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Best-effort: carry over a known contact/guest name for the thread label.
    let name = '';
    const last10 = fromNumber.replace(/\D/g, '').slice(-10);
    if (last10) {
      const { data } = await supabase
        .from('sms_messages')
        .select('to_name')
        .ilike('to_number', `%${last10}`)
        .not('to_name', 'is', null)
        .limit(1);
      name = data?.[0]?.to_name || '';
    }

    /*
     * Who sent this decides which channel it is logged to. A Cares-alert staff
     * member's text is pastoral traffic — it must never land in the SMS log the
     * Responses tab reads, not even briefly before intake reclassifies it.
     */
    let sender: any = null;
    if (last10) {
      const { data } = await supabase
        .from('staff').select('id, name, active, preferences')
        .ilike('phone', `%${last10}`).limit(1);
      const s = data?.[0];
      if (s && s.active !== false && s.preferences?.caresSmsOptIn === true) sender = s;
    }

    /*
     * Telnyx retries when a webhook is slow or errors. A unique index on
     * provider_id makes the retry's insert fail, which is how we know to stop —
     * without it a retry would file the same care record twice.
     */
    const { error: logErr } = await supabase.from('sms_messages').insert({
      to_number: fromNumber,      // the conversation partner (thread key)
      from_number: toNumber,      // our Telnyx number
      to_name: name || null,
      body: text,
      direction: 'in',
      status: 'Received',
      provider_id: p?.id || null,
      channel: sender ? 'care' : 'sms',
    });
    if (logErr?.code === '23505') {
      return new Response(JSON.stringify({ ok: true, duplicate: p?.id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Honor opt-out/opt-in keywords after logging, so the reply is on record.
    const kw = keyword(text);
    let optOutApplied = null;
    if (STOP_WORDS.includes(kw))       optOutApplied = await applyOptOut(supabase, fromNumber, true);
    else if (START_WORDS.includes(kw)) optOutApplied = await applyOptOut(supabase, fromNumber, false);

    /*
     * What happens next depends entirely on who texted, and the two rails never
     * meet: a Cares-alert staff member's message goes to care intake, and
     * everyone else's is congregation SMS. Opt-out keywords are handled above
     * and must not also be read as a care report or an RSVP.
     *
     * Either path reads, writes and sends — well over the 2 seconds Telnyx
     * allows before it calls the webhook failed and retries. Acknowledge now,
     * finish afterwards.
     */
    const after = (work: Promise<unknown>) => {
      // @ts-ignore -- provided by the edge runtime
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) return void EdgeRuntime.waitUntil(work);
      return work;   // local dev has no waitUntil
    };

    let queued: string | false = false;
    if (optOutApplied == null && sender) {
      {
        const s = sender;
        queued = 'care';
        const work = (async () => {
          try {
            /*
             * Staff are on the congregation text list too, and a plain
             * headcount answering a dinner invitation is an RSVP, not a care
             * report — intake would swallow it and the reservation would never
             * reach the tally. Anything carrying a care signal ("broke her
             * wrist", "in the hospital") stays on the care rail untouched, so
             * nothing pastoral can be reclassified by a stray number.
             */
            if (!CARE_SIGNAL.test(text)) {
              /*
               * A poll answer, checked before the RSVP for the same reason the RSVP is
               * checked before intake: staff are on the congregation list too, and a
               * bare "1" answering a poll is not a care report. Without this a deacon
               * who also takes Cares alerts had their answer swallowed by the care
               * rail and never recorded — which is exactly what happened in testing.
               */
              const polled = await pollAnswer(supabase, SUPABASE_URL, SERVICE_ROLE, fromNumber, text);
              if (polled) {
                // Congregation traffic after all — let it be seen on the SMS rail.
                if (p?.id) await supabase.from('sms_messages').update({ channel: 'sms' }).eq('provider_id', p.id);
                return;
              }
              const rsvp = await dinnerAck(supabase, SUPABASE_URL, SERVICE_ROLE, fromNumber, text);
              if (rsvp) {
                // Congregation traffic after all — let it count and be seen.
                if (p?.id) await supabase.from('sms_messages').update({ channel: 'sms' }).eq('provider_id', p.id);
                return;
              }
            }

            const answer = await careIntake(supabase, fromNumber, text, s.name || 'staff');
            if (!answer) return;
            await reply(SUPABASE_URL, SERVICE_ROLE, fromNumber, answer);
            await supabase.from('sms_messages').insert({
              to_number: fromNumber, from_number: toNumber, to_name: s.name || null,
              body: answer, direction: 'out', status: 'CareIntake', channel: 'care',
            });
          } catch (e) {
            console.error('care intake error:', e);
          }
        })();
        await after(work);
      }
    } else if (optOutApplied == null && !sender && !STOP_WORDS.includes(kw)) {
      /*
       * An ordinary congregation reply. A headcount answering a dinner invite
       * gets an automatic acknowledgement; anything else waits for a person.
       * Cares staff are excluded above — their traffic stays on the care rail
       * and is never answered from here.
       */
      queued = 'dinner';
      const work = (async () => {
        try {
          /*
           * A poll answer first. Both a poll and a dinner are answered with a bare
           * number, so whichever was actually asked has to win — and a poll is the
           * narrower reading: pollChoice only accepts a digit matching an option it
           * offered, where a headcount accepts any number. Checking dinners first
           * would swallow "2" meaning "a summary once per day" as two plates.
           */
          const polled = await pollAnswer(supabase, SUPABASE_URL, SERVICE_ROLE, fromNumber, text);
          if (polled) return;

          const ack = await dinnerAck(supabase, SUPABASE_URL, SERVICE_ROLE, fromNumber, text);
          /*
           * Someone arriving from the public link has never been texted, so
           * there is no name on file — but they typed one. Keep it, or the
           * reservation reads as ten digits on the Responses list.
           */
          if (ack && !name && p?.id) {
            const who = rsvpName(text);
            if (who) await supabase.from('sms_messages').update({ to_name: who }).eq('provider_id', p.id);
          }
        } catch (e) { console.error('dinner ack error:', e); }
      })();
      await after(work);
    }

    return new Response(JSON.stringify({ ok: true, keyword: optOutApplied != null ? kw : undefined, queued }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Return 200 so Telnyx doesn't hammer retries on a parse error; log for debugging.
    console.error('telnyx-inbound error:', e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
