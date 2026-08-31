-- ── Why didn't the Cares digest send? ─────────────────────
-- Run these three in order in the SQL editor. The third one is usually the
-- answer.

-- 1. Is the job registered and active?
select jobid, jobname, schedule, active
from cron.job
where jobname = 'cares-alerts';
--    Expect one row, '0 * * * *', active = true.
--    No row  -> the schedule never got created; re-run cares-recap-schedule.sql.


-- 2. Has it actually been running every hour?
select jobid, status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'cares-alerts')
order by start_time desc
limit 12;
--    Expect hourly rows with status 'succeeded'. Note that 'succeeded' only
--    means the SQL ran — it says nothing about what the edge function replied,
--    because net.http_post is fire-and-forget. That is what query 3 is for.


-- 3. What did the edge function actually reply?  ← the real answer
select id, status_code, content::text, created
from net._http_response
order by created desc
limit 12;
--    200 {"ok":true,...}                  -> it sent
--    200 {"ok":true,"skipped":"..."}      -> it ran but decided not to send
--    401 / 403 {"error":"forbidden"}      -> the Authorization header is wrong:
--                                            the placeholder was left in, or the
--                                            key was truncated on paste.
--    no rows at all                       -> pg_net never fired the request.


-- ── If query 3 shows 401/403, fix the key and reschedule ──
-- select cron.unschedule('cares-alerts');
-- then re-run supabase/cares-recap-schedule.sql with the CARES_CRON_SECRET value.
