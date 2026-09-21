-- Instant app updates: when something the app shows changes in Pillar, phones with that page open
-- read it again within a second or two (user, 2026-09-17: "I need the ability to change anything on
-- Pillar that will update instantly on the app").
--
-- One small table with a row per kind of content, holding when it last changed. Phones listen to it
-- (Supabase Realtime) and check it again when they wake, to catch up on anything they missed. Only
-- the fact of a change travels. Each phone then re-reads the content the usual way, so every read
-- rule still decides what it may see.
--
--   * Pillar's own tables bump their row by trigger, whichever page (or import) made the change.
--   * Content kept on the app server (announcements, sermons, the Watch page, live status) is bumped
--     by Pillar after each save it makes there (src/lib/appRefresh.js).
--
-- Run this in the Supabase SQL editor. Safe to run twice, and in either order with
-- app-home-cards.sql and group-posts.sql (each joins in whatever already exists).

create table if not exists public.app_refresh (
  part text primary key,
  at   timestamptz not null default now()
);

-- the kinds of content, as the app names them (BethesdaApp utils/liveUpdates.js)
--   home           the cards under Home's four boxes
--   announcements  the Bulletin's announcements (app server)
--   calendar       the church calendar and its places
--   groups         groups and ministries, and the cards written for them
--   sermons        the sermon list (app server)
--   media          the Watch page's layout, videos and resources (app server)
--   live           whether the church is live (app server)
alter table public.app_refresh drop constraint if exists app_refresh_part_check;
alter table public.app_refresh add constraint app_refresh_part_check
  check (part in ('home', 'announcements', 'calendar', 'groups', 'sermons', 'media', 'live'));

insert into public.app_refresh (part)
select p from unnest(array['home', 'announcements', 'calendar', 'groups', 'sermons', 'media', 'live']) as p
on conflict (part) do nothing;

alter table public.app_refresh enable row level security;

drop policy if exists "anyone reads app refresh" on public.app_refresh;
drop policy if exists "staff bump app refresh"   on public.app_refresh;

-- nothing in it but content names and times; phones read it signed in or out
create policy "anyone reads app refresh" on public.app_refresh
  for select to anon, authenticated using (true);
create policy "staff bump app refresh" on public.app_refresh
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- ── Pillar's bump after a save to the app server ───────────────────────────────────────────────
-- Runs as the caller, so the policy above decides who may: active staff only.
create or replace function public.app_touch(p text)
returns void language sql security invoker set search_path = '' as $$
  insert into public.app_refresh (part, at) values (p, now())
  on conflict (part) do update set at = now();
$$;
revoke all on function public.app_touch(text) from public, anon;
grant execute on function public.app_touch(text) to authenticated;

-- ── Pillar's own tables bump their row themselves ──────────────────────────────────────────────
-- Runs as its owner, so a staff write needs no second permission. And it can never stop the write it
-- follows: if the bump fails, phones just catch up the next time they wake.
create or replace function public.app_refresh_bump()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.app_refresh (part, at) values (tg_argv[0], now())
    on conflict (part) do update set at = now();
  exception when others then
    null;
  end;
  return null;
end $$;
revoke all on function public.app_refresh_bump() from public, anon, authenticated;

do $b$
declare
  t record;
begin
  for t in select * from (values
    ('events',         'calendar'),
    ('locations',      'calendar'),
    ('church_groups',  'groups'),
    ('group_posts',    'groups'),
    ('app_home_cards', 'home')
  ) as v(tbl, part)
  loop
    if to_regclass('public.' || t.tbl) is not null then
      execute format('drop trigger if exists trg_app_refresh on public.%I', t.tbl);
      -- once per statement, so a bulk change (a recurring series, an import) is one bump
      execute format(
        'create trigger trg_app_refresh after insert or update or delete or truncate on public.%I '
        'for each statement execute function public.app_refresh_bump(%L)', t.tbl, t.part);
    end if;
  end loop;
end $b$;

-- ── Phones listening ───────────────────────────────────────────────────────────────────────────
do $r$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_refresh')
  then
    execute 'alter publication supabase_realtime add table public.app_refresh';
  end if;
end $r$;

select part, at from public.app_refresh order by part;
