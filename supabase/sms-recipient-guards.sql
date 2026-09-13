-- ════════════════════════════════════════════════════════════
-- Who can reach what: recipient guards and staff-only access
--
-- Run in Supabase → SQL Editor (or supabase db query -f … --linked). Safe to
-- re-run: every statement is idempotent.
--
-- Found in the Sep 13 2026 review of every path a text takes:
--
--  1. Public sign-up is ON for this project, and nearly every policy only asked
--     "is this request signed in?" — so anyone who registered an email could
--     read the care list, edit the Deacons texting group, change a deacon's
--     phone in the directory, or queue a scheduled text that the cron would
--     send from the church's number. Access now means signed in AND an active
--     staff member. (Also switch sign-ups off: Authentication → Sign In /
--     Providers → "Allow new users to sign up". Staff accounts are created by
--     admin-create-user, which does not need it.)
--
--  2. A policy called "Own row" (made in the dashboard, not in any file here)
--     let a signed-in user INSERT a staff row for themselves — as an admin,
--     with Cares texts switched on. Dropped; admins create staff.
--
--  3. Staff could switch their own Cares alerts on, or change their number on
--     an account that receives care texts. Only an admin grants Cares texts,
--     and a new number pauses them until an admin has seen it.
--
--  4. Phone numbers are stored however they were typed, and lookups used
--     ilike '%7065550100', which never matches "(706) 555-0100". Stored
--     last-ten-digit columns make every lookup exact.
--
--  5. Landlines were attempted on every broadcast. sms_landlines lists the
--     numbers Telnyx refused as not mobile, so senders skip them.
-- ════════════════════════════════════════════════════════════


-- ── 4. Last ten digits, stored ───────────────────────────────
alter table public.sms_messages
  add column if not exists to10 text
  generated always as (right(regexp_replace(coalesce(to_number, ''), '\D', '', 'g'), 10)) stored;
create index if not exists idx_sms_messages_to10 on public.sms_messages (to10, created_at desc);

alter table public.sms_contacts
  add column if not exists phone10 text
  generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored;
create index if not exists idx_sms_contacts_phone10 on public.sms_contacts (phone10);

alter table public.staff
  add column if not exists phone10 text
  generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored;
create index if not exists idx_staff_phone10 on public.staff (phone10);


-- ── 5. Landlines ─────────────────────────────────────────────
-- Refused as "not mobile" in the last 120 days, with nothing since that proves
-- otherwise (a text that went through, or a text from them). After 120 days a
-- number is tried once more, so a line ported to a mobile finds its way back.
create or replace view public.sms_landlines
with (security_invoker = true) as
with fails as (
  select to10, max(created_at) as last_failed_at, count(*) as failures
  from public.sms_messages
  where direction is distinct from 'in'
    and status = 'Failed'
    and error ilike '%not mobile%'
    and created_at > now() - interval '120 days'
    and length(to10) = 10
  group by to10
)
select f.to10, f.last_failed_at, f.failures
from fails f
where not exists (
  select 1 from public.sms_messages m
  where m.to10 = f.to10
    and m.created_at > f.last_failed_at
    and (m.direction = 'in' or m.status not in ('Failed', 'Blocked'))
);
grant select on public.sms_landlines to authenticated, service_role;


-- ── 1. Signed in AND active staff ────────────────────────────
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid() and active is not false);
$$;
revoke all on function public.is_active_staff() from public;
grant execute on function public.is_active_staff() to anon, authenticated, service_role;

-- An admin who has been deactivated is not an admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role ilike '%admin%' and active is not false from staff where id = auth.uid()), false);
$$;

-- Every policy that only asked "signed in?" now asks "active staff?", keeping
-- whatever else it checked (sms_messages still hides the care channel).
-- (select …) so it is evaluated once per statement, not once per row.
do $$
declare
  r record;
  old_expr constant text := '(auth.role() = ''authenticated''::text)';
  new_expr constant text := '(select public.is_active_staff())';
  stmt text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (position(old_expr in coalesce(qual, '')) > 0 or position(old_expr in coalesce(with_check, '')) > 0)
  loop
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then stmt := stmt || ' using (' || replace(r.qual, old_expr, new_expr) || ')'; end if;
    if r.with_check is not null then stmt := stmt || ' with check (' || replace(r.with_check, old_expr, new_expr) || ')'; end if;
    execute stmt;
  end loop;
end $$;

-- The website editor's table was writable by any signed-in account.
alter policy "website_content authed write" on public.website_content
  with check ((select public.is_active_staff()));
alter policy "website_content authed update" on public.website_content
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));


-- ── 2. Nobody makes themselves staff ─────────────────────────
drop policy if exists "Own row" on public.staff;


-- ── 3. Cares texts are an admin's decision ───────────────────
create or replace function public.staff_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only authenticated NON-admins are restricted. Service-role contexts (SQL
  -- editor, edge functions) have no auth.uid() and are allowed through.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.role        is distinct from old.role
  or new.permissions is distinct from old.permissions
  or new.active      is distinct from old.active then
    raise exception 'Only an admin can change role, permissions, or active status';
  end if;

  -- Who receives care texts is not the person's own setting. Kept as it was
  -- rather than refused, so a save that merely carried a stale copy of the
  -- preferences (onboarding does) still goes through.
  new.preferences := coalesce(new.preferences, '{}'::jsonb);
  if old.preferences ? 'caresSmsOptIn' then
    new.preferences := jsonb_set(new.preferences, '{caresSmsOptIn}', old.preferences -> 'caresSmsOptIn');
  else
    new.preferences := new.preferences - 'caresSmsOptIn';
  end if;
  if old.preferences ? 'caresStopOptedOut' then
    new.preferences := jsonb_set(new.preferences, '{caresStopOptedOut}', old.preferences -> 'caresStopOptedOut');
  else
    new.preferences := new.preferences - 'caresStopOptedOut';
  end if;

  -- A different number on an account that receives care texts: pause them until
  -- an admin has confirmed the number, or care details go wherever it was typed.
  if (old.preferences ->> 'caresSmsOptIn') = 'true'
     and right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10)
         is distinct from right(regexp_replace(coalesce(old.phone, ''), '\D', '', 'g'), 10) then
    new.preferences := new.preferences
      || jsonb_build_object('caresSmsOptIn', false, 'caresPausedForNewNumber', true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_staff_guard on public.staff;
create trigger trg_staff_guard before update on public.staff
  for each row execute function public.staff_guard();


-- ── Checks ───────────────────────────────────────────────────
-- Nothing still asks only "signed in?":
--   select tablename, policyname from pg_policies
--    where schemaname = 'public' and (qual like '%auth.role()%' or with_check like '%auth.role()%');
-- Nobody can insert themselves into staff:
--   select policyname, cmd from pg_policies where tablename = 'staff';
-- Landlines currently skipped:
--   select count(*) from sms_landlines;
