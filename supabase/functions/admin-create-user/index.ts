// Supabase Edge Function — create a new Pillar user (auth login + staff row).
//
// Deploy:  supabase functions deploy admin-create-user
// Only callers who are themselves an Admin (per their staff row) may use it.
//
// The frontend calls it (see src/lib/admin.js → createUser) with the new
// user's account + profile + permissions.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) throw new Error('Not signed in.');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Verify the caller is an Admin.
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller } } = await asCaller.auth.getUser();
    if (!caller) throw new Error('Not signed in.');
    const { data: callerStaff } = await admin.from('staff').select('role').eq('id', caller.id).single();
    const role = String(callerStaff?.role || '').toLowerCase();
    if (!(role.includes('admin'))) throw new Error('Only admins can add users.');

    const b = await req.json();
    const email = String(b.email || '').trim().toLowerCase();
    if (!email) throw new Error('Email is required.');

    // Create the auth user (confirmed so they can sign in immediately).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: b.password || undefined,
      email_confirm: true,
    });
    if (cErr) throw new Error(cErr.message);
    const id = created.user.id;

    // Insert the staff profile keyed by the auth id.
    const { error: sErr } = await admin.from('staff').insert({
      id,
      name: b.name || null,
      email,
      role: b.role || 'Staff',
      department: b.department || null,
      title: b.title || null,
      phone: b.phone || null,
      auth_method: b.auth_method || 'email',
      active: b.active !== false,
      pto_total: b.pto_total ?? 15,
      permissions: b.permissions || {},
    });
    if (sErr) {
      // Roll back the auth user if the profile insert fails.
      await admin.auth.admin.deleteUser(id).catch(() => {});
      throw new Error(sErr.message);
    }

    // Optional initial PIN → stored hashed in staff_pins (never in the staff row).
    // The user can also set/replace it during first-login onboarding.
    if (b.pin) {
      const { error: pErr } = await admin.rpc('service_set_pin', { target: id, input: String(b.pin) });
      if (pErr) console.error('service_set_pin failed:', pErr.message);
    }

    return new Response(JSON.stringify({ id }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
