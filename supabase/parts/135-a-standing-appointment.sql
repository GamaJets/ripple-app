-- ─────────────────────────────────────────────────────────────────────────
-- A standing appointment — every Tuesday at seven, for as long as they want it.
--
-- ── What was here before ─────────────────────────────────────────────────
--
-- `trainer_availability` (part 09 + the `minute` column) is a WEEKLY TEMPLATE:
-- seven days by twenty-four hours of "I am free then". The coach's calendar
-- screen turns it into concrete rows with a Generate button that walks four
-- weeks forward and inserts open slots. That is availability, and availability
-- is the right shape for it.
--
-- It is not a booking. Nothing in this product could express "Ana trains with
-- me at 07:00 every Tuesday" — the single most common fact about a personal
-- trainer's week. What a coach did instead was press Generate, wait for Ana to
-- book each slot by hand, and press Generate again next month; and when they
-- forgot, the standing appointment their client had had for a year simply
-- stopped existing, silently, with no row anywhere that said it should have.
--
-- ── The model ────────────────────────────────────────────────────────────
--
-- One row in `session_series` is the ARRANGEMENT. Concrete `sessions` rows are
-- its OCCURRENCES, and they are ordinary booked sessions in every respect —
-- same table, same policies, same exclusion constraint, same waitlist, same
-- cancellation RPC, same late-cancel policy. `sessions` gains exactly two
-- columns (`series_id`, `occurrence_on`) and nothing else in the product needs
-- to learn what a series is in order to keep working.
--
-- That is the whole reason for this shape rather than a separate recurring
-- calendar. A recurring booking that lived in its own table would have to
-- re-implement double-booking, the waitlist, the notice window, the fee, the
-- outcome, payroll and the ICS export, and every one of those re-implementations
-- would be the version that drifts.
--
-- ── WHY dow + hour + minute + tz, AND NOT "the first one, plus 7 days" ───
--
-- Because 07:00 is a fact about the clock on the wall and `starts_at + interval
-- '7 days'` is a fact about elapsed seconds, and twice a year they disagree.
-- A series stored as an instant plus a week silently becomes an 06:00 or an
-- 08:00 appointment the Sunday the clocks move, for everybody in the country,
-- and the client is told nothing. So the series stores the LOCAL time and the
-- IANA zone it is local to, and each occurrence is computed as
-- `(date + time) at time zone tz`. Seven in the morning stays seven in the
-- morning.
--
-- The zone is validated against pg_timezone_names on the way in. An app that
-- sends a name Postgres does not know gets a refusal, not an appointment
-- silently pinned to UTC.
--
-- ── WHAT HAPPENS ON A CLASH ──────────────────────────────────────────────
--
-- `sessions_no_double_booking` (part 86, widened by part 89 to cover blocked
-- time) is a real exclusion constraint and it WILL refuse an overlap. A year of
-- Tuesdays crossing one already-booked hour is not a reason to refuse the
-- arrangement, and an error that abandons the whole run at the first clash is
-- the behaviour a coach would experience as "recurring bookings do not work".
--
-- So: THE CLASHING DATE IS SKIPPED, EVERY OTHER DATE IS CREATED, AND THE COACH
-- IS TOLD WHICH DATES DID NOT TAKE. Each occurrence is written inside its own
-- subtransaction, `exclusion_violation` is caught per-date, and the dates are
-- returned in the report. This mirrors `_promote_session_waitlist` in part 126,
-- which keeps a client's place in the queue and tries the next person rather
-- than letting one clash sink the promotion.
--
-- A skipped date is not retried on the next materialiser run either — it would
-- clash again for the same reason, and a coach who freed that hour deliberately
-- can add the one session back by hand. The series is unharmed: next week is
-- still next week.
--
-- ── WHAT A RECURRING OCCURRENCE DOES NOT DO: DRAW A PACK CREDIT ──────────
--
-- `redeemSession` draws a credit when a client taps Book, and part 126 draws
-- one when the server promotes somebody off a waitlist — there, the reasoning
-- is that otherwise the queue is the cheapest way to book. It does not carry
-- over here, and the difference is timing.
--
-- The materialiser runs EIGHT WEEKS AHEAD. Drawing a credit per occurrence
-- would take eight off a ten-session pack the moment a series is created, for
-- sessions two months away that have not happened and may never happen, and
-- ending the series would then have to hand every one of them back — a refund
-- path this product does not have and should not grow in order to support a
-- calendar feature. A standing appointment is an agreement about TIME. The
-- money is settled by the coach, exactly as part 126 settles the late fee, and
-- src/lib/recurring.ts holds the sentence the apps print about it so the two
-- cannot drift.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The arrangement
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.session_series (
  id           uuid        primary key default gen_random_uuid(),
  trainer_id   uuid        not null references public.trainers(id) on delete cascade,
  client_id    uuid        not null references public.clients(id)  on delete cascade,
  -- Local weekly position. 0 = Sunday, matching extract(dow) and the app's
  -- DOW array, so nothing has to translate between two conventions.
  dow          smallint    not null,
  hour         smallint    not null,
  minute       smallint    not null default 0,
  duration_min int         not null default 60,
  -- The zone the hour above is an hour IN. See the header.
  tz           text        not null,
  starts_on    date        not null,
  -- NULL is open-ended, which is what a standing appointment usually is. A
  -- coach who wants "until Christmas" sets it; nobody has to.
  ends_on      date,
  status       text        not null default 'active',
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  ended_by     uuid        references public.profiles(id) on delete set null,
  constraint session_series_status_chk   check (status in ('active', 'ended')),
  constraint session_series_dow_chk      check (dow between 0 and 6),
  constraint session_series_hour_chk     check (hour between 0 and 23),
  -- Quarter hours, the same grid `trainer_availability.minute` uses. A series
  -- that could start at 07:03 would be a slot no availability template can
  -- ever express and no client could book alongside.
  constraint session_series_minute_chk   check (minute in (0, 15, 30, 45)),
  constraint session_series_duration_chk check (duration_min between 5 and 480),
  constraint session_series_window_chk   check (ends_on is null or ends_on >= starts_on),
  -- An ended series has an end date and an active one does not pretend to.
  constraint session_series_ended_chk    check ((status = 'ended') = (ended_at is not null))
);

create index if not exists session_series_trainer_idx on public.session_series (trainer_id, status);
create index if not exists session_series_client_idx  on public.session_series (client_id, status);

comment on table public.session_series is
  'A standing appointment: this client, this coach, this weekday and local time, every week. '
  'Occurrences are ordinary rows in `sessions` carrying series_id. See supabase/parts/135.';
comment on column public.session_series.tz is
  'IANA zone the local hour is stated in. Validated against pg_timezone_names. '
  'Without it an appointment moves by an hour twice a year and nobody is told.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The occurrence, on the table everything already understands
-- ═════════════════════════════════════════════════════════════════════════
--
-- `on delete set null` rather than cascade, deliberately. Deleting a series
-- must never delete a session that has already been DELIVERED — the coach is
-- owed for it, payroll counts it, the client approved it. Detaching the row
-- from the arrangement it came from is the correct erasure; removing the
-- evidence that the work happened is not.
alter table public.sessions
  add column if not exists series_id uuid references public.session_series(id) on delete set null;
-- The LOCAL date of the occurrence, not derivable from starts_at without
-- knowing the zone. It is what makes materialising idempotent.
alter table public.sessions
  add column if not exists occurrence_on date;

-- One row per series per date, forever. This is the whole of the idempotence:
-- the materialiser runs daily and inserts only dates that are not already
-- there, so a slot the client CANCELLED (part 126 leaves the row in place,
-- freed, still carrying series_id and occurrence_on) is never silently
-- re-booked underneath them the next morning.
create unique index if not exists sessions_series_occurrence_uniq
  on public.sessions (series_id, occurrence_on)
  where series_id is not null;

create index if not exists sessions_series_idx on public.sessions (series_id) where series_id is not null;

comment on column public.sessions.series_id is
  'The standing appointment this session is an occurrence of, or NULL for a one-off. See supabase/parts/135.';
comment on column public.sessions.occurrence_on is
  'The LOCAL date of the occurrence in the series'' zone. Not derivable from starts_at alone.';

-- A session may only be attached to a series belonging to the SAME coach.
--
-- `sessions_trainer` is `for all` on `trainer_id = auth.uid()`, so a coach can
-- update their own session rows directly — including this column. Without this
-- guard one coach could point a row of theirs at another coach's series and,
-- through the unique index above, stop that series materialising the date they
-- claimed. Structural, and it costs one lookup on a column almost nothing
-- writes.
create or replace function public.session_series_same_coach()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if new.series_id is null then
    new.occurrence_on := null;
    return new;
  end if;
  if not exists (
    select 1 from session_series ss
     where ss.id = new.series_id and ss.trainer_id = new.trainer_id
  ) then
    raise exception 'That series belongs to another coach.' using errcode = '42501';
  end if;
  if new.occurrence_on is null then
    raise exception 'A series occurrence must carry the date it is an occurrence of.' using errcode = '23514';
  end if;
  return new;
end $fn$;

revoke all on function public.session_series_same_coach() from public, anon, authenticated;

drop trigger if exists sessions_series_same_coach on public.sessions;
create trigger sessions_series_same_coach
  before insert or update of series_id, occurrence_on, trainer_id on public.sessions
  for each row execute function public.session_series_same_coach();


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Who may read an arrangement
-- ═════════════════════════════════════════════════════════════════════════
--
-- The two people in it. No tenant branch and no owner branch: part 120's lesson
-- is that `role = 'owner'` is never an authorisation, and a gym owner reading
-- which of a coach's clients has a standing Tuesday is roster surveillance
-- rather than anything the gym needs to run.
--
-- SELECT only. Every write below goes through a SECURITY DEFINER function,
-- because none of what makes a series legitimate is expressible as a row
-- predicate: creating one materialises eight weeks of sessions against an
-- exclusion constraint, and ending one has to decide, per future occurrence,
-- whether it belongs to the arrangement any more.
alter table public.session_series enable row level security;

drop policy if exists session_series_parties_r on public.session_series;
create policy session_series_parties_r on public.session_series
  for select to authenticated
  using (trainer_id = (select auth.uid()) or client_id = (select auth.uid()));

-- RLS narrows a GRANT; it does not confer access, and Supabase's stock default
-- privileges hand `anon` the full DML set on anything created in this schema
-- (parts 119, 120, 134). A privilege that is only ever refused is a privilege
-- to remove.
revoke all on public.session_series from anon;
revoke insert, update, delete on public.session_series from authenticated;
grant select on public.session_series to authenticated;

-- Never created, and dropped by name as well, so one added live by hand and
-- written down nowhere does not survive a re-run of setup.sql.
drop policy if exists session_series_owner_r  on public.session_series;
drop policy if exists session_series_tenant_r on public.session_series;


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Materialising — the thing nobody has to re-tap
-- ═════════════════════════════════════════════════════════════════════════
--
-- Internal. No authorisation of its own and therefore executable by NOBODY:
-- the callers below have already established who may touch this series.
-- Revoked from public, anon AND authenticated — part 120 is the record of what
-- happens when only `public` is revoked and the two API roles are left holding
-- their separate grants.
--
-- Returns a report rather than a count because "created 7, skipped 1 on the
-- 14th" and "created 8" are different things to say to a coach, and a caller
-- that has to re-read the calendar to work out which happened can be told a
-- different story than the one that was written.
create or replace function public._materialise_session_series(p_series uuid, p_horizon_days int default 56)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_s        record;
  v_today    date;
  v_horizon  date;
  v_date     date;
  v_ts       timestamptz;
  v_rows     int;
  v_created  int := 0;
  v_skipped  int := 0;
  v_clashes  jsonb := '[]'::jsonb;
  v_tenant   uuid;
begin
  select ss.* into v_s from session_series ss where ss.id = p_series for update;
  if not found or v_s.status <> 'active' then
    return jsonb_build_object('created', 0, 'skipped', 0, 'clashed_on', '[]'::jsonb);
  end if;

  select t.tenant_id into v_tenant from trainers t where t.id = v_s.trainer_id;

  -- "Today" is today WHERE THE APPOINTMENT IS, not where the server is. A
  -- coach in Auckland materialising at 11:00 UTC is on tomorrow's date, and a
  -- horizon measured in the server's day would be a day short or a day long
  -- for half the world.
  v_today   := (now() at time zone v_s.tz)::date;
  v_horizon := v_today + greatest(p_horizon_days, 0);

  -- First candidate: the later of the series start and today, rolled forward
  -- to the next matching weekday. `(target - actual + 7) % 7` is 0 when today
  -- already is the day, which is right — this morning's occurrence is still
  -- wanted if its hour has not passed.
  v_date := greatest(v_s.starts_on, v_today);
  v_date := v_date + ((v_s.dow - extract(dow from v_date)::int + 7) % 7);

  while v_date <= v_horizon and (v_s.ends_on is null or v_date <= v_s.ends_on) loop
    v_ts := (v_date + make_time(v_s.hour, v_s.minute, 0)) at time zone v_s.tz;

    -- Never into the past. A materialiser that back-fills writes sessions
    -- nobody attended and payroll then counts them.
    -- Nor a second time: the unique index makes this check the difference
    -- between idempotent and "re-books an occurrence the client cancelled".
    if v_ts > now()
       and not exists (select 1 from sessions s
                        where s.series_id = v_s.id and s.occurrence_on = v_date) then
      begin
        -- Claim one of the coach's own OPEN slots at exactly this instant if
        -- there is one, rather than adding a second row beside it. Otherwise
        -- the coach's Generate and their standing appointment both draw an
        -- 07:00 Tuesday, a client books the open one, and the exclusion
        -- constraint refuses them at the moment of tapping — a slot the app
        -- offered and the database then took away.
        update sessions s
           set client_id = v_s.client_id, status = 'booked', released = false,
               series_id = v_s.id, occurrence_on = v_date
         where s.id = (
           select s2.id from sessions s2
            where s2.trainer_id = v_s.trainer_id
              and s2.starts_at = v_ts
              and s2.duration_min = v_s.duration_min
              and s2.status = 'available'
              and s2.series_id is null
            order by s2.created_at
            limit 1
              for update skip locked);
        get diagnostics v_rows = row_count;

        if v_rows = 0 then
          insert into sessions (trainer_id, client_id, starts_at, duration_min,
                                status, released, tenant_id, series_id, occurrence_on)
          values (v_s.trainer_id, v_s.client_id, v_ts, v_s.duration_min,
                  'booked', false, v_tenant, v_s.id, v_date);
        end if;
        v_created := v_created + 1;
      exception when exclusion_violation then
        -- The coach is already booked or blocked across that hour. Skip the
        -- date, keep the arrangement, and say which date so somebody can act
        -- on it. See the header.
        v_skipped := v_skipped + 1;
        v_clashes := v_clashes || to_jsonb(v_date::text);
      end;
    end if;

    v_date := v_date + 7;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'clashed_on', v_clashes);
end $fn$;

revoke all on function public._materialise_session_series(uuid, int) from public, anon, authenticated;

comment on function public._materialise_session_series(uuid, int) is
  'Internal. Writes the missing occurrences of one series out to the horizon. '
  'Callers must authorise first; this function does not.';


-- The daily run. Also internal — it is called by cron, which runs as the table
-- owner, and by nothing that a signed-in person can reach.
--
-- Every active series, every day, eight weeks ahead. This is the sentence the
-- feature is: nobody re-taps Generate. A series created today is complete to
-- the horizon within the minute; every morning after that it grows by the one
-- day that just came into range.
create or replace function public.run_session_series_materialiser(p_horizon_days int default 56)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_id      uuid;
  v_rep     jsonb;
  v_series  int := 0;
  v_created int := 0;
  v_skipped int := 0;
begin
  for v_id in
    select ss.id from session_series ss
     where ss.status = 'active'
       and (ss.ends_on is null or ss.ends_on >= (now() at time zone ss.tz)::date)
     order by ss.created_at
  loop
    -- One series failing must not stop the rest of the gym's week being
    -- written. A clash is already handled per-date inside; this is the
    -- backstop for anything else — a series whose coach row went away, a zone
    -- removed from the tzdata between runs.
    begin
      v_rep := public._materialise_session_series(v_id, p_horizon_days);
      v_series  := v_series + 1;
      v_created := v_created + (v_rep->>'created')::int;
      v_skipped := v_skipped + (v_rep->>'skipped')::int;
    exception when others then
      continue;
    end;
  end loop;
  return jsonb_build_object('series', v_series, 'created', v_created, 'skipped', v_skipped);
end $fn$;

revoke all on function public.run_session_series_materialiser(int) from public, anon, authenticated;

create extension if not exists pg_cron;

-- Unschedule first so re-running this file does not accumulate duplicate jobs
-- each firing the same run, exactly as part 48 does.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'materialise-session-series') then
    perform cron.unschedule('materialise-session-series');
  end if;
end $$;

-- 03:17 UTC, daily. Once a day is enough for a horizon measured in weeks, and
-- the odd minute keeps it off the top of the hour where everything else in a
-- Postgres runs. The job runs as the table owner, so nothing here widens what a
-- signed-in person can reach.
select cron.schedule(
  'materialise-session-series',
  '17 3 * * *',
  $cron$ select public.run_session_series_materialiser(); $cron$
);


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · Making one
-- ═════════════════════════════════════════════════════════════════════════
--
-- The coach's call. A client cannot create a standing appointment in somebody
-- else's diary, which is why this is not an insert policy.
create or replace function public.create_session_series(
  p_client    uuid,
  p_dow       int,
  p_hour      int,
  p_minute    int,
  p_duration  int,
  p_tz        text,
  p_starts_on date default null,
  p_ends_on   date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_from   date;
  v_rep    jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not exists (select 1 from clients c where c.id = p_client and c.trainer_id = v_uid) then
    raise exception 'They are not your client.' using errcode = '42501';
  end if;
  -- A name Postgres does not know would otherwise be taken as UTC by
  -- `at time zone`, and the appointment would be at seven in the morning
  -- somewhere nobody involved lives.
  if p_tz is null or not exists (select 1 from pg_timezone_names z where z.name = p_tz) then
    raise exception 'That is not a time zone this server knows.' using errcode = '22023';
  end if;

  v_from := coalesce(p_starts_on, (now() at time zone p_tz)::date);

  insert into session_series (trainer_id, client_id, dow, hour, minute, duration_min, tz, starts_on, ends_on)
  values (v_uid, p_client, p_dow, p_hour, p_minute, p_duration, p_tz, v_from, p_ends_on)
  returning id into v_id;

  -- Immediately, not at 03:17 tomorrow. A coach who agrees a standing Tuesday
  -- with somebody standing in front of them expects to see it on the calendar
  -- before they put the phone down.
  v_rep := public._materialise_session_series(v_id);

  return jsonb_build_object(
    'series_id',  v_id,
    'created',    v_rep->'created',
    'skipped',    v_rep->'skipped',
    'clashed_on', v_rep->'clashed_on');
end $fn$;

revoke all on function public.create_session_series(uuid, int, int, int, int, text, date, date) from public, anon;
grant execute on function public.create_session_series(uuid, int, int, int, int, text, date, date) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · Ending one — and why this is NOT a year of cancellations
-- ═════════════════════════════════════════════════════════════════════════
--
-- THIS IS THE DANGEROUS FUNCTION IN THIS FILE. Read the whole note.
--
-- Part 126 records a late-cancellation fee when a client frees a booked session
-- inside their coach's notice window. It is per session, it is correct, and it
-- is exactly what should happen when somebody cannot make next Tuesday.
--
-- If ending a SERIES were implemented as "call cancel_my_session for every
-- future occurrence", a client stopping a standing appointment would be charged
-- the late fee for every session in the horizon — and, once the materialiser
-- had been running a while on a year-long series, for a year of sessions they
-- were cancelling two months in advance. That is the single worst thing this
-- feature could do to somebody, and it is the obvious implementation.
--
-- So ending a series CHARGES NOTHING, EVER, and it does not go anywhere near
-- `cancel_my_session`.
--
--   · Occurrences on or before `p_effective` are untouched. The default is
--     today, so ending a series never disturbs a session that has already
--     happened or is happening.
--
--   · Occurrences AFTER it that are still booked to the series client, with no
--     outcome recorded, are DELETED. Not freed: they were never open
--     availability, they existed only because of this arrangement, and leaving
--     a year of empty Tuesdays on the coach's calendar would be a worse lie
--     than removing them. No charge is raised for any of them.
--
--   · Any other future occurrence carrying this series id — one the client
--     cancelled singly and somebody took off the waitlist, one the coach has
--     already marked delivered, one that was a pre-existing open slot the
--     materialiser claimed — is LEFT EXACTLY AS IT IS and merely detached from
--     the series. Ending an arrangement must not reach into a session that now
--     belongs to somebody else.
--
-- WHAT ABOUT THE NEXT ONE, THE ONE INSIDE THE NOTICE WINDOW? It stays booked,
-- on purpose, and the apps say so in as many words (RECURRING_END_RULE in
-- src/lib/recurring.ts). "We will stop after next Tuesday" is what ending a
-- standing appointment means to the two people in it. If the client also cannot
-- make that last one, they cancel that one session, through the ordinary
-- button, and their coach's ordinary notice policy applies to it — one session,
-- one decision, one fee at most. The alternative is this function quietly
-- pricing a cancellation the person never made.
--
-- Either party may end it. A standing appointment is an agreement, and an
-- agreement one side cannot leave is not one.
create or replace function public.end_session_series(p_series uuid, p_effective date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_s       record;
  v_cut     date;
  v_removed int := 0;
  v_kept    int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select ss.* into v_s from session_series ss where ss.id = p_series for update;
  if not found then
    raise exception 'That standing appointment no longer exists.' using errcode = '42501';
  end if;
  if v_s.trainer_id <> v_uid and v_s.client_id <> v_uid then
    raise exception 'That standing appointment is not yours.' using errcode = '42501';
  end if;

  v_cut := coalesce(p_effective, (now() at time zone v_s.tz)::date);

  -- Removed: still ours, still booked, never delivered. Nothing else.
  delete from sessions s
   where s.series_id = p_series
     and s.occurrence_on > v_cut
     and s.status = 'booked'
     and s.client_id = v_s.client_id
     and s.outcome is null;
  get diagnostics v_removed = row_count;

  -- Everything else in the future keeps its place on the calendar and simply
  -- stops belonging to an arrangement that has ended.
  update sessions s
     set series_id = null, occurrence_on = null
   where s.series_id = p_series
     and s.occurrence_on > v_cut;
  get diagnostics v_kept = row_count;

  update session_series
     set status = 'ended', ends_on = v_cut, ended_at = now(), ended_by = v_uid
   where id = p_series;

  return jsonb_build_object(
    'ended', true,
    'effective_on', v_cut,
    'removed', v_removed,
    'left_standing', v_kept,
    -- Stated rather than implied. Every screen that reports this reads it from
    -- here, so no app can invent a fee this function did not raise.
    'charged', false);
end $fn$;

revoke all on function public.end_session_series(uuid, date) from public, anon;
grant execute on function public.end_session_series(uuid, date) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 7 · Reading them
-- ═════════════════════════════════════════════════════════════════════════
--
-- Both apps, one function. The RLS policy above already scopes `session_series`
-- to the two parties, so this adds only the counts — how many occurrences are
-- on the books, and when the next one is — which a client cannot compute
-- themselves because `sessions_client_read` shows them their own sessions but
-- not a count they could trust to be complete under the PostgREST row cap.
create or replace function public.my_session_series()
returns table (
  id           uuid,
  trainer_id   uuid,
  client_id    uuid,
  client_name  text,
  dow          smallint,
  hour         smallint,
  minute       smallint,
  duration_min int,
  tz           text,
  starts_on    date,
  ends_on      date,
  status       text,
  upcoming     int,
  next_at      timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select ss.id, ss.trainer_id, ss.client_id,
         -- The coach sees who it is with. The client is looking at their own
         -- arrangement and does not need to be told their own name.
         case when ss.trainer_id = auth.uid() then p.full_name else null end as client_name,
         ss.dow, ss.hour, ss.minute, ss.duration_min, ss.tz,
         ss.starts_on, ss.ends_on, ss.status,
         (select count(*)::int from sessions s
           where s.series_id = ss.id and s.starts_at > now() and s.status = 'booked') as upcoming,
         (select min(s.starts_at) from sessions s
           where s.series_id = ss.id and s.starts_at > now() and s.status = 'booked') as next_at
    from session_series ss
    left join profiles p on p.id = ss.client_id
   where ss.trainer_id = auth.uid() or ss.client_id = auth.uid()
   order by ss.status, ss.dow, ss.hour, ss.minute
   limit 500;
$fn$;

revoke all on function public.my_session_series() from public, anon;
grant execute on function public.my_session_series() to authenticated;
