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
 */

import {
  deaconFor, cadenceOf, addedText, updateText, last10,
} from '../_shared/deacons.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET  = Deno.env.get('CARES_CRON_SECRET') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/* Constant-time, so a wrong secret cannot be found a character at a time. */
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const ok = (CRON_SECRET && timingSafeEqual(token, CRON_SECRET))
    || (SERVICE_ROLE && timingSafeEqual(token, SERVICE_ROLE));
  if (!ok) return json({ error: 'Not authorised.' }, 401);

  try {
    const { kind, id } = await req.json().catch(() => ({}));
    if (kind !== 'added' && kind !== 'update') return json({ error: 'kind must be added or update' }, 400);
    if (!id) return json({ error: 'id required' }, 400);

    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    /* The one record this fired for. */
    let care: any = null;
    let line = '';
    if (kind === 'added') {
      const { data } = await supabase.from('care_members')
        .select('id, full_name, phone, category, care_notes, hospital_name, room_number')
        .eq('id', id).single();
      if (!data) return json({ ok: true, skipped: 'care record not found' });
      care = data;
      line = addedText(data);
    } else {
      const { data } = await supabase.from('contact_logs')
        .select('id, notes, care_members(full_name, phone)')
        .eq('id', id).single();
      const cm = (data as any)?.care_members;
      if (!cm || !String(data?.notes || '').trim()) return json({ ok: true, skipped: 'nothing to report' });
      care = cm;
      line = updateText(cm.full_name, data!.notes);
    }

    /* Who can be reached, and how they asked to hear. */
    const { data: groups } = await supabase.from('sms_groups').select('id, name');
    const deaconGroup = (groups || []).find(
      (g: any) => String(g.name || '').trim().toLowerCase() === 'deacons');
    if (!deaconGroup) return json({ ok: true, skipped: 'no Deacons SMS group' });

    const { data: gm } = await supabase.from('sms_group_members')
      .select('contact_id').eq('group_id', deaconGroup.id);
    const ids = new Set((gm || []).map((r: any) => r.contact_id));
    const { data: contacts } = await supabase.from('sms_contacts')
      .select('id, phone, opted_out');
    const deaconPhones = new Set(
      (contacts || [])
        .filter((c: any) => ids.has(c.id) && !c.opted_out && String(c.phone || '').trim())
        .map((c: any) => last10(c.phone)),
    );
    if (!deaconPhones.size) return json({ ok: true, skipped: 'no reachable deacons' });

    const { data: directory } = await supabase.from('church_members')
      .select('id, name, phone, deacon_id');
    const hit = deaconFor(care, directory || [], deaconPhones);
    if (!hit) return json({ ok: true, skipped: 'no deacon for this person' });

    const { data: answers } = await supabase.from('sms_poll_answers')
      .select('to_number, choice, answered_at').order('answered_at', { ascending: true });
    let choice: number | null = null;
    for (const a of answers || []) if (last10(a.to_number) === hit.phone) choice = a.choice;
    if (cadenceOf(choice) !== 'immediate') {
      return json({ ok: true, skipped: 'deacon takes the morning summary' });
    }

    /* Claim before sending, so the half-hourly sweep cannot send it again. */
    const { error: claimErr } = await supabase.from('deacon_alerts_sent')
      .insert({ deacon_phone: hit.phone, kind, ref_id: String(id) });
    if (claimErr) return json({ ok: true, skipped: 'already sent' });

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-prospect-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ channel: 'care', messages: [{ to_number: hit.phone, to_name: hit.deacon.name || '', body: line }] }),
    });
    if (!res.ok) return json({ ok: false, error: `send failed: ${res.status}` }, 502);

    return json({ ok: true, sent: 1, deacon: hit.deacon.name });
  } catch (e) {
    console.error('deacon-alert:', (e as Error).message);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
