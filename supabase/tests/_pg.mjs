// Shared test database: PGlite shaped like a Supabase project (roles, auth schema, Pillar's member
// tables), with supabase/member-app-auth.sql applied twice.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SUPA = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (sql) => sql.replace(/^\s*--.*$/gm, '');

export async function loadPGlite() {
  return (await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite')).PGlite;
}

/** Returns { db, as, migrationError }. `as(role, claims, sql, params)` → { rows } | { error }. */
export async function supabaseLikeDb({ migrate = true } = {}) {
  const PGlite = await loadPGlite();
  const db = new PGlite();
  // Run SQL as a role with JWT claims (PostgREST-style), returning rows or the error.
  async function as(role, claims, sql, params = []) {
    try {
      return await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
        await tx.exec(`set local role ${role}`);
        const r = await tx.query(sql, params);
        return { rows: r.rows };
      });
    } catch (e) {
      return { error: e.message };
    }
  }

  // ── Supabase-like environment ────────────────────────────────────────────────
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(), email text, phone text,
      email_confirmed_at timestamptz, phone_confirmed_at timestamptz,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      banned_until timestamptz, deleted_at timestamptz,
      is_sso_user boolean not null default false, is_anonymous boolean not null default false,
      created_at timestamptz default now(), last_sign_in_at timestamptz);
    create table auth.sessions (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      created_at timestamptz default now(), not_after timestamptz);
    create table auth.identities (id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade, provider text not null);
    create function auth.jwt() returns jsonb language sql stable
      as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    create function auth.role() returns text language sql stable
      as $$ select coalesce(nullif(auth.jwt() ->> 'role', ''), 'anon') $$;
    grant usage on schema auth to anon, authenticated, service_role;

    create schema storage;
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on all tables in schema storage to anon, authenticated, service_role;
    create policy "website images upload" on storage.objects for insert to authenticated with check (bucket_id = 'website');

    create or replace function touch_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at := now(); return new; end $$;

    create table public.staff (id uuid primary key references auth.users(id), name text, email text,
                               role text default 'Staff', active boolean default true);
    create or replace function is_admin() returns boolean language sql security definer stable
      set search_path = public as $$ select coalesce((select role ilike '%admin%' from staff where id = auth.uid()), false) $$;
    alter table staff enable row level security;
    create policy "staff read"       on staff for select using (auth.role() = 'authenticated');
    create policy "staff update own" on staff for update using (auth.uid() = id or is_admin());
    create policy "staff insert"     on staff for insert with check (is_admin());
    create policy "staff delete"     on staff for delete using (is_admin());
    create or replace function public.is_active_staff() returns boolean language sql stable security definer
      set search_path = public as $$ select exists (select 1 from public.staff where id = auth.uid() and active is not false) $$;

    create table care_members (id uuid primary key default gen_random_uuid(), name text, notes text);
    alter table care_members enable row level security;
    create policy "staff read care"  on care_members for select using (auth.role() = 'authenticated');
    create policy "staff write care" on care_members for all    using (auth.role() = 'authenticated');

    create table email_drafts (id uuid primary key default gen_random_uuid(), owner uuid, body text);
    alter table email_drafts enable row level security;
    create policy "own drafts" on email_drafts for all using (owner = auth.uid());
  `);
  await db.exec(strip(read(path.join(SUPA, 'members-schema.sql'))));
  await db.exec(strip(read(path.join(SUPA, 'members-personal-fields.sql'))));


  let migrationError = null;
  if (migrate) {
    const MIGRATION = read(path.join(SUPA, 'member-app-auth.sql'));
    try { await db.exec(MIGRATION); await db.exec(MIGRATION); } catch (e) { migrationError = e.message; }
  }
  return { db, as, migrationError };
}
