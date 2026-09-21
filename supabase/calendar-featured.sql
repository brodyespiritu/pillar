-- Featured events: the big cards under "What's Happening" on the app's Home page
-- (user, 2026-09-17: "when creating an event, allow option to make it a 'featured' event with a
-- toggle… featured calendar events become the large horizontal cards under what's happening").
--
-- Two columns on the calendar's own events:
--   featured    the office ticked it in the event wizard
--   image_url   the picture for its card. Optional — without one the app falls back to the room's
--               photo, then the church photo, exactly as it does now.
--
-- Reading is unchanged: the public policy is per row (church calendar, not private), so these
-- columns follow the event they belong to. A featured PRIVATE event still reaches nobody.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

alter table public.events add column if not exists featured  boolean not null default false;
alter table public.events add column if not exists image_url text;

alter table public.events drop constraint if exists events_image_url_check;
alter table public.events add constraint events_image_url_check
  check (image_url is null or image_url ~ '^https?://[^[:space:]]+$');

-- the app asks for the next couple of months of church events, newest rules first
create index if not exists events_featured_idx on public.events (featured, start_date)
  where featured;

-- Phones already hear about calendar changes (app-live-updates.sql puts a trigger on this table).
select count(*) filter (where featured) as featured_now,
       count(*) filter (where featured and image_url is not null) as with_a_picture,
       count(*) as events
  from public.events;
