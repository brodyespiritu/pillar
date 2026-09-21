-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

-- ============================================================
--  PILLAR · "STARTS IN 30 MINUTES" CARE REMINDERS
--  Run this in Supabase → SQL Editor
-- ============================================================
--
-- One row per reminder actually sent. The composite primary key is what stops
-- a repeated cron firing — or a retry — from texting staff about the same
-- surgery twice.

create table if not exists care_reminders_sent (
  member_id     uuid not null references care_members(id) on delete cascade,
  event_date    date not null,
  event_minutes integer not null,        -- local minutes past midnight
  kind          text,
  sent_at       timestamptz default now(),
  recipients    integer,
  primary key (member_id, event_date, event_minutes)
);

alter table care_reminders_sent enable row level security;

drop policy if exists "staff read care reminders" on care_reminders_sent;
create policy "staff read care reminders" on care_reminders_sent
  for select using ((select public.is_active_staff()));
-- The edge function writes with the service role, which bypasses RLS.

-- Check:
--   select * from care_reminders_sent order by sent_at desc limit 20;
