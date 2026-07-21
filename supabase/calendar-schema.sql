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
create policy "staff read events"  on events for select using (auth.role() = 'authenticated');
create policy "staff write events" on events for all    using (auth.role() = 'authenticated');

drop trigger if exists trg_touch_events on events;
create trigger trg_touch_events before update on events
  for each row execute function touch_updated_at();
