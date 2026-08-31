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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { nextOccurrence } from '../_shared/recurrence.ts';

const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY')!;
const TELNYX_FROM    = Deno.env.get('TELNYX_FROM_NUMBER')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
/* The scheduler's own secret. Until now this function's only gate was
   verify_jwt, which the ANON key satisfies — and that key ships in the public
   browser bundle, so anyone could have triggered a broadcast to the whole
   congregation. Deployed with --no-verify-jwt; this check is the gate. */
const CRON_SECRET    = Deno.env.get('CARES_CRON_SECRET') || '';

const enc = new TextEncoder();
function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
function roleOf(token: string) {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const pad = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(pad + '='.repeat((4 - pad.length % 4) % 4)))?.role || '';
  } catch { return ''; }
}
function authorized(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (roleOf(token) === 'service_role') return true;
  if (CRON_SECRET && timingSafeEqual(token, CRON_SECRET)) return true;
  return !!SERVICE_ROLE && timingSafeEqual(token, SERVICE_ROLE);
}

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

/*
 * Who a recurring send should reach this time round.
 *
 * The stored recipient list is a snapshot from when the schedule was made, so a
 * weekly text would keep going to the congregation as it was months ago and
 * never reach anyone who joined since. When the schedule records who it was
 * aimed at, the list is rebuilt at send time instead.
 */
async function resolveRecipients(supabase: any, targetKey: string | null) {
  if (!targetKey) return null;

  const contacts: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('sms_contacts').select('id, name, phone, opted_out').order('id').range(from, from + 999);
    if (error) return null;                       // fall back to the snapshot
    contacts.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  /* A schedule set up before somebody opted out must not text them when it
     finally fires. */
  const withPhone = contacts.filter(c => String(c.phone || '').trim() && !c.opted_out);
  const shape = (c: any) => ({ name: c.name || '', phone: String(c.phone).trim() });

  if (targetKey === 'all') return withPhone.map(shape);

  const { data: mem } = await supabase
    .from('sms_group_members').select('contact_id').eq('group_id', targetKey);
  const ids = new Set((mem || []).map((m: any) => m.contact_id));
  return withPhone.filter(c => ids.has(c.id)).map(shape);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!authorized(req)) {
      return new Response(JSON.stringify({ ok: false, error: 'forbidden' }),
        { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
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

      /* Written as the send runs — see send-prospect-sms. Buffering the whole
         broadcast put the only write after hundreds of sequential Telnyx calls,
         so a timeout there meant delivered texts and no record of them. */
      const LOG_BATCH = 25;
      const logErrors: string[] = [];
      const flushLog = async () => {
        if (!rows.length) return;
        const batch = rows.splice(0, rows.length);
        const { error } = await supabase.from('sms_messages').insert(batch);
        if (error) logErrors.push(error.message);
      };

      for (const r of recipients) {
        const to = toE164(r.phone);
        if (to.length < 12) continue;
        /* Stamped per message, not per batch — see send-prospect-sms. A reply
           that arrives mid-broadcast must not be older than the text it
           answers, or it gets filed under the previous campaign. */
        const at = new Date().toISOString();
        try {
          const res = await fetch('https://api.telnyx.com/v2/messages', {
            method: 'POST',
            headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: TELNYX_FROM, to, text: job.body }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `HTTP ${res.status}`);
          sent++;
          rows.push({ to_number: to, to_name: r.name || '', body: job.body, status: 'MassText', provider_id: data?.data?.id, owner: job.owner, created_at: at });
        } catch (e) {
          firstError ??= String((e as Error).message || e);
          rows.push({ to_number: to, to_name: r.name || '', body: job.body, status: 'Failed', error: String((e as Error).message || e), owner: job.owner, created_at: at });
        }
        if (rows.length >= LOG_BATCH) await flushLog();
      }

      await flushLog();
      if (logErrors.length) console.error('sms_messages log failed:', logErrors.join('; '));

      await supabase.from('sms_scheduled').update({
        status: sent > 0 ? 'sent' : 'failed',
        sent_count: sent,
        error: firstError,
        sent_at: new Date().toISOString(),
      }).eq('id', job.id);

      /*
       * Lay down the next occurrence. One row at a time, written only once this
       * one is finished — so a series cannot fan out, and cancelling the
       * pending row ends it. It is queued even when the send failed: a Telnyx
       * outage on one Sunday should not silently end a weekly reminder.
       *
       * If the cron has been down, stepping forward one interval at a time
       * skips the missed dates rather than firing them all at once.
       */
      let nextAt = nextOccurrence(job.send_at, job.repeat_rule);
      for (let guard = 0; nextAt && Date.parse(nextAt) <= Date.now() && guard < 120; guard++) {
        nextAt = nextOccurrence(nextAt, job.repeat_rule);
      }
      if (nextAt) {
        const fresh = await resolveRecipients(supabase, job.target_key ?? null);
        const { error: repErr } = await supabase.from('sms_scheduled').insert({
          owner: job.owner,
          body: job.body,
          target_label: job.target_label,
          recipients: fresh ?? job.recipients,
          send_at: nextAt,
          message_type: job.message_type || 'General',
          repeat_rule: job.repeat_rule,
          target_key: job.target_key ?? null,
        });
        if (repErr) console.error('could not queue the next occurrence:', repErr.message);
      }

      /*
       * Reflect the send in the library (dedupe by identical body). The message
       * type rides along because the inbound webhook reads it to decide whether
       * a reply is a dinner headcount — a scheduled dinner has to be as
       * recognisable as one sent by hand.
       */
      const messageType = job.message_type || 'General';
      const { data: lib } = await supabase.from('sms_library').select('id').eq('body', job.body).limit(1);
      if (lib?.length) {
        await supabase.from('sms_library').update({
          last_sent_at: new Date().toISOString(),
          recipient_count: recipients.length,
          target_label: job.target_label,
          message_type: messageType,
        }).eq('id', lib[0].id);
      } else {
        await supabase.from('sms_library').insert({
          owner: job.owner, body: job.body, target_label: job.target_label,
          recipient_count: recipients.length, last_sent_at: new Date().toISOString(),
          message_type: messageType,
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
