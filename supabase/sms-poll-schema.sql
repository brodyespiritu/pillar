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
-- Poll answers
--
-- A poll is an ordinary broadcast whose library row is typed 'Poll'. Its
-- options live in the message text itself ("[1] Immediately"), so there is no
-- separate list of choices to keep in step with the words people read.
--
-- One row per person per poll: replying again corrects the earlier answer
-- rather than casting a second vote.
-- ════════════════════════════════════════════════════════════

create table if not exists sms_poll_answers (
  id          uuid primary key default gen_random_uuid(),
  poll_body   text not null,               -- the message they were answering
  to_number   text not null,               -- their phone, as we sent to it
  choice      int  not null,               -- the number they replied with
  answer_text text,                         -- what they actually typed
  answered_at timestamptz default now(),
  created_at  timestamptz default now(),
  unique (poll_body, to_number)
);

create index if not exists idx_poll_answers_body on sms_poll_answers(poll_body);

alter table sms_poll_answers enable row level security;

drop policy if exists "staff read poll answers"  on sms_poll_answers;
drop policy if exists "staff write poll answers" on sms_poll_answers;
create policy "staff read poll answers"  on sms_poll_answers
  for select using ((select public.is_active_staff()));
create policy "staff write poll answers" on sms_poll_answers
  for all    using ((select public.is_active_staff()));
