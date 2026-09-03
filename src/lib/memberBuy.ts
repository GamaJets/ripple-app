// ── What a member can buy from their own gym, and what it costs them ────────
//
// The gym's price book has been readable by members since part 29:
// `membership_plans_tenant_r` and `gym_pass_types_tenant_r` publish it to
// anyone in the tenant. Nothing could ever be DONE with it. A member could read
// the price of the plan they were on and had no way to renew it, no way to move
// to another one, and no way to buy the day pass or the ten-class pack the same
// screen was quoting them.
//
// This module is the rules half of closing that. It is pure arithmetic and pure
// sentences: no supabase, no react-native, so `npm test` runs it. The reads and
// the checkout call sit at the bottom and take the Supabase client as an
// argument, the shape src/lib/memberRecord.ts and src/lib/gymPasses.ts already
// use.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE FOUR DECISIONS IN HERE, AND WHY EACH ONE IS WRITTEN DOWN
// ═══════════════════════════════════════════════════════════════════════════
//
// ── 1. WHOSE STRIPE ACCOUNT A GYM SALE LANDS ON ───────────────────────────
//
// A coach's package is sold on the COACH's account. A gym membership is the
// GYM's, and until part 280 the gym had no account for it to be sold on — so
// the temptation is to reach for the nearest one, which is the owner's own
// coach account. That would be a different company taking the money, and it
// would be invisible: the charge succeeds, the member is a member, and the
// wrong legal entity is the merchant of record for it.
//
// So `gym_connect_accounts` is per tenant, and `gym_orders.stripe_account_id`
// is NOT NULL and is written at the moment the Checkout Session is created,
// from the account the session was actually created on. Every later Stripe call
// about that order reads the column, never the gym's current setting. That is
// `accountForObject`'s rule in src/lib/directCharges.ts, applied to the other
// merchant.
//
// `gymCanSell` below is the gate, and it is deliberately the SAME rule as
// `canTakeDirectCharges`: a Standard account, card payments not explicitly
// inactive, charges enabled. The test asserts the two agree on every shape, so
// the gym path cannot drift into selling on an account the coach path would
// refuse. Only the sentences differ, because "this trainer has not finished
// verifying with Stripe" is the wrong noun in front of a member standing in a
// gym.
//
// ── 2. A SEAT AND A PAYMENT ARE NEVER THE SAME ACT ────────────────────────
//
// This is the decision that shaped what is here and what is not.
//
// Buying a class place and paying for it can fail independently, and both
// orders of failure are real. If the money lands and the seat is gone, the
// member has paid for a class they cannot attend. If the seat is taken and the
// money does not land, the gym is holding a place for somebody who has not
// paid, and the next member is told the class is full.
//
// src/lib/outbox.ts already refuses to queue a booking for the same family of
// reasons: "a seat is a scarce thing somebody else can take", and a promise to
// book later is one this app cannot keep. Payment makes it worse, not better,
// because a Stripe Checkout Session is completed on a web page in another app,
// minutes after the tap, and can be completed twice.
//
// So NOTHING here sells a seat. What a member buys from the gym is a
// MEMBERSHIP TERM or a PASS, and both are entitlements that are not scarce:
// the gym can issue any number of them, they do not run out while somebody is
// typing a card number, and nobody else can take one. The seat is booked
// afterwards, through the booking path that already exists in
// src/ui/classes.tsx, which touches no money at all and fails immediately and
// loudly when the class is full.
//
// The consequence is honest and worth stating plainly: a member who buys a
// ten-class pack and then finds every class full has a pack, not a grievance
// about a charge. The credit is still theirs and still spendable. A member who
// could have bought "a place in the 6am HIIT class" and found it gone would
// have paid for something specific that no longer exists, and the app would
// have had to reverse a live charge on the gym's ledger to fix it.
//
// This is why "classes" is not a purchasable thing in this module and why the
// class screen sends a member here to buy the credit instead.
//
// ── 3. A MEMBERSHIP IS SOLD ONE TERM AT A TIME ────────────────────────────
//
// It is not sold as a Stripe subscription. That is a decision, not an omission.
//
// A subscription is a standing promise to charge somebody's card every month
// without asking again, and honouring it needs a place to record the renewals,
// a way for the member to cancel, a way for them to reach their card when it
// expires, and a dunning path when it fails. `client_subscriptions` and
// `client_subscription_payments` are all of that for the COACH side and they
// took two parts (97 and 132) to get right. Half of it, shipped, is worse than
// none: a member who believes they are on auto-renew and is not turns up to a
// gym that will not let them in.
//
// So a purchase buys a TERM with a start date and an end date, both quoted
// before the card is touched and both stored on the order. A month plan bought
// on 1 October runs to 31 October and then stops, and the app says so in those
// words. Renewing is another purchase, and the member does it.
//
// Nothing here computes a renewal date for a membership the GYM sold at the
// desk, which is the trap `renewalNote` in src/lib/memberRecord.ts exists to
// refuse. This computes the term of a membership THIS APP is about to create,
// where the dates are ours to write and writing them is the opposite of
// inventing them.
//
// ── 4. THERE IS NO DEFAULT CURRENCY, AND THE PLAN CARRIES IT ──────────────
//
// Every price here comes from `membership_plans.currency` or
// `gym_pass_types.currency`, both NOT NULL since part 150, and never from
// `tenants.currency` — a plan priced last year in one currency was priced in
// that one whatever the gym charges in today. `minorMoney` in coachMoney.ts
// does the printing, so the zero-decimal currencies (there is no sen in a yen)
// and the three-decimal ones (a thousand fils in a dinar) are handled in the
// one place that knows about them.
import { canTakeDirectCharges, type ConnectAccountRow } from './directCharges';
import { expiryFor, type PassKind } from './gymPasses';
import { minorMoney } from './coachMoney';
import { localDate } from './localDate';
import { capLimit, capped } from './rowCap';
import { appLocale } from './locale';
import type { MemberMembership, PlanInterval, Standing } from './memberRecord';

/* ═══════════════════════════════════════════════════════════════════════════
   Can this gym take a payment at all?
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The four facts `my_gym_payment_readiness()` (part 280) returns about the
 * signed-in member's gym.
 *
 * `hasAccount` rather than the account id, because a member has no business
 * reading it and the only question the app asks is whether there is one.
 */
export interface GymAccountFacts {
  hasAccount: boolean;
  accountType: string | null;
  cardPaymentsStatus: string | null;
  chargesEnabled: boolean;
}

/**
 * The same four facts in the shape `canTakeDirectCharges` reads.
 *
 * Exported so the test can put one input through both functions. The account id
 * is a placeholder and is never sent anywhere: `canTakeDirectCharges` only asks
 * whether it is a non-empty string, and the real id is the edge function's
 * business, not a screen's.
 */
export function asConnectRow(f: GymAccountFacts): ConnectAccountRow {
  return {
    stripe_account_id: f.hasAccount ? 'acct_present' : null,
    account_type: f.accountType,
    card_payments_status: f.cardPaymentsStatus,
    charges_enabled: f.chargesEnabled,
  };
}

export type SellCheck = { ok: true } | { ok: false; reason: string };

/**
 * Can this gym take a card right now?
 *
 * Delegates the DECISION to `canTakeDirectCharges` and replaces only the
 * sentence. Three reasons a screen has to be able to tell apart, because a
 * member can act on one of them and on neither of the others:
 *
 *   no account at all   the gym has never started. Reception can.
 *   wrong kind          somebody set the account up in a way that cannot take
 *                       payments on its own. Nothing the member can do.
 *   not finished        Stripe is still verifying. It will clear on its own.
 *
 * `null` facts mean the gym has no row in `gym_connect_accounts` — zero rows
 * from the readiness function — which is the first of those. It is NOT the same
 * as a read that failed, and a caller that cannot tell those apart must say
 * nothing rather than say this.
 */
export function gymCanSell(facts: GymAccountFacts | null | undefined): SellCheck {
  if (!facts || !facts.hasAccount) {
    return { ok: false, reason: 'Your gym has not set up card payments yet, so nothing can be bought here. Reception can still take your money at the desk.' };
  }
  const verdict = canTakeDirectCharges(asConnectRow(facts));
  if (verdict.ok) return { ok: true };
  const status = (facts.cardPaymentsStatus || '').trim();
  if (status && status !== 'active') {
    return { ok: false, reason: 'Your gym is part way through setting up card payments with Stripe, so nothing can be bought here yet. It usually clears within a day.' };
  }
  if ((facts.accountType || '').trim().toLowerCase() !== 'standard') {
    return { ok: false, reason: 'Your gym’s payment account is not the kind that can take card payments in the app. Reception can take your money at the desk.' };
  }
  return { ok: false, reason: 'Your gym cannot take card payments yet, so nothing can be bought here. Reception can still take your money at the desk.' };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Terms
   ═══════════════════════════════════════════════════════════════════════════ */

// The term arithmetic lives in `./termDates`, which is a LEAF — it has no
// relative imports of its own. That is not tidiness: `gym-checkout` imports
// these four, Deno resolves an import specifier literally, and this file's six
// extensionless imports made the edge function throw on its first request. The
// rule and the incident are written up at the top of termDates.ts.
//
// Re-exported rather than moved out of sight, so every existing caller of
// `termFrom`/`termEnd`/`addDays`/`renewStart` from this module keeps working
// and there is still exactly one definition of each.
import { addDays, termEnd, termFrom, renewStart, parts, renewalIsContiguous, supersedeRow, type Term } from './termDates';
export { addDays, termEnd, termFrom, renewStart, parts, renewalIsContiguous, supersedeRow, type Term };

/**
 * Does this renewal carry straight on from the term it renews?
 *
 * It decides whether fulfilment EXTENDS the membership row or writes a NEW one,
 * and the difference is a claim about somebody's attendance record.
 *
 * A renewal bought before the current term runs out starts the very next day,
 * and extending `ends_on` on the existing row is exactly what a gym means by
 * renewing: one membership, running longer. A renewal bought after a lapse does
 * not: pushing `ends_on` out on the old row would leave a membership claiming
 * to have run continuously through weeks the member was not a member, and that
 * row is what an attendance or a billing dispute is settled against. Those get
 * a new row, and the gap between the two is visible because it is real.
 */

/**
 * What to write onto the membership an upgrade replaces.
 *
 * The member is moving to a different plan today, so the old term stops today
 * and the new one starts tomorrow's-equivalent: `newStartsOn` is the first day
 * of the new membership and the old one ends the day before it.
 *
 * Two things are deliberate.
 *
 * `status: 'expired'` rather than 'cancelled'. Nobody cancelled anything: they
 * bought something else. And the difference is visible to the member, because
 * `standingOf` reports an 'active' row past its end date as expired WITH
 * `stale: true`, which the membership screen renders as "Your gym still has
 * this marked active, but the end date has passed. Check at reception before
 * you travel in" — an alarming sentence about a perfectly ordinary upgrade.
 *
 * And `endsOn` is never earlier than `startedOn`. A member who upgrades on the
 * first day of a term would otherwise be given a membership that ended before
 * it began, which no screen in this app is written to describe and which the
 * date arithmetic in `daysBetween` would report as a negative run of days.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   What is on offer, and what the button on it says
   ═══════════════════════════════════════════════════════════════════════════ */

/** A plan as the buying screen needs it. The same columns
 *  `membership_plans_tenant_r` already publishes. */
export interface GymPlan {
  id: string;
  name: string;
  priceCents: number;
  currency: string | null;
  interval: PlanInterval;
}

/** A pass type as the buying screen needs it. */
export interface GymPassOffer {
  id: string;
  name: string;
  kind: PassKind;
  priceCents: number;
  currency: string | null;
  uses: number;
  validDays: number | null;
}

/**
 * What buying this plan would BE for this member.
 *
 * 'buy'      they hold no running membership, so this starts one.
 * 'renew'    this is the plan they are already on, and it has an end date to
 *            extend.
 * 'upgrade'  a different plan, taking over from the one they hold.
 * 'held'     the plan they are on, open-ended or one-off, with nothing to
 *            renew. Not a refusal and not an offer: a stated fact.
 * 'blocked'  the membership is frozen or starts in the future, and buying more
 *            of it in an app is not a decision this app should let somebody
 *            make alone.
 */
export type OfferKind = 'buy' | 'renew' | 'upgrade' | 'held' | 'blocked';

export interface Offer {
  kind: OfferKind;
  /** Title Case, for a <Cta label>. Null when there is no button. */
  label: string | null;
  /** Sentence case, under the price. Always present: a member reading a price
   *  is entitled to know what pressing the button would do to the membership
   *  they already have. */
  note: string;
  /** The first day of what they would be buying. Null when there is no offer. */
  startsOn: string | null;
  /** The last day of it, or null for an open-ended plan. */
  endsOn: string | null;
}

/**
 * The offer on one plan, given what the member holds today.
 *
 * `current` is the membership `primaryMembership` picked, and `standing` is
 * what `standingOf` says about it — passed in rather than recomputed, so this
 * function cannot disagree with the sentence printed beside it on the same
 * screen.
 */
export function offerFor(
  plan: GymPlan,
  current: MemberMembership | null,
  standing: Standing | null,
  today: string,
): Offer {
  const fresh = termFrom(today, plan.interval);

  if (!current || !standing || standing.kind === 'expired' || standing.kind === 'cancelled') {
    return {
      kind: 'buy',
      label: 'Buy This Plan',
      note: runNote(fresh, plan.interval),
      startsOn: fresh.startsOn,
      endsOn: fresh.endsOn,
    };
  }

  if (standing.kind === 'frozen') {
    return { kind: 'blocked', label: null, note: 'Your membership is frozen, so nothing can be bought against it here. Reception can restart it.', startsOn: null, endsOn: null };
  }
  if (standing.kind === 'upcoming') {
    return { kind: 'blocked', label: null, note: 'Your membership has not started yet, so there is nothing to renew or change until it does.', startsOn: null, endsOn: null };
  }

  // Running, on some plan. Is it this one?
  if (current.planId && current.planId === plan.id) {
    const from = renewStart(current, today);
    if (!from) {
      return {
        kind: 'held',
        label: null,
        note: plan.interval === 'once'
          ? 'This is the plan you are on. It was a one-off, so there is nothing to renew.'
          : 'This is the plan you are on. Your gym has not recorded an end date for it, so there is no term to extend here. Reception can tell you where it stands.',
        startsOn: null,
        endsOn: null,
      };
    }
    const term = termFrom(from, plan.interval);
    return {
      kind: 'renew',
      label: 'Renew This Plan',
      note: runNote(term, plan.interval),
      startsOn: term.startsOn,
      endsOn: term.endsOn,
    };
  }

  return {
    kind: 'upgrade',
    label: switchLabel(current.plan, plan),
    note: `${runNote(fresh, plan.interval)} The plan you are on now ends the day before that.`,
    startsOn: fresh.startsOn,
    endsOn: fresh.endsOn,
  };
}

/**
 * "Upgrade" only where it is demonstrably true.
 *
 * A price comparison across two currencies is not a comparison, so a plan whose
 * currency differs from the one held, or whose currency was not recorded, gets
 * the neutral word. Calling a cheaper plan an upgrade is a small lie that reads
 * as a sales line; calling a dearer one a switch costs nothing.
 */
export function switchLabel(held: GymPlan | { priceCents: number; currency: string | null } | null, next: GymPlan): string {
  const a = (held?.currency || '').trim().toUpperCase();
  const b = (next.currency || '').trim().toUpperCase();
  if (held && a && b && a === b && next.priceCents > held.priceCents) return 'Upgrade to This Plan';
  return 'Switch to This Plan';
}

/**
 * A bare ISO date as a member reads it.
 *
 * `localDate` rather than `new Date(iso)`: a date column is a calendar day in
 * the reader's own life, and parsing one as UTC midnight moves it to the
 * previous day for everybody west of Greenwich. `appLocale()` rather than a
 * literal tag, which `check:locale` fails the build on.
 */
export function dayLabel(day: string | null | undefined): string {
  const d = localDate(day ?? null);
  if (!d) return '';
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "Runs 1 October 2026 to 31 October 2026." Sentence case, and never a date
 *  that was not computed from a real start. */
function runNote(term: Term, interval: PlanInterval): string {
  if (interval === 'once') return `Starts ${dayLabel(term.startsOn)}. This is a one-off and does not renew.`;
  if (!term.endsOn) return `Starts ${dayLabel(term.startsOn)}.`;
  return `Runs ${dayLabel(term.startsOn)} to ${dayLabel(term.endsOn)}.`;
}

/** What one pass buys, said out loud beside its price. `uses` is a count and
 *  the name rarely states it: "Kickstart Ten" does not tell anybody it is ten
 *  visits. */
export function passNote(p: GymPassOffer, today: string): string {
  const visits = p.uses === 1 ? 'One visit' : `${p.uses} visits`;
  const expires = expiryFor(today, p.validDays);
  const life = expires ? ` Valid until ${dayLabel(expires)} if you buy it today.` : ' It does not expire.';
  return `${visits}.${life}`;
}

/** An amount from the price book, in the currency the row itself carries. Null
 *  when either half is missing, which the caller renders as a dash. */
export const offerMoney = (cents: number | null | undefined, currency: string | null | undefined): string | null =>
  minorMoney(cents, currency);

/** The passes a member may buy in the app. A guest pass is deliberately not one
 *  of them: `gym_passes` needs a holder who is not the buyer, and there is no
 *  screen here that collects a guest's name. Reception sells those. */
export const BUYABLE_PASS_KINDS: readonly PassKind[] = ['drop_in', 'pack'];
export const isBuyablePass = (k: PassKind | null | undefined): boolean =>
  !!k && (BUYABLE_PASS_KINDS as readonly string[]).includes(k);

/* ═══════════════════════════════════════════════════════════════════════════
   Orders
   ═══════════════════════════════════════════════════════════════════════════ */

export type OrderStatus = 'pending' | 'paid' | 'abandoned' | 'failed';
export type OrderKind = 'membership' | 'pass';
export type OrderIntent = 'new' | 'renew' | 'upgrade';

export interface GymOrder {
  id: string;
  kind: OrderKind;
  intent: OrderIntent;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  termStartsOn: string | null;
  termEndsOn: string | null;
  usesTotal: number | null;
  expiresOn: string | null;
  createdAt: string;
  paidAt: string | null;
}

/**
 * What to say about an order that is not 'paid'.
 *
 * Null for a paid one: the thing it bought is on screen elsewhere and repeating
 * "this was paid" beside a membership is noise. Every other state gets a
 * sentence, and the delicate one is 'failed' — Stripe took the money and the
 * entitlement could not be written. Saying nothing there leaves somebody who
 * has paid looking at a screen that shows no membership, which is the single
 * worst sentence this app can show a person by omission.
 */
export function orderNote(o: Pick<GymOrder, 'status' | 'kind'>): string | null {
  const what = o.kind === 'membership' ? 'membership' : 'pass';
  switch (o.status) {
    case 'paid': return null;
    case 'pending': return `You started buying this ${what} and Stripe has not confirmed it yet. Nothing has been added until it does, and nothing is charged if you closed the page.`;
    case 'abandoned': return `This ${what} was not paid for, so nothing was added and nothing was charged.`;
    case 'failed': return `Your payment for this ${what} went through and we could not add it to your account. Nothing has been taken from you twice. Show this to reception and they can put it right.`;
  }
}

/** True while an order is worth showing a member at all. A paid one is
 *  represented by the membership or pass it created; an abandoned one is
 *  clutter after the day it happened. */
export const orderIsLive = (o: Pick<GymOrder, 'status'>): boolean =>
  o.status === 'pending' || o.status === 'failed';

/* ═══════════════════════════════════════════════════════════════════════════
   The reads
   ═══════════════════════════════════════════════════════════════════════════ */

type Queryable = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  functions: { invoke: (name: string, opts: { body: unknown }) => Promise<{ data: any; error: any }> };
};

/** A read that either landed or did not. The same type memberRecord.ts uses,
 *  and for the same reason: `{ ok: false }` is not an empty array. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

const asInterval = (v: unknown): PlanInterval => (v === 'year' || v === 'once' ? v : 'month');
const asKind = (v: unknown): PassKind => (v === 'guest' || v === 'pack' ? v : 'drop_in');

/**
 * Whether the member's gym can take a card.
 *
 * Three outcomes and they are three different sentences: `ok: false` is a read
 * that did not land and says nothing about the gym, `value: null` is a gym with
 * no Stripe account at all, and a value is the four facts `gymCanSell` judges.
 */
export async function fetchGymPaymentFacts(sb: Queryable): Promise<Read<GymAccountFacts | null>> {
  try {
    const { data, error } = await sb.rpc('my_gym_payment_readiness');
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: true, value: null };
    return { ok: true, value: {
      hasAccount: row.has_account === true,
      accountType: typeof row.account_type === 'string' && row.account_type.trim() ? row.account_type : null,
      cardPaymentsStatus: typeof row.card_payments_status === 'string' && row.card_payments_status.trim() ? row.card_payments_status : null,
      chargesEnabled: row.charges_enabled === true,
    } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/** Every plan the gym currently sells, cheapest first. `[]` means it sells
 *  none, which is a real state for a gym that runs on day passes. */
export async function fetchGymPlans(sb: Queryable): Promise<Read<GymPlan[]>> {
  try {
    const { data, error } = await sb.from('membership_plans')
      .select('id, name, price_cents, currency, interval, active')
      .eq('active', true)
      .order('price_cents', { ascending: true });
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    return { ok: true, value: ((data as any[]) ?? []).map((r): GymPlan => ({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : '',
      priceCents: Number(r.price_cents),
      currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
      interval: asInterval(r.interval),
    })) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/** The drop-ins and class packs the gym sells. Guest passes are filtered out
 *  here rather than hidden by the screen, so nothing downstream can offer one
 *  by accident. */
export async function fetchGymPassOffers(sb: Queryable): Promise<Read<GymPassOffer[]>> {
  try {
    const { data, error } = await sb.from('gym_pass_types')
      .select('id, name, kind, price_cents, currency, uses, valid_days, active')
      .eq('active', true)
      .order('price_cents', { ascending: true });
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    const rows = ((data as any[]) ?? []).map((r): GymPassOffer => ({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : '',
      kind: asKind(r.kind),
      priceCents: Number(r.price_cents),
      currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
      uses: Number.isFinite(Number(r.uses)) ? Number(r.uses) : 1,
      validDays: r.valid_days == null ? null : Number(r.valid_days),
    }));
    return { ok: true, value: rows.filter((r) => isBuyablePass(r.kind)) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/**
 * How many of the member's own orders this screen reads.
 *
 * Fifty, as it always was — this is a phone screen and nobody scrolls a
 * thousand receipts. What changed is that it is now asked for as `capLimit(50)`
 * and the fifty-first row is used as a PROBE rather than shown, so a member
 * with more than fifty can be told so.
 */
export const MY_ORDERS_CAP = 50;

/** The member's own orders, newest first, and whether that is all of them.
 *
 *  `truncated` exists because of what this list feeds: the "Waiting On Stripe"
 *  section of app/(client)/gym-plans.tsx, which is the one screen in the app
 *  that tells somebody their card was charged and nothing was granted. A
 *  drop-in buyer passes fifty orders inside a year, and before this the
 *  fifty-first fell off the window with the header still printing a confident
 *  count over the fifty that remained. A prefix rendered as a total is the
 *  defect src/lib/rowCap.ts exists for; this is that module's rule applied to a
 *  hand-set limit rather than to PostgREST's. */
export interface MyGymOrders {
  orders: GymOrder[];
  /** True when the member has more orders than were read. The screen reports
   *  'partial', never 'ready'. */
  truncated: boolean;
}

export async function fetchMyGymOrders(sb: Queryable, uid: string): Promise<Read<MyGymOrders>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('gym_orders')
      .select('id, kind, intent, status, amount_cents, currency, term_starts_on, term_ends_on, uses_total, expires_on, created_at, paid_at')
      .eq('member_id', uid)
      .order('created_at', { ascending: false })
      .limit(capLimit(MY_ORDERS_CAP));
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    // `capped` rather than a slice and a boolean: the probe row is not data and
    // must not reach the screen, and the flag must not be computed anywhere the
    // slice is not.
    const page = capped((data as any[]) ?? [], MY_ORDERS_CAP);
    return { ok: true, value: { truncated: page.truncated, orders: page.rows.map((r): GymOrder => ({
      id: r.id,
      kind: r.kind === 'pass' ? 'pass' : 'membership',
      intent: r.intent === 'renew' || r.intent === 'upgrade' ? r.intent : 'new',
      status: r.status === 'paid' || r.status === 'abandoned' || r.status === 'failed' ? r.status : 'pending',
      amountCents: Number(r.amount_cents),
      currency: typeof r.currency === 'string' ? r.currency : '',
      termStartsOn: r.term_starts_on ?? null,
      termEndsOn: r.term_ends_on ?? null,
      usesTotal: r.uses_total == null ? null : Number(r.uses_total),
      expiresOn: r.expires_on ?? null,
      createdAt: r.created_at,
      paidAt: r.paid_at ?? null,
    })) } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/** What the checkout call is asked for. Nothing about price or dates is sent:
 *  the server reads the plan itself and quotes it, so a client that lies about
 *  a price is lying to itself. */
export interface BuyRequest {
  kind: OrderKind;
  planId?: string;
  passTypeId?: string;
  intent: OrderIntent;
  /** The membership a renewal extends or an upgrade replaces. The server checks
   *  it belongs to the caller; sending it saves the server guessing which of
   *  several memberships was on screen. */
  supersedesMembershipId?: string | null;
  /**
   * The calendar day the BUYER is standing in, as a bare ISO date.
   *
   * Sent because the server is UTC and a membership term is a run of days in
   * the member's own life: a member in Kiritimati at one in the morning is a
   * day ahead of the server and one in Midway is most of a day behind, so a
   * term quoted from the server's own date starts on a day that is not theirs.
   * The server CLAMPS it to within one day of its own, which is the real range
   * of earth's timezones, because this value decides the start and end dates of
   * somebody's membership and a field a caller controls without limit is a
   * field a caller can set to any year.
   */
  today: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Start a gym checkout. Returns the Stripe URL for the caller to open.
 *
 * The URL is returned rather than opened here, so this module stays free of
 * react-native and can be run under `npm test`. The screen opens it.
 */
export async function startGymCheckout(sb: Queryable, req: BuyRequest): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await sb.functions.invoke('gym-checkout', {
      body: {
        kind: req.kind,
        plan_id: req.planId ?? null,
        pass_type_id: req.passTypeId ?? null,
        intent: req.intent,
        supersedes_membership_id: req.supersedesMembershipId ?? null,
        today: req.today,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
      },
    });
    if (error) return { ok: false, error: error.message };
    if (data?.url) return { ok: true, url: String(data.url) };
    return { ok: false, error: data?.error || 'Could not start checkout.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
