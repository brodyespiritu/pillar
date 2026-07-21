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

    return new Response(JSON.stringify({ ok: true }), {
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
