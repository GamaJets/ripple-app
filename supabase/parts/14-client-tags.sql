-- ─────────────────────────────────────────────────────────────────────────
-- Repple client tags — coach-owned labels on clients ("comp prep", "new",
-- "paused", "high-touch"…) that drive roster segments/filters. Each row is one
-- (coach, client, tag). A coach manages only their own tags. Idempotent.

create table if not exists client_tags (
  coach_id  uuid not null references profiles(id) on delete cascade,
  client_id uuid not null,
  tag       text not null,
  created_at timestamptz not null default now(),
  primary key (coach_id, client_id, tag)
);
create index if not exists idx_client_tags_coach on client_tags(coach_id);

alter table client_tags enable row level security;

-- A coach reads/writes only the tags they created.
drop policy if exists client_tags_self on client_tags;
create policy client_tags_self on client_tags for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
