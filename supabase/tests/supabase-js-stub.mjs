// Test double for npm:@supabase/supabase-js used by the member Edge Functions: PostgREST-style rpc
// and insert backed by the real SQL in PGlite, plus the Auth admin calls the functions use.
import crypto from 'node:crypto';

export const world = {
  db: null, as: null,
  tokens: new Map(),         // bearer token → JWT claims (for caller clients)
  links: new Map(),          // hashed_token → { userId, type, used }
  calls: [],
  failNext: {},              // e.g. { createUser: 1 }
};

const sigCache = new Map();
async function signature(name) {
  if (sigCache.has(name)) return sigCache.get(name);
  const r = await world.db.query(
    `select p.proretset, format_type(p.prorettype, null) as rettype, p.proargnames,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [name]);
  const s = r.rows[0] || null;
  sigCache.set(name, s);
  return s;
}

async function rpcAs(role, claims, name, params = {}) {
  world.calls.push(['rpc', role, name]);
  const sig = await signature(name);
  if (!sig) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
  const names = (sig.proargnames || []).slice(0, sig.argtypes.length);
  const args = [], values = [];
  for (const [k, v] of Object.entries(params)) {
    const i = names.indexOf(k);
    if (i < 0) return { data: null, error: { code: 'PGRST202', message: `unknown argument ${k}` } };
    let type = sig.argtypes[i], val = v;
    if (type === 'jsonb' || type === 'json') val = v == null ? null : JSON.stringify(v);
    if (type.endsWith('[]') && Array.isArray(v)) val = `{${v.join(',')}}`;
    values.push(val);
    args.push(`${k} => $${values.length}::${type}`);
  }
  const call = `public.${name}(${args.join(', ')})`;
  const composite = sig.proretset || sig.rettype === 'record';
  const sql = composite ? `select * from ${call}` : `select ${call} as v`;
  const r = await world.as(role, claims, sql, values);
  if (r.error) return { data: null, error: { message: r.error, code: 'P0001' } };
  return { data: composite ? r.rows : (r.rows[0]?.v ?? null), error: null };
}

export function createClient(url, key, opts = {}) {
  const bearer = (opts.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  const isAdmin = key === 'service-role';
  const claims = isAdmin ? { role: 'service_role' } : (world.tokens.get(bearer) || {});
  const role = isAdmin ? 'service_role' : (claims.role === 'authenticated' ? 'authenticated' : 'anon');

  return {
    rpc: (name, params) => rpcAs(role, claims, name, params),
    from: (table) => ({
      insert: async (row) => {
        const cols = Object.keys(row);
        const r = await world.as(role, claims, `insert into public.${table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
        return { error: r.error ? { message: r.error } : null };
      },
    }),
    auth: {
      getUser: async () => {
        if (!claims.sub) return { data: { user: null }, error: { status: 401 } };
        const u = (await world.db.query(`select id, email, raw_app_meta_data from auth.users where id = $1`, [claims.sub])).rows[0];
        return { data: { user: u ? { id: u.id, email: u.email, app_metadata: u.raw_app_meta_data } : null }, error: null };
      },
      admin: {
        createUser: async ({ email, email_confirm, app_metadata }) => {
          world.calls.push(['createUser', email]);
          if (!isAdmin) return { data: null, error: { status: 403, message: 'not admin' } };
          if (world.failNext.createUser) { world.failNext.createUser--; return { data: { user: null }, error: { status: 500, message: 'boom' } }; }
          const e = String(email).toLowerCase();
          const exists = (await world.db.query(`select 1 from auth.users where email = $1`, [e])).rows.length;
          if (exists) return { data: { user: null }, error: { status: 422, code: 'email_exists', message: 'A user with this email address has already been registered' } };
          const id = crypto.randomUUID();
          await world.db.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1, $2, ${email_confirm ? 'now()' : 'null'}, $3)`,
            [id, e, JSON.stringify(app_metadata || {})]);
          await world.db.query(`insert into auth.identities (user_id, provider) values ($1, 'email')`, [id]);
          return { data: { user: { id, email: e, app_metadata } }, error: null };
        },
        deleteUser: async (id) => {
          world.calls.push(['deleteUser', id]);
          if (world.failNext.deleteUser) { world.failNext.deleteUser--; return { data: null, error: { status: 500, message: 'boom' } }; }
          const r = await world.db.query(`delete from auth.users where id = $1 returning id`, [id]);
          return r.rows.length ? { data: {}, error: null } : { data: null, error: { status: 404, message: 'User not found' } };
        },
        generateLink: async ({ type, email }) => {
          world.calls.push(['generateLink', type]);
          const u = (await world.db.query(`select id from auth.users where email = $1`, [String(email).toLowerCase()])).rows[0];
          if (!u) return { data: { user: null, properties: null }, error: { status: 404, message: 'User with this email not found' } };
          // GoTrue replaces the user's earlier token of the same type (one_time_tokens)
          for (const l of world.links.values()) if (l.userId === u.id && l.type === type) l.used = true;
          const hashed = crypto.randomBytes(28).toString('hex');
          world.links.set(hashed, { userId: u.id, type, used: false });
          return { data: { user: { id: u.id }, properties: { hashed_token: hashed, verification_type: type, email_otp: '999999', action_link: 'https://x/verify' } }, error: null };
        },
      },
    },
  };
}

/** What supabase.auth.verifyOtp({ token_hash, type: 'email' }) does for the app: a new OTP session. */
export async function verifyTokenHash(tokenHash) {
  const l = world.links.get(tokenHash);
  if (!l || l.used) return null;
  l.used = true;
  const sid = (await world.db.query(`insert into auth.sessions (user_id) values ($1) returning id`, [l.userId])).rows[0].id;
  const claims = { sub: l.userId, role: 'authenticated', session_id: sid, amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }] };
  const bearer = crypto.randomBytes(16).toString('hex');
  world.tokens.set(bearer, claims);
  return { bearer, claims };
}
