-- ============================================================
--  PILLAR · MEMBER SIGN-IN FOR THE BETHESDA APP  (v2 — church-issued codes)
--
--  Members sign in to the app with a one-time code sent by TEXT or EMAIL to a contact that is
--  ALREADY on their church_members record. The church's own Edge Functions issue and check the
--  codes; Supabase Auth only holds a dedicated, contact-free login per record and hands out the
--  session. Why not Supabase's own phone/email OTP: its public endpoints reveal which contacts
--  have logins, have no per-code attempt limit, and let a session move its login onto another
--  number (source-verified against supabase/auth v2.193.0; see MEMBER-SIGN-IN.md).
--
--    member-request-code  → app_rate_hit_many · app_login_candidates · app_code_issue · send
--    member-verify-code   → app_code_consume · app_login_candidates · tickets · mint:
--                           app_member_login_prepare/_ok/_rotate/_users · admin.createUser
--                           (m-<random>@<domain>, no phone, no password known to anyone)
--                           · app_member_link_login · admin.generateLink · app_grant_create
--    the app              → verifyOtp(token_hash) · member_bind_session(grant)
--    every member RPC     → app_caller_member_id(): a session bound through a grant, on the
--                           record's own login, after the record's contacts last changed
--
--  This file:
--    1. Makes every "any signed-in user" rule staff-only (member logins must never read Pillar).
--    2. Adds the login link, directory choices (listed by default; members can hide), access overrides and the sign-out cutoff to
--       church_members, with a trigger that keeps them honest through Pillar edits and imports.
--    3. Contact normalisation, eligibility (no children, no inactive records) and matching —
--       the Edge Functions use byte-identical TypeScript (functions/_shared/memberContact.ts).
--    4. Service-role-only machinery: settings, blocklist, rate limits, codes, choice tickets,
--       login minting, grants, audit events, purge.
--    5. The member surface: member_bind_session, member_me, member_update_me, member_directory,
--       member_directory_photo, member_directory_family, member_family. Staff: app_member_revoke_login.
--
--  Run in Supabase → SQL Editor. Safe to re-run. Removes the v1 functions (member_claim etc.).
--
--  ⚠ PRE-FLIGHT — run this SELECT on its own FIRST. Every login it lists will lose all access to
--  Pillar's data when this migration runs (that is the point for non-staff logins). Make sure no
--  real staff member is in the list; fix their staff row (active = true, id = their login id) first.
--
--    select u.id, u.email, u.last_sign_in_at, s.name as staff_name, s.active
--    from auth.users u
--    left join public.staff s on s.id = u.id
--    where s.id is null or s.active is false
--    order by u.last_sign_in_at desc nulls last;
-- ============================================================

begin;

-- ── 1. Staff-only data ────────────────────────────────────────
-- Same definition as sms-recipient-guards.sql, plus: a member app login is never staff, even if
-- someone adds a staff row with its id by mistake.
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid() and active is not false)
     and not exists (select 1 from auth.users u where u.id = auth.uid() and u.raw_app_meta_data ? 'bbc_member_id');
$$;
revoke all on function public.is_active_staff() from public;
grant execute on function public.is_active_staff() to anon, authenticated, service_role;

-- Same rule for admins (sms-recipient-guards.sql's definition plus the member-login exclusion).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role ilike '%admin%' and active is not false from public.staff where id = auth.uid()), false)
     and not exists (select 1 from auth.users u where u.id = auth.uid() and u.raw_app_meta_data ? 'bbc_member_id');
$$;

-- Every policy that lets ANY signed-in user in becomes active-staff-only:
--   a) auth.role() = 'authenticated'            → public.is_active_staff()
--   b) policies granted TO authenticated whose rule checks no identity at all
--      (e.g. website images: `to authenticated with check (bucket_id = …)`)
--                                               → (rule) AND public.is_active_staff()
-- Rules that already check identity (is_active_staff, is_admin, auth.uid() — e.g.
-- each staff member's own email drafts) and public/anon read rules are left alone.
-- Re-running changes nothing: rewritten rules no longer match either test.
-- Dashboard-made policies written another way are NOT caught — run the after-run checks below.
do $$
declare
  p record;
  q text;
  c text;
  n int := 0;
  identity_check constant text := '(is_active_staff|is_admin|auth\.uid\(\))';
  any_signed_in  constant text := 'auth\.role\(\)\s*=\s*''authenticated''(::text)?';
begin
  for p in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
  loop
    q := regexp_replace(p.qual,       any_signed_in, 'public.is_active_staff()', 'g');
    c := regexp_replace(p.with_check, any_signed_in, 'public.is_active_staff()', 'g');

    if p.roles = array['authenticated']::name[] then
      if q is not null and q !~ identity_check then q := format('((%s) AND public.is_active_staff())', q); end if;
      if c is not null and c !~ identity_check then c := format('((%s) AND public.is_active_staff())', c); end if;
    end if;

    if q is distinct from p.qual or c is distinct from p.with_check then
      begin
        execute format('alter policy %I on %I.%I%s%s',
          p.policyname, p.schemaname, p.tablename,
          case when q is not null then format(' using (%s)', q) else '' end,
          case when c is not null then format(' with check (%s)', c) else '' end);
        n := n + 1;
        raise notice 'staff-only: %.% · "%" (%)', p.schemaname, p.tablename, p.policyname, p.cmd;
      exception when others then
        raise warning 'could not rewrite %.% · "%": % — fix this policy by hand', p.schemaname, p.tablename, p.policyname, sqlerrm;
      end;
    end if;
  end loop;
  raise notice '% policies made staff-only', n;
end $$;

-- ── Remove v1 (Supabase-OTP) sign-in functions ────────────────
drop function if exists public.member_claim(uuid);
drop function if exists public.app_caller_email();
drop function if exists public.app_caller_phone();
drop function if exists public.app_auth_user_for_identifier(text, text);
drop function if exists public.app_members_for_identifier(text, text);
drop function if exists public.app_rate_check(text, text, int, interval);
drop function if exists public.member_me();
drop function if exists public.member_update_me(text, boolean, boolean, boolean, boolean);
drop function if exists public.member_directory(text);
drop function if exists public.app_member_matches(public.church_members, text, text);
drop function if exists public.app_phone10(text);

-- ── 2. Member record columns ──────────────────────────────────
alter table public.church_members
  add column if not exists auth_user_id         uuid,          -- the record's own app login
  add column if not exists app_linked_at        timestamptz,
  add column if not exists app_login_email      text,          -- m-<random>@<domain>; never shown to anyone
  add column if not exists app_access           text not null default 'auto',   -- auto | allow | deny (office override)
  add column if not exists app_not_before       timestamptz,   -- sessions minted before this don't count
  add column if not exists app_mint_lease_until timestamptz,   -- one sign-in minting at a time per record
  add column if not exists app_mint_lease       uuid,          -- … and which sign-in holds it
  add column if not exists directory_listed     boolean not null default false,   -- legacy opt-in flag (unused by the directory since 2026-09-15)
  add column if not exists directory_hidden     boolean not null default false,   -- the member took themselves out of the directory
  add column if not exists share_email          boolean not null default false,
  add column if not exists share_phone          boolean not null default false,
  add column if not exists share_photo          boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'church_members_auth_user_fk') then
    alter table public.church_members
      add constraint church_members_auth_user_fk
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'church_members_app_access_check') then
    alter table public.church_members
      add constraint church_members_app_access_check check (app_access in ('auto', 'allow', 'deny'));
  end if;
end $$;

-- one login ↔ one member record; one address ↔ one record
create unique index if not exists church_members_auth_user_id_key
  on public.church_members(auth_user_id) where auth_user_id is not null;
create unique index if not exists church_members_app_login_email_key
  on public.church_members(app_login_email) where app_login_email is not null;

-- ── 3. Contacts, eligibility, matching ────────────────────────
-- Email: trimmed (space, \t\n\v\f\r), plain ASCII address, lowercased. Anything unusual → null.
-- Twin: functions/_shared/memberContact.ts normEmail. Keep them identical.
create or replace function public.app_norm_email(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select lower(v)
    from (select btrim(p, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) as v) s
   where v ~ '^[A-Za-z0-9.!#$%&''*+/=?^_{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
     and length(v) <= 254
$$;

-- Phone: one US/NANP number written with digits, spaces, + ( ) . - only → its 10 digits; else null.
-- Rejects extensions, several numbers, N11/555 exchanges, repeated digits, toll-free/premium/
-- non-geographic area codes, and Caribbean/Atlantic countries that share +1 (billed as international).
-- US territories and Canada are allowed. Twin: memberContact.ts normPhone.
create or replace function public.app_norm_phone(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select d
    from (select case when length(x) = 11 and left(x, 1) = '1' then substr(x, 2) else x end as d
            from (select regexp_replace(v, '[^0-9]', '', 'g') as x
                    from (select btrim(p, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) as v) t
                   where v ~ '^[0-9+(). -]*$') a) b
   where d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
     and substr(d, 2, 2) <> '11' and substr(d, 5, 2) <> '11'
     and substr(d, 4, 3) <> '555'
     and d !~ '^(.)\1+$'
     and left(d, 3) not in (
       '800','833','844','855','866','877','888','900','500','533','544','566','577','588','600','700','710',
       '242','246','264','268','284','345','441','473','649','658','664','721','758','767','784',
       '809','829','849','868','869','876')
$$;

-- Who may use the app. Office override first (app_access), then: active, not a prospect or an
-- inactive member, not a child (family position), and 18+ when a birthday is on file.
create or replace function public.app_member_is_eligible(m public.church_members)
returns boolean language sql stable set search_path = ''
as $$
  select m.app_access <> 'deny'
     and coalesce(nullif(btrim(m.status), ''), 'Active') ilike 'active'
     and m.active is not false
     and coalesce(btrim(m.record_type), '') not ilike 'prospect'
     and coalesce(btrim(m.member_status), '') not ilike 'inactive'
     and (m.app_access = 'allow'
          or (coalesce(btrim(m.family_position), '') not ilike 'child'
              and (m.birthday is null or m.birthday <= (current_date - interval '18 years')::date)))
$$;

-- Known to be an adult (used when several records share one contact).
create or replace function public.app_member_is_known_adult(m public.church_members)
returns boolean language sql stable set search_path = ''
as $$
  select m.app_access = 'allow'
      or (m.birthday is not null and m.birthday <= (current_date - interval '18 years')::date)
      or (m.birthday is null and coalesce(btrim(m.family_position), '') ~* '^(head|spouse)$')
$$;

create index if not exists church_members_norm_email_idx on public.church_members (public.app_norm_email(email));
create index if not exists church_members_norm_phone_idx on public.church_members (public.app_norm_phone(phone));

-- Keep the login columns honest through Pillar edits and imports:
--  · staff (API roles) can't create or point a record at a login, set its login address or take a
--    sign-in lease — only the sign-in functions can; staff may unlink (auth_user_id → null) and
--    revoke (app_not_before)
--  · app_not_before never moves backwards (and never into the future); it is stamped when the
--    NORMALISED email/phone actually changes, when the record stops being eligible, or when the
--    login is unlinked by anything other than a sign-in replacing it under its own lease —
--    reformatting "(706) 555-0100" as "706-555-0100" signs no one out
--  · a changed contact stops being shared; losing eligibility, a revoke or an unlink stops all
--    sharing (the directory still lists the name unless the member hid themselves: directory_hidden
--    is the member's own choice and nothing here resets it)
create or replace function public.app_member_login_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_api           boolean := current_user in ('authenticated', 'anon');
  v_email_changed boolean;
  v_phone_changed boolean;
  v_lost          boolean;
  v_unlinked      boolean;
  v_revoked       boolean;
begin
  if tg_op = 'INSERT' then
    if v_api then
      new.auth_user_id := null; new.app_linked_at := null; new.app_login_email := null;
      new.app_mint_lease_until := null; new.app_mint_lease := null; new.app_not_before := null;
      new.directory_listed := false; new.share_email := false; new.share_phone := false; new.share_photo := false;
    end if;
    return new;
  end if;

  v_email_changed := public.app_norm_email(new.email) is distinct from public.app_norm_email(old.email);
  v_phone_changed := public.app_norm_phone(new.phone) is distinct from public.app_norm_phone(old.phone);
  if v_api then
    if new.auth_user_id is not null then new.auth_user_id := old.auth_user_id; end if;
    new.app_linked_at        := case when new.auth_user_id is null then null else old.app_linked_at end;
    new.app_login_email      := old.app_login_email;
    new.app_mint_lease_until := old.app_mint_lease_until;
    new.app_mint_lease       := old.app_mint_lease;
  end if;
  -- (greatest/least skip NULLs, so keep "never set" as NULL explicitly)
  new.app_not_before := case when old.app_not_before is null and new.app_not_before is null then null
                             else least(greatest(old.app_not_before, new.app_not_before), clock_timestamp()) end;
  v_revoked  := new.app_not_before is distinct from old.app_not_before;
  v_lost     := public.app_member_is_eligible(old) and not public.app_member_is_eligible(new);
  v_unlinked := old.auth_user_id is not null and new.auth_user_id is null
                and (v_api or old.app_mint_lease_until is null or old.app_mint_lease_until < now());
  if v_email_changed or v_phone_changed or v_lost or v_unlinked then
    new.app_not_before := clock_timestamp();
  end if;
  if v_email_changed or (new.email is distinct from old.email and public.app_norm_email(new.email) is null) then
    new.share_email := false;
  end if;
  if v_phone_changed or (new.phone is distinct from old.phone and public.app_norm_phone(new.phone) is null) then
    new.share_phone := false;
  end if;
  if v_lost or v_unlinked or v_revoked then
    new.directory_listed := false; new.share_email := false; new.share_phone := false; new.share_photo := false;
  end if;
  return new;
end $$;
drop trigger if exists trg_members_app_login_guard on public.church_members;
create trigger trg_members_app_login_guard before insert or update on public.church_members
  for each row execute function public.app_member_login_guard();

-- ── 4. Service-role machinery ─────────────────────────────────
-- Settings the office can change (a Pillar screen can come later; SQL Editor until then).
create table if not exists public.app_auth_settings (
  id                    int primary key default 1 check (id = 1),
  signin_enabled        boolean not null default true,     -- kill switch
  sms_enabled           boolean not null default false,    -- texts need a Telnyx 10DLC campaign that includes 2FA (MEMBER-SIGN-IN.md)
  email_enabled         boolean not null default true,
  sms_per_hour          int not null default 40,
  sms_per_day           int not null default 150,
  email_per_hour        int not null default 60,
  email_per_day         int not null default 250,
  breaker_fails_hour    int not null default 50,           -- failed guesses at live codes
  breaker_fails_day     int not null default 150,
  breaker_open_until    timestamptz,                       -- set automatically; clear to reopen
  updated_at            timestamptz not null default now()
);
insert into public.app_auth_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_auth_settings enable row level security;
drop policy if exists "staff manage app auth settings" on public.app_auth_settings;
create policy "staff manage app auth settings" on public.app_auth_settings
  for all using (public.is_active_staff()) with check (public.is_active_staff());

-- Contacts that must never sign anyone in (e.g. the church office number typed onto many records).
create table if not exists public.app_contact_blocklist (
  contact_norm text primary key,          -- app_norm_email(...) or app_norm_phone(...)
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.app_contact_blocklist drop constraint if exists app_contact_blocklist_norm_check;
alter table public.app_contact_blocklist add constraint app_contact_blocklist_norm_check
  check (coalesce(contact_norm = coalesce(public.app_norm_email(contact_norm), public.app_norm_phone(contact_norm)), false));
alter table public.app_contact_blocklist enable row level security;
drop policy if exists "staff manage contact blocklist" on public.app_contact_blocklist;
create policy "staff manage contact blocklist" on public.app_contact_blocklist
  for all using (public.is_active_staff()) with check (public.is_active_staff());

-- Rate limiting. Keys are HMACs made with the Edge Functions' secret key (never raw contacts/IPs).
create table if not exists public.app_rate_events (
  id         bigserial primary key,
  bucket     text        not null,
  key_hash   text        not null,
  created_at timestamptz not null default now()
);
create index if not exists app_rate_events_lookup on public.app_rate_events (bucket, key_hash, created_at desc);
alter table public.app_rate_events enable row level security;   -- no policies: service role only

-- All-or-nothing: p_hits = [{bucket, key, limit, window_seconds}, …]. Locks every (bucket, key) in a
-- fixed order, returns the first bucket already at its limit (recording nothing), or null after
-- recording one event per bucket. Parallel requests can't slip past a limit.
create or replace function public.app_rate_hit_many(p_hits jsonb)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare h record; v_n int;
begin
  for h in select distinct x.bucket, x.key from jsonb_to_recordset(p_hits) as x(bucket text, key text) order by 1, 2 loop
    perform pg_advisory_xact_lock(hashtextextended(h.bucket || ':' || h.key, 0));
  end loop;
  for h in select * from jsonb_to_recordset(p_hits) as x(bucket text, key text, "limit" int, window_seconds int) loop
    select count(*) into v_n from public.app_rate_events e
     where e.bucket = h.bucket and e.key_hash = h.key
       and e.created_at > now() - make_interval(secs => h.window_seconds);
    if v_n >= h."limit" then return h.bucket; end if;
  end loop;
  insert into public.app_rate_events (bucket, key_hash)
    select distinct x.bucket, x.key from jsonb_to_recordset(p_hits) as x(bucket text, key text);
  return null;
end $$;

-- Staff can clear a contact's or IP's limits after a targeted lockout (key = HMAC from the logs).
create or replace function public.app_rate_clear(p_key_hash text)
returns int language plpgsql volatile security definer set search_path = ''
as $$
declare n int;
begin
  if auth.uid() is not null and not public.is_active_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  delete from public.app_rate_events where key_hash = p_key_hash;
  get diagnostics n = row_count;
  return n;
end $$;

-- Audit trail without raw contacts, codes or tokens.
create table if not exists public.member_auth_events (
  id            bigserial primary key,
  event         text not null,
  channel       text,
  contact_ref   text,          -- first 16 hex of the contact HMAC
  ip_ref        text,
  member_id     uuid,
  outcome       text,
  provider_code text,
  created_at    timestamptz not null default now()
);
create index if not exists member_auth_events_recent on public.member_auth_events (created_at desc);
alter table public.member_auth_events enable row level security;
drop policy if exists "staff read member auth events" on public.member_auth_events;
create policy "staff read member auth events" on public.member_auth_events for select using (public.is_active_staff());

create or replace function public.app_auth_config()
returns jsonb language sql stable security definer set search_path = ''
as $$ select to_jsonb(s) from public.app_auth_settings s where id = 1 $$;

-- Which records a verified contact may sign in to.
--  · exactly one contact (email or phone), not blocklisted
--  · eligible records carrying it (and whose contacts didn't change after p_since, when given)
--  · not blocked by a banned app login
--  · one match → that record, even if its age is unknown
--  · several → only known adults, and only if they are one household; none if > 8 matches
-- Postgres refuses to replace a function whose result columns changed, so the old one goes first.
-- Nothing holds on to it at rest: the sign-in functions look it up by name when a code is asked for,
-- and the grant below is re-made in the same run.
drop function if exists public.app_login_candidates(text, text, timestamptz);

create or replace function public.app_login_candidates(p_email text, p_phone text, p_since timestamptz default null)
returns table (member_id uuid, name text, household text, matched_count int)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text := public.app_norm_email(p_email);
  v_phone text := public.app_norm_phone(p_phone);
begin
  if (v_email is null) = (v_phone is null) then return; end if;
  if exists (select 1 from public.app_contact_blocklist b where b.contact_norm = coalesce(v_email, v_phone)) then return; end if;
  return query
  with matched as (
    select m.id, m.name, coalesce(nullif(btrim(m.family_id), ''), 'self:' || m.id::text) as household,
           public.app_member_is_known_adult(m) as known_adult
      from public.church_members m
     where (case when v_email is not null then public.app_norm_email(m.email) = v_email
                 else public.app_norm_phone(m.phone) = v_phone end)
       and public.app_member_is_eligible(m)
       and (p_since is null or coalesce(m.app_not_before, '-infinity'::timestamptz) < p_since)
       -- a banned app login (Supabase → Users → Ban) blocks that record from signing in
       and not exists (select 1 from auth.users u
                        where (u.id = m.auth_user_id or u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text)
                          and u.banned_until > now())
  ), stats as (
    select count(*)::int as n,
           (count(distinct x.household) filter (where x.known_adult))::int as adult_households
      from matched x
  ), offered as (
    select x.id, x.name, x.household
      from matched x cross join stats s
     where s.n between 1 and 8
       and (s.n = 1 or (x.known_adult and s.adult_households = 1))
  ), household as (
    -- One address for the whole family: the other ADULTS on that family record who have no email and
    -- no number of their own are offered too, so a wife on her husband's address can sign in as
    -- herself (user, 2026-09-15). They must share a real family_id and have nothing of their own.
    select m.id, m.name, nullif(btrim(m.family_id), '') as household
      from public.church_members m
     where nullif(btrim(m.family_id), '') is not null
       and exists (select 1 from offered o where o.household = nullif(btrim(m.family_id), ''))
       and not exists (select 1 from offered o where o.id = m.id)
       and public.app_norm_email(m.email) is null
       and public.app_norm_phone(m.phone) is null
       and public.app_member_is_eligible(m)
       and public.app_member_is_known_adult(m)
       and (p_since is null or coalesce(m.app_not_before, '-infinity'::timestamptz) < p_since)
       and not exists (select 1 from auth.users u
                        where (u.id = m.auth_user_id or u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text)
                          and u.banned_until > now())
  ), everyone as (
    select * from offered union all select * from household
  ), total as (
    -- how many people this contact belongs to, offered or not: one means a straight sign-in,
    -- more means the app asks which person it is (member-verify-code)
    select ((select count(*) from matched) + (select count(*) from household))::int as n
  )
  select e.id, e.name, e.household, t.n
    from everyone e cross join total t
   where t.n between 1 and 8
   order by e.name, e.id;
end $$;

-- One-time codes: one live code per contact; only HMACs stored; 5 tries; single use.
create table if not exists public.member_login_codes (
  contact_id text primary key check (contact_id ~ '^[0-9a-f]{64}$'),
  channel    text not null check (channel in ('sms', 'email')),
  code_mac   text not null check (code_mac ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts   smallint not null default 0 check (attempts between 0 and 5),
  used_at    timestamptz
);
alter table public.member_login_codes enable row level security;   -- service role only

create or replace function public.app_code_issue(p_contact_id text, p_channel text, p_code_mac text, p_ttl_seconds int)
returns timestamptz language sql volatile security definer set search_path = ''
as $$
  insert into public.member_login_codes (contact_id, channel, code_mac, created_at, expires_at, attempts, used_at)
  values (p_contact_id, p_channel, p_code_mac, now(), now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 600)), 0, null)
  on conflict (contact_id) do update
     set channel = excluded.channel, code_mac = excluded.code_mac, created_at = excluded.created_at,
         expires_at = excluded.expires_at, attempts = 0, used_at = null
  returning created_at
$$;

-- One statement: compare, count the try, mark used. No row = no live code (or out of tries).
create or replace function public.app_code_consume(p_contact_id text, p_code_mac text)
returns table (ok boolean, channel text, code_created_at timestamptz)
language sql volatile security definer set search_path = ''
as $$
  update public.member_login_codes c
     set attempts = c.attempts + 1,
         used_at  = case when c.code_mac = p_code_mac then now() end
   where c.contact_id = p_contact_id
     and c.used_at is null and c.expires_at > now() and c.attempts < 5
  returning c.used_at is not null, c.channel, c.created_at
$$;

-- "Which one is you?" tickets: single use, 5 minutes, bound to the verified contact.
create table if not exists public.member_choice_tickets (
  ticket_hash     text primary key check (ticket_hash ~ '^[0-9a-f]{64}$'),
  contact_id      text not null check (contact_id ~ '^[0-9a-f]{64}$'),
  channel         text not null check (channel in ('sms', 'email')),
  member_ids      uuid[] not null check (cardinality(member_ids) between 1 and 8),
  code_created_at timestamptz not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz
);
alter table public.member_choice_tickets enable row level security;

create or replace function public.app_ticket_create(p_ticket_hash text, p_contact_id text, p_channel text,
  p_member_ids uuid[], p_code_created_at timestamptz, p_ttl_seconds int)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.member_choice_tickets (ticket_hash, contact_id, channel, member_ids, code_created_at, expires_at)
  values (p_ticket_hash, p_contact_id, p_channel, p_member_ids, p_code_created_at,
          now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 600)))
$$;

create or replace function public.app_ticket_use(p_ticket_hash text, p_contact_id text)
returns table (member_ids uuid[], channel text, code_created_at timestamptz)
language sql volatile security definer set search_path = ''
as $$
  update public.member_choice_tickets t set used_at = now()
   where t.ticket_hash = p_ticket_hash and t.contact_id = p_contact_id
     and t.used_at is null and t.expires_at > now()
  returning t.member_ids, t.channel, t.code_created_at
$$;

-- Minting a session for a record's own login.
--   prepare → take a 20 s lease (one mint per record at a time); give the record a login address
--   login_ok → its linked login is exactly what we made and nothing has touched it since
--   users   → every login tagged for this record (to clean up leftovers)
--   rotate  → a fresh random address, after the old login was deleted
--   link    → attach a new login, re-checking the contact still leads to this record
create or replace function public.app_member_login_ok(p_member_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.church_members m
      join auth.users u on u.id = m.auth_user_id
     where m.id = p_member_id
       and m.app_login_email is not null
       and u.email = m.app_login_email
       and u.email_confirmed_at is not null
       and coalesce(u.phone, '') = '' and u.phone_confirmed_at is null
       and u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
       and coalesce(u.is_sso_user, false) = false
       and coalesce(u.is_anonymous, false) = false
       and u.created_at > coalesce(m.app_not_before, '-infinity'::timestamptz)
       and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
       and not exists (select 1 from public.staff s where s.id = u.id))
$$;

do $$ begin
  -- an earlier draft returned three columns; the lease token is new
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'app_member_login_prepare'
                and pg_get_function_result(p.oid) not like '%lease%') then
    drop function public.app_member_login_prepare(uuid, text);
  end if;
end $$;
drop function if exists public.app_member_login_release(uuid);
drop function if exists public.app_member_login_users(uuid);
drop function if exists public.app_member_login_rotate(uuid, text);
drop function if exists public.app_member_link_login(uuid, uuid, text, text, timestamptz);

create or replace function public.app_member_login_prepare(p_member_id uuid, p_new_login_email text)
returns table (login_email text, auth_user_id uuid, login_ok boolean, lease uuid)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare v_email text; v_uid uuid; v_lease uuid := gen_random_uuid();
begin
  update public.church_members c
     set app_mint_lease_until = now() + interval '20 seconds',
         app_mint_lease       = v_lease,
         app_login_email      = coalesce(c.app_login_email, lower(p_new_login_email))
   where c.id = p_member_id
     and (c.app_mint_lease_until is null or c.app_mint_lease_until < now())
  returning c.app_login_email, c.auth_user_id into v_email, v_uid;
  if not found then return; end if;       -- no such record, or another sign-in holds it right now
  return query select v_email, v_uid, public.app_member_login_ok(p_member_id), v_lease;
end $$;

-- Only the holder can release or extend its lease (a slow sign-in can't free someone else's).
create or replace function public.app_member_login_release(p_member_id uuid, p_lease uuid)
returns void language sql volatile security definer set search_path = ''
as $$
  update public.church_members set app_mint_lease_until = null, app_mint_lease = null
   where id = p_member_id and app_mint_lease = p_lease
$$;

-- After a successful mint, keep the record briefly so a second sign-in doesn't replace the
-- one-time token before the first device redeems it.
create or replace function public.app_member_login_hold(p_member_id uuid, p_lease uuid, p_seconds int)
returns void language sql volatile security definer set search_path = ''
as $$
  update public.church_members set app_mint_lease_until = now() + make_interval(secs => least(greatest(p_seconds, 1), 30))
   where id = p_member_id and app_mint_lease = p_lease
$$;

-- Logins made for this record (tagged with its id) — never staff logins. Banned ones are flagged:
-- sign-in refuses rather than replacing them.
create or replace function public.app_member_login_users(p_member_id uuid)
returns table (auth_user_id uuid, banned boolean)
language sql stable security definer set search_path = ''
as $$
  select u.id, coalesce(u.banned_until > now(), false)
    from auth.users u
   where u.raw_app_meta_data ->> 'bbc_member_id' = p_member_id::text
     and not exists (select 1 from public.staff s where s.id = u.id)
$$;

-- A fresh random address for a new login. Also detaches a link to anything that isn't this
-- record's own login (never deletes it).
create or replace function public.app_member_login_rotate(p_member_id uuid, p_new_login_email text, p_lease uuid)
returns text language sql volatile security definer set search_path = ''
as $$
  update public.church_members m
     set app_login_email = lower(p_new_login_email), auth_user_id = null, app_linked_at = null
   where m.id = p_member_id
     and m.app_mint_lease = p_lease and m.app_mint_lease_until > now()
     and (m.auth_user_id is null
          or not exists (select 1 from auth.users u
                          where u.id = m.auth_user_id
                            and u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text
                            and not exists (select 1 from public.staff s where s.id = u.id)))
  returning m.app_login_email
$$;

create or replace function public.app_member_link_login(p_member_id uuid, p_auth_user_id uuid,
  p_email text, p_phone text, p_since timestamptz, p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform 1 from public.church_members where id = p_member_id for update;
  if not exists (select 1 from public.app_login_candidates(p_email, p_phone, p_since) c where c.member_id = p_member_id) then
    return false;
  end if;
  update public.church_members m
     set auth_user_id = p_auth_user_id, app_linked_at = now()
   where m.id = p_member_id
     and m.auth_user_id is null
     and m.app_mint_lease = p_lease and m.app_mint_lease_until > now()
     and exists (select 1 from auth.users u
                  where u.id = p_auth_user_id
                    and u.email = m.app_login_email
                    and u.email_confirmed_at is not null
                    and coalesce(u.phone, '') = ''
                    and u.raw_app_meta_data ->> 'bbc_member_id' = p_member_id::text)
     and not exists (select 1 from public.staff s where s.id = p_auth_user_id);
  return found;
end $$;

-- Grants: returned with the session token; the new session proves itself by redeeming one.
-- They carry when the code was issued and its channel: a session only counts if nothing about the
-- record changed after that moment, and it is re-checked against that channel on every call.
create table if not exists public.member_login_grants (
  grant_hash      text primary key check (grant_hash ~ '^[0-9a-f]{64}$'),
  member_id       uuid not null references public.church_members(id) on delete cascade,
  auth_user_id    uuid not null,
  code_created_at timestamptz not null,
  channel         text not null check (channel in ('sms', 'email')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  session_id      uuid
);
alter table public.member_login_grants enable row level security;

drop function if exists public.app_grant_create(text, uuid, uuid, int);
create or replace function public.app_grant_create(p_grant_hash text, p_member_id uuid, p_auth_user_id uuid,
  p_ttl_seconds int, p_code_created_at timestamptz, p_channel text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform 1 from public.church_members where id = p_member_id for update;
  insert into public.member_login_grants (grant_hash, member_id, auth_user_id, code_created_at, channel, expires_at)
  select p_grant_hash, p_member_id, p_auth_user_id, p_code_created_at, p_channel,
         now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 600))
    from public.church_members m
   where m.id = p_member_id
     and m.auth_user_id = p_auth_user_id
     and coalesce(m.app_not_before, '-infinity'::timestamptz) < p_code_created_at
     and public.app_member_login_ok(p_member_id);
  return found;
end $$;

-- Sessions that came through the church code flow. The member RPCs serve only these.
create table if not exists public.member_sessions (
  session_id   uuid primary key,
  member_id    uuid not null references public.church_members(id) on delete cascade,
  auth_user_id uuid not null,
  minted_at    timestamptz not null,               -- when the code behind it was issued
  channel      text not null check (channel in ('sms', 'email')),
  bound_at     timestamptz not null default now(),
  revoked_at   timestamptz
);
create index if not exists member_sessions_member on public.member_sessions (member_id) where revoked_at is null;
alter table public.member_sessions enable row level security;

-- "Contact the church office" — for people whose contact details aren't on file. Staff confirm the
-- person out of band (a number already on file, or in person) BEFORE adding a contact: a contact on
-- a record IS the sign-in credential.
create table if not exists public.member_access_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text not null,
  message    text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.staff(id) on delete set null
);
alter table public.member_access_requests enable row level security;
drop policy if exists "staff manage access requests" on public.member_access_requests;
drop policy if exists "staff read access requests" on public.member_access_requests;
drop policy if exists "staff handle access requests" on public.member_access_requests;
create policy "staff read access requests" on public.member_access_requests
  for select using (public.is_active_staff());
create policy "staff handle access requests" on public.member_access_requests
  for update using (public.is_active_staff()) with check (public.is_active_staff());

-- Delete housekeeping (called now and then by the Edge Functions).
create or replace function public.app_auth_purge()
returns void language sql volatile security definer set search_path = ''
as $$
  delete from public.app_rate_events       where created_at < now() - interval '8 days';
  delete from public.member_login_codes    where expires_at < now() - interval '1 day';
  delete from public.member_choice_tickets where expires_at < now() - interval '1 day';
  delete from public.member_login_grants   where expires_at < now() - interval '1 day';
  delete from public.member_auth_events    where created_at < now() - interval '90 days';
  delete from public.member_sessions       where revoked_at < now() - interval '30 days';
  delete from public.member_access_requests where handled_at < now() - interval '90 days';
$$;

create or replace function public.app_auth_log(p_event text, p_channel text, p_contact_ref text, p_ip_ref text,
  p_member_id uuid, p_outcome text, p_provider_code text)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.member_auth_events (event, channel, contact_ref, ip_ref, member_id, outcome, provider_code)
  values (left(p_event, 40), left(p_channel, 10), left(p_contact_ref, 16), left(p_ip_ref, 16), p_member_id,
          left(p_outcome, 80), left(p_provider_code, 40))
$$;

create or replace function public.app_breaker_open(p_minutes int)
returns void language sql volatile security definer set search_path = ''
as $$
  update public.app_auth_settings
     set breaker_open_until = greatest(coalesce(breaker_open_until, now()), now() + make_interval(mins => p_minutes)),
         updated_at = now()
   where id = 1
$$;

-- Logins whose record is gone (a service job can delete them with admin.deleteUser).
create or replace function public.app_orphan_member_logins()
returns table (auth_user_id uuid, member_id text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.raw_app_meta_data ->> 'bbc_member_id', u.created_at, u.last_sign_in_at
    from auth.users u
   where u.raw_app_meta_data ? 'bbc_member_id'
     and not exists (select 1 from public.church_members m where m.auth_user_id = u.id)
     and u.created_at < now() - interval '1 hour'
$$;

-- member-delete-account: the member's own login goes and they leave the directory (the app says so);
-- the church record stays.
create or replace function public.app_member_forget_login(p_member_id uuid, p_auth_user_id uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.member_sessions set revoked_at = now() where member_id = p_member_id and revoked_at is null;
  update public.church_members
     set auth_user_id = null, app_linked_at = null, app_not_before = clock_timestamp(),
         directory_listed = false, share_email = false, share_phone = false, share_photo = false,
         directory_hidden = true
   where id = p_member_id and (auth_user_id = p_auth_user_id or auth_user_id is null);
  return found;
end $$;

-- Realm imports (functions/admin-import-members). New people are inserted as given. For people
-- already in Pillar an import never overwrites a contact the office has (a contact is a sign-in
-- credential), never reactivates someone the office marked inactive, and keeps households made in
-- Pillar; it only fills blanks, refreshes name/address/household name, and marks deaths.
create or replace function public.app_import_members(p_rows jsonb)
returns int language plpgsql volatile security definer set search_path = ''
as $$
declare n int;
begin
  insert into public.church_members as cm (external_id, name, email, phone, address, family_id, family_name, active, status)
  select r.external_id, r.name, r.email, r.phone, r.address, r.family_id, r.family_name,
         coalesce(r.active, true), coalesce(r.status, 'Active')
    from jsonb_to_recordset(p_rows) as r(external_id text, name text, email text, phone text, address text,
                                         family_id text, family_name text, active boolean, status text)
   where nullif(btrim(r.external_id), '') is not null and nullif(btrim(r.name), '') is not null
  on conflict (external_id) do update set
    name        = excluded.name,
    address     = coalesce(excluded.address, cm.address),
    family_name = coalesce(excluded.family_name, cm.family_name),
    email       = coalesce(nullif(btrim(cm.email), ''), excluded.email),
    phone       = coalesce(nullif(btrim(cm.phone), ''), excluded.phone),
    status      = case when excluded.status = 'Inactive' then 'Inactive' else cm.status end,
    active      = case when excluded.active is false then false else cm.active end,
    family_id   = case when cm.family_id like 'h-%' then cm.family_id else coalesce(excluded.family_id, cm.family_id) end,
    updated_at  = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 5. What a signed-in member can do ─────────────────────────
-- Members get NO table access (section 1). These functions are the whole surface.

-- The one gate. Returns the caller's member id only for a session that
--  · is an OTP session (amr: otp, optionally totp) — not password, OAuth, SSO, passkey …
--  · was bound through a grant (member_sessions) whose code predates any change to the record,
--    and the contact it came through still leads to this record
--  · still exists in auth.sessions (signed-out sessions stop at once, not at token expiry)
--  · belongs to the record's own untouched login: same random address, no phone, no other
--    identities, not banned/deleted, not staff — and the record is still eligible
create or replace function public.app_caller_member_id()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid    uuid  := auth.uid();
  v_claims jsonb := auth.jwt();
  v_amr    jsonb;
  v_sid    uuid;
  v_id     uuid;
begin
  if v_uid is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then return null; end if;
  v_amr := case when jsonb_typeof(v_claims -> 'amr') = 'array' then v_claims -> 'amr' else '[]'::jsonb end;
  if not exists (select 1 from jsonb_array_elements(v_amr) a where jsonb_typeof(a) = 'object' and a ->> 'method' = 'otp')
     or exists (select 1 from jsonb_array_elements(v_amr) a
                 where jsonb_typeof(a) <> 'object' or coalesce(a ->> 'method', '') not in ('otp', 'totp')) then
    return null;
  end if;
  begin v_sid := (v_claims ->> 'session_id')::uuid; exception when others then return null; end;
  if v_sid is null then return null; end if;

  select m.id into v_id
    from public.member_sessions ms
    join public.church_members m on m.id = ms.member_id
    join auth.users u            on u.id = ms.auth_user_id
    join auth.sessions s         on s.id = ms.session_id
   where ms.session_id = v_sid
     and ms.auth_user_id = v_uid
     and ms.revoked_at is null
     and m.auth_user_id = v_uid
     and ms.minted_at > coalesce(m.app_not_before, '-infinity'::timestamptz)
     and public.app_member_is_eligible(m)
     -- the contact that signed them in still leads to this record (household split, blocklist, ban…)
     and exists (select 1 from public.app_login_candidates(
                   case when ms.channel = 'email' then m.email end,
                   case when ms.channel = 'sms' then m.phone end, null) c
                  where c.member_id = m.id)
     and s.user_id = v_uid
     and (s.not_after is null or s.not_after > now())
     and u.email = m.app_login_email
     and u.email_confirmed_at is not null
     and coalesce(u.phone, '') = '' and u.phone_confirmed_at is null
     and u.raw_app_meta_data ->> 'bbc_member_id' = m.id::text
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= now())
     and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
     and not exists (select 1 from public.staff st where st.id = v_uid);
  return v_id;
end $$;

-- The caller's own profile — safe fields only (never notes, tags, status or the login address).
create or replace function public.member_me()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'member_id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone,
           'address', m.address, 'photo_url', m.photo_url,
           'directory_listed', not m.directory_hidden, 'share_email', m.share_email,
           'share_phone', m.share_phone, 'share_photo', m.share_photo,
           'directory_allowed', m.include_directory is not false)
    from public.church_members m
   where m.id = public.app_caller_member_id()
$$;

-- Right after verifyOtp: turn the one-time grant into this session's membership. The session must
-- be an OTP session created after the grant was minted, on the grant's own login.
create or replace function public.member_bind_session(p_grant text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid    uuid  := auth.uid();
  v_claims jsonb := auth.jwt();
  v_sid    uuid;
  v_otp_at timestamptz;
  g        public.member_login_grants;
begin
  if v_uid is null or p_grant is null or length(p_grant) not between 32 and 128 then return null; end if;
  begin v_sid := (v_claims ->> 'session_id')::uuid; exception when others then return null; end;
  if v_sid is null then return null; end if;
  select to_timestamp(max((a ->> 'timestamp')::double precision)) into v_otp_at
    from jsonb_array_elements(case when jsonb_typeof(v_claims -> 'amr') = 'array' then v_claims -> 'amr' else '[]'::jsonb end) a
   where jsonb_typeof(a) = 'object' and a ->> 'method' = 'otp' and (a ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$';
  if v_otp_at is null then return null; end if;

  -- the same session asking again (a reply lost on a bad connection) just gets its profile
  if exists (select 1 from public.member_login_grants g0
              where g0.grant_hash = encode(sha256(convert_to(p_grant, 'UTF8')), 'hex')
                and g0.used_at is not null and g0.session_id = v_sid and g0.auth_user_id = v_uid) then
    return public.member_me();
  end if;

  update public.member_login_grants g2
     set used_at = now(), session_id = v_sid
   where g2.grant_hash = encode(sha256(convert_to(p_grant, 'UTF8')), 'hex')
     and g2.used_at is null and g2.expires_at > now()
     and g2.auth_user_id = v_uid
     and v_otp_at >= g2.created_at - interval '30 seconds'
  returning * into g;
  if g.grant_hash is null then return null; end if;

  insert into public.member_sessions (session_id, member_id, auth_user_id, minted_at, channel)
  values (v_sid, g.member_id, v_uid, g.code_created_at, g.channel)
  on conflict (session_id) do nothing;
  -- redeemed: end the short hold that protected this token from a second sign-in (not someone else's lease)
  update public.church_members
     set app_mint_lease_until = null, app_mint_lease = null
   where id = g.member_id and app_mint_lease_until <= g.created_at + interval '11 seconds';
  return public.member_me();
end $$;

-- Members edit their address and directory choices. Name, email and phone are the church's
-- record (and the sign-in credentials), so changes to those go through the office.
create or replace function public.member_update_me(
  p_address          text    default null,
  p_directory_listed boolean default null,
  p_share_email      boolean default null,
  p_share_phone      boolean default null,
  p_share_photo      boolean default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid := public.app_caller_member_id();
begin
  if v_id is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_address is not null and length(p_address) > 300 then
    raise exception 'address too long' using errcode = '22001';
  end if;
  update public.church_members set
    address          = case when p_address is null then address else nullif(btrim(p_address), '') end,
    directory_listed = coalesce(p_directory_listed, directory_listed),
    -- "Show me in the directory": everyone is in it until they turn this off
    directory_hidden = case when p_directory_listed is null then directory_hidden else not p_directory_listed end,
    share_email      = coalesce(p_share_email, share_email),
    share_phone      = coalesce(p_share_phone, share_phone),
    share_photo      = coalesce(p_share_photo, share_photo),
    updated_at       = now()
  where id = v_id;
  return public.member_me();
end $$;

-- The church directory: signed-in members only. Everyone on the church's list is in it by default
-- (user, 2026-09-15) — every eligible adult record the office hasn't marked "not in directory" —
-- unless the member took themselves out (directory_hidden, from My Profile or by deleting their app
-- account). Names for everyone; email, phone and photo only where that member chose to share them,
-- and only while their app login is intact. Photos are fetched one at a time (often stored inline).
create or replace function public.member_directory(p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, name text, email text, phone text, has_photo boolean)
language sql stable security definer set search_path = ''
as $$
  select m.id, btrim(m.name),
         case when m.share_email and l.intact then m.email end,
         case when m.share_phone and l.intact then m.phone end,
         (m.share_photo and l.intact and nullif(m.photo_url, '') is not null)
    from public.church_members m
    cross join lateral (
      select m.auth_user_id is not null
             and exists (select 1 from auth.users u where u.id = m.auth_user_id and u.email = m.app_login_email) as intact
    ) l
   where (select public.app_caller_member_id()) is not null
     and not m.directory_hidden
     and m.include_directory is not false
     and nullif(btrim(m.name), '') is not null
     and public.app_member_is_eligible(m)
     and (p_query is null or btrim(p_query) = ''
          or m.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by lower(btrim(m.name)), m.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.member_directory_photo(p_member_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select m.photo_url
    from public.church_members m
   where (select public.app_caller_member_id()) is not null
     and m.id = p_member_id
     and not m.directory_hidden and m.share_photo and m.include_directory is not false
     and m.auth_user_id is not null
     and exists (select 1 from auth.users u where u.id = m.auth_user_id and u.email = m.app_login_email)
     and public.app_member_is_eligible(m)
$$;

-- Someone's household and shepherding deacon, for their card on the Directory page: the names and
-- family positions of everyone else on their family record whom the directory may show (not hidden,
-- not kept out by the office, active, not a prospect or denied; a household's children included), and
-- the deacon's name only. Nothing when that person isn't in the directory, and nothing for anyone
-- but a member session.
create or replace function public.member_directory_family(p_member_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with target as (
    select m.id, m.deacon_id,
           coalesce(nullif(btrim(m.family_id), ''), lower(nullif(btrim(m.family_name), ''))) as fam_key
      from public.church_members m
     where (select public.app_caller_member_id()) is not null
       and m.id = p_member_id
       and not m.directory_hidden
       and m.include_directory is not false
       and nullif(btrim(m.name), '') is not null
       and public.app_member_is_eligible(m)
  )
  select jsonb_build_object(
    'family', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', btrim(f.name), 'position', nullif(btrim(f.family_position), ''))
                       order by case lower(coalesce(btrim(f.family_position), ''))
                                  when 'head' then 0 when 'spouse' then 1 when 'child' then 2 else 3 end,
                                lower(btrim(f.name)))
        from public.church_members f
       where t.fam_key is not null
         and f.id <> t.id
         and coalesce(nullif(btrim(f.family_id), ''), lower(nullif(btrim(f.family_name), ''))) = t.fam_key
         and nullif(btrim(f.name), '') is not null
         and not f.directory_hidden
         and f.include_directory is not false
         and f.app_access <> 'deny'
         and coalesce(nullif(btrim(f.status), ''), 'Active') ilike 'active'
         and f.active is not false
         and coalesce(btrim(f.record_type), '') not ilike 'prospect'
         and coalesce(btrim(f.member_status), '') not ilike 'inactive'
    ), '[]'::jsonb),
    'deacon', (
      select jsonb_build_object('name', btrim(d.name))
        from public.church_members d
       where d.id = t.deacon_id
         and nullif(btrim(d.name), '') is not null
         and d.active is not false
         and not d.directory_hidden            -- a deacon who hid themselves isn't named on anyone's card
         and d.include_directory is not false
    )
  )
  from target t
$$;

-- My Profile in the app: the member's household (everyone else on their family record, head first:
-- names and family positions only) and their shepherding deacon (deacon_id) with the phone and email
-- on the deacon's church record, so the family can reach them. Nothing for anyone but a member session.
create or replace function public.member_family()
returns jsonb language sql stable security definer set search_path = ''
as $$
  with me as (
    select m.id, m.deacon_id,
           coalesce(nullif(btrim(m.family_id), ''), lower(nullif(btrim(m.family_name), ''))) as fam_key
      from public.church_members m
     where m.id = public.app_caller_member_id()
  )
  select jsonb_build_object(
    'family', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'position', nullif(btrim(f.family_position), ''))
                       order by case lower(coalesce(btrim(f.family_position), ''))
                                  when 'head' then 0 when 'spouse' then 1 when 'child' then 2 else 3 end,
                                f.name)
        from public.church_members f
       where me.fam_key is not null
         and f.id <> me.id
         and coalesce(nullif(btrim(f.family_id), ''), lower(nullif(btrim(f.family_name), ''))) = me.fam_key
         and f.active is not false
         and coalesce(btrim(f.member_status), '') not ilike 'inactive'
         and nullif(btrim(f.name), '') is not null
    ), '[]'::jsonb),
    'deacon', (
      select jsonb_build_object('id', d.id, 'name', d.name,
                                'phone', nullif(btrim(d.phone), ''), 'email', nullif(btrim(d.email), ''))
        from public.church_members d
       where d.id = me.deacon_id and d.active is not false
    )
  )
  from me
$$;

-- Staff: sign a member out of the app everywhere now (keeps the login; they can sign in again).
create or replace function public.app_member_revoke_login(p_member_id uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_active_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  update public.member_sessions set revoked_at = now() where member_id = p_member_id and revoked_at is null;
  update public.church_members set app_not_before = clock_timestamp() where id = p_member_id;
  return found;
end $$;

-- ── Grants ────────────────────────────────────────────────────
revoke all on function
  public.app_rate_hit_many(jsonb), public.app_auth_config(), public.app_login_candidates(text, text, timestamptz),
  public.app_code_issue(text, text, text, int), public.app_code_consume(text, text),
  public.app_ticket_create(text, text, text, uuid[], timestamptz, int), public.app_ticket_use(text, text),
  public.app_member_login_ok(uuid), public.app_member_login_prepare(uuid, text), public.app_member_login_release(uuid, uuid),
  public.app_member_login_hold(uuid, uuid, int), public.app_member_login_users(uuid), public.app_member_login_rotate(uuid, text, uuid),
  public.app_member_link_login(uuid, uuid, text, text, timestamptz, uuid),
  public.app_grant_create(text, uuid, uuid, int, timestamptz, text), public.app_import_members(jsonb), public.app_auth_purge(),
  public.app_auth_log(text, text, text, text, uuid, text, text), public.app_breaker_open(int),
  public.app_orphan_member_logins(), public.app_member_forget_login(uuid, uuid), public.app_caller_member_id()
  from public, anon, authenticated;
grant execute on function
  public.app_rate_hit_many(jsonb), public.app_auth_config(), public.app_login_candidates(text, text, timestamptz),
  public.app_code_issue(text, text, text, int), public.app_code_consume(text, text),
  public.app_ticket_create(text, text, text, uuid[], timestamptz, int), public.app_ticket_use(text, text),
  public.app_member_login_ok(uuid), public.app_member_login_prepare(uuid, text), public.app_member_login_release(uuid, uuid),
  public.app_member_login_hold(uuid, uuid, int), public.app_member_login_users(uuid), public.app_member_login_rotate(uuid, text, uuid),
  public.app_member_link_login(uuid, uuid, text, text, timestamptz, uuid),
  public.app_grant_create(text, uuid, uuid, int, timestamptz, text), public.app_import_members(jsonb), public.app_auth_purge(),
  public.app_auth_log(text, text, text, text, uuid, text, text), public.app_breaker_open(int),
  public.app_orphan_member_logins(), public.app_member_forget_login(uuid, uuid)
  to service_role;

revoke all on function public.member_me(), public.member_bind_session(text),
  public.member_update_me(text, boolean, boolean, boolean, boolean),
  public.member_directory(text, int, int), public.member_directory_photo(uuid), public.member_directory_family(uuid),
  public.member_family() from public, anon;
grant execute on function public.member_me(), public.member_bind_session(text),
  public.member_update_me(text, boolean, boolean, boolean, boolean),
  public.member_directory(text, int, int), public.member_directory_photo(uuid), public.member_directory_family(uuid),
  public.member_family() to authenticated;

revoke all on function public.app_member_revoke_login(uuid), public.app_rate_clear(text) from public, anon;
grant execute on function public.app_member_revoke_login(uuid), public.app_rate_clear(text) to authenticated, service_role;

revoke all on table public.app_rate_events, public.member_login_codes, public.member_choice_tickets,
  public.member_login_grants, public.member_sessions from anon, authenticated;

commit;

-- ── AFTER RUNNING — confirm nothing is left open to non-staff logins (review every row) ──
-- 1. Policies still using the old test (should be ZERO rows):
--   select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies
--    where schemaname in ('public', 'storage')
--      and (coalesce(qual, '') ~ 'auth\.role\(\)\s*=\s*''authenticated''' or coalesce(with_check, '') ~ 'auth\.role\(\)\s*=\s*''authenticated''');
-- 2. Every policy that mentions auth. but not is_active_staff/is_admin (review by hand):
--   select schemaname, tablename, policyname, roles, qual, with_check from pg_policies
--    where schemaname in ('public', 'storage') and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'auth\.'
--      and (coalesce(qual, '') || coalesce(with_check, '')) !~* '(is_active_staff|is_admin)';
-- 3. Tables with row-level security OFF (anyone signed in can read them):
--   select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p') and not c.relrowsecurity;
-- 4. Views that skip row-level security and signed-in accounts can read:
--   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('v', 'm') and has_table_privilege('authenticated', c.oid, 'SELECT')
--      and (c.relkind = 'm' or not coalesce('security_invoker=true' = any (c.reloptions), false));
-- 5. SECURITY DEFINER functions any signed-in account can call (only the member_* ones, is_active_staff,
--    is_admin, app_member_revoke_login and app_rate_clear are expected):
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE');
-- 6. The staff table's own rules (no INSERT/UPDATE open to non-admins):
--   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'staff';
-- 7. The sign-in functions can read Supabase Auth's tables (expect three numbers, no error):
--   select (select count(*) from auth.users), (select count(*) from auth.sessions), (select count(*) from auth.identities);
