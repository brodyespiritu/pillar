-- Sermon notes for one particular sermon (user, 2026-09-21: "make sure I can attach notes to a
-- specific sermon").
--
-- A sheet of fill-in-the-blank notes can now name the sermon it goes with: that sermon's id in the
-- app server's library (Pillar → App → Watch → Sermons). The app offers the notes on that sermon's
-- card, and the Bible page's "Sermon notes" still opens the newest sheet. One sheet per sermon;
-- notes that belong to no sermon in particular leave it empty, as before.
--
-- Run it in the Supabase SQL editor AFTER app-slides-notes-saved.sql. Safe to run again.
-- app-slides-notes-saved.sql carries the same lines, so a project set up from scratch has them too.

alter table public.app_sermon_notes add column if not exists sermon_id text;

alter table public.app_sermon_notes drop constraint if exists app_sermon_notes_sermon_id_check;
alter table public.app_sermon_notes add constraint app_sermon_notes_sermon_id_check
  check (sermon_id is null or char_length(btrim(sermon_id)) between 1 and 80);

create unique index if not exists app_sermon_notes_one_per_sermon
  on public.app_sermon_notes (sermon_id) where sermon_id is not null;

select count(*) as note_sheets, count(sermon_id) as on_a_sermon from public.app_sermon_notes;
