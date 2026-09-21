-- ============================================================
--  PILLAR · MEMBER APP — a family that shares one email
--  Someone whose church record has no email and no mobile number of their own can sign in with the
--  address on their family record (user, 2026-09-15): the code goes to that address, then the app
--  asks which person is signing in and lists the adults of that household — the one the address
--  belongs to, plus any adult on the same family_id with nothing of their own. Children are never
--  listed, and nobody outside that one household is.
--
--  Run in Supabase → SQL Editor, after member-app-auth.sql. Safe to re-run. The same definition is
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
