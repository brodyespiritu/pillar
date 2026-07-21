-- ============================================================
--  PILLAR · GUEST LIST MODULE SCHEMA
--  Run this in Supabase → SQL Editor
-- ============================================================

create table if not exists guests (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  type          text default 'Returning Guest/Member',
  phone         text,
  email         text,
  address       text,
  first_visit   date,
  last_visit    date,
  assigned_to   uuid references staff(id) on delete set null,
  assigned_name text,
  status        text default 'Active',    -- Active / Followed Up / Converted / Inactive
  notes         text,
  return_count  int default 0,
  spouse        text,
  family        jsonb default '[]'::jsonb, -- [{ relation, name, age }]
  absence_type  text,                       -- Brief / Long (returning guests)
  not_prospect  boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Greeter observations ("Pathway to Belonging")
create table if not exists greeter_comments (
  id           uuid primary key default gen_random_uuid(),
  person_name  text,
  comment      text,
  submitted_by text,
  created_at   timestamptz default now()
);

-- New connections (ministry sign-ups made during service → "New Connections")
create table if not exists new_connections (
  id           uuid primary key default gen_random_uuid(),
  person_name  text,
  ministry     text,
  member_id    uuid references church_members(id) on delete set null,
  submitted_by text,
  created_at   timestamptz default now()
);

create index if not exists idx_guests_type   on guests(type);
create index if not exists idx_guests_status on guests(status);

alter table guests           enable row level security;
alter table greeter_comments enable row level security;
alter table new_connections  enable row level security;

create policy "staff read guests"    on guests           for select using (auth.role() = 'authenticated');
create policy "staff write guests"   on guests           for all    using (auth.role() = 'authenticated');
create policy "staff read comments"  on greeter_comments for select using (auth.role() = 'authenticated');
create policy "staff write comments" on greeter_comments for all    using (auth.role() = 'authenticated');
create policy "staff read connections"  on new_connections for select using (auth.role() = 'authenticated');
create policy "staff write connections" on new_connections for all    using (auth.role() = 'authenticated');

drop trigger if exists trg_touch_guests on guests;
create trigger trg_touch_guests before update on guests
  for each row execute function touch_updated_at();
