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
--  PILLAR · GROUPS
--
--  The church's groups, as the app's Groups page shows them (screens/GroupsScreen.js). Until this
--  table exists that page can only infer a group from the calendar: it knows a group's name and when
--  it next meets, but nothing about what it is or who leads it, and it says so rather than guessing.
--
--  Everything here is the office's own words. Nothing is generated.
--
--  `filter_key` ties a group to the calendar's ministry filter (utils/eventFilters.js: kids, youth,
--  college, women, men), which is how the app counts what a group has coming up and opens the
--  Calendar filtered to it. A group with no filter_key simply has no calendar tie-in.
--
--  `leaders` holds names the office typed, and optionally the member record each belongs to:
--    [{ "name": "Jane Doe", "member_id": "uuid-or-null", "role": "Leader" }]
--  These are published to anyone who opens the app, so the office decides who is named — the same
--  judgement as putting a name on the website. Never add a contact detail here; the Directory owns
--  those, with each member's own sharing choice (member-app-auth.sql).
--
--  Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.church_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  about       text check (about is null or char_length(about) <= 1000),
  -- when it meets, in the office's words ("Wednesdays at 6:30 PM"); the app falls back to the next
  -- calendar event when this is blank
  meets       text check (meets is null or char_length(meets) <= 120),
  location    text check (location is null or char_length(location) <= 120),
  audience    text check (audience is null or char_length(audience) <= 80),   -- "20s & 30s", "All ages"
  leaders     jsonb not null default '[]'::jsonb,
  filter_key  text check (filter_key is null or filter_key ~ '^[a-z][a-z0-9_-]{0,30}$'),
  published   boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Leaders must be a list of objects that each carry a name, so the app can always draw a card.
-- A CHECK can't hold a subquery, so the rule lives in an immutable function the constraint calls.
create or replace function public.app_group_leaders_ok(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(v) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(v) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(btrim(e ->> 'name'), '') = ''
           or char_length(e ->> 'name') > 80
     )
$$;

alter table public.church_groups drop constraint if exists church_groups_leaders_check;
alter table public.church_groups add constraint church_groups_leaders_check
  check (public.app_group_leaders_ok(leaders));

create index if not exists church_groups_order_idx on public.church_groups (published, sort, name);

alter table public.church_groups enable row level security;

drop policy if exists "staff read groups"   on public.church_groups;
drop policy if exists "staff write groups"  on public.church_groups;
drop policy if exists "public read groups"  on public.church_groups;

create policy "staff read groups"  on public.church_groups
  for select using ((select public.is_active_staff()));
create policy "staff write groups" on public.church_groups
  for all    using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- The app and the church website read this with the public anon key, the same way they read the
-- calendar and its rooms (locations-schema.sql). Only PUBLISHED groups leave the database: an
-- unpublished one is the office's draft and stays theirs.
create policy "public read groups" on public.church_groups
  for select to anon using (published);

-- keep updated_at honest, as the other tables do
do $t$ begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'drop trigger if exists trg_touch_church_groups on public.church_groups';
    execute 'create trigger trg_touch_church_groups before update on public.church_groups
               for each row execute function public.touch_updated_at()';
  end if;
end $t$;

-- ── The five groups the app already shows ───────────────────────────────────
-- Seeded with the calendar's own ministry groups and nothing else: a name and the filter that ties
-- it to the calendar. `about`, `meets`, `location`, `audience` and `leaders` are deliberately left
-- empty for the office to write — the app says "the church office hasn't written this yet" until
-- they do, which is the truth, and better than a description nobody at the church wrote.
insert into public.church_groups (name, filter_key, sort)
select v.name, v.filter_key, v.sort
  from (values
    ('Kids',                    'kids',    10),
    ('Youth',                   'youth',   20),
    ('College & Young Adults',  'college', 30),
    ('Women',                   'women',   40),
    ('Men',                     'men',     50)
  ) as v(name, filter_key, sort)
 where not exists (select 1 from public.church_groups g where g.filter_key = v.filter_key);
