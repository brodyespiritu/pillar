-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

-- ════════════════════════════════════════════════════════════
-- Scheduled texting maintenance
--
-- While a row's window is open, nothing leaves Pillar by text. Incoming texts
-- are still recorded. See supabase/functions/_shared/maintenance.ts for which
-- senders check, and why each checks at its own entry rather than only at the
-- shared send function.
--
-- Times are timestamptz. Write them with an explicit zone so there is no doubt
-- which clock they mean — America/New_York is EDT (UTC-4) in summer and
-- EST (UTC-5) in winter, and Postgres resolves the right one for the date.
-- ════════════════════════════════════════════════════════════

create table if not exists sms_maintenance (
  id         uuid primary key default gen_random_uuid(),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_at timestamptz not null default now(),
  constraint sms_maintenance_order check (ends_at > starts_at)
);

create index if not exists idx_sms_maintenance_window
  on sms_maintenance (starts_at, ends_at);

alter table sms_maintenance enable row level security;

-- Staff can see a window (for a banner in the app). Only the service role
-- writes, so a window cannot be opened or closed from the browser.
drop policy if exists "staff read maintenance" on sms_maintenance;
create policy "staff read maintenance" on sms_maintenance
  for select using ((select public.is_active_staff()));


-- ── Managing a window ───────────────────────────────────────
--
-- Schedule one:
--   insert into sms_maintenance (starts_at, ends_at, reason)
--   values ('2026-09-13 13:00 America/New_York',
--           '2026-09-13 21:00 America/New_York',
--           'Texting system fixes and enhancements');
--
-- Is one open right now?
--   select * from sms_maintenance where now() >= starts_at and now() < ends_at;
--
-- End it early (texting resumes on the next check, within a minute):
--   update sms_maintenance set ends_at = now() where now() < ends_at;
--
-- Extend it:
--   update sms_maintenance set ends_at = '2026-09-13 23:00 America/New_York'
--    where now() < ends_at;
--
-- Cancel one that has not started:
--   delete from sms_maintenance where starts_at > now();


-- ── Before a window opens ───────────────────────────────────
--
-- Anything scheduled to send inside the window is held, then goes out the
-- moment the window closes — all at once, whatever the hour. Find it and
-- reschedule or cancel it first. Run this again just before the start, since
-- staff can schedule a text at any point until then.
--   select id, to_char(send_at at time zone 'America/New_York', 'Dy HH12:MI AM') as et,
--          target_label, message_type, repeat_rule, left(body, 60) as body
--     from sms_scheduled
--    where status = 'pending'
--      and send_at >= '2026-09-13 13:00 America/New_York'
--      and send_at <  '2026-09-13 21:00 America/New_York'
--    order by send_at;
-- (Cancelling a recurring row ends its series; re-create the next one.)


-- ── After a window closes ───────────────────────────────────
--
-- 1. Care reports texted in by Cares staff during the window. These were held
--    unprocessed and are INVISIBLE in the app — care rows are hidden from
--    everyone by row-level security — so this query is the only way anyone
--    will find them. Enter each one by hand. Run it in the SQL editor, which
--    bypasses RLS.
--   select to_char(created_at at time zone 'America/New_York', 'HH12:MI AM') as et,
--          to_name as staff, to_number, body
--     from sms_messages
--    where direction = 'in' and channel = 'care' and status = 'HeldMaintenance'
--    order by created_at;
--
-- 2. Care records and contact logs written during the window. Deacons who
--    asked to hear immediately were not texted about these, and nothing sends
--    those alerts afterwards on its own.
--   select 'added' as kind, id, created_at from care_members
--    where created_at >= '2026-09-13 13:00 America/New_York'
--      and created_at <  '2026-09-13 21:00 America/New_York'
--   union all
--   select 'update', id, created_at from contact_logs
--    where created_at >= '2026-09-13 13:00 America/New_York'
--      and created_at <  '2026-09-13 21:00 America/New_York'
--   order by created_at;
--
-- 3. The 4:00 PM care digest did not send, and the next morning's digest starts
--    at 4:00 PM, so 8:00 AM–4:00 PM that day appears in no digest. Recover it by
--    POSTing {"slot": 960} to cares-recap AFTER the window and BEFORE MIDNIGHT
--    Eastern — after midnight the same call takes the next day's 4 PM slot
--    instead, and the real one is then refused as already sent.
