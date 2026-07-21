-- ============================================================
--  PILLAR · EMAIL MODULE SCHEMA
--  Run this in Supabase → SQL Editor
-- ============================================================

-- Connected mail accounts (IMAP/SMTP via app password)
create table if not exists email_accounts (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid references staff(id) on delete cascade,
  provider      text default 'gmail',        -- gmail | yahoo
  email         text not null,
  display_name  text,
  imap_host     text,
  imap_port     int default 993,
  smtp_host     text,
  smtp_port     int default 587,
  app_password  text,                          -- app-specific password (see note below)
  created_at    timestamptz default now(),
  unique (owner, email)
);

-- Optional local cache of drafts / sent copies
create table if not exists email_drafts (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid references staff(id) on delete cascade,
  account_id  uuid references email_accounts(id) on delete cascade,
  to_addr     text,
  cc_addr     text,
  subject     text,
  body        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table email_accounts enable row level security;
alter table email_drafts   enable row level security;

create policy "own accounts" on email_accounts for all using (owner = auth.uid());
create policy "own drafts"   on email_drafts   for all using (owner = auth.uid());

-- ⚠️  SECURITY NOTE
-- app_password stores an app-specific password. For production, encrypt it
-- (pgsodium / vault) or keep it in the OS keychain via the desktop app and
-- store only a reference here. RLS above restricts each row to its owner.
