-- ============================================================
--  PILLAR · MEMBER APP — family and deacon on My Profile
--  Adds public.member_family() (also in member-app-auth.sql). Run in Supabase → SQL Editor.
--  Safe to re-run. Needs member-app-auth.sql to have been run first.
-- ============================================================

-- My Profile in the app: the member's household (everyone else on their family record, head first:
-- names and family positions only) and their shepherding deacon (deacon_id) with the phone and email
-- on the deacon's church record, so the family can reach them. Nothing for anyone but a member session.
create or replace function public.member_family()
returns jsonb language sql stable security definer set search_path = ''
as $$
  with me as (
    select m.id, m.deacon_id,
           coalesce(nullif(btrim(m.family_id), ''), lower(nullif(btrim(m.family_name), ''))) as fam_key
      from public.church_members m
     where m.id = public.app_caller_member_id()
  )
  select jsonb_build_object(
    'family', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'position', nullif(btrim(f.family_position), ''))
                       order by case lower(coalesce(btrim(f.family_position), ''))
                                  when 'head' then 0 when 'spouse' then 1 when 'child' then 2 else 3 end,
                                f.name)
        from public.church_members f
       where me.fam_key is not null
         and f.id <> me.id
         and coalesce(nullif(btrim(f.family_id), ''), lower(nullif(btrim(f.family_name), ''))) = me.fam_key
         and f.active is not false
         and coalesce(btrim(f.member_status), '') not ilike 'inactive'
         and nullif(btrim(f.name), '') is not null
    ), '[]'::jsonb),
    'deacon', (
      select jsonb_build_object('id', d.id, 'name', d.name,
                                'phone', nullif(btrim(d.phone), ''), 'email', nullif(btrim(d.email), ''))
        from public.church_members d
       where d.id = me.deacon_id and d.active is not false
    )
  )
  from me
$$;

revoke all on function public.member_family() from public, anon;
grant execute on function public.member_family() to authenticated;
