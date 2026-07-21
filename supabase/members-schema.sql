-- ============================================================
--  PILLAR · CHURCH MEMBERS (directory)
--  Run this in Supabase → SQL Editor
-- ============================================================

create table if not exists church_members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  email      text,
  address    text,
  photo_url  text,
  birthday   date,
  family     text,
  tags       text,                    -- comma-separated groups/labels (list built later)
  status     text default 'Active',   -- Active | Inactive
  notes      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_church_members_name on church_members(name);

alter table church_members enable row level security;
create policy "staff read members"  on church_members for select using (auth.role() = 'authenticated');
create policy "staff write members" on church_members for all    using (auth.role() = 'authenticated');

drop trigger if exists trg_touch_members on church_members;
create trigger trg_touch_members before update on church_members
  for each row execute function touch_updated_at();
