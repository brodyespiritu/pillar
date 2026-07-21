-- Attendance analysis — AI-estimated headcount per seating zone from a livestream frame.
-- Run in the Supabase SQL editor. Pairs with src/lib/attendance.js and the
-- analyze-attendance edge function.

create table if not exists attendance_reads (
  id             uuid primary key default gen_random_uuid(),
  service_date   date not null,
  source_url     text,                       -- YouTube / livestream URL the frame came from
  frame_ts       text,                        -- moment in the video, e.g. "00:12:30"
  total_estimate int  not null default 0,
  capacity       int  not null default 0,
  confidence     real,                        -- 0..1 model self-reported confidence
  model          text,                        -- model id that produced the read
  status         text not null default 'done',-- pending | processing | done | failed
  note           text,
  created_by     uuid references staff(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists attendance_zones (
  id         uuid primary key default gen_random_uuid(),
  read_id    uuid not null references attendance_reads(id) on delete cascade,
  zone_key   text not null,                  -- 'C3', 'L0', 'ch2' — matches ROOM in src/lib/attendance.js
  section    text,
  row        int,
  estimate   int not null default 0,
  capacity   int not null default 0
);

create index if not exists attendance_zones_read_idx on attendance_zones(read_id);
create index if not exists attendance_reads_date_idx  on attendance_reads(service_date desc);

alter table attendance_reads enable row level security;
alter table attendance_zones enable row level security;

create policy "staff read attendance"  on attendance_reads for select using (auth.role() = 'authenticated');
create policy "staff write attendance" on attendance_reads for all    using (auth.role() = 'authenticated');
create policy "staff read zones"       on attendance_zones for select using (auth.role() = 'authenticated');
create policy "staff write zones"      on attendance_zones for all    using (auth.role() = 'authenticated');
