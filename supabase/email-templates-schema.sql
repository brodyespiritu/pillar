-- Staff-only rules below use public.is_active_staff() (full definition: sms-recipient-guards.sql and
-- member-app-auth.sql). Create a basic one if this project doesn't have it yet; never replace it.
do $guard$ begin
  if to_regprocedure('public.is_active_staff()') is null then
    execute $f$create function public.is_active_staff() returns boolean language plpgsql stable security definer
      set search_path = public as 'begin return exists (select 1 from public.staff where id = auth.uid() and active is not false); end'$f$;
    execute 'grant execute on function public.is_active_staff() to anon, authenticated, service_role';
  end if;
end $guard$;

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
create policy "staff read templates"  on email_templates for select using ((select public.is_active_staff()));
create policy "staff write templates" on email_templates for all    using ((select public.is_active_staff()));
