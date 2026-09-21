-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

-- ═══════════════════════════════════════════════════════════════════════════
--  Website content — one row per page of bethesdabaptist's public website.
--
--  WHY SUPABASE AND NOT THE RENDER API: the website's other editable data
--  (events, locations) already comes from this project, and the site reads it
--  with the anon key + RLS exactly like this. The older Render admin API is
--  NOT an option — its PUT/POST endpoints return 401 and no key has been
--  issued, so anything written through it is silently lost.
--
--  SHAPE: `content` is JSONB rather than a wide column-per-field table. The
--  website's layout changes often; a JSON blob means adding a field to the
--  editor never needs a migration. The editor owns the schema, this table just
--  stores it.
--
--  Run this once in the Supabase SQL editor. It is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.website_content (
  page        text primary key,              -- 'home', 'about', 'give', …
  content     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

comment on table public.website_content is
  'Editable copy and image URLs for the public website, one row per page. Edited in Pillar under Website.';

-- keep updated_at honest without the client having to remember
create or replace function public.website_content_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists website_content_touch on public.website_content;
create trigger website_content_touch
  before insert or update on public.website_content
  for each row execute function public.website_content_touch();

-- ── Row-level security ─────────────────────────────────────────────────────
-- Read is public on purpose: the live website is anonymous and fetches this
-- with the anon key. Writes are restricted to signed-in Pillar users.
alter table public.website_content enable row level security;

drop policy if exists "website_content public read"   on public.website_content;
drop policy if exists "website_content authed write"  on public.website_content;
drop policy if exists "website_content authed update" on public.website_content;

create policy "website_content public read"
  on public.website_content for select
  to anon, authenticated
  using (true);

create policy "website_content authed write"
  on public.website_content for insert
  to authenticated
  with check ((select public.is_active_staff()));

create policy "website_content authed update"
  on public.website_content for update
  to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- ── Image bucket ───────────────────────────────────────────────────────────
-- Public so the static site can hotlink the URLs with no token. Uploads are
-- downscaled client-side before they land here (see uploadWebsiteImage).
insert into storage.buckets (id, name, public)
values ('website-images', 'website-images', true)
on conflict (id) do update set public = true;

drop policy if exists "website images public read" on storage.objects;
drop policy if exists "website images authed write" on storage.objects;
drop policy if exists "website images authed delete" on storage.objects;

create policy "website images public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'website-images');

create policy "website images authed write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'website-images' and (select public.is_active_staff()));

create policy "website images authed delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'website-images' and (select public.is_active_staff()));

-- Seed the home row so the editor has something to load on first open.
insert into public.website_content (page, content)
values ('home', '{}'::jsonb)
on conflict (page) do nothing;
