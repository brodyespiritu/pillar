// Supabase Edge Function — dispatch due scheduled SMS broadcasts via Telnyx.
//
// Deploy:  supabase functions deploy send-scheduled-sms
// Cron:    run every minute (see supabase/sms-library-schema.sql for the
//          cron.schedule block, or add a Dashboard cron job hitting this URL).
//
// Picks up sms_scheduled rows with status='pending' and send_at <= now(),
// claims them (status='processing') so overlapping runs can't double-send,
// texts each recipient individually, logs to sms_messages, then marks the
// row sent/failed.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY')!;
const TELNYX_FROM    = Deno.env.get('TELNYX_FROM_NUMBER')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Telnyx requires E.164 (e.g. +14045551234).
function toE164(raw: string): string {
  const s = String(raw || '').trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return d ? '+' + d : '';
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!TELNYX_API_KEY || !TELNYX_FROM) {
      throw new Error('Telnyx not configured — set TELNYX_API_KEY and TELNYX_FROM_NUMBER secrets.');
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Claim due rows (atomic: only rows still 'pending' flip to 'processing').
    const { data: due, error } = await supabase
      .from('sms_scheduled')
      .update({ status: 'processing' })
      .eq('status', 'pending')
      .lte('send_at', new Date().toISOString())
      .select();
    if (error) throw error;
    if (!due?.length) {
      return new Response(JSON.stringify({ dispatched: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let dispatched = 0;
    for (const job of due) {
      const recipients = Array.isArray(job.recipients) ? job.recipients : [];
      let sent = 0;
      let firstError: string | null = null;
      const rows: Record<string, unknown>[] = [];

      for (const r of recipients) {
        const to = toE164(r.phone);
        if (to.length < 12) continue;
        try {
          const res = await fetch('https://api.telnyx.com/v2/messages', {
            method: 'POST',
            headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: TELNYX_FROM, to, text: job.body }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `HTTP ${res.status}`);
          sent++;
          rows.push({ to_number: to, to_name: r.name || '', body: job.body, status: 'MassText', provider_id: data?.data?.id, owner: job.owner });
        } catch (e) {
          firstError ??= String((e as Error).message || e);
          rows.push({ to_number: to, to_name: r.name || '', body: job.body, status: 'Failed', error: String((e as Error).message || e), owner: job.owner });
        }
      }

      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from('sms_messages').insert(rows.slice(i, i + 100));
      }

      await supabase.from('sms_scheduled').update({
        status: sent > 0 ? 'sent' : 'failed',
        sent_count: sent,
        error: firstError,
        sent_at: new Date().toISOString(),
      }).eq('id', job.id);

      // Reflect the send in the library (dedupe by identical body)
      const { data: lib } = await supabase.from('sms_library').select('id').eq('body', job.body).limit(1);
      if (lib?.length) {
        await supabase.from('sms_library').update({
          last_sent_at: new Date().toISOString(),
          recipient_count: recipients.length,
          target_label: job.target_label,
        }).eq('id', lib[0].id);
      } else {
        await supabase.from('sms_library').insert({
          owner: job.owner, body: job.body, target_label: job.target_label,
          recipient_count: recipients.length, last_sent_at: new Date().toISOString(),
        });
      }
      dispatched++;
    }

    return new Response(JSON.stringify({ dispatched }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
