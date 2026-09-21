-- The cards under the four boxes on the app's Home page — chosen, written and ordered from Pillar,
-- and on members' phones the moment they are saved (user, 2026-09-17: "choose what kind of
-- horizontal card goes below the four boxes… picture with title, video, etc… add buttons").
--
-- Run this in the Supabase SQL editor. Safe to run twice.
--
-- It seeds the two cards Home shows today (the Wednesday plate card for signed-in members, the
-- welcome card for everyone else), so the app looks exactly the same until the office changes it.

-- ── The buttons a card may carry ────────────────────────────────────────────────────────────
-- A closed set, so a button can never do something the app does not know how to do:
--   url    open a web address                 { "label", "action": "url",   "target": "https://…" }
--   page   open one of the app's own pages    { "label", "action": "page",  "target": "Bulletin" }
--   plate  reserve a Wednesday dinner plate   { "label", "action": "plate" }
--   video  play this card's video             { "label", "action": "video" }
-- At most two. A CHECK can't hold a subquery, so the rule lives in an immutable function.
create or replace function public.app_home_buttons_ok(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(v) = 'array'
     and jsonb_array_length(v) <= 2
     and not exists (
       select 1 from jsonb_array_elements(v) b
        where jsonb_typeof(b) <> 'object'
           or coalesce(btrim(b ->> 'label'), '') = ''
           or char_length(b ->> 'label') > 24
           or coalesce(b ->> 'action', '') not in ('url', 'page', 'plate', 'video')
           or (b ->> 'action' = 'url'  and coalesce(b ->> 'target', '') !~ '^https?://[^[:space:]]+$')
           or (b ->> 'action' = 'page' and coalesce(b ->> 'target', '') not in
                 ('Bulletin', 'Groups', 'Calendar', 'Directory', 'Bible', 'Sermons', 'Give', 'Profile'))
     )
$$;

create table if not exists public.app_home_cards (
  id          uuid primary key default gen_random_uuid(),

  -- what the card is:
  --   image    a photograph with a title (and a line under it) laid over it
  --   video    a video's picture with a play button; tapping plays it in the app
  --   text     words only — a title, a paragraph, and its buttons
  --   dinner   the app's own Wednesday plate card, live from the dinner RSVP
  --   welcome  the app's own "Welcome to the new Bethesda App" card
  kind        text not null check (kind in ('image', 'video', 'text', 'dinner', 'welcome')),

  -- who sees it
  audience    text not null default 'everyone'
              check (audience in ('everyone', 'signed_in', 'signed_out')),

  kicker      text check (kicker   is null or char_length(kicker)   <= 40),    -- small line above the title
  title       text check (title    is null or char_length(title)    <= 80),
  subtitle    text check (subtitle is null or char_length(subtitle) <= 160),
  body        text check (body     is null or char_length(body)     <= 600),

  image_url   text check (image_url is null or image_url ~ '^https?://[^[:space:]]+$'),
  video_url   text check (video_url is null or video_url ~ '^https?://[^[:space:]]+$'),

  buttons     jsonb not null default '[]'::jsonb,

  starts_on   date,
  ends_on     date,
  published   boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint app_home_cards_window check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

-- A card on phones has what its kind needs to be drawn. A draft may be half-written: Pillar saves as
-- the office types, and phones never see drafts. (Replaced on every run, so an older, stricter
-- version of this rule is loosened too.)
alter table public.app_home_cards drop constraint if exists app_home_cards_complete;
alter table public.app_home_cards add constraint app_home_cards_complete check (
  not published or case kind
    when 'image' then image_url is not null and coalesce(btrim(title), '') <> ''
    when 'video' then video_url is not null and coalesce(btrim(title), '') <> ''
    when 'text'  then coalesce(btrim(title), '') <> ''
    else true
  end
);

alter table public.app_home_cards drop constraint if exists app_home_cards_buttons_check;
alter table public.app_home_cards add constraint app_home_cards_buttons_check
  check (public.app_home_buttons_ok(buttons));

create index if not exists app_home_cards_order_idx on public.app_home_cards (published, sort, created_at);

alter table public.app_home_cards enable row level security;

drop policy if exists "staff read home cards"  on public.app_home_cards;
drop policy if exists "staff write home cards" on public.app_home_cards;
drop policy if exists "public read home cards" on public.app_home_cards;

create policy "staff read home cards"  on public.app_home_cards
  for select using ((select public.is_active_staff()));
create policy "staff write home cards" on public.app_home_cards
  for all    using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- The church's own date. A card "shown until Sunday" stays up all of Sunday in Georgia, instead of
-- disappearing at the database's midnight (UTC — 8 pm there).
create or replace function public.church_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/New_York')::date
$$;

-- Members read these signed in AND signed out: a signed-in phone reads with its member session
-- (the `authenticated` role), so `anon` alone would hide the cards from exactly the people they are
-- for. Only published cards inside their window ever leave the database.
create policy "public read home cards" on public.app_home_cards
  for select to anon, authenticated
  using (
    published
    and (starts_on is null or starts_on <= (select public.church_today()))
    and (ends_on   is null or ends_on   >= (select public.church_today()))
  );

do $t$ begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'drop trigger if exists trg_touch_app_home_cards on public.app_home_cards';
    execute 'create trigger trg_touch_app_home_cards before update on public.app_home_cards
               for each row execute function public.touch_updated_at()';
  end if;
end $t$;

-- ── "Instantly": phones listening for changes ────────────────────────────────────────────────
-- The app subscribes to this table while Home is open, so a save in Pillar reaches it without a
-- refresh. Realtime still applies the read policy above, per phone.
do $r$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_home_cards')
  then
    execute 'alter publication supabase_realtime add table public.app_home_cards';
  end if;
end $r$;

-- If app-live-updates.sql has already run, join it: a change here tells open phones at once.
-- (Run after this file, it does the same.)
do $l$ begin
  if to_regprocedure('public.app_refresh_bump()') is not null then
    execute 'drop trigger if exists trg_app_refresh on public.app_home_cards';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_home_cards '
            'for each statement execute function public.app_refresh_bump(''home'')';
  end if;
end $l$;

-- ── Pictures for the cards ───────────────────────────────────────────────────────────────────
-- Public, because the app loads them straight into <Image>; only active staff can add or change one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-media', 'app-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read app media"   on storage.objects;
drop policy if exists "staff upload app media"  on storage.objects;
drop policy if exists "staff update app media"  on storage.objects;
drop policy if exists "staff delete app media"  on storage.objects;

create policy "public read app media" on storage.objects
  for select using (bucket_id = 'app-media');
create policy "staff upload app media" on storage.objects
  for insert with check (bucket_id = 'app-media' and (select public.is_active_staff()));
create policy "staff update app media" on storage.objects
  for update using (bucket_id = 'app-media' and (select public.is_active_staff()));
create policy "staff delete app media" on storage.objects
  for delete using (bucket_id = 'app-media' and (select public.is_active_staff()));

-- ── What Home shows today, so nothing changes until the office changes it ─────────────────────
insert into public.app_home_cards (kind, audience, sort)
select v.kind, v.audience, v.sort
  from (values
    ('dinner',  'signed_in',  10),
    ('welcome', 'signed_out', 20)
  ) as v(kind, audience, sort)
 where not exists (select 1 from public.app_home_cards);

select sort, kind, audience, title, published from public.app_home_cards order by sort;
