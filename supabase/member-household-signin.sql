-- ============================================================
--  PILLAR · MEMBER APP — a family that shares one email
--  Someone whose church record has no email and no mobile number of their own can sign in with the
--  address on their family record (user, 2026-09-15): the code goes to that address, then the app
--  asks which person is signing in and lists the adults of that household — the one the address
--  belongs to, plus any adult on the same family_id with nothing of their own. Children are never
--  listed, and nobody outside that one household is.
--
--  …and then STAYS signed in (2026-09-24): every call re-checks that the contact a session came
--  through still leads to that person, and that check looked only at their own contact — empty for
--  exactly these people — so the sign-in never held. app_caller_member_id below also accepts the
--  family's address, on a record in their household whose contacts haven't changed since.
--
--  Run in Supabase → SQL Editor, after member-app-auth.sql. Safe to re-run. The same definitions are
--  in member-app-auth.sql, so re-running that file keeps this behaviour.
-- ============================================================

-- Postgres refuses to replace a function whose result columns changed, so the old one goes first.
-- Nothing holds on to it at rest: the sign-in functions look it up by name when a code is asked for,
-- and the grant below is re-made in the same run.
drop function if exists public.app_login_candidates(text, text, timestamptz);

create or replace function public.app_login_candidates(p_email text, p_phone text, p_since timestamptz default null)
returns table (member_id uuid, name text, household text, matched_count int)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text := public.app_norm_email(p_email);
  v_phone text := public.app_norm_phone(p_phone);
begin
  if (v_email is null) = (v_phone is null) then return; end if;
  if exists (select 1 from public.app_contact_blocklist b where b.contact_norm = coalesce(v_email, v_phone)) then return; end if;
  return query
  with matched as (
    select m.id, m.name, coalesce(nullif(btrim(m.family_id), ''), 'self:' || m.id::text) as household,
           public.app_member_is_known_adult(m) as known_adult
      from public.church_members m
     where (case when v_email is not null then public.app_norm_email(m.email) = v_email
                 else public.app_norm_phone(m.phone) = v_phone end)
       and public.app_member_is_eligible(m)
       and (p_since is null or coalesce(m.app_not_before, '-infinity'::timestamptz) < p_since)
       -- a banned app login (Supabase → Users → Ban) blocks that record from signing in
       and not exists (select 1 from auth.users u
                        where (u.id = m.auth_user_id or u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text)
                          and u.banned_until > now())
  ), stats as (
    select count(*)::int as n,
           (count(distinct x.household) filter (where x.known_adult))::int as adult_households
      from matched x
  ), offered as (
    select x.id, x.name, x.household
      from matched x cross join stats s
     where s.n between 1 and 8
       and (s.n = 1 or (x.known_adult and s.adult_households = 1))
  ), household as (
    -- One address for the whole family: the other ADULTS on that family record who have no email and
    -- no number of their own are offered too, so a wife on her husband's address can sign in as
    -- herself (user, 2026-09-15). They must share a real family_id and have nothing of their own.
    select m.id, m.name, nullif(btrim(m.family_id), '') as household
      from public.church_members m
     where nullif(btrim(m.family_id), '') is not null
       and exists (select 1 from offered o where o.household = nullif(btrim(m.family_id), ''))
       and not exists (select 1 from offered o where o.id = m.id)
       and public.app_norm_email(m.email) is null
       and public.app_norm_phone(m.phone) is null
       and public.app_member_is_eligible(m)
       and public.app_member_is_known_adult(m)
       and (p_since is null or coalesce(m.app_not_before, '-infinity'::timestamptz) < p_since)
       and not exists (select 1 from auth.users u
                        where (u.id = m.auth_user_id or u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text)
                          and u.banned_until > now())
  ), everyone as (
    select * from offered union all select * from household
  ), total as (
    -- how many people this contact belongs to, offered or not: one means a straight sign-in,
    -- more means the app asks which person it is (member-verify-code)
    select ((select count(*) from matched) + (select count(*) from household))::int as n
  )
  select e.id, e.name, e.household, t.n
    from everyone e cross join total t
   where t.n between 1 and 8
   order by e.name, e.id;
end $$;

revoke all on function public.app_login_candidates(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.app_login_candidates(text, text, timestamptz) to service_role;

-- The one gate. Returns the caller's member id only for a session that
--  · is an OTP session (amr: otp, optionally totp) — not password, OAuth, SSO, passkey …
--  · was bound through a grant (member_sessions) whose code predates any change to the record,
--    and the contact it came through still leads to this record
--  · still exists in auth.sessions (signed-out sessions stop at once, not at token expiry)
--  · belongs to the record's own untouched login: same random address, no phone, no other
--    identities, not banned/deleted, not staff — and the record is still eligible
create or replace function public.app_caller_member_id()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid    uuid  := auth.uid();
  v_claims jsonb := auth.jwt();
  v_amr    jsonb;
  v_sid    uuid;
  v_id     uuid;
begin
  if v_uid is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then return null; end if;
  v_amr := case when jsonb_typeof(v_claims -> 'amr') = 'array' then v_claims -> 'amr' else '[]'::jsonb end;
  if not exists (select 1 from jsonb_array_elements(v_amr) a where jsonb_typeof(a) = 'object' and a ->> 'method' = 'otp')
     or exists (select 1 from jsonb_array_elements(v_amr) a
                 where jsonb_typeof(a) <> 'object' or coalesce(a ->> 'method', '') not in ('otp', 'totp')) then
    return null;
  end if;
  begin v_sid := (v_claims ->> 'session_id')::uuid; exception when others then return null; end;
  if v_sid is null then return null; end if;

  select m.id into v_id
    from public.member_sessions ms
    join public.church_members m on m.id = ms.member_id
    join auth.users u            on u.id = ms.auth_user_id
    join auth.sessions s         on s.id = ms.session_id
   where ms.session_id = v_sid
     and ms.auth_user_id = v_uid
     and ms.revoked_at is null
     and m.auth_user_id = v_uid
     and ms.minted_at > coalesce(m.app_not_before, '-infinity'::timestamptz)
     and public.app_member_is_eligible(m)
     -- the contact that signed them in still leads to this record (household split, blocklist, ban…):
     -- their own — or, for an adult with nothing of their own, their family's address, on a record
     -- in their household whose contacts haven't changed since the code was sent
     -- (member-household-signin.sql; this looked only at their own, so those sign-ins never held)
     and (exists (select 1 from public.app_login_candidates(
                    case when ms.channel = 'email' then m.email end,
                    case when ms.channel = 'sms' then m.phone end, null) c
                   where c.member_id = m.id)
          or exists (select 1
                       from public.church_members f
                      where nullif(btrim(m.family_id), '') is not null
                        and btrim(f.family_id) = btrim(m.family_id)
                        and f.id <> m.id
                        and coalesce(f.app_not_before, '-infinity'::timestamptz) < ms.minted_at
                        and exists (select 1 from public.app_login_candidates(
                                      case when ms.channel = 'email' then f.email end,
                                      case when ms.channel = 'sms' then f.phone end, null) c
                                     where c.member_id = m.id)))
     and s.user_id = v_uid
     and (s.not_after is null or s.not_after > now())
     and u.email = m.app_login_email
     and u.email_confirmed_at is not null
     and coalesce(u.phone, '') = '' and u.phone_confirmed_at is null
     and u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= now())
     and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
     and not exists (select 1 from public.staff st where st.id = v_uid);
  return v_id;
end $$;
revoke all on function public.app_caller_member_id() from public, anon, authenticated;
