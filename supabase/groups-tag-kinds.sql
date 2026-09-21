-- Tagging the groups, now that `kind` exists (groups-kind.sql has been run).
--
-- Step 1 tags the five ministries already in the table. On its own it shows NO pill: every group
-- would carry the same kind, which is "All" under another name, so the app leaves it out.
--
-- Step 2 is what makes the pills appear — real groups of a DIFFERENT kind. Fill in the church's
-- actual Sunday School classes; the placeholders below are deliberately obvious so nothing
-- invented ever reaches a member. Delete the rows you don't use.

-- ── 1. the ministries already there ──
update public.church_groups
   set kind = 'Ministry'
 where filter_key in ('kids', 'youth', 'college', 'women', 'men');

-- ── 2. the Sunday School classes — REPLACE EVERY VALUE BEFORE RUNNING ──
-- filter_key ties a class to the calendar so the app can count what it has coming up; use one of
-- kids / youth / college / women / men, or leave it null if the class fits none of them.
--
-- insert into public.church_groups (name, kind, about, meets, location, audience, filter_key, sort)
-- values
--   ('REPLACE — class name', 'Sunday School', 'REPLACE — what the class is',
--    'Sundays at 9:45 AM', 'REPLACE — room', 'REPLACE — who it is for', null, 100),
--   ('REPLACE — class name', 'Sunday School', 'REPLACE — what the class is',
--    'Sundays at 9:45 AM', 'REPLACE — room', 'REPLACE — who it is for', null, 101);

-- Leaders are set separately, as a JSON array of real people:
--   update public.church_groups
--      set leaders = '[{"name": "REPLACE — leader", "role": "Teacher"}]'::jsonb
--    where name = 'REPLACE — class name';

select name, filter_key, kind, sort from public.church_groups order by sort, name;
