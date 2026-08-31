-- ============================================================
--  PILLAR · KEEP CARE TRAFFIC OUT OF THE SMS LOG
--  Run this in Supabase → SQL Editor
-- ============================================================
--
-- Cares digests are sent through the same edge function as congregation
-- texting, and that function logs every message body to sms_messages. That
-- table is what the SMS "Responses" tab and the Guests conversations popup
-- read, so pastoral care detail — hospitals, diagnoses, names — was visible
-- to any signed-in staff member, including those with no Cares access.
--
-- Care rows are now tagged and removed from the readable set entirely. This is
-- enforced in row-level security, not in the UI: a filter in the app would
-- still leave the rows reachable by anyone who queried the table directly.

alter table sms_messages
  add column if not exists channel text not null default 'sms';   -- 'sms' | 'care'

create index if not exists idx_sms_messages_channel on sms_messages(channel);

-- ── Tag what is already there ─────────────────────────────
-- Digests, and the confirmations the intake bot sends back.
update sms_messages set channel = 'care'
where channel <> 'care' and (
     body ilike '%Bethesda Cares%'
  or body ilike 'CARES -%'
  or status = 'CareIntake'
  or body ilike '%to Cares (%'
  or body ilike 'Logged for %'
  or body ilike 'Removed %from Cares%'
);

-- Anything a Cares-alert staff member texted in. Their inbound to the church
-- line is either a care report or an opt-out keyword; neither belongs in the
-- congregation conversation view.
update sms_messages set channel = 'care'
where channel <> 'care'
  and direction = 'in'
  and right(regexp_replace(to_number, '[^0-9]', '', 'g'), 10) in (
    select right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
    from staff
    where preferences->>'caresSmsOptIn' = 'true' and phone is not null
  );

-- ── Lock care rows out of the app ─────────────────────────
drop policy if exists "staff read sms"  on sms_messages;
drop policy if exists "staff write sms" on sms_messages;

-- Reads never include care traffic. The edge functions use the service role,
-- which bypasses RLS, so digests still send and still get logged.
create policy "staff read sms" on sms_messages
  for select using (auth.role() = 'authenticated' and channel = 'sms');

-- Staff may only ever write ordinary SMS rows; nothing in the app can forge
-- a care row, and nothing can flip an existing one back to visible.
create policy "staff write sms" on sms_messages
  for insert with check (auth.role() = 'authenticated' and channel = 'sms');

create policy "staff update sms" on sms_messages
  for update using (auth.role() = 'authenticated' and channel = 'sms')
        with check (auth.role() = 'authenticated' and channel = 'sms');

create policy "staff delete sms" on sms_messages
  for delete using (auth.role() = 'authenticated' and channel = 'sms');

-- Check:
--   select channel, count(*) from sms_messages group by channel;
--   -- as an ordinary signed-in user, the care rows must not appear at all.
