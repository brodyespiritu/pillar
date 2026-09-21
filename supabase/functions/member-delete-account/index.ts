// Supabase Edge Function — a member deletes their app account (App Store requirement).
//
// Deploy:  npx supabase functions deploy member-delete-account --no-verify-jwt
//          (the function checks the caller itself: a signed-in member session, see member_me)
//
// Deletes the record's app LOGIN (with every session) and what the app added to the record (the
// link and directory choices). The church_members record itself is the church's and stays.
// Only member sessions that came through the church code flow qualify — staff logins, and
// sessions obtained any other way, are refused.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { adminClient, env, json, logEvent, preflight } from '../_shared/memberAuthServer.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(authHeader)) return json({ error: 'Not signed in.' }, 401);
  const admin = adminClient();
  try {
    const asCaller = createClient(env.url, env.anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user) return json({ error: 'Not signed in.' }, 401);

    const { data: me, error: meErr } = await asCaller.rpc('member_me');
    if (meErr || !me?.member_id) return json({ error: 'Not signed in.' }, 401);
    if (user.app_metadata?.bbc_member_id !== me.member_id) return json({ error: 'Not signed in.' }, 401);

    // Delete the login first (it takes every session with it). If this fails, nothing has changed
    // and the member can simply try again.
    const { error: dErr } = await admin.auth.admin.deleteUser(user.id);
    if (dErr && (dErr as { status?: number }).status !== 404) throw new Error('delete');

    const { error: fErr } = await admin.rpc('app_member_forget_login', {
      p_member_id: me.member_id, p_auth_user_id: user.id,
    });
    if (fErr) throw new Error('forget');

    await logEvent(admin, { event: 'account_deleted', memberId: me.member_id });
    return json({ ok: true });
  } catch (e) {
    await logEvent(admin, { event: 'account_delete_failed', outcome: (e as Error)?.message ?? null });
    return json({ error: 'Your account could not be deleted. Please try again or contact the church office.' }, 500);
  }
});
