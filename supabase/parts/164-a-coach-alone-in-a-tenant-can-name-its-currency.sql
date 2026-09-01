-- ═══════════════════════════════════════════════════════════════════════════
-- A coach alone in a tenant can name its currency.
--
-- ── The measurement ───────────────────────────────────────────────────────
--
-- Counted live on 1 Sep 2026: 54 tenants, 35 with `currency` null. 34 of those
-- 35 hold no profile at all — orphan rows from `provision_profile()` — so the
-- number that matters is the three OCCUPIED tenants with no currency: one
-- owner's, one client's, and one COACH's.
--
-- One coach is not an emergency. What makes this worth a migration is that the
-- one is not a leftover, it is the steady state: `handle_new_user()` (part 07)
-- inserts a profile with no tenant_id, `provision_profile()` (part 06) then
-- creates `<Name>'s space` for it, and neither writes a currency — part 99
-- added the column with no default on purpose. Every coach who signs up from
-- today lands in a tenant with `currency = null`.
--
-- ── What that costs the coach, today ──────────────────────────────────────
--
-- `tenants.currency` is the only currency the coach app has. With it null:
--   · app/(trainer)/analytics.tsx withholds every money figure on the screen;
--   · app/(trainer)/invoices.tsx will not issue an invoice at all;
--   · app/(trainer)/payments.tsx cannot price a package — `createPackage` in
--     src/lib/connect.ts refuses to insert without an explicit currency, which
--     is correct and is also the coach's entire business;
--   · three more screens print a dash where a figure would be.
--
-- All six then say the same closing sentence: "an owner sets one in the gym
-- settings."
--
-- ── Why that sentence is a dead end for this coach ────────────────────────
--
-- Part 153 measured it already and the measurement has not changed:
-- `tenants_owner_rw` is `for all using (is_owner_of(id))` and is the ONLY write
-- policy on `tenants`; `is_owner_of(t)` requires `profiles.role = 'owner'`; a
-- coach's role is 'trainer'. So a coach's UPDATE against their own tenant row
-- matches zero rows — which PostgREST reports as a successful statement that
-- changed nothing, not as an error.
--
-- And there is no owner to ask. Every one of the seven coaches sits ALONE in a
-- personal tenant (part 153, measured: zero tenants hold more than one profile).
-- The screens are telling a coach to go and find a person who does not exist.
--
-- ── Why the sole occupant may decide, and nobody else ─────────────────────
--
-- This is the whole authorisation argument, and it is deliberately the same
-- derivation part 153 used rather than a new one: there is no column saying
-- whether a tenant is a gym or a personal workspace, and inventing one needs a
-- backfill judgement over 54 rows. What is true without inventing anything is
-- that a personal tenant has exactly one occupant and a gym has staff.
--
-- So: if you are the only profile in your tenant, the currency of that tenant
-- is a fact about you and about nobody else, and you may name it. The moment
-- somebody else is in there it is a gym, it has an owner, and the existing
-- policy decides — this function refuses and says so, rather than overruling an
-- owner from the coach app.
--
-- This grants a coach NOTHING else about their tenant. Not the name, not the
-- brand colour, not the session fee. Part 153 already settled that a coach's
-- branding belongs on `trainers`, not here; this is one column, chosen because
-- it is the one that blocks six screens and has no other route.
--
-- ── Why it will not overwrite a currency that is already set ──────────────
--
-- A currency is not a label on a figure, it is part of the figure. Change it
-- and every stored minor-unit amount denominated by it means something else —
-- `trainer_packages.price_cents` above all, which is what a client's card is
-- charged. Converting the stored prices would silently reprice packages people
-- are already paying for; not converting them reprices those packages more
-- loudly still. Neither is a thing a settings tap may do to somebody's
-- customers.
--
-- So this sets a currency and does not change one. `where currency is null` is
-- in the UPDATE and is also checked before it, so the caller gets 'already_set'
-- rather than a silent no-op. Correcting a currency set wrongly is a support
-- conversation with the rows in front of both people.
--
-- ── Shape ─────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER with a pinned search_path, revoked from public and anon by
-- name, granted to authenticated, with a `comment on function`. The house
-- pattern of parts 158 and 160. Definer is required rather than stylistic:
-- `tenants_owner_rw` would refuse the UPDATE and RLS on `profiles` is
-- `id = auth.uid()`, so an invoker could not count its own tenant's occupants
-- either — it would read one, conclude it is alone, and be wrong about every
-- gym.
--
-- Returns jsonb rather than boolean for the reason part 153 gives about
-- `my_coach_brand()`: five outcomes that a boolean collapses into one false
-- stay distinguishable at the client, and src/ui/loadStatus.ts exists in this
-- codebase because that collapse is how an app tells somebody a thing is absent
-- when it merely could not be done.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_my_tenant_currency(p_currency text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid       uuid := (select auth.uid());
  v_tenant    uuid;
  v_existing  text;
  v_peers     integer;
  v_code      text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  -- Upper-cased and trimmed here rather than trusted from the caller, because
  -- `tenants_currency_is_iso` refuses lower case and a coach typing 'gbp' into
  -- some future free-text field should get their currency set, not a constraint
  -- violation. The regex is that constraint restated: the check is what the
  -- column actually enforces, and this exists to turn a violation into a
  -- sentence rather than to be a second, softer rule.
  v_code := upper(btrim(coalesce(p_currency, '')));
  if v_code !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  select p.tenant_id into v_tenant from public.profiles p where p.id = v_uid;
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'reason', 'no_tenant');
  end if;

  -- Is this a room of one? Counted here because RLS on `profiles` is
  -- `id = auth.uid()`, so the app cannot ask: it would read one occupant at
  -- every gym in the product and conclude every coach is independent.
  --
  -- `<> v_uid` rather than `count(*) = 1`: a tenant holding zero profiles is
  -- not reachable from here (the caller's own profile is in it by definition of
  -- v_tenant), and counting peers says what the rule IS — somebody else is in
  -- my tenant — rather than encoding it as an arithmetic coincidence.
  select count(*) into v_peers
    from public.profiles peer
   where peer.tenant_id = v_tenant and peer.id <> v_uid;

  if v_peers > 0 then
    return jsonb_build_object('ok', false, 'reason', 'shared_tenant');
  end if;

  select t.currency into v_existing from public.tenants t where t.id = v_tenant;
  if v_existing is not null then
    -- Answered with the currency it already holds, so the app can say WHICH one
    -- rather than only that there is one. A coach told "already set" with no
    -- code has been given a reason to go looking on another screen.
    return jsonb_build_object('ok', false, 'reason', 'already_set', 'currency', v_existing);
  end if;

  -- `where currency is null` a second time, and it is not belt and braces. The
  -- read above and this write are not one statement; two taps a moment apart,
  -- or a gym owner setting theirs in the same second, would otherwise have the
  -- later one overwrite the earlier. The predicate makes the write itself the
  -- thing that decides, and a lost race lands on 'already_set' below rather
  -- than on a silent reprice.
  update public.tenants
     set currency = v_code
   where id = v_tenant and currency is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_set');
  end if;

  return jsonb_build_object('ok', true, 'currency', v_code);
end;
$function$;

comment on function public.set_my_tenant_currency(text) is
  'Lets the SOLE occupant of a tenant name its currency once, when none is set. Refuses a shared tenant (its owner decides, via tenants_owner_rw) and refuses to change a currency already set, because every stored price is denominated in it. See part 164.';

-- Revoked from `public` AND from `anon` by name. Postgres grants EXECUTE to
-- PUBLIC on every new function and `anon` resolves through that grant, so
-- naming only `anon` would leave it standing and naming only `public` would
-- leave anon's own grant standing. Both are named — this is how `log_gym_event`
-- became an unauthenticated cross-tenant write.
revoke all on function public.set_my_tenant_currency(text) from public;
revoke all on function public.set_my_tenant_currency(text) from anon;
grant execute on function public.set_my_tenant_currency(text) to authenticated;
