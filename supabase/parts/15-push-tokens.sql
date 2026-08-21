-- ─────────────────────────────────────────────────────────────────────────
-- Repple push tokens — each user's Expo push token(s) for remote notifications.
-- The app upserts here on login; the send-push edge function reads them (via the
-- service role) to deliver notifications. Idempotent; safe to re-run.

create table if not exists push_tokens (
  token text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  platform text default 'expo',
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_user on push_tokens(user_id);

alter table push_tokens enable row level security;

drop policy if exists pt_self on push_tokens;
create policy pt_self on push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
