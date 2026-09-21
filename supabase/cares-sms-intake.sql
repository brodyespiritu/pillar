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
--  PILLAR · CARES BY TEXT
--  Staff text in what they hear; the system files it and asks
--  follow-up questions when it needs more.
--  Run this in Supabase → SQL Editor.
-- ============================================================

-- One open conversation per phone number. When we ask a question, we park the
-- half-built record here so the staff member's next text can finish it —
-- otherwise "Susie" (in answer to "who is this about?") is just a stray word.
create table if not exists care_sms_threads (
  phone       text primary key,          -- last 10 digits, so formatting never matters
  state       text not null,             -- awaiting_person | awaiting_choice | awaiting_reason | awaiting_new
  data        jsonb not null default '{}'::jsonb,
  last_action jsonb,                     -- what we last filed, so UNDO can reverse it
  updated_at  timestamptz default now()
);

alter table care_sms_threads enable row level security;

drop policy if exists "staff read sms threads" on care_sms_threads;
create policy "staff read sms threads" on care_sms_threads
  for select using ((select public.is_active_staff()));
-- The edge function writes with the service role, which bypasses RLS.

-- Check:
--   select phone, state, updated_at from care_sms_threads order by updated_at desc;
