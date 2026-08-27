-- ─────────────────────────────────────────────────────────────────────────
-- A coach can log the session they just ran, into the client's own record.
--
-- Until now they could not. The policies were:
--
--     workouts_own         ALL     user_id = auth.uid()
--     workouts_coach_read  SELECT  is_my_client(user_id)
--
-- so a coach could read a client's training and never write it. A trainer
-- standing next to somebody through an hour of squats had nowhere to record
-- what was done, and the client's progress, PRs and calories simply missed it.
--
-- ── Who may change what, and why ─────────────────────────────────────────
--
-- The client can DELETE a workout their coach logged. It is their training
-- record and their personal data, and this app already lets them export and
-- erase all of it. Crucially it costs the coach nothing they are paid on:
-- session delivery lives in `sessions` with its own outcome and approval, and
-- nothing here touches that. `workouts` feeds the client's progress; `sessions`
-- feeds payroll. Deleting one does not disturb the other.
--
-- The client can also EDIT it — but never silently. The alternative was
-- considered and is worse: a client who cannot correct "he wrote 8 reps, it was
-- 10" simply deletes the entry and logs their own, so the coach loses the
-- record entirely AND does not know why. A visible amendment beats a silent
-- disappearance. `amended_at` is stamped by the trigger below, and both sides
-- render "Logged by <coach> · amended by you".
--
-- What is genuinely locked is `logged_by`. Who recorded something is not the
-- subject's to rewrite, in either direction — a client cannot erase the
-- attribution, and cannot forge one either.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.workouts
  add column if not exists logged_by  uuid references public.profiles(id) on delete set null,
  add column if not exists amended_at timestamptz;

comment on column public.workouts.logged_by is
  'The coach who recorded this on the client''s behalf. Null means the client logged it themselves.';
comment on column public.workouts.amended_at is
  'Set when the client changed a workout their coach had logged. Null means untouched since.';

-- A coach may insert only for their own client, and only in their own name.
-- `logged_by = auth.uid()` in the CHECK is what stops a coach attributing a
-- workout to somebody else.
drop policy if exists workouts_coach_insert on public.workouts;
create policy workouts_coach_insert on public.workouts for insert
  with check (is_my_client(user_id) and logged_by = auth.uid());

create or replace function public.guard_workout_attribution()
returns trigger language plpgsql
set search_path = public
as $$
begin
  -- Attribution is not editable by anyone through this path.
  if new.logged_by is distinct from old.logged_by then
    raise exception 'Who logged a workout cannot be changed.' using errcode = '42501';
  end if;

  -- auth.uid(), not current_user. This function is SECURITY INVOKER so
  -- current_user would be the connected role ("authenticated") for every
  -- caller alike, which is the trap guard_profile_identity documents.
  if old.logged_by is not null
     and auth.uid() = old.user_id
     and (new.exercise     is distinct from old.exercise
       or new.sets         is distinct from old.sets
       or new.cardio       is distinct from old.cardio
       or new.kcal         is distinct from old.kcal
       or new.performed_at is distinct from old.performed_at)
  then
    new.amended_at := now();
  end if;

  return new;
end $$;

drop trigger if exists guard_workout_attribution_t on public.workouts;
create trigger guard_workout_attribution_t
  before update on public.workouts
  for each row execute function public.guard_workout_attribution();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql.
revoke execute on function public.guard_workout_attribution() from public, anon, authenticated;
