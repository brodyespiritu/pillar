-- ════════════════════════════════════════════════════════════
-- Deacon alerts, the moment a record is saved.
--
-- The half-hourly recap already sweeps for these, which is right for the
-- morning summary and too slow for a deacon who asked to hear immediately.
-- These triggers call the edge function as the row lands, so "immediately"
-- means the moment somebody hits save rather than by the next half past.
--
-- Fired from the database rather than the app on purpose: a care record can
-- also arrive by text through the SMS intake, and that path would never run a
-- browser callback.
--
-- BEFORE RUNNING: replace BOTH occurrences of <CARES_CRON_SECRET> with one new
-- value of your choosing (openssl rand -hex 32), and set that same value as the
-- CARES_CRON_SECRET function secret.
--
-- Supabase never shows a secret's value once set, so the original is gone. The
-- answer is to rotate. The existing cares-alerts cron carries the old value
-- inside its own definition, so it is re-scheduled here with the new one —
-- otherwise the digests would start failing authorisation the moment the secret
-- changes, silently, at 8:00 tomorrow morning.
-- ════════════════════════════════════════════════════════════

create extension if not exists pg_net;

create or replace function notify_deacon_alert()
returns trigger
language plpgsql
security definer
as $$
declare
  kind text;
begin
  kind := case tg_table_name when 'care_members' then 'added' else 'update' end;

  /*
   * Fire and forget. net.http_post queues the request and returns at once, so
   * saving a care note is never held up by a text — and never fails because of
   * one. If the call is lost, the half-hourly sweep still catches it.
   */
  perform net.http_post(
    url     := 'https://dxiqhequrfdodeyqzowz.supabase.co/functions/v1/deacon-alert',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <CARES_CRON_SECRET>'),
    body    := jsonb_build_object('kind', kind, 'id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists trg_deacon_alert_added  on care_members;
drop trigger if exists trg_deacon_alert_update on contact_logs;

create trigger trg_deacon_alert_added
  after insert on care_members
  for each row execute function notify_deacon_alert();

create trigger trg_deacon_alert_update
  after insert on contact_logs
  for each row execute function notify_deacon_alert();

-- Check they registered:
--   select tgname, tgrelid::regclass from pg_trigger
--    where tgname in ('trg_deacon_alert_added','trg_deacon_alert_update');


-- ── Re-schedule the digests with the rotated secret ─────────
-- Same job, same half-hourly cadence; only the token changes. Dropped first
-- because cron.schedule on an existing name would otherwise error.
select cron.unschedule('cares-alerts')
 where exists (select 1 from cron.job where jobname = 'cares-alerts');

select cron.schedule('cares-alerts', '0,30 * * * *', $$
  select net.http_post(
    url     := 'https://dxiqhequrfdodeyqzowz.supabase.co/functions/v1/cares-recap',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <CARES_CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$$);

-- Check both landed:
--   select jobname, schedule, active from cron.job where jobname = 'cares-alerts';
--   select tgname from pg_trigger where tgname like 'trg_deacon_alert%';
