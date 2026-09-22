-- ── Three tables where only RLS stood between a coach's book and everybody ──
--
-- `coach_credential_notices` (part 202), `coach_overdue_notices` (part 202) and
-- `coach_invoice_ageing_notices` (part 613) are deduplication ledgers. The
-- nightly jobs write a row to say "this coach has already been told about this
-- one", so the next pass does not tell them again. Nothing in the three apps or
-- the console reads them — verified by grep across `src/`, `app/`,
-- `studio-web/` and `supabase/functions/`, which returns nothing at all.
--
-- All three have RLS enabled and **no policy**, which is the right posture for
-- a table only the service role uses: RLS with no policy denies everybody, so
-- the tables are already unreadable.
--
-- What they also have is a live `grant select ... to authenticated`, inherited
-- from whatever the default was when they were created. That grant reaches
-- nothing today. It reaches everything the moment anybody adds a permissive
-- policy to one of these tables for an unrelated reason — a debugging aid, a
-- screen somebody builds later, a copy-paste from a neighbouring part.
--
-- ── Why this is worth a part of its own ───────────────────────────────────
--
-- Part 401 already argues the doctrine for `instagram_accounts`: a table the
-- app must never read has its grants revoked, and does not merely rely on the
-- absence of a policy. `share_card_objects` follows the same rule. These three
-- are the ones that were missed, and they are not empty of anything sensitive:
--
--   coach_overdue_notices          which of a coach's clients have stopped
--                                  turning up, and when they were chased
--   coach_invoice_ageing_notices   which invoices a coach is owed on, and how
--                                  long they have been outstanding
--   coach_credential_notices       when a coach's insurance or qualification
--                                  is expiring
--
-- That is a coach's arrears, their attrition and their lapsed paperwork —
-- exactly the three things a competitor, or a gym owner they are negotiating
-- with, would most like to read. RLS is the fence; the grant should not be
-- sitting behind it waiting for the fence to move.
--
-- Nothing changes for the jobs: they run as the service role, which is granted
-- explicitly below rather than by inheritance, so the grant that makes them
-- work is now written down instead of assumed.
--
-- Additive and idempotent. No behaviour changes anywhere, by design — if
-- anything in the product breaks after this, that thing was reading a table it
-- was never entitled to and the breakage is the point.

do $$
declare t text;
begin
  foreach t in array array[
    'coach_credential_notices',
    'coach_overdue_notices',
    'coach_invoice_ageing_notices'
  ] loop
    -- Skipped rather than raised: parts 202 and 613 are both already applied
    -- everywhere this runs, but a part that refuses to apply against a database
    -- missing a table it only tightens is a part that blocks a deploy for no
    -- gain.
    if to_regclass('public.' || t) is null then
      raise notice 'public.% is not here — nothing to tighten', t;
      continue;
    end if;

    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    -- Belt and braces. All three already have it; a table that gained one of
    -- these grants back would otherwise be readable with RLS off entirely.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

comment on table public.coach_overdue_notices is
  'Which clients a coach has already been told have stopped turning up, so the nightly pass does not tell them twice. Service role only — no policy and no grant, deliberately, per part 401''s rule that a table the app must never read is revoked rather than left to RLS alone. Nothing in the apps or the console reads this.';
comment on table public.coach_invoice_ageing_notices is
  'Which overdue invoices a coach has already been chased about. Service role only — see the header of part 820 for why the authenticated grant was removed rather than left behind the policy.';
comment on table public.coach_credential_notices is
  'Which expiring credentials a coach has already been warned about. Service role only, for the same reason as its two neighbours.';
