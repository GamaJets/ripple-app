-- ═══════════════════════════════════════════════════════════════════════════
-- A coach with no gym had no currency at all, and no way to name one.
--
-- ── The hole ──────────────────────────────────────────────────────────────
--
-- `tenants.currency` (part 99) is the ONLY currency the coach app has ever
-- had. Part 164 gave the sole occupant of a tenant a way to set it, which
-- covers every coach who signed up and landed in the personal tenant
-- `provision_profile()` makes for them. It covers nobody whose
-- `profiles.tenant_id` is NULL, because it has nothing to write to:
-- `set_my_tenant_currency()` answers 'no_tenant' and stops.
--
-- Everything downstream then withholds, correctly and permanently:
--
--   · `myTenantCurrency()` (src/lib/subscriptions.ts) resolves
--     `profiles.tenant_id`, finds none, and returns `{ currency: null,
--     error: null }` — "no gym is not a failure, and it is not a currency
--     either". True, and there was no second place to look.
--   · app/(trainer)/settings.tsx draws no picker at all in that state. It
--     says "This account is not attached to a gym, so there is nothing here
--     to price", which is a dead end rather than an instruction.
--   · `createPackage` refuses to insert without an explicit currency, so Add
--     Package is disabled — and the sentence beside it asks a gym owner who
--     does not exist to go and fix a setting.
--   · every session that coach delivers is filed with `rate_cents` null,
--     because `minorFromWhole(fee, null)` is null and must be.
--
-- ── It is reachable, and the product itself produces it ───────────────────
--
-- `revoke_staff_role()` (part 711) is the coach who has gone independent:
--
--     update public.profiles set tenant_id = null where id = p_subject;
--
-- and — deliberately, and correctly — it KEEPS the `trainers` row, because
-- deleting it would strand every per-coach figure that joins on it. So a coach
-- taken off a gym's staff lands in exactly this state: no tenant on the
-- profile, a roster row still pointing at the gym they left, and no currency.
--
-- Worse than nothing, that stranded roster row is already ANSWERING. It is
-- what `trainers.tenant_id` means to `fetchInvoiceCurrency` in
-- src/ui/coachInvoices.ts and to `issue_coach_invoice()` in part 138: both
-- read `trainers → tenants.currency`, so an independent coach's invoices are
-- still being denominated in the currency of a gym they have left, while every
-- other screen in the app shows them a dash. Two answers, disagreeing, today.
-- Part 941 is the other half of this change and settles that.
--
-- ── Measured, so nobody reads more into this than is there ────────────────
--
-- Counted live on 3 Sep 2026: 20 profiles, 7 coaches, 8 `trainers` rows, 54
-- tenants, 35 of them with `currency` null. ZERO coaches currently have
-- `profiles.tenant_id` null, and every one of the 7 sits alone in a personal
-- tenant, so part 164's route works for all of them today and one of them has
-- a currency to set through it.
--
-- This part is therefore closing a hole rather than emptying a queue. The hole
-- is the one above: the moment a gym uses the staff screen the product already
-- ships, the coach on the other end of it cannot price anything, and nothing
-- in the app would say why.
--
-- ── WHERE IT LIVES, AND WHY `trainers` ───────────────────────────────────
--
-- `trainers.currency`. The alternatives and why they lose:
--
--   · `profiles.currency` — `profiles` is the account, and it is shared by
--     owners, members and receptionists, none of whom price anything. A
--     column three of the four roles must never read is a column somebody
--     eventually reads.
--   · a new `coach_settings` table — one nullable column does not earn a
--     table, an RLS policy and a grant list, and part 153 already refused the
--     same widening for a coach's branding: the coach's own row is the
--     carrier.
--   · widening `tenants` so a coach can own one — that invents a tenant for a
--     person who has just been taken out of one, and part 164's whole
--     authorisation argument (a personal tenant has one occupant, a gym has
--     staff) stops being derivable the moment tenants are minted for people
--     who left.
--
-- `trainers` is where `session_fee`, `late_cancel_fee`, `brand_color` and
-- `delivery_mode` already live. It is the row that survives leaving a gym, by
-- part 711's own decision, which is precisely the row this fact has to survive
-- on. It is the coach's own record of how they trade.
--
-- ── PRECEDENCE, STATED ONCE ──────────────────────────────────────────────
--
--     The gym on `profiles.tenant_id` is the authority on the currency.
--     `trainers.currency` applies IF AND ONLY IF `profiles.tenant_id` is null.
--
-- Not "if the gym has not set one". A coach in a gym whose owner has not set a
-- currency is a coach waiting on their owner, and letting them name their own
-- instead would put a second, disagreeing answer on the same screens the owner
-- is about to fill in — and would price this coach's packages differently from
-- the coach standing next to them.
--
-- The rule is keyed on `profiles.tenant_id` and on nothing else, because that
-- is the column the reads already use — `myTenantCurrency()` and the tenant
-- provider both resolve it — and a precedence rule keyed on a different fact
-- from the read it governs is two rules. `trainers.tenant_id` is emphatically
-- NOT that fact: part 711 leaves it pointing at a gym the coach has left.
--
-- A coach who sets their own currency and later joins a gym keeps the column;
-- the gym's answer simply outranks it from that moment. It is not cleared,
-- because clearing it is a reprice of everything they sold while independent,
-- and because they may leave again.
--
-- ── SET ONCE, NEVER A SILENT REPRICE ─────────────────────────────────────
--
-- Identical to part 164's rule and for identical reasons, restated because
-- this is a second column that can be got wrong the same way. A currency is
-- not a label on a figure, it is part of the figure. A coach who has priced
-- packages in GBP and then flips to JPY has repriced their entire catalogue by
-- a factor of a hundred — `trainer_packages.price_cents` is what a card is
-- charged — and converting the stored amounts would reprice them quietly while
-- not converting them reprices them loudly. Neither is a thing a settings tap
-- may do to somebody's customers.
--
-- So `where currency is null` is checked BEFORE the update and is also IN the
-- update, so two taps a moment apart land on 'already_set' rather than on a
-- silent overwrite. Correcting a currency set wrongly is a support
-- conversation with the rows in front of both people.
--
-- ── NO DEFAULT, EVER ─────────────────────────────────────────────────────
--
-- Nullable, no default, no backfill. Part 99 made that decision for
-- `tenants.currency`, part 150 dropped seven `default 'AED'`s that had been
-- quietly answering for gyms that never chose, and `coachMoney.ts` returns
-- null rather than a figure for a currency nobody stated. An unset currency
-- stays unset and every amount stays withheld. There is no value here that is
-- not simply wrong for half the people running this app.
--
-- ── The grant is a SELECT and not an UPDATE, on purpose ───────────────────
--
-- `trainers` grants nothing at table level (measured in part 153:
-- `authenticated=dm/postgres`, with every readable column granted by name), so
-- a new column is invisible AND unwritable until it is named. This names it
-- for SELECT only.
--
-- `trainers_self_rw` is `for all using (auth.uid() = id)`, so an UPDATE grant
-- on this column would let a coach write it directly with the anon key —
-- past the set-once rule, past the "only when you have no gym" rule, and past
-- the ISO check being turned into a sentence rather than a constraint
-- violation. Every one of those is the reason the write is an RPC. The column
-- is readable by the coach and writable only through `set_my_coach_currency`.
--
-- Idempotent; additive; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.trainers add column if not exists currency text;

alter table public.trainers drop constraint if exists trainers_currency_is_iso;
alter table public.trainers add constraint trainers_currency_is_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');

comment on column public.trainers.currency is
  'What this coach charges in when they have no gym — ISO 4217, uppercase. Read ONLY when profiles.tenant_id is null; a coach in a gym is priced in tenants.currency and this column is dormant. NULL means they have not chosen, never a value to default: render a dash and ask. Set once, through set_my_coach_currency(), because every stored price is denominated in it.';

-- SELECT only. See the header: the write is an RPC because three rules sit on
-- it that a column grant cannot express.
grant select (currency) on public.trainers to authenticated;


-- ── the one write ─────────────────────────────────────────────────────────
--
-- The sibling of `set_my_tenant_currency()` (part 164) and deliberately the
-- same shape: SECURITY DEFINER with a pinned search_path, revoked from
-- `public` AND `anon` by name, granted to `authenticated`, answering with
-- jsonb so the five outcomes a boolean would collapse into one `false` stay
-- distinguishable at the client.
--
-- Definer is required rather than stylistic. RLS on `profiles` is
-- `id = auth.uid()`, which is enough to read one's own tenant_id — but the
-- refusals below have to be decided by the same statement that writes, not by
-- the app, or the rule is advisory.
create or replace function public.set_my_coach_currency(p_currency text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid       uuid := (select auth.uid());
  v_has_prof  boolean;
  v_tenant    uuid;
  v_has_row   boolean;
  v_existing  text;
  v_code      text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  -- Upper-cased and trimmed here rather than trusted from the caller, so a
  -- 'gbp' arriving from some future free-text field sets a currency instead of
  -- raising a constraint violation. The regex is `trainers_currency_is_iso`
  -- restated; it exists to turn a violation into a sentence, not to be a
  -- second, softer rule.
  v_code := upper(btrim(coalesce(p_currency, '')));
  if v_code !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  select true, p.tenant_id into v_has_prof, v_tenant
    from public.profiles p where p.id = v_uid;

  -- An account with no profile row is not a coach with no gym. Answered apart
  -- so it cannot be read as "you are independent, choose a currency" — there
  -- is no record here to hang one on.
  if v_has_prof is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  -- THE PRECEDENCE RULE, enforced by the write rather than by the screen. A
  -- coach in a gym is priced by that gym: `tenants.currency`, set by its owner
  -- or — when they are the only person in it — through
  -- set_my_tenant_currency() from part 164. Writing this column for them would
  -- be a second answer that can disagree with the one their clients are
  -- charged in.
  if v_tenant is not null then
    return jsonb_build_object('ok', false, 'reason', 'has_tenant');
  end if;

  select true, tr.currency into v_has_row, v_existing
    from public.trainers tr where tr.id = v_uid;

  -- Nowhere to put it. `trainers` is the coach's own record and part 711 keeps
  -- it when somebody leaves a gym, so this is rare — but "there is no coach
  -- record for this account" is a different sentence from "you have not chosen
  -- yet", and an app told the second would draw a picker that writes nothing.
  if v_has_row is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_coach_row');
  end if;

  if v_existing is not null then
    -- Answered WITH the code it already holds, so the app can say which one.
    -- "Already set" with no code sends a coach looking on another screen.
    return jsonb_build_object('ok', false, 'reason', 'already_set', 'currency', v_existing);
  end if;

  -- `where currency is null` a second time, and it is not belt and braces: the
  -- read above and this write are not one statement, so two taps a moment
  -- apart would otherwise have the later one overwrite the earlier. The
  -- predicate makes the write itself decide, and a lost race lands on
  -- 'already_set' below rather than on a silent reprice.
  update public.trainers
     set currency = v_code
   where id = v_uid and currency is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_set');
  end if;

  return jsonb_build_object('ok', true, 'currency', v_code);
end;
$function$;

comment on function public.set_my_coach_currency(text) is
  'Lets a coach with NO gym (profiles.tenant_id is null) name the currency they charge in, once, when none is set. Refuses a coach who is in a gym — that gym''s tenants.currency is the authority — and refuses to change one already set, because every stored price is denominated in it. See part 940.';

-- Revoked from `public` AND from `anon` by name. Postgres grants EXECUTE to
-- PUBLIC on every new function and `anon` resolves through that grant, so
-- naming only one of them leaves the other standing. This is how
-- `log_gym_event` became an unauthenticated cross-tenant write.
revoke all on function public.set_my_coach_currency(text) from public;
revoke all on function public.set_my_coach_currency(text) from anon;
grant execute on function public.set_my_coach_currency(text) to authenticated;


-- ── how many are in the state this part exists for ───────────────────────
--
-- A number that should be readable rather than discovered, the same way part
-- 710 returns `tenants_without_a_timezone()`. A coach in here has no gym and
-- has not named a currency, so every figure in their app is withheld and
-- nothing they sell can be priced.
create or replace function public.coaches_without_a_currency()
returns integer
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select count(*)::int
    from public.trainers tr
    join public.profiles p on p.id = tr.id
   where p.tenant_id is null and tr.currency is null;
$fn$;

comment on function public.coaches_without_a_currency() is
  'How many coaches have no gym AND no currency of their own, and therefore cannot price a package, issue an invoice or have a session filed at a rate. Should be falling.';

revoke all on function public.coaches_without_a_currency() from public, anon;
grant execute on function public.coaches_without_a_currency() to authenticated;
