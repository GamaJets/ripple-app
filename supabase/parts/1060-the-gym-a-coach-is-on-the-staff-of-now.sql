-- ═══════════════════════════════════════════════════════════════════════════
-- The gym a coach is on the staff of now, and the column that still names the
-- one they left.
--
-- Part 941 found this and fixed exactly one caller. This is the sweep.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- `revoke_staff_role()` (part 711) takes a coach off a gym's staff by clearing
-- `profiles.tenant_id`, and it KEEPS the `trainers` row on purpose. Its own
-- comment gives the reason, and the reason is good: deleting the roster row
-- would set `clients.trainer_id` null underneath the history and strand every
-- per-coach figure that joins on it. A coach who left after delivering forty
-- sessions is not the same thing as a coach who never existed.
--
-- `trainers.tenant_id` is NOT NULL. So after a revocation the coach has two
-- answers to "which gym are you at": `profiles.tenant_id` says none, and
-- `trainers.tenant_id` goes on naming the gym they left, for ever.
--
-- Part 941 corrected `issue_coach_invoice()`, because the document a client
-- receives was being denominated in the old gym's currency. It fixed the
-- currency chain and stopped there. Nobody swept the rest, and the rest is
-- where the access decisions live.
--
-- ── WHAT THIS ONE WOULD LET SOMEBODY DO ──────────────────────────────────
--
-- `revoke_staff_role()` ends with a comment asserting that clearing the tenant
-- on the profile "is what actually removes the access", because "every staff
-- policy in this schema is `tenant_id = my_tenant()`". That is true for the
-- policies where the departed coach is the READER. It is not true for the
-- policies where the coach is the SUBJECT being read, and those are decided by
-- `trainers.tenant_id` — the column that did not change.
--
-- The consequence, in both directions:
--
--   · The owner of the gym a coach has LEFT keeps reading that coach's
--     sessions, client roster, purchases, subscription payments, Stripe
--     Connect account and exercise videos — including the ones created
--     afterwards, at a different gym, for people the first gym has never met.
--     On `exercise_videos` the policy is FOR ALL, so it is not only a read:
--     the old gym's owner can still delete them.
--
--   · Pointed the other way, `tenants_trainer_r` lets the DEPARTED COACH go on
--     reading the `tenants` row of the gym they left — its brand, its currency,
--     its settings — because that policy also matches on `trainers.tenant_id`.
--
-- Neither of those is a thing anybody decided. They are both the same column
-- being asked a question it stopped being able to answer at the moment of
-- revocation.
--
-- ── WHY A HELPER AND NOT A BACKFILL ──────────────────────────────────────
--
-- The obvious repair — clear `trainers.tenant_id` on revocation — is the one
-- part 711 already refused, for reasons that have not changed. The column is
-- NOT NULL and it is load-bearing for history. So the column stays exactly as
-- it is and the QUESTION moves: `staff_tenant_of()` reads the live answer off
-- `profiles`, which is the column `revoke_staff_role()` actually writes and the
-- column every screen in the coach app already reads.
--
-- `tenant_of_user()` is corrected rather than replaced. It already consulted
-- both tables — it simply asked them in the wrong order, putting the historical
-- column first and only falling through to the live one when the roster row was
-- missing. Reversing the coalesce is the whole change, and it is the same
-- correction part 941 made to the currency chain, made in the same direction
-- for the same reason. That single reversal fixes `coach_clients_owner_r` and
-- `app_errors_owner` without either policy being touched.
--
-- The two fill triggers are the WRITE half of the same defect: they stamp a
-- brand-new session or class with `trainers.tenant_id`, so a departed coach's
-- future work was being filed under the old gym as it was created. Repointing
-- them stops the drift being manufactured; part 1061 repoints the policies that
-- read it.
--
-- ── WHAT THIS CHANGES FOR ANYBODY USING THE PRODUCT TODAY ────────────────
--
-- Nothing. Verified against the live catalogue on 3 Sep 2026: of 8 `trainers`
-- rows, 8 carry a tenant, 0 disagree with the tenant on their profile, and 0
-- have a tenant while their profile has none. There is no drifted row for this
-- to move. For every coach who is currently on a gym's staff the two columns
-- agree, so every expression below returns precisely what it returned before.
-- This closes the path rather than repairing damage down it — which is the
-- cheapest moment to do it, and the only one where the diff is provably inert.
--
-- Idempotent and safe to re-run: `create or replace function` replaces a
-- definition in place, the grants are stated absolutely rather than added to,
-- and the two trigger functions are replaced without dropping the triggers that
-- point at them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The live answer ──────────────────────────────────────────────────────
--
-- Deliberately NOT a coalesce onto `trainers`. The whole point is that this
-- function has one source, and it is the one `revoke_staff_role()` writes. An
-- independent coach and a departed coach both correctly get null here, and
-- `is_owner_of(null)` is false, which is the answer both cases want.

create or replace function public.staff_tenant_of(u uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.tenant_id from public.profiles p where p.id = u;
$$;

comment on function public.staff_tenant_of(uuid) is
  'The gym this person is on the staff of NOW, from profiles.tenant_id — the '
  'column revoke_staff_role() clears. Never trainers.tenant_id, which is a '
  'historical roster fact and goes on naming a gym the coach has left. See '
  'part 1060.';

-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` resolves
-- through that grant. Stated absolutely so a re-run cannot widen it.
revoke all on function public.staff_tenant_of(uuid) from public;
revoke all on function public.staff_tenant_of(uuid) from anon;
grant execute on function public.staff_tenant_of(uuid) to authenticated;
grant execute on function public.staff_tenant_of(uuid) to service_role;

-- ── The order reversed ───────────────────────────────────────────────────
--
-- Was: coalesce(trainers.tenant_id, profiles.tenant_id) — the historical column
-- first, so it always won whenever a roster row existed, which is always.
-- Now:  coalesce(profiles.tenant_id, trainers.tenant_id) — the live column
-- first, falling back to the roster row only for a subject who has no profile
-- tenant AND is on a roster, which is the case this function was reaching for
-- in the first place.
--
-- Signature, volatility, security and search_path are character-for-character
-- the live ones. `coach_clients_owner_r` and `app_errors_owner` are both
-- defined in terms of this function and are corrected by this line alone.

create or replace function public.tenant_of_user(u uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select p.tenant_id from profiles p where p.id = u),
    (select t.tenant_id from trainers t where t.id = u)
  );
$$;

-- ── The write half ───────────────────────────────────────────────────────
--
-- Both of these stamp a tenant onto a row at creation and only when the caller
-- left it null, so the `if` is preserved exactly: a row that names its own gym
-- keeps naming it. The only change is which table is asked. A session created
-- by a coach who has left every gym now gets a null tenant, which is what an
-- unaffiliated coach's session should carry — and `sessions_gym_owner_r` is
-- already written `tenant_id is not null and is_owner_of(tenant_id)`, so a null
-- there fails closed rather than opening anything.

create or replace function public.sessions_fill_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.tenant_id is null then
    select p.tenant_id into new.tenant_id from public.profiles p where p.id = new.trainer_id;
  end if;
  return new;
end $$;

create or replace function public.gym_classes_fill_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.tenant_id is null and new.trainer_id is not null then
    select p.tenant_id into new.tenant_id from public.profiles p where p.id = new.trainer_id;
  end if;
  return new;
end $$;
