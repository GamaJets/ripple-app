-- ─────────────────────────────────────────────────────────────────────────
-- Repple crash/error log — the app's ErrorBoundary writes caught render errors
-- here (best-effort) so the platform owner can review them in the Owner ▸ Feedback
-- inbox without a heavyweight crash reporter. Any signed-in user logs their own
-- errors; the owner reads them all. Depends on schema.sql (profiles).
-- Idempotent; safe to re-run.

create table if not exists app_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  message text not null,
  stack text,
  platform text,
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists idx_app_errors_created on app_errors (created_at desc);

alter table app_errors enable row level security;

-- A signed-in user can log an error attributed to themselves (or anonymously).
drop policy if exists app_errors_insert on app_errors;
create policy app_errors_insert on app_errors for insert
  with check (user_id = auth.uid() or user_id is null);

-- The platform owner reads every error.
drop policy if exists app_errors_owner on app_errors;
create policy app_errors_owner on app_errors for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
);


-- ─────────────────────────────────────────────────────────────────────────
