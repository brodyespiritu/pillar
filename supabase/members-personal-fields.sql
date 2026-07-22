-- ============================================================
--  PILLAR · CHURCH MEMBERS — personal information, family, import
--  Run this in Supabase → SQL Editor (safe to re-run).
-- ============================================================

alter table church_members
  add column if not exists family_name       text,      -- friendly household name (display)
  add column if not exists family_id         text,      -- household grouping key (from import)
  add column if not exists external_id       text,      -- source system id (import idempotency)
  add column if not exists family_position   text,      -- Head | Spouse | Child | Other
  add column if not exists gender            text,      -- Male | Female
  add column if not exists marital_status    text,      -- Single | Married | Widowed | Divorced | Separated
  add column if not exists member_status     text default 'Member',
  add column if not exists record_type       text default 'Member',
  add column if not exists joined_how        text,      -- Statement | Baptism | Transfer | ...
  add column if not exists date_joined       date,
  add column if not exists include_directory boolean default true,
  add column if not exists status_code       text default 'Active',
  add column if not exists active            boolean default true;

-- Group everyone in the same household; look up a source row on re-import.
create index if not exists idx_church_members_family    on church_members(family_id);
create index if not exists idx_church_members_familyname on church_members(lower(family_name));

-- Unique per source id so re-importing updates instead of duplicating.
-- (Postgres treats NULLs as distinct, so manually-added members are unaffected.)
create unique index if not exists uq_church_members_external_id on church_members(external_id);
