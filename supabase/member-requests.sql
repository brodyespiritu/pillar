-- ============================================================
--  PILLAR · MEMBER APP — requests from a member's own profile
--  (user, 2026-09-21)
--
--  · Request a change — the member edits their details right in Edit Profile (name, email, mobile)
--    and/or picks a new photo, then Submit to office. Pillar shows each change as old → new and one
--    Approve puts them on the record; until then the member sees "Updating…" (user, 2026-09-21: "allow
--    user to edit within the field then hit submit to office").
--  · Request deletion — why they'd like their app account deleted, for the church office.
--
--  Both arrive in Pillar (Home → Member requests). Members never read or write the table themselves:
--  only member_request() and member_open_requests() below, which know who is asking.
--
--  Run in Supabase → SQL Editor, AFTER member-app-auth.sql. Safe to re-run.
-- ============================================================

create table if not exists public.member_requests (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.church_members(id) on delete cascade,
  kind        text not null check (kind in ('change', 'delete')),
  message     text check (message is null or char_length(message) between 1 and 1000),
  -- what they typed over their details: { name?, email?, phone? }, only what they changed
  changes     jsonb check (changes is null or (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb
                           and not (changes - array['name', 'email', 'phone']::text[] <> '{}'::jsonb))),
  -- a 400×400 JPEG made on the phone, kept the way the directory keeps photos (a data URL)
  photo       text check (photo is null
                          or (photo ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$' and char_length(photo) <= 600000)),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references public.staff(id) on delete set null,
  outcome     text check (outcome is null or outcome in ('approved', 'done', 'declined')),
  constraint member_requests_photo_is_a_change check (kind = 'change' or (photo is null and changes is null)),
  constraint member_requests_not_empty check (message is not null or photo is not null or changes is not null)
);
create index if not exists member_requests_waiting on public.member_requests (created_at) where handled_at is null;

alter table public.member_requests enable row level security;
revoke all on public.member_requests from anon;
drop policy if exists "staff read member requests"   on public.member_requests;
drop policy if exists "staff handle member requests" on public.member_requests;
create policy "staff read member requests" on public.member_requests
  for select using ((select public.is_active_staff()));
create policy "staff handle member requests" on public.member_requests
  for update using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- What the signed-in member has waiting: { change, delete }. "Updating…" in the app while `change` is.
create or replace function public.member_open_requests()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'change', exists (select 1 from public.member_requests r
                       where r.member_id = public.app_caller_member_id() and r.kind = 'change' and r.handled_at is null),
    'delete', exists (select 1 from public.member_requests r
                       where r.member_id = public.app_caller_member_id() and r.kind = 'delete' and r.handled_at is null))
$$;

-- The signed-in member asks for a change (their edited details and/or a photo, maybe a note) or for
-- their account to be deleted (the reason). Only name, email and mobile go through here — members save
-- their own address. Five waiting at once is plenty; the sixth is refused until the office catches up.
drop function if exists public.member_request(text, text, text);
create or replace function public.member_request(
  p_kind text, p_message text default null, p_photo text default null, p_changes jsonb default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id      uuid := public.app_caller_member_id();
  v_msg     text := nullif(btrim(coalesce(p_message, '')), '');
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_val     text;
begin
  if v_id is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_kind is null or p_kind not in ('change', 'delete') then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  if p_changes is not null then
    if jsonb_typeof(p_changes) <> 'object' then raise exception 'changes must be an object' using errcode = '22023'; end if;
    for v_key, v_val in select key, value #>> '{}' from jsonb_each(p_changes) loop
      if v_key not in ('name', 'email', 'phone') then raise exception 'unknown detail %', v_key using errcode = '22023'; end if;
      v_val := btrim(coalesce(v_val, ''));
      if v_val = '' or char_length(v_val) > (case v_key when 'name' then 100 when 'email' then 200 else 40 end) then
        raise exception 'bad %', v_key using errcode = '22023';
      end if;
      v_changes := v_changes || jsonb_build_object(v_key, v_val);
    end loop;
  end if;
  if v_changes = '{}'::jsonb then v_changes := null; end if;
  if v_msg is null and p_photo is null and v_changes is null then raise exception 'empty request' using errcode = '22023'; end if;
  if (select count(*) from public.member_requests where member_id = v_id and handled_at is null) >= 5 then
    raise exception 'too many requests waiting' using errcode = '54000';
  end if;
  insert into public.member_requests (member_id, kind, message, photo, changes) values (v_id, p_kind, v_msg, p_photo, v_changes);
  return public.member_open_requests();
end $$;

revoke all on function public.member_request(text, text, text, jsonb), public.member_open_requests() from public, anon;
grant execute on function public.member_request(text, text, text, jsonb), public.member_open_requests() to authenticated;

select count(*) filter (where handled_at is null) as waiting from public.member_requests;
