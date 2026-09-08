// Supabase Edge Function — send mass prospect texts via Telnyx (one thread per person).
//
// Deploy:
//   supabase functions deploy send-prospect-sms
//   supabase secrets set TELNYX_API_KEY=KEY123 TELNYX_FROM_NUMBER=+15551234567
//
// The frontend calls it with:
//   supabase.functions.invoke('send-prospect-sms', { body: { messages: [{ to_number, to_name, body }] } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELNYX_API_KEY   = Deno.env.get('TELNYX_API_KEY')!;
const TELNYX_FROM       = Deno.env.get('TELNYX_FROM_NUMBER')!;
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Telnyx requires E.164 (e.g. +14045551234). Normalize however the number was stored.
function toE164(raw: string): string {
  const s = String(raw || '').trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;                    // US 10-digit
  if (d.length === 11 && d.startsWith('1')) return '+' + d; // US with country code
  return d ? '+' + d : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!TELNYX_API_KEY || !TELNYX_FROM) {
      throw new Error('Telnyx not configured — set TELNYX_API_KEY and TELNYX_FROM_NUMBER secrets.');
    }
    /* `channel` marks pastoral-care traffic so it is written out of reach of
       the SMS views. Defaults to ordinary congregation SMS. */
    const { messages, channel, status, campaign } = await req.json();
    const chan = channel === 'care' ? 'care' : 'sms';
    /*
     * What to file a delivered message as. The Responses tab reads the last
     * thing we sent someone as the question their next reply answers, so an
     * automatic acknowledgement has to be labelled — otherwise it becomes the
     * question and splits the campaign it was answering.
     */
    const label = typeof status === 'string' && /^[A-Za-z]{1,24}$/.test(status) ? status : 'MassText';
    /* The message this send is about, when it is not the send itself — a
       reminder chases a campaign whose text it does not repeat. */
    const about = typeof campaign === 'string' && campaign.trim() ? campaign.trim().slice(0, 2000) : null;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    let sent = 0;
    const failed: { to_name: string; error: string }[] = [];
    const rows: any[] = [];

    /*
     * Hard stop for pastoral care.
     *
     * Care content may only ever reach staff who an admin put on the Cares
     * alert list. Every care message in the system funnels through this one
     * function, so the rule is enforced here rather than trusting each caller:
     * a bug upstream, a bad recipient list, or a future feature cannot text a
     * congregation member somebody's medical detail. Blocked messages are
     * recorded, never delivered.
     */
    let careAllowed: Set<string> | null = null;
    if (chan === 'care') {
      const { data: staffRows, error: staffErr } = await supabase
        .from('staff').select('phone, active, preferences');
      // If the roster can't be read we refuse everything rather than guess.
      const allowed = new Set(
        (staffErr ? [] : (staffRows || []))
          .filter((s: any) => s.active !== false && s.preferences?.caresSmsOptIn === true)
          .map((s: any) => String(s.phone || '').replace(/\D/g, '').slice(-10))
          .filter(Boolean),
      );

      /*
       * Deacons as well.
       *
       * A deacon told that one of the families they shepherd is in hospital is
       * care content reaching somebody entitled to it — that is the whole point
       * of the alerts. Without this the rule above blocks every one of them,
       * because a deacon is a congregation contact, not Cares-alert staff.
       *
       * Widened only as far as the Deacons SMS group. WHICH family reaches
       * WHICH deacon is settled upstream by deacon_id; this is the coarser
       * question of whether a person may receive care content at all.
       */
      if (!staffErr) {
        const tail = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
        const { data: groups } = await supabase.from('sms_groups').select('id, name');
        const deaconGroup = (groups || []).find(
          (g: any) => String(g.name || '').trim().toLowerCase() === 'deacons');
        if (deaconGroup) {
          const { data: gm } = await supabase.from('sms_group_members')
            .select('contact_id').eq('group_id', deaconGroup.id);
          const ids = new Set((gm || []).map((r: any) => r.contact_id));
          if (ids.size) {
            const { data: cs } = await supabase.from('sms_contacts').select('id, phone');
            for (const c of cs || []) {
              if (!ids.has(c.id)) continue;
              const t = tail(c.phone);
              if (t) allowed.add(t);
            }
          }
        }
      }
      careAllowed = allowed;
    }

    // Send each individually — no group chats.
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

    for (const m of messages) {
      /*
       * When this one actually went out.
       *
       * The rows are batched and written after the whole loop, so letting
       * created_at default to now() stamped every message in a broadcast with
       * the moment the LAST one was sent. Anyone who replied while the send was
       * still running then had an inbound row older than the outbound it was
       * answering — and the Responses tab, which reads a reply as answering the
       * last thing sent before it, filed them under the previous campaign.
       */
      const at = new Date().toISOString();
      try {
        const toNumber = toE164(m.to_number);
        if (toNumber.length < 12) throw new Error(`Invalid phone number: "${m.to_number}"`);

        if (careAllowed && !careAllowed.has(toNumber.replace(/\D/g, '').slice(-10))) {
          rows.push({ to_number: m.to_number, to_name: m.to_name, body: m.body,
                      status: 'Blocked', channel: 'care', created_at: at,
                      error: 'Blocked: care content may only go to Cares-alert staff' });
          failed.push({ to_name: m.to_name, error: 'Blocked: not a Cares-alert staff number' });
          continue;
        }
        const res = await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: TELNYX_FROM, to: toNumber, text: m.body }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `HTTP ${res.status}`);
        sent++;
        rows.push({ to_number: m.to_number, to_name: m.to_name, body: m.body, status: label, provider_id: data?.data?.id, channel: chan, campaign: about, created_at: at });
      } catch (e) {
        failed.push({ to_name: m.to_name, error: String(e.message || e) });
        rows.push({ to_number: m.to_number, to_name: m.to_name, body: m.body, status: 'Failed', error: String(e.message || e), channel: chan, created_at: at });
      }
      if (rows.length >= LOG_BATCH) await flushLog();
    }

    await flushLog();

    return new Response(JSON.stringify({ sent, failed, logged, logErrors }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
