-- ============================================================
--  PILLAR · LET CARES STAFF READ THE TEXTS SENT TO DEACONS
--  Run this in Supabase → SQL Editor
-- ============================================================
--
-- sms-care-isolation.sql hid every care row from the app, because the SMS log
-- is read by any signed-in staff member and care traffic carries hospitals,
-- diagnoses and names. That is still the rule for the congregation log.
--
-- What it also hid is the one thing the office needs to see: what each deacon
-- was actually told about their families. This opens exactly that slice —
-- messages addressed to a deacon's own number — and only to staff who already
-- hold Cares access. Everything else on the care channel (the 8:00 AM and
-- 4:00 PM staff digests, the intake bot's confirmations) stays hidden.
--
-- Enforced in row-level security rather than the UI: a filter in the app would
-- still leave the rows reachable by anyone who queried the table directly.

-- Who may read them: an admin, or someone an admin gave Cares access.
-- A member-app login is never staff, even if a staff row existed for it.
create or replace function public.can_read_deacon_sms() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.active is not false
       and (s.role ilike '%admin%' or coalesce(s.permissions ->> 'cares', 'none') in ('view', 'edit'))
    from public.staff s
    where s.id = auth.uid()
  ), false)
  and not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.raw_app_meta_data ? 'bbc_member_id'
  );
$$;
grant execute on function public.can_read_deacon_sms() to authenticated, service_role;

-- Whose numbers count as a deacon's. Both ways the directory records it: the
-- "Deacons" tag the composer's Deacons group goes by, and being named as
-- somebody's deacon. Exact tag match — "Deacons", not merely containing it.
create or replace function public.deacon_phone10s() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), 10) as p10
  from public.church_members m
  where length(right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), 10)) = 10
    and (
      exists (
        select 1 from unnest(string_to_array(coalesce(m.tags, ''), ',')) t
        where lower(btrim(t)) = 'deacons'
      )
      or m.id in (select deacon_id from public.church_members where deacon_id is not null)
    );
$$;
grant execute on function public.deacon_phone10s() to authenticated, service_role;

-- Read-only, and additive: the existing "staff read sms" policy (channel =
-- 'sms') is untouched, so ordinary staff see exactly what they saw before.
-- Nothing here grants insert, update or delete on a care row.
drop policy if exists "cares staff read deacon sms" on sms_messages;
create policy "cares staff read deacon sms" on sms_messages
  for select using (
    channel = 'care'
    and (select public.can_read_deacon_sms())
    and to10 in (select public.deacon_phone10s())
  );

-- Check, as an ordinary signed-in user with no Cares access:
--   select count(*) from sms_messages where channel = 'care';   -- must be 0
-- As an admin: only rows addressed to a deacon's number come back, never the
-- staff digests.
