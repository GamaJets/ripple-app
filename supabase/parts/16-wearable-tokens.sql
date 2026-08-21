-- ─────────────────────────────────────────────────────────────────────────
-- Repple wearable OAuth tokens — one row per (user, cloud provider). Written ONLY
-- by the wearable-oauth / wearable-day edge functions via the service role, so
-- access/refresh tokens are never exposed to the app. Users may delete their own
-- row to disconnect. Idempotent; safe to re-run.

create table if not exists wearable_tokens (
  user_id       uuid not null references profiles(id) on delete cascade,
  provider      text not null,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table wearable_tokens enable row level security;

drop policy if exists wearable_tokens_delete_own on wearable_tokens;
create policy wearable_tokens_delete_own on wearable_tokens for delete
  using (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
