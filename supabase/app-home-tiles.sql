-- The four boxes on the app's Home page — their words and their pictures, from Pillar
-- (user, 2026-09-17: "allow me the ability to change text and images on the four boxes on homepage").
--
-- The boxes themselves don't change: the first opens the church's latest post, then prayer, then
-- Groups and Ministries, then the Digital Bulletin. What the office writes here is what they SAY.
--
-- This table holds only what has been changed. A slot with no row — or a row with a blank field —
-- leaves the app's own words and picture in place (BethesdaApp components/HomeTiles.js), so the
-- boxes never come up empty.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.app_home_tiles (
  slot       text primary key,
  title      text,
  subtitle   text,
  image_url  text,
  updated_at timestamptz not null default now()
);

alter table public.app_home_tiles drop constraint if exists app_home_tiles_slot_check;
alter table public.app_home_tiles add constraint app_home_tiles_slot_check
  check (slot in ('post', 'prayer', 'connect', 'bulletin'));

alter table public.app_home_tiles drop constraint if exists app_home_tiles_words_check;
-- a box is a word and a short line under it; anything longer is cut off on a phone
alter table public.app_home_tiles add constraint app_home_tiles_words_check check (
  (title    is null or char_length(btrim(title))    between 1 and 24)
  and (subtitle is null or char_length(subtitle)    <= 60)
  and (image_url is null or image_url ~ '^https?://[^[:space:]]+$')
);

alter table public.app_home_tiles enable row level security;

drop policy if exists "public read home tiles" on public.app_home_tiles;
drop policy if exists "staff write home tiles" on public.app_home_tiles;

-- every phone reads them, signed in or out; only active staff change them
create policy "public read home tiles" on public.app_home_tiles
  for select to anon, authenticated using (true);
create policy "staff write home tiles" on public.app_home_tiles
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

do $t$ begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'drop trigger if exists trg_touch_app_home_tiles on public.app_home_tiles';
    execute 'create trigger trg_touch_app_home_tiles before update on public.app_home_tiles
               for each row execute function public.touch_updated_at()';
  end if;
end $t$;

-- phones hear about a change at once (app-live-updates.sql); "home" is the Home page's own kind
do $l$ begin
  if to_regprocedure('public.app_refresh_bump()') is not null then
    execute 'drop trigger if exists trg_app_refresh on public.app_home_tiles';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_home_tiles '
            'for each statement execute function public.app_refresh_bump(''home'')';
  end if;
end $l$;

do $r$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_home_tiles')
  then
    execute 'alter publication supabase_realtime add table public.app_home_tiles';
  end if;
end $r$;

-- Nothing is seeded: an empty table means the app's own words, which is exactly how Home reads today.
select slot, title, subtitle, image_url is not null as has_picture from public.app_home_tiles order by slot;
