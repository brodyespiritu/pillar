-- ============================================================
--  PILLAR · PROMOTION PLAYBOOKS (ARCS)
--  Run this in Supabase → SQL Editor
-- ============================================================
--
-- A playbook is the run-up to something: an event on the calendar, or an
-- ongoing ministry. It holds the dated pieces of promotion — stage
-- announcement, slide, social post, bulletin — leading to the day itself.

create table if not exists playbooks (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'event',      -- 'event' | 'ministry'
  title       text not null,
  description text,
  -- An event playbook points at the calendar entry it promotes; a ministry
  -- playbook names the ministry instead. Deleting the event leaves the
  -- playbook standing rather than throwing the promotion plan away.
  event_id    uuid references events(id) on delete set null,
  ministry    text,
  event_date  date,                               -- what the arc counts down to
  arc_weeks   integer not null default 4,
  audience    text default 'Churchwide',
  status      text not null default 'Draft',      -- Draft | Scheduled | Active | Complete
  created_by  uuid references staff(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists playbook_items (
  id          uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references playbooks(id) on delete cascade,
  due_date    date not null,
  channel     text not null,                      -- Stage | Slide | Social | Website | Bulletin | Text | Email
  title       text,
  notes       text,
  done        boolean not null default false,
  created_at  timestamptz default now()
);

create index if not exists idx_playbooks_date on playbooks(event_date);
create index if not exists idx_playbook_items_pb on playbook_items(playbook_id, due_date);

alter table playbooks       enable row level security;
alter table playbook_items  enable row level security;

drop policy if exists "staff playbooks" on playbooks;
drop policy if exists "staff playbook items" on playbook_items;
create policy "staff playbooks"      on playbooks      for all using (auth.role() = 'authenticated');
create policy "staff playbook items" on playbook_items for all using (auth.role() = 'authenticated');

drop trigger if exists trg_touch_playbooks on playbooks;
create trigger trg_touch_playbooks before update on playbooks
  for each row execute function touch_updated_at();

-- Check:
--   select title, kind, event_date, arc_weeks, status from playbooks order by event_date;
