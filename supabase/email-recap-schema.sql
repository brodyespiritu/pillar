-- ============================================================
--  PILLAR · EMAIL — Greeter Ministry Recap
--  Saved recipient groups + recap send log.  Run in SQL Editor.
-- ============================================================

-- Shared saved emails (the "Greeters" group + room for future groups)
create table if not exists email_config (
  id          uuid primary key default gen_random_uuid(),
  group_name  text not null default 'greeters',
  email       text not null,
  name        text,
  created_at  timestamptz default now()
);
create index if not exists idx_email_config_group on email_config(group_name);

-- Every greeter-recap send (foundation for "Viewed Recap" tracking later)
create table if not exists recap_sends (
  id               uuid primary key default gen_random_uuid(),
  subject          text,
  recipients       jsonb not null default '[]',   -- ["a@x.com", ...]
  recipient_count  int default 0,
  sender_name      text,
  created_by       uuid references staff(id) on delete set null,
  sent_at          timestamptz default now()
);

-- Named groups so an empty group persists (members still live in email_config)
create table if not exists email_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_by  uuid references staff(id) on delete set null,
  created_at  timestamptz default now()
);

alter table email_config enable row level security;
alter table recap_sends  enable row level security;
alter table email_groups enable row level security;

create policy "staff read email_config"  on email_config for select using (auth.role() = 'authenticated');
create policy "staff write email_config" on email_config for all    using (auth.role() = 'authenticated');
create policy "staff read recap_sends"   on recap_sends  for select using (auth.role() = 'authenticated');
create policy "staff write recap_sends"  on recap_sends  for all    using (auth.role() = 'authenticated');
create policy "staff read email_groups"  on email_groups for select using (auth.role() = 'authenticated');
create policy "staff write email_groups" on email_groups for all    using (auth.role() = 'authenticated');
