-- ============================================================
--  PILLAR · SMS BROADCAST SCHEMA  (congregation texting)
--  Run this in Supabase → SQL Editor  (needs sms-schema.sql too)
-- ============================================================

create table if not exists sms_groups (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid references staff(id) on delete cascade,
  name       text not null,
  created_at timestamptz default now()
);

create table if not exists sms_contacts (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid references staff(id) on delete cascade,
  name       text,
  phone      text not null,
  created_at timestamptz default now()
);

create table if not exists sms_group_members (
  group_id   uuid references sms_groups(id)   on delete cascade,
  contact_id uuid references sms_contacts(id) on delete cascade,
  primary key (group_id, contact_id)
);

create index if not exists idx_gm_group   on sms_group_members(group_id);
create index if not exists idx_gm_contact on sms_group_members(contact_id);

alter table sms_groups        enable row level security;
alter table sms_contacts      enable row level security;
alter table sms_group_members enable row level security;

create policy "own groups"   on sms_groups   for all using (owner = auth.uid());
create policy "own contacts" on sms_contacts for all using (owner = auth.uid());
-- membership rows are reachable via their owned group/contact
create policy "own members"  on sms_group_members for all using (auth.role() = 'authenticated');
