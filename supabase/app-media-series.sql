-- Series and Featured on the app's Media page
-- (user, 2026-09-17: "for the watch page in pillar, allow me to create series. Series then show up
-- as individual rows on the media page in the app… have a toggle that says featured that THEN goes
-- right below the main vertical card in media").
--
-- The sermons and videos themselves stay where they are — the app server (bethesda-admin). What is
-- new here is the ARRANGEMENT: which series exist, what is in each one, and what is featured.
-- Both tables hold app-server ids as plain text, so nothing here can be broken by that server.
--
--   app_media_series    a series the office made: a name, a cover, and the videos in it, in order
--   app_media_featured  the sermons and videos that sit right below the big card on Media
--
-- Neither has to exist: without them the app's Media page works exactly as it does today (the
-- series it guesses from each sermon's "series" word, and every video in one section at the bottom).
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.app_media_series (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subtitle   text,
  image_url  text,
  -- [{ "id": "<app-server id>", "kind": "sermon" | "video" }, …] — the order they play in
  items      jsonb not null default '[]'::jsonb,
  published  boolean not null default false,
  sort       integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_media_series drop constraint if exists app_media_series_check;
alter table public.app_media_series add constraint app_media_series_check check (
  char_length(btrim(name)) between 1 and 60
  and (subtitle is null or char_length(subtitle) <= 120)
  and (image_url is null or image_url ~ '^https?://[^[:space:]]+$')
  and jsonb_typeof(items) = 'array'
);

create table if not exists public.app_media_featured (
  item_id    text primary key,
  kind       text not null default 'video',
  sort       integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_media_featured drop constraint if exists app_media_featured_kind_check;
alter table public.app_media_featured add constraint app_media_featured_kind_check
  check (kind in ('sermon', 'video'));

alter table public.app_media_series   enable row level security;
alter table public.app_media_featured enable row level security;

drop policy if exists "public read media series"     on public.app_media_series;
drop policy if exists "staff write media series"     on public.app_media_series;
drop policy if exists "public read media featured"   on public.app_media_featured;
drop policy if exists "staff write media featured"   on public.app_media_featured;

-- every phone reads them, signed in or out; only active staff change them
create policy "public read media series" on public.app_media_series
  for select to anon, authenticated using (true);
create policy "staff write media series" on public.app_media_series
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

create policy "public read media featured" on public.app_media_featured
  for select to anon, authenticated using (true);
create policy "staff write media featured" on public.app_media_featured
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

do $t$ begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'drop trigger if exists trg_touch_app_media_series on public.app_media_series';
    execute 'create trigger trg_touch_app_media_series before update on public.app_media_series
               for each row execute function public.touch_updated_at()';
    execute 'drop trigger if exists trg_touch_app_media_featured on public.app_media_featured';
    execute 'create trigger trg_touch_app_media_featured before update on public.app_media_featured
               for each row execute function public.touch_updated_at()';
  end if;
end $t$;

-- phones with Media open read it again at once (app-live-updates.sql); "media" is that page's kind
do $l$ begin
  if to_regprocedure('public.app_refresh_bump()') is not null then
    execute 'drop trigger if exists trg_app_refresh on public.app_media_series';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_media_series '
            'for each statement execute function public.app_refresh_bump(''media'')';
    execute 'drop trigger if exists trg_app_refresh on public.app_media_featured';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_media_featured '
            'for each statement execute function public.app_refresh_bump(''media'')';
  end if;
end $l$;

do $r$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['app_media_series', 'app_media_featured'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
      then execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $r$;

-- The videos the app shows today, so nothing disappears the moment this runs. Until now every
-- published video was in the app's "Featured Videos" section; from now on the Featured switch on
-- Pillar's Watch page decides. This is the church's one published video on 2026-09-17 — a video
-- added between now and running this file just needs its Featured switch turned on in Pillar.
insert into public.app_media_featured (item_id, kind, sort)
values ('1789672414262', 'video', 10)
on conflict (item_id) do nothing;

select (select count(*) from public.app_media_series)   as series,
       (select count(*) from public.app_media_featured) as featured;
