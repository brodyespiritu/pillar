// Supabase Edge Function — take a dinner reservation from the public web form.
//
// Deploy (public — the congregation calls it, not the app):
//   supabase functions deploy dinner-rsvp --no-verify-jwt
//
// The form at /rsvp posts { name, plates }. There is no phone number involved,
// so nothing here can text anybody; the reservation is written straight onto
// the dinner list the Responses tab reads.
//
// This is the only public write path into sms_messages. The table also carries
// pastoral care traffic, so anonymous clients are NEVER given an insert policy
// — every write goes through here, under the service role, after validation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { activeDinner } from '../_shared/dinnerAck.ts';
import { WEB_STATUS, MAX_PLATES, MAX_PER_DINNER, cleanName, cleanPlates, webNumber }
  from '../_shared/rsvpForm.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  /*
   * The form asks what is on the menu before it renders. It goes through here
   * rather than reading the table directly — sms_library holds every message
   * the church has sent, and the public is entitled to one field of one row.
   */
  if (req.method === 'GET') {
    const token = String(new URL(req.url).searchParams.get('token') ?? '')
      .replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const clean = (m: unknown) =>
      (Array.isArray(m) ? m : []).map((x: unknown) => String(x)).slice(0, 12);

    /*
     * No token is the bare domain — the standing link the church posts. It has
     * to answer with whatever dinner is current, not nothing; returning an
     * empty menu there left the page people actually visit with no menu on it.
     */
    if (!token) {
      const dinner = await activeDinner(supabase, Date.now());
      return json({ menu: clean(dinner?.rsvp_menu) });
    }

    const { data } = await supabase
      .from('sms_library').select('rsvp_menu').eq('rsvp_token', token).limit(1);
    if (!data?.length) return json({ error: 'This reservation link is no longer active.' }, 404);
    return json({ menu: clean(data[0].rsvp_menu) });
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const name = cleanName(body?.name);
    const plates = cleanPlates(body?.plates);

    if (name.length < 2) return json({ error: 'Please enter your name.' }, 400);
    if (plates === null) return json({ error: `Please enter a number of plates between 1 and ${MAX_PLATES}.` }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    /*
     * The link carries a token naming the dinner it was made for, so a
     * reservation lands on that dinner even after a newer one goes out. Without
     * a token — the bare /rsvp address — it falls back to whichever dinner is
     * currently collecting.
     */
    const token = String(body?.token ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
    let dinner: any = null;
    if (token) {
      const { data } = await supabase
        .from('sms_library').select('body, last_sent_at, created_at')
        .eq('rsvp_token', token).limit(1);
      dinner = data?.[0] ?? null;
      if (!dinner) return json({ error: 'This reservation link is no longer active.' }, 404);
    } else {
      dinner = await activeDinner(supabase, Date.now());
      if (!dinner) return json({ error: 'Reservations are not open right now.' }, 409);
    }
    /* A link can be made before the invitation goes out, so a dinner that has
       not been sent yet is dated from when it was written. */
    const since = dinner.last_sent_at || dinner.created_at || new Date(0).toISOString();

    const number = webNumber(name);
    const now = new Date().toISOString();
    /*
     * The thread is read in time order, and whatever came last before a reply is
     * taken as the message it answers. Sharing a timestamp with the reply left
     * that to a tiebreak on id, which put the reply first and filed it under no
     * campaign at all — so the invitation is dated firmly before it.
     */
    const asked = new Date(Date.now() - 60_000).toISOString();

    /*
     * The Responses tab reads whatever was last sent to someone as the question
     * their reply answers. A web reservation has no such history, so the dinner
     * it belongs to is recorded alongside it — that is what files it under the
     * right dinner rather than off on its own.
     */
    const { data: thread } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('to_number', number)
      .eq('direction', 'out')
      .limit(1);

    if (!thread?.length) {
      const { count } = await supabase
        .from('sms_messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'in')
        .eq('status', WEB_STATUS)
        .gte('created_at', since);
      if ((count ?? 0) >= MAX_PER_DINNER) return json({ error: 'Reservations are closed for this dinner.' }, 429);

      await supabase.from('sms_messages').insert({
        to_number: number, to_name: name, body: dinner.body,
        direction: 'out', status: WEB_STATUS, channel: 'sms', created_at: asked,
      });
    }

    // One live reservation per name — a second submission is a correction.
    const { data: prior } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('to_number', number)
      .eq('direction', 'in')
      .gte('created_at', since)
      .limit(1);

    const row = {
      to_number: number, to_name: name, body: String(plates),
      direction: 'in', status: WEB_STATUS, channel: 'sms',
      rsvp_count: plates, rsvp_excluded: false, created_at: now,
    };

    const res = prior?.length
      ? await supabase.from('sms_messages').update(row).eq('id', prior[0].id)
      : await supabase.from('sms_messages').insert(row);
    if (res.error) throw new Error(res.error.message);

    return json({ ok: true, name, plates, updated: !!prior?.length });
  } catch (e) {
    console.error('dinner-rsvp error:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
