-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

-- ── Contact Log visibility ────────────────────────────────
-- Guarantees every signed-in staff member sees the Contact Log on every care
-- member — not just the entries they wrote themselves.
-- Safe to run more than once.

-- 1. What is actually in place right now? (run this first, read the `qual`)
--    A correct row reads:  ( SELECT is_active_staff() AS is_active_staff)   (signed-in staff only)
--    Anything mentioning auth.uid() or logged_by would hide other people's logs.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'contact_logs';

-- 2. Reset them to the shared-team rule.
alter table contact_logs enable row level security;

drop policy if exists "staff read logs"  on contact_logs;
drop policy if exists "staff write logs" on contact_logs;

create policy "staff read logs"  on contact_logs
  for select using ((select public.is_active_staff()));
create policy "staff write logs" on contact_logs
  for all    using ((select public.is_active_staff()));

-- 3. Confirm — should show the two policies above and nothing else.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'contact_logs';
