-- ============================================================
--  PILLAR · MEMBER APP — the church directory, opt-out
--  (user, 2026-09-21: "put all the information for each user. Address, date of birth, etc. The user
--  then has to opt out of sharing that information.")
--
--  Every member on the church's list shows signed-in members their phone, email, photo, home
--  address and birthday (month and day, never the year) — whether or not they use the app — until
--  they turn a detail off: themselves in My Profile, or through the office (Pillar's "Include on
--  Directory" takes someone out altogether). Children, inactive, prospect and denied records still
--  never show.
--
--  Some members had turned sharing off under the old opt-in rules, and nothing tells them apart
--  from members who were never asked. The church chose to share everything once and ask every
--  member to look over their directory settings on their next sign-in.
--
--  Run in Supabase → SQL Editor, AFTER member-app-auth.sql. Safe to re-run: the switch to opt-out
--  happens only the first time, so choices members make afterwards are never undone. The same
--  definitions are in member-app-auth.sql, so re-running that file keeps this behaviour.
-- ============================================================

-- What each member shows in the directory: everything, until they turn a detail off (opt-out, 2026-09-21).
alter table public.church_members add column if not exists share_address  boolean not null default true;
alter table public.church_members add column if not exists share_birthday boolean not null default true;
alter table public.church_members alter column share_email set default true;
alter table public.church_members alter column share_phone set default true;
alter table public.church_members alter column share_photo set default true;

-- The switch to opt-out happens once: some members had turned sharing off under the old opt-in
-- rules, and nothing tells them apart from members who were never asked, so the church chose to share
-- everything and have every member look over their directory settings on their next sign-in
-- (directory_review_due). Adding that column is what marks the switch as done, so running this file
-- again changes nobody's choices.
do $open$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'church_members' and column_name = 'directory_review_due') then
    alter table public.church_members add column directory_review_due boolean not null default true;
    update public.church_members
       set share_email = true, share_phone = true, share_photo = true, share_address = true, share_birthday = true;
  end if;
end $open$;

-- The sign-in guard keeps the login columns honest through Pillar edits and imports (see
-- member-app-auth.sql for the rest of what it does):
--  · what the directory shows is the member's own choice (opt-out, member-directory-open.sql): a
--    new email or phone, a revoke, an unlink or lost eligibility no longer switches sharing off (the
--    directory leaves out anyone who isn't eligible anyway), and directory_hidden is theirs alone
create or replace function public.app_member_login_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_api           boolean := current_user in ('authenticated', 'anon');
  v_email_changed boolean;
  v_phone_changed boolean;
  v_lost          boolean;
  v_unlinked      boolean;
begin
  if tg_op = 'INSERT' then
    if v_api then
      new.auth_user_id := null; new.app_linked_at := null; new.app_login_email := null;
      new.app_mint_lease_until := null; new.app_mint_lease := null; new.app_not_before := null;
      new.directory_listed := false;
    end if;
    return new;
  end if;

  v_email_changed := public.app_norm_email(new.email) is distinct from public.app_norm_email(old.email);
  v_phone_changed := public.app_norm_phone(new.phone) is distinct from public.app_norm_phone(old.phone);
  if v_api then
    if new.auth_user_id is not null then new.auth_user_id := old.auth_user_id; end if;
    new.app_linked_at        := case when new.auth_user_id is null then null else old.app_linked_at end;
    new.app_login_email      := old.app_login_email;
    new.app_mint_lease_until := old.app_mint_lease_until;
    new.app_mint_lease       := old.app_mint_lease;
  end if;
  -- (greatest/least skip NULLs, so keep "never set" as NULL explicitly)
  new.app_not_before := case when old.app_not_before is null and new.app_not_before is null then null
                             else least(greatest(old.app_not_before, new.app_not_before), clock_timestamp()) end;
  v_lost     := public.app_member_is_eligible(old) and not public.app_member_is_eligible(new);
  v_unlinked := old.auth_user_id is not null and new.auth_user_id is null
                and (v_api or old.app_mint_lease_until is null or old.app_mint_lease_until < now());
  if v_email_changed or v_phone_changed or v_lost or v_unlinked then
    new.app_not_before := clock_timestamp();
  end if;
  return new;
end $$;
drop trigger if exists trg_members_app_login_guard on public.church_members;
create trigger trg_members_app_login_guard before insert or update on public.church_members
  for each row execute function public.app_member_login_guard();

-- The caller's own profile — safe fields only (never notes, tags, status or the login address).
create or replace function public.member_me()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'member_id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone,
           'address', m.address, 'photo_url', m.photo_url,
           'directory_listed', not m.directory_hidden, 'share_email', m.share_email,
           'share_phone', m.share_phone, 'share_photo', m.share_photo,
           'share_address', m.share_address, 'share_birthday', m.share_birthday,
           'has_birthday', m.birthday is not null, 'directory_review_due', m.directory_review_due,
           'directory_allowed', m.include_directory is not false)
    from public.church_members m
   where m.id = public.app_caller_member_id()
$$;

-- Members edit their address and what the directory shows of them. Name, email and phone are the
-- church's record (and the sign-in credentials), so changes to those go through the office.
drop function if exists public.member_update_me(text, boolean, boolean, boolean, boolean);
create or replace function public.member_update_me(
  p_address            text    default null,
  p_directory_listed   boolean default null,
  p_share_email        boolean default null,
  p_share_phone        boolean default null,
  p_share_photo        boolean default null,
  p_share_address      boolean default null,
  p_share_birthday     boolean default null,
  p_directory_reviewed boolean default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid := public.app_caller_member_id();
begin
  if v_id is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_address is not null and length(p_address) > 300 then
    raise exception 'address too long' using errcode = '22001';
  end if;
  update public.church_members set
    address              = case when p_address is null then address else nullif(btrim(p_address), '') end,
    directory_listed     = coalesce(p_directory_listed, directory_listed),
    -- "Show me in the directory": everyone is in it until they turn this off
    directory_hidden     = case when p_directory_listed is null then directory_hidden else not p_directory_listed end,
    share_email          = coalesce(p_share_email, share_email),
    share_phone          = coalesce(p_share_phone, share_phone),
    share_photo          = coalesce(p_share_photo, share_photo),
    share_address        = coalesce(p_share_address, share_address),
    share_birthday       = coalesce(p_share_birthday, share_birthday),
    -- they've looked over what the directory shows (once, after the switch to opt-out)
    directory_review_due = case when p_directory_reviewed then false else directory_review_due end,
    updated_at           = now()
  where id = v_id;
  return public.member_me();
end $$;

-- The church directory: signed-in members only. Everyone on the church's list is in it by default
-- (user, 2026-09-15) — every eligible adult record the office hasn't marked "not in directory" —
-- unless the member took themselves out (directory_hidden, from My Profile or by deleting their app
-- account). And everything shows — email, phone, photo, home address and birthday (month and day,
-- never the year) — whether or not they use the app, until they turn a detail off (opt-out, user
-- 2026-09-21). Photos are fetched one at a time (often stored inline).
drop function if exists public.member_directory(text, int, int);
create function public.member_directory(p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, name text, email text, phone text, has_photo boolean, address text, birthday text)
language sql stable security definer set search_path = ''
as $$
  select m.id, btrim(m.name),
         case when m.share_email then nullif(btrim(m.email), '') end,
         case when m.share_phone then nullif(btrim(m.phone), '') end,
         (m.share_photo and nullif(m.photo_url, '') is not null),
         case when m.share_address then nullif(btrim(m.address), '') end,
         case when m.share_birthday then to_char(m.birthday, 'MM-DD') end
    from public.church_members m
   where (select public.app_caller_member_id()) is not null
     and not m.directory_hidden
     and m.include_directory is not false
     and nullif(btrim(m.name), '') is not null
     and public.app_member_is_eligible(m)
     and (p_query is null or btrim(p_query) = ''
          or m.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by lower(btrim(m.name)), m.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.member_directory_photo(p_member_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select m.photo_url
    from public.church_members m
   where (select public.app_caller_member_id()) is not null
     and m.id = p_member_id
     and not m.directory_hidden and m.share_photo and m.include_directory is not false
     and public.app_member_is_eligible(m)
$$;

revoke all on function public.member_me(),
  public.member_update_me(text, boolean, boolean, boolean, boolean, boolean, boolean, boolean),
  public.member_directory(text, int, int), public.member_directory_photo(uuid) from public, anon;
grant execute on function public.member_me(),
  public.member_update_me(text, boolean, boolean, boolean, boolean, boolean, boolean, boolean),
  public.member_directory(text, int, int), public.member_directory_photo(uuid) to authenticated;

select count(*) as members,
       count(*) filter (where share_address)        as sharing_address,
       count(*) filter (where directory_review_due) as to_review
  from public.church_members;
