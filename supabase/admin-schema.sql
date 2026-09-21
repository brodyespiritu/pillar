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
--  PILLAR · ADMIN MODULE SCHEMA
--  Run this in Supabase → SQL Editor
-- ============================================================

-- Extra staff columns used by the Admin dashboard (safe if already present)
alter table staff add column if not exists department  text;
alter table staff add column if not exists active      boolean default true;
alter table staff add column if not exists auth_method text default 'email';
alter table staff add column if not exists pto_total   int default 15;
alter table staff add column if not exists pto_used    int default 0;
alter table staff add column if not exists title       text;
alter table staff add column if not exists phone       text;
alter table staff add column if not exists permissions jsonb default '{}';

-- Time-off requests
create table if not exists time_off_requests (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid references staff(id) on delete cascade,
  staff_name  text,
  start_date  date,
  end_date    date,
  half_day    boolean default false,
  reason      text,
  status      text default 'Pending',   -- Pending | Approved | Denied
  decided_by  text,
  deny_reason text,
  created_at  timestamptz default now()
);

-- Care-list audit trail
create table if not exists change_log (
  id          uuid primary key default gen_random_uuid(),
  member_name text,
  action      text,          -- Created | Updated | Deleted | Merged | Contact Logged
  details     text,
  changed_by  text,
  created_at  timestamptz default now()
);

-- Staff directory: any signed-in staff member can read the whole list, and
-- manage it (the Admin UI is where admin-only gating happens). Without the
-- read policy, fetchStaff only returns the caller's own row.
alter table staff enable row level security;
drop policy if exists "staff read all"  on staff;
drop policy if exists "staff write all" on staff;
create policy "staff read all"  on staff for select using ((select public.is_active_staff()));
create policy "staff write all" on staff for all    using ((select public.is_active_staff()));

alter table time_off_requests enable row level security;
alter table change_log        enable row level security;

create policy "staff read pto"   on time_off_requests for select using ((select public.is_active_staff()));
create policy "staff write pto"  on time_off_requests for all    using ((select public.is_active_staff()));
create policy "staff read log"   on change_log        for select using ((select public.is_active_staff()));
create policy "staff write log"  on change_log        for all    using ((select public.is_active_staff()));
