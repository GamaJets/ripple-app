-- ═══════════════════════════════════════════════════════════════════════════
-- The charge moves to the coach's ledger, and the old ones stay where they are.
--
-- ── The decision ──────────────────────────────────────────────────────────
--
-- Every charge Repple has ever taken for a coach is a DESTINATION charge: the
-- Checkout Session is created on the PLATFORM account, the money is transferred
-- on to the coach's Express account, and Repple keeps an application fee.
-- 21-connect.sql says so at the top and connect-checkout says so at line 122.
--
-- The consequence of that shape is not about plumbing, it is about who pays.
-- Under destination charges the platform is the merchant of record, and Stripe
-- debits the PLATFORM's balance for every refund and every chargeback on a
-- coach's client. Repple has been carrying that, and Stripe has now asked Repple
-- to formally acknowledge it. The owner is not acknowledging it. So the charge
-- has to be created on the coach's account instead — a DIRECT charge — where
-- Stripe debits the COACH's balance for a refund or a dispute.
--
-- ── Why this is columns and not a rewrite ─────────────────────────────────
--
-- The two models must coexist, and not as a transitional convenience. They must
-- coexist permanently, because a connected account's arrangement is fixed when
-- the account is created and Stripe will not change it afterwards:
--
--   · `controller.stripe_dashboard.type` is documented as immutable — "To
--     change a connected account's dashboard, you must create a new Account
--     object".
--   · `controller.losses.payments` — which is the whole liability question — is
--     set at creation in the same hash.
--   · Stripe's own account-type table puts fraud and dispute liability for
--     Express accounts on the PLATFORM, and adds that direct charges "aren't
--     recommended for legacy v1 Express and Custom accounts".
--
-- Every coach onboarded before today is on `type: 'express'`. None of them can
-- be converted. They can only be RE-onboarded onto a new account, which means a
-- new KYC and new bank details, and that is a decision about people rather than
-- about code. Until each one has done that, their sales must keep working
-- exactly as they do — so the model is recorded PER ACCOUNT, and defaults to
-- the one every existing row already uses.
--
-- What a NEW coach gets is a STANDARD account. That is the owner's decision and
-- it follows from the table above: Standard is the only type where Stripe puts
-- fraud and dispute liability on the connected account, and it does so only for
-- direct charges. Standard also supports direct charges and NOTHING ELSE, so on
-- that path the account type and the charge model are one decision with two
-- names — which is why section 2a records the type as well as the model, and
-- why the two are always written in the same statement.
--
-- ── Why the object also carries the account ───────────────────────────────
--
-- A coach who moves to direct charges still has live subscriptions that were
-- created on the platform. Every later Stripe call about one of those — the
-- webhook's `subscriptions.retrieve`, connect-checkout's cancel and resume, the
-- client's billing portal — must be made in the SAME account context the object
-- was created in, or Stripe answers "No such subscription" for a subscription
-- that is plainly still charging somebody's card every month.
--
-- So the account id is stamped on the OBJECT, not inferred from the coach. Null
-- means the platform, and null is what every row written before today is — the
-- backfill is therefore no backfill at all, which is the only kind that cannot
-- get somebody's live subscription wrong.
--
-- Nothing in this part changes behaviour on its own. Every default reproduces
-- what the database already holds; the switch is a value written into
-- `connect_accounts.charge_model`, one coach at a time, by the owner.
-- Idempotent.

-- ── 1. how a coach sells ────────────────────────────────────────────────────
-- 'destination' for everybody who exists, because that is what they are doing.
-- A NOT NULL default rather than a nullable column: "we do not know how this
-- coach sells" is not a state this table may ever be in, since the answer
-- decides whose bank account a chargeback comes out of.
alter table connect_accounts add column if not exists charge_model text not null default 'destination';

alter table connect_accounts drop constraint if exists connect_accounts_charge_model_ck;
alter table connect_accounts add constraint connect_accounts_charge_model_ck
  check (charge_model in ('direct', 'destination'));

-- ── 2. what Stripe says the account can actually do ─────────────────────────
-- `charges_enabled` is Stripe's aggregate answer and it is what the app has
-- gated on so far. It is not quite the question direct charges ask: Stripe
-- requires the `card_payments` capability to be ACTIVE on the connected
-- account, and an account halfway through onboarding has it merely REQUESTED.
--
-- Nullable, and null means "not recorded yet" rather than "not active" — the
-- `account.updated` webhook fills these in, and connect-checkout falls back to
-- `charges_enabled` while they are null. A gate on a column that is null on
-- every existing row would stop every coach selling the moment it deployed.
alter table connect_accounts add column if not exists card_payments_status text;
alter table connect_accounts add column if not exists transfers_status text;
alter table connect_accounts add column if not exists payouts_enabled boolean;

-- Who Stripe holds responsible for an unrecoverable negative balance on this
-- account: 'application' (Repple) or 'stripe'. Read off `controller.losses.
-- payments` when the account is created or next seen, and recorded because it
-- is the answer to the question this whole part exists for — and because it
-- cannot be worked out later from anything else the app holds. Null on every
-- existing row; those are all `type: 'express'`, which means 'application'.
alter table connect_accounts add column if not exists losses_owner text;

alter table connect_accounts drop constraint if exists connect_accounts_losses_owner_ck;
alter table connect_accounts add constraint connect_accounts_losses_owner_ck
  check (losses_owner is null or losses_owner in ('application', 'stripe'));

-- ── 2a. what KIND of account it is, which is not the same as how it sells ───
--
-- Stripe's own `Account.type`: 'standard' for a coach onboarded under today's
-- arrangement, 'express' for everybody onboarded before it. ('custom' and
-- 'none' are in the constraint because they are values Stripe can return, not
-- because this repo creates either.)
--
-- This is a SEPARATE fact from `charge_model` and the separation is the whole
-- reason the column exists. `charge_model` is a switch a person writes — the
-- paragraph above literally describes the owner writing it one coach at a time.
-- Written onto an EXPRESS account it moves the refund and chargeback DEBIT to
-- the coach and leaves Repple carrying the fraud, the dispute and any balance
-- the coach cannot repay, because Stripe's account-type table gives Express
-- "Platform" liability for every charge type, with no qualifier. That is the
-- exact half-measure the move to Standard accounts exists to prevent, and it
-- would look completely fine in this table until a chargeback arrived.
--
-- So `connect-checkout` refuses a direct charge on anything whose type is not
-- 'standard', and this column is the fact it asks. Null means "nobody has asked
-- Stripe what this account is" and is ALSO refused for a direct charge — which
-- costs nothing, because no row is 'direct' until the new code ships, and every
-- row it writes as 'direct' is written with 'standard' in the same statement.
--
-- Deliberately NOT backfilled to 'express', even though every account that
-- exists today is one. The same reasoning as section 3 below: the absence is a
-- true statement about what has been asked, and `account.updated` plus
-- `connect-onboard` both write the real value the next time Stripe mentions
-- the account. A backfilled guess would be indistinguishable from an answer.
alter table connect_accounts add column if not exists account_type text;

alter table connect_accounts drop constraint if exists connect_accounts_account_type_ck;
alter table connect_accounts add constraint connect_accounts_account_type_ck
  check (account_type is null or account_type in ('standard', 'express', 'custom', 'none'));

-- ── 3. which ledger an existing object lives on ─────────────────────────────
-- Null = the platform account, which is where every row written before today
-- was created. Not defaulted to anything, and deliberately not backfilled: the
-- absence IS the correct value, and inventing one would be a guess about a
-- subscription that is still taking somebody's money.
alter table client_subscriptions add column if not exists stripe_account_id text;
alter table client_purchases add column if not exists stripe_account_id text;

-- The webhook resolves a connected-account event back to a coach through this,
-- when the event's metadata has been stripped in the Stripe dashboard and the
-- only identity left on it is the account it arrived from.
create index if not exists idx_connect_accounts_stripe_id on connect_accounts (stripe_account_id);
create index if not exists idx_client_subs_account on client_subscriptions (stripe_account_id) where stripe_account_id is not null;

-- ── 4. no new grants, deliberately ──────────────────────────────────────────
-- `connect_accounts` and `client_subscriptions` both hold table-wide SELECT
-- grants (21-connect.sql and 97-subscription-packages.sql), not the column
-- lists that part 131 introduced on `trainers` and part 151 had to widen. So
-- new columns are readable by the same policies that already govern these
-- tables, and nothing here needs a grant to avoid the 42501 part 151 records.
--
-- Checked, rather than assumed: `src/lib/connect.ts` reads connect_accounts
-- with `select('*')` and `src/ui/coachStatement.ts` names three columns, none
-- of them removed here.
