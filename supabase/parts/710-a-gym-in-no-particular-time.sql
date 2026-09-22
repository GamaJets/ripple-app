-- ═══════════════════════════════════════════════════════════════════════════
-- A gym in no particular time.
--
-- Five screens in the web console say "in the gym's own timezone" and one says
-- "in the gym's own time". There is no such thing. `tenants` has held a name, a
-- colour, a currency, a plan, a session fee and a pay policy since part 01 and
-- has never held a zone, so every one of those sentences means the zone of the
-- laptop the sentence is being read on — the front desk's Windows machine, the
-- owner's phone in an airport, a bookkeeper in another country opening the same
-- console. Three readers, three different Tuesdays, one gym.
--
-- The damage is not theoretical and it is not cosmetic:
--
--   · /accounting draws a week and labels it the gym's, and a Dubai gym's
--     Sunday takings land in the reader's Saturday for four hours of every day.
--   · /analytics draws door entries by hour "in the gym's own time" — the one
--     chart whose entire finding is WHICH HOUR — from `getHours()` on the
--     reader's machine.
--   · src/lib/freshness.ts had to be built elapsed-only, and says so in its
--     own header: "a calendar needs a timezone the gym does not have".
--
-- ── The shape, taken from parts 530 and 650 ──────────────────────────────
--
-- Both hit this wall for one coach and both answered it the same way, and this
-- takes the answer unchanged:
--
--   · The zone is STORED beside the thing it qualifies, as an IANA name.
--   · It is VALIDATED against pg_timezone_names on the way in, so one typo in
--     one gym's settings cannot make a query raise for everybody else. Part 530
--     spells out the failure: a bad value inside a view is discovered during a
--     statement that runs over every row, and it takes the whole statement
--     down. Refused at the write, it costs one person who is looking at the
--     field they just typed in.
--   · The arithmetic is done HERE. `at time zone` asks Postgres's own zone
--     database, which knows that the clocks moved; a `getHours()` in an edge
--     function is the hour in the function's region, and a stored UTC offset is
--     right until a Sunday in spring and then silently wrong for a fortnight.
--
-- ── AND THERE IS NO HONEST DEFAULT ───────────────────────────────────────
--
-- The column is NULLABLE, it ships null for every gym that exists, and nothing
-- fills it in. That is the whole decision, and it is the same one part 99 made
-- for the currency, part 118 made for the brand colour and part 166 made for
-- the pay policy — with one extra reason that is specific to a zone.
--
-- The two candidate defaults are both worse than nothing:
--
--   · UTC is correct for gyms in Iceland and in Ghana and is wrong for almost
--     everybody else. A London gym's day would be right for seven months and an
--     hour out for five, which is the worst possible failure because it works
--     during the whole of the period somebody would be testing it.
--   · The browser's zone is the zone of whoever last opened the console. It is
--     a fact about a laptop. Writing it to `tenants` would turn a bookkeeper
--     opening the console from Lisbon into a permanent, invisible claim about
--     where the gym is, and nothing on any screen would ever say so.
--
-- So a gym with no zone is a WITHHELD ANSWER. `tenant_clock` returns a row with
-- a null `local_now`, `tenant_day()` returns null, and the screens say the day
-- they are drawing is the reader's own rather than pretending otherwise. Part
-- 650's sentence applies word for word: a slot generated in the wrong zone is
-- worse than no slot, because a client books one. A week of takings labelled
-- with the wrong day is worse than an unlabelled one, because an owner settles
-- against it.
--
-- ── What this part does NOT do ───────────────────────────────────────────
--
-- It does not convert anything already stored. Every timestamp in this database
-- is `timestamptz`, which is an instant and has never needed a zone; the zone
-- is only ever needed to decide which DAY an instant belongs to and what hour
-- it was. Nothing is re-bucketed, nothing is rewritten, and a gym that sets its
-- zone today changes what future reads say about the past — which is correct,
-- because the past always did happen at that gym's hour and the reader was the
-- one getting it wrong.
--
-- It also does not finish the job. The consumers are listed at the foot of this
-- file with which ones read the gym's zone today and which still read the
-- browser's, so the next person does not have to grep for them.
--
-- Idempotent; additive; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenants add column if not exists timezone text;

comment on column public.tenants.timezone is
  'The IANA zone this gym''s own day is measured in — ''Europe/London'', ''Asia/Dubai''. NULL means the gym has not said, and NULL is never to be read as UTC or as the reader''s own zone: a screen that cannot get this answer says whose day it is actually drawing. Validated against pg_timezone_names on write by trg_tenants_timezone, so no query that does date arithmetic over many gyms can be made to raise by one gym''s typo.';

-- ── refused at the write ─────────────────────────────────────────────────
--
-- A separate trigger rather than three more lines inside
-- `tenants_normalise_settings` (part 166). That function is a normaliser — it
-- trims, folds case, and deliberately rescues nothing — and this is a refusal.
-- Keeping them apart means the error a bad zone produces names the zone rather
-- than arriving from a function whose job is described as whitespace.
--
-- It fires after `trg_tenants_normalise` (triggers on one event run in name
-- order and 'n' sorts before 't'), which does not touch this column, so the
-- order between them carries no meaning and is not relied upon.
--
-- An empty string becomes NULL for part 166's reason: '' is what an emptied
-- text field posts, and "the owner cleared it" and "the owner never set it" are
-- the same fact about the gym.
create or replace function public.tenants_timezone_check()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  new.timezone := nullif(btrim(coalesce(new.timezone, '')), '');
  if new.timezone is not null
     and not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'not a timezone this server knows: %', new.timezone
      using hint = 'send an IANA zone name such as Europe/London or Asia/Dubai — not an abbreviation and not an offset';
  end if;
  return new;
end $fn$;

revoke all on function public.tenants_timezone_check() from public, anon, authenticated;

drop trigger if exists trg_tenants_timezone on public.tenants;
create trigger trg_tenants_timezone
  before insert or update on public.tenants
  for each row execute function public.tenants_timezone_check();

-- ── the gym's own day ────────────────────────────────────────────────────
--
-- NULL when the gym has no zone, and that null is the point of the function.
-- A caller that wants a date has to handle it, which is what stops the reader's
-- own day being substituted three call sites downstream where nobody would ever
-- see it happen.
--
-- STABLE, not IMMUTABLE: the answer depends on the row and on `now()`.
-- SECURITY DEFINER so it works from a policy or a view without granting a read
-- of `tenants` — it discloses one gym's calendar date, which is not a secret,
-- and it takes the tenant id from the caller, so it discloses nothing the
-- caller did not already name.
create or replace function public.tenant_day(p_tenant uuid, p_at timestamptz default now())
returns date
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select case
           when t.timezone is null then null
           else (p_at at time zone t.timezone)::date
         end
    from public.tenants t
   where t.id = p_tenant;
$fn$;

comment on function public.tenant_day(uuid, timestamptz) is
  'Which calendar day an instant falls on AT THIS GYM. NULL when the gym has not set a timezone — never the server''s day and never the caller''s. Use it wherever a screen says "today" about a gym.';

revoke all on function public.tenant_day(uuid, timestamptz) from public, anon;
grant execute on function public.tenant_day(uuid, timestamptz) to authenticated;

-- ── the instants a gym's calendar day spans ──────────────────────────────
--
-- The half of this that a `select … where entered_at >= x and entered_at < y`
-- actually needs. Returns NULL bounds for a gym with no zone rather than a day
-- that starts at UTC midnight, so a caller that forgets to check gets no rows
-- rather than the wrong rows — the direction of failure that gets noticed.
--
-- `+ interval '1 day'` on the local date rather than `+ 1` on the instant: on
-- the day the clocks move, the gym's day is 23 or 25 hours long, and adding a
-- fixed 24 hours would cut an hour off one Sunday a year and double-count an
-- hour on another. This is the entire reason the arithmetic is in Postgres.
create or replace function public.tenant_day_bounds(p_tenant uuid, p_day date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select case when t.timezone is null then null
              else (p_day::timestamp) at time zone t.timezone end,
         case when t.timezone is null then null
              else ((p_day::timestamp + interval '1 day') at time zone t.timezone) end
    from public.tenants t
   where t.id = p_tenant;
$fn$;

comment on function public.tenant_day_bounds(uuid, date) is
  'The half-open instant range [starts_at, ends_at) that one calendar day covers at this gym, honouring the 23- and 25-hour days the clocks produce. Both NULL when the gym has no timezone, so a caller that does not check gets no rows rather than a UTC day quietly labelled as the gym''s.';

revoke all on function public.tenant_day_bounds(uuid, date) from public, anon;
grant execute on function public.tenant_day_bounds(uuid, date) to authenticated;

-- ── what time it is at the gym, right now ────────────────────────────────
--
-- One row per gym the caller can already see. This is what a screen reads to
-- put an honest clock on itself, and it exists so no screen has to build one
-- out of a stored offset or `getHours()`.
--
-- security_invoker, for part 530's reason: without it the view runs as its
-- owner and hands any authenticated caller a row for every tenant on the
-- platform. With it, `tenants_owner_rw` and whatever else policies `tenants`
-- decide, exactly as they do for a direct select.
--
-- `local_now` and `local_day` are NULL together and only together — a gym with
-- no zone has no local anything — so a screen can branch on either and cannot
-- get a half-answer. `utc_offset` is included because it is the thing an owner
-- can actually check against the wall: "Asia/Dubai" is a name they may not
-- recognise and four hours ahead is a fact they will.
--
-- The offset is read from `pg_timezone_names` rather than computed with
-- `to_char` over a difference of two timestamps, and it is an INTERVAL rather
-- than a formatted string. Both for the same reason: the sign of a negative
-- offset is the sort of thing a format mask gets wrong once and then nobody
-- looks at again, and every gym west of Greenwich would be the ones it was
-- wrong for. The catalogue's own value already accounts for whether that zone
-- is on summer time at this instant.
drop view if exists public.tenant_clock;
create view public.tenant_clock
  with (security_invoker = true) as
select t.id            as tenant_id,
       t.timezone      as timezone,
       case when t.timezone is null then null
            else now() at time zone t.timezone end                as local_now,
       case when t.timezone is null then null
            else (now() at time zone t.timezone)::date end        as local_day,
       z.utc_offset                                               as utc_offset
  from public.tenants t
  left join lateral (
    select n.utc_offset from pg_timezone_names n where n.name = t.timezone
  ) z on true;

comment on view public.tenant_clock is
  'What time it is at each gym the caller may already read. local_now, local_day and utc_offset are NULL together for a gym that has not set a timezone — that is a withheld answer and screens must render it as one, never as UTC and never as the reader''s own clock. utc_offset is an interval taken from pg_timezone_names, so it already accounts for whether that zone is on summer time right now. security_invoker, so it is exactly as wide as tenants itself.';

-- ── which gyms cannot answer the question ────────────────────────────────
--
-- Counted rather than left to be discovered, the same way part 650 returns
-- `coaches_without_a_zone`: a number that should be falling is worth being able
-- to read. Deliberately not a table anybody writes — it is a query with a name.
create or replace function public.tenants_without_a_timezone()
returns integer
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select count(*)::int from public.tenants where timezone is null;
$fn$;

comment on function public.tenants_without_a_timezone() is
  'How many gyms still have no timezone, and therefore how many have every "today", "this week" and "by hour" figure drawn in whichever zone the reader happens to be sitting in. Should be falling.';

revoke all on function public.tenants_without_a_timezone() from public, anon;
grant execute on function public.tenants_without_a_timezone() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- WHO READS THIS, AND WHO STILL READS THE BROWSER
--
-- Written down because the honest half of this change is knowing which
-- sentences on which screens are still the reader's own clock wearing the
-- gym's name. Nothing below is enforced by the database; it is the list the
-- next person needs.
--
-- Reads the gym's zone as of this part:
--   · studio-web/app/settings/page.tsx  — sets it, and proves it by showing
--     the gym's own wall clock beside the field.
--   · src/lib/gymZone.ts                — the one implementation of the read
--     side, and the only place a zone is turned into a day in TypeScript.
--   · src/lib/freshness.ts              — `fetchedNote` can now say the hour a
--     figure was read AT THE GYM, and still refuses calendar words without a
--     zone.
--   · studio-web/app/staff/page.tsx     — the rota's times and a coach's join
--     date, both of which were the reader's wall clock.
--
-- Still the browser's clock, named so nobody has to grep:
--   · studio-web/app/accounting/page.tsx:471 — "in the gym's own timezone" over
--     a week built from `new Date()` on the reader's machine. The sentence is
--     currently false.
--   · studio-web/app/analytics/page.tsx:1192 — door entries by hour, "in the
--     gym's own time". The chart whose only finding is which hour.
--   · studio-web/app/door/page.tsx:70 — "the calendar day a visit belongs to,
--     in the gym's own timezone", computed locally.
--   · studio-web/app/payroll/page.tsx:74 and app/coach/earnings/page.tsx:72 —
--     "bounds of the calendar month in the gym's own timezone", both built from
--     the browser's month. `tenant_day_bounds` is what these want.
--   · studio-web/app/close/page.tsx, revenue, timetable, classes — every
--     `toLocaleString` without a zone.
-- ═════════════════════════════════════════════════════════════════════════
