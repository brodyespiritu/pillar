-- ============================================================
--  PILLAR · MEMBER APP — why does someone keep getting signed out? (2026-09-24)
--  READ-ONLY: nothing here changes anything. Put part of their name on the line marked ◀, run it in
--  Supabase → SQL Editor, and read down the list — newest first. What the rows mean is below it.
-- ============================================================

with who as (
  select m.* from public.church_members m
   where m.name ilike '%' || 'Their Name' || '%'          -- ◀ their name, or part of it
   order by m.app_linked_at desc nulls last
   limit 1
), logins as (
  select u.* from auth.users u join who on u.raw_app_meta_data ->> 'bbc_member_id' = who.id::text
), sess as (
  select s.* from auth.sessions s join logins l on l.id = s.user_id
)
select at, what, detail from (
  select now() as at, 'their record' as what,
         concat_ws(' · ', who.name,
           case when public.app_norm_email(who.email) is not null then 'has an email' end,
           case when public.app_norm_phone(who.phone) is not null then 'has a mobile' end,
           case when public.app_norm_email(who.email) is null and public.app_norm_phone(who.phone) is null
                then 'NOTHING OF THEIR OWN — signs in on the family address' end,
           'household ' || coalesce(nullif(btrim(who.family_id), ''), 'none'),
           'position ' || coalesce(nullif(btrim(who.family_position), ''), 'none'),
           case when public.app_member_is_eligible(who) then 'allowed in the app'
                else 'NOT ALLOWED in the app (status, child, under 18, or denied)' end,
           case when who.auth_user_id is null then 'no app login linked'
                else 'app login linked ' || to_char(who.app_linked_at, 'Mon DD HH24:MI') end) as detail
    from who
  union all
  select who.app_not_before, 'CUT-OFF',
         'every sign-in from before this ended — their email or mobile changed, they stopped being allowed, the login was unlinked, or the office signed them out'
    from who where who.app_not_before is not null
  union all
  select l.created_at, 'app login made',
         concat_ws(' · ', 'last signed in ' || to_char(l.last_sign_in_at, 'Mon DD HH24:MI'),
           case when l.banned_until > now() then 'BANNED' end)
    from logins l
  union all
  select s.created_at, 'phone session',
         concat_ws(' · ',
           'last renewed ' || to_char(coalesce(s.refreshed_at, s.updated_at), 'Mon DD HH24:MI'),
           case when s.not_after is not null then 'SUPABASE ENDS IT ' || to_char(s.not_after, 'Mon DD HH24:MI') end,
           (select count(*) || ' renewals, ' || count(*) filter (where not rt.revoked) || ' unused'
              from auth.refresh_tokens rt where rt.session_id = s.id),
           left(s.user_agent, 70))
    from sess s
  union all
  select ms.bound_at, 'app sign-in',
         concat_ws(' · ', 'by ' || ms.channel,
           case when not exists (select 1 from auth.sessions s2 where s2.id = ms.session_id) then 'SESSION GONE (signed out)'
                else 'session still there' end,
           case when ms.revoked_at is not null then 'ended by the office or a deleted account ' || to_char(ms.revoked_at, 'Mon DD HH24:MI') end,
           case when ms.minted_at <= coalesce(who.app_not_before, '-infinity'::timestamptz) then 'from before the cut-off' end)
    from public.member_sessions ms join who on who.id = ms.member_id
  union all
  select e.created_at, 'sign-in log: ' || e.event, concat_ws(' · ', e.channel, e.outcome)
    from public.member_auth_events e join who on who.id = e.member_id
   where e.created_at > now() - interval '30 days'
) x
order by at desc nulls last
limit 200;

-- How to read it
--  · Several "app sign-in" rows, each SESSION GONE, and no CUT-OFF near them: the phone lost its sign-in
--    and they signed in again. The app update of 2026-09-24 fixes the two ways that happened (a read of
--    the saved sign-in while it was being renewed, and the app closing or restarting part-way through
--    saving it).
--  · A CUT-OFF just before they were signed out: something on their record changed — see the list in
--    that row. Changing the same thing back does NOT undo it; they sign in again once.
--  · "NOTHING OF THEIR OWN" on their record: they sign in on the family address. Until
--    member-household-signin.sql was re-run (2026-09-24), those sign-ins never held.
--  · A phone session that SUPABASE ENDS: Supabase → Authentication → Sessions has a time limit or an
--    inactivity timeout switched on. Members open the app now and then, so that signs them out.
--  · Many "app login made" rows close together: the login was rebuilt at a sign-in, which ends every
--    other phone they use.
--  · A phone session whose renewals are all used ("0 unused"): Supabase refused a renewal the phone
--    sent twice and ended that session (the phone signs itself out when it next renews).
