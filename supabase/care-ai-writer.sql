-- ============================================================
--  PILLAR · THE AI WRITER FOR CARE TEXTS
--  Run this in Supabase → SQL Editor (safe to run again)
-- ============================================================
--
-- Deacon alerts, the deacons' morning summary and the 8 AM / 4 PM staff
-- digest can be rewritten by AI (Claude, called from the care texts' own edge
-- functions) following rules the office writes and corrections it makes.
-- Pillar's own wording is always built first, and it is what goes out
-- whenever the AI's version fails a check, the AI is unavailable, or the
-- month's budget is spent.
--
--   care_ai_settings  one row: the mode, the rules for each audience, and the
--                     monthly spending cap
--   care_ai_drafts    every text the AI wrote, beside Pillar's wording, with
--                     what went out and why — the review list, and the spend
--   care_ai_examples  corrections: how a text should have read. The AI is
--                     shown these every time it writes.
--
-- Modes: 'off' (Pillar's wording only, no AI), 'practice' (the AI writes its
-- version alongside for review; Pillar's wording is still what is sent), and
-- 'live' (the AI's version is sent when it passes every check).
--
-- All three hold care details (names, hospitals, notes), so they are readable
-- only by staff with Cares access, the rule the texts to deacons already
-- follow (sms-deacon-visibility.sql), and changeable only by admins and staff
-- with Cares edit access. Drafts are written by the edge functions alone,
-- with the service role.

-- Cares access: an admin, or someone an admin gave Cares view or edit. A
-- member-app login is never staff, even if a staff row existed for it.
create or replace function public.can_read_cares() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.active is not false
       and (s.role ilike '%admin%' or coalesce(s.permissions ->> 'cares', 'none') in ('view', 'edit'))
    from public.staff s
    where s.id = auth.uid()
  ), false)
  and not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.raw_app_meta_data ? 'bbc_member_id'
  );
$$;
grant execute on function public.can_read_cares() to authenticated, service_role;

-- Changing the rules, the mode or the examples: an admin, or Cares edit.
create or replace function public.can_edit_cares() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.active is not false
       and (s.role ilike '%admin%' or coalesce(s.permissions ->> 'cares', 'none') = 'edit')
    from public.staff s
    where s.id = auth.uid()
  ), false)
  and not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.raw_app_meta_data ? 'bbc_member_id'
  );
$$;
grant execute on function public.can_edit_cares() to authenticated, service_role;

-- ── Settings: one row ──────────────────────────────────────────────────────
create table if not exists public.care_ai_settings (
  id               int primary key default 1 check (id = 1),
  mode             text not null default 'practice' check (mode in ('off', 'practice', 'live')),
  rules_deacons    text not null default '' check (length(rules_deacons) <= 6000),
  rules_staff      text not null default '' check (length(rules_staff) <= 6000),
  monthly_cap_usd  numeric(8,2) not null default 10 check (monthly_cap_usd >= 0 and monthly_cap_usd <= 500),
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
insert into public.care_ai_settings (id) values (1) on conflict (id) do nothing;

alter table public.care_ai_settings enable row level security;
drop policy if exists "cares read ai settings" on public.care_ai_settings;
create policy "cares read ai settings" on public.care_ai_settings
  for select using ((select public.can_read_cares()));
drop policy if exists "cares edit ai settings" on public.care_ai_settings;
create policy "cares edit ai settings" on public.care_ai_settings
  for update using ((select public.can_edit_cares())) with check ((select public.can_edit_cares()));

drop trigger if exists trg_touch_care_ai_settings on public.care_ai_settings;
create trigger trg_touch_care_ai_settings before update on public.care_ai_settings
  for each row execute function touch_updated_at();

-- ── Drafts: what the AI wrote, and what went out ───────────────────────────
create table if not exists public.care_ai_drafts (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  kind           text not null check (kind in ('deacon_alert', 'deacon_summary', 'staff_digest')),
  audience       text not null check (audience in ('deacons', 'staff')),
  label          text,                      -- "To Deacon Bob Jones", "Staff digest, 8:00 AM"
  -- One text, one draft: the half-hourly sweep and the instant alert can both
  -- reach the same alert, and a retried digest must not be written (and paid
  -- for) twice. Previews have no ref.
  ref            text unique,
  mode           text not null check (mode in ('practice', 'live', 'preview')),
  original       text not null,             -- Pillar's wording (a digest's lines, without its header)
  header         text,                      -- a digest's header, which Pillar adds itself
  people         text[] not null default '{}',   -- everyone the text names, for the checks
  written        text,                      -- the AI's wording; null when it could not write one
  used           text not null default 'pillar' check (used in ('ai', 'pillar')),
  problems       text[] not null default '{}',
  model          text,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(10,5) not null default 0
);
create index if not exists care_ai_drafts_created_idx on public.care_ai_drafts (created_at desc);

alter table public.care_ai_drafts enable row level security;
drop policy if exists "cares read ai drafts" on public.care_ai_drafts;
create policy "cares read ai drafts" on public.care_ai_drafts
  for select using ((select public.can_read_cares()));

-- ── Examples: how a text should have read ──────────────────────────────────
create table if not exists public.care_ai_examples (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  audience         text not null check (audience in ('deacons', 'staff')),
  kind             text check (kind in ('deacon_alert', 'deacon_summary', 'staff_digest')),
  original         text not null check (length(original) <= 8000),     -- Pillar's wording: the facts
  wrote            text check (length(wrote) <= 8000),                 -- what the AI wrote, if anything
  should_read      text not null check (length(should_read) between 1 and 8000),
  why              text check (length(why) <= 1000),
  draft_id         uuid references public.care_ai_drafts(id) on delete set null,
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_by_name  text
);
create index if not exists care_ai_examples_audience_idx on public.care_ai_examples (audience, created_at desc);

alter table public.care_ai_examples enable row level security;
drop policy if exists "cares read ai examples" on public.care_ai_examples;
create policy "cares read ai examples" on public.care_ai_examples
  for select using ((select public.can_read_cares()));
drop policy if exists "cares add ai examples" on public.care_ai_examples;
create policy "cares add ai examples" on public.care_ai_examples
  for insert with check ((select public.can_edit_cares()));
drop policy if exists "cares change ai examples" on public.care_ai_examples;
create policy "cares change ai examples" on public.care_ai_examples
  for update using ((select public.can_edit_cares())) with check ((select public.can_edit_cares()));
drop policy if exists "cares remove ai examples" on public.care_ai_examples;
create policy "cares remove ai examples" on public.care_ai_examples
  for delete using ((select public.can_edit_cares()));
