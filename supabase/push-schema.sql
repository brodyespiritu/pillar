-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

/*
 * Web Push subscriptions.
 *
 * One row per browser, not per person: somebody with the PWA on their phone and
 * Pillar open on the office desktop has two, and both should ring. The endpoint
 * is the push service's own URL and is unique, so re-subscribing the same
 * browser updates rather than duplicates.
 */
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid references staff(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,          -- the browser's public key
  auth        text not null,          -- the browser's auth secret
  user_agent  text,
  created_at  timestamptz default now(),
  last_used_at timestamptz
);

create index if not exists idx_push_staff on push_subscriptions(staff_id);

alter table push_subscriptions enable row level security;
create policy "own push subs" on push_subscriptions
  for all using ((select public.is_active_staff()));
