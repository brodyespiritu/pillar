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

create policy "staff read email_config"  on email_config for select using ((select public.is_active_staff()));
create policy "staff write email_config" on email_config for all    using ((select public.is_active_staff()));
create policy "staff read recap_sends"   on recap_sends  for select using ((select public.is_active_staff()));
create policy "staff write recap_sends"  on recap_sends  for all    using ((select public.is_active_staff()));
create policy "staff read email_groups"  on email_groups for select using ((select public.is_active_staff()));
create policy "staff write email_groups" on email_groups for all    using ((select public.is_active_staff()));
