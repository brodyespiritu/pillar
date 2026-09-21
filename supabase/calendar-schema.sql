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
--  PILLAR · CALENDAR MODULE SCHEMA
--  Run this in Supabase → SQL Editor
-- ============================================================

create table if not exists events (
  id             uuid primary key default gen_random_uuid(),
  calendar       text default 'church',       -- 'church' | 'personal'
  title          text not null,
  description    text,
  category       text default 'Other',
  start_date     date not null,
  end_date       date,
  start_time     text,                          -- 'HH:MM'
  end_time       text,
  location       text,
  organizer      text,
  is_private     boolean default false,
  is_recurring   boolean default false,
  recurrence     text,                          -- Weekly | Every 2 Weeks | Monthly
  recurrence_end date,
  series_id      uuid,
  created_by     uuid references staff(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists idx_events_calendar on events(calendar);
create index if not exists idx_events_start    on events(start_date);
create index if not exists idx_events_series    on events(series_id);

alter table events enable row level security;
create policy "staff read events"  on events for select using ((select public.is_active_staff()));
create policy "staff write events" on events for all    using ((select public.is_active_staff()));

drop trigger if exists trg_touch_events on events;
create trigger trg_touch_events before update on events
  for each row execute function touch_updated_at();
