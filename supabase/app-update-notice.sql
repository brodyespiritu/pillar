-- ============================================================
--  PILLAR · MEMBER APP — "Update needed"
--  (user, 2026-09-23: "I want the ability to post a 'Update Needed' card (just like the give popup)
--  that forces the user to click a button and it directs them … to update the app")
--
--  One row per platform. While a row is switched on, a phone running an OLDER build than `min_build`
--  gets a card it can't close, with one button that opens `link`:
--    iPhone  — the TestFlight app while testing (itms-beta://), the App Store after launch
--    Android — the newest APK while testing, the Play Store after launch
--  Phones on `min_build` or newer never see it. Pillar sets it in App → Settings → Update needed;
--  open phones pick a change up within a second or two (it signals 'home', app-live-updates.sql).
--
--  Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.app_update_notice (
  platform   text primary key,
  active     boolean not null default false,
  min_build  integer,
  link       text,
  message    text,
  updated_at timestamptz not null default now()
);
alter table public.app_update_notice drop constraint if exists app_update_notice_platform_check;
alter table public.app_update_notice add constraint app_update_notice_platform_check
  check (platform in ('ios', 'android'));
alter table public.app_update_notice drop constraint if exists app_update_notice_build_check;
alter table public.app_update_notice add constraint app_update_notice_build_check
  check (min_build is null or min_build between 1 and 100000);
-- only the addresses a phone can open to update itself: the web, TestFlight, the App Store, the Play Store
alter table public.app_update_notice drop constraint if exists app_update_notice_link_check;
alter table public.app_update_notice add constraint app_update_notice_link_check
  check (link is null or link ~ '^(itms-beta://[^[:space:]]*|(https|itms-apps|market)://[^[:space:]]+)$');
alter table public.app_update_notice drop constraint if exists app_update_notice_message_check;
alter table public.app_update_notice add constraint app_update_notice_message_check
  check (message is null or char_length(message) <= 200);
-- switched on means it has everything it needs: a build to measure against and somewhere to send them
alter table public.app_update_notice drop constraint if exists app_update_notice_ready_check;
alter table public.app_update_notice add constraint app_update_notice_ready_check
  check (not active or (min_build is not null and link is not null));

-- every phone reads it (signed in or not — an old build must be told whoever holds it); only active staff change it
alter table public.app_update_notice enable row level security;
drop policy if exists "public read update notice" on public.app_update_notice;
drop policy if exists "staff write update notice" on public.app_update_notice;
create policy "public read update notice" on public.app_update_notice
  for select to anon, authenticated using (true);
create policy "staff write update notice" on public.app_update_notice
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

do $t$ begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'drop trigger if exists trg_touch_app_update_notice on public.app_update_notice';
    execute 'create trigger trg_touch_app_update_notice before update on public.app_update_notice
               for each row execute function public.touch_updated_at()';
  end if;
end $t$;

-- a save reaches open phones within a second or two (app-live-updates.sql)
do $l$ begin
  if to_regprocedure('public.app_refresh_bump()') is not null then
    execute 'drop trigger if exists trg_app_refresh on public.app_update_notice';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_update_notice '
            'for each statement execute function public.app_refresh_bump(''home'')';
  end if;
end $l$;

select platform, active, min_build, link from public.app_update_notice order by platform;
