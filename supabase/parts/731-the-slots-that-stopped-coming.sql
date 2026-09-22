-- ── A coach's open slots quietly stopped being generated ───────────────────
--
-- Part 650 added `trainer_availability.tz` and built `run_open_slot_extension`
-- on top of it, so a coach's weekly hours keep turning into bookable slots
-- without anybody pressing anything. Line 103 of that part reads:
--
--     where ta.tz is not null
--
-- and it is right to: a slot generated in a guessed zone puts a coach's 07:00
-- at some other hour, and the first anybody knows is a client arriving to an
-- empty gym. Skipping is recoverable. Guessing is not.
--
-- What part 650 did NOT do is fill the column in for the rows that already
-- existed. `deviceZone()` in src/ui/availability.ts stamps `tz` on INSERT only,
-- so every availability row written before that part landed has `tz = null`,
-- is skipped by the nightly job for ever, and can only gain a zone if the coach
-- deletes each slot and re-adds it by hand — which nothing tells them to do.
--
-- The visible symptom is not an error anywhere. It is a coach whose clients
-- open the app and find nothing to book, and a client who cannot see why. There
-- is no failure to read, no refusal to report and no row out of place; the job
-- runs nightly, reports a count, and the count silently excludes them.
--
-- ── The gym's own zone is a fact, not a guess ─────────────────────────────
--
-- Part 650 had nothing honest to fall back on and so fell back on nothing. That
-- changed with part 710: a gym now carries `tenants.timezone`, refused unless
-- `pg_timezone_names` holds it, with no default and no backfill of its own.
--
-- For a coach who belongs to a gym, that zone is not an inference about where
-- they are — it is where the sessions happen. A slot at 07:00 on the gym's
-- clock is the hour a member walks through the gym's door. So this part fills
-- `tz` from the gym, and ONLY from the gym.
--
-- It does not fall back to UTC, to the server's zone, or to the zone of any
-- other row the coach owns. A coach with no gym, or a gym with no zone set,
-- keeps `tz = null` and stays skipped — visibly, in a count this part adds —
-- because for an online-only coach there is genuinely nothing here that knows
-- what hour they meant.
--
-- ── Why the device's zone still wins ──────────────────────────────────────
--
-- The trigger below fills only a NULL. A row that arrives carrying a zone keeps
-- it, whatever the gym says, because the handset that wrote it was in the hand
-- of the person choosing the hour and the gym's zone is a fact about a
-- building. A coach who runs a gym in Dubai and takes online clients from
-- Lisbon is describing Lisbon hours when they set them in Lisbon.
--
-- Additive and idempotent. Applying it twice fills nothing the first pass left,
-- because the first pass left only rows with no gym zone to take.

do $$
begin
  if to_regclass('public.trainer_availability') is null then
    raise exception 'public.trainer_availability is missing — part 15 must be applied before part 730.';
  end if;
  -- Named rather than assumed: without part 710 there is no column to read and
  -- the backfill below would be a silent no-op that looks like a success.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenants' and column_name = 'timezone'
  ) then
    raise exception 'tenants.timezone is missing — part 710 must be applied before part 730.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trainer_availability' and column_name = 'tz'
  ) then
    raise exception 'trainer_availability.tz is missing — part 650 must be applied before part 730.';
  end if;
end $$;

-- ── the rows that already exist ────────────────────────────────────────────

update public.trainer_availability ta
   set tz = t.timezone
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
 where ta.trainer_id = p.id
   and ta.tz is null
   and t.timezone is not null;

-- ── and the ones written from a client that could not say ─────────────────
--
-- A handset without full ICU answers `UTC`, which src/ui/availability.ts
-- deliberately refuses to send rather than stamp a zone almost nobody is in.
-- That refusal produces exactly the row this trigger is for: the coach chose
-- an hour, the phone could not say which clock it was on, and the gym can.

create or replace function public.trainer_availability_default_tz()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.tz is null then
    select t.timezone into new.tz
      from public.profiles p
      join public.tenants t on t.id = p.tenant_id
     where p.id = new.trainer_id;
  end if;
  return new;
end $fn$;

-- BEFORE the validation trigger part 650 installs, so a zone taken from the
-- gym is checked against pg_timezone_names on the way in like any other. The
-- name sorts ahead of `trainer_availability_tz_check` and Postgres fires
-- same-timing triggers in name order, which is the whole reason for the prefix.
drop trigger if exists a_trainer_availability_default_tz on public.trainer_availability;
create trigger a_trainer_availability_default_tz
  before insert or update of tz, trainer_id on public.trainer_availability
  for each row execute function public.trainer_availability_default_tz();

-- ── the number that should be falling ─────────────────────────────────────
--
-- Part 650 counts the rows it skipped on each run, which is the right thing to
-- report and the wrong place to read it: it lives in a job's return value that
-- nobody opens. This is the same figure, askable.

create or replace function public.availability_without_a_zone()
returns table (rows bigint, coaches bigint)
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::bigint, count(distinct trainer_id)::bigint
    from public.trainer_availability
   where tz is null;
$$;

revoke all on function public.availability_without_a_zone() from public, anon;
grant execute on function public.availability_without_a_zone() to authenticated;

comment on function public.availability_without_a_zone is
  'How many weekly availability rows still carry no timezone, and how many coaches they belong to. Every one of them is skipped by run_open_slot_extension (part 650), so their clients see nothing to book and no error is raised anywhere. Should fall to zero for gym coaches after part 730 and stay above it only for coaches with no gym, whose zone this database genuinely does not know.';

comment on function public.trainer_availability_default_tz is
  'Fills a null timezone on an availability row from the coach''s gym, and never overrides one the client sent. See part 730 for why the gym''s zone is a fact rather than a guess, and why a coach with no gym is left null instead of defaulted to anything.';
