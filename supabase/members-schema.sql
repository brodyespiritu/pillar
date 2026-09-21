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
create policy "staff read members"  on church_members for select using ((select public.is_active_staff()));
create policy "staff write members" on church_members for all    using ((select public.is_active_staff()));

drop trigger if exists trg_touch_members on church_members;
create trigger trg_touch_members before update on church_members
  for each row execute function touch_updated_at();
