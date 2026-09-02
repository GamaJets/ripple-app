-- ─────────────────────────────────────────────────────────────────────────
-- The sweep that only ran when somebody pressed a button.
--
-- `supabase/functions/sweep-stale-visits` is written, commented and deployed
-- nowhere. The only thing in this repository that closes the loop is the
-- owner-only button on the Door screen, and the comment beside that button says
-- so in as many words: the scheduled half is "written and NOT deployed".
--
-- So the sweep runs when a human happens to open /door and press it. A gym that
-- closes for a week comes back to a week of visits still open, an "Inside now"
-- count that includes them, and an average-stay figure the screen has to keep
-- withholding because nothing has accounted for the rows.
--
-- ── Why this is SQL rather than a deploy ─────────────────────────────────
--
-- The edge function exists because the sweep needs to run across every tenant,
-- which no signed-in owner's session can do. That is a real requirement and the
-- service role is a real answer to it — but it is a heavier answer than the work
-- deserves. The sweep is ONE UPDATE of ONE column. It takes no input, reads
-- nothing back and returns a count. Sending that through an HTTP endpoint,
-- a shared secret, a scheduler that has to hold the secret, and a deploy step
-- somebody has to remember, is four things that can be wrong about a statement
-- that fits on a line.
--
-- Doing it in the database also removes the failure this part exists to fix: a
-- pg_cron job is applied with the rest of the schema by the person who applies
-- the schema, so it cannot be the half that gets forgotten. The edge function is
-- left in place — it is reachable, it is authenticated, and a gym that wants an
-- external scheduler can still use it. Both write exactly the same note, so
-- neither can undo the other and running both is harmless: the second one finds
-- nothing left to mark.
--
-- ── What a sweep writes, and what it refuses to write ────────────────────
--
-- A NOTE. Never `exited_at`. Stamping a plausible exit would quietly corrupt
-- every dwell figure computed afterwards, and a twenty-hour stay in the average
-- is not a rounding error — it is the reason the average exists. What the sweep
-- records is that somebody has accounted for the row: it is not a person
-- standing in the building.
--
-- ── Twelve hours, and hourly ────────────────────────────────────────────
--
-- Twelve is the same cutoff `sweepStaleVisits` and the edge function use, and it
-- must stay the same in all three: it is longer than the longest honest visit
-- and shorter than the gap between two visits by the same member, so a 6am
-- regular is never swept on the way to being back at 6am tomorrow.
--
-- Hourly rather than nightly because "nightly" is a time of day, and this
-- platform is white-label and multi-timezone: 3am in one gym is the middle of a
-- Saturday session in another. An hourly job has no opinion about whose night
-- it is. It is also cheap — after the first run of the hour there is nothing
-- left to match, which is what the note-as-guard below is for.
--
-- ── The note is also the guard ──────────────────────────────────────────
--
-- `note is distinct from` rather than `<>`. A plain `<>` is NULL for a row whose
-- note is null, the row is not matched, and null is the majority case and
-- exactly the set that most needs sweeping. Without the guard every run
-- re-marks every stale row the platform has ever accumulated and reports the
-- same growing number for ever.
--
-- Rows carrying a desk note are still swept and theirs is overwritten. That is
-- a real cost and the smaller one: a desk note on a visit nobody closed is worth
-- less than an accurate count of what is still open.
--
-- With ONE exception, in the where clause below: a note beginning
-- `admitted anyway: ` records that the gym let somebody in against its own
-- record, and why. That is the row an audit comes looking for, and it is worth
-- more than the count.
--
-- ── Scope ────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER with no parameters, and no parameters is the point. A
-- definer-shaped function that accepts a tenant id from its caller is the exact
-- bug 35-class-capacity-and-scope.sql was written to fix, and the safest version
-- of that argument is not to have the argument. Execute is revoked from every
-- signed-in role: nothing but the scheduler calls this, and an owner who wants
-- to sweep their own gym already has the Door button, which runs under their own
-- session and their own policies.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;

-- Must stay byte-identical to SWEEP_NOTE in src/lib/gymVisits.ts and to the
-- constant in supabase/functions/sweep-stale-visits. The console reads it back
-- to tell a visit nobody closed from one that has been accounted for, and two
-- spellings would make the same row look swept to one surface and unswept to
-- the other.
create or replace function sweep_stale_visits() returns integer
language plpgsql security definer set search_path = public as $$
declare
  marked integer;
begin
  update gym_visits
     set note = 'auto-closed: no exit recorded'
   where exited_at is null
     and entered_at < now() - interval '12 hours'
     and note is distinct from 'auto-closed: no exit recorded'
     -- The one desk note a sweep may not overwrite. A note beginning
     -- `admitted anyway: ` is the gym recording that it let somebody in
     -- against its own record, with the member of staff's reason on it (see
     -- part 490), and it is the row an audit comes looking for. Every other
     -- desk note is worth less than an accurate count of what is still open;
     -- this one is not. `isAccountedFor` in src/lib/gymVisits.ts is the console
     -- side of the same rule, so neither surface keeps offering to sweep a row
     -- the other will never take.
     and note not like 'admitted anyway: %';
  get diagnostics marked = row_count;
  return marked;
end $$;

revoke all on function sweep_stale_visits() from public;
revoke all on function sweep_stale_visits() from anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sweep-stale-visits') then
    perform cron.unschedule('sweep-stale-visits');
  end if;
end $$;

select cron.schedule(
  'sweep-stale-visits',
  '7 * * * *',
  $cron$ select public.sweep_stale_visits(); $cron$
);
