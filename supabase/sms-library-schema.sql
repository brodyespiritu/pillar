-- ============================================================
--  PILLAR · SMS LIBRARY + SCHEDULED SENDS
--  Run in Supabase → SQL Editor  (needs sms-schema.sql / staff)
-- ============================================================

-- Saved messages (every broadcast is recorded here; users can resend them)
create table if not exists sms_library (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid references staff(id) on delete set null,
  title           text,                    -- optional friendly name
  body            text not null,
  target_label    text,                    -- "All congregation" / group name
  recipient_count int default 0,
  last_sent_at    timestamptz,
  created_at      timestamptz default now()
);

-- Scheduled broadcasts (recipients snapshotted at schedule time)
create table if not exists sms_scheduled (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid references staff(id) on delete set null,
  body         text not null,
  target_label text,
  recipients   jsonb not null default '[]',   -- [{ name, phone }]
  send_at      timestamptz not null,
  status       text not null default 'pending', -- pending | processing | sent | failed | canceled
  sent_count   int,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz default now()
);

create index if not exists idx_sched_due on sms_scheduled(status, send_at);

alter table sms_library   enable row level security;
alter table sms_scheduled enable row level security;

-- Shared church-wide, same as sms_messages
create policy "staff read library"  on sms_library   for select using (auth.role() = 'authenticated');
create policy "staff write library" on sms_library   for all    using (auth.role() = 'authenticated');
create policy "staff read sched"    on sms_scheduled for select using (auth.role() = 'authenticated');
create policy "staff write sched"   on sms_scheduled for all    using (auth.role() = 'authenticated');

-- ============================================================
--  DISPATCHER — makes scheduled texts actually send
--  1) Deploy the edge function:
--       supabase functions deploy send-scheduled-sms
--     (Telnyx secrets are already set for send-prospect-sms.)
--  2) Schedule it every minute. Easiest: Supabase Dashboard →
--     Integrations → Cron (enable pg_cron + pg_net), then run
--     the block below with YOUR project ref + anon key filled in:
--
-- select cron.schedule(
--   'send-scheduled-sms', '* * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-scheduled-sms',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
--     body    := '{}'::jsonb
--   );
--   $$
-- );
-- ============================================================
