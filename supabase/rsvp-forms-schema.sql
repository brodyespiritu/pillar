-- ════════════════════════════════════════════════════════════
-- RSVP forms
--
-- Sign-up forms staff build on the RSVP page and the public fills in at
-- bethesda.rsvp. One open form fills the screen there; two or more (the
-- Wednesday dinner counts as one) show as boxes to choose between.
--
-- Staff read and write these directly (active staff only, like every other
-- table — see sms-recipient-guards.sql). The public never touches them: the
-- rsvp-forms edge function validates each submission and writes it under the
-- service role, and texts the people the form is linked to.
-- ════════════════════════════════════════════════════════════

create table if not exists public.rsvp_forms (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid references public.staff(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 600),
  -- [{ id, type: text|email|phone|number|textarea, label, required, key? }]
  fields      jsonb not null default '[]'::jsonb,
  -- Who is texted each response: [{ type: 'staff' | 'contact', id }]
  notify      jsonb not null default '[]'::jsonb,
  status      text not null default 'open' check (status in ('open', 'closed')),
  -- The public link: bethesda.rsvp/form/<slug>
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.rsvp_responses (
  id         uuid primary key default gen_random_uuid(),
  form_id    uuid not null references public.rsvp_forms(id) on delete cascade,
  answers    jsonb not null,               -- { fieldId: value }
  name       text,                         -- first + last, for lists
  phone      text,
  email      text,
  ip_hash    text,                         -- for rate limiting only, never shown
  notified   integer not null default 0,   -- texts delivered about this response
  created_at timestamptz not null default now()
);

create index if not exists idx_rsvp_forms_status on public.rsvp_forms (status, created_at);
create index if not exists idx_rsvp_responses_form on public.rsvp_responses (form_id, created_at desc);
create index if not exists idx_rsvp_responses_ip on public.rsvp_responses (form_id, ip_hash, created_at desc);

alter table public.rsvp_forms enable row level security;
alter table public.rsvp_responses enable row level security;

drop policy if exists "staff read rsvp forms"  on public.rsvp_forms;
drop policy if exists "staff write rsvp forms" on public.rsvp_forms;
create policy "staff read rsvp forms"  on public.rsvp_forms
  for select using ((select public.is_active_staff()));
create policy "staff write rsvp forms" on public.rsvp_forms
  for all using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

drop policy if exists "staff read rsvp responses"  on public.rsvp_responses;
drop policy if exists "staff write rsvp responses" on public.rsvp_responses;
create policy "staff read rsvp responses"  on public.rsvp_responses
  for select using ((select public.is_active_staff()));
create policy "staff write rsvp responses" on public.rsvp_responses
  for all using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

-- Checks:
--   select title, status, jsonb_array_length(fields) fields, jsonb_array_length(notify) notify from rsvp_forms;
--   select f.title, count(r.*) from rsvp_forms f left join rsvp_responses r on r.form_id = f.id group by 1;
