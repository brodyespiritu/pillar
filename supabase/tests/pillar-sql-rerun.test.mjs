// Re-running any Pillar SQL file must never reopen staff data to member app logins.
// Builds the schema from the real files, applies member-app-auth.sql, then re-runs each file on its
// own (one multi-statement script, as the SQL Editor sends it) and checks what it leaves open.
//
// Run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node pillar-sql-rerun.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadPGlite, SUPA } from './_pg.mjs';

const S = SUPA + '/';
const strip = (s) => s.replace(/^\s*--.*$/gm, '');
const read = (f) => {
  let t = strip(fs.readFileSync(f.startsWith('/') ? f : S + f, 'utf8'));
  // PGlite has no pgcrypto / pg_cron / pg_net bundled here: stub only those statements.
  t = t.replace(/create extension if not exists (pgcrypto|pg_cron|pg_net);/g, '');
  return t;
};
const PGlite = await loadPGlite();
const db = new PGlite();
async function as(role, claims, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
      await tx.exec(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (e) { return { error: e.message }; }
}

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text,
    email_confirmed_at timestamptz, phone_confirmed_at timestamptz, raw_app_meta_data jsonb not null default '{}'::jsonb,
    banned_until timestamptz, deleted_at timestamptz, is_sso_user boolean not null default false,
    is_anonymous boolean not null default false, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), created_at timestamptz default now(), not_after timestamptz);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), provider text not null);
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(auth.jwt() ->> 'role', ''), 'anon') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;
  create schema cron; create table cron.job (jobname text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
  create schema extensions;
  create function extensions.crypt(a text, b text) returns text language sql as $$ select a $$;
  create function extensions.gen_salt(a text) returns text language sql as $$ select a $$;
  create or replace function touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create table public.staff (id uuid primary key references auth.users(id), name text, email text, role text default 'Staff');
`);

const BUILD = ['admin-schema.sql', 'security-hardening.sql', 'members-schema.sql', 'members-personal-fields.sql',
  'cares-schema.sql', 'cares-log-visibility.sql', 'calendar-schema.sql', 'sms-schema.sql', 'sms-inbound-schema.sql', 'sms-care-isolation.sql',
  'broadcast-schema.sql', 'locations-schema.sql', 'event-templates-schema.sql', 'playbooks-schema.sql',
  'cares-reminders.sql', 'cares-recap-schedule.sql', 'cares-sms-intake.sql', 'deacon-alerts-schema.sql',
  'sms-poll-schema.sql', 'sms-maintenance-schema.sql', path.resolve(SUPA, '../supabase-website-content.sql'),
  'sms-recipient-guards.sql', 'rsvp-forms-schema.sql', 'push-schema.sql', 'email-templates-schema.sql',
  'guests-schema.sql', 'attendance-schema.sql', 'email-recap-schema.sql', 'sms-library-schema.sql',
  'groups-schema.sql',
  // what the member app reads: these are public on purpose, so they must stay public-read only
  'app-home-cards.sql', 'app-live-updates.sql', 'group-posts.sql', 'app-home-tiles.sql', 'calendar-featured.sql',
  'app-media-series.sql'];
// files that lean on member-app-auth.sql's own functions, so they only apply once it has run
const AFTER = ['app-slides-notes-saved.sql'];
const problems = [];
for (const f of BUILD) {
  try { await db.exec(read(f)); } catch (e) { problems.push(`build: ${f} failed: ${e.message}`); }
}
const MIG = fs.readFileSync(S + 'member-app-auth.sql', 'utf8');
await db.exec(MIG);
for (const f of AFTER) {
  try { await db.exec(read(f)); } catch (e) { problems.push(`build: ${f} failed: ${e.message}`); }
}

const openPolicies = async () => (await db.query(`
  select schemaname||'.'||tablename||' · '||policyname p from pg_policies
   where schemaname in ('public','storage')
     and ( (coalesce(qual,'')||coalesce(with_check,'')) ~ 'auth\\.role\\(\\)\\s*=\\s*''authenticated'''
        or (roles = array['authenticated']::name[] and (coalesce(qual,'')||coalesce(with_check,'')) !~ '(is_active_staff|is_admin|auth\\.uid\\(\\))'))
   order by 1`)).rows.map(r => r.p);
const openAfter = await openPolicies();
if (openAfter.length) problems.push(`open after member-app-auth.sql: ${openAfter.join(', ')}`);

// PGlite exec on a multi-statement script: does an error roll back earlier statements?
try { await db.exec(`create table zz_probe (x int); create policy "staff read logs" on contact_logs for select using (true);`); } catch {}
if ((await db.query(`select to_regclass('public.zz_probe') r`)).rows[0].r !== null) problems.push('an erroring script did not roll back');

const M = crypto.randomUUID();
await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1, 'm-x@members.invalid', now(), '{"bbc_member_id":"x"}')`, [M]);
const member = { sub: M, role: 'authenticated', session_id: crypto.randomUUID(), amr: [{ method: 'otp', timestamp: 1 }] };
// a member login that somehow got an Admin staff row must never count as staff or admin
const MA = crypto.randomUUID();
await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1, 'm-a@members.invalid', now(), '{"bbc_member_id":"a"}')`, [MA]);
await db.query(`insert into staff (id, name, role, active) values ($1, 'Oops', 'Admin', true)`, [MA]);
const memberAdmin = { sub: MA, role: 'authenticated', session_id: crypto.randomUUID(), amr: [{ method: 'otp', timestamp: 1 }] };
const ST = crypto.randomUUID();
await db.query(`insert into auth.users (id, email) values ($1, 'p@c')`, [ST]);
await db.query(`insert into staff (id, name, email) values ($1, 'Pastor', 'p@c')`, [ST]);
await db.exec(`insert into contact_logs (notes) values ('Hospital visit')`);

const RERUN = [...BUILD, ...AFTER];
for (const f of RERUN) {
  const name = f.split('/').pop();
  let err = null;
  try { await db.exec(read(f)); } catch (e) { err = e.message; }
  const open = await openPolicies();
  let probe = '';
  if (name === 'cares-log-visibility.sql') { const r = await as('authenticated', member, `select count(*)::int n from contact_logs`); probe = ` member reads contact_logs rows: ${r.error || r.rows[0].n}`; if (!r.error && r.rows[0].n) problems.push(`${name}: member reads contact_logs`); }
  if (name === 'security-hardening.sql' || name === 'admin-schema.sql') {
    const r = await as('authenticated', member, `select count(*)::int n from staff`); probe = ` member reads staff rows: ${r.error || r.rows[0].n}`;
    if (!r.error && r.rows[0].n) problems.push(`${name}: member reads staff`);
  }
  const roles = await as('authenticated', memberAdmin, `select public.is_admin() a, public.is_active_staff() s`);
  if (roles.error || roles.rows[0].a !== false || roles.rows[0].s !== false) problems.push(`${name}: member login with an Admin staff row → ${roles.error || JSON.stringify(roles.rows[0])}`);
  if (open.length) problems.push(`${name} reopened: ${open.join(' | ')}`);
  if (process.env.VERBOSE) console.log(`${name.padEnd(34)} ${err ? 'errors on re-run (rolled back)' : 'runs'} · reopened: ${open.length ? open.join(' | ') : 'nothing'}${probe}`);
  await db.exec(MIG);   // reset for the next file
}

problems.forEach((x) => console.log('  FAIL  ' + x));
console.log(`${BUILD.length} Pillar SQL files re-run after member-app-auth.sql: ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
