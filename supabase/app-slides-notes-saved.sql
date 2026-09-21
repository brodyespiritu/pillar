-- Three things the app asked for (user, 2026-09-17):
--
--   app_bulletin_slides   the slides shown in the service, for the Digital Bulletin's Slides fold
--   app_sermon_notes      fill-in-the-blank sermon notes the office writes in Pillar; "___" is a blank
--   member_saved          what a member kept: a starred sermon, or their filled-in notes
--
-- The first two are the office's, and read the way every other app table reads: anyone may see them,
-- only active staff may change them. The third belongs to one person, so it is reached ONLY through
-- the functions at the bottom — `app_caller_member_id()` is revoked from `authenticated`, so an RLS
-- policy couldn't call it, and nothing else may touch the table at all.
--
-- Run this in the Supabase SQL editor, AFTER member-app-auth.sql — the member functions at the
-- bottom lean on app_caller_member_id(), which that file defines. Safe to run twice.

/* ── the slides from Sunday ───────────────────────────────────────────────── */

create table if not exists public.app_bulletin_slides (
  id         uuid primary key default gen_random_uuid(),
  image_url  text not null,
  caption    text,
  on_date    date,                      -- the Sunday they belong to; null means "the current one"
  published  boolean not null default false,
  sort       integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_bulletin_slides drop constraint if exists app_bulletin_slides_check;
alter table public.app_bulletin_slides add constraint app_bulletin_slides_check check (
  image_url ~ '^https?://[^[:space:]]+$'
  and (caption is null or char_length(caption) <= 200)
);

/* ── the notes the congregation fills in ──────────────────────────────────── */

create table if not exists public.app_sermon_notes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  speaker    text,
  passage    text,
  on_date    date,
  -- what plays at the top of the split screen: a church video file, a stream or a YouTube link
  video_url  text,
  -- the outline itself. Every "___" is a blank the member taps and types into.
  body       text not null,
  published  boolean not null default false,
  sort       integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_sermon_notes drop constraint if exists app_sermon_notes_check;
alter table public.app_sermon_notes add constraint app_sermon_notes_check check (
  char_length(btrim(title)) between 1 and 120
  and (speaker is null or char_length(speaker) <= 80)
  and (passage is null or char_length(passage) <= 120)
  and (video_url is null or video_url ~ '^https?://[^[:space:]]+$')
  and char_length(body) between 1 and 20000
);

alter table public.app_bulletin_slides enable row level security;
alter table public.app_sermon_notes    enable row level security;

drop policy if exists "public read bulletin slides" on public.app_bulletin_slides;
drop policy if exists "staff write bulletin slides" on public.app_bulletin_slides;
drop policy if exists "public read sermon notes"    on public.app_sermon_notes;
drop policy if exists "staff write sermon notes"    on public.app_sermon_notes;

create policy "public read bulletin slides" on public.app_bulletin_slides
  for select to anon, authenticated using (true);
create policy "staff write bulletin slides" on public.app_bulletin_slides
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

create policy "public read sermon notes" on public.app_sermon_notes
  for select to anon, authenticated using (true);
create policy "staff write sermon notes" on public.app_sermon_notes
  for all to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

/* ── what a member kept ───────────────────────────────────────────────────── */

create table if not exists public.member_saved (
  member_id  uuid not null references public.church_members(id) on delete cascade,
  kind       text not null check (kind in ('sermon', 'notes')),
  ref        text not null check (char_length(ref) between 1 and 200),
  -- a starred sermon keeps its title and picture so the profile can draw it without the app server;
  -- notes keep the answers the member typed, by blank
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, kind, ref)
);

alter table public.member_saved enable row level security;
-- No policy on purpose: nothing reaches this table except the three functions below, which run as
-- the owner and resolve the member from the session themselves.
drop policy if exists "member keeps their own" on public.member_saved;
revoke all on public.member_saved from anon, authenticated;

create or replace function public.member_saved_list(p_kind text default null)
returns table (kind text, ref text, data jsonb, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.kind, s.ref, s.data, s.created_at
    from public.member_saved s
   where s.member_id = (select public.app_caller_member_id())
     and (select public.app_caller_member_id()) is not null
     and (p_kind is null or s.kind = p_kind)
   order by s.created_at desc
   limit 500
$$;

create or replace function public.member_save(p_kind text, p_ref text, p_data jsonb default '{}'::jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid := public.app_caller_member_id();
begin
  if v_id is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_kind not in ('sermon', 'notes') then raise exception 'unknown kind' using errcode = '22023'; end if;
  insert into public.member_saved (member_id, kind, ref, data)
  values (v_id, p_kind, left(btrim(p_ref), 200), coalesce(p_data, '{}'::jsonb))
  on conflict (member_id, kind, ref)
    do update set data = excluded.data, updated_at = now();
end $$;

create or replace function public.member_unsave(p_kind text, p_ref text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid := public.app_caller_member_id();
begin
  if v_id is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.member_saved
   where member_id = v_id and kind = p_kind and ref = left(btrim(p_ref), 200);
end $$;

revoke all on function public.member_saved_list(text), public.member_save(text, text, jsonb),
  public.member_unsave(text, text) from public, anon;
grant execute on function public.member_saved_list(text), public.member_save(text, text, jsonb),
  public.member_unsave(text, text) to authenticated;

/* ── housekeeping the rest of the app already does ────────────────────────── */

do $t$ declare t text; begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    foreach t in array array['app_bulletin_slides', 'app_sermon_notes'] loop
      execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
      execute format('create trigger trg_touch_%1$s before update on public.%1$I
                        for each row execute function public.touch_updated_at()', t);
    end loop;
  end if;
end $t$;

-- phones with that page open read it again at once (app-live-updates.sql). Slides live on the
-- bulletin, which listens for "announcements"; the notes belong with the sermons.
do $l$ begin
  if to_regprocedure('public.app_refresh_bump()') is not null then
    execute 'drop trigger if exists trg_app_refresh on public.app_bulletin_slides';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_bulletin_slides '
            'for each statement execute function public.app_refresh_bump(''announcements'')';
    execute 'drop trigger if exists trg_app_refresh on public.app_sermon_notes';
    execute 'create trigger trg_app_refresh after insert or update or delete or truncate on public.app_sermon_notes '
            'for each statement execute function public.app_refresh_bump(''sermons'')';
  end if;
end $l$;

do $r$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['app_bulletin_slides', 'app_sermon_notes'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
      then execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $r$;

select (select count(*) from public.app_bulletin_slides) as slides,
       (select count(*) from public.app_sermon_notes)    as note_sheets,
       (select count(*) from public.member_saved)        as saved_by_members;
