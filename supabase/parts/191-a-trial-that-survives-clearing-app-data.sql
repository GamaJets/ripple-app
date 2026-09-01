-- ═══════════════════════════════════════════════════════════════════════════
-- The trial lived in AsyncStorage, so clearing app data reset it.
--
-- `src/lib/trial.ts` is fourteen days from first launch, kept under one key on
-- the device. Delete the app and reinstall it, clear its storage, or sign in on
-- a second phone, and the trial starts again from zero. There is no
-- account-level expiry anywhere in this product.
--
-- Nothing is being lost by it today, because nothing is gated: the file's own
-- header says "non-blocking… real gating switches on once Stripe price ids
-- exist", and no EXPO_PUBLIC_STRIPE_PRICE_* is set in any eas.json profile. It
-- is a straightforward revenue leak on the day billing is switched on, and the
-- fix has to be in place BEFORE that day rather than after it — a gate added
-- later cannot tell a coach who has had six months of free trial from one who
-- installed yesterday, because the device is the only thing that ever knew.
--
-- ── One column, and why it is not a "trial ends" column ──────────────────
--
-- `trial_started_at`, not `trial_ends_at`. The length of the trial is a
-- PRODUCT DECISION that lives in one constant in the app (`TRIAL_DAYS`), and
-- storing an end date would freeze whatever that constant said on the day each
-- coach signed up — so changing fourteen days to twenty-one would apply to
-- nobody already on one, and the two would be indistinguishable afterwards. A
-- start date plus a constant is one fact and one rule; an end date is the
-- answer with the rule baked in and lost.
--
-- ── Why it is immutable, and why that needs a trigger ────────────────────
--
-- `trainers_self_rw` (part 23) is `for all using (auth.uid() = id)`, so a coach
-- can UPDATE their own row — which is right for their bio, their rate and their
-- late-cancellation policy, and would be exactly wrong for this. A coach who
-- can write `trial_started_at` has the same reset they had in AsyncStorage,
-- through a different door and with fewer steps.
--
-- Narrowing the policy is not the fix: it would take the coach's own profile
-- writes down with it. A BEFORE UPDATE trigger that refuses to move this one
-- column leaves everything else exactly as it was, and refuses the write with a
-- message rather than silently dropping it — a silent no-op is how somebody
-- spends an afternoon wondering why a value will not save.
--
-- The backfill is `created_at` where the row has one and `now()` where it does
-- not. Generous by construction: an existing coach whose row predates any
-- created_at gets a fresh fourteen days rather than an expired trial they never
-- knew they were on. Expiring somebody retroactively, on a trial they were
-- never told about, is the version of this that loses a customer.
--
-- ── What this part does NOT do ───────────────────────────────────────────
--
-- It does not gate anything. No policy consults it, no function refuses because
-- of it, and no read anywhere is narrowed by it. It records the one fact that
-- cannot be recovered later, which is when the trial began; what to do about an
-- expired one is a product decision that belongs with the pricing it enforces,
-- and building the enforcement before the prices exist would mean shipping a
-- lock with nothing behind it for a coach to buy.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.trainers add column if not exists trial_started_at timestamptz;

comment on column public.trainers.trial_started_at is
  'When this coach''s free trial began, on the ACCOUNT rather than on a device. Set once and immutable — see the trigger below. The trial''s LENGTH is a product constant in the app (TRIAL_DAYS), deliberately not stored here, so changing it applies to everybody rather than to nobody already on one.';

do $$
begin
  -- `created_at` is not guaranteed to exist on every deployment of this table,
  -- and a migration that assumes a column it did not create is a migration that
  -- fails on the one environment nobody tested it on.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trainers' and column_name = 'created_at'
  ) then
    execute 'update public.trainers set trial_started_at = coalesce(created_at, now()) where trial_started_at is null';
  else
    execute 'update public.trainers set trial_started_at = now() where trial_started_at is null';
  end if;
end $$;

-- Every trainer row created from here on starts a trial the moment the row
-- exists, so there is no window in which an account has no start date and the
-- app has to invent one.
alter table public.trainers alter column trial_started_at set default now();

-- ── Immutable once set ───────────────────────────────────────────────────
--
-- Refuses the write with a message rather than silently dropping it. A silent
-- no-op is how somebody spends an afternoon wondering why a value will not
-- save; a raise is how they find this comment.
create or replace function public.trainers_trial_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.trial_started_at is not null
     and new.trial_started_at is distinct from old.trial_started_at then
    raise exception 'a trial start date cannot be changed';
  end if;
  return new;
end $$;

revoke all on function public.trainers_trial_guard() from public, anon, authenticated;

drop trigger if exists trainers_trial_immutable on public.trainers;
create trigger trainers_trial_immutable
  before update on public.trainers
  for each row execute function public.trainers_trial_guard();
