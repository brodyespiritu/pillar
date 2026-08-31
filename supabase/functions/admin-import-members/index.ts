// Supabase Edge Function — bulk-import church members (admin only).
//
// Deploy:  npx supabase functions deploy admin-import-members --use-api
//
// Body: { rows: Array<{ external_id, name, email, phone, address, family_id, family_name, active, status }> }
// Upserts on external_id so re-imports update instead of duplicating, then
// returns confirmed row counts read back from the table.

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
    if (!authHeader.replace('Bearer ', '')) throw new Error('Not signed in.');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Verify the caller is an Admin.
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller } } = await asCaller.auth.getUser();
    if (!caller) throw new Error('Not signed in.');
    const { data: callerStaff } = await admin.from('staff').select('role').eq('id', caller.id).single();
    if (!String(callerStaff?.role || '').toLowerCase().includes('admin')) throw new Error('Only admins can import members.');

    const body = await req.json();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) throw new Error('No rows to import.');
    if (rows.length > 20000) throw new Error('Too many rows in one import (max 20,000).');

    // Keep only known columns; require a name.
    const ALLOWED = ['external_id', 'name', 'email', 'phone', 'address', 'family_id', 'family_name', 'active', 'status'];
    const clean = [];
    for (const r of rows) {
      if (!r || !String(r.name || '').trim()) continue;
      const o: Record<string, unknown> = {};
      for (const k of ALLOWED) if (r[k] !== undefined) o[k] = r[k];
      clean.push(o);
    }
    if (!clean.length) throw new Error('No valid rows (each row needs a name).');

    const withId = clean.filter(r => r.external_id);
    const withoutId = clean.filter(r => !r.external_id);

    const before = (await admin.from('church_members').select('id', { count: 'exact', head: true })).count ?? 0;

    // Upsert rows that carry a source id (idempotent); plain-insert the rest.
    const CHUNK = 500;
    for (let i = 0; i < withId.length; i += CHUNK) {
      const { error } = await admin.from('church_members')
        .upsert(withId.slice(i, i + CHUNK), { onConflict: 'external_id' });
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < withoutId.length; i += CHUNK) {
      const { error } = await admin.from('church_members').insert(withoutId.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
    }

    const after = (await admin.from('church_members').select('id', { count: 'exact', head: true })).count ?? 0;

    return new Response(JSON.stringify({
      ok: true,
      received: rows.length,
      valid: clean.length,
      inserted: after - before,
      updated: clean.length - (after - before),
      total: after,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
