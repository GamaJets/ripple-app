-- ─────────────────────────────────────────────────────────────────────────
-- Repple in-app feedback. Any signed-in user (trainer tester, client) submits a
-- rating + note; the platform owner reads them all in the Owner portal.
-- Depends on schema.sql (profiles/tenants) + domain-schema.sql (is_owner_of).
-- Idempotent; safe to re-run.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  role text,
  tenant_id uuid references tenants(id) on delete set null,
  rating int check (rating between 1 and 5),
  category text,
  body text not null,
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_created on feedback (created_at desc);

alter table feedback enable row level security;

drop policy if exists fb_insert on feedback;
create policy fb_insert on feedback for insert with check (user_id = auth.uid());

drop policy if exists fb_own on feedback;
create policy fb_own on feedback for select using (user_id = auth.uid());

drop policy if exists fb_owner on feedback;
create policy fb_owner on feedback for select using (
  is_owner_of(tenant_id)
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
);


-- ─────────────────────────────────────────────────────────────────────────
