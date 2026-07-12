-- Repple program templates — a coach's reusable weekly programs ("build once,
-- assign to many"). Each row is one saved template owned by the coach; the
-- `program` JSONB is the same shape assigned to clients. Idempotent.

create table if not exists program_templates (
  id         text primary key,
  coach_id   uuid not null references profiles(id) on delete cascade,
  name       text not null,
  program    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_program_templates_coach on program_templates(coach_id);

alter table program_templates enable row level security;

-- A coach reads/writes only their own templates.
drop policy if exists program_templates_self on program_templates;
create policy program_templates_self on program_templates for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
