-- ============================================================
--  PILLAR · EVENT LOCATIONS (rooms & spaces, with photos)
--  Run this in Supabase → SQL Editor
-- ============================================================
--
-- events.location stays a plain text NAME — deliberately not a foreign key.
-- Hundreds of existing events have blank or free-text locations, and the
-- church website reads events straight over PostgREST; keeping the name as
-- text means zero migration and nothing downstream breaks while this lands.
-- Store names exactly as they should read to a human.

create table if not exists locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,      -- 'Lyn Class', 'Sanctuary', 'Soccer Field'
  photo_url  text,                      -- public URL, nullable
  notes      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_locations_name on locations(name);

alter table locations enable row level security;

drop policy if exists "staff read locations"  on locations;
drop policy if exists "staff write locations" on locations;
drop policy if exists "public read locations" on locations;

create policy "staff read locations"  on locations for select using (auth.role() = 'authenticated');
create policy "staff write locations" on locations for all    using (auth.role() = 'authenticated');

-- The public church website is a static page with no auth. Without this it
-- gets back a 200 with an empty array rather than an error, so a missing
-- policy looks like "no photos" instead of a permissions problem.
create policy "public read locations" on locations
  for select to anon using (true);

drop trigger if exists trg_touch_locations on locations;
create trigger trg_touch_locations before update on locations
  for each row execute function touch_updated_at();

-- ── Seed from the locations events already use ─────────────
-- Every distinct non-blank events.location, so no existing event points at a
-- location that isn't in the table. Plus Lyn Class, which has a photo ready.
insert into locations (name)
select distinct trim(location) from events
where location is not null and trim(location) <> ''
union select 'Lyn Class'
on conflict (name) do nothing;

-- ── Photo storage ──────────────────────────────────────────
-- Public bucket: the website loads these <img> src directly and cannot sign URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('location-photos', 'location-photos', true, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read location photos"   on storage.objects;
drop policy if exists "staff upload location photos"  on storage.objects;
drop policy if exists "staff update location photos"  on storage.objects;
drop policy if exists "staff delete location photos"  on storage.objects;

create policy "public read location photos" on storage.objects
  for select using (bucket_id = 'location-photos');

create policy "staff upload location photos" on storage.objects
  for insert with check (bucket_id = 'location-photos' and auth.role() = 'authenticated');

create policy "staff update location photos" on storage.objects
  for update using (bucket_id = 'location-photos' and auth.role() = 'authenticated');

create policy "staff delete location photos" on storage.objects
  for delete using (bucket_id = 'location-photos' and auth.role() = 'authenticated');

-- Check:
--   select name, photo_url from locations order by name;
--   select id, public from storage.buckets where id = 'location-photos';
