// Supabase Edge Function — dispatch due scheduled SMS broadcasts via Telnyx.
//
// Deploy:  supabase functions deploy send-scheduled-sms --no-verify-jwt
// Cron:    run every minute (see supabase/sms-library-schema.sql for the
//          cron.schedule block, or add a Dashboard cron job hitting this URL).
//
// Picks up sms_scheduled rows with status='pending' and send_at <= now(),
// claims them (status='processing') so overlapping runs can't double-send,
// texts each recipient individually, logs to sms_messages, then marks the
// row sent/failed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { nextOccurrence } from '../_shared/recurrence.ts';
import { activeMaintenance } from '../_shared/maintenance.ts';
import { toGsm } from '../_shared/smsEncoding.ts';
import { systemCaller } from '../_shared/callers.ts';
import { toE164 } from '../_shared/phone.ts';
import { loadRoster, screenMessages, parseTarget } from '../_shared/recipients.ts';

const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY')!;
const TELNYX_FROM    = Deno.env.get('TELNYX_FROM_NUMBER')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
/* The scheduler's own secret. Until now this function's only gate was
   verify_jwt, which the ANON key satisfies — and that key ships in the public
   browser bundle, so anyone could have triggered a broadcast to the whole
   congregation. Deployed with --no-verify-jwt; this check is the gate. */
const CRON_SECRET    = Deno.env.get('CARES_CRON_SECRET') || '';

/* The cron secret or the service-role key, each matched exactly — see
   _shared/callers.ts. This also used to accept any token that merely claimed
   role "service_role", decoded with atob and never verified, so a token typed by
   hand could set every due scheduled text going. */
function authorized(req: Request) {
  return systemCaller(req, { serviceRole: SERVICE_ROLE, cronSecret: CRON_SECRET }) !== null;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/*
 * Who a send should reach this time round.
 *
 * The stored recipient list is a snapshot from when the schedule was made. That
 * used to be rebuilt only for repeating texts, so a one-off text scheduled on
 * Monday for Sunday still went to everyone who was in the group on Monday —
 * including somebody taken off the Deacons list in between. Any schedule that
 * records who it was aimed at is rebuilt at send time now; only a hand-picked
 * list, which has no group to rebuild from, keeps its snapshot.
 */
async function resolveRecipients(supabase: any, targetKey: string | null) {
  if (!targetKey) return null;

  const contacts: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('sms_contacts').select('id, name, phone, opted_out').order('id').range(from, from + 999);
    if (error) return null;                       // fall back to the snapshot, still screened below
    contacts.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const withPhone = contacts.filter(c => String(c.phone || '').trim() && !c.opted_out);
  const shape = (c: any) => ({ name: c.name || '', phone: String(c.phone).trim() });

  if (targetKey === 'all') return withPhone.map(shape);

  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('sms_group_members').select('contact_id').eq('group_id', targetKey).order('contact_id').range(from, from + 999);
    if (error) return null;
    for (const m of data || []) ids.add(m.contact_id);
    if (!data || data.length < 1000) break;
  }
  return withPhone.filter(c => ids.has(c.id)).map(shape);
}

const targetOf = (key: string | null) =>
  key === 'all' ? { kind: 'all' as const } : parseTarget({ kind: 'group', id: key });

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

    /*
     * Before the claim, not after. A claimed row flips to 'processing' and
     * nothing ever sets it back, so blocking the send later would strand it for
     * good. Left 'pending', a due row simply waits for the window to close.
     */
    const paused = await activeMaintenance(supabase);
    if (paused) {
      return new Response(JSON.stringify({ dispatched: 0, skipped: 'maintenance', until: paused.ends_at }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

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

    /* Who may put a text on the schedule: active staff, as of now. */
    const { data: staffRows } = await supabase.from('staff').select('id, active');
    const activeStaff = new Set((staffRows || []).filter((s: any) => s.active !== false).map((s: any) => s.id));

    let dispatched = 0;
    for (const job of due) {
      const body = String(job.body ?? '').trim();

      /*
       * The send functions only take texts from active staff; a scheduled row is
       * a text too. A row written by anyone else — or by someone who has since
       * left — is refused, and so is the series it belongs to.
       */
      if (!activeStaff.has(job.owner)) {
        await supabase.from('sms_scheduled').update({
          status: 'failed', sent_count: 0, sent_at: new Date().toISOString(),
          error: 'Not sent: scheduled by someone who is not active staff',
        }).eq('id', job.id);
        console.warn('refused scheduled text from a non-staff owner:', job.id);
        continue;
      }

      const fresh = await resolveRecipients(supabase, job.target_key ?? null);
      const recipients = fresh ?? (Array.isArray(job.recipients) ? job.recipients : []);
      const target = job.target_key ? targetOf(job.target_key) : null;

      /* The same rules as every other send — see _shared/recipients.ts. */
      const roster = await loadRoster(supabase, { channel: 'sms', target });
      const { send, blocked, skipped } = screenMessages(
        recipients.map((r: any) => ({ to_number: String(r.phone ?? ''), to_name: r.name || '', body })),
        roster, { channel: 'sms', status: 'MassText' },
      );
      for (const b of blocked) console.warn(`scheduled ${job.id} blocked: ${b.reason}`);

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

      for (const r of send) {
        const to = toE164(r.to_number);
        /* Stamped per message, not per batch — see send-prospect-sms. A reply
           that arrives mid-broadcast must not be older than the text it
           answers, or it gets filed under the previous campaign. */
        const at = new Date().toISOString();
        try {
          const res = await fetch('https://api.telnyx.com/v2/messages', {
            method: 'POST',
            headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
            /* Plain punctuation on the wire, the typed text in the log — the
               reasons are with the same line in send-prospect-sms. The library
               lookup below matches on the body, so the log must keep it as is. */
            body: JSON.stringify({ from: TELNYX_FROM, to, text: toGsm(body) }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `HTTP ${res.status}`);
          sent++;
          rows.push({ to_number: to, to_name: r.to_name || '', body, status: 'MassText', provider_id: data?.data?.id, owner: job.owner, created_at: at });
        } catch (e) {
          firstError ??= String((e as Error).message || e);
          rows.push({ to_number: to, to_name: r.to_name || '', body, status: 'Failed', error: String((e as Error).message || e), owner: job.owner, created_at: at });
        }
        if (rows.length >= LOG_BATCH) await flushLog();
      }

      await flushLog();
      if (logErrors.length) console.error('sms_messages log failed:', logErrors.join('; '));

      const refused = blocked.length ? `${blocked.length} not sent: ${blocked[0].reason}` : null;
      await supabase.from('sms_scheduled').update({
        status: sent > 0 ? 'sent' : 'failed',
        sent_count: sent,
        error: firstError || refused || (sent === 0 && skipped.length ? skipped[0].reason : null),
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
        const { error: repErr } = await supabase.from('sms_scheduled').insert({
          owner: job.owner,
          body,
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
      const { data: lib } = await supabase.from('sms_library').select('id').eq('body', body).limit(1);
      if (lib?.length) {
        await supabase.from('sms_library').update({
          last_sent_at: new Date().toISOString(),
          recipient_count: send.length,
          target_label: job.target_label,
          message_type: messageType,
        }).eq('id', lib[0].id);
      } else {
        await supabase.from('sms_library').insert({
          owner: job.owner, body, target_label: job.target_label,
          recipient_count: send.length, last_sent_at: new Date().toISOString(),
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
