-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

-- ============================================================
--  PILLAR · SMS MODULE SCHEMA  (Telnyx)
--  Run this in Supabase → SQL Editor
-- ============================================================

create table if not exists sms_messages (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid references staff(id) on delete set null,
  to_number    text not null,
  to_name      text,
  body         text,
  status       text default 'MassText',   -- MassText | Sent | Failed | Received
  provider_id  text,
  error        text,
  created_at   timestamptz default now()
);

create index if not exists idx_sms_to     on sms_messages(to_number);
create index if not exists idx_sms_status on sms_messages(status);

alter table sms_messages enable row level security;
create policy "staff read sms"  on sms_messages for select using ((select public.is_active_staff()));
create policy "staff write sms" on sms_messages for all    using ((select public.is_active_staff()));

-- ── Which message a send belongs to ───────────────────────────────────────
-- The Responses tab reads the last thing sent to someone as the question their
-- next reply answers. That breaks for a reminder: it is sent about one campaign
-- but lands in a thread whose previous message may be something else entirely,
-- so replies to it were filed under whatever went out most recently.
-- A reminder records the campaign it is chasing, and grouping follows that.
alter table sms_messages add column if not exists campaign text;
