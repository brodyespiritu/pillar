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
  for all using (auth.role() = 'authenticated');
