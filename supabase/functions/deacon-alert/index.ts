/*
 * One deacon alert, the moment the record is written.
 *
 * The recap already sweeps for these every half hour, which is right for the
 * morning summary and too slow for "immediately" — a deacon who asked to hear
 * as it happens means as it happens, not by the next half past.
 *
 * So a database trigger calls this the instant a care record or a contact log
 * is inserted, with just the row's id. It resolves that one record, finds the
 * deacon who shepherds the family, and texts them if that is how they asked to
 * hear. Anyone on the morning summary is skipped here and picked up at 8:00.
 *
 * The half-hourly sweep is left in place deliberately. It claims through the
 * same table, so it can only ever send what this missed — a trigger that failed
 * to fire, or a row written while this function was down.
 *
 * Deploy with --no-verify-jwt:
 *   supabase functions deploy deacon-alert --no-verify-jwt
 * The trigger authenticates with CARES_CRON_SECRET, which is not a JWT. With
 * verify_jwt on, the gateway refused every call with "401 Invalid JWT" before
 * this code ever ran, so no deacon was ever alerted the moment a record was
 * saved — the sweep delivered all of them, up to half an hour late. The check
 * below is the real gate.
 */

import {
  matchDeacon, cadenceByPhone, DEFAULT_CADENCE, addedAlert, updateAlert, alertParts, loadDirectory,
} from '../_shared/deacons.ts';
import { activeMaintenance } from '../_shared/maintenance.ts';
import { systemCaller } from '../_shared/callers.ts';
import { verifiedDeaconPhones } from '../_shared/recipients.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET  = Deno.env.get('CARES_CRON_SECRET') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  /* The trigger's secret or the service-role key, each matched exactly. */
  if (!systemCaller(req, { serviceRole: SERVICE_ROLE, cronSecret: CRON_SECRET })) {
    return json({ error: 'Not authorised.' }, 401);
  }

  try {
    const { kind, id } = await req.json().catch(() => ({}));
    if (kind !== 'added' && kind !== 'update') return json({ error: 'kind must be added or update' }, 400);
    if (!id) return json({ error: 'id required' }, 400);

    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    /* Ahead of the claim below. Blocked after it, the alert would be recorded
       as sent and the half-hourly sweep would skip it as already done. */
    const paused = await activeMaintenance(supabase);
    if (paused) return json({ ok: true, skipped: 'maintenance', until: paused.ends_at });

    /* The one record this fired for. */
    let care: any = null;
    let alert: { header: string; lines: string[] };
    if (kind === 'added') {
      const { data } = await supabase.from('care_members')
        .select('id, full_name, phone, category, priority, care_notes, hospital_name, room_number, floor, admission_date, surgery_date, surgery_type, surgeon_name')
        .eq('id', id).single();
      if (!data) return json({ ok: true, skipped: 'care record not found' });
      care = data;
      alert = addedAlert(data);
    } else {
      const { data } = await supabase.from('contact_logs')
        .select('id, notes, type, logged_by_name, care_members(full_name, phone)')
        .eq('id', id).single();
      const cm = (data as any)?.care_members;
      if (!cm || !String(data?.notes || '').trim()) return json({ ok: true, skipped: 'nothing to report' });
      care = cm;
      alert = updateAlert(cm.full_name, data!.notes, { type: (data as any).type, by: (data as any).logged_by_name });
    }

    /* Who can be reached: deacons in the directory who are also on the texting group. */
    const { phones: deaconPhones, error: rosterErr } = await verifiedDeaconPhones(supabase);
    if (rosterErr) return json({ ok: false, error: 'deacon roster unavailable' }, 500);
    if (!deaconPhones.size) return json({ ok: true, skipped: 'no reachable deacons' });

    const directory = await loadDirectory(supabase);
    const hit = matchDeacon(care, directory, deaconPhones);
    if (!hit.ok) return json({ ok: true, skipped: `deacon not told: ${hit.why}` });

    /* How they asked to hear — the deacon poll only, never any other poll. */
    const { data: answers } = await supabase.from('sms_poll_answers')
      .select('poll_body, to_number, choice, answered_at');
    const how = cadenceByPhone(answers || []).get(hit.phone) || DEFAULT_CADENCE;
    if (how !== 'immediate') return json({ ok: true, skipped: 'deacon takes the morning summary' });

    /* Claim before sending, so the half-hourly sweep cannot send it again. */
    const { error: claimErr } = await supabase.from('deacon_alerts_sent')
      .insert({ deacon_phone: hit.phone, kind, ref_id: String(id) });
    if (claimErr) return json({ ok: true, skipped: 'already sent' });

    const parts = alertParts(alert);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-prospect-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({
        channel: 'care', audience: 'deacons',
        messages: parts.map(body => ({ to_number: hit.phone, to_name: hit.deacon.name || '', body })),
      }),
    });
    const out = await res.json().catch(() => ({}));

    /*
     * Nothing arrived — a refusal, a Telnyx error, or a maintenance window that
     * opened between the check above and this send. Give the claim back, or the
     * alert is recorded as delivered and the sweep skips it for good. That is
     * exactly what happened whenever a long note took an alert past the limit.
     */
    if (!res.ok || out?.maintenance || !(out?.sent > 0)) {
      await supabase.from('deacon_alerts_sent').delete()
        .eq('deacon_phone', hit.phone).eq('kind', kind).eq('ref_id', String(id));
      return json({ ok: false, skipped: out?.maintenance ? 'maintenance' : 'not delivered',
        error: out?.error || out?.failed?.[0]?.error || `send failed: ${res.status}` }, out?.maintenance ? 200 : 502);
    }

    return json({ ok: true, sent: out.sent, parts: parts.length, deacon: hit.deacon.name });
  } catch (e) {
    console.error('deacon-alert:', (e as Error).message);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
