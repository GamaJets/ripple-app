-- ═════════════════════════════════════════════════════════════════════════
-- Open slots that do not run out.
--
-- `app/(trainer)/calendar.tsx` generates four weeks of open slots when a coach
-- presses Generate Open Slots · Next 4 Weeks, and never again. The standing
-- appointment feature on the same screen names this exact pattern as the defect
-- it was built to fix — "what a coach did instead was press Generate … and
-- press Generate again next month" — and fixed it for series only. A coach's
-- own open hours still empty silently four weeks after the last press, and the
-- first anybody knows is a client who cannot find a time.
--
-- The screen now says when the window is running out (item S10's first half).
-- This is the half that means it does not have to.
--
-- ── Why this needs a timezone, and why the column is new ─────────────────
--
-- `trainer_availability` says dow, hour, minute and duration. It does not say
-- WHERE, and 07:00 is not an instant — it is an instant per zone. The app never
-- needed the zone because it built the timestamps on the coach's own handset,
-- in the coach's own zone, by construction. A server job has no handset.
--
-- This is the same wall part 530 hit with quiet hours and it takes the same
-- answer: store the zone with the thing it qualifies, validate it on write so a
-- typo cannot make a nightly job raise, and do the arithmetic in Postgres.
-- `at time zone` then gives the same instant the coach's phone would have
-- produced, including across the day the clocks move — which is the case a
-- fixed offset gets wrong twice a year.
--
-- ── NULL tz is skipped, not guessed ──────────────────────────────────────
--
-- Every row that existed before this part has no zone. There is no honest
-- default: UTC would put a London coach's 07:00 at 08:00 for half the year and
-- a Dubai coach's four hours out all of it, and slots at the wrong hour are
-- worse than no slots, because a client books one. So a row with no zone is
-- skipped and counted, `src/ui/availability.ts` stamps the device's zone on
-- every write, and the count is returned so it can be seen to be falling.
-- ═════════════════════════════════════════════════════════════════════════

alter table public.trainer_availability add column if not exists tz text;

comment on column public.trainer_availability.tz is
  'IANA zone name the hour is read in, captured from the coach''s device. NULL on every row written before part 650, and skipped by run_open_slot_extension() rather than guessed — a slot generated in the wrong zone is worse than no slot, because a client books it. Validated against pg_timezone_names on write so a bad value cannot make the nightly job raise mid-run.';

create or replace function public.trainer_availability_check()
returns trigger language plpgsql as $fn$
begin
  if new.tz is not null and not exists (select 1 from pg_timezone_names where name = new.tz) then
    raise exception 'not a timezone this server knows: %', new.tz
      using hint = 'send an IANA zone name such as Europe/London';
  end if;
  return new;
end $fn$;

drop trigger if exists trainer_availability_check on public.trainer_availability;
create trigger trainer_availability_check
  before insert or update on public.trainer_availability
  for each row execute function public.trainer_availability_check();

-- ── The extension ────────────────────────────────────────────────────────
--
-- Rolling, not one-shot: it runs every night and tops the window back up to the
-- horizon, so a coach who never presses anything again still has open hours in
-- four weeks' time. Part 135's materialiser is the model, and three of its
-- rules are taken verbatim because they are the ones that stop a scheduled
-- writer doing damage:
--
--   · NEVER into the past. A job that back-fills writes slots nobody can book
--     and that read as a coach who was free and was not booked.
--   · Never a second slot at an instant the trainer already has one. That is
--     checked here AND enforced by `sessions_no_double_booking`; the check is
--     what makes the common case cheap, the constraint is what makes it true.
--   · An insert that still violates the constraint is CAUGHT and skipped, not
--     raised. One coach's clash must not cost every coach after them in the
--     loop their whole night's extension.
create or replace function public.run_open_slot_extension(p_horizon_days int default 28)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_created  int := 0;
  v_skipped  int := 0;
  v_nozone   int := 0;
  v_coaches  int := 0;
  a          record;
  v_today    date;
  v_horizon  date;
  v_date     date;
  v_ts       timestamptz;
  v_tenant   uuid;
begin
  -- Counted before the loop so the figure is "how many coaches cannot be
  -- extended", which is the number that should be falling, rather than "how
  -- many rows were skipped tonight".
  select count(distinct trainer_id) into v_nozone
    from public.trainer_availability where tz is null;

  for a in
    select ta.id, ta.trainer_id, ta.dow, ta.hour, coalesce(ta.minute, 0) as minute,
           coalesce(ta.dur, 60) as dur, ta.tz
      from public.trainer_availability ta
     where ta.tz is not null
     order by ta.trainer_id, ta.dow, ta.hour
  loop
    select t.tenant_id into v_tenant from public.trainers t where t.id = a.trainer_id;

    -- The coach's own today, not the server's. A job running at 02:00 UTC is
    -- still yesterday in Los Angeles, and generating from the server's date
    -- would miss a day at one end of the world and duplicate one at the other.
    v_today   := (now() at time zone a.tz)::date;
    v_horizon := v_today + greatest(p_horizon_days, 0);

    -- Forward to the first matching weekday. `extract(dow …)` is 0 = Sunday,
    -- which is exactly what `trainer_availability.dow` has meant since part 24.
    v_date := v_today + ((a.dow - extract(dow from v_today)::int + 7) % 7);

    while v_date <= v_horizon loop
      v_ts := (v_date + make_time(a.hour, a.minute, 0)) at time zone a.tz;

      if v_ts > now()
         and not exists (
           select 1 from public.sessions s
            where s.trainer_id = a.trainer_id
              and s.starts_at = v_ts
         )
      then
        begin
          insert into public.sessions (trainer_id, client_id, starts_at, duration_min, status, tenant_id)
          values (a.trainer_id, null, v_ts, a.dur, 'available', v_tenant);
          v_created := v_created + 1;
        exception when exclusion_violation then
          -- The coach is already busy across this hour with something that does
          -- not start exactly on it. Their diary, not ours to rearrange.
          v_skipped := v_skipped + 1;
        end;
      else
        v_skipped := v_skipped + 1;
      end if;

      v_date := v_date + 7;
    end loop;
  end loop;

  select count(distinct trainer_id) into v_coaches
    from public.trainer_availability where tz is not null;

  return jsonb_build_object(
    'created', v_created,
    'skipped', v_skipped,
    'coaches', v_coaches,
    'coaches_without_a_zone', v_nozone);
end $fn$;

revoke all on function public.run_open_slot_extension(int) from public, anon, authenticated;

comment on function public.run_open_slot_extension(int) is
  'Nightly. Tops every coach''s open slots back up to a rolling four-week horizon from their weekly availability, so the window never empties and nobody has to press Generate again. Skips a coach whose availability carries no timezone rather than guessing one, and reports how many those are. Never writes into the past and never a second slot where the trainer already has one.';

create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'open-slot-extension') then
    perform cron.unschedule('open-slot-extension');
  end if;
end $$;
select cron.schedule(
  'open-slot-extension',
  '48 7 * * *',
  $cron$ select public.run_open_slot_extension(); $cron$
);
