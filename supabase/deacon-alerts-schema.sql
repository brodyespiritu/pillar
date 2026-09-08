-- ════════════════════════════════════════════════════════════
-- Deacon alerts
--
-- Who has already been told what. Claimed before the text goes out, exactly as
-- care_reminders_sent is: the recap runs every half hour, and a duplicate
-- firing must not text a deacon about the same admission twice.
--
-- ref_id points at whatever caused the alert — a care_members row for a new
-- record, a contact_logs row for an update — so re-running over the same window
-- is harmless.
-- ════════════════════════════════════════════════════════════

create table if not exists deacon_alerts_sent (
  id           uuid primary key default gen_random_uuid(),
  deacon_phone text not null,          -- last 10 digits, as matched
  kind         text not null,          -- 'added' | 'update' | 'daily'
  ref_id       text not null,          -- care_members.id, contact_logs.id, or a date for 'daily'
  sent_at      timestamptz default now(),
  unique (deacon_phone, kind, ref_id)
);

create index if not exists idx_deacon_alerts_sent_at on deacon_alerts_sent(sent_at);

alter table deacon_alerts_sent enable row level security;
drop policy if exists "staff read deacon alerts"  on deacon_alerts_sent;
drop policy if exists "staff write deacon alerts" on deacon_alerts_sent;
create policy "staff read deacon alerts"  on deacon_alerts_sent
  for select using (auth.role() = 'authenticated');
create policy "staff write deacon alerts" on deacon_alerts_sent
  for all    using (auth.role() = 'authenticated');
