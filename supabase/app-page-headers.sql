-- ============================================================
--  PILLAR · MEMBER APP — the photos at the top of the app's pages
--  (user, 2026-09-21: "allow me to change the images in directory and other headers")
--
--  One row per page that wears a photo header: Home (the big photo at the top), Directory, and Groups
--  and Ministries. A page with no row — or a row with no picture — keeps the app's own photo. Pillar
--  sets them in App → Settings → Page photos; open phones pick a change up within a second or two
--  (it signals 'home' through app-live-updates.sql, which the app listens to for these).
--
--  Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.app_page_headers (
  page       text primary key,
  image_url  text,
  updated_at timestamptz not null default now()
);
alter table public.app_page_headers drop constraint if exists app_page_headers_page_check;
alter table public.app_page_headers add constraint app_page_headers_page_check
  check (page in ('home', 'directory', 'groups'));
alter table public.app_page_headers drop constraint if exists app_page_headers_image_check;
alter table public.app_page_headers add constraint app_page_headers_image_check
  check (image_url is null or image_url ~ '^https://[^[:space:]]+$');

-- everyone reads them (phones signed in and out); only active staff change them
alter table public.app_page_headers enable row level security;
drop policy if exists "public read page headers" on public.app_page_headers;
drop policy if exists "staff write page headers" on public.app_page_headers;
create policy "public read page headers" on public.app_page_headers
  for select to anon, authenticated using (true);
create policy "staff write page headers" on public.app_page_headers
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

do $t$ begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'drop trigger if exists trg_touch_app_page_headers on public.app_page_headers';
    execute 'create trigger trg_touch_app_page_headers before update on public.app_page_headers
               for each row execute function public.touch_updated_at()';
  end if;
end $t$;

-- "Changes reach open phones within a second or two": a save signals 'home' (app-live-updates.sql)
do $l$ begin
  if to_regprocedure('public.app_refresh_bump()') is not null then
    execute 'drop trigger if exists trg_app_refresh on public.app_page_headers';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_page_headers '
            'for each statement execute function public.app_refresh_bump(''home'')';
  end if;
end $l$;

select page, image_url is not null as has_photo from public.app_page_headers order by page;
