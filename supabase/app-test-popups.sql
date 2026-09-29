-- The update popup: Pillar → App → Notifications → Update popup (user, 2026-09-24: "allow me to post a
-- popup card to all users that looks like the give popup. I should be able to type anything, have bullet
-- points, dashes, bold font, italics, underline, etc." … "It needs to be orange, similar to the orange
-- background in settings, so people know its a temp popup with recent updates").
--
-- TESTING · goes when the app's test kit does (BethesdaApp components/testkit/UpdatePopup.js).
--
-- One popup is up at a time. It's a one-time card: every phone with the app shows each popup once (it
-- remembers which it has shown, by id — user, 2026-09-24: "It should only be a one time pop up for the
-- users"), in the test kit's orange. Posting a new one takes the old one down; editing the one that's up
-- changes it where it is, so phones that have already shown it don't show it again.
--
-- The words are a small document, not HTML ({ v: 1, blocks: [{ t, s: [{ x, b, i, u, k }] }] } —
-- Pillar src/lib/testPopups.js writes it, the app's components/testkit/RichText.js draws it).
--
-- Run once in the Supabase SQL Editor; safe to run again. Needs member-app-auth.sql (is_active_staff,
-- the staff table) and app-live-updates.sql (the 'popup' signal that brings it to open phones at once).

create table if not exists public.app_test_popups (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 1 and 80),
  body          jsonb not null check (
                  jsonb_typeof(body) = 'object'
                  and jsonb_typeof(body -> 'blocks') = 'array'
                  and jsonb_array_length(body -> 'blocks') between 1 and 400
                  and octet_length(body::text) <= 40000),
  live          boolean not null default false,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz,
  taken_down_at timestamptz,
  created_by    uuid references public.staff(id) on delete set null
);
-- never two up at once
create unique index if not exists app_test_popups_one_live on public.app_test_popups ((live)) where live;

-- anyone (the app, signed in or not) reads the one that's up; staff read them all; nobody writes to the
-- table directly — every write goes through the functions below
alter table public.app_test_popups enable row level security;
revoke all on public.app_test_popups from anon, authenticated;
grant select on public.app_test_popups to anon, authenticated;
drop policy if exists "anyone reads the popup that is up" on public.app_test_popups;
create policy "anyone reads the popup that is up" on public.app_test_popups for select using (live);
drop policy if exists "staff read every popup" on public.app_test_popups;
create policy "staff read every popup" on public.app_test_popups for select using ((select public.is_active_staff()));

-- the 'popup' signal: open phones look the moment one is posted, changed or taken down (app-live-updates.sql
-- and app-report-replies.sql list it too, so re-running any of the three keeps it)
do $$
begin
  if to_regclass('public.app_refresh') is not null then
    alter table public.app_refresh drop constraint if exists app_refresh_part_check;
    alter table public.app_refresh add constraint app_refresh_part_check
      check (part in ('home', 'announcements', 'calendar', 'groups', 'sermons', 'media', 'live', 'replies', 'popup', 'directory'));
    insert into public.app_refresh (part) values ('popup') on conflict (part) do nothing;
  end if;
end $$;

create or replace function public.app_test_popup_signal()
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  insert into public.app_refresh (part, at) values ('popup', now())
  on conflict (part) do update set at = now();
exception when undefined_table or check_violation then
  null;   -- no live signal yet: phones find it the next time they open the app
end $$;
revoke all on function public.app_test_popup_signal() from public, anon, authenticated;

-- the words, checked the way Pillar checks them: a title, and a document with words in it
create or replace function public.app_test_popup_check(p_title text, p_body jsonb)
returns void language plpgsql immutable set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'Give it a title first.' using errcode = '22023';
  end if;
  if char_length(btrim(p_title)) > 80 then
    raise exception 'Keep the title under 80 characters.' using errcode = '22023';
  end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' or jsonb_typeof(p_body -> 'blocks') <> 'array'
     or jsonb_array_length(p_body -> 'blocks') = 0 then
    raise exception 'Write what’s new first.' using errcode = '22023';
  end if;
  if octet_length(p_body::text) > 40000 then
    raise exception 'Keep it under 3,000 characters.' using errcode = '22023';
  end if;
end $$;

-- Pillar: put a new one up on every phone, in place of whatever was up
create or replace function public.app_test_popup_post(p_title text, p_body jsonb)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'Only church staff can post the update popup.' using errcode = '42501';
  end if;
  perform public.app_test_popup_check(p_title, p_body);
  update public.app_test_popups set live = false, taken_down_at = now() where live;
  insert into public.app_test_popups (title, body, live, posted_at, created_by)
  values (btrim(p_title), p_body, true, now(), (select s.id from public.staff s where s.id = auth.uid()))
  returning id into v_id;
  perform public.app_test_popup_signal();
  return v_id;
end $$;

-- Pillar: change the one that's up, where it is (a typo): phones that have shown it don't show it again
create or replace function public.app_test_popup_edit(p_id uuid, p_title text, p_body jsonb)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Only church staff can change the update popup.' using errcode = '42501';
  end if;
  perform public.app_test_popup_check(p_title, p_body);
  update public.app_test_popups set title = btrim(p_title), body = p_body where id = p_id and live;
  if not found then
    raise exception 'That popup isn’t up any more.' using errcode = 'P0002';
  end if;
  perform public.app_test_popup_signal();
end $$;

-- Pillar: off every phone
create or replace function public.app_test_popup_take_down()
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Only church staff can take the update popup down.' using errcode = '42501';
  end if;
  update public.app_test_popups set live = false, taken_down_at = now() where live;
  perform public.app_test_popup_signal();
end $$;

-- Pillar's Undo, just after taking one down: the same popup back up — phones that had shown it don't
-- see it again (they remember it by its id), the rest still get it
create or replace function public.app_test_popup_restore(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Only church staff can put the update popup back.' using errcode = '42501';
  end if;
  if exists (select 1 from public.app_test_popups where live and id <> p_id) then
    raise exception 'Another popup is up now — take it down first.' using errcode = 'P0001';
  end if;
  update public.app_test_popups set live = true, taken_down_at = null where id = p_id;
  if not found then
    raise exception 'That popup isn’t there any more.' using errcode = 'P0002';
  end if;
  perform public.app_test_popup_signal();
end $$;

revoke all on function public.app_test_popup_post(text, jsonb), public.app_test_popup_edit(uuid, text, jsonb),
  public.app_test_popup_take_down(), public.app_test_popup_restore(uuid), public.app_test_popup_check(text, jsonb) from public, anon;
grant execute on function public.app_test_popup_post(text, jsonb), public.app_test_popup_edit(uuid, text, jsonb),
  public.app_test_popup_take_down(), public.app_test_popup_restore(uuid) to authenticated;
