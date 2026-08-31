-- ── Cares digests: 8:00, 10:30 AM, 1:00, 3:00, 5:00 PM ──
-- Run once in the Supabase SQL editor.
--
-- One hourly cron entry, not six fixed UTC times. pg_cron runs in UTC, so a
-- fixed schedule would need changing twice a year for daylight saving; instead
-- the edge function checks the real Columbus wall clock and no-ops on the 21
-- firings that aren't a send slot. A per-slot claim row makes a duplicate
-- firing harmless.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One row per slot actually sent. The composite primary key is what stops a
-- retry from texting everyone twice.
create table if not exists cares_alert_sends (
  sent_on    date    not null,
  slot       integer not null,          -- local minutes past midnight: 480 / 630 / 780 / 900 / 1020
  sent_at    timestamptz default now(),
  recipients integer,
  added      integer,
  updates    integer,
  events     integer,
  note       text,
  primary key (sent_on, slot)
);

alter table cares_alert_sends enable row level security;
drop policy if exists "staff read alert sends" on cares_alert_sends;
create policy "staff read alert sends" on cares_alert_sends
  for select using (auth.role() = 'authenticated');
-- Writes happen from the edge function with the service role, which bypasses RLS.

-- ── Schedule ──────────────────────────────────────────────
-- Authenticates with CARES_CRON_SECRET, a dedicated secret set via
--   supabase secrets set CARES_CRON_SECRET=...
-- rather than the service_role key. Two reasons: a mistyped 219-character JWT
-- fails silently here (net.http_post is fire-and-forget, so cron still reports
-- 'succeeded' on a 403), and this secret can only trigger a send — reading care
-- records back still requires the service role.

select cron.unschedule('cares-alerts') where exists
  (select 1 from cron.job where jobname = 'cares-alerts');
-- Retire the older single-send jobs if they were ever created.
select cron.unschedule('cares-recap-summer') where exists
  (select 1 from cron.job where jobname = 'cares-recap-summer');
select cron.unschedule('cares-recap-winter') where exists
  (select 1 from cron.job where jobname = 'cares-recap-winter');

select cron.schedule('cares-alerts', '0,30 * * * *', $$
  select net.http_post(
    url     := 'https://dxiqhequrfdodeyqzowz.supabase.co/functions/v1/cares-recap',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <CARES_CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$$);

-- Check it registered:
--   select jobname, schedule, active from cron.job where jobname = 'cares-alerts';
-- What has gone out:
--   select * from cares_alert_sends order by sent_on desc, slot desc limit 20;
