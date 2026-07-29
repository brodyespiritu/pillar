// Supabase Edge Function — receive inbound SMS replies from Telnyx.
//
// Deploy (public — Telnyx calls it, not the app):
//   supabase functions deploy telnyx-inbound --no-verify-jwt
// Then set this URL as the Inbound Webhook on your Telnyx Messaging Profile:
//   https://<PROJECT_REF>.supabase.co/functions/v1/telnyx-inbound
//
// Stores each received message on sms_messages with direction='in' so the
// Guests → Conversations popup threads it under the sender's number.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Carrier-standard opt-out / opt-in keywords (the whole message must be one).
const STOP_WORDS  = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];
const START_WORDS = ['start', 'unstop', 'yes'];
const keyword = (t: string) => t.trim().toLowerCase().replace(/[^a-z]/g, '');

/*
 * A staff member texted STOP (or START). Flip their Cares alert preference so
 * we stop (or resume) texting that number. Matches on the last 10 digits so
 * formatting differences in the stored number don't cause a miss.
 */
async function applyOptOut(supabase: any, fromNumber: string, optOut: boolean) {
  const last10 = fromNumber.replace(/\D/g, '').slice(-10);
  if (!last10) return null;

  const { data: staff } = await supabase
    .from('staff')
    .select('id, phone, preferences')
    .ilike('phone', `%${last10}`);
  if (!staff?.length) return null;

  for (const s of staff) {
    const prefs = { ...(s.preferences || {}), caresSmsOptIn: !optOut, caresStopOptedOut: optOut };
    // Resuming means the next message should carry the opt-out notice again.
    if (!optOut) delete prefs.caresStopNoticeSent;
    await supabase.from('staff').update({ preferences: prefs }).eq('id', s.id);
  }
  return staff.length;
}

serve(async (req) => {
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

    await supabase.from('sms_messages').insert({
      to_number: fromNumber,      // the conversation partner (thread key)
      from_number: toNumber,      // our Telnyx number
      to_name: name || null,
      body: text,
      direction: 'in',
      status: 'Received',
      provider_id: p?.id || null,
    });

    // Honor opt-out/opt-in keywords after logging, so the reply is on record.
    const kw = keyword(text);
    let optOutApplied = null;
    if (STOP_WORDS.includes(kw))       optOutApplied = await applyOptOut(supabase, fromNumber, true);
    else if (START_WORDS.includes(kw)) optOutApplied = await applyOptOut(supabase, fromNumber, false);

    return new Response(JSON.stringify({ ok: true, keyword: optOutApplied != null ? kw : undefined }), {
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
