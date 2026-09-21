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
--  PILLAR · CARES MODULE SCHEMA
--  Run this in Supabase → SQL Editor
-- ============================================================

-- ── Care members ──────────────────────────────────────────
create table if not exists care_members (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  phone            text,
  email            text,
  address          text,
  family_member    text,

  category         text default 'Other',      -- 13 categories
  priority         text default 'Medium',     -- High / Medium / Low
  status           text default 'Active',      -- Active / Inactive / Resolved
  assigned_to      uuid references staff(id) on delete set null,
  assigned_name    text,

  -- Medical (conditional)
  hospital_name    text,
  room_number      text,
  floor            text,
  admission_date   date,
  surgery_type     text,
  surgery_date     date,
  surgeon_name     text,

  -- Insurance
  insurance_carrier   text,
  insurance_policy    text,
  insurance_group     text,
  insurance_member_id text,
  insurance_plan_type text,

  care_notes       text,

  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ── Contact logs ──────────────────────────────────────────
create table if not exists contact_logs (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid references care_members(id) on delete cascade,
  type           text default 'Update/Visit',  -- Phone Call / Text Message / Dinner/Meal / Update/Visit
  notes          text,
  logged_by      uuid references staff(id) on delete set null,
  logged_by_name text,
  created_at     timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────
create index if not exists idx_care_members_status   on care_members(status);
create index if not exists idx_care_members_priority on care_members(priority);
create index if not exists idx_contact_logs_member   on contact_logs(member_id);

-- ── Row level security ────────────────────────────────────
alter table care_members enable row level security;
alter table contact_logs enable row level security;

-- Any authenticated staff member can read/write care data
create policy "staff read care"   on care_members for select using ((select public.is_active_staff()));
create policy "staff write care"  on care_members for all    using ((select public.is_active_staff()));
create policy "staff read logs"   on contact_logs for select using ((select public.is_active_staff()));
create policy "staff write logs"  on contact_logs for all    using ((select public.is_active_staff()));

-- ── Keep updated_at fresh ─────────────────────────────────
create or replace function touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_touch_care on care_members;
create trigger trg_touch_care before update on care_members
  for each row execute function touch_updated_at();
