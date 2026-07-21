-- ============================================================
--  PILLAR · SECURITY HARDENING
--  Model: shared team data + private personal data.
--  Run this in Supabase → SQL Editor. Safe to re-run.
--
--  ⚠ Run this BEFORE deploying the new frontend — the app now
--  verifies PINs via the verify_pin() function created here.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Staff: onboarding + preferences columns ──────────────────
alter table staff add column if not exists onboarded  boolean default false;
alter table staff add column if not exists preferences jsonb   default '{}'::jsonb;
-- NOTE: `onboarded` is set correctly further down, AFTER PINs are migrated —
-- an account is only "onboarded" if it actually has a PIN. (Setting it here
-- would lock out any account that never had a PIN.)

-- ── PINs: move out of `staff`, hash them, hide from all clients ──
-- PINs live in their own table with NO policies, so no client (even authenticated)
-- can ever read or write them. Only the SECURITY DEFINER functions below touch it.
create table if not exists staff_pins (
  staff_id uuid primary key references staff(id) on delete cascade,
  pin_hash text
);
alter table staff_pins enable row level security;
-- (intentionally no policies → unreachable by the anon/authenticated API roles)

-- Migrate any existing plaintext PINs → bcrypt, then drop the exposed column.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'staff' and column_name = 'pin_hash') then
    insert into staff_pins (staff_id, pin_hash)
    select id, crypt(pin_hash, gen_salt('bf'))
    from staff where pin_hash is not null and pin_hash <> ''
    on conflict (staff_id) do nothing;
    alter table staff drop column pin_hash;
  end if;
end $$;

-- An account is "onboarded" only if it actually has a PIN. Anyone without one
-- goes through the first-login wizard to create it (instead of being locked out).
update staff set onboarded = (id in (select staff_id from staff_pins));

-- Verify the current user's PIN (never returns the hash).
create or replace function verify_pin(input text)
returns boolean
language sql security definer stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from staff_pins
    where staff_id = auth.uid()
      and pin_hash = crypt(input, pin_hash)
  );
$$;

-- Set / change the current user's PIN (hashed server-side).
create or replace function set_pin(input text)
returns void
language sql security definer
set search_path = public, extensions
as $$
  insert into staff_pins (staff_id, pin_hash)
  values (auth.uid(), crypt(input, gen_salt('bf')))
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash;
$$;

-- Admin resets another user's PIN (checks the caller is an admin).
create or replace function admin_set_pin(target uuid, input text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not is_admin() then raise exception 'Only an admin can reset another user''s PIN'; end if;
  insert into staff_pins (staff_id, pin_hash)
  values (target, crypt(input, gen_salt('bf')))
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash;
end;
$$;

-- Service-role only: lets the admin-create-user edge function set an initial PIN.
create or replace function service_set_pin(target uuid, input text)
returns void
language sql security definer
set search_path = public, extensions
as $$
  insert into staff_pins (staff_id, pin_hash)
  values (target, crypt(input, gen_salt('bf')))
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash;
$$;

revoke all on function verify_pin(text)          from public, anon;
revoke all on function set_pin(text)             from public, anon;
revoke all on function admin_set_pin(uuid, text) from public, anon;
revoke all on function service_set_pin(uuid, text) from public, anon, authenticated;
grant execute on function verify_pin(text)          to authenticated;
grant execute on function set_pin(text)             to authenticated;
grant execute on function admin_set_pin(uuid, text) to authenticated;
grant execute on function service_set_pin(uuid, text) to service_role;

-- ── Admin helper ─────────────────────────────────────────────
create or replace function is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select role ilike '%admin%' from staff where id = auth.uid()), false);
$$;
grant execute on function is_admin() to authenticated;

-- ── Staff table: read = team; write = own row (or admin) ─────
alter table staff enable row level security;
drop policy if exists "staff read all"   on staff;
drop policy if exists "staff write all"  on staff;
drop policy if exists "staff read"       on staff;
drop policy if exists "staff update own" on staff;
drop policy if exists "staff insert"     on staff;
drop policy if exists "staff delete"     on staff;

-- Directory is shared (needed for assignee pickers, the admin page, etc.)
create policy "staff read"       on staff for select using (auth.role() = 'authenticated');
-- You may edit your OWN row; admins may edit anyone.
create policy "staff update own" on staff for update using (auth.uid() = id or is_admin());
-- Only admins create/remove staff.
create policy "staff insert"     on staff for insert with check (is_admin());
create policy "staff delete"     on staff for delete using (is_admin());

-- Block privilege escalation: a non-admin cannot change role/permissions/active,
-- even on their own row.
create or replace function staff_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- Block only authenticated NON-admin users. Service-role contexts
  -- (SQL editor, edge functions) have no auth.uid() and are allowed through.
  if (new.role        is distinct from old.role
   or new.permissions is distinct from old.permissions
   or new.active      is distinct from old.active)
   and auth.uid() is not null
   and not is_admin() then
    raise exception 'Only an admin can change role, permissions, or active status';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_staff_guard on staff;
create trigger trg_staff_guard before update on staff
  for each row execute function staff_guard();

-- ── Shared ministry data stays team-accessible ───────────────
-- care_members, contact_logs, guests, greeter_comments, new_connections,
-- church_members, events, email_config, email_groups, sms_* already use
-- `auth.role() = 'authenticated'` — correct for a collaborative team tool:
-- signed-in staff share them, the public (anon) cannot touch them.
-- No changes needed there, but the check below confirms nothing is left open.

-- ============================================================
--  AUDIT: find any table where RLS is OFF (publicly readable via the anon key!)
--  Run this SELECT and make sure it returns ZERO rows.
--  For any table it lists:  alter table <name> enable row level security;
-- ============================================================
-- select tablename from pg_tables
-- where schemaname = 'public'
--   and rowsecurity = false;
