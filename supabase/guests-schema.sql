-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

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

create policy "staff read guests"    on guests           for select using ((select public.is_active_staff()));
create policy "staff write guests"   on guests           for all    using ((select public.is_active_staff()));
create policy "staff read comments"  on greeter_comments for select using ((select public.is_active_staff()));
create policy "staff write comments" on greeter_comments for all    using ((select public.is_active_staff()));
create policy "staff read connections"  on new_connections for select using ((select public.is_active_staff()));
create policy "staff write connections" on new_connections for all    using ((select public.is_active_staff()));

drop trigger if exists trg_touch_guests on guests;
create trigger trg_touch_guests before update on guests
  for each row execute function touch_updated_at();
