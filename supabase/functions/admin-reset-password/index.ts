// Supabase Edge Function — reset a Pillar user's login password.
//
// Deploy:  npx supabase functions deploy admin-reset-password --use-api
// Only callers who are themselves an Admin (per their staff row) may use it.
//
// The frontend calls it (src/lib/admin.js → resetPassword) with { user_id, password }.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.replace('Bearer ', '')) throw new Error('Not signed in.');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Verify the caller is an Admin.
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller } } = await asCaller.auth.getUser();
    if (!caller) throw new Error('Not signed in.');
    const { data: callerStaff } = await admin.from('staff').select('role').eq('id', caller.id).single();
    if (!String(callerStaff?.role || '').toLowerCase().includes('admin')) throw new Error('Only admins can reset passwords.');

    const b = await req.json();
    const userId = String(b.user_id || '').trim();
    const password = String(b.password || '');
    if (!userId) throw new Error('Missing user_id.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
