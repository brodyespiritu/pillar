-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

-- ── Calendar drag-and-drop templates ──────────────────────
-- Shared across staff: a template one person adds is on everyone's palette.
-- Run once in the Supabase SQL editor.

create table if not exists event_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text default 'Other',
  start_time  text,                       -- 'HH:MM'; null = all-day
  minutes     integer,                    -- duration; null = all-day
  location    text,
  sort        integer default 100,        -- palette order
  created_by  uuid references staff(id) on delete set null,
  created_at  timestamptz default now()
);

create index if not exists idx_event_templates_sort on event_templates(sort, title);

alter table event_templates enable row level security;

-- Postgres has no "create policy if not exists", so drop first to stay re-runnable.
drop policy if exists "staff read templates"  on event_templates;
drop policy if exists "staff write templates" on event_templates;

create policy "staff read templates"  on event_templates for select using ((select public.is_active_staff()));
create policy "staff write templates" on event_templates for all    using ((select public.is_active_staff()));

-- ── Seed the standing options ─────────────────────────────
-- Times are starting points — edit or delete any of these from the palette.
insert into event_templates (title, category, start_time, minutes, sort)
select * from (values
  ('Overflow Students',      'Youth & Young Adults', '18:30', 90,   10),
  ('Silver Liners Dinner',   'Dinners',              '12:00', 120,  20),
  ('Young Adults',           'Youth & Young Adults', '19:00', 90,   30),
  ('Dinner and Small Groups','Small Groups',         '17:30', 120,  40),
  ('Choir Rehearsal',        'Worship',              '19:00', 90,   50),
  ('Pickleball',             'Other',                '18:00', 120,  60),
  ('Baptism',                'Baptism',              '11:00', 60,   70),
  ('Helping Hands',          'Outreach',             '09:00', 180,  80),
  ('Office Closed',          'Other',                null,    null, 90),
  ('BKids',                  'Other',                '18:30', 90,   100)
) as seed(title, category, start_time, minutes, sort)
where not exists (select 1 from event_templates);
