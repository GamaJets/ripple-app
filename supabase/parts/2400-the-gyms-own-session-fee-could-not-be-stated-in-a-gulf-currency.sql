-- ═══════════════════════════════════════════════════════════════════════════
-- The gym's own session fee could not be stated in a Gulf currency.
--
-- APPLIED, and the app-side half shipped in the same commit — see the foot of
-- this file, which is now a record rather than a to-do. Verified after:
-- information_schema reports tenants.session_fee as numeric(11,3), and
-- src/lib/gymSettings.test.ts round-trips 82.505 KWD, 12.345 BHD and 6000 JPY
-- through the field and back.
--
-- ── What a person sees ────────────────────────────────────────────────────
--
-- An owner of a Kuwaiti gym opens Ops on their phone (app/(owner)/ops.tsx) or
-- /settings in the console, types their session fee — 82.505 KWD, which is a
-- perfectly ordinary Gulf amount — and is told:
--
--     "Enter the fee as a number — 75, or 82.50. Leave it empty if you have
--      not set one."
--
-- The only fee they can record is one they do not charge. Same for BHD, JOD,
-- OMR and TND.
--
-- This is the same sentence the last commit on this subject was about — "A
-- Kuwaiti gym could not type 82.505 into its own cash register" — and this is
-- the one box that sweep could not reach, because it does not go through
-- `readMinorAmount` at all. `parseSessionFee` in src/lib/gymSettings.ts is its
-- own parser, written before the rule existed, and it carries the rule's
-- opposite in one regex:
--
--     if (!/^\d+(\.\d{1,2})?$/.test(bare)) return { kind: 'bad', … }
--
-- Two decimal places, hardcoded, with no currency anywhere in the signature.
-- Its sibling `parseRate` in src/lib/gymPay.ts — which prices ONE COACH — was
-- repaired and its comment names this exact `\d{1,2}` rule as one of the two
-- bugs it removed. The fee this file is about prices EVERY coach the gym has
-- not set a per-coach rate for: it is the third and last layer of
-- `rateForSession`, and as of today it is the layer that prices essentially
-- every session in the database (of 262 sessions, one carries a snapshotted
-- `rate_cents`).
--
-- ── Why the app cannot simply be fixed on its own ─────────────────────────
--
-- Because the column is the deeper half:
--
--     tenants.session_fee   numeric(8,2)
--
-- Verified live, 5 Sep 2026, via information_schema.columns. Two decimal
-- places are baked into the type. Widening the parser without widening this
-- would be strictly WORSE than the refusal above: Postgres does not reject an
-- over-precise numeric, it ROUNDS it. An owner typing 82.505 would be told the
-- fee was saved, would be shown 82.51 back through `sessionFeeFieldValue`, and
-- every payroll line for every coach on the standard fee would be priced half
-- a fils out, permanently, with nothing on any screen to say so. A refusal is
-- an honest failure; a silent round is the failure this whole area exists to
-- prevent.
--
-- So the column moves first, and the parser moves with it. See the note at the
-- foot of this file for the app-side half, which is NOT applied by this part.
--
-- ── Why numeric(11,3) and not numeric(8,3) ────────────────────────────────
--
-- `MAX_SESSION_FEE` in src/lib/gymSettings.ts is 999999.99 — six digits before
-- the point — and the parser refuses anything above it. numeric(8,3) would
-- hold only five, so a gym charging 250000 (a whole number, in one of the
-- currencies where that is an ordinary hourly rate — IDR, VND, COP) would have
-- its existing fee REJECTED by the type change and the ALTER would fail on a
-- live table. numeric(11,3) keeps every value the parser can produce today and
-- adds the third place beneath it.
--
-- Nothing is lost in the conversion: every existing value has at most two
-- decimal places, and numeric widens without rounding.
--
-- ── What this does NOT do ─────────────────────────────────────────────────
--
-- It does not invent a currency for anybody. `tenants.currency` is nullable on
-- purpose (part 99) and stays so; a gym that has named no currency still has a
-- fee that cannot be scaled into minor units, and `minorFromWhole` still
-- returns null for it rather than guessing a factor. This part only stops the
-- COLUMN from being the thing that decides how many places a gym's money has.
--
-- It does not touch `trainers.session_fee`, which is already an unconstrained
-- `numeric` and has never had this problem — the inconsistency between the two
-- is how this went unnoticed.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tenants
  ALTER COLUMN session_fee TYPE numeric(11,3);

COMMENT ON COLUMN public.tenants.session_fee IS
  'The gym''s standard fee for one delivered session, in WHOLE units of '
  'tenants.currency. Three decimal places because five currencies (BHD, JOD, '
  'KWD, OMR, TND) hold thousandths and this column was numeric(8,2), which '
  'made a Gulf gym''s own fee unstatable. NOT a minor-unit figure: every '
  '*_cents column in this schema is minor units and the factor between them is '
  'a property of the currency, not a hundred — src/lib/coachMoney.ts '
  'minorFromWhole() is the only door. NULL means the gym has not set one, '
  'which is not the same as zero: a fee of zero would value every delivered '
  'session at nothing and price payroll at exactly nought.';

-- ═══════════════════════════════════════════════════════════════════════════
-- THE APP-SIDE HALF, DONE IN THE SAME COMMIT
--
-- The column being wider than anything that can write to it is not a fix, so
-- src/lib/gymSettings.ts moved with it. Two functions, both of which took no
-- currency at all:
--
--   parseSessionFee(input)
--     Becomes parseSessionFee(input, currency) and reads the typed figure
--     through `readMinorAmount(typed, currency, false)` — false because a
--     session fee is a RECORD of what the gym pays, not a charge sent to
--     Stripe, so Stripe's "the third place must be a nought" rule does not
--     apply to it. That is the same reclassification the last sweep made at
--     eleven other sites, with the reason on the line. The result is in minor
--     units and comes back to whole units through the currency, never through
--     a hundred.
--
--   sessionFeeFieldValue(fee)
--     Becomes sessionFeeFieldValue(fee, currency). It ends `fee.toFixed(2)`,
--     which is two decimal places whatever the money is: a yen gym is offered
--     its own fee back as "6000.00", and a Kuwaiti one loses the third place
--     it will then be able to type. `majorFromMinor` already does this
--     correctly and takes the places from the currency.
--
-- Both call sites already held the currency: app/(owner)/ops.tsx has the
-- tenant, and studio-web/app/settings/page.tsx has both the stored one and the
-- one in its own picker. The console validates against the PICKER's, so an
-- owner switching this gym to KWD can type the third place straight away and
-- one switching to JPY is told a fractional yen is not an amount before they
-- save rather than after. Neither function takes a DEFAULT currency,
-- deliberately — a default is the same hardcoded two places written somewhere
-- less visible.
--
-- One behaviour is new rather than restored: with no currency recorded, the
-- fee is now REFUSED rather than parsed as two places. That is `readMinorAmount`'s
-- own rule — "an amount typed in would not be an amount of any money" — and it
-- is the currency doctrine applied to the one box that had escaped it.
-- ═══════════════════════════════════════════════════════════════════════════
