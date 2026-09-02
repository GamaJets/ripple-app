-- ═══════════════════════════════════════════════════════════════════════════
-- A gym that can take a payment.
--
-- ── What was missing, stated plainly ──────────────────────────────────────
--
-- `connect_accounts` (part 21) is keyed `trainer_id uuid primary key references
-- profiles(id)`. It is a COACH's payout account and nothing else. There has
-- never been a row anywhere in this schema representing the GYM's own Stripe
-- account, which is why the only purchasable thing in the client app is a
-- coach's own package: a membership, a drop-in and a class pack are all sold by
-- the gym, and the gym had no ledger to sell them on.
--
-- Putting the gym's sales on a coach's account is not a shortcut, it is a
-- different company taking the money. `src/lib/directCharges.ts` is written
-- around the rule that the account a sale lands on is a property OF THE SALE
-- and is read from the object's own column; the same rule applied to the
-- merchant means a gym membership must land on the gym's account, on purpose,
-- recorded at the moment it happens. So the gym gets its own row.
--
-- ── One arrangement, and no `charge_model` column ─────────────────────────
--
-- `connect_accounts` carries `charge_model` because it has to: every coach
-- onboarded before part 161 is on an Express account taking DESTINATION
-- charges, Stripe fixes an account's type at creation and will not change it,
-- and those coaches must keep selling exactly as they do. That is a legacy this
-- table does not have. There is no gym selling anything today — there is no
-- table for one to sell from — so every row here will be created after the
-- decision in part 161 was already made.
--
-- Stripe's account-type table gives Standard accounts "Direct only" for
-- supported charge types and puts fraud and dispute liability on the connected
-- account for direct charges. That is the arrangement the owner chose. So a gym
-- sells on a STANDARD account taking DIRECT charges, or it does not sell, and a
-- column offering a second answer would be a switch with one safe setting and
-- one that quietly leaves Repple carrying a gym's chargebacks.
--
-- The gate is therefore `canTakeDirectCharges` in src/lib/directCharges.ts,
-- unchanged and shared: an account id, `account_type = 'standard'`, card
-- payments not explicitly inactive, and `charges_enabled`. Its four columns are
-- the four this table records, deliberately spelled the same way so the same
-- function reads both tables.
--
-- ── What a member is allowed to know about it ─────────────────────────────
--
-- A member must be told "this gym cannot take payments yet" as a first-class
-- state — a screen that renders a Buy button over an account that cannot charge
-- sends somebody to a Stripe page that refuses them. But a member has no
-- business reading the gym's Stripe account id, its payout state or who Stripe
-- holds for its losses.
--
-- RLS is row-level, not column-level, so a SELECT policy scoped to
-- `tenant_id = my_tenant()` would hand a member the whole row. Instead there is
-- a SECURITY DEFINER function returning exactly the four facts the gate needs,
-- with the account id reduced to "there is one". `conn_read` on
-- `connect_accounts` keeps the coach table owner-and-trainer only for the same
-- reason; this is that rule for the gym.
--
-- Idempotent. Additive only — nothing here alters an existing table.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists gym_connect_accounts (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  -- Stripe's `acct_...`. Null means onboarding has been started and Stripe has
  -- not yet given us one, or nobody has started it. Either way the gym cannot
  -- sell, and `canTakeDirectCharges` refuses on exactly that.
  stripe_account_id text unique,
  -- Stripe's own aggregate answer to "can this account take a card". Written by
  -- the `account.updated` webhook, the same way the coach table's is.
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  -- Stripe's `Account.type`. NOT backfilled and NOT defaulted, for the reason
  -- part 161 gives at length: null means "nobody has asked Stripe what this
  -- account is", which is a different fact from "Stripe told us Express", and
  -- only one of the two is safe to create a direct charge on. Null is refused.
  account_type text,
  -- The `card_payments` capability. Stripe requires it ACTIVE for direct
  -- charges; an account halfway through onboarding has it merely REQUESTED.
  -- Null means not recorded yet and falls back to `charges_enabled`; a value
  -- that is present and not 'active' is a refusal.
  card_payments_status text,
  transfers_status text,
  payouts_enabled boolean,
  -- `controller.losses.payments` as Stripe reports it: who carries an
  -- unrecoverable negative balance. Recorded because it cannot be worked out
  -- later from anything else, and because it is the answer to the question the
  -- whole Standard-account decision exists for.
  losses_owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table gym_connect_accounts drop constraint if exists gym_connect_accounts_account_type_ck;
alter table gym_connect_accounts add constraint gym_connect_accounts_account_type_ck
  check (account_type is null or account_type in ('standard', 'express', 'custom', 'none'));

alter table gym_connect_accounts drop constraint if exists gym_connect_accounts_losses_owner_ck;
alter table gym_connect_accounts add constraint gym_connect_accounts_losses_owner_ck
  check (losses_owner is null or losses_owner in ('application', 'stripe'));

-- The webhook resolves a connected-account event back to a gym through this.
-- Under direct charges the account id is frequently the strongest identity left
-- on an event, exactly as part 161 records for coaches.
create index if not exists idx_gym_connect_accounts_stripe_id
  on gym_connect_accounts (stripe_account_id) where stripe_account_id is not null;

-- ── row-level security ──────────────────────────────────────────────────────
alter table gym_connect_accounts enable row level security;

-- The gym's own owner, and nobody else. Written by the edge functions through
-- the service role, which RLS does not apply to.
drop policy if exists gym_connect_owner on gym_connect_accounts;
create policy gym_connect_owner on gym_connect_accounts
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- ── what a member may ask ───────────────────────────────────────────────────
--
-- Four facts and no identifiers. `has_account` rather than the id itself,
-- because the app's only question is whether there is one — src/lib/gymPay.ts
-- turns these four into the same answer `canTakeDirectCharges` gives, and a
-- test asserts the two agree on every shape.
--
-- ZERO ROWS is a real and common answer: this gym has never started onboarding.
-- The app reads that as "cannot take payments yet" and says so, which is
-- different again from a read that failed — and that difference is the point of
-- returning rows rather than a bare boolean that would be false for both.
--
-- STABLE and SECURITY DEFINER, set search_path, in the shape 28 established.
create or replace function public.my_gym_payment_readiness()
returns table (
  has_account boolean,
  account_type text,
  card_payments_status text,
  charges_enabled boolean
)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select
    (a.stripe_account_id is not null and btrim(a.stripe_account_id) <> ''),
    a.account_type,
    a.card_payments_status,
    a.charges_enabled
  from gym_connect_accounts a
  where a.tenant_id = my_tenant()
$function$;

revoke all on function public.my_gym_payment_readiness() from public;
grant execute on function public.my_gym_payment_readiness() to authenticated;

comment on function public.my_gym_payment_readiness() is
  'The four facts canTakeDirectCharges needs about the signed-in member''s gym, and nothing that identifies the account. Zero rows means the gym has no Stripe account at all.';
