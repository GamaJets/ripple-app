// Trainer · Payments (Stripe Connect). Onboard a payout account, then create
// packages (memberships / session-packs) clients can buy. Money goes to the
// trainer's connected account minus the platform fee. Credential-ready: activates
// once Stripe Connect is enabled and keys are set. No card details in-app.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every Stripe/Connect call, handler, conditional and route
// was untouched in that pass — only the presentation changed: the four bordered cards became
// hairline-separated sections, the one card left is the payout decision itself,
// and the Georgia serif header is gone.
//
// ── What this screen may say about money, and what it may not ─────────────
//
// It used to say: "Nothing here reports a balance, a payout or a transaction:
// every figure is a price the trainer typed. There is no earnings number on
// this screen because the app is not told one." Half of that was true and half
// of it was a read nobody had written.
//
// The true half stands. Stripe has never told this app a balance, a payout, its
// own processing fee or the platform's application fee — no webhook in this
// repo writes any of them — so none of those four words appears on this screen.
// A "net earnings" figure here would be plausible and invented, and the one
// number a working trainer has to be able to trust is the one about their own
// money.
//
// The false half is now fixed. One thing IS written down: what a client was
// charged. `client_purchases` records `amount_cents` on every completed
// one-off checkout, and all four functions that had ever read that table
// filtered on `client_id = uid` — they are the CLIENT's side. So the app took
// money on the coach's behalf and then showed them nothing about it: not who
// bought a ten-pack, not how many sessions were left on it, not who had run
// out. `fetchClientPurchases` is the other side of the same sale, and the
// figure above it is labelled as exactly what it is — gross, taken, per
// currency, before anybody's fee.
//
// ── Whose money it is, and why that is now a sentence on the screen ──────
//
// It used to be Repple's, in the only sense that matters to a bank. Every sale
// was a DESTINATION charge: created on Repple's Stripe account and transferred
// on to the coach, with Repple as the merchant of record and Repple's balance
// debited for every refund and every chargeback. Coaches onboarded from part
// 161 onward get a STANDARD Stripe account and sell under DIRECT charges
// instead, which reverses all of that — the money lands in their account,
// Stripe's processing fee comes out of their balance rather than Repple's, a
// dispute is theirs to answer, and their dashboard is the full one rather than
// the Express one.
//
// None of those three was said anywhere in this app, and all three are things a
// person finds out at the worst possible moment otherwise: the first time a
// client charges back. So they are said in the Payouts section, once, in two
// sentences.
//
// They are chosen by `connect_accounts.account_type` — Stripe's own word, read
// through `accountTypeOf` — and NOT by which build this is, because both
// arrangements are live at the same time and will be for as long as the legacy
// Express accounts exist. Those coaches get the opposite sentence, which is
// equally true of them. When Stripe has not said what the account is, the
// screen says nothing at all: this is the screen that refuses to print a
// balance it was not told, and a fee sentence that might be about the other
// arrangement is the same kind of invention.
//
// ── What a coach has EARNED, and why that took a new table ────────────────
//
// The figure above used to be one-off sales and nothing else, because one-off
// sales were the only money this database had ever written down. A client
// subscribing to "Online coaching, AED 600/month" was recorded as a
// SUBSCRIPTION — status, price, renewal date — and each month's actual payment
// was recorded nowhere at all: the webhook answered a paid invoice by re-reading
// the subscription and writing its status. After a year of that client paying,
// this app held one row saying "active, AED 600 / month" and no evidence that
// twelve payments had happened. The screen said so, which was honest and no use
// to anybody: the one question a coach asks of a payments screen is how much
// they have earned.
//
// Part 132 adds `client_subscription_payments` — one row per PAID Stripe
// invoice — and the stripe-webhook writes it. So the figures here are now both
// halves of the coach's takings added together, per currency:
//
//   one-off sales   client_purchases, from checkout.session.completed
//   renewals        client_subscription_payments, from invoice.paid
//
// and the split between the two is printed underneath, because "how much of
// this recurs" is a different question from "how much came in" and a coach
// running a membership business needs both.
//
// A renewal is dated by Stripe's own `paid_at`, never by when the row was
// written. A webhook retried three days late would otherwise move somebody's
// payment into a different month.
//
// ── What is still NOT in that figure, and cannot be ───────────────────────
//
//   · Any purchase whose currency we cannot recover. `client_purchases` only
//     records a currency from part 132 onward; older rows were backfilled from
//     the `trainer_packages` row they were sold from, and a package already
//     deleted by then left an amount with no unit forever. Those are counted and
//     reported as missing from the total rather than dropped out of it quietly
//     or summed as dollars.
//   · Anything Stripe has actually PAID OUT. This is gross — what the client
//     was charged. Stripe's processing fee, the platform's application fee, and
//     whether the money has cleared into the coach's bank are facts that live at
//     Stripe, and no webhook in this repo has ever been told any of them. That
//     sentence is on the screen, not just in this comment, because the gap
//     between "taken" and "in my account" is exactly where a coach would
//     otherwise assume a number that nobody here computed.
//
// The standing price of the live subscriptions is still printed separately,
// further down, and still labelled as a price. It is what is expected to be
// charged NEXT if nobody cancels — a forward-looking figure, which is why it is
// not added to a backward-looking one.
//
// ── A chargeback, which this screen used to mention and never show ────────
//
// The Payouts note below says, out loud, that on a standard account "a dispute
// is theirs to answer". That was true and it was the whole of what this app did
// about one: it told a coach the job was theirs while giving them no way to
// know a case existed. There was no `charge.dispute.*` handler in the webhook
// and no table for it to write to.
//
// Every other figure on this screen answers "how much". A chargeback answers
// "is there something with a deadline", and it is different in kind: Stripe
// takes the money back the moment a dispute opens, stops accepting evidence on
// a fixed day, and decides on whatever arrived — where nothing is the commonest
// submission and loses by default. So the Chargebacks section sits ABOVE the
// packs and the packages, the DATE is the first line of every row, and a read
// that failed says so rather than showing an empty list. src/lib/disputes.ts
// holds the rules and supabase/parts/611 the table.
//
// ── A pack that runs out of time ──────────────────────────────────────────
//
// Packages can now carry a validity (part 612) and it is offered on a session
// pack alone — a membership has no credits to run out of. The one thing about
// it a coach has to understand is on the form beside the field: a window
// applies to packs bought FROM NOW ON, because it is stamped on the sale at
// checkout and never recomputed. Anything else would mean a coach adding
// ninety days to a package they have sold for two years voided every unspent
// credit their existing clients hold, at the instant they pressed Save.
//
// And a pack that ran out of time with sessions on it is listed as exactly
// that, with the number, beside the packs that were genuinely used up. Those
// two are the same two numbers by the time the nightly pass has been over them
// and they are opposite sentences about somebody's money.
//
// ── Stopping a subscription, which a coach can now actually do ────────────
//
// This screen used to say, out loud, that stopping a subscription was the
// client's to do — because the `cancel`/`resume` actions in connect-checkout
// scoped their lookup to `client_id = auth.uid()`, so a coach calling them got
// "subscription not found" every time. Saying that was right; a Cancel button
// that always fails on somebody's recurring charge is worse than none.
//
// The edge function was the thing that was wrong, and it is fixed. It now reads
// the subscription and asks who the caller is TO IT — client or coach, per
// src/lib/subscriptionScope.ts, which is a pure module with a test because it
// is the only thing standing between one coach and another coach's
// subscriptions. So the buttons are here: stop at period end, and put back one
// that was stopped.
//
// Two of the three things this screen used to refuse are now here, and the
// third still is not:
//
//   · Cancel immediately — NOW HERE, underneath the safer option rather than
//     beside it. Stopping at the end of the period is still the default and
//     still what "Stop" means; ending it today is a second confirmation that
//     says out loud that it takes the rest of a paid period off the client and
//     returns nothing. It exists because a client who asks to be cancelled
//     today and is billed again in three weeks writes the review that costs the
//     coach the next five clients.
//   · Refund — NOW HERE, for a one-off sale AND for a paid renewal, in whole
//     OR IN PART. The renewal half is the newer of the two and its absence was
//     not a decision anybody made: `refundRenewal` existed in
//     src/lib/connect.ts, connect-refund had a `kind: 'renewal'` branch, part
//     192 gave `client_subscription_payments` the same two refund columns it
//     gave `client_purchases` — and no screen anywhere called any of it, so a
//     coach whose client asked for last month back was sent to a Stripe
//     dashboard by the app that took the money. There is now a Renewals Paid
//     list beside the Subscribers one, built from rows this screen was already
//     reading for its takings figure and summing without ever showing.
//     ONE sheet serves both, on a `RefundTarget` rather than on a
//     `CoachPurchase`, because a second sheet is a second place for one of the
//     four things below to be dropped.
//     What made it safe rather than half-working is in
//     supabase/functions/connect-refund: the refund is made in THAT CHARGE'S
//     OWN Stripe account (read off the row, never from the coach's current
//     charge model), Stripe is called first and the row is written only from
//     its answer, and Repple's share comes back in proportion. The partial
//     amount was the deliberate limit this shipped with, because a typed field
//     can credit somebody's card by a figure they did not choose. It is built
//     now: the box is shaped by the CHARGE's own currency
//     (a yen has no minor unit and a dinar has three places), the reader
//     converts digits rather than multiplying a float, nothing is rounded and
//     nothing is clamped, the ceiling is what is LEFT rather than the price,
//     and the confirm states the exact amount with its currency on it.
//   · Open the client's billing portal — still not here, and never will be.
//     That is their saved card, their billing address and every receipt they
//     have been sent. It stays theirs; a coach calling it is refused with a 403
//     that says why.
//
// ── A status nobody wrote a sentence for ──────────────────────────────────
//
// `client_subscriptions.status` is Stripe's word, written verbatim by the
// webhook, and this screen filtered it with `isLive` — true for three words,
// false for everything else. So a subscription in a state Repple has no
// sentence for did not render as unknown, it rendered as NOTHING: a coach whose
// client's subscription Stripe had PAUSED read "Nobody is subscribed yet" off a
// screen that had the row in memory, and concluded a paying client had left.
//
// `subState` splits three ways instead — live, ended, and unsettled — with
// unsettled as the DEFAULT rather than a list, so a status word Stripe adds
// after this was written shows up quoted rather than disappearing. Unsettled
// rows are listed separately and are in neither the subscriber count nor the
// priced-to-recur figure, because neither may include a charge that is not
// happening.
//
// Two things are new. A package can now bill EVERY month or year rather than
// once (part 97), which is the biggest difference between two rows on this
// screen and so is stated on every one of them — "one-off" is written out
// rather than implied by the absence of the word "month". And a coach can see
// who is subscribed, because a recurring charge nobody can list is a recurring
// charge nobody can check.
//
// Prices are printed in the package's OWN currency, with the code spelled out
// — "AED 600.00", not "$600". `money()` in src/lib/billing.ts maps everything
// it does not recognise onto a dollar sign, and a coach in Dubai has been
// showing their clients a price in a currency they do not take.
//
// New packages are priced in the GYM's currency (tenants.currency, part 99) and
// in nothing else. There is no picker and no default: Repple is white-labelled,
// so a currency this screen chose would be wrong for half the gyms running it.
// A gym that has not set one cannot put a package on sale, and is told that,
// rather than being given a price with a unit invented for it.
import { useState, useEffect, useCallback, useRef } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, Pressable, ScrollView, TextInput, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Flag, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value, numeric } from '../../src/theme/scale';
import { worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import { reportError } from '../../src/lib/reportError';
import { isoDate } from '../../src/lib/format';
import { payoutStage, canOnboard } from '../../src/lib/payoutAccount';
import { startTrainerOnboarding, fetchMyConnect, fetchMyPackages, createPackage, deactivatePackage, updatePackage, countActiveSubscribers, fetchClientPurchases, refundPurchase, refundRenewal, adjustPackCredit, fetchMyPromoCodes, createPromoCode, archivePromoCode, fetchMyDisputes, type ConnectStatus, type TrainerPackage, type CoachPurchase, type CoachDispute } from '../../src/lib/connect';
// A chargeback is the one thing on this screen with a clock on it. See
// src/lib/disputes.ts: the deadline is the content, a missing deadline is its
// own sentence, and none of it is a judgement about whether to fight the case.
import {
  deadlineLine, disputeTone, disputeStatusLabel, disputeReasonLabel, isClosed, needsResponse,
  DISPUTE_MONEY_IS_ALREADY_GONE, EVIDENCE_GOES_TO_STRIPE, WHAT_EVIDENCE_LOOKS_LIKE,
} from '../../src/lib/disputes';
// How long a pack is good for, and what to say on the day it is not. The rule
// that matters is that a window belongs to the SALE — see the header of
// src/lib/packExpiry.ts and supabase/parts/612.
import {
  readValidityDays, validityLine, expiryLine, strandedNote, expiryDayLabel, packWindow,
  VALIDITY_NOT_RETROACTIVE, NO_VALIDITY_IS_FOREVER, EXPIRY_IS_NOT_A_REFUND,
} from '../../src/lib/packExpiry';
import { packageEditBlocker, isReprice, isRename, repriceNote, RENAME_RELABELS_HISTORY } from '../../src/lib/packageEdit';
import { fetchMySubscribers, fetchMySubscriptionPayments, pkgMoney, pkgPriceLine, statusLabel, cancelSubscription, resumeSubscription, endSubscriptionNow, type BillingInterval, type Subscriber, type SubscriptionPayment } from '../../src/lib/subscriptions';
import {
  normaliseCode, promoBlocker, promoState, promoStateLabel, promoUseLine,
  PROMO_IS_A_PERCENTAGE, PROMO_IS_TYPED_AT_CHECKOUT, PROMO_LIVES_AT_STRIPE, PROMO_WITHDRAW_IS_FORWARD_ONLY,
  type PromoCode, type PromoTarget,
} from '../../src/lib/packagePromo';
import { isoToday } from '../../src/lib/dayPlan';
import { useToday } from '../../src/ui/today';
import {
  refundBlocker, refundableRow, refundableCents, refundAmountBlocker, refundBalanceNote, refundConfirmLine,
  isPartlyRefunded, isFullyRefunded,
  REFUND_DOES_NOT, REFUND_FEES_NOTE, REFUND_IS_FINAL, REFUND_PART_IS_EXACT,
  END_NOW_TAKES_THE_REST, END_AT_PERIOD_IS_KINDER,
  type Refundable,
} from '../../src/lib/refunds';
import { subState, unsettledNote, canSwitchCancel } from '../../src/lib/subscriptionScope';
import { fetchMyCurrency } from '../../src/lib/myCurrency';
import { currencyFromNote, myCurrencyLine, type CurrencyFrom, type MyCurrencyGap } from '../../src/lib/currencySource';
import { sumTaken, combineTaken, sumRecurring, since, monthStart, packLeft, packRunOut, minorMoney, currencyDecimals, readMinorAmount, majorFromMinor, feeMismatches, type Pot, type TakenRow } from '../../src/lib/coachMoney';
// Deliberately no `readNumber` on this screen. It is the house reader for a
// typed figure and it is right for a load or a distance, where leniency costs
// nothing — but it replaces the FIRST comma with a point and calls parseFloat,
// so "1,234.50" reads as 1.234. Every money box here goes through
// `readMinorAmount`, which takes the decimal comma itself and refuses the
// ambiguous separator rather than choosing a reading of somebody's price.
import { accountTypeOf, accountForObject } from '../../src/lib/directCharges';
// Why a credit did not move, in the words every other draw site uses. One copy
// of those sentences, in the pure module that owns the outcome union.
import { drawReason } from '../../src/lib/packDraw';
import { BACK_ICON } from '../../src/ui/direction';

const INTERVALS: { key: BillingInterval | null; label: string }[] = [
  { key: null, label: 'One-off' },
  { key: 'month', label: 'Monthly' },
  { key: 'year', label: 'Yearly' },
];

/**
 * One charge the refund sheet can act on, whichever table it came from.
 *
 * ── Why the sheet is not keyed on `CoachPurchase` any more ────────────────
 *
 * It was, and that was the whole of why a RENEWAL could not be refunded from
 * anywhere. Every other piece existed: `refundRenewal` in src/lib/connect.ts,
 * a `kind: 'renewal'` branch in supabase/functions/connect-refund, and the
 * `refunded_cents` / `refunded_at` columns part 192 added to
 * `client_subscription_payments` at the same time as it added them to
 * `client_purchases`. No screen called any of it, so a coach whose client asked
 * for last month back was still being sent to a Stripe dashboard — the exact
 * moment the whole refund feature exists to remove.
 *
 * A second sheet was the obvious way to add it and is the wrong one. The four
 * things that make a typed amount safe rather than merely present — the ceiling
 * being what is LEFT, the currency deciding the shape of the box, nothing
 * rounding, and Stripe's own returned figure being what is reported back — are
 * properties of the SHEET, and a second copy of it is a second place for one of
 * them to be dropped. So the sheet takes this instead, and both lists build it.
 *
 * Everything here is read off the ROW. `account` in particular is the account
 * that charge was made on and never the coach's current `charge_model`: a coach
 * who has since moved to direct charges still has older sales and older
 * renewals on the platform, and a refund issued in the wrong context is
 * answered by Stripe with "No such charge" for a charge that plainly exists.
 */
interface RefundTarget {
  kind: 'purchase' | 'renewal';
  /** The row's own id — a `client_purchases.id` or a
   *  `client_subscription_payments.id`. Which table is `kind`. */
  id: string;
  /** Who paid, or null when the name could not be read. Rendered through
   *  `fig`, never as the word "Client". */
  who: string | null;
  /** What it was, for the line under the name in the sheet. Null when there is
   *  nothing to say — a renewal names its own date on the row instead. */
  what: string | null;
  /** The connected account it was charged on, or null for the platform. */
  account: string | null;
  /** The money, in the shape every rule in src/lib/refunds.ts reads — built by
   *  `refundableRow`, which is the mapping connect-refund runs too. */
  rule: Refundable;
}

/** A one-off sale, as the sheet reads it. The money half goes through
 *  `refundableRow`, which is the same mapping connect-refund runs — including
 *  the bigint-as-string coercion `refunded_cents` needs. */
const purchaseTarget = (b: CoachPurchase): RefundTarget => ({
  kind: 'purchase',
  id: b.id,
  who: b.client_name || null,
  what: b.package_name || null,
  account: b.stripe_account_id ?? null,
  rule: refundableRow('purchase', {
    amount_cents: b.amount_cents,
    currency: b.currency ?? null,
    refunded_cents: b.refunded_cents ?? 0,
    status: b.status,
  }, b.stripe_session_id ?? null),
});

/**
 * One paid renewal, as the sheet reads it.
 *
 * No status is passed and none exists: `client_subscription_payments` has no
 * status column, because part 132 writes a row there only after checking the
 * invoice itself said paid. `refundableRow` is where that is decided, once,
 * for the screen and the server both.
 */
const renewalTarget = (p: SubscriptionPayment): RefundTarget => ({
  kind: 'renewal',
  id: p.id,
  who: p.client_name || null,
  what: null,
  account: p.stripe_account_id ?? null,
  rule: refundableRow('renewal', {
    amount_cents: p.amount_cents,
    currency: p.currency,
    refunded_cents: p.refunded_cents ?? 0,
  }, p.stripe_invoice_id ?? null),
});

/** How a package bills, in words, for a row in a list. Never blank: "one-off"
 *  said out loud is the point — a coach scanning their price list has to be
 *  able to see which of these charges again. */
const billingWords = (p: TrainerPackage): string => {
  const price = pkgPriceLine(p.price_cents, p.currency, p.billing_interval);
  const what = p.billing_interval ? '' : p.sessions ? ` · ${p.sessions} sessions` : ' · one-off membership';
  return `${price ?? fig(null)}${what}`;
};

/**
 * A `timestamptz` as the READER's calendar day, or null when there is none to
 * read.
 *
 * Every timestamp on this screen arrives from PostgREST serialised in UTC, and
 * the first ten characters of that string are Greenwich's day rather than
 * anybody else's. `isoDate` is built from the local getters, so this is the day
 * the coach holding the phone is standing in. See the note at the chargeback
 * row, which is the one place it decides whether somebody answers in time.
 *
 * Null rather than a guess on anything unparseable: the caller has a sentence
 * for "no date", and inventing today's would be the one outright lie available.
 */
function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? isoDate(new Date(ms)) : null;
}

export default function TrainerPayments() {
  const t = useTheme();
  const router = useRouter();
  const [conn, setConn] = useState<ConnectStatus | null>(null);
  // The other half of `conn`, and the reason this screen used to lie about
  // somebody's payout account. `fetchMyConnect` answers null for "could not
  // read" and a zeroed row for "no account" — its own comment says the caller
  // renders those differently — but `conn` is initialised to null too, so the
  // value alone cannot tell a failed read from a read that has not happened
  // from an account that does not exist. The status is held beside it and the
  // pair is resolved by `payoutStage`.
  const [connRead, setConnRead] = useState<LoadStatus>('loading');
  // 'ready' with nothing is not 'error'. Nothing under 'ready' is a trainer who
  // sells nothing; 'error' is a price list we could not read, and telling
  // someone they have no packages when they do is how a duplicate price list
  // gets built. 'partial' is the third — more packages than one read returns,
  // on which the number beside the heading is a floor and not a total.
  const [pkgs, setPkgs] = useState<TrainerPackage[]>([]);
  const [pkgRead, setPkgRead] = useState<LoadStatus>('loading');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [sessions, setSessions] = useState('');
  const [interval, setInterval] = useState<BillingInterval | null>(null);
  // How long a pack is good for, as the coach typed it. Empty is not zero and
  // not a default — it is a pack that does not expire, which is what every pack
  // in this database does today.
  const [validity, setValidity] = useState('');
  // The gym's own currency, and no fallback. Repple is white-labelled: null
  // here means the gym has not set one, and a price is not offered until it
  // has — a package priced in a currency nobody chose is a wrong number in
  // front of every client who ever sees it.
  //
  // Read through `fetchMyCurrency`, not `myTenantCurrency`. The gym is still
  // the authority wherever there is one; the difference is a coach who has NO
  // gym, whose currency lives on `trainers.currency` (part 940) and who could
  // otherwise never price a package at all — Add Package was disabled for them
  // for ever, under a sentence naming a gym owner who does not exist.
  //
  // `gap` rather than an error string, because the six causes are six
  // different sentences and only one of them is anybody's setting: see
  // src/lib/currencySource.ts.
  const [currency, setCurrency] = useState<string | null>(null);
  const [currencyGap, setCurrencyGap] = useState<MyCurrencyGap | null>(null);
  // Where the code came from, kept beside it. The two sources behave
  // differently and the coach can only act on one: a gym's currency changes
  // when its owner changes it, and their own never changes at all. A price
  // field labelled with three letters and no account of where they came from
  // is the thing that let one coach be denominated by a gym they had left.
  const [currencyFrom, setCurrencyFrom] = useState<CurrencyFrom | null>(null);
  // Who is paying this coach every month. 'ready' with nothing means nobody has
  // subscribed; 'error' with nothing means we could not find out, and those are
  // not the same fact about somebody's income.
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [subsStatus, setSubsStatus] = useState<LoadStatus>('loading');
  // Which ONE subscription is mid-change, by its Stripe id. Not a screen-wide
  // `busy`: a coach with twelve subscribers pressing Stop on the third of them
  // must not watch every other row grey out, because the row that greys out is
  // the one they will believe they acted on.
  const [subBusy, setSubBusy] = useState<string | null>(null);
  /** The charge whose refund is in flight, so one row's button can be busy
   *  without disabling every other row's — a coach refunding two people in a
   *  row should not be locked out of the second by the first. A sale and a
   *  renewal cannot collide on it: both ids are uuids from different tables. */
  const [refundBusy, setRefundBusy] = useState<string | null>(null);
  /** The charge whose refund sheet is open, and what has been typed into it.
   *  A sheet rather than an Alert because a partial refund needs a box, the
   *  currency beside the box, and the exact figure that will leave shown back
   *  before anything is tapped — none of which fits in an alert, and shipping
   *  the alert without them is what kept this whole-only.
   *
   *  A `RefundTarget` rather than a `CoachPurchase`, so ONE sheet serves both a
   *  one-off sale and a paid renewal — see the note on that type. */
  const [refunding, setRefunding] = useState<RefundTarget | null>(null);
  /** True for the whole of what is left, false for a typed amount. Defaults to
   *  the whole: it is the commoner act and the one with nothing to get wrong. */
  const [refundWhole, setRefundWhole] = useState(true);
  const [refundAmt, setRefundAmt] = useState('');
  // The coach's discount codes, read LIVE from their own Stripe account — there
  // is no local table and no cache, because Stripe holds the redemption count
  // and a second copy of it would be a second copy that can disagree. Its own
  // status: it fails independently of everything else on this screen, and
  // "you are running no offers" and "your offers could not be read" are
  // different sentences to a coach who has just printed a poster.
  const [promos, setPromos] = useState<{ codes: PromoCode[]; status: LoadStatus; reason: string | null }>({ codes: [], status: 'loading', reason: null });
  const [promoCode, setPromoCode] = useState('');
  const [promoPct, setPromoPct] = useState('');
  const [promoPkg, setPromoPkg] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  // What clients have actually bought. Same three-way distinction, and it
  // carries more weight here than anywhere else on the screen: an empty list
  // under 'error' is "we could not look", and rendering it as "nothing has been
  // bought" tells a coach who has been paid that they have not been.
  const [buys, setBuys] = useState<CoachPurchase[]>([]);
  const [buysStatus, setBuysStatus] = useState<LoadStatus>('loading');
  // The renewals actually paid — the other half of the same coach's takings,
  // and the half that did not exist in this database until part 132. Carried
  // with its own status rather than folded into `buysStatus`, because the two
  // are separate reads and either can fail on its own: a total that quietly
  // omitted every renewal would be a smaller number about somebody's income
  // with nothing on screen to say it was short.
  const [pays, setPays] = useState<SubscriptionPayment[]>([]);
  const [paysStatus, setPaysStatus] = useState<LoadStatus>('loading');
  // Chargebacks. Carried with its own status for the same reason as the two
  // above, and it matters more here than anywhere else on the screen: an empty
  // list under 'error' would be an all-clear made out of our own failure, on
  // the one question in this app where being wrongly reassured costs the whole
  // amount and a fixed deadline goes past while nobody is told.
  const [disputes, setDisputes] = useState<CoachDispute[]>([]);
  const [disputesStatus, setDisputesStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p, s, cur, b, r, pr, dp] = await Promise.all([fetchMyConnect(), fetchMyPackages(), fetchMySubscribers(), fetchMyCurrency(), fetchClientPurchases(), fetchMySubscriptionPayments(), fetchMyPromoCodes(), fetchMyDisputes()]);
    setConn(c); setConnRead(c === null ? 'error' : 'ready'); setPkgs(p.rows); setPkgRead(p.status);
    setSubs(s.rows); setSubsStatus(s.status);
    setCurrency(cur.currency); setCurrencyGap(cur.gap); setCurrencyFrom(cur.from);
    setBuys(b.rows); setBuysStatus(b.status);
    setPays(r.rows); setPaysStatus(r.status);
    setPromos(pr);
    setDisputes(dp.rows); setDisputesStatus(dp.status);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Eight reads in one call, and they stay in one call. Stripe writes most of
  // what this screen shows — a subscriber lapsing, a purchase settling, a
  // DISPUTE opening with a fixed deadline on it — and none of it reaches the
  // coach's phone by itself. The disputes are the reason this matters most:
  // an empty list under a failed read is an all-clear made out of our own
  // failure, on the one question where being wrongly reassured costs the
  // whole amount while a deadline goes past.
  const pull = usePullToRefresh(load);

  /** What the coach currently sells. Derived once because it was filtered four
   *  separate times in the markup — the heading count, the empty state, the
   *  list, and the promo-code targets — and four copies of one predicate is
   *  four places for the count and the list to stop agreeing. */
  const activePkgs = pkgs.filter((p) => p.active);

  /**
   * Which package a discount code takes its percentage off, or null when this
   * screen cannot say.
   *
   * Read from `pkgs` rather than `activePkgs`: a code can perfectly well be
   * attached to a package the coach has since withdrawn, and answering "not one
   * of yours" for that would be worse than saying nothing. Null under a read
   * that did not come back whole, and null for a code with no package on it —
   * the caller says which silence it is rather than printing a blank.
   */
  const promoPkgLine = (p: PromoCode): string | null => {
    if (!p.packageId) return null;
    if (pkgRead !== 'ready') return null;
    const found = pkgs.find((k) => k.id === p.packageId);
    if (!found) return null;
    return found.active ? `On ${found.name}` : `On ${found.name}, which you have withdrawn`;
  };

  const onboard = async () => { setBusy(true); const r = await startTrainerOnboarding(); setBusy(false); if (!r.ok) Alert.alert('Payouts setup', r.error || 'Could not start setup. Make sure Stripe Connect is enabled.'); };

  const addPkg = async () => {
    const nm = name.trim();
    if (!nm) { Alert.alert('Name it', 'Give the package a name.'); return; }
    // The currency check comes BEFORE the price, because without one the price
    // cannot be interpreted at all — a yen has no minor unit and a dinar has a
    // thousand — and because "your gym has not set a currency" is a different
    // problem with a different fix. `invoiceBlockers` orders the same two
    // refusals the same way for the same reason.
    //
    // Nothing is priced in a currency nobody chose. There is no sensible
    // default in a white-label product — see tenants.currency, part 99.
    if (!currency) {
      // One sentence per cause, and the causes are not interchangeable: a read
      // that failed is fixed by trying again, a gym with no currency is fixed
      // by its owner, and a coach with no gym fixes it themselves in Settings.
      // All three used to arrive as the middle one.
      Alert.alert('No currency set', myCurrencyLine(currencyGap ?? 'unreadable', 'there is nothing to price this in'));
      return;
    }
    // A recurring package is never also a session pack — the constraint in part
    // 97 and the guard in createPackage both refuse it, and the form does not
    // offer the field at all, so this is belt and braces on a typed value.
    const sess = interval ? null : sessions.trim() ? parseInt(sessions, 10) : null;
    // `readMinorAmount` on WHAT THE COACH TYPED, not on a float derived from it.
    //
    // Two things, and the second is why `readNumber` is gone from this line.
    // The multiplier is not a hundred: a yen has no minor unit at all and a
    // Kuwaiti dinar has a thousand fils, so a coach in Kuwait typing 5 was
    // storing 500 — a package priced at a tenth of what they meant, written
    // into the database and charged to every client who ever bought it.
    //
    // And the typed string went through `readNumber` first, which replaces the
    // FIRST comma with a point and calls parseFloat. That is right for the
    // decimal comma a European decimal pad offers — "49,50" is 49.5 — and it
    // is silently wrong for a thousands separator: `parseFloat('1.234.50')` is
    // 1.234, so a coach typing 1,234.50 put a package on sale for one pound
    // twenty-three. `readMinorAmount` takes the comma decimal itself and
    // REFUSES the ambiguous one with a sentence naming the fix, which is the
    // whole reason it exists — so nothing is parsed before it any more.
    const read = readMinorAmount(price, currency);
    if (!read.ok) { Alert.alert('Set a price', read.reason); return; }
    const cents = read.minorUnits;
    if (!(cents > 0)) { Alert.alert('Set a price', 'Enter a price greater than 0. A package that costs nothing is not one clients can buy.'); return; }
    // The last thing before a recurring price goes on sale is the coach reading
    // it back in the currency it will actually be charged in. A subscription
    // priced by accident in the wrong currency is not one wrong sale, it is a
    // wrong sale every month to everybody who ever buys it.
    // How long the credits last. Refused rather than coerced: an empty box is a
    // pack that does not expire, and anything else has to be a whole number of
    // days the coach actually meant. `readValidityDays` is the one place that
    // reading happens, and it is asserted in src/lib/packExpiry.test.ts.
    const typedValidity = readValidityDays(interval || !(sess && sess > 0) ? '' : validity);
    if (!typedValidity.ok) { Alert.alert('How long is it good for?', typedValidity.reason); return; }
    const confirmLine = `${pkgPriceLine(cents, currency, interval) ?? fig(null)} — ${nm}`;
    const go = async () => {
      setBusy(true);
      const r = await createPackage({ name: nm, price_cents: cents, sessions: sess && sess > 0 ? sess : null, currency, billing_interval: interval, validity_days: typedValidity.days });
      setBusy(false);
      if (!r.ok) { Alert.alert('Could not save', r.error || 'Try again.'); return; }
      setName(''); setPrice(''); setSessions(''); setInterval(null); setValidity(''); load();
    };
    if (!interval) { go(); return; }
    Alert.alert('Charge this every ' + (interval === 'month' ? 'month' : 'year') + '?',
      `${confirmLine}\n\nClients who subscribe are charged again every ${interval === 'month' ? 'month' : 'year'} until they cancel.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Put On Sale', onPress: go }]);
  };

  /**
   * Stop a client's subscription at the end of the period they have paid for,
   * or put one back that was stopped.
   *
   * Both go to the same `connect-checkout` action the client's own Memberships
   * screen calls. Until tonight that action scoped its lookup to
   * `client_id = auth.uid()` and answered a coach with "subscription not
   * found", which is why this screen had no button and said so. It now reads
   * the row and asks who the caller is to it (src/lib/subscriptionScope.ts), so
   * a coach can act on their OWN client's subscription and on nobody else's.
   *
   * Nothing here cancels immediately and nothing here refunds. The client has
   * paid for the period they are in and keeps it; a refund is a different
   * Stripe API this app does not implement, and the note under the list says
   * where one is issued instead of pretending there is a button for it.
   *
   * The confirmation names the person and the date. "Stop this subscription?"
   * on its own is the dialog somebody taps through — this is a coach ending a
   * paying client's arrangement, and the two facts they need before they do it
   * are who it is and when it actually ends.
   */
  const switchCancel = (s: Subscriber, to: 'cancel' | 'resume' | 'end_now') => {
    const who = s.client_name || 'this client';
    const ends = s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : null;
    const price = pkgPriceLine(s.amount_cents, s.currency, s.billing_interval);
    const go = async () => {
      setSubBusy(s.stripe_subscription_id);
      const r = to === 'cancel'
        ? await cancelSubscription(s.stripe_subscription_id)
        : to === 'end_now'
          ? await endSubscriptionNow(s.stripe_subscription_id)
          : await resumeSubscription(s.stripe_subscription_id);
      setSubBusy(null);
      // `ok: false` is Stripe saying it did NOT change, so the row must not be
      // redrawn as though it had. The screen is reloaded either way — on
      // failure because whatever Stripe does think is truer than what is on
      // screen, on success because the edge function has already mirrored
      // Stripe's answer into the row this list reads.
      if (!r.ok) Alert.alert(to === 'resume' ? 'Not restarted' : 'Not stopped',
        (r.error || 'The change did not go through.') + (to === 'resume' ? '\n\nThis subscription is still set to end.' : '\n\nThis subscription is still charging.'));
      load();
    };
    if (to === 'resume') {
      Alert.alert('Let this keep running?',
        `${who}${price ? ` — ${price}` : ''}\n\nIt was set to end${ends ? ` on ${ends}` : ''}. Restarting it means they are charged again on that date, as normal.`,
        [{ text: 'Leave It', style: 'cancel' }, { text: 'Keep Running', onPress: go }]);
      return;
    }
    // Ending it TODAY, which is its own confirmation and never a second button
    // on the same dialog. It cannot be undone — Stripe cancels the subscription
    // outright and the only way back is a new checkout at today's price — and
    // it returns nothing, so `END_NOW_TAKES_THE_REST` is the sentence the coach
    // reads before they confirm rather than the one they work out afterwards.
    if (to === 'end_now') {
      Alert.alert('End it today?',
        `${who}${price ? ` — ${price}` : ''}\n\n${END_NOW_TAKES_THE_REST}\n\n${REFUND_IS_FINAL.replace('A refund cannot be taken back.', 'This cannot be taken back either.')}`,
        [{ text: 'Leave It', style: 'cancel' }, { text: 'End It Today', style: 'destructive', onPress: go }]);
      return;
    }
    // The kinder option first, and the immediate one offered from inside it
    // rather than beside it. A coach reaching for "stop" nearly always means
    // the end of the period, and a screen that put the irreversible option next
    // to the reversible one at the same weight would get it tapped by mistake.
    Alert.alert('Stop this subscription?',
      `${who}${price ? ` — ${price}` : ''}\n\nThey keep what they have already paid for${ends ? ` until ${ends}` : ''}, and are not charged again after that. Nothing is refunded, and you can put it back any time before it ends.\n\nIf they have asked to be stopped TODAY, the second option ends it now — which takes the rest of the period off them and still refunds nothing.`,
      [
        { text: 'Leave It', style: 'cancel' },
        { text: 'End It Today', style: 'destructive', onPress: () => switchCancel(s, 'end_now') },
        { text: 'Stop At Period End', style: 'destructive', onPress: go },
      ]);
  };

  /**
   * Give a client their money back, from here, for one sale.
   *
   * ── Why this exists now and did not before ─────────────────────────────
   *
   * The note under this list used to say refunds were "deliberately absent"
   * because a half-working refund button is worse than no refund button. That
   * was right about half-working and wrong about the cost: it left the coach's
   * worst customer moment — somebody asking for their money back — answered by
   * a sentence telling them to find a laptop and log into a dashboard belonging
   * to a company their client has never heard of.
   *
   * What makes it whole rather than half:
   *
   *   · The refund is made IN THE SALE'S OWN STRIPE ACCOUNT, read off the row
   *     rather than from the coach's current charge model — see
   *     supabase/functions/connect-refund. A coach who has moved to direct
   *     charges still has older sales on the platform, and refunding those in
   *     the wrong context is a "No such charge" from Stripe.
   *   · Stripe is called FIRST and the row is written from its answer, never
   *     optimistically.
   *   · Repple's share comes back in proportion, and Stripe's own processing
   *     fee usually does not — `REFUND_FEES_NOTE` says so before the tap,
   *     because a coach who reads "fully refunded" and expects to be square
   *     finds a shortfall later with nothing to attribute it to.
   *
   * ── The partial amount, which was the deliberate limit until now ───────
   *
   * This said "whole only, for now", and the reason it gave was right: a typed
   * amount can credit somebody's card by a figure they did not choose. The
   * field it asked for is below, and these are the four things that make it
   * safe rather than merely present.
   *
   *   · THE BOX IS SHAPED BY THE CURRENCY. `currencyDecimals` in coachMoney.ts
   *     answers how many decimal places this money has, and there is no default
   *     — a "12.50" box in front of a yen sale is the wrong box, and a dinar
   *     has three places rather than two. The keyboard follows it, so a
   *     zero-decimal currency raises a pad with no point on it at all.
   *   · NOTHING IS ROUNDED AND NOTHING IS CLAMPED. `readMinorAmount` converts
   *     the DIGITS rather than multiplying a float, and `refundAmountBlocker`
   *     refuses an amount over the ceiling instead of quietly refunding the
   *     ceiling — a coach who types 500 on a 480 sale has made a mistake, and
   *     silently giving back 480 hands them a figure to reconcile that was
   *     never theirs.
   *   · THE CEILING IS WHAT IS LEFT, NOT THE PRICE. `refundableCents` takes off
   *     what has already gone, so a second partial refund is bounded by the
   *     remainder. That remainder is the running total the SERVER wrote from
   *     Stripe's own answer, never a figure this screen predicted.
   *   · THE CONFIRM STATES THE EXACT AMOUNT AND ITS CURRENCY, through
   *     `minorMoney`, which is the one formatter in this codebase and the only
   *     thing that knows how many places to print.
   */
  /* ── discount codes ──────────────────────────────────────────────────────
     Held at Stripe, on the coach's own connected account, and nowhere else —
     Stripe already keeps the code, the percentage, the expiry, the limit AND
     the redemption count, and a mirror here would be a second copy of a system
     this app does not control. src/lib/packagePromo.ts carries the argument,
     and the one restriction worth knowing about: a code can only be attached to
     any package that RENEWS, whatever the price and whatever the percentage,
     because Repple's cut there is a percentage and comes down with the price by
     itself. On a ONE-OFF it is an absolute figure Stripe wants in the same call
     in which it works the discount out, so it has to be taken off a total this
     app computed — and `promoBlocker` allows one only where that total needed
     no rounding to reach, since Stripe documents no rounding rule for a
     percentage discount anywhere. 30% off a £100.00 pack is exact; 20% off a
     £49.99 one is 999.8 minor units and is refused, with the percentages that
     do divide that price named in the refusal.
     The client now types the code in the app rather than on Stripe's own
     payment page, which is what makes the restriction to ONE package
     enforceable at all: Stripe holds that restriction as metadata it does not
     act on. `PROMO_IS_TYPED_AT_CHECKOUT` is the sentence the coach is given to
     pass on. */

  /**
   * The packages a code may be attached to, in the shape the rule reads.
   *
   * Every active one now, not just the recurring ones. A one-off takes a code
   * where the discount lands on a whole number of minor units — see
   * `oneOffDiscount` in src/lib/packagePromo.ts — and `promoBlocker` is what
   * decides, per package AND per percentage, naming the price when the answer
   * is no. Filtering one-offs out of this list would put the coach back where
   * they started: an option that is simply absent, with nowhere to read why.
   *
   * The PRICE travels with the target, because on a one-off it is half the
   * question. `pkgMoney` is not involved — this is the raw minor-unit figure
   * the arithmetic runs on.
   */
  const promoTargets: PromoTarget[] = activePkgs
    .map((p) => ({ id: p.id, name: p.name, billingInterval: p.billing_interval, active: p.active, priceCents: p.price_cents }));

  const promoTarget = promoTargets.find((p) => p.id === promoPkg) ?? null;
  const promoProblems = promoBlocker(promoCode, Math.trunc(Number(promoPct)), promoTarget);

  const addPromo = async () => {
    if (promoProblems.length) { Alert.alert('Not yet', promoProblems.join('\n\n')); return; }
    setPromoBusy(true);
    const r = await createPromoCode({
      code: normaliseCode(promoCode),
      percentOff: Math.trunc(Number(promoPct)),
      packageId: promoTarget!.id,
    });
    setPromoBusy(false);
    if (!r.ok) { Alert.alert('That code was not created', r.error || 'Nothing was created.'); return; }
    setPromoCode(''); setPromoPct(''); setPromoPkg(null);
    load();
    Alert.alert('Code created', `${r.promo?.code ?? 'It'} is live. ${PROMO_IS_TYPED_AT_CHECKOUT}`);
  };

  const withdrawPromo = (p: PromoCode) => {
    Alert.alert(
      `Withdraw ${p.code}?`,
      // WHICH PACKAGE. A coach running "NEWYEAR 50% off" on a £300 programme
      // and "SUMMER 10% off" on a £60 pack was shown a code, a percentage and
      // nothing else — here and in the list — so withdrawing the wrong one
      // leaves the expensive offer live and stops the cheap one, and nothing
      // on the confirmation could have told them apart. `packageId` has been
      // on `PromoCode` since the feature was written and no screen read it.
      `${promoPkgLine(p) ?? 'Which package this applies to could not be read, so check it at Stripe before withdrawing.'}\n\n${PROMO_WITHDRAW_IS_FORWARD_ONLY}\n\n${promoUseLine(p)}`,
      [
        { text: 'Leave It', style: 'cancel' },
        {
          text: 'Withdraw It',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setPromoBusy(true);
              const r = await archivePromoCode(p.id);
              setPromoBusy(false);
              // `ok: false` means it is STILL LIVE, and a screen that redrew it
              // as withdrawn would leave a coach handing out an offer they
              // believe they have stopped.
              if (!r.ok) Alert.alert('Still live', r.error || 'It was not withdrawn, so it still works.');
              load();
            })();
          },
        },
      ],
    );
  };

  /**
   * What has already gone back on one sale, or null because none has.
   *
   * Never a bare figure: the amount goes through `minorMoney`, which returns
   * null rather than a number when the currency is missing — a sale whose
   * package was deleted before part 132 has no unit, and "200 refunded" with no
   * currency beside it is not an amount of money.
   */
  const refundedLine = (target: RefundTarget): string | null => {
    const r = target.rule;
    if (!isPartlyRefunded(r) && !isFullyRefunded(r)) return null;
    const back = minorMoney(r.refundedCents, target.rule.currency);
    if (isFullyRefunded(r)) {
      return back ? `Refunded in full — ${back} went back` : 'Refunded in full';
    }
    const left = minorMoney(refundableCents(r), target.rule.currency);
    return back && left ? `${back} refunded, ${left} of it still stands` : 'Partly refunded';
  };

  const openRefund = (target: RefundTarget) => {
    // The reason, never a dead control. The screen's copy of the rule is a
    // convenience; connect-refund runs the same one from the same module, so
    // the two cannot say different things.
    const blocked = refundBlocker(target.rule);
    if (blocked) { Alert.alert('Nothing to refund', blocked); return; }
    setRefunding(target);
    setRefundWhole(true);
    setRefundAmt('');
  };

  /**
   * Send it. `cents` is undefined for the whole of what is LEFT — which the
   * edge function resolves from the row itself rather than from anything this
   * screen believes, so a stale figure here cannot become a refund.
   *
   * The two calls differ in one word and in nothing else. Both land on
   * supabase/functions/connect-refund, which reads the row from the table
   * `kind` names, runs `refundBlocker` again on what it finds, and issues the
   * refund in THAT charge's own Stripe account.
   */
  const sendRefund = async (target: RefundTarget, cents?: number) => {
    const who = target.who || 'this client';
    const thing = target.kind === 'renewal' ? 'renewal' : 'sale';
    setRefundBusy(target.id);
    const r = target.kind === 'renewal'
      ? await refundRenewal(target.id, cents)
      : await refundPurchase(target.id, cents);
    setRefundBusy(null);
    if (!r.ok) {
      // Two failures, and they are opposites. A REFUSAL happened before Stripe
      // was asked, or is Stripe's own rejection, and for those "nothing has
      // changed" is true and is the reassurance the coach needs. An
      // UNCONFIRMED call reached the network and lost the answer, so the money
      // may already be gone — and this branch used to append the reassurance
      // to that one too, under the title "No refund was made", flatly
      // contradicting the sentence `callRefund` had just written. A coach who
      // reads "they have not been refunded" refunds again, and the client is
      // credited twice out of the coach's own Stripe balance.
      if (r.unconfirmed) {
        Alert.alert('This refund could not be confirmed',
          (r.error || 'The refund was not confirmed.')
          + `\n\nDo NOT send it again from here until you have looked. Your Stripe dashboard is the record of whether the money moved, and this ${thing} still shows the amount it showed before.`);
      } else {
        Alert.alert('No refund was made', (r.error || 'Nothing has been given back.') + '\n\nThey have not been refunded and nothing on your side has changed.');
      }
      load();
      return;
    }
    // The narrow, loud middle state: the money went back and this app could
    // not write it down. Saying "it failed" would be false and the coach's
    // next act would be to refund it a second time.
    if (r.mirrored === false) {
      Alert.alert('Refunded, and not recorded here',
        `The money has gone back to them. This app could not write the refund onto the ${thing}, so the figures on this screen are still showing the full amount. Do NOT refund it again — check your Stripe dashboard, which is the record of what actually moved.`);
    } else {
      // Stripe's own figure, not the one asked for. They are the same today,
      // and a screen that echoed the request back would be reporting an
      // intention as a fact about somebody's card.
      Alert.alert('Refunded', `${minorMoney(r.refundedCents ?? 0, r.currency ?? target.rule.currency) ?? 'The amount'} has gone back to ${who}. Stripe emails them a receipt for it; anything else you want to say is yours to say.`);
    }
    load();
  };

  /**
   * The last thing between a typed figure and somebody's card.
   *
   * `amountLabel` is the exact amount, formatted with its currency by
   * `minorMoney` — never the raw string the coach typed, because the point of
   * showing it back is that they read the figure this app has actually
   * understood.
   */
  const confirmRefund = (target: RefundTarget, cents: number | undefined, amountLabel: string | null, part: boolean) => {
    const who = target.who || 'this client';
    const money = minorMoney(target.rule.amountCents, target.rule.currency);
    const line = amountLabel
      ? refundConfirmLine(amountLabel, who, part)
      : `What is left on this ${target.kind === 'renewal' ? 'renewal' : 'sale'} would go back to the card they paid with.`;
    // Whose balance it leaves, read off THIS CHARGE rather than off the coach's
    // current setting: a coach who has moved to direct charges still has older
    // sales and older renewals on the platform, and the two sentences are not
    // interchangeable.
    //
    // ── The third state, which this used to spend ────────────────────────
    //
    // It was `accountForObject(…) ? 'direct' : 'destination'`, so an absent
    // account was read as a destination charge and the coach was told, in the
    // confirm, that "the refund leaves Repple's balance and your next payout is
    // smaller by that amount". For a row written before part 161 that is true.
    // For a STANDARD-account coach whose row simply carries no account — the
    // column is nullable and nothing backfills it — it is the opposite of what
    // happens: Stripe debits THEIR balance, and if it is short it comes out of
    // their bank. Told the other sentence, they budget for a payout that is
    // about to be short by the whole amount rather than by nothing.
    //
    // So an absent account is only read as the platform where the coach's own
    // account is one that could only ever have charged that way. A legacy
    // Express account sells under destination charges and nothing else, so a
    // platform charge on one is certain. On a standard account, or where Stripe
    // has not said what the account is, NOTHING is said — which is
    // `refundBalanceNote`'s own null branch, the rule the rest of this screen
    // already keeps for a null `account_type`, and the honest answer.
    const onAccount = accountForObject({ stripe_account_id: target.account });
    const balance = refundBalanceNote(
      onAccount ? 'direct' : accountTypeOf(conn) === 'express' ? 'destination' : null,
    );
    Alert.alert(
      'Give this money back?',
      `${who}${money ? ` — ${money} was charged` : ''}\n\n${line}\n\n${REFUND_DOES_NOT}\n\n${REFUND_FEES_NOTE}${balance ? `\n\n${balance}` : ''}\n\n${REFUND_IS_FINAL}`,
      [
        { text: 'Leave It', style: 'cancel' },
        { text: 'Refund It', style: 'destructive', onPress: () => { setRefunding(null); void sendRefund(target, cents); } },
      ],
    );
  };

  // ── the credit a refund does not give back ───────────────────────────────
  //
  // `REFUND_DOES_NOT` has told the coach for months that a refund "does not put
  // a session credit back on a pack", and there was nowhere in the product to
  // act on it. This is that act, and it is deliberately NOT wired into the
  // refund: the two are separate decisions, and a coach may want either one
  // without the other.
  //
  // One row at a time, keyed by purchase id, so two taps on two clients cannot
  // both claim the spinner and so a slow write on one row does not grey out the
  // rest of the list.
  const [creditBusy, setCreditBusy] = useState<string | null>(null);

  /**
   * Ask first, then move it, then say what the DATABASE said happened.
   *
   * The reported balance is the one that came back from the write and never one
   * computed here — `adjustPackCredit` refuses to call anything a success that
   * did not come back as exactly one row naming a known outcome, because
   * PostgREST answers an UPDATE matching zero rows with no error at all. A
   * credit the coach believes was returned and was not is one the client has
   * paid for twice.
   */
  const moveCredit = async (b: CoachPurchase, delta: 1 | -1) => {
    if (creditBusy) return;
    setCreditBusy(b.id);
    const r = await adjustPackCredit(b.id, delta);
    setCreditBusy(null);
    if (!r.ok) {
      const why = drawReason({ outcome: r.outcome, remaining: r.remaining, purchaseId: b.id, total: null });
      Alert.alert(
        'Nothing was changed',
        (why ? `That credit did not move — ${why}.` : 'That credit did not move.')
        + '\n\nTheir balance is exactly what it was. Nothing has been refunded and nothing has been charged.',
      );
      load();
      return;
    }
    Alert.alert(
      delta === 1 ? 'Credit given back' : 'Credit taken off',
      `${b.client_name || 'They'} now ${r.remaining == null ? 'have a different balance on that pack' : `${r.remaining === 1 ? 'has' : 'have'} ${r.remaining} left on that pack`}. Nobody has been told — their own screen is where they will see it, and no money has moved either way.`,
    );
    load();
  };

  /** The last thing between a tap and somebody's balance. Both directions get
   *  one, because both change what a client can book and neither is undone by
   *  tapping the other — a credit given back and then taken off again is two
   *  writes on somebody's account, not a toggle. */
  const confirmCredit = (b: CoachPurchase, delta: 1 | -1) => {
    const who = b.client_name || 'this client';
    Alert.alert(
      delta === 1 ? 'Give a session credit back?' : 'Take a session credit off?',
      delta === 1
        ? `One credit goes back onto ${who}’s pack, so they can book one more session against it.\n\nNO MONEY MOVES. This is only the balance on their pack — if you also mean to give money back, refund the sale separately.\n\nThey are not told; their own screen is where they will see it.`
        : `One credit comes off ${who}’s pack, so they can book one fewer session against it.\n\nNO MONEY MOVES, and nothing is charged. Use this where a session was delivered and never marked.\n\nThey are not told; their own screen is where they will see it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: delta === 1 ? 'Give it back' : 'Take it off', onPress: () => { void moveCredit(b, delta); } },
      ],
    );
  };

  // ── changing a package that is already on sale ───────────────────────────
  //
  // There was no way to do this. `createPackage` and `deactivatePackage` were
  // the whole of it, so a coach raising their rate withdrew the old package and
  // created a new one — orphaning the price history and leaving existing
  // subscribers pointing at something their coach considers gone.
  //
  // Only the name and the price. Currency, sessions and billing_interval are
  // not editable and src/lib/packageEdit.ts holds the argument for each; the
  // short version is that a package's currency is a lookup older
  // `client_purchases` rows still fall back to, and the other two are what the
  // product IS rather than what it costs.
  //
  // `subCount` is read when the sheet opens, not when Save is pressed, because
  // it is the sentence the coach needs BEFORE they decide. Null is its own
  // answer and is rendered as one: "nobody is on the old rate" is a fact about
  // this coach's income and must come from a read that answered.
  const [editing, setEditing] = useState<TrainerPackage | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [subCount, setSubCount] = useState<number | null>(null);

  /* Whose answer is allowed to land.
   *
   * `void countActiveSubscribers(p.id).then(setSubCount)` had no request
   * identity on it, and these reads do not come back in the order they went
   * out. Open package A's sheet, close it, open B: A's answer arrives second
   * and sets the count for B. `repriceNote(0)` then states "Nobody is currently
   * subscribed at the old price" over a package with five subscribers on it —
   * in the one warning on this screen that exists to be read BEFORE a coach
   * changes what people are charged, and whose whole point (see the header of
   * src/lib/packageEdit.ts) is that a reprice must never happen quietly.
   *
   * Same idiom as `wanted` in src/ui/clientAttendance.ts and
   * app/(trainer)/class-checkin.tsx. Dropping the stale answer is the whole of
   * it: `subCount` stays null, and null is already its own sentence — "whether
   * anybody is subscribed at the old price could not be read" — which is the
   * honest thing to say about a package nothing has answered for yet. */
  const wantedPkg = useRef<string | null>(null);

  const openEdit = (p: TrainerPackage) => {
    // Set before the read starts, so an answer for the previously opened
    // package that is still in flight fails its check on arrival.
    wantedPkg.current = p.id;
    setEditing(p);
    setEditName(p.name);
    // Shown in MAJOR units, which is what the coach thinks in and what the Add
    // form above already takes. The conversion happens once, on save.
    //
    // Divided by the currency's OWN factor, not by a hundred. Reading a KWD
    // price back as `price_cents / 100` showed the coach ten times what they
    // had set, which they would then correct — writing the error in properly.
    //
    // And it is THIS PACKAGE'S currency, not the gym's. `currency` above is
    // `tenants.currency`, which is nullable on purpose (part 99) and is NULL
    // for most live tenants: `majorFromMinor` answers '' for a currency it was
    // not told, so the box opened EMPTY on a package that has a perfectly good
    // price, and `readMinorAmount` then refused to save whatever was typed into
    // it. A coach could not correct a price on a gym that had never set a
    // currency. It is also wrong the other way round, and worse: a coach
    // selling in sterling inside a gym denominated in dirhams had their
    // sterling price read back through the dirham's decimal places, which is
    // the same figure and a different amount of money. The package's own
    // currency is the one it is charged in and it is the only one that can
    // interpret its own price — which is exactly why `packageEdit.ts` refuses
    // to let the currency itself be edited.
    setEditPrice(majorFromMinor(p.price_cents, p.currency));
    setEditErr(null);
    setSubCount(null);
    void countActiveSubscribers(p.id).then(
      (n) => { if (wantedPkg.current === p.id) setSubCount(n); },
      // `countActiveSubscribers` answers null rather than throwing on every
      // failure it knows about, but a rejection here would otherwise be an
      // unhandled one and the sheet would sit on null with nothing logged.
      (e) => { if (wantedPkg.current === p.id) setSubCount(null); reportError('payments.subCount', e); },
    );
  };

  /** The patch as typed, or null when the price box does not hold a number.
   *  Separate from the blocker so the sheet can disable Save before the coach
   *  presses it rather than refusing afterwards. */
  const editPatch = (): { name?: string; price_cents?: number } | null => {
    if (!editing) return null;
    const typed = Number(editPrice.replace(/,/g, '').trim());
    if (!Number.isFinite(typed)) return null;
    // Rounded to whole minor units here and NOWHERE else. `Math.round` on a
    // major-unit figure is the only rounding in this path, and packageEdit
    // refuses a fractional minor unit rather than rounding a second time — two
    // roundings on one price is how 74.995 becomes a number nobody typed.
    //
    // Read back through the PACKAGE's own currency, matching `openEdit` above.
    // The reader and the writer have to agree about how many decimal places
    // this price has, and the gym's currency is not the one it is charged in.
    const readEdit = readMinorAmount(editPrice, editing.currency);
    if (!readEdit.ok) return null;
    const cents = readEdit.minorUnits;
    const patch: { name?: string; price_cents?: number } = {};
    if (editName.trim() !== editing.name) patch.name = editName;
    if (cents !== editing.price_cents) patch.price_cents = cents;
    return patch;
  };

  const saveEdit = async () => {
    if (!editing || editBusy) return;
    const patch = editPatch();
    if (!patch) { setEditErr('That price is not a number.'); return; }
    const blocker = packageEditBlocker(patch);
    if (blocker) { setEditErr(blocker); return; }
    setEditBusy(true); setEditErr(null);
    const res = await updatePackage(editing.id, patch);
    setEditBusy(false);
    if (!res.ok) { setEditErr(res.error ?? 'That package was not changed.'); return; }
    setEditing(null);
    load();
  };

  const remove = (id: string) => Alert.alert('Remove package?', 'Clients will no longer see it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
    // deactivatePackage used to return void and swallow the error, so this
    // refreshed and said nothing — a package the trainer believes is withdrawn
    // stays on sale until a client buys it.
    const ok = await deactivatePackage(id);
    if (!ok) { Alert.alert('Not removed', 'That package is still on sale — the change did not save. Try again in a moment.'); return; }
    load();
  } }]);

  /**
   * Whether this coach can be paid — and, separately, whether we know.
   *
   * Was `const active = conn?.charges_enabled;`, and everything below branched
   * on `!active`. That is true of a live account whose read failed, and of one
   * that has not been read yet, so a coach in a lift was shown "Set Up Payouts"
   * with a button under it that starts a SECOND Stripe onboarding — a duplicate
   * account, with their passport and their bank details in it, that nobody can
   * pay them through. src/lib/payoutAccount.ts keeps the five states apart.
   */
  const stage = payoutStage(conn, connRead);
  const active = stage === 'active';

  /**
   * Whose money this is, in one word, read off Stripe rather than assumed.
   *
   * Two arrangements exist and they say opposite things to a coach. On a
   * STANDARD account — what a coach onboarded from part 161 onward gets — the
   * coach is the merchant of record: Stripe's processing fee comes out of their
   * balance rather than Repple's, a refund or a chargeback is debited from
   * their balance, and their dashboard is the full one at dashboard.stripe.com.
   * On the legacy EXPRESS accounts everyone onboarded before that has, Repple
   * is the merchant of record and the dashboard is the Express one.
   *
   * `null` is the third state and it is not a shrug: it means nobody has asked
   * Stripe what this account is yet. This screen then says NOTHING about fees,
   * chargebacks or dashboards, for the same reason it prints no balance and no
   * payout — a sentence about somebody's money that might be about the other
   * arrangement is worse than no sentence.
   */
  const kind = accountTypeOf(conn);
  const G = layout.gutter;
  const input = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  /** One row of mutually exclusive choices, drawn from the same tokens as the
   *  inputs beside it. Local rather than in the kit because it is one form. */
  const Pick = ({ label, options, chosen, onPick }: {
    label: string; options: { key: string | null; label: string }[]; chosen: string | null; onPick: (k: any) => void;
  }) => (
    <View>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: sp.xs, flexWrap: 'wrap' }}>
        {options.map((o) => {
          const on = o.key === chosen;
          return (
            <Pressable key={o.label} onPress={() => onPick(o.key)} accessibilityRole="button"
              accessibilityState={{ selected: on }} accessibilityLabel={label + ': ' + o.label}
              style={{
                paddingHorizontal: sp.md, paddingVertical: 9, borderRadius: radius.pill,
                backgroundColor: on ? t.brand : t.surface2,
              }}>
              <Text style={{ ...ty.caption, fontWeight: '600', color: on ? t.bg : t.ink2 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  // Three buckets, not two. `subs.filter(isLive)` answered true for three
  // status words and false for every other one — so a subscription in a state
  // this app has no sentence for (`paused`, `incomplete`, or whatever Stripe
  // adds next) did not render as unknown, it rendered as NOTHING, and a coach
  // with one paused subscriber read "Nobody is subscribed yet" off a screen
  // that was holding the row. `subState` files those as 'unsettled' and they
  // are listed below, separately, with Stripe's own word quoted back.
  //
  // They are NOT in `liveSubs`, so nothing about the count or the priced-to-
  // recur figure changes: neither of those may include a subscription that is
  // not charging.
  const liveSubs = subs.filter((s) => subState(s.status) === 'live');
  const unsettledSubs = subs.filter((s) => subState(s.status) === 'unsettled');

  // ── the money figures ─────────────────────────────────────────────────────
  // Only a WHOLE read may be summed. 'partial' is refused alongside 'error' on
  // purpose, and it is the more dangerous of the two: a subtotal of somebody's
  // sales printed as a month's takings is a plausible number with nothing about
  // it to doubt, where an error at least looks like one.
  const buysWhole = buysStatus === 'ready';
  const paid = buys.filter((b) => b.status === 'paid');

  // A renewal, as a row that can be added up. `paid_at` is the date, not
  // `created_at`: Stripe says when the money moved, and a webhook retried three
  // days late must not push somebody's payment into the wrong month. A payment
  // Stripe gave no date for passes a string that will not parse, which keeps it
  // out of every month rather than sweeping it into this one — it is still in
  // the all-time figure, because the money is not in doubt, only its date.
  const renewals: TakenRow[] = pays.map((p) => ({ amount_cents: p.amount_cents, currency: p.currency, created_at: p.paid_at ?? '' }));
  const undated = renewals.filter((r) => !Number.isFinite(Date.parse(r.created_at))).length;

  // Both halves or nothing. The earnings figure is the two reads added
  // together, so it is only as complete as the worse of them: a coach whose
  // renewals could not be read must not be shown their one-off sales under the
  // heading of what they have earned. `worstStatus` is the same rule every
  // multi-read screen in the app uses.
  const earnedStatus = worstStatus(buysStatus, paysStatus);
  const earnedWhole = earnedStatus === 'ready';
  const mStart = monthStart();
  const oneOffAll = earnedWhole ? sumTaken(paid) : null;
  const renewAll = earnedWhole ? sumTaken(renewals) : null;
  const takenAll = oneOffAll && renewAll ? combineTaken(oneOffAll, renewAll) : null;
  const oneOffMonth = earnedWhole ? sumTaken(since(paid, mStart)) : null;
  const renewMonth = earnedWhole ? sumTaken(since(renewals, mStart)) : null;
  const takenMonth = oneOffMonth && renewMonth ? combineTaken(oneOffMonth, renewMonth) : null;

  // ── the one figure in here that came from a PREDICTION ────────────────────
  //
  // A discount code on a one-off is the only place this app names a number
  // Stripe has not confirmed first: Repple's cut there is an absolute
  // `application_fee_amount` that Stripe wants as an input to the same call
  // whose output is `amount_total`, so it has to come off a total
  // connect-checkout worked out beforehand. The webhook then compares that with
  // what Stripe actually charged and records the difference (part 311).
  //
  // Counted off the SALES rather than off a status, and shown whenever there is
  // one, because the failure it catches is systematic: if the arithmetic is
  // wrong it is wrong on every sale of that package, and the only thing between
  // a coach and a year of being short by a penny a time is somebody looking at
  // this. Under 'error' there are no rows to count and nothing is claimed —
  // which is the house rule, and here it means "we could not check", never
  // "everything reconciles".
  // `buysWhole`, not `buysStatus !== 'error'`. This is a COUNT and a SUM over
  // `buys`, and under 'partial' that is a count over a prefix — "4 sales had
  // Repple's share worked out wrongly" when there are eleven. It renders today
  // only inside the `earnedStatus === 'ready'` arm, so nothing is wrong on the
  // screen; the gate is here rather than left to that arm because a moved JSX
  // block is all it takes, and `check:whole` cannot see a `=== 'error'`
  // ternary. Under 'partial' nothing is claimed, which is the house rule:
  // "we could not check" is never "everything reconciles".
  const feeGaps = buysWhole ? feeMismatches(buys) : null;

  // A standing price, not a takings. Renewals ARE now recorded as money and are
  // in the figures above; this is a different statement — what the live
  // subscriptions are set to charge NEXT, at today's prices, if nobody cancels.
  const recurring = subsStatus === 'ready' ? sumRecurring(liveSubs) : null;
  // The packs a coach has to know about: sold, and how much of each is left.
  // Listable under 'partial' (the rows are real); not countable.
  //
  // PAID, and that guard was missing. `client_purchases` carries a row from the
  // moment a Checkout Session is created, and `status` is what says whether the
  // money arrived — `paid` above filters on it for every takings figure on this
  // screen, and `isLivePack` in src/lib/packDraw.ts filters on it for the
  // client's own balance. This list did not, so an abandoned checkout — a
  // client who opened the payment page and closed it — appeared here as a pack
  // sold, with a full balance of credits on it, in a list a coach reads to find
  // out who has sessions left. Every figure derived from it was wrong the same
  // way: `stranded` counted credits nobody bought, and `runOut` told the coach
  // to go and sell to somebody who had never paid in the first place.
  const packs = buys.filter((b) => b.status === 'paid' && b.sessions_total != null);
  // Used up and RAN OUT OF TIME are the same two numbers by the time part 612's
  // nightly pass has been over a pack — it reduces `sessions_total` to
  // `sessions_used` so that every draw site in the database stops at it — and
  // they are opposite sentences about somebody's money. `expired_at` is what
  // tells them apart, and it is the fact rather than a date comparison run
  // here: until that pass has written it the credits are genuinely spendable.
  // Fixed for the render. Every expiry sentence below is about a day rather
  // than an instant, and a bound recomputed per row would let two lines on the
  // same screen disagree about what today is across a midnight.
  // `useToday()`, not `isoToday(new Date())`. This screen is registered
  // `href: null` in app/(trainer)/_layout.tsx, so it mounts once and is never
  // torn down, and this day is the second argument to every expiry judgement
  // below — `packWindow`, `expiryLine`, `strandedNote`, `daysLeftOn`. A bare
  // read here is only as fresh as the last render, and a screen nobody has
  // touched does not render: a pack whose last day was yesterday would go on
  // reading as live. Same failure as the one `check:frozen-day` was written
  // for on app/(trainer)/credentials.tsx, one dependency array away from where
  // that gate can see it. `useToday` re-reads at local midnight and on
  // foreground and compares before it sets, so an open screen costs nothing.
  const todayKey = useToday();
  // Cases that are still open, which is what the count beside the heading is
  // about. A closed one stays in the list — a coach looking for the money that
  // went missing last month has to be able to find it — but it is not a thing
  // to do, and counting it as one would put a permanent number on a heading
  // nobody can clear.
  const liveDisputes = disputes.filter((d) => !isClosed(d.status, d.closed_at));
  const expiredPacks = packs.filter((b) => !!b.expired_at);
  // Sessions somebody paid for and can no longer book. Not a total to be netted
  // off anything — it is a list of conversations.
  const stranded = expiredPacks.reduce((a, b) => a + Math.max(0, Number(b.sessions_expired ?? 0)), 0);
  const runOut = packs.filter((b) => !b.expired_at && packRunOut(b));
  // Used-up packs first. They are the only rows on this screen a coach has to
  // DO something about — the next session that client books is not covered by
  // anything they have paid for — and a coach with thirty packs sold was being
  // asked to find them by scanning a list ordered by purchase date. The order
  // within each group is unchanged (newest first, as fetchClientPurchases
  // returns them), so nothing else about the list moves.
  const packsShown = [...packs].sort((a, b) => Number(packRunOut(b)) - Number(packRunOut(a)));

  /** A row of money pots, one per currency. Never one figure: AED 600 and
   *  GBP 90 do not add to 690 of anything, and a white-label product sees both
   *  on the same coach's book the first time a visitor buys a session. */
  const Pots = ({ label, pots }: { label: string; pots: Pot[] }) => (
    <View style={{ flex: 1 }}>
      <Text style={{ ...ty.caption, color: t.ink3 }}>{label}</Text>
      {pots.length === 0 ? (
        <Text style={{ ...value(22), color: t.ink, marginTop: 4 }}>{fig(null)}</Text>
      ) : pots.map((p) => (
        <View key={p.currency} style={{ marginTop: 4 }}>
          <Text style={{ ...value(22), color: t.ink }}>{fig(minorMoney(p.minorUnits, p.currency))}</Text>
          {/* "payments", not "sales": a pot now holds one-off purchases and
              subscription renewals together, and a renewal is not a sale. */}
          <Text style={{ ...ty.caption, color: t.ink3 }}>{p.count === 1 ? 'from 1 payment' : 'from ' + p.count + ' payments'}</Text>
        </View>
      ))}
    </View>
  );

  /** Several currencies on one line — "AED 1,000.00 · GBP 90.00" — for the
   *  breakdown under the totals, where each half is a supporting figure rather
   *  than the headline. A pot whose amount will not print is left out entirely
   *  rather than dashed: it cannot happen (a pot exists only because an amount
   *  and a currency were both there), and a dash mid-list would read as a
   *  currency whose figure is missing. */
  const potLine = (pots: Pot[]): string | null =>
    pots.map((p) => minorMoney(p.minorUnits, p.currency)).filter(Boolean).join(' · ') || null;

  /** One half of the takings — what recurred, and what did not. Printed under
   *  the totals because "how much of this repeats next month" is the question a
   *  membership business actually runs on, and it is not answerable from a
   *  single combined figure. */
  const Made = ({ label, taken }: { label: string; taken: { pots: Pot[] } }) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md, marginTop: 4 }}>
      <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{label}</Text>
      <Text style={{ ...ty.caption, color: t.ink2, fontWeight: '500' }}>{fig(potLine(taken.pots))}</Text>
    </View>
  );
  // The typed price read back in the gym's currency, or null when either half
  // is missing. Never a number with a unit put on it for the look of the thing.
  //
  // The same reader `addPkg` uses, on the same string, with nothing in front of
  // it — so the price echoed under the box is exactly the price the button is
  // about to charge. It used to go through `readNumber` first, and so did
  // `addPkg`, which meant the two AGREED about a wrong figure: a coach typing
  // 1,234.50 was shown "GBP 1.23" under the box and the package was created at
  // 123 pence, and nothing on the screen contradicted it. `readMinorAmount`
  // refuses the ambiguous separator rather than picking a reading of it, so the
  // echo now goes blank and the button says why.
  const echoRead = currency ? readMinorAmount(price, currency) : null;
  const priceEcho = echoRead?.ok && echoRead.minorUnits > 0 ? pkgMoney(echoRead.minorUnits, currency) : null;

  // ── the refund sheet's own arithmetic ──────────────────────────────────────
  //
  // The ceiling is what is LEFT on the sale, never the price it was sold at.
  // `refunded_cents` on the row is the running total the edge function wrote
  // from Stripe's own answers, so a second partial refund is bounded by what
  // actually remains rather than by the original charge.
  const refundLeft = refunding ? refundableCents(refunding.rule) : 0;
  const refundLeftMoney = refunding ? minorMoney(refundLeft, refunding.rule.currency) : null;
  // How many decimal places this money has. Null is impossible in the sheet —
  // `refundBlocker` refuses a sale with no currency before it can open — and is
  // handled rather than asserted, because a currency is not a thing to assume.
  const refundDp = refunding ? currencyDecimals(refunding.rule.currency) : null;
  const refundTyped = refundAmt.trim();
  const refundRead = refunding && !refundWhole && refundTyped ? readMinorAmount(refundTyped, refunding.rule.currency) : null;
  const refundCents = refundRead && refundRead.ok ? refundRead.minorUnits : null;
  // Two refusals in order: what was typed is not an amount, then the amount is
  // more than is left. Never a clamp — see refundAmountBlocker.
  const refundProblem = refundRead && !refundRead.ok
    ? refundRead.reason
    : refundCents == null ? null : refundAmountBlocker(refundCents, refundLeft);
  // The figure that would actually leave, read back in its own currency. This
  // is what the confirm states, so what the coach checks is what is sent.
  const refundMoney = refunding && refundCents != null && !refundProblem ? minorMoney(refundCents, refunding.rule.currency) : null;
  const refundReady = !!refunding && (refundWhole || (refundCents != null && !refundProblem));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Getting paid</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Payments</Text>
          </View>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Get paid by your clients — memberships &amp; session packs.
        </Text>

        {loading ? <ActivityIndicator color={t.brand} style={{ marginVertical: 30 }} accessible accessibilityRole="progressbar" accessibilityLabel="Reading how you get paid…" /> : (
          <>
            {/* ── payout status: the one decision on this screen ──────────── */}
            {/* Three renders, not two. The middle one is new: a read that did
                not come back is not a coach without an account, and the button
                is what makes the difference matter — `onboard` opens Stripe and
                a second onboarding under the same coach is a second live
                account. `canOnboard` is the gate and it is false here on
                purpose; the only control offered is the one that asks again. */}
            {stage === 'unreadable' ? (
              <View style={{ marginTop: sp.xl }}>
                <Notice tone={t.crit} kicker="Payouts" title="Could not read your payout account"
                  note="This is not a statement that you have none — if you had set one up it is still set up, and any client payment already on its way is unaffected. Nothing about setting one up is offered here until we can see what you already have.">
                  <View style={{ marginTop: sp.lg }}>
                    <Cta label={loading ? 'Checking…' : 'Try Again'} wide disabled={loading} onPress={() => { void load(); }} />
                  </View>
                </Notice>
              </View>
            ) : !active ? (
              <View style={{ marginTop: sp.xl }}>
                {/* The arrangement is added to the NOTE rather than dropped in
                    as a second Text, because the kit reads kicker, title and
                    note out as one statement and a stray line beside them is
                    skipped by a screen reader. It is only added once Stripe has
                    said what the account is — see `kind`. */}
                <Notice tone={t.warn} kicker="Payouts" title={stage === 'started' ? 'Finish Setting Up Payouts' : 'Set Up Payouts'}
                  note={stage === 'started'
                    ? 'Finish verifying with Stripe to go live.' + (kind === 'standard' ? ' Payments land in your own Stripe account, and its fees, refunds and chargebacks come out of your balance.' : '')
                    : 'Connect a payout account with Stripe.'}>
                  <View style={{ marginTop: sp.lg }}>
                    <Cta label={busy ? 'Opening…' : (stage === 'started' ? 'Continue Setup' : 'Set Up Payouts')} wide disabled={busy || !canOnboard(stage)} onPress={onboard} />
                  </View>
                </Notice>
              </View>
            ) : (
              <Section>
                <SectionHead title="Payouts" />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={17} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Payouts active</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>You can accept client payments.</Text>
                  </View>
                </View>

                {/* The three things that changed when coaches moved onto their
                    own Stripe accounts, and that nothing in this app said until
                    now: whose account Stripe's fee comes out of, whose balance a
                    refund or a chargeback is taken from, and which dashboard is
                    theirs. All three follow from being the merchant of record,
                    and all three are the opposite on the legacy Express
                    accounts — so the sentence is chosen by what Stripe says the
                    account is, and there is no sentence at all when Stripe has
                    not said. */}
                {kind === 'standard' ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    Your clients pay your own Stripe account. Stripe&apos;s processing fee comes out of it,
                    and so does any refund or chargeback — those are yours to answer, not Repple&apos;s.
                    Your payouts, disputes and receipts are in the full Stripe dashboard at dashboard.stripe.com.
                  </Text>
                ) : kind === 'express' ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    Your clients pay Repple, which passes the money on to your Stripe account. Repple is
                    the merchant of record on those sales, so a refund or a chargeback comes out of
                    Repple&apos;s balance. Your payouts are in the Express Dashboard Stripe sends you to.
                  </Text>
                ) : null}
              </Section>
            )}

            <Rule />

            {/* ── what has actually been taken ───────────────────────────── */}
            <Section>
              <SectionHead title="Taken Through Stripe" />
              {earnedStatus === 'error' ? (
                <Flag tone={t.crit}>
                  {buysStatus === 'error' && paysStatus === 'error'
                    ? 'Your sales and your renewals could not be read, so there is no figure here. This is not a statement that nothing has been paid — anything a client has paid, they have paid.'
                    : buysStatus === 'error'
                      ? 'Your one-off sales could not be read, so there is no figure here. Your renewals were read fine, but half of what you have taken is not a total and will not be shown as one.'
                      : 'Your subscription renewals could not be read, so there is no figure here. Your one-off sales were read fine, but half of what you have taken is not a total and will not be shown as one.'}
                </Flag>
              ) : earnedStatus === 'partial' ? (
                <PartialRead what="payments" shown={buys.length + pays.length} onPress={load} />
              ) : takenAll && takenMonth && oneOffAll && renewAll && oneOffMonth && renewMonth ? (<>
                <View style={{ flexDirection: 'row', gap: sp.md }}>
                  <Pots label="This month" pots={takenMonth.pots} />
                  <Pots label="All time" pots={takenAll.pots} />
                </View>

                {/* What the total is made of. A membership business lives on the
                    second line of this, and it cannot be read off the combined
                    figure — two coaches with the same month's takings, one of
                    them all one-off and one of them all recurring, are in
                    completely different positions next month. */}
                <View style={{ marginTop: sp.lg, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 2 }}>This month, made up of</Text>
                  <Made label="One-off sales and packs" taken={oneOffMonth} />
                  <Made label="Subscription renewals" taken={renewMonth} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md, marginBottom: 2 }}>All time, made up of</Text>
                  <Made label="One-off sales and packs" taken={oneOffAll} />
                  <Made label="Subscription renewals" taken={renewAll} />
                </View>

                {/* An amount we cannot put a unit on is missing from the totals
                    above, and saying so is the only thing that keeps them
                    honest. `client_purchases` only records a currency from part
                    132 onward; older sales were backfilled from the package they
                    came from, and one already deleted by then left the amount
                    unlabelled for good. */}
                {/* TWO sentences, not one of two. The test outside was `||`
                    and the test inside was a ternary, so a coach with both
                    kinds of hole — some payments whose currency is
                    unrecoverable AND some Stripe never stated an amount for —
                    was told about the first kind only. The second kind stayed
                    missing from every figure on the screen with nothing
                    anywhere saying so, which is the exact thing this flag
                    exists to prevent, half-done. They are separate facts about
                    separate payments and each gets its own line. */}
                {takenAll.unlabelled || takenAll.unpriced ? (
                  <View style={{ marginTop: sp.md }}>
                    {takenAll.unlabelled ? (
                      <Flag tone={t.warn}>
                        {`${takenAll.unlabelled === 1 ? 'One payment is' : takenAll.unlabelled + ' payments are'} not in the figures above: the package ${takenAll.unlabelled === 1 ? 'it was' : 'they were'} bought from is gone, and the currency was only ever recorded there. Stripe still has ${takenAll.unlabelled === 1 ? 'it' : 'them'}.`}
                      </Flag>
                    ) : null}
                    {takenAll.unpriced ? (
                      <Flag tone={t.warn} style={takenAll.unlabelled ? { marginTop: sp.sm } : undefined}>
                        {`${takenAll.unpriced === 1 ? 'One payment has' : takenAll.unpriced + ' payments have'} no amount recorded, so ${takenAll.unpriced === 1 ? 'it is' : 'they are'} not in the figures above.`}
                      </Flag>
                    ) : null}
                  </View>
                ) : null}

                {/* A platform fee worked out from a figure Stripe did not
                    charge. The rarest thing on this screen and the loudest,
                    because it is the only number here that was predicted rather
                    than read back — and because a penny a sale, unnoticed for a
                    year, is exactly the shape of the harm this app is built to
                    refuse. It names no fix, deliberately: the coach cannot fix
                    it and should not be asked to, they need to know it happened
                    and to have somebody told. */}
                {feeGaps && feeGaps.count ? (
                  <View style={{ marginTop: sp.md }}>
                    <Flag tone={t.crit}>
                      {feeGaps.count === 1
                        ? 'One sale had Repple’s share worked out from a total that is not what Stripe charged, so your share of it is wrong.'
                        : feeGaps.count + ' sales had Repple’s share worked out from a total that is not what Stripe charged, so your share of them is wrong.'}
                      {' '}The figures above are what your clients paid, which is not in doubt. Send this
                      screen to support and it will be put right.
                    </Flag>
                  </View>
                ) : null}

                {/* A renewal Stripe gave no paid date for. It is real money and
                    it is in All time; it is in no month, because we cannot say
                    which one. Rare enough to be worth stating plainly when it
                    happens rather than quietly deciding for it. */}
                {undated ? (
                  <View style={{ marginTop: sp.md }}>
                    <Flag tone={t.warn}>
                      {undated === 1
                        ? 'One renewal has no payment date from Stripe, so it counts in All time but in no month.'
                        : undated + ' renewals have no payment date from Stripe, so they count in All time but in no month.'}
                    </Flag>
                  </View>
                ) : null}

                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                  Everything your clients have been charged through Repple — one-off packages,
                  session packs and subscription renewals — in the currency each was charged in, and
                  dated by when Stripe took the money.
                </Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                  This is the GROSS. Stripe&apos;s processing fee and the platform fee come out of it
                  and Repple is told neither, so nothing here is a payout, a balance, or what has
                  landed in your bank. Your Stripe dashboard is the only place those exist.
                </Text>
              </>) : null}
            </Section>

            <Rule />

            {/* ── chargebacks, and the date on each one ───────────────────
                Placed HERE, above the packs and the packages, because it is
                the only thing on this screen with a clock on it. Everything
                below answers "how much"; this answers "is there something with
                a deadline", and a case a coach scrolls past is a case decided
                without them.

                The screen has told coaches on a standard account for months
                that a dispute is theirs to answer. Until part 611 it gave them
                no way to know one existed. */}
            <Section>
              <SectionHead title="Chargebacks" note={disputesStatus === 'ready' && liveDisputes.length ? String(liveDisputes.length) : undefined} />
              {disputesStatus === 'error' ? (
                // Never an empty list under 'error'. This is the one read on
                // the screen where being wrongly reassured costs the whole
                // amount plus a fee, and the deadline goes past regardless.
                <Flag tone={t.crit}>
                  We could not read whether you have any chargebacks, so this is not a statement
                  that you have none. Your Stripe dashboard is the record — check it if a payment
                  has gone missing.
                </Flag>
              ) : disputesStatus === 'partial' ? (
                <PartialRead what="chargebacks" shown={disputes.length} onPress={load} />
              ) : disputes.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  No chargebacks. If a client ever disputes a payment with their bank, it appears
                  here with the date Stripe stops accepting evidence.
                </Text>
              ) : null}

              {(disputesStatus === 'error' ? [] : disputes).map((d, i) => {
                const over = isClosed(d.status, d.closed_at);
                const tone = disputeTone({ evidenceDueBy: d.evidence_due_by, status: d.status, closedAt: d.closed_at });
                // Parsed, not sliced. `client_disputes.evidence_due_by` is a
                // `timestamptz` — confirmed against the live schema, and part
                // 611 declares it as one — so PostgREST serialises it in UTC
                // and `String(...).slice(0, 10)` was GREENWICH's calendar day.
                // A coach in Dubai (UTC+4) whose evidence is due 01:30 on 6
                // September holds 2026-09-05T21:30Z, and this row named the
                // 5th: a day early on the one deadline on this screen that
                // costs the whole amount plus a fee if it is missed. In Los
                // Angeles it runs the other way and names a day the coach does
                // not have.
                //
                // check-utc-day.mjs deliberately does not flag this shape —
                // its header says whether a slice is wrong "depends entirely
                // on what column `iso` came from" and needs the schema, not
                // the line. The schema says it is wrong. Fixed the way
                // app/(owner)/deletions.tsx was.
                //
                // The reader's own day, because this screen reads no gym
                // timezone and no tenant has one set — the same fallback
                // deletions.tsx, financials.tsx and equipment.tsx take.
                //
                // It also puts the two halves of this sentence back on one
                // calendar. `deadlineLine` computes "due within the DAY" and
                // "due TOMORROW" from `Date.parse(evidenceDueBy)`, the true
                // instant, while `when` was UTC's day — so the row could say
                // "due within the DAY, by 5 September" to a coach for whom the
                // deadline falls on the 6th, a sentence that contradicts
                // itself in the half a hurrying reader trusts.
                const dueDay = dayOf(d.evidence_due_by);
                const due = deadlineLine(
                  { evidenceDueBy: d.evidence_due_by, status: d.status, closedAt: d.closed_at },
                  dueDay ? expiryDayLabel(dueDay) : null,
                );
                return (
                  <View key={d.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    {/* THE DATE FIRST, above the name and above the money.
                        Everything else about a chargeback can wait until the
                        coach has read the deadline; the deadline cannot. */}
                    {due ? (
                      <Text style={{ ...ty.body, fontWeight: '500', color: tone === 'urgent' ? t.ink : t.ink2 }}>{due}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md, marginTop: due ? 4 : 0 }}>
                      {/* A name we could not read is a dash, and so is a
                          dispute that carries no client at all — which happens
                          whenever the charge it is against was never recorded
                          here. That is a real state, and it is the case with
                          the least other warning attached to it. */}
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink, flex: 1 }}>{fig(d.client_name)}</Text>
                      {/* Dashed rather than dollared when Stripe stated no
                          currency. There is no default currency in this
                          product and this screen invents nothing. */}
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{fig(minorMoney(d.amount_cents, d.currency))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: over ? t.ink3 : tone === 'urgent' ? t.crit : t.warn }} />
                      <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                        {disputeStatusLabel(d.status)}
                        {disputeReasonLabel(d.reason) ? ' · ' + disputeReasonLabel(d.reason) : ''}
                      </Text>
                    </View>
                    {needsResponse(d.status) ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{WHAT_EVIDENCE_LOOKS_LIKE}</Text>
                    ) : null}
                  </View>
                );
              })}

              {disputesStatus !== 'error' && disputes.length ? (<>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{DISPUTE_MONEY_IS_ALREADY_GONE}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{EVIDENCE_GOES_TO_STRIPE}</Text>
              </>) : null}
            </Section>

            <Rule />

            {/* ── session packs sold, and what is left on them ───────────── */}
            <Section>
              {/* Counted only under 'ready'. Under 'partial' the packs shown
                  are real but there are more, and "2 clients have run out" off
                  part of the set is a smaller number than the truth — which is
                  the direction that makes it safe to ignore. */}
              <SectionHead title="Session Packs" note={buysWhole && packs.length ? String(packs.length) : undefined} />
              {buysStatus === 'error' ? (
                <Flag tone={t.crit}>
                  We could not read what your clients have bought, so this is not a list of their
                  packs. Anyone holding credits still holds them.
                </Flag>
              ) : buysStatus === 'partial' ? (
                <PartialRead what="purchases" shown={buys.length} onPress={load} />
              ) : packs.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Nobody has bought a session pack yet. Add one below with a number of sessions, and
                  the balance appears here as your clients use it.
                </Text>
              ) : runOut.length ? (
                <View style={{ marginBottom: sp.md }}>
                  <Flag tone={t.warn}>
                    {runOut.length === 1
                      ? 'One client has used every session they paid for. Their next session is not covered by a pack.'
                      : runOut.length + ' clients have used every session they paid for. Their next sessions are not covered by a pack.'}
                  </Flag>
                </View>
              ) : null}
              {/* A separate flag from the one above, and separate on purpose:
                  a client who used everything they bought got what they paid
                  for, and a client whose pack ran out with four sessions on it
                  did not. Only the second is a conversation somebody has to
                  start, and folding the two into one count would hide it inside
                  a number that reads as ordinary business. */}
              {/* ── `buysWhole`, not `buysStatus !== 'error'` ─────────────
                  `stranded` is a SUM over `packs`, and `packs` under 'partial'
                  is the page that came back rather than the book. "3 sessions
                  your clients paid for ran out of time" said off a truncated
                  read is a figure with a full stop after it, computed over an
                  unknown fraction — and unlike the run-out count above it, this
                  one is a coach's list of conversations to have. Three when it
                  is thirty is the difference between an afternoon's phone calls
                  and one.
                  `!== 'error'` also let it draw while the read was still
                  LOADING, off whatever had arrived. Five states, and only one
                  of them may carry a total: the house rule is `isWhole`, never
                  `!== 'error'`. The sibling if/else above already gets this
                  right; this block was a separate sibling and did not. */}
              {buysWhole && stranded > 0 ? (
                <View style={{ marginBottom: sp.md }}>
                  <Flag tone={t.warn}>
                    {stranded === 1
                      ? 'One session somebody paid for ran out of time before it was used. It is marked below.'
                      : stranded + ' sessions your clients paid for ran out of time before they were used. They are marked below.'}
                  </Flag>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{EXPIRY_IS_NOT_A_REFUND}</Text>
                </View>
              ) : buysStatus === 'partial' && stranded > 0 ? (
                <View style={{ marginBottom: sp.md }}>
                  {/* Stated as a floor, because that is what it is. Withholding
                      it entirely would be worse than a floor: somebody's paid-
                      for sessions have been lost and the coach can act on
                      "at least one" — they cannot act on silence. */}
                  <Flag tone={t.warn}>
                    At least {stranded} session{stranded === 1 ? '' : 's'} your clients paid for ran out of time before
                    {stranded === 1 ? ' it was' : ' they were'} used. Only part of your purchases loaded, so there may be more
                    than this — the ones that did load are marked below.
                  </Flag>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{EXPIRY_IS_NOT_A_REFUND}</Text>
                </View>
              ) : null}
              {(buysStatus === 'error' ? [] : packsShown).map((b, i) => {
                const left = packLeft(b);
                const gone = !!b.expired_at;
                const lost = Math.max(0, Number(b.sessions_expired ?? 0));
                // What they BOUGHT. `sessions_total` has already had the
                // stranded credits taken off it by the time an expired pack is
                // read back, so printing it raw would relabel a ten-pack as a
                // six-pack on the coach's own screen.
                const sold = Number(b.sessions_total ?? 0) + lost;
                const out = !gone && packRunOut(b);
                const target = purchaseTarget(b);
                return (
                  <View key={b.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                      {/* A name we could not read is a dash, never 'Client'. */}
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{fig(b.client_name)}</Text>
                      {/* Dashed rather than dollared when the package it was
                          sold from is gone: that row held the only record of
                          what this amount is denominated in. */}
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{fig(minorMoney(b.amount_cents, b.currency))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: out || (gone && lost > 0) ? t.warn : t.brand }} />
                      {/* "Used up" rather than "0 of 10 left". Both are true;
                          only one of them reads as a thing to act on, and a
                          zero in a row of numbers is easy to scan past. `left`
                          is null only for a row that is not a pack, which
                          cannot reach this list — so the dash is a guard, not
                          an expected state. */}
                      {/* The dot above is the mark and always was; the ink no
                          longer doubles it. warn as caption text is 3.87–4.08:1
                          on the three light palettes, under AA. */}
                      {/* "Used up" rather than "0 of 10 left", and "ran out of
                          time" rather than either — three states, three
                          sentences. A pack that expired with credits on it says
                          how many, because that number is the whole of what the
                          coach has to talk to somebody about. */}
                      <Text style={{ ...ty.caption, color: out || (gone && lost > 0) ? t.ink2 : t.ink3, flex: 1 }}>
                        {gone
                          // `lost` and `sold` are plain numbers rather than
                          // `fig()` calls: both are arithmetic over a row this
                          // list has already filtered to `sessions_total != null`,
                          // so neither can be absent, and a dash producer in a
                          // sentence is a hole where a word should be (check:prose).
                          ? (lost > 0
                            ? `Ran out of time — ${lost} of ${sold} unused`
                            : `Ran out of time — all ${sold} had been used`)
                          : out ? `Used up — all ${fig(sold)} sessions` : `${fig(left)} of ${fig(sold)} left`}
                        {b.package_name ? ' · ' + b.package_name : ''}
                        {' · '}{new Date(b.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    {/* What has gone back, stated BESIDE the sale rather than
                        taken off the amount above it. Every takings figure in
                        this app is gross — what the client was charged — and
                        silently netting a refund into one row while every
                        other figure stays gross is how two numbers on the same
                        screen come to disagree. A refunded sale is still a
                        sale that happened, and it is marked rather than
                        rewritten or removed. */}
                    {/* The conversation, in the coach's direction. `expiryLine`
                        is the client's version of the same fact and says what
                        happened to their money; this one is about a decision
                        that is the coach's to make. Both are null for a pack
                        with no window, which is every pack sold before part
                        612 — so nothing is added to the ninety-nine per cent of
                        rows this does not concern.

                        `left` is passed now, and that is the whole of the fix
                        for a refund that landed on a closed pack. Until it was,
                        `strandedNote` keyed on `sessionsExpired` alone and
                        returned null for exactly that case, so this fell
                        through to `expiryLine` — and `expiryLine` is written
                        voice-neutral BECAUSE it is read by both apps, which
                        meant the coach's own screen was showing the client's
                        sentence about the coach's own client. There was no
                        sentence here telling the coach that a credit they
                        refunded is sitting somewhere nothing can book it, and
                        moving it is the one thing only they can do. */}
                    {strandedNote(b.client_name, { expiresOn: b.expires_on ?? null, expiredAt: b.expired_at ?? null, sessionsExpired: lost }, left, todayKey) ? (
                      <Text style={{ ...ty.caption, color: t.ink2, marginTop: 3 }}>
                        {strandedNote(b.client_name, { expiresOn: b.expires_on ?? null, expiredAt: b.expired_at ?? null, sessionsExpired: lost }, left, todayKey)}
                      </Text>
                    ) : expiryLine({ expiresOn: b.expires_on ?? null, expiredAt: b.expired_at ?? null, sessionsExpired: lost }, left, todayKey) ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                        {expiryLine({ expiresOn: b.expires_on ?? null, expiredAt: b.expired_at ?? null, sessionsExpired: lost }, left, todayKey)}
                      </Text>
                    ) : null}
                    {refundedLine(target) ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{refundedLine(target)}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.xs, flexWrap: 'wrap' }}>
                      {refundBlocker(target.rule) === null ? (
                        <Pressable onPress={() => openRefund(target)} hitSlop={8} accessibilityRole="button"
                          disabled={refundBusy === b.id}
                          accessibilityState={{ disabled: refundBusy === b.id, busy: refundBusy === b.id }}
                          accessibilityLabel={`Refund the sale to ${b.client_name || 'this client'}`}
                          style={{ paddingVertical: sp.xs }}>
                          <Text style={{ ...ty.label, fontWeight: '500', color: refundBusy === b.id ? t.ink3 : t.brand }}>
                            {refundBusy === b.id ? 'Refunding…' : 'Refund'}
                          </Text>
                        </Pressable>
                      ) : null}
                      {/* The act `REFUND_DOES_NOT` names and nothing in this
                          product could do.
                          "A refund gives money back and does nothing else … it
                          does not put a session credit back on a pack" is shown
                          to the coach in the confirm dialog, seconds before
                          somebody's card is credited, and there was no control
                          anywhere to act on it. A coach who refunded two
                          sessions of a ten-pack gave the money back and left
                          the credits, so the client had both — and neither
                          screen mentioned the other.
                          Separate from Refund, and staying separate: a credit
                          may be given back without money (a session that never
                          happened) and money without a credit (goodwill on a
                          pack they are keeping). Hidden on a closed pack rather
                          than offered and refused, because part 661 will not
                          put a credit onto one no draw site can ever spend. */}
                      {!gone && Number(b.sessions_used ?? 0) > 0 ? (
                        <Pressable onPress={() => confirmCredit(b, 1)} hitSlop={8} accessibilityRole="button"
                          disabled={creditBusy === b.id}
                          accessibilityState={{ disabled: creditBusy === b.id, busy: creditBusy === b.id }}
                          accessibilityLabel={`Put a session credit back on the pack for ${b.client_name || 'this client'}`}
                          style={{ paddingVertical: sp.xs }}>
                          <Text style={{ ...ty.label, fontWeight: '500', color: creditBusy === b.id ? t.ink3 : t.brand }}>
                            {creditBusy === b.id ? 'Working…' : 'Give a credit back'}
                          </Text>
                        </Pressable>
                      ) : null}
                      {!gone && left != null && left > 0 ? (
                        <Pressable onPress={() => confirmCredit(b, -1)} hitSlop={8} accessibilityRole="button"
                          disabled={creditBusy === b.id}
                          accessibilityState={{ disabled: creditBusy === b.id, busy: creditBusy === b.id }}
                          accessibilityLabel={`Take a session credit off the pack for ${b.client_name || 'this client'}`}
                          style={{ paddingVertical: sp.xs }}>
                          <Text style={{ ...ty.label, fontWeight: '500', color: creditBusy === b.id ? t.ink3 : t.ink3 }}>
                            Take one off
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Section>

            <Rule />

            {/* ── what clients can buy ───────────────────────────────────── */}
            <Section>
              {/* The number beside the heading is only ever drawn over a read
                  that came back WHOLE. Under 'partial' it would be the count of
                  what fitted in one read, printed as the size of the coach's
                  price list, and the note below says so in words instead. */}
              <SectionHead title="Your Packages" note={pkgRead === 'ready' && activePkgs.length ? String(activePkgs.length) : undefined} />
              {pkgRead === 'error' ? (
                <Flag tone={t.crit}>
                  Your packages could not be read, so this is not a list of what you sell. Do not add
                  them again from here — reopen the screen once you have signal.
                </Flag>
              ) : pkgRead === 'partial' ? (
                <PartialRead what="packages" shown={activePkgs.length} onPress={() => { void load(); }} />
              ) : activePkgs.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>No packages yet. Add one below — a monthly membership or a pack of sessions.</Text>
              ) : null}
              {activePkgs.map((p, i) => (
                <View key={p.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                  borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{billingWords(p)}</Text>
                  </View>
                  {/* Edit before remove, and to the left of it: a coach whose
                      only control was the minus sign withdrew a package to
                      change its price, which is how the price history got
                      orphaned in the first place. */}
                  <Pressable onPress={() => openEdit(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Edit ' + p.name} style={{ padding: 6 }}>
                    <Icon name="pencil" size={17} color={t.ink3} />
                  </Pressable>
                  <Pressable onPress={() => remove(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + p.name} style={{ padding: 6 }}>
                    <Icon name="minus" size={17} color={t.ink3} />
                  </Pressable>
                </View>
              ))}
            </Section>

            <Rule />

            {/* ── who is subscribed ──────────────────────────────────────── */}
            <Section>
              {/* The count is only printed under 'ready'. Under 'partial' the
                  rows are real but there are more of them, so a number beside
                  the title would be a total computed from part of the set —
                  and this particular total is somebody's recurring income. */}
              <SectionHead title="Subscribers" note={subsStatus === 'ready' && liveSubs.length ? String(liveSubs.length) : undefined} />
              {subsStatus === 'error' ? (
                <Flag tone={t.crit}>
                  We could not read your subscribers, so this is not a list of who is paying you. It is
                  not a statement that nobody is — anyone subscribed still is.
                </Flag>
              ) : subsStatus === 'partial' ? (
                <PartialRead what="subscribers" shown={subs.length} onPress={load} />
              ) : liveSubs.length === 0 && unsettledSubs.length === 0 ? (
                // Both buckets, or this sentence is false. "Nobody is
                // subscribed yet" printed above a paused subscriber is exactly
                // the bug the third bucket exists to fix, and it would have
                // survived intact if this condition still asked only about the
                // live ones.
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Nobody is subscribed yet. Add a monthly or yearly package below and it appears on your
                  clients&apos; Memberships screen.
                </Text>
              ) : null}
              {(subsStatus === 'error' ? [] : liveSubs).map((s, i) => {
                // Two different things a row can be, and the dot has always
                // told them apart: a failed card is critical, a subscription
                // already set to end is a warning, anything else is running.
                // The word beside it now says which of those it is in full,
                // because "Active · ends 4 March" was the only place a coach
                // could learn a client had cancelled, and it read as a renewal
                // date at a glance.
                const stopping = s.cancel_at_period_end;
                const changing = subBusy === s.stripe_subscription_id;
                return (
                  <View key={s.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                      {/* A name we could not read is a dash, never 'Client' —
                          the money beside it is real either way. */}
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{fig(s.client_name)}</Text>
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{fig(pkgPriceLine(s.amount_cents, s.currency, s.billing_interval))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.status === 'past_due' ? t.crit : stopping ? t.warn : t.brand }} />
                      {/* Same again: the status dot beside this line is the mark. */}
                      <Text style={{ ...ty.caption, color: stopping ? t.ink2 : t.ink3, flex: 1 }}>
                        {stopping ? 'Stopping' : statusLabel(s.status)}
                        {stopping && s.status !== 'active' ? ` · ${statusLabel(s.status)}` : ''}
                        {s.current_period_end
                          ? ` · ${stopping ? 'ends' : 'renews'} ${new Date(s.current_period_end).toLocaleDateString()}`
                          : ''}
                      </Text>
                    </View>
                    {/* The control this screen went without. Offered only on a
                        subscription Stripe will actually accept the switch on
                        — `canSwitchCancel` — so there is still no button here
                        whose only outcome is an error message. */}
                    {canSwitchCancel(s.status) ? (
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                        {changing ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: 11 }}>
                            <ActivityIndicator color={t.ink3} />
                            <Text style={{ ...ty.caption, color: t.ink3 }}>Telling Stripe…</Text>
                          </View>
                        ) : (
                          <Ghost
                            label={stopping ? 'Keep Running' : 'Stop At Period End'}
                            a11yLabel={(stopping ? 'Keep running the subscription for ' : 'Stop the subscription for ') + (s.client_name || 'this client') + ' at the end of the period'}
                            onPress={() => switchCancel(s, stopping ? 'resume' : 'cancel')}
                          />
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {/* ── neither charging nor finished ──────────────────────────
                  A status Repple has no sentence for used to be filtered out
                  of this list by `isLive` and shown nowhere at all — so a
                  coach whose client's subscription Stripe had PAUSED read
                  "Nobody is subscribed yet" off a screen that was holding the
                  row. These are listed with Stripe's own word quoted back, and
                  kept out of the count and out of the priced-to-recur figure
                  above, because neither of those may include a subscription
                  that is not charging. */}
              {subsStatus !== 'error' && unsettledSubs.length ? (
                <View style={{ marginTop: sp.md, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>Neither charging nor finished</Text>
                  {unsettledSubs.map((s) => (
                    <View key={s.id} style={{ marginTop: sp.md }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2, flex: 1 }}>{fig(s.client_name)}</Text>
                        <Text style={{ ...ty.label, color: t.ink3 }}>{statusLabel(s.status)}</Text>
                      </View>
                      <Flag tone={t.warn} style={{ marginTop: 4 }}>{unsettledNote(s.status)}</Flag>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* What is running today, at what it is priced at — printed only
                  on a whole read, and never called income. Kept apart by
                  interval as well as by currency: a yearly package divided by
                  twelve is a monthly figure this app invented. And kept apart
                  from the takings at the top of the screen, which are money
                  that has already moved: this one is forward-looking, and a
                  charge nobody has made yet is not earnings. */}
              {/* Drawn whenever the read came back whole and there is
                  ANYTHING to say — a pot, or a subscription that could not go
                  into one. The test was `recurring.pots.length` alone, so
                  `sumRecurring`'s `unlabelled` and `unpriced` were computed and
                  never read: a live subscription with no currency, no billing
                  interval or no amount on it fell out of "Priced to recur" in
                  silence, and a coach whose subscriptions were ALL like that
                  got no block at all rather than a sentence saying three of
                  them are not in any figure. `sumTaken` gets this treatment
                  four hundred lines above and it is the same rule: an amount
                  left out of a total is stated, never dropped. */}
              {recurring && (recurring.pots.length || recurring.unlabelled || recurring.unpriced) ? (
                <View style={{ marginTop: sp.md, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>Priced to recur</Text>
                  {recurring.pots.map((p) => (
                    <Text key={p.currency + p.interval} style={{ ...value(20), color: t.ink, marginTop: 4 }}>
                      {fig(pkgPriceLine(p.minorUnits, p.currency, p.interval))}
                    </Text>
                  ))}
                  {recurring.unlabelled ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                      {`${recurring.unlabelled === 1 ? 'One live subscription is' : recurring.unlabelled + ' live subscriptions are'} not in the figure${recurring.pots.length === 1 ? '' : 's'} above: ${recurring.unlabelled === 1 ? 'it carries' : 'they carry'} no currency or no billing period, and a price with neither is not a figure to plan against. Stripe is still charging ${recurring.unlabelled === 1 ? 'it' : 'them'}.`}
                    </Flag>
                  ) : null}
                  {recurring.unpriced ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                      {`${recurring.unpriced === 1 ? 'One live subscription has' : recurring.unpriced + ' live subscriptions have'} no amount recorded, so ${recurring.unpriced === 1 ? 'it is' : 'they are'} not in the figure${recurring.pots.length === 1 ? '' : 's'} above.`}
                    </Flag>
                  ) : null}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                    What your live subscriptions are priced at — what they are set to charge next,
                    if nobody cancels and no card fails. It is not money you have been paid. What
                    you have actually been paid is in Taken Through Stripe at the top, renewals
                    included.
                  </Text>
                </View>
              ) : null}

              {/* What the buttons above do and do not do.
                  Stopping and refunding are two acts and the copy keeps them
                  two. Stopping ends the next charge and returns nothing;
                  refunding returns money and stops nothing. A coach who
                  believes either implies the other has short-changed their
                  client or refunded somebody they did not mean to, and the
                  refund control is on the SALE rather than on the subscriber
                  row precisely so the two are not adjacent taps. */}
              {liveSubs.length ? (
                <>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                    Stopping a subscription ends it at the close of the period the client has already
                    paid for — they keep what they bought, and are not charged again. You can put it
                    back any time before it ends, and the client can do both from their Memberships
                    screen too. Ending one today is offered inside that confirmation, and it cannot
                    be undone.
                  </Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{END_AT_PERIOD_IS_KINDER}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{END_NOW_TAKES_THE_REST}</Text>
                </>
              ) : null}
            </Section>

            <Rule />

            {/* ── RENEWALS PAID, AND THE ONE A COACH HAS TO GIVE BACK ──────
                The list that did not exist, and its absence was the whole of
                why a renewal could not be refunded. `refundRenewal` was in
                src/lib/connect.ts, connect-refund had a `kind: 'renewal'`
                branch, and part 192 gave `client_subscription_payments` the
                same `refunded_cents` / `refunded_at` pair it gave
                `client_purchases` — all of it reachable from nothing. A coach
                whose client asked for last month back was still being sent to
                a Stripe dashboard, which is the exact moment the refund
                feature exists to remove.

                These rows were already read for the takings figure at the top
                of this screen. They were summed and never shown, so a coach
                could see that AED 1,800 of renewals had come in and could not
                see WHICH THREE, let alone act on one of them.

                A renewal is refunded from here and a subscription is stopped
                from the section above, deliberately far apart: stopping ends
                the next charge and returns nothing, refunding returns money
                and stops nothing, and the two must never be adjacent taps. */}
            <Section>
              {/* Counted only under 'ready', for the same reason as every
                  other count on this screen: a number off a partial read is a
                  smaller figure about somebody's income with nothing about it
                  to doubt. */}
              <SectionHead title="Renewals Paid" note={paysStatus === 'ready' && pays.length ? String(pays.length) : undefined} />
              {paysStatus === 'error' ? (
                <Flag tone={t.crit}>
                  Your renewals could not be read, so this is not a list of what your subscribers have
                  paid. It is not a statement that nobody has renewed — every payment that has been
                  taken has been taken, and Stripe still holds all of them.
                </Flag>
              ) : paysStatus === 'partial' ? (
                <PartialRead what="renewals" shown={pays.length} onPress={load} />
              ) : pays.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  No subscription has renewed yet. Every month a client is charged, the payment appears
                  here and can be given back from this list.
                </Text>
              ) : null}
              {(paysStatus === 'error' ? [] : pays).map((p, i) => {
                const target = renewalTarget(p);
                // Stripe's own word for why the invoice existed, turned into
                // the only distinction a coach cares about: was this the
                // payment that started the subscription, or one of the ones
                // after it. Anything else Stripe invents is left unsaid
                // rather than translated into a guess.
                const first = p.billing_reason === 'subscription_create';
                return (
                  <View key={p.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                      {/* A name we could not read is a dash, never 'Client'.
                          The money beside it is real either way. */}
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{fig(target.who)}</Text>
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{fig(minorMoney(p.amount_cents, p.currency))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.paid_at ? t.brand : t.warn }} />
                      <Text style={{ ...ty.caption, color: p.paid_at ? t.ink3 : t.ink2, flex: 1 }}>
                        {/* A payment Stripe gave no date for is real money on
                            a day nobody can name, and it says so rather than
                            borrowing the day the row happened to be written.
                            The dot beside it is the mark. */}
                        {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : 'No payment date from Stripe'}
                        {first ? ' · First payment' : ''}
                      </Text>
                    </View>
                    {/* What has gone back, stated BESIDE the renewal rather
                        than taken off the amount above it — every takings
                        figure in this app is gross, and netting one row while
                        the rest stay gross is how two numbers on the same
                        screen come to disagree. */}
                    {refundedLine(target) ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{refundedLine(target)}</Text>
                    ) : null}
                    {refundBlocker(target.rule) === null ? (
                      <Pressable onPress={() => openRefund(target)} hitSlop={8} accessibilityRole="button"
                        disabled={refundBusy === p.id}
                        accessibilityState={{ disabled: refundBusy === p.id, busy: refundBusy === p.id }}
                        accessibilityLabel={`Refund the renewal paid by ${target.who || 'this client'}`}
                        style={{ paddingVertical: sp.xs, marginTop: sp.xs }}>
                        <Text style={{ ...ty.label, fontWeight: '500', color: refundBusy === p.id ? t.ink3 : t.brand }}>
                          {refundBusy === p.id ? 'Refunding…' : 'Refund'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              {paysStatus !== 'error' && pays.length ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                  Each line is one payment Stripe actually took, and giving one back does not stop the
                  subscription — it keeps running and charges again next period. Stop it in Subscribers
                  above if that is what you mean.
                </Text>
              ) : null}
            </Section>

            <Rule />

            {/* ── DISCOUNT CODES ────────────────────────────────────────────
                January and September offers are how coaches fill a book, and
                running one used to mean creating a SECOND package at the lower
                price, telling the right people, and remembering to withdraw it
                in February — which nobody does, so the offer price quietly
                becomes the price.

                The codes live on the coach's own Stripe account and nowhere
                else. The redemption count below is therefore exact: there is
                one copy of it and Stripe keeps it.

                Subscriptions only, and the reason is the platform fee rather
                than taste — src/lib/packagePromo.ts has the argument and
                `promoBlocker` refuses a one-off package by name so a coach
                reads WHY rather than finding the option missing. */}
            <Section>
              <SectionHead title="Discount Codes" note="Typed by your client on the payment page" />

              {/* An empty list and an unreadable one are different sentences.
                  A coach who has just printed a poster must not be told they
                  are running no offers because Stripe was unreachable — or,
                  worse, because their account cannot carry codes at all, which
                  is a refusal with its own explanation and its own fix. */}
              {promos.status === 'error' ? (
                <Flag tone={t.crit}>
                  {promos.reason || 'Your discount codes could not be read, so this is not a list of none.'}
                </Flag>
              ) : promos.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Still reading your codes.</Text>
              ) : !promos.codes.length ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  You are not running any offers. A code takes a percentage off one of your packages for
                  anybody who types it at checkout.
                </Text>
              ) : (
                <View>
                  {promos.codes.map((p) => {
                    const state = promoState(p, isoToday(new Date()));
                    return (
                      <View key={p.id} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                          <Text style={{ ...ty.body, fontWeight: '600', color: state === 'live' ? t.ink : t.ink3, flex: 1 }}>
                            {p.code}
                          </Text>
                          <Text style={{ ...ty.label, ...numeric, color: state === 'live' ? t.ink2 : t.ink3 }}>
                            {/* `fig`: this row comes back from Stripe, whose
                                `percent_off` is a decimal. The code the coach
                                created here is whole (`Math.trunc` above), one
                                made in the Stripe dashboard need not be. */}
                            {fig(p.percentOff)}% off
                          </Text>
                        </View>
                        {/* The package the code is attached to. Two codes at
                            two percentages off two packages were rendered as
                            two identical-looking rows, and Withdraw is
                            destructive and forward-only. */}
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                          {promoPkgLine(p) ?? 'Which package this applies to could not be read'}
                        </Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                          {promoStateLabel(state)} · {promoUseLine(p)}
                        </Text>
                        {state === 'live' ? (
                          <Pressable onPress={() => withdrawPromo(p)} hitSlop={8} accessibilityRole="button"
                            disabled={promoBusy} accessibilityLabel={`Withdraw the code ${p.code}`}
                            accessibilityState={{ disabled: promoBusy, busy: promoBusy }}
                            style={{ paddingVertical: sp.xs, marginTop: sp.xs }}>
                            <Text style={{ ...ty.label, fontWeight: '500', color: promoBusy ? t.ink3 : t.brand }}>Withdraw</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* The form, offered only where there is something to attach a
                  code to. A coach who sells nothing is told so rather than
                  handed a picker with nothing in it.
                  Every ACTIVE package is in the picker now, one-offs included.
                  Whether a code may go on a particular one-off depends on the
                  price and the percentage together — `promoBlocker` answers it
                  live under the boxes, and names the percentages that DO divide
                  that price. A picker that silently omitted one-offs would put
                  the coach back where they started: an option that is simply
                  absent, with nowhere to read why. */}
              {promos.status !== 'error' ? (
                promoTargets.length ? (
                  <View style={{ marginTop: sp.lg }}>
                    <Pick label="For which package"
                      options={promoTargets.map((p) => ({ key: p.id, label: p.name }))}
                      chosen={promoPkg} onPick={(k: string | null) => setPromoPkg(k)} />
                    <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.md }}>
                      <View style={{ flex: 2 }}>
                        <TextInput value={promoCode} onChangeText={(v) => setPromoCode(normaliseCode(v))}
                          autoCapitalize="characters" autoCorrect={false}
                          placeholder="NEWYEAR" placeholderTextColor={t.ink3}
                          accessibilityLabel="The code your client types" style={input} />
                      </View>
                      <View style={{ flex: 1 }}>
                        {/* A whole percentage, so the NUMBER pad rather than
                            the decimal one — there is no such thing as 12.5%
                            off here, and check:decimals is the gate that keeps
                            the two apart. */}
                        <TextInput value={promoPct} onChangeText={setPromoPct} keyboardType="number-pad"
                          maxLength={2} placeholder="20" placeholderTextColor={t.ink3}
                          accessibilityLabel="Percentage off" style={input} />
                      </View>
                    </View>
                    {promoProblems.length && (promoCode || promoPct || promoPkg) ? (
                      <View style={{ marginTop: sp.md }}>
                        {promoProblems.map((b) => <Flag key={b} style={{ marginTop: sp.xs }}>{b}</Flag>)}
                      </View>
                    ) : null}
                    <View style={{ marginTop: sp.md }}>
                      <Cta label={promoBusy ? 'Creating…' : 'Create a Code'} wide
                        disabled={promoBusy || promoProblems.length > 0} onPress={() => { void addPromo(); }} />
                    </View>
                  </View>
                ) : (
                  /* Four causes and not one. `promoTargets` comes off
                     `activePkgs`, which is `[]` under 'error' and 'loading'
                     exactly as it is for a coach who genuinely sells nothing —
                     so this told a coach their price list was empty on the
                     strength of a read that never answered, two sections below
                     the same screen correctly saying it could not be read. It
                     is also short rather than empty under 'partial', where the
                     picker would quietly omit packages a code could be
                     attached to. */
                  pkgRead === 'error' ? (
                    <Flag style={{ marginTop: sp.lg }}>
                      Your packages could not be read, so there is nothing to choose from here. That is not a
                      statement that you have none on sale — anything already on sale still is.
                    </Flag>
                  ) : pkgRead === 'loading' ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>Still reading your packages.</Text>
                  ) : pkgRead === 'partial' ? (
                    <Flag style={{ marginTop: sp.lg }}>
                      You have more packages than came back in one read, so this list is not all of them. Reload
                      before attaching a code, or the one you want may not be here.
                    </Flag>
                  ) : (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                    You have nothing on sale, so there is nothing to attach a code to yet. Add a package below
                    and it appears here.
                  </Text>
                  )
                )
              ) : null}

              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{PROMO_IS_A_PERCENTAGE}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PROMO_IS_TYPED_AT_CHECKOUT}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{PROMO_LIVES_AT_STRIPE}</Text>
            </Section>

            <Rule />

            {/* ── add a package ──────────────────────────────────────────── */}
            <Section>
              <SectionHead title="Add a Package" />
              <TextInput value={name} onChangeText={setName} placeholder="Name — e.g. 10-Session Pack" placeholderTextColor={t.ink3} style={input} accessibilityLabel="Package name" />

              <View style={{ marginTop: sp.md }}>
                <Pick label="Billing" options={INTERVALS.map((i) => ({ key: i.key, label: i.label }))} chosen={interval}
                  onPick={(k: BillingInterval | null) => { setInterval(k); if (k) setSessions(''); }} />
              </View>

              {/* The coach's currency, stated rather than picked — and dashed
                  rather than guessed. Repple is white-labelled, so there is no
                  currency this screen could assume that is not simply wrong for
                  half the people running it.
                  Six causes, six sentences, and only ONE of them is a gym
                  owner's to fix. This branch used to offer two, and the second
                  of them — "an owner sets it in the gym settings" — was shown
                  to a coach with no gym and nobody to ask, which is what made
                  Add Package permanently dead for the self-employed. */}
              {!currency ? (
                <View style={{ marginTop: sp.md }}>
                  <Flag tone={t.warn}>
                    {myCurrencyLine(currencyGap ?? 'unreadable', 'a price here would have no unit and nothing can go on sale')}
                  </Flag>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Price ({fig(currency)})</Text>
                  <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="500" placeholderTextColor={t.ink3} style={input} />
                  {/* Which of the two places these three letters came from,
                      said out loud. It is the answer to the question a coach
                      cannot otherwise ask of this field — and the disagreement
                      that existed for a year (a gym's currency on the invoices
                      of a coach who had left it) was invisible precisely
                      because every screen printed the code and none of them
                      printed its source. */}
                  {currencyFromNote(currencyFrom, currency) ? (
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: 5 }}>{currencyFromNote(currencyFrom, currency)}</Text>
                  ) : null}
                </View>
                {/* Not offered at all on a recurring package. `sessions` is a
                    balance granted once and drawn down; nothing renews it, so
                    "10 sessions, monthly" would charge again in month two for
                    credits already spent in month one. Part 97 refuses the
                    combination outright. */}
                {interval ? null : (
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Sessions (blank = membership)</Text>
                    <TextInput value={sessions} onChangeText={setSessions} keyboardType="number-pad" placeholder="10" placeholderTextColor={t.ink3} style={input} />
                  </View>
                )}
              </View>

              {/* ── how long the sessions last ─────────────────────────────
                  Offered only on a PACK. A membership has no credits to run out
                  of — it is stopped by cancelling it — and part 612 refuses the
                  combination in the database, so the field is not shown rather
                  than shown and rejected.

                  Empty is the default and empty means forever, which is what
                  every pack in this product has done until now. The sentence
                  under the box is there because the alternative to saying it is
                  a coach discovering, a year later, that adding a window here
                  did or did not reach the ten-packs their clients are already
                  holding. It did not, and that is the whole design. */}
              {!interval && sessions.trim() && parseInt(sessions, 10) > 0 ? (
                <View style={{ marginTop: sp.md }}>
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>Valid for (days — blank = never expires)</Text>
                  <TextInput value={validity} onChangeText={setValidity} keyboardType="number-pad" placeholder="90" placeholderTextColor={t.ink3} style={input} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5 }}>
                    {validityLine(readValidityDays(validity).ok ? (readValidityDays(validity) as { ok: true; days: number | null }).days : null) ?? NO_VALIDITY_IS_FOREVER}
                  </Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 5 }}>{VALIDITY_NOT_RETROACTIVE}</Text>
                </View>
              ) : null}

              {/* Read back exactly what will be charged, in the unit it will be
                  charged in — or nothing at all. A preview that says "AED" on a
                  gym that has not set a currency is the invention this whole
                  screen is avoiding. */}
              {interval ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {priceEcho
                    ? `Clients are charged ${priceEcho} every ${interval === 'month' ? 'month' : 'year'} until they cancel.`
                    : `Clients are charged every ${interval === 'month' ? 'month' : 'year'} until they cancel.`}
                </Text>
              ) : null}

              <View style={{ height: sp.lg }} />
              <Cta label={busy ? 'Saving…' : interval ? 'Add Subscription' : 'Add Package'} wide disabled={busy || !currency} onPress={addPkg} />
            </Section>

            <Rule />

            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.lg }}>
              Payments are processed by Stripe. A platform fee applies to each sale. You never handle card details.
            </Text>
          </>
        )}

      </ScrollView>

      {/* ── give a client their money back ──────────────────────────────────
          Whole or part. The part was the deliberate limit this screen shipped
          with, and the four things that make a typed amount safe rather than
          merely present are written above `refundableOf`.

          A sheet rather than an alert because an alert cannot hold a box, the
          currency beside the box, and the exact figure read back — and without
          those three a typed amount is a figure nobody checked. */}
      {/* ── the keyboard covered this sheet ────────────────────────────────
          A bottom sheet is anchored to the bottom of the window, so the keyboard comes
          up OVER it: the amount to give back is typed halfway down it.

          The fix a sheet takes is not the page one. `automaticallyAdjustKeyboardInsets`
          scrolls a focused row inside a scroller that stays where it is; here the whole
          sheet has to move. This wrapper is the pattern app/(trainer)/invoices.tsx,
          costs.tsx and receipts.tsx already use and the one on the picker in
          app/(trainer)/log-session.tsx: `behavior="padding"` pads the KAV, which shrinks
          the flex:1 scrim above the sheet and lifts the sheet with it — and the sheet's
          percentage maxHeight resolves against the shrunken box, so it stays whole
          instead of running off the top. */}
      <Modal visible={!!refunding} animationType="slide" transparent onRequestClose={() => setRefunding(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setRefunding(null)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
            {/* The heading names WHICH KIND of charge, because the two are
                adjacent acts on the same screen and a coach who meant to give
                back last month's renewal must not be looking at a sheet that
                says sale. */}
            <Text style={{ ...ty.head, color: t.ink }}>{refunding?.kind === 'renewal' ? 'Refund This Renewal' : 'Refund This Sale'}</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* What was charged and what is still standing. Both, because the
                  second is the number the amount below is judged against and a
                  coach looking at a partly refunded charge would otherwise work
                  from the first. */}
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
                {refunding?.who || 'This client'}
                {refunding && minorMoney(refunding.rule.amountCents, refunding.rule.currency) ? ` — ${minorMoney(refunding.rule.amountCents, refunding.rule.currency)} was charged` : ''}
              </Text>
              {refunding?.what ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{refunding.what}</Text>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                {refundLeftMoney
                  ? `${refundLeftMoney} of it can still be given back.`
                  : `What is left on this ${refunding?.kind === 'renewal' ? 'renewal' : 'sale'} can be given back.`}
              </Text>

              <View style={{ marginTop: sp.lg }}>
                <Pick label="How much"
                  options={[{ key: 'whole', label: 'All Of It' }, { key: 'part', label: 'Part Of It' }]}
                  chosen={refundWhole ? 'whole' : 'part'}
                  onPick={(k: string) => { setRefundWhole(k === 'whole'); setRefundAmt(''); }} />
              </View>

              {!refundWhole ? (
                <>
                  <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Amount</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    {/* The SALE's own currency, shown and not editable. A refund
                        is made in the money the charge was made in and in no
                        other, and there is no currency this box could offer that
                        would not be a different amount of money. */}
                    <Text style={{ ...ty.label, color: t.ink3 }}>{(refunding?.rule.currency || '').toUpperCase()}</Text>
                    {/* The keyboard follows the currency. A yen has no minor unit,
                        so a decimal point on that pad is a key that can only
                        produce a slip; everything else can carry a fraction and
                        the pad has to have the point on it. */}
                    <TextInput value={refundAmt} onChangeText={setRefundAmt}
                      keyboardType={refundDp === 0 ? 'number-pad' : 'decimal-pad'}
                      placeholder={refundDp === 0 ? '0' : '0.' + '0'.repeat(refundDp ?? 2)} placeholderTextColor={t.ink3}
                      accessibilityLabel={`Amount to refund, in ${(refunding?.rule.currency || '').toUpperCase()}`}
                      style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1 }} />
                  </View>
                  {/* Read back before it is sent. The coach checks the figure this
                      app understood, not the characters they typed. */}
                  {refundMoney ? (
                    <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{refundMoney} would go back.</Text>
                  ) : null}
                  {refundProblem ? <Flag tone={t.crit} style={{ marginTop: sp.sm }}>{refundProblem}</Flag> : null}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{REFUND_PART_IS_EXACT}</Text>
                </>
              ) : null}

              {/* Everything a refund does not do, said before the tap rather than
                  discovered afterwards. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{REFUND_DOES_NOT}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{REFUND_FEES_NOTE}</Text>
              {/* Whose balance it leaves, read off THIS CHARGE. A coach who has
                  since moved to direct charges still has older sales and older
                  renewals on the platform, and the two sentences say opposite
                  things.

                  THREE states, not two. This was
                  `accountForObject(…) ? 'direct' : 'destination'` — the exact
                  expression `confirmRefund` documents at length as the defect
                  it was fixed for, and which was fixed there and not here. An
                  absent account is not evidence of a platform charge: the
                  column is nullable and nothing backfills it, so a
                  STANDARD-account coach whose row simply carries no account
                  was read this sheet's "the refund leaves Repple's balance and
                  your next payout is smaller by that amount" while Stripe was
                  about to debit THEIR balance and, if it was short, their
                  bank. One refund, two sentences about whose money it is —
                  the sheet asserting one and the confirm dialog two taps later
                  correctly saying nothing. Only a legacy Express account can
                  make a platform charge certain; anything else says nothing,
                  which is `refundBalanceNote`'s own null branch. */}
              {refunding ? (() => {
                const note = refundBalanceNote(
                  accountForObject({ stripe_account_id: refunding.account })
                    ? 'direct'
                    : accountTypeOf(conn) === 'express' ? 'destination' : null,
                );
                return note ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{note}</Text>
                ) : null;
              })() : null}
              <Flag tone={t.warn} style={{ marginTop: sp.md }}>{REFUND_IS_FINAL}</Flag>
            </ScrollView>
            <View style={{ height: sp.md }} />
            <Cta wide
              disabled={!refundReady || refundBusy === refunding?.id}
              label={refundBusy === refunding?.id ? 'Refunding…' : refundWhole ? 'Refund What Is Left' : 'Refund This Amount'}
              onPress={() => {
                if (!refunding || !refundReady) return;
                // Whole sends NO amount at all, so the server resolves it from the
                // row rather than from anything this screen believes about it.
                if (refundWhole) confirmRefund(refunding, undefined, refundLeftMoney, false);
                else if (refundCents != null) confirmRefund(refunding, refundCents, refundMoney, refundCents < refundLeft);
              }} />
            <View style={{ height: sp.sm }} />
            <Ghost label="Cancel" onPress={() => setRefunding(null)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── change a package's name or price ────────────────────────────────
          The one thing a coach could not do without withdrawing the package
          and building a new one.
          The reprice sentence is the reason this is safe to offer at all: a
          coach who believes they have just put their existing clients up to the
          new rate has NOT, because connect-checkout inlines the price into each
          Stripe subscription at checkout and Stripe bills that one forever
          after. Telling them quietly would be worse than not offering it. */}
      {/* ── the keyboard covered this sheet ────────────────────────────────
          A bottom sheet is anchored to the bottom of the window, so the keyboard comes
          up OVER it: a package's name and its price are both typed below the fold.

          The fix a sheet takes is not the page one. `automaticallyAdjustKeyboardInsets`
          scrolls a focused row inside a scroller that stays where it is; here the whole
          sheet has to move. This wrapper is the pattern app/(trainer)/invoices.tsx,
          costs.tsx and receipts.tsx already use and the one on the picker in
          app/(trainer)/log-session.tsx: `behavior="padding"` pads the KAV, which shrinks
          the flex:1 scrim above the sheet and lifts the sheet with it — and the sheet's
          percentage maxHeight resolves against the shrunken box, so it stays whole
          instead of running off the top. */}
      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setEditing(null)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '86%', ...elevation.e2 }}>
            <Text style={{ ...ty.head, color: t.ink }}>Edit This Package</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md, marginBottom: sp.sm }}>Name</Text>
              <TextInput value={editName} onChangeText={(v) => { setEditName(v); if (editErr) setEditErr(null); }}
                placeholder="What your client sees" placeholderTextColor={t.ink3}
                accessibilityLabel="Package name"
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />

              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Price</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                {/* The package's OWN currency, shown and not editable. It is a
                    lookup that older `client_purchases` rows still fall back to
                    — part 132 added their currency column and rows before it are
                    null — so changing it here would redenominate sales that have
                    already happened. */}
                <Text style={{ ...ty.label, color: t.ink3 }}>{editing?.currency ? editing.currency.toUpperCase() : ''}</Text>
                <TextInput value={editPrice} onChangeText={(v) => { setEditPrice(v); if (editErr) setEditErr(null); }}
                  keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.ink3}
                  accessibilityLabel={`Price in ${editing?.currency ? editing.currency.toUpperCase() : 'this package’s currency'}`}
                  style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1 }} />
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                A package keeps the currency it was created in for its whole life. To sell in another one, withdraw this and create a new package.
              </Text>

              {/* Said only when the price has actually moved. A coach warned
                  about their subscribers every time they correct a typo stops
                  reading the warning, and this is the warning that matters. */}
              {editing && isReprice(editPatch() ?? {}, editing.price_cents) ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>{repriceNote(subCount)}</Flag>
              ) : null}

              {/* The rename warning, and it is a different warning. A price
                  edit cannot reach a sale already made; a NAME edit relabels
                  every one of them, because no sale carries a name of its own
                  and every list resolves one with a live package lookup. Said
                  only when the name has actually moved, for the same reason
                  the reprice note is. */}
              {editing && isRename(editPatch() ?? {}, editing.name) ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>{RENAME_RELABELS_HISTORY}</Flag>
              ) : null}

              {editing && (editing.sessions != null || editing.billing_interval) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {editing.billing_interval
                    ? 'How often this charges cannot be changed here — a running subscription bills on the schedule Stripe holds, and this screen would only be describing a different one.'
                    : 'How many sessions this grants cannot be changed here. Packs already bought keep the number they were sold with, so changing it would only alter what you believe you sold.'}
                </Text>
              ) : null}

              {editErr ? <Flag tone={t.crit} style={{ marginTop: sp.md }}>{editErr}</Flag> : null}
            </ScrollView>
            <View style={{ height: sp.md }} />
            <Cta wide disabled={editBusy} label={editBusy ? 'Saving…' : 'Save Changes'} onPress={() => { void saveEdit(); }} />
            <View style={{ height: sp.sm }} />
            <Ghost label="Cancel" onPress={() => setEditing(null)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
