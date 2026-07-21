-- ============================================================
--  PILLAR · SMS MODULE SCHEMA  (Telnyx)
--  Run this in Supabase → SQL Editor
-- ============================================================

create table if not exists sms_messages (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid references staff(id) on delete set null,
  to_number    text not null,
  to_name      text,
  body         text,
  status       text default 'MassText',   -- MassText | Sent | Failed | Received
  provider_id  text,
  error        text,
  created_at   timestamptz default now()
);

create index if not exists idx_sms_to     on sms_messages(to_number);
create index if not exists idx_sms_status on sms_messages(status);

alter table sms_messages enable row level security;
create policy "staff read sms"  on sms_messages for select using (auth.role() = 'authenticated');
create policy "staff write sms" on sms_messages for all    using (auth.role() = 'authenticated');
