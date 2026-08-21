-- ─────────────────────────────────────────────────────────────────────────
-- Repple trainer read access — lets a trainer SELECT their linked clients'
-- domain data so the coach roster & client detail show REAL progress (weight
-- change, last-active, self-reported adherence), not placeholders.
-- Mirrors scans_trainer_read / food_trainer_read. Depends on domain-schema.sql
-- (workouts/measurements/check_ins/habit_logs, user_id) + clients.trainer_id.
-- Idempotent; safe to re-run.

drop policy if exists workouts_trainer_read on workouts;
create policy workouts_trainer_read on workouts for select
  using (exists (select 1 from clients c where c.id = workouts.user_id and c.trainer_id = auth.uid()));

drop policy if exists meas_trainer_read on measurements;
create policy meas_trainer_read on measurements for select
  using (exists (select 1 from clients c where c.id = measurements.user_id and c.trainer_id = auth.uid()));

drop policy if exists checkins_trainer_read on check_ins;
create policy checkins_trainer_read on check_ins for select
  using (exists (select 1 from clients c where c.id = check_ins.user_id and c.trainer_id = auth.uid()));

drop policy if exists habits_trainer_read on habit_logs;
create policy habits_trainer_read on habit_logs for select
  using (exists (select 1 from clients c where c.id = habit_logs.user_id and c.trainer_id = auth.uid()));
