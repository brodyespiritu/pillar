-- ============================================================
--  PILLAR · LINK A GUEST ENTRY TO THE DIRECTORY
--  Run this in Supabase → SQL Editor
-- ============================================================
--
-- The Guests list can transfer an entry to the directory (the ⋯ on its row →
-- Transfer to directory → Member or Prospect). The guest entry is kept, since
-- its visits, notes and follow-up are still worked from the Guests page, and
-- this column records which directory entry it became, so the list can show
-- "In directory" and open that entry.
--
-- Deleting the directory entry clears the link; it never deletes the guest.
-- Until this has run, transfers still work; the list just can't show them.

alter table public.guests
  add column if not exists member_id uuid references public.church_members(id) on delete set null;

create index if not exists guests_member_id_idx on public.guests (member_id);
