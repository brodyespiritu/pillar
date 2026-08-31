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

-- ── Message type ──────────────────────────────────────────────────────────
-- 'Dinner' | 'General'. A Dinner's replies are tallied into a headcount on the
-- Responses tab, and the inbound webhook reads this to decide whether a reply
-- earns an automatic "Reservation received." acknowledgement.
alter table sms_library   add column if not exists message_type text default 'General';
alter table sms_scheduled add column if not exists message_type text default 'General';

-- The webhook matches a reply to the last thing we sent that person, skipping
-- our own acknowledgements; this is the lookup it makes on every inbound text.
create index if not exists sms_library_message_type_idx on sms_library (message_type);

-- ── Public RSVP links ─────────────────────────────────────────────────────
-- "Create link" on a Dinner mints a token that identifies that one dinner to
-- the public form at /rsvp/<token>. Reservations taken through the link are
-- filed against this row's message, so they land in the same Responses box as
-- the replies that came in by text.
alter table sms_library add column if not exists rsvp_token text;
create unique index if not exists sms_library_rsvp_token_idx on sms_library (rsvp_token)
  where rsvp_token is not null;

-- What is being served, shown on the public RSVP form above the fields.
alter table sms_library add column if not exists rsvp_menu jsonb not null default '[]'::jsonb;

-- ── Recurring sends ───────────────────────────────────────────────────────
-- A repeating schedule is one row at a time: when it goes out, the sender
-- writes the next occurrence. Cancelling the pending row therefore ends the
-- series, and a backlog cannot pile up while the cron is down.
--   repeat_rule: none | weekly | biweekly | monthly
--   target_key : 'all' or a group id, so a recurring send picks up people
--                added since it was scheduled instead of texting a snapshot
--                of the congregation taken weeks ago.
alter table sms_scheduled add column if not exists repeat_rule text not null default 'none';
alter table sms_scheduled add column if not exists target_key  text;
