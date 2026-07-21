-- ============================================================
--  PILLAR · EMAIL TEMPLATES (block-based editor)
--  Run in Supabase → SQL Editor.
-- ============================================================

create table if not exists email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text default 'general',   -- 'general' | 'guest_recap' | 'newsletter' | ...
  blocks      jsonb not null default '[]',   -- ordered content blocks
  theme       jsonb not null default '{}',   -- { accent, pageBg, cardBg }
  created_by  uuid references staff(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_email_templates_cat on email_templates(category);

alter table email_templates enable row level security;
create policy "staff read templates"  on email_templates for select using (auth.role() = 'authenticated');
create policy "staff write templates" on email_templates for all    using (auth.role() = 'authenticated');
