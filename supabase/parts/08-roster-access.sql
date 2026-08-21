-- ─────────────────────────────────────────────────────────────────────────
-- Repple roster access — lets a trainer read their own clients (and those
-- clients' names) so linked accounts appear in the coach's roster with real IDs.
-- Depends on schema.sql (clients, profiles). Idempotent; safe to re-run.

drop policy if exists clients_trainer_read on clients;
create policy clients_trainer_read on clients for select
  using (trainer_id = auth.uid());

drop policy if exists profiles_trainer_read on profiles;
create policy profiles_trainer_read on profiles for select
  using (exists (select 1 from clients c where c.id = profiles.id and c.trainer_id = auth.uid()));


-- ─────────────────────────────────────────────────────────────────────────
