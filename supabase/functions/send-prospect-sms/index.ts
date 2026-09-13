// Supabase Edge Function — every text Pillar sends goes out through here, via Telnyx
// (one thread per person). The scheduler is the one exception; it applies the same
// recipient rules itself (see send-scheduled-sms).
//
// Deploy (the function checks its own callers — see _shared/callers.ts):
//   supabase functions deploy send-prospect-sms --no-verify-jwt
//   supabase secrets set TELNYX_API_KEY=KEY123 TELNYX_FROM_NUMBER=+15551234567
//
// The frontend calls it with:
//   supabase.functions.invoke('send-prospect-sms', { body: {
//     messages: [{ to_number, to_name, body }],
//     status?,             // what to file it as: 'Reply', 'Reminder', 'Approval', ...
//     campaign?,           // the message a reminder chases
//     target?,             // { kind: 'all' } | { kind: 'group', id } — a group send is
//                          //   re-checked against the group as it stands now
//   } })
// Pillar's own functions may also pass:
//   channel: 'care', audience: 'staff' | 'deacons'
//   dryRun: true         // every check, no Telnyx, no log — returns what would happen

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { activeMaintenance, maintenanceNotice } from '../_shared/maintenance.ts';
import { toGsm } from '../_shared/smsEncoding.ts';
import { authorizeSender } from '../_shared/callers.ts';
import { toE164 } from '../_shared/phone.ts';
import { loadRoster, screenMessages, parseTarget, parseAudience } from '../_shared/recipients.ts';

const TELNYX_API_KEY   = Deno.env.get('TELNYX_API_KEY')!;
const TELNYX_FROM       = Deno.env.get('TELNYX_FROM_NUMBER')!;
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    /*
     * Before anything else — before the body is read, before maintenance, before
     * the Telnyx configuration is so much as mentioned. Only Pillar's own
     * functions and signed-in active staff may send; see _shared/callers.ts.
     * This function ran with no check at all, so its public URL would text
     * anyone, from the church's number, for anyone who found it.
     */
    const caller = await authorizeSender(req, supabase, SERVICE_ROLE);
    if (!caller.ok) return reply({ error: caller.error }, caller.status);

    const input = await req.json();
    const dryRun = input?.dryRun === true;
    if (dryRun && caller.kind !== 'system') return reply({ error: 'Dry runs are for Pillar itself.' }, 403);

    if (!dryRun && (!TELNYX_API_KEY || !TELNYX_FROM)) {
      throw new Error('Telnyx not configured — set TELNYX_API_KEY and TELNYX_FROM_NUMBER secrets.');
    }

    /*
     * `channel` marks pastoral-care traffic so it is written out of reach of the
     * SMS views, and — with `audience` — decides who may receive it at all.
     * Only Pillar's own functions may send care traffic: a signed-in person
     * asking for channel 'care' is sending an ordinary text.
     */
    const chan: 'sms' | 'care' = input?.channel === 'care' && caller.kind === 'system' ? 'care' : 'sms';
    const audience = chan === 'care' ? parseAudience(input?.audience) : null;
    const target = chan === 'sms' ? parseTarget(input?.target) : null;
    /*
     * What to file a delivered message as. The Responses tab reads the last
     * thing we sent someone as the question their next reply answers, so an
     * automatic acknowledgement has to be labelled — otherwise it becomes the
     * question and splits the campaign it was answering.
     */
    const status = input?.status;
    const label = typeof status === 'string' && /^[A-Za-z]{1,24}$/.test(status) ? status : 'MassText';
    /* The message this send is about, when it is not the send itself — a
       reminder chases a campaign whose text it does not repeat. */
    const campaign = input?.campaign;
    const about = typeof campaign === 'string' && campaign.trim() ? campaign.trim().slice(0, 2000) : null;

    /*
     * Trimmed before anything reads it. The composer handed over whatever was
     * typed, trailing blank lines included, while the library saves the trimmed
     * text — so replies were matched against a copy that differed by a newline
     * and polls were answered under the wrong question.
     */
    const messages = (Array.isArray(input?.messages) ? input.messages : []).map((m: any) => ({
      to_number: String(m?.to_number ?? ''),
      to_name: String(m?.to_name ?? ''),
      body: String(m?.body ?? '').trim(),
    }));

    /*
     * Scheduled maintenance — the backstop behind every other sender's own check.
     *
     * Answered 200 with a failure per message, not an error status. The web app
     * reads any non-2xx as "SMS backend not deployed", which would have staff
     * chasing a broken deployment during a planned pause. This way the reason
     * lands in the same place a Telnyx failure would, in words.
     */
    if (!dryRun) {
      const paused = await activeMaintenance(supabase);
      if (paused) {
        const notice = maintenanceNotice(paused);
        return reply({
          sent: 0,
          maintenance: true,
          until: paused.ends_at,
          failed: messages.map((m: any) => ({ to_name: m.to_name, to_number: m.to_number, error: notice })),
        });
      }
    }

    /*
     * Who may receive this, decided here and now — see _shared/recipients.ts.
     * Care content reaches only the audience named, checked against the Cares
     * staff list or the directory's deacons; a group send reaches only who is in
     * that group today; nobody who opted out; one copy per phone.
     */
    const roster = await loadRoster(supabase, { channel: chan, audience, target });
    const { send, blocked, skipped } = screenMessages(messages, roster, { channel: chan, audience, status: label });

    for (const b of blocked) console.warn(`blocked (${chan}${audience ? '/' + audience : ''}): ${b.reason}`);

    if (dryRun) {
      return reply({
        dryRun: true, channel: chan, audience, target,
        wouldSend: send.length,
        blocked: blocked.map(b => ({ to_name: b.to_name, reason: b.reason })),
        skipped: skipped.map(s => ({ to_name: s.to_name, reason: s.reason })),
      });
    }

    let sent = 0;
    const failed: { to_name: string; to_number: string; error: string; blocked?: boolean }[] = [];
    const rows: any[] = [];

    /*
     * Care messages that were refused are recorded (on the care channel, out of
     * the SMS views) so an admin can see a bug trying to text the wrong person.
     * Ordinary refusals — an opt-out, somebody no longer in the group — are not
     * written to the log: a row there reads as a text we sent them.
     */
    const at0 = new Date().toISOString();
    for (const b of blocked) {
      failed.push({ to_name: b.to_name || '', to_number: b.to_number, error: b.reason, blocked: true });
      if (chan === 'care') {
        rows.push({ to_number: b.to_number, to_name: b.to_name, body: b.body, status: 'Blocked',
                    channel: 'care', created_at: at0, error: `Blocked: ${b.reason}` });
      }
    }

    /*
     * The log is written as the send runs, not after it.
     *
     * Everything used to be buffered and inserted once every message had gone
     * out. A broadcast is hundreds of sequential Telnyx calls, so that put the
     * only write to sms_messages at the very end of the longest thing the
     * function does — and if it was killed on its time limit, or the insert
     * failed, the texts were already delivered and Pillar had no record of
     * them. Replies then arrived answering a message the app had never heard
     * of, and got filed under whatever was sent before it.
     *
     * The insert result is also checked now. It was discarded, which is what
     * made losing the entire log silent.
     */
    const LOG_BATCH = 25;
    let logged = 0;
    const logErrors: string[] = [];
    const flushLog = async () => {
      if (!rows.length) return;
      const batch = rows.splice(0, rows.length);
      const { error } = await supabase.from('sms_messages').insert(batch);
      if (error) logErrors.push(error.message);
      else logged += batch.length;
    };

    // Send each individually — no group chats.
    for (const m of send) {
      /*
       * When this one actually went out, stamped per message. A reply that
       * arrives while a broadcast is still running must not be older than the
       * text it answers, or the Responses tab files it under the previous one.
       */
      const at = new Date().toISOString();
      try {
        const res = await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
          /*
           * Plain punctuation on the wire; the text as typed in the log.
           *
           * One curly apostrophe sends the whole text as UCS-2 at 67 characters a
           * segment instead of 153 — the Sep 12 11:01 AM broadcast went out at 5
           * segments a person when 2 would have done. toGsm swaps typographic
           * quotes and dashes for plain ones and leaves anything genuinely outside
           * the alphabet (emoji, accented names) as written.
           *
           * The row below still records m.body, deliberately. Reply matching
           * compares the logged text with the library's copy, so logging the
           * normalised wire text would stop dinner headcounts and poll answers
           * matching the message they answer. Nothing reads the wire copy.
           */
          body: JSON.stringify({ from: TELNYX_FROM, to: toE164(m.to_number), text: toGsm(m.body) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `HTTP ${res.status}`);
        sent++;
        rows.push({ to_number: m.to_number, to_name: m.to_name, body: m.body, status: label, provider_id: data?.data?.id, channel: chan, campaign: about, created_at: at });
      } catch (e) {
        const error = String((e as Error).message || e);
        failed.push({ to_name: m.to_name || '', to_number: m.to_number, error });
        rows.push({ to_number: m.to_number, to_name: m.to_name, body: m.body, status: 'Failed', error, channel: chan, created_at: at });
      }
      if (rows.length >= LOG_BATCH) await flushLog();
    }

    await flushLog();

    return reply({
      sent, failed, logged, logErrors,
      skipped: skipped.map(s => ({ to_name: s.to_name || '', to_number: s.to_number, reason: s.reason })),
    });
  } catch (e) {
    return reply({ error: String((e as Error).message || e) }, 400);
  }
});
