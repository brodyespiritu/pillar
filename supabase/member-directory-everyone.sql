-- ============================================================
--  PILLAR · MEMBER APP — everyone in the church directory
--  The app's Directory page lists every member (user, 2026-09-15) instead of only those who
--  opted in. Members take themselves out from My Profile ("Show me in the directory"); the office
--  keeps anyone out with "Include on Directory" in Pillar. Email, phone and photo still show only
--  where a member chose to share them. Children, inactive, prospect and denied records never show.
--  Tapping someone shows their household (names and positions) and their deacon's name
--  (member_directory_family).
--
--  Run in Supabase → SQL Editor, after member-app-auth.sql. Safe to re-run. The same definitions
--  are in member-app-auth.sql, so re-running that file keeps this behaviour.
-- ============================================================

alter table public.church_members
  add column if not exists directory_hidden boolean not null default false;   -- the member took themselves out of the directory

-- The caller's own profile — safe fields only (never notes, tags, status or the login address).
create or replace function public.member_me()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'member_id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone,
           'address', m.address, 'photo_url', m.photo_url,
           'directory_listed', not m.directory_hidden, 'share_email', m.share_email,
           'share_phone', m.share_phone, 'share_photo', m.share_photo,
           'directory_allowed', m.include_directory is not false)
    from public.church_members m
   where m.id = public.app_caller_member_id()
$$;

-- Members edit their address and directory choices. Name, email and phone are the church's
-- record (and the sign-in credentials), so changes to those go through the office.
create or replace function public.member_update_me(
  p_address          text    default null,
  p_directory_listed boolean default null,
  p_share_email      boolean default null,
  p_share_phone      boolean default null,
  p_share_photo      boolean default null)
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
    address          = case when p_address is null then address else nullif(btrim(p_address), '') end,
    directory_listed = coalesce(p_directory_listed, directory_listed),
    -- "Show me in the directory": everyone is in it until they turn this off
    directory_hidden = case when p_directory_listed is null then directory_hidden else not p_directory_listed end,
    share_email      = coalesce(p_share_email, share_email),
    share_phone      = coalesce(p_share_phone, share_phone),
    share_photo      = coalesce(p_share_photo, share_photo),
    updated_at       = now()
  where id = v_id;
  return public.member_me();
end $$;

-- member-delete-account: the member's own login goes and they leave the directory (the app says so);
-- the church record stays.
create or replace function public.app_member_forget_login(p_member_id uuid, p_auth_user_id uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.member_sessions set revoked_at = now() where member_id = p_member_id and revoked_at is null;
  update public.church_members
     set auth_user_id = null, app_linked_at = null, app_not_before = clock_timestamp(),
         directory_listed = false, share_email = false, share_phone = false, share_photo = false,
         directory_hidden = true
   where id = p_member_id and (auth_user_id = p_auth_user_id or auth_user_id is null);
  return found;
end $$;

-- The church directory: signed-in members only. Everyone on the church's list is in it by default
-- (user, 2026-09-15) — every eligible adult record the office hasn't marked "not in directory" —
-- unless the member took themselves out (directory_hidden, from My Profile or by deleting their app
-- account). Names for everyone; email, phone and photo only where that member chose to share them,
-- and only while their app login is intact. Photos are fetched one at a time (often stored inline).
create or replace function public.member_directory(p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, name text, email text, phone text, has_photo boolean)
language sql stable security definer set search_path = ''
as $$
  select m.id, btrim(m.name),
         case when m.share_email and l.intact then m.email end,
         case when m.share_phone and l.intact then m.phone end,
         (m.share_photo and l.intact and nullif(m.photo_url, '') is not null)
    from public.church_members m
    cross join lateral (
      select m.auth_user_id is not null
             and exists (select 1 from auth.users u where u.id = m.auth_user_id and u.email = m.app_login_email) as intact
    ) l
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
     and m.auth_user_id is not null
     and exists (select 1 from auth.users u where u.id = m.auth_user_id and u.email = m.app_login_email)
     and public.app_member_is_eligible(m)
$$;

-- Someone's household and shepherding deacon, for their card on the Directory page: the names and
-- family positions of everyone else on their family record whom the directory may show (not hidden,
-- not kept out by the office, active, not a prospect or denied; a household's children included), and
-- the deacon's name only. Nothing when that person isn't in the directory, and nothing for anyone
-- but a member session.
create or replace function public.member_directory_family(p_member_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with target as (
    select m.id, m.deacon_id,
           coalesce(nullif(btrim(m.family_id), ''), lower(nullif(btrim(m.family_name), ''))) as fam_key
      from public.church_members m
     where (select public.app_caller_member_id()) is not null
       and m.id = p_member_id
       and not m.directory_hidden
       and m.include_directory is not false
       and nullif(btrim(m.name), '') is not null
       and public.app_member_is_eligible(m)
  )
  select jsonb_build_object(
    'family', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', btrim(f.name), 'position', nullif(btrim(f.family_position), ''))
                       order by case lower(coalesce(btrim(f.family_position), ''))
                                  when 'head' then 0 when 'spouse' then 1 when 'child' then 2 else 3 end,
                                lower(btrim(f.name)))
        from public.church_members f
       where t.fam_key is not null
         and f.id <> t.id
         and coalesce(nullif(btrim(f.family_id), ''), lower(nullif(btrim(f.family_name), ''))) = t.fam_key
         and nullif(btrim(f.name), '') is not null
         and not f.directory_hidden
         and f.include_directory is not false
         and f.app_access <> 'deny'
         and coalesce(nullif(btrim(f.status), ''), 'Active') ilike 'active'
         and f.active is not false
         and coalesce(btrim(f.record_type), '') not ilike 'prospect'
         and coalesce(btrim(f.member_status), '') not ilike 'inactive'
    ), '[]'::jsonb),
    'deacon', (
      select jsonb_build_object('name', btrim(d.name))
        from public.church_members d
       where d.id = t.deacon_id
         and nullif(btrim(d.name), '') is not null
         and d.active is not false
         and not d.directory_hidden            -- a deacon who hid themselves isn't named on anyone's card
         and d.include_directory is not false
    )
  )
  from target t
$$;

-- the same access as member-app-auth.sql: members' own sessions; delete-account for the service only
revoke all on function public.member_me(), public.member_update_me(text, boolean, boolean, boolean, boolean),
  public.member_directory(text, int, int), public.member_directory_photo(uuid), public.member_directory_family(uuid) from public, anon;
grant execute on function public.member_me(), public.member_update_me(text, boolean, boolean, boolean, boolean),
  public.member_directory(text, int, int), public.member_directory_photo(uuid), public.member_directory_family(uuid) to authenticated;
revoke all on function public.app_member_forget_login(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app_member_forget_login(uuid, uuid) to service_role;
