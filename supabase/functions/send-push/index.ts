// Supabase Edge Function — deliver a Web Push notification.
//
// Called by other functions (or by hand) with a title, body and a link. Fans
// out to every subscription for the named staff, or to all of them when no
// staff is named.
//
// Deploy:
//   supabase functions deploy send-push
// Secrets:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPush } from '../_shared/webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const VAPID = {
  publicKey:  Deno.env.get('VAPID_PUBLIC_KEY')  ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  subject:    Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:office@bethesdabaptist.org',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');

  if (!VAPID.publicKey || !VAPID.privateKey) {
    return new Response(JSON.stringify({ error: 'VAPID keys are not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { title, body, url, tag, staffIds } = await req.json();
    if (!title) {
      return new Response(JSON.stringify({ error: 'title is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    let q = supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth');
    if (Array.isArray(staffIds) && staffIds.length) q = q.in('staff_id', staffIds);

    const { data: subs, error } = await q;
    if (error) throw error;
    if (!subs?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: 'nobody subscribed' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const payload = { title, body: body ?? '', url: url ?? '/', tag };
    const results = await Promise.all(subs.map(async (s: any) => {
      try { return { id: s.id, ...(await sendPush(s, payload, VAPID)) }; }
      catch (e) { return { id: s.id, ok: false, status: 0, gone: false, err: String(e) }; }
    }));

    /*
     * A subscription the push service calls gone is dead for good — the browser
     * was uninstalled, or the user cleared it. Keeping it means retrying a 410
     * on every send forever.
     */
    const dead = results.filter(r => r.gone).map(r => r.id);
    if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead);

    const sent = results.filter(r => r.ok).length;
    if (sent) {
      await supabase.from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .in('id', results.filter(r => r.ok).map(r => r.id));
    }

    return new Response(JSON.stringify({
      ok: true, sent, failed: results.length - sent, pruned: dead.length,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('send-push error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
