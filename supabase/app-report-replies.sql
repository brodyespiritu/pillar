-- Replies to testers' reports: Pillar Home → a report → Implemented (user, 2026-09-23: "when I click on a
-- reported bug, add a third button that says, 'Implemented' … When clicked, a type box pops up and I can
-- type what was implemented in the app. Then, on that exact user who submitted the bug, a card should pop
-- up just like the giving card that their bug has been fixed or idea has been implemented").
--
-- TESTING · goes when the app's test kit does (BethesdaApp components/testkit/).
--
-- A report — a row in member_access_requests, sent by the test kit — carries the sending phone's reply
-- code ("Reply code: …" in its message). Implemented keeps the office's words against a SHA-256 of that
-- code and closes the report out; the phone asks for its replies with the code itself
-- (components/testkit/replies.js). So a reply reaches the phone that sent the report and no other, and
-- this table never holds a code anyone could ask with.
--
-- Run once in the Supabase SQL Editor; safe to run again. Needs member-app-auth.sql (the reports table,
-- is_active_staff) and app-live-updates.sql (the 'replies' signal that makes the card appear at once).

create table if not exists public.app_report_replies (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid references public.member_access_requests(id) on delete set null,
  code_hash   text not null,
  kind        text not null default 'fixed' check (kind in ('fixed', 'added')),   -- a bug fixed / an idea added
  said        text check (said is null or char_length(said) <= 300),            -- what the tester wrote, for the card
  message     text not null check (char_length(message) between 1 and 600),     -- what the office wrote back
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff(id) on delete set null,
  seen_at     timestamptz                                                        -- the tester pressed Got it
);
create index if not exists app_report_replies_waiting on public.app_report_replies (code_hash) where seen_at is null;

-- staff read them; nobody writes to the table directly — every write goes through the functions below
alter table public.app_report_replies enable row level security;
revoke all on public.app_report_replies from anon, authenticated;
grant select on public.app_report_replies to authenticated;
drop policy if exists "staff read report replies" on public.app_report_replies;
create policy "staff read report replies" on public.app_report_replies
  for select using ((select public.is_active_staff()));

-- the 'replies' signal: open phones look for their card the moment one is sent (app-live-updates.sql
-- lists it too, so re-running that file keeps it)
do $$
begin
  if to_regclass('public.app_refresh') is not null then
    alter table public.app_refresh drop constraint if exists app_refresh_part_check;
    alter table public.app_refresh add constraint app_refresh_part_check
      check (part in ('home', 'announcements', 'calendar', 'groups', 'sermons', 'media', 'live', 'replies', 'popup', 'directory'));
    insert into public.app_refresh (part) values ('replies') on conflict (part) do nothing;
  end if;
end $$;

-- Pillar: answer one report and close it out. `p_kind` 'fixed' (a bug) or 'added' (an idea); `p_said`
-- is what the tester wrote, shown back to them so they know which report it answers.
create or replace function public.app_report_reply(p_request uuid, p_message text, p_kind text default 'fixed', p_said text default null)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_msg  text := btrim(coalesce(p_message, ''));
  v_body text;
  v_code text;
  v_id   uuid;
begin
  if not public.is_active_staff() then
    raise exception 'Only church staff can answer a report.' using errcode = '42501';
  end if;
  if v_msg = '' then
    raise exception 'Write what changed first.' using errcode = '22023';
  end if;
  if char_length(v_msg) > 600 then
    raise exception 'Keep it under 600 characters.' using errcode = '22023';
  end if;

  select r.message into v_body from public.member_access_requests r where r.id = p_request for update;
  if not found then
    raise exception 'That report isn''t there any more.' using errcode = 'P0002';
  end if;
  v_code := substring(coalesce(v_body, '') from 'Reply code: ([A-Za-z0-9_-]{16,64})');
  if v_code is null then
    raise exception 'This report came from an older version of the app, so a reply can''t reach their phone.' using errcode = 'P0001';
  end if;

  insert into public.app_report_replies (request_id, code_hash, kind, said, message, created_by)
  values (p_request,
          encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
          case when p_kind = 'added' then 'added' else 'fixed' end,
          nullif(left(btrim(coalesce(p_said, '')), 300), ''),
          v_msg,
          (select s.id from public.staff s where s.id = auth.uid()))
  returning id into v_id;

  update public.member_access_requests
     set handled_at = now(), handled_by = (select s.id from public.staff s where s.id = auth.uid())
   where id = p_request;

  begin
    insert into public.app_refresh (part, at) values ('replies', now())
    on conflict (part) do update set at = now();
  exception when undefined_table or check_violation then
    null;   -- no live signal yet: phones find it the next time they open the app
  end;
  return v_id;
end $$;
revoke all on function public.app_report_reply(uuid, text, text, text) from public, anon;
grant execute on function public.app_report_reply(uuid, text, text, text) to authenticated;

-- the phone: its replies not seen yet, oldest first
create or replace function public.app_report_replies_for(p_code text)
returns table (id uuid, kind text, said text, message text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.kind, r.said, r.message, r.created_at
    from public.app_report_replies r
   where p_code ~ '^[A-Za-z0-9_-]{16,64}$'
     and r.code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
     and r.seen_at is null
   order by r.created_at
   limit 20;
$$;
revoke all on function public.app_report_replies_for(text) from public;
grant execute on function public.app_report_replies_for(text) to anon, authenticated;

-- the phone: Got it
create or replace function public.app_report_reply_seen(p_code text, p_id uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.app_report_replies r
     set seen_at = now()
   where r.id = p_id
     and r.seen_at is null
     and p_code ~ '^[A-Za-z0-9_-]{16,64}$'
     and r.code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
$$;
revoke all on function public.app_report_reply_seen(text, uuid) from public;
grant execute on function public.app_report_reply_seen(text, uuid) to anon, authenticated;
