-- ── Contact Log visibility ────────────────────────────────
-- Guarantees every signed-in staff member sees the Contact Log on every care
-- member — not just the entries they wrote themselves.
-- Safe to run more than once.

-- 1. What is actually in place right now? (run this first, read the `qual`)
--    A correct row reads:  (auth.role() = 'authenticated'::text)
--    Anything mentioning auth.uid() or logged_by would hide other people's logs.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'contact_logs';

-- 2. Reset them to the shared-team rule.
alter table contact_logs enable row level security;

drop policy if exists "staff read logs"  on contact_logs;
drop policy if exists "staff write logs" on contact_logs;

create policy "staff read logs"  on contact_logs
  for select using (auth.role() = 'authenticated');
create policy "staff write logs" on contact_logs
  for all    using (auth.role() = 'authenticated');

-- 3. Confirm — should show the two policies above and nothing else.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'contact_logs';
