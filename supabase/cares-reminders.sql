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
  for select using (auth.role() = 'authenticated');
-- The edge function writes with the service role, which bypasses RLS.

-- Check:
--   select * from care_reminders_sent order by sent_at desc limit 20;
