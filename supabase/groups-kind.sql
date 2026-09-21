-- What KIND of thing each group is, so the app can offer "Ministries", "Sunday School" and
-- whatever else the church actually runs as filter pills (user, 2026-09-16).
--
-- Run this in the Supabase SQL editor. Safe to run twice.
--
-- The app asks for this column and quietly does without it when it isn't there
-- (utils/groups.js), so the Groups page works the same before and after.

alter table public.church_groups
  add column if not exists kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.church_groups'::regclass and conname = 'church_groups_kind_len'
  ) then
    alter table public.church_groups
      add constraint church_groups_kind_len
      check (kind is null or char_length(btrim(kind)) between 1 and 40);
  end if;
end $$;

comment on column public.church_groups.kind is
  'What kind of group this is, in the office''s own words: Ministry, Sunday School, Small Group…
   Members see it as a filter pill on the Groups and Ministries page. Groups sharing a kind are
   filtered together. Leave it null to keep a group out of the kind pills entirely.';

-- Nothing is set for you on purpose: only the church knows what each of its groups is.
-- Tag them from Pillar, or here — for example:
--
--   update public.church_groups set kind = 'Ministry'      where filter_key in ('men','women','kids','youth');
--   update public.church_groups set kind = 'Sunday School' where name ilike '%sunday school%';
--
-- A pill appears as soon as at least one published group carries that kind, and disappears when
-- none does — so the app never advertises something the church does not run.

select name, filter_key, kind from public.church_groups order by sort, name;
