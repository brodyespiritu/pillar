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
--  PILLAR · SMS BROADCAST SCHEMA  (congregation texting)
--  Run this in Supabase → SQL Editor  (needs sms-schema.sql too)
-- ============================================================

create table if not exists sms_groups (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid references staff(id) on delete cascade,
  name       text not null,
  created_at timestamptz default now()
);

create table if not exists sms_contacts (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid references staff(id) on delete cascade,
  name       text,
  phone      text not null,
  created_at timestamptz default now()
);

create table if not exists sms_group_members (
  group_id   uuid references sms_groups(id)   on delete cascade,
  contact_id uuid references sms_contacts(id) on delete cascade,
  primary key (group_id, contact_id)
);

create index if not exists idx_gm_group   on sms_group_members(group_id);
create index if not exists idx_gm_contact on sms_group_members(contact_id);

alter table sms_groups        enable row level security;
alter table sms_contacts      enable row level security;
alter table sms_group_members enable row level security;

/*
 * Contacts and groups are shared church data, not personal address books.
 * These were scoped to owner = auth.uid(), which meant the congregation list
 * one staff member built was invisible to everyone else. `owner` is kept as a
 * record of who added the row, not as an access boundary.
 */
drop policy if exists "own groups"     on sms_groups;
drop policy if exists "own contacts"   on sms_contacts;
-- Dropped before creating, or a second run fails here with 42710 (policy already
-- exists) and never reaches the opted_out columns below. The whole file has to be
-- safe to re-run, because that is how it will be used.
drop policy if exists "staff groups"   on sms_groups;
drop policy if exists "staff contacts" on sms_contacts;
drop policy if exists "own members"    on sms_group_members;
create policy "staff groups"   on sms_groups   for all using ((select public.is_active_staff()));
create policy "staff contacts" on sms_contacts for all using ((select public.is_active_staff()));
-- membership rows are reachable via their owned group/contact
create policy "own members"  on sms_group_members for all using ((select public.is_active_staff()));

/*
 * Opt-out, recorded on the contact rather than only at the provider.
 *
 * Telnyx already suppresses a number the moment it texts STOP, so compliance
 * never depended on this. What it did not do is tell Pillar: an opted-out
 * person stayed in the contact list, kept inflating the "All congregation"
 * count, and was attempted on every broadcast only to be refused. Worse, the
 * suppression lived only inside one Telnyx messaging profile — change profile
 * or provider and the record of their wishes would not travel with it.
 */
alter table sms_contacts add column if not exists opted_out    boolean not null default false;
alter table sms_contacts add column if not exists opted_out_at timestamptz;

/* Partial: the opted-out are a small minority, and this is only ever read to
   exclude them. */
create index if not exists idx_sms_contacts_opted_out
  on sms_contacts (opted_out) where opted_out;

/*
 * Back-fill: anyone who already texted STOP before the flag existed.
 *
 * Without this the column starts false for everybody, so people who opted out
 * weeks ago would keep showing as reachable — the provider would still refuse
 * them, but the count and the list would go on lying. Matches on the last ten
 * digits, because stored numbers vary in formatting.
 *
 * Inbound only (status 'Received'), whole-message keyword only, so "stop by the
 * office on Sunday" is not read as an opt-out. Safe to run more than once.
 */
with stopped as (
  select distinct right(regexp_replace(to_number, '\D', '', 'g'), 10) as last10,
         max(created_at) as said_at
    from sms_messages
   where status = 'Received'
     and lower(btrim(coalesce(body, ''))) ~
         '^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt out)[[:punct:][:space:]]*$'
   group by 1
)
update sms_contacts c
   set opted_out    = true,
       opted_out_at = coalesce(c.opted_out_at, s.said_at)
  from stopped s
 where right(regexp_replace(c.phone, '\D', '', 'g'), 10) = s.last10
   and c.opted_out is distinct from true;

/* Who it caught — read this before trusting it. */
select name, phone, opted_out_at
  from sms_contacts
 where opted_out
 order by opted_out_at desc nulls last;
