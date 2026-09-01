-- ═════════════════════════════════════════════════════════════════════════
-- "120 / session", and no currency anywhere on the screen.
--
-- ── What was here, and why it was already the right behaviour ────────────
--
-- app/(client)/trainers.tsx prints `trainers.session_fee` bare. A '$' used to
-- stand in front of it and was removed on purpose, and the comment where it
-- stood is the whole argument: Repple is white-labelled, `trainers` has no
-- currency column, and a client browsing a directory of coaches priced in
-- dirhams was reading every one of them in dollars. Not a formatting slip — a
-- different amount, on the figure somebody picks a coach by.
--
-- So the number without a symbol is honest. THE GAP IS THE MISSING COLUMN, not
-- the missing symbol, and this part closes it.
--
-- ── Why there is no new column ───────────────────────────────────────────
--
-- A session fee is denominated in the gym's currency and always has been. Part
-- 126 states it while pricing the late-cancellation fee: the policy is the
-- coach's, "the gym still owns the CURRENCY (`tenants.currency`, part 99)
-- because that is what the money is denominated in, and a coach does not get to
-- pick that per policy." Part 164 gives the coach who sits alone in their own
-- tenant a way to name it once. `charges.currency` snapshots it at the moment
-- money is raised, which is right for a charge and wrong for a price list: a
-- rate is what the coach charges TODAY, so re-reading it today is correct.
--
-- Adding `trainers.session_fee_currency` would therefore be a SECOND copy of a
-- fact that already exists, kept in step by a trigger or by an app remembering
-- to write both. Two copies of a permission drift and the copy that drifts
-- wider is the one nobody notices (part 124's own words); two copies of a
-- CURRENCY drift and the one that drifts is on a price.
--
-- What the client actually lacked was the READ. `tenants` has no policy that
-- lets a member read another tenant's row — correctly — so the directory could
-- not find out what any listed coach's figure was denominated in.
--
-- ── Why a function and not a policy ──────────────────────────────────────
--
-- Because RLS selects ROWS, not columns. Any policy on `tenants` wide enough to
-- show a stranger the currency would hand over the whole row: the gym's name,
-- its brand colour, its plan, its session fee, its retention period. Part 131
-- is the worked example of exactly that mistake one table over — `join_code`
-- was readable by every signed-in account because the policy that exposed the
-- directory could not stop at one column.
--
-- So this returns TWO columns for the trainers it is asked about, and only for
-- trainers who have opted into the public directory. It is the same shape and
-- the same reasoning as `my_coach()` (parts 67 and 115).
-- ═════════════════════════════════════════════════════════════════════════

-- One row per id asked about that belongs to a LISTED trainer. `currency` is
-- null when that trainer's gym has not set one, and the row is still returned —
-- which is the entire point of the shape.
--
-- "No row came back" and "a row came back with no currency" are two different
-- facts and the app prints two different sentences for them
-- (src/lib/currencyGap.ts): one is a read that has not answered, the other is a
-- gym that has never stated a currency. Filtering the nulls away here would
-- collapse them, and the collapsed version is the sentence that sends a client
-- to chase a coach over a setting that was already correct.
--
-- LEFT JOIN, so a trainer with no tenant at all is also reported honestly
-- rather than dropped.
create or replace function public.listed_trainer_currencies(p_ids uuid[])
returns table (trainer_id uuid, currency text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select t.id, tn.currency
    from public.trainers t
    left join public.tenants tn on tn.id = t.tenant_id
   where t.listed = true
     and t.id = any(coalesce(p_ids, array[]::uuid[]));
$function$;

comment on function public.listed_trainer_currencies(uuid[]) is
  'ISO 4217 for each LISTED trainer asked about, so a client can read what '
  'trainers.session_fee is denominated in. Two columns only: RLS selects rows, '
  'not columns, and a policy on tenants wide enough for this would hand over the '
  'whole gym row (part 131). NULL currency means the gym has not set one, and '
  'the row is still returned. See supabase/parts/242.';

-- `revoke ... from public` alone leaves BOTH API roles standing — Supabase
-- grants execute to anon and authenticated separately, which is how part 105
-- shipped an unauthenticated cross-tenant write (part 120). The directory is
-- for signed-in members, and `trainers_public_directory_r` is already `to
-- authenticated`, so anon gets nothing here either.
revoke all on function public.listed_trainer_currencies(uuid[]) from public, anon;
grant execute on function public.listed_trainer_currencies(uuid[]) to authenticated;
