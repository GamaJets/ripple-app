-- ═════════════════════════════════════════════════════════════════════════
-- A standing appointment cannot be paused, or skipped for a week.
--
-- Part 135 gave a member every Tuesday at seven for as long as they want it,
-- and exactly two ways out: cancel ONE occurrence, or end the arrangement. A
-- fortnight away is therefore two separate cancellations — two taps in two
-- places, each priced on its own notice, each capable of costing a late fee —
-- and there is no way at all to say "not for the next two weeks" once. Somebody
-- who forgets the second one has a coach standing in an empty gym.
--
-- ── The model: a skip is a HOLE IN THE ARRANGEMENT, not a state on it ────
--
-- `session_series` gains nothing. A pause is a row in its own table naming a
-- date range, and there may be several: a member with a fortnight in June and
-- a week in September has two holes, not a status that is "paused" and then
-- somehow paused again. Two columns on the series would force the second
-- absence to overwrite the first, and the overwritten one comes back as eight
-- weeks of sessions nobody expected.
--
-- The hole is read in exactly two places and both are below:
--
--   · the MATERIALISER skips a date inside one, so the pause survives. This is
--     the half that makes it a pause rather than a tidy-up: without it, part
--     135's daily run writes the Tuesday back out the next morning, and the
--     member's cancelled fortnight quietly re-books itself.
--   · PAUSING removes the occurrences that have already been written out.
--
-- ── The money, and why this file contains none of it ────────────────────
--
-- Removing an occurrence that is already booked IS a cancellation, and it is
-- priced like one. There is no cheaper door here: a pause taken an hour before
-- Tuesday's session is a late cancellation of Tuesday's session, whatever the
-- screen it was tapped on, and a coach whose policy could be sidestepped by
-- pausing would have no policy at all.
--
-- So `pause_my_session_series` does not price anything itself. It CALLS
-- `cancel_my_session` (part 126) once per already-booked occurrence in the
-- range, which is the one place in this database that knows the coach's notice
-- window, records the fee, snapshots the currency and promotes the waitlist. A
-- second implementation of that would be a second answer to "what does this
-- cost", and the two would disagree within a month.
--
-- The report adds up what those calls did, so the app can tell the member
-- exactly what a pause cost before and after they take one. In the ordinary
-- case — a holiday booked in advance — every occurrence is outside the window
-- and the answer is nothing.
--
-- ── Who may pause ───────────────────────────────────────────────────────
--
-- The CLIENT, and only the client. That is not a judgement about coaches, it
-- is what `cancel_my_session` enforces one call down: it frees a session where
-- `client_id = auth.uid()` and nothing else, so a coach calling this would
-- record a skip and free nothing, which is the worst of both. A coach who
-- needs a fortnight off has their own blocked time (part 89) and
-- `end_session_series` (part 135).
-- ═════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The hole
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.session_series_skips (
  id         uuid        primary key default gen_random_uuid(),
  series_id  uuid        not null references public.session_series(id) on delete cascade,
  -- LOCAL dates in the series' own zone, which is what `occurrence_on` is and
  -- what the materialiser walks. A range stored as instants would move by an
  -- hour twice a year and take a Tuesday with it.
  from_on    date        not null,
  to_on      date        not null,
  created_at timestamptz not null default now(),
  created_by uuid        references public.profiles(id) on delete set null,
  -- Optional and free text: "away", "shoulder". Shown to both of them, because
  -- a coach seeing four weeks disappear is entitled to a word about why.
  reason     text,
  constraint session_series_skips_range_chk check (from_on <= to_on)
);

alter table public.session_series_skips enable row level security;

create index if not exists session_series_skips_series_idx
  on public.session_series_skips (series_id, from_on);

comment on table public.session_series_skips is
  'A date range this standing appointment does not run. Read by the materialiser '
  'so the pause survives its daily run. Written only by pause_my_session_series. '
  'See supabase/parts/244.';

-- Both people in the arrangement read it. Same pair, same reasoning and same
-- omissions as `session_series_parties_r`: no tenant branch and no owner
-- branch, because part 120's lesson is that `role = 'owner'` is never an
-- authorisation and when a member is away is not something the gym needs.
drop policy if exists session_series_skips_parties_r on public.session_series_skips;
create policy session_series_skips_parties_r on public.session_series_skips
  for select to authenticated
  using (exists (
    select 1 from public.session_series ss
     where ss.id = session_series_skips.series_id
       and (ss.client_id = (select auth.uid()) or ss.trainer_id = (select auth.uid()))
  ));

-- SELECT only. Both writes go through the SECURITY DEFINER functions below,
-- because neither is expressible as a row predicate: pausing has to cancel the
-- occurrences already written out, and resuming has to write them back.
--
-- RLS narrows a GRANT; it does not confer access, and Supabase's stock default
-- privileges hand `anon` the full DML set on anything created in this schema
-- (parts 119, 120, 134). A privilege that is only ever refused is one to
-- remove.
revoke all on public.session_series_skips from anon;
revoke insert, update, delete on public.session_series_skips from authenticated;
grant select on public.session_series_skips to authenticated;

drop policy if exists session_series_skips_owner_r  on public.session_series_skips;
drop policy if exists session_series_skips_tenant_r on public.session_series_skips;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The materialiser, which must now know about the hole
-- ═════════════════════════════════════════════════════════════════════════
--
-- A SUPERSEDE of part 135's `_materialise_session_series`, said out loud
-- because part 83 is the record of what happens when one is not. A function is
-- not a policy: `create or replace` with the same signature leaves exactly one
-- definition standing, so there is no older copy to drop and no second version
-- to be OR'd with this one. Part 135 remains the account of why this function
-- exists and why it is shaped the way it is — the zone reasoning, the clash
-- handling, the claim of an existing open slot, and the deliberate absence of a
-- pack credit are all unchanged and are all still argued there.
--
-- ONE CONDITION IS ADDED, in the `if` that decides whether to write a date:
-- a date inside a skip range is not written. Without it this function undoes
-- the pause every morning.
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
  v_paused   int := 0;
  v_clashes  jsonb := '[]'::jsonb;
  v_tenant   uuid;
begin
  select ss.* into v_s from session_series ss where ss.id = p_series for update;
  if not found or v_s.status <> 'active' then
    return jsonb_build_object('created', 0, 'skipped', 0, 'paused', 0, 'clashed_on', '[]'::jsonb);
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

    -- THE ADDED CONDITION. A date the member has paused is not written out,
    -- today or on any morning after it. Counted separately from a clash and
    -- reported separately, because a paused date is a thing somebody chose and
    -- a clash is a thing that went wrong, and a coach reading one report should
    -- not have to guess which of the two happened.
    if exists (
      select 1 from session_series_skips k
       where k.series_id = v_s.id and v_date between k.from_on and k.to_on
    ) then
      v_paused := v_paused + 1;

    -- Never into the past. A materialiser that back-fills writes sessions
    -- nobody attended and payroll then counts them.
    -- Nor a second time: the unique index makes this check the difference
    -- between idempotent and "re-books an occurrence the client cancelled".
    elsif v_ts > now()
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
        -- on it. See part 135's header.
        v_skipped := v_skipped + 1;
        v_clashes := v_clashes || to_jsonb(v_date::text);
      end;
    end if;

    v_date := v_date + 7;
  end loop;

  -- `created`, `skipped` and `clashed_on` keep their names and their meanings,
  -- so part 135's callers and everything reading their reports are unaffected.
  -- `paused` is new and additive.
  return jsonb_build_object('created', v_created, 'skipped', v_skipped,
                            'paused', v_paused, 'clashed_on', v_clashes);
end $fn$;

revoke all on function public._materialise_session_series(uuid, int) from public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Pausing
-- ═════════════════════════════════════════════════════════════════════════
--
-- Records the hole, then clears the occurrences already inside it — through
-- `cancel_my_session`, which is the only thing in this database that knows what
-- a cancellation costs. See the header on why there is no pricing here.
create or replace function public.pause_my_session_series(
  p_series uuid,
  p_from   date,
  p_to     date,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_s        record;
  v_today    date;
  v_skip     uuid;
  v_occ      record;
  v_rep      jsonb;
  v_freed    int := 0;
  v_charged  int := 0;
  v_fees     numeric := 0;
  v_currency text := null;
  v_mixed    boolean := false;
  v_failed   int := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'That is not a range of dates.' using errcode = '22023';
  end if;

  select ss.id, ss.tz, ss.status, ss.client_id
    into v_s
    from session_series ss
   where ss.id = p_series and ss.client_id = v_uid
     for update;
  if not found then
    -- The client's own arrangement, and nobody else's. A coach reaching this
    -- would record a skip and free nothing, because cancel_my_session below
    -- only frees sessions booked to the caller.
    raise exception 'That standing appointment is not yours.' using errcode = '42501';
  end if;
  if v_s.status <> 'active' then
    raise exception 'That standing appointment has already ended.' using errcode = '22023';
  end if;

  -- Today in the arrangement's own zone, exactly as the materialiser measures
  -- it. A pause that ended yesterday is not a pause, it is a request to undo
  -- sessions that have already happened, and this product does not do that.
  v_today := (now() at time zone v_s.tz)::date;
  if p_to < v_today then
    raise exception 'That pause is entirely in the past.' using errcode = '22023';
  end if;

  insert into session_series_skips (series_id, from_on, to_on, created_by, reason)
  values (p_series, greatest(p_from, v_today), p_to, v_uid,
          nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_skip;

  -- Every occurrence already written out inside the hole, oldest first so the
  -- report reads in the order the member's calendar does.
  for v_occ in
    select s.id, s.starts_at
      from sessions s
     where s.series_id = p_series
       and s.client_id = v_uid
       and s.status = 'booked'
       and s.occurrence_on between greatest(p_from, v_today) and p_to
       and s.starts_at > now()
     order by s.starts_at
  loop
    v_rep := public.cancel_my_session(v_occ.id);
    if coalesce((v_rep ->> 'freed')::boolean, false) then
      v_freed := v_freed + 1;
      if coalesce((v_rep ->> 'charged')::boolean, false) then
        v_charged := v_charged + 1;
        v_fees := v_fees + coalesce((v_rep ->> 'fee')::numeric, 0);
        -- Two fees in two different currencies are not a sum of money. If the
        -- gym's currency changed between two occurrences the total is withheld
        -- rather than added up, which is the rule src/lib/coachMoney.ts states
        -- at length and the one thing a figure about somebody's money must not
        -- get wrong.
        if v_currency is null then v_currency := v_rep ->> 'currency';
        elsif v_currency is distinct from (v_rep ->> 'currency') then v_mixed := true;
        end if;
      end if;
    else
      -- Refused, which at this point means it moved under us: somebody
      -- cancelled it on another device between the select and the call.
      -- Counted rather than raised — the pause itself is recorded and correct.
      v_failed := v_failed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'skip_id', v_skip,
    'from_on', greatest(p_from, v_today),
    'to_on', p_to,
    'freed', v_freed,
    'charged', v_charged,
    -- Null when nothing was charged, and null when the fees were in more than
    -- one currency. A number with no unit is not an amount of money.
    'fees', case when v_charged = 0 or v_mixed then null else v_fees end,
    'currency', case when v_charged = 0 or v_mixed then null else v_currency end,
    'mixed_currencies', v_mixed,
    'not_freed', v_failed);
end $fn$;

revoke all on function public.pause_my_session_series(uuid, date, date, text) from public, anon;
grant execute on function public.pause_my_session_series(uuid, date, date, text) to authenticated;

comment on function public.pause_my_session_series(uuid, date, date, text) is
  'Skip a standing appointment for a range of dates. Records the hole so the '
  'materialiser does not fill it back in, and cancels the occurrences already '
  'inside it through cancel_my_session, which is the only thing here that prices '
  'a cancellation. See supabase/parts/244.';


-- The same thing said in weeks, which is how a person going away says it.
--
-- THE DATES ARE COMPUTED HERE, NOT ON THE PHONE, and that is the whole reason
-- this exists beside the function above. "Today" for a standing appointment is
-- today IN THE ARRANGEMENT'S OWN ZONE — the zone `occurrence_on` is a date in
-- and the zone the materialiser walks — and a member on holiday in Sydney
-- pausing a London Tuesday would otherwise send Sydney's date and pause the
-- wrong dates at both ends. The device cannot get this right without knowing
-- the series' zone, and it is one line to get it right here.
--
-- `p_days` counts from today inclusive: 7 is this week, 14 a fortnight.
create or replace function public.pause_my_session_series_for(
  p_series uuid,
  p_days   int,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_tz    text;
  v_today date;
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'A pause is between one day and a year.' using errcode = '22023';
  end if;
  -- Only the zone is read here. Everything that authorises the pause — that
  -- this is the caller's own arrangement, and that it is still active — is
  -- decided by the function below, in one place, rather than half-checked twice.
  select ss.tz into v_tz from session_series ss where ss.id = p_series;
  if v_tz is null then
    raise exception 'That standing appointment is not yours.' using errcode = '42501';
  end if;
  v_today := (now() at time zone v_tz)::date;
  return public.pause_my_session_series(p_series, v_today, v_today + (p_days - 1), p_reason);
end $fn$;

revoke all on function public.pause_my_session_series_for(uuid, int, text) from public, anon;
grant execute on function public.pause_my_session_series_for(uuid, int, text) to authenticated;

comment on function public.pause_my_session_series_for(uuid, int, text) is
  'Pause a standing appointment for N days from today IN THE ARRANGEMENT''S OWN '
  'ZONE. The dates are computed here so a member abroad cannot pause the wrong '
  'ones. Delegates to pause_my_session_series. See supabase/parts/244.';


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Resuming
-- ═════════════════════════════════════════════════════════════════════════
--
-- Removes the hole and writes the arrangement back out immediately, rather
-- than leaving it to tomorrow's cron. A member who comes back early and is
-- told "your Tuesdays will reappear at some point" has not been given their
-- Tuesdays back.
--
-- `_materialise_session_series` is revoked from `authenticated`, and this
-- function can still call it: EXECUTE is checked against the current user,
-- which inside a SECURITY DEFINER function is its owner. That is the whole
-- reason the internal function exists.
--
-- Dates that have already passed while paused do not come back — the
-- materialiser never writes into the past, deliberately (part 135), and a week
-- of sessions nobody attended appearing on a coach's calendar is exactly what
-- that rule exists to stop.
create or replace function public.resume_my_session_series(p_skip uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_series uuid;
  v_rep    jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  delete from session_series_skips k
   using session_series ss
   where k.id = p_skip
     and ss.id = k.series_id
     and ss.client_id = v_uid
  returning k.series_id into v_series;

  if v_series is null then
    -- Not theirs, or already lifted. A refusal rather than a fault, and said
    -- as one: PostgREST reports a delete that matched nothing as a success,
    -- which is how "resumed" gets printed over a pause that is still in place.
    return jsonb_build_object('resumed', false, 'created', 0);
  end if;

  v_rep := public._materialise_session_series(v_series);
  return jsonb_build_object(
    'resumed', true,
    'created', coalesce((v_rep ->> 'created')::int, 0),
    'clashed_on', coalesce(v_rep -> 'clashed_on', '[]'::jsonb));
end $fn$;

revoke all on function public.resume_my_session_series(uuid) from public, anon;
grant execute on function public.resume_my_session_series(uuid) to authenticated;

comment on function public.resume_my_session_series(uuid) is
  'Lift a pause and write the arrangement back out to the horizon at once. '
  'Dates that passed while it was paused do not come back. See supabase/parts/244.';
