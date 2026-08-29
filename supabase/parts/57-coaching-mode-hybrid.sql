-- ── Coaching mode: hybrid, and the constraint that was eating profile saves ──
--
-- A person can be coached in the room, online, or both. Five tables carry a
-- coaching mode and every one of them was CHECK-constrained to
-- ('online','inperson'), so "both" could not be stored anywhere.
--
-- Widening is additive — every existing row already satisfies the wider
-- constraint — which is why this is safe to run against a live database and
-- safe to re-run.
--
-- ── The bug this also fixes ─────────────────────────────────────────────────
--
-- `clients.mode` additionally needed 'solo', for somebody training with no
-- coach at all. The app was already writing 'solo' into it. The old constraint
-- refused the row, and because that write travelled with the rest of the
-- profile, Postgres discarded the whole update: name, goal, diet, allergens,
-- injuries and manual weight went with it, silently. Nine client rows contained
-- no 'solo' at the time of writing, because none could ever be written.
--
-- 'solo' belongs to `clients` alone. It describes a person, never a
-- relationship — a coaching relationship with nobody in it is not a row.
--
-- ── Why clients.mode is created here ────────────────────────────────────────
--
-- The live database had this column; supabase/parts did not declare it
-- anywhere. The two had drifted, so a database built from this repo would not
-- have had a column the app writes to. Adding it here brings the schema-as-code
-- back in step with production rather than leaving the gap for the next person.

-- The column the repo was missing.
alter table public.clients
  add column if not exists mode text not null default 'online';

alter table public.clients drop constraint if exists clients_mode_check;
alter table public.clients add constraint clients_mode_check
  check (mode in ('online','inperson','hybrid','solo'));

alter table public.coach_clients drop constraint if exists coach_clients_mode_check;
alter table public.coach_clients add constraint coach_clients_mode_check
  check (mode in ('online','inperson','hybrid'));

alter table public.coach_invites drop constraint if exists coach_invites_mode_check;
alter table public.coach_invites add constraint coach_invites_mode_check
  check (mode in ('online','inperson','hybrid'));

alter table public.coach_requests drop constraint if exists coach_requests_mode_check;
alter table public.coach_requests add constraint coach_requests_mode_check
  check (mode in ('online','inperson','hybrid'));

alter table public.coaching_relationships drop constraint if exists coaching_relationships_mode_check;
alter table public.coaching_relationships add constraint coaching_relationships_mode_check
  check (mode in ('online','inperson','hybrid'));

-- ── join_by_code ────────────────────────────────────────────────────────────
--
-- This collapsed anything that was not 'inperson' down to 'online', so a hybrid
-- client joining by code landed on their coach's roster as online-only, and the
-- coach was never told otherwise. Replaces the version in
-- 56-join-code-tracking.sql; only `mode_in` differs.
create or replace function public.join_by_code(p_code text, p_mode text default 'online')
returns table(trainer_id uuid, trainer_name text, already boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  t_id uuid;
  t_name text;
  t_code text;
  existing boolean;
  -- An unrecognised mode still falls back to 'online' rather than raising: not
  -- knowing how somebody will be coached is no reason to refuse them a coach.
  mode_in text := case when p_mode in ('inperson','hybrid') then p_mode else 'online' end;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select tr.id, tr.join_code into t_id, t_code
  from public.trainers tr
  where tr.join_code is not null
    and upper(tr.join_code) = upper(btrim(coalesce(p_code, '')));

  if t_id is null then
    raise exception 'no coach uses that code';
  end if;

  if t_id = uid then
    raise exception 'that is your own code';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Your coach') into t_name
  from public.profiles p where p.id = t_id;

  select exists (
    select 1 from public.coaching_relationships r
    where r.coach_id = t_id and r.client_id = uid
  ) or exists (
    select 1 from public.coach_requests q
    where q.trainer_id = t_id and q.client_id = uid and q.status = 'pending'
  ) into existing;

  if not existing then
    insert into public.coach_requests (client_id, trainer_id, mode, status, source, via_code)
    values (uid, t_id, mode_in, 'pending', 'code', upper(t_code));
  end if;

  return query select t_id, coalesce(t_name, 'Your coach'), existing;
end; $function$;
