// Supabase Edge Function — send mass prospect texts via Telnyx (one thread per person).
//
// Deploy:
//   supabase functions deploy send-prospect-sms
//   supabase secrets set TELNYX_API_KEY=KEY123 TELNYX_FROM_NUMBER=+15551234567
//
// The frontend calls it with:
//   supabase.functions.invoke('send-prospect-sms', { body: { messages: [{ to_number, to_name, body }] } })

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!TELNYX_API_KEY || !TELNYX_FROM) {
      throw new Error('Telnyx not configured — set TELNYX_API_KEY and TELNYX_FROM_NUMBER secrets.');
    }
    const { messages } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    let sent = 0;
    const failed: { to_name: string; error: string }[] = [];
    const rows: any[] = [];

    // Send each individually — no group chats.
    for (const m of messages) {
      try {
        const toNumber = toE164(m.to_number);
        if (toNumber.length < 12) throw new Error(`Invalid phone number: "${m.to_number}"`);
        const res = await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: TELNYX_FROM, to: toNumber, text: m.body }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `HTTP ${res.status}`);
        sent++;
        rows.push({ to_number: m.to_number, to_name: m.to_name, body: m.body, status: 'MassText', provider_id: data?.data?.id });
      } catch (e) {
        failed.push({ to_name: m.to_name, error: String(e.message || e) });
        rows.push({ to_number: m.to_number, to_name: m.to_name, body: m.body, status: 'Failed', error: String(e.message || e) });
      }
    }

    // Batch DB writes in groups of 100.
    for (let i = 0; i < rows.length; i += 100) {
      await supabase.from('sms_messages').insert(rows.slice(i, i + 100));
    }

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
