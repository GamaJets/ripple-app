-- Who changed a logged set, and a date on it that no handset can choose.
--
-- ── What was missing ──────────────────────────────────────────────────────
--
-- `amended_at` says WHEN a set changed after it was filed. It has never said
-- WHO. That was harmless while only one person could change a coach-logged set:
-- part 53 let the member correct what their coach recorded about them, so a
-- change mark meant "the member changed this". Part 3200 let the coach who
-- logged a set correct or withdraw it too, and from then on the same mark could
-- mean either person. The member's screen said "amended by you" and was, after
-- a coach's correction, simply wrong. Commit 375fcbb made both apps say
-- "changed after it was filed" instead, which is true and says less than it
-- should. This column lets it say who.
--
-- ── And the date was the phone's ──────────────────────────────────────────
--
-- The trigger stamped `amended_at` only when the MEMBER edited
-- (`auth.uid() = old.user_id`). A coach's correction therefore had to send the
-- date itself, from the coach's handset clock, and nothing checked it. A wrong
-- clock filed a wrong date; a curious coach could file any date at all. The
-- mark exists so a member can see their record was altered, which makes its date
-- evidence, and evidence is not something the altering party should set.
--
-- ── The rule now ──────────────────────────────────────────────────────────
--
-- Both columns are the SERVER'S. On every update the incoming values are
-- discarded and the stored ones kept, then — only when a coach-logged set's
-- recorded content actually changed, and only when the person changing it is
-- the member it is about or the coach who logged it — they are stamped with
-- `now()` and `auth.uid()`. So:
--   · a client cannot forge either column, in either direction;
--   · a save that changes nothing leaves no mark;
--   · a service-role or backfill update (`auth.uid()` null) leaves no mark and
--     cannot forge one;
--   · a set the member logged themselves is still never marked — their own
--     log is not a claim somebody else made about them, as part 53 decided.
-- On insert both are forced null: a row being created has not been amended.
-- `entryToRow` already omits `amended_at` for exactly this reason, so no
-- insert path in the app is changed by that.
--
-- ── What counts as "the content changed" ──────────────────────────────────
--
-- Part 53's list was exercise, sets, cardio, kcal and performed_at. `bw`,
-- `timed` and `tempos` are added: each is a per-set fact aligned to `sets`
-- (parts 162 and 204, and 3220 this week), so a correction of which sets were
-- bodyweight or held, or of the tempo lifted at, is a correction of what was
-- recorded and was previously invisible. `feel` and `session_mins` stay out,
-- as part 53 left them.
--
-- Everything else in the function is part 2660's, unchanged and in its order.

alter table public.workouts
  add column if not exists amended_by uuid references public.profiles(id) on delete set null;

comment on column public.workouts.amended_by is
  'Who last changed this coach-logged set after it was filed: the member it is about, or the coach who logged it. Server-owned; stamped with amended_at by guard_workout_attribution. Null means never changed after filing.';

create or replace function public.guard_workout_attribution()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if new.queried_at is not null or new.query_note is not null then
      raise exception 'A workout cannot be logged already queried.' using errcode = '42501';
    end if;
    -- A row being created has not been amended, by anyone.
    new.amended_at := null;
    new.amended_by := null;
    return new;
  end if;

  -- Attribution is not editable by anyone through this path.
  if new.logged_by is distinct from old.logged_by then
    raise exception 'Who logged a workout cannot be changed.' using errcode = '42501';
  end if;

  -- The change mark is the server's. Whatever the client sent is discarded and
  -- the stored mark kept; it moves only below, and only on a real change.
  new.amended_at := old.amended_at;
  new.amended_by := old.amended_by;

  -- auth.uid(), not current_user: this function is SECURITY INVOKER, so
  -- current_user is "authenticated" for every caller alike.
  if old.logged_by is not null
     and (auth.uid() = old.user_id or auth.uid() = old.logged_by)
     and (new.exercise     is distinct from old.exercise
       or new.sets         is distinct from old.sets
       or new.bw           is distinct from old.bw
       or new.timed        is distinct from old.timed
       or new.tempos       is distinct from old.tempos
       or new.cardio       is distinct from old.cardio
       or new.kcal         is distinct from old.kcal
       or new.performed_at is distinct from old.performed_at)
  then
    new.amended_at := now();
    new.amended_by := auth.uid();
  end if;

  -- ── the query is the subject's, in both directions (part 2660) ──────────
  if (new.queried_at is distinct from old.queried_at
      or new.query_note is distinct from old.query_note)
     and auth.uid() is distinct from old.user_id
  then
    raise exception 'Only the person a workout is about may query it.' using errcode = '42501';
  end if;

  if new.queried_at is not null and old.logged_by is null then
    raise exception 'Only a workout somebody else logged can be queried.' using errcode = '22023';
  end if;

  if new.queried_at is not null and new.queried_at is distinct from old.queried_at then
    new.queried_at := now();
  end if;

  if new.queried_at is null then
    new.query_note := null;
  end if;

  return new;
end $$;

-- The trigger's event is unchanged (before insert or update, part 2660), so it
-- is not recreated. Execution stays revoked, as 2660 set it.
revoke execute on function public.guard_workout_attribution() from public, anon, authenticated;
