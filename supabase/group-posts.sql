-- Announcements for the groups and ministries — the cards a member swipes through on the
-- "Groups and Ministries" page, under the filters.
--
-- These are NOT calendar events (user, 2026-09-16: "meant for group and ministry announcements
-- instead of upcoming events"). The office types whatever it wants to say — a supper, a sign-up, a
-- change of room, a thank-you — and may put one button on the card.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.group_posts (
  id           uuid primary key default gen_random_uuid(),

  -- which group or ministry it belongs to. Null means it is for everyone, and it shows whatever
  -- the member has filtered to.
  group_id     uuid references public.church_groups(id) on delete cascade,

  title        text not null check (char_length(btrim(title)) between 1 and 80),
  body         text check (body is null or char_length(body) <= 600),

  -- one optional button. A label with nowhere to go is meaningless, so the pair is enforced below,
  -- and the link must be a real web address — the app refuses to open anything else.
  button_label text check (button_label is null or char_length(btrim(button_label)) between 1 and 30),
  button_url   text check (button_url is null or button_url ~ '^https?://[^ ]+$'),

  -- optional window. Outside it the card is not shown; both null means "show it until I take it down".
  starts_on    date,
  ends_on      date,

  published    boolean not null default true,
  sort         integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint group_posts_button_pair check (button_label is null or button_url is not null),
  constraint group_posts_window      check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index if not exists group_posts_order_idx on public.group_posts (published, sort, created_at desc);

alter table public.group_posts enable row level security;

drop policy if exists "staff read posts"  on public.group_posts;
drop policy if exists "staff write posts" on public.group_posts;
drop policy if exists "public read posts" on public.group_posts;

create policy "staff read posts"  on public.group_posts
  for select using ((select public.is_active_staff()));
create policy "staff write posts" on public.group_posts
  for all    using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- The church's own date. A card "shown until Sunday" stays up all of Sunday in Georgia, instead of
-- disappearing at the database's midnight (UTC — 8 pm there).
create or replace function public.church_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/New_York')::date
$$;

-- The app reads this with the public anon key, like the groups themselves. Only PUBLISHED posts
-- leave the database, and only inside their window — an unpublished or expired one is the office's
-- and stays theirs.
create policy "public read posts" on public.group_posts
  for select to anon
  using (
    published
    and (starts_on is null or starts_on <= (select public.church_today()))
    and (ends_on   is null or ends_on   >= (select public.church_today()))
  );

do $t$ begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'drop trigger if exists trg_touch_group_posts on public.group_posts';
    execute 'create trigger trg_touch_group_posts before update on public.group_posts
               for each row execute function public.touch_updated_at()';
  end if;
end $t$;

-- If app-live-updates.sql has already run, join it: a change here tells open phones at once.
-- (Run after this file, it does the same.)
do $l$ begin
  if to_regprocedure('public.app_refresh_bump()') is not null then
    execute 'drop trigger if exists trg_app_refresh on public.group_posts';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.group_posts '
            'for each statement execute function public.app_refresh_bump(''groups'')';
  end if;
end $l$;

-- Nothing is seeded: every word on these cards is the church's. For example —
--
--   insert into public.group_posts (group_id, title, body, button_label, button_url, sort)
--   select id, 'REPLACE — headline', 'REPLACE — what you want to say',
--          'REPLACE — button', 'https://REPLACE', 10
--     from public.church_groups where filter_key = 'women';

select p.sort, g.name as group, p.title, p.button_label, p.published
  from public.group_posts p
  left join public.church_groups g on g.id = p.group_id
 order by p.sort, p.created_at desc;
