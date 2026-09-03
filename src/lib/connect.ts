// Stripe Connect (marketplace) — trainers get paid by their clients. Trainers
// onboard an Express account and sell packages (memberships / session-packs);
// clients buy via Stripe Checkout, funds go to the trainer minus the platform fee.
// Trainers manage packages directly (RLS); money flows through the connect-* edge
// functions. Credential-ready: activates once Stripe Connect is enabled + keys set.
import { Linking } from 'react-native';
import { appLink, WEB_ORIGIN } from './deepLink';
import { supabase } from './supabase';
import { reportError } from './reportError';
import { capLimit, capped, TruncatedRead, ROW_CAP } from './rowCap';
import { writeFailure } from './wroteRows';
import { packBalance, readDraw, drew, drawReason, type DrawOutcome, type PackPurchase, type PackBalance } from './packDraw';
import { PACKAGE_NOT_SAVED, packageEditBlocker, packageUpdateRow, type PackagePatch } from './packageEdit';
import { subState } from './subscriptionScope';
import type { CreditSession } from './sessionCredits';
import type { PromoCode } from './packagePromo';
import type { LoadStatus } from '../ui/loadStatus';

/**
 * What the app knows about a trainer's payout account.
 *
 * `account_type` is Stripe's own word for what the account IS, and it is on
 * this type because the payments screen has to tell a coach the truth about
 * their own money. The two arrangements say opposite things: on a STANDARD
 * account the coach is the merchant of record, so Stripe's processing fees come
 * out of their balance, refunds and chargebacks are theirs, and their dashboard
 * is the full one at dashboard.stripe.com. On the legacy EXPRESS accounts every
 * coach onboarded before part 161 has, Repple is the merchant of record and
 * they have the Express Dashboard instead. One sentence cannot be true of both,
 * so the screen reads this column rather than assuming.
 *
 * Null means nobody has asked Stripe yet — a row from before part 161 that has
 * not been touched by `connect-onboard` or an `account.updated` since. The
 * screen says nothing about fees or dashboards in that case rather than
 * guessing, which is the same rule the rest of it follows about money.
 */
export interface ConnectStatus { stripe_account_id: string | null; charges_enabled: boolean; details_submitted: boolean; account_type: string | null }
/**
 * A thing a trainer sells.
 *
 * `sessions` and `billing_interval` are the two axes, and part 97 forbids both
 * at once: null/null is a one-off membership, N sessions is a pack bought once
 * and drawn down, and 'month'/'year' is a subscription that charges again.
 *
 * `currency` is per package and is the only currency any figure about that
 * package may be printed in — never a literal, and never the gym's current
 * setting either, because a package sold last year in one currency was sold in
 * that one whatever the gym charges in today.
 *
 * The column still carries `default 'usd'` from 21-connect, which predates the
 * product being white-labelled and should inherit the tenant's currency
 * instead. Nothing in this file relies on it: `createPackage` refuses to insert
 * without an explicit currency, so the default is never the value that lands.
 * See `pkgMoney` in src/lib/subscriptions.ts and tenants.currency in part 99.
 */
export interface TrainerPackage { id: string; trainer_id: string; name: string; price_cents: number; currency: string; sessions: number | null; billing_interval: string | null; active: boolean;
  /** How many days the buyer has to use a session pack, from the day they buy
   *  it (part 612). Null means it does not expire, which is every package sold
   *  before that part and every one whose coach chose not to state a window —
   *  there is no default here and there must never be one, because a default
   *  would put a deadline on every pack every coach on this platform already
   *  sells. Read ONCE, at checkout, and copied on to
   *  `client_purchases.expires_on`; changing it never reaches a pack somebody
   *  has already bought. `readValidityDays` in src/lib/packExpiry.ts is what
   *  reads it out of the coach's own typing. */
  validity_days?: number | null }
/** A completed one-off sale. `client_id` was missing from this type for as long
 *  as every function reading the table filtered on it — the client-side reads
 *  never needed to look at a column they were already scoped by. The coach-side
 *  read below is scoped by `trainer_id`, so who bought it is the thing it has to
 *  say. The `currency` field below is part 132's column and it is the unit the
 *  money actually moved in; the note under it says what happens to the small
 *  set of rows that predate it. This comment used to end "there is no currency
 *  column on this table at all", which the column immediately underneath it
 *  contradicted. */
export interface Purchase { id: string; client_id: string | null; trainer_id: string | null; package_id: string | null; amount_cents: number | null; sessions_total: number | null; sessions_used: number; status: string; created_at: string;
  /** The unit this sale's money actually moved in, written at checkout from
   *  the Stripe session (part 132). Null on rows written before that column
   *  existed whose package has since been deleted — genuinely unrecoverable,
   *  and reported as an amount missing from a total rather than summed into
   *  one. Not to be confused with the package's currency, which is a lookup
   *  that can change underneath a sale that already happened. */
  currency?: string | null;
  /** Minor units already given back (part 192). ZERO, never null, on a sale
   *  nobody has refunded — the column has a default and this app writes it only
   *  from Stripe's own answer. A screen reads it to say what still stands, and
   *  `sumTaken` is deliberately NOT given the net figure: gross is what the
   *  client was charged and it is what every takings line in this app has always
   *  meant, so a refund is shown BESIDE the sale rather than silently inside it. */
  refunded_cents?: number | null;
  /** When the LAST refund on this sale was made, or null because there has been
   *  none. Not the only one: Stripe holds the full list of refund objects and
   *  this app deliberately does not duplicate them. */
  refunded_at?: string | null;
  /** The Checkout Session, which is what a refund is traced back to. Selected
   *  by the coach-side read so the screen can tell a sale that CAN be refunded
   *  from one recorded by other means. */
  stripe_session_id?: string | null;
  /** The Stripe Customer this sale was charged to, on the account named by
   *  `stripe_account_id` (part 282). Null on every sale made before Checkout
   *  was asked to create one, and null is a sentence rather than a dead button:
   *  there is no Customer at Stripe to open a billing portal for and one cannot
   *  be manufactured afterwards. `portalPurchase` is what picks a row that has
   *  one. */
  stripe_customer_id?: string | null;
  /** The last day the credits on this pack can be used, stamped at checkout
   *  from the package's `validity_days` as it stood THAT DAY (part 612). Null
   *  means no window, which is every pack sold before that part. Never
   *  recomputed: a window read off `trainer_packages` at render time would let a
   *  coach void every credit their existing clients hold by editing a package.
   *  See src/lib/packExpiry.ts. */
  expires_on?: string | null;
  /** When `run_pack_expiry()` closed the window on this pack, or null because
   *  it has not been closed. Until it is written the credits are genuinely
   *  still spendable, which is why the app reads this column rather than
   *  comparing `expires_on` to the clock itself. */
  expired_at?: string | null;
  /** Credits the window closed on unspent. Zero means none were lost, never
   *  unknown. `sessions_total` has already had them taken off it, so this is
   *  the only place the size of what somebody paid for and did not take
   *  survives — and stating it is the whole difference between an expiry and a
   *  silent zero. */
  sessions_expired?: number | null;
  /** The Stripe PaymentIntent this sale was charged on (part 610), which is
   *  what `charge.refunded` and `charge.dispute.*` carry. Null on every sale
   *  made before that part; the webhook walks back through
   *  `checkout.sessions.list` for those. */
  stripe_payment_intent?: string | null;
  /** Stripe's `amount_total` minus the total connect-checkout PREDICTED when it
   *  worked this sale's platform fee out (part 311). NULL on every sale where
   *  nothing was predicted — which is every sale with no discount code on it,
   *  and every sale made before the column existed — 0 where a prediction was
   *  made and Stripe agreed with it, and a signed difference otherwise. The
   *  three are different facts: null is "never checked" and 0 is "checked and
   *  right", and `feeMismatches` in coachMoney.ts is what keeps them apart. */
  fee_variance_cents?: number | string | null;
  /** The connected account this sale was charged ON, or null for the platform
   *  (part 161). Written from the Checkout Session's metadata by the webhook,
   *  and it is a fact about THIS SALE rather than about the coach's current
   *  setting — a coach who has since moved to direct charges still has older
   *  sales on the platform. connect-refund reads it to pick the Stripe context;
   *  the screen reads it to say whose balance a refund is about to leave, which
   *  is a different sentence on each model. */
  stripe_account_id?: string | null }

const openUrl = async (url?: string | null) => { if (url) { try { await Linking.openURL(url); } catch { /* ignore */ } } };

/**
 * Start / resume Stripe Connect onboarding for the signed-in trainer.
 *
 * ── Why these two URLs are https and not app links ────────────────────────
 *
 * They used to be `appLink('connect/return')`, which is a CUSTOM SCHEME —
 * `repplecoach://connect/return`. Stripe's account-links documentation says
 * `return_url` and `refresh_url` "can only use HTTPS in live mode", so a custom
 * scheme works in test and is refused the day Connect goes live. Nobody had hit
 * it because live Connect had never run: it would have surfaced as the first
 * real coach failing to onboard, at the moment they were handing Stripe their
 * passport and their bank details.
 *
 * `WEB_ORIGIN` rather than a literal, because it is per brand — a white-label
 * chain's coach must not be redirected onto Repple's website halfway through
 * setting up their own payouts. web/connect-return.html and
 * web/connect-refresh.html hand off back into the app from there, and each
 * explains in its own header what Stripe means by landing there.
 */
export async function startTrainerOnboarding(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-onboard', { body: { refresh_url: `${WEB_ORIGIN}/connect-refresh`, return_url: `${WEB_ORIGIN}/connect-return` } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start onboarding.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** The signed-in trainer's Connect account status. */
export async function fetchMyConnect(): Promise<ConnectStatus | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    // A refused read used to fall through to the same default a trainer with no
    // account gets — telling somebody who IS set up for payments that they are
    // not. null means "could not read"; the caller renders that differently.
    const { data, error } = await supabase.from('connect_accounts').select('*').eq('trainer_id', uid).maybeSingle();
    if (error) { reportError('connect.fetchMyConnect', error); return null; }
    return (data as ConnectStatus) ?? { stripe_account_id: null, charges_enabled: false, details_submitted: false, account_type: null };
  } catch { return null; }
}

/**
 * Packages the signed-in trainer sells.
 *
 * `[]` means they sell none. **`null` means we could not read them**, which the
 * payments screen must not render as "no packages yet" — a trainer told that
 * about their own price list will build it a second time, and their clients see
 * duplicates of everything they already sell.
 */
export async function fetchMyPackages(): Promise<TrainerPackage[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase.from('trainer_packages').select('*').eq('trainer_id', uid).order('created_at', { ascending: false });
    if (error) return null;
    return (data as TrainerPackage[]) ?? [];
  } catch { return null; }
}

/**
 * Put a package on sale.
 *
 * `billing_interval` omitted or null keeps the behaviour every existing caller
 * had: a one-off charge. 'month' or 'year' makes it a subscription, and the
 * client is then charged again every month or year until somebody stops it —
 * which is a large enough difference that it is never inferred from anything,
 * only ever passed in explicitly.
 */
export async function createPackage(p: { name: string; price_cents: number; sessions: number | null; currency: string; billing_interval?: 'month' | 'year' | null; validity_days?: number | null }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false, error: 'Not signed in.' };
    // No fallback currency, on purpose. This used to be `p.currency || 'usd'`,
    // which is a literal that silently applies — and Repple is white-labelled,
    // so there is no currency that is right for both a London gym and a Dubai
    // one. A package with no currency is not created; the coach is told the gym
    // has not set one. See tenants.currency (part 99).
    const currency = (p.currency || '').trim();
    if (!currency) return { ok: false, error: 'Your gym has not set a currency yet, so there is nothing to price this in. An owner sets it in the gym settings.' };
    const interval = p.billing_interval ?? null;
    // Part 97 refuses this combination in the database; refusing it here too
    // turns a constraint violation into a sentence. A recurring pack would
    // charge again every month for credits that are granted once.
    if (interval && p.sessions != null) return { ok: false, error: 'A recurring package cannot also be a session pack — sessions are granted once and nothing renews them.' };
    // How long the buyer has to use the sessions, or null for a pack that does
    // not expire — which is every package this app has ever sold, and stays the
    // answer for anybody who leaves the field empty. No fallback and no
    // default, for the reason there is none on `currency` two lines up: thirty
    // days and ninety days are conventions in somebody's trade in somebody's
    // country, and a literal here would silently put a deadline on every pack
    // every coach on this platform sells. See src/lib/packExpiry.ts.
    const validity = p.validity_days ?? null;
    // Part 612 refuses this combination in the database; refusing it here turns
    // a constraint violation into a sentence. A membership has no credits to run
    // out of — it is stopped by cancelling it, and a validity on one would be a
    // second, silent way for it to end.
    if (validity != null && p.sessions == null) return { ok: false, error: 'Only a session pack can run out of time. A membership is stopped by cancelling it, not by a date.' };
    if (validity != null && (!Number.isInteger(validity) || validity <= 0)) return { ok: false, error: 'A validity has to be a whole number of days, or nothing at all for a pack that does not expire.' };
    const { error } = await supabase.from('trainer_packages').insert({ trainer_id: uid, name: p.name, price_cents: p.price_cents, sessions: p.sessions, billing_interval: interval, currency, validity_days: validity, active: true });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Change a package's name or its price.
 *
 * ── The gap between create and deactivate ─────────────────────────────────
 *
 * There was nothing here. A coach raising their rate had to withdraw the old
 * package and create a new one, which orphans the price history — the old row
 * survives with `active = false` and every sale still points at it — and leaves
 * anybody already subscribed pointing at a package their coach considers gone.
 *
 * ── Why a price edit is safe, established rather than assumed ─────────────
 *
 * This is somebody else's card, so "probably fine" is not the standard.
 * supabase/functions/connect-checkout builds every session with an INLINE price
 * — `price_data: { currency, unit_amount: pkg.price_cents, recurring: { … } }`
 * — rather than referencing a stored Stripe Price, so Stripe materialises that
 * amount onto the subscription at checkout and never consults this column
 * again. `client_subscriptions` carries its own `amount_cents`, and
 * app/(trainer)/payments.tsx renders every subscriber from THOSE columns, so
 * the coach's own screen keeps showing each person the figure they really pay.
 * `client_purchases.amount_cents` is written at checkout too, so a completed
 * sale is a fixed record.
 *
 * A reprice is therefore forward-looking. What it must never be is QUIET: a
 * coach who believes they have just put everybody up to the new rate has not,
 * and would find out a year later. `repriceNote` in src/lib/packageEdit.ts is
 * that sentence and the caller is expected to show it.
 *
 * ── Three fields this will not touch ──────────────────────────────────────
 *
 * Currency, sessions and billing_interval. src/lib/packageEdit.ts holds the
 * argument for each; the short version is that a package's currency is a lookup
 * older `client_purchases` rows still fall back to, and the other two are what
 * the product IS rather than what it costs. `packageUpdateRow` is what enforces
 * it — this function never assembles a row of its own.
 *
 * Returns whether the package actually changed, counted. `pkg_write` is
 * `trainer_id = auth.uid()` while `pkg_read` publishes every ACTIVE package to
 * everybody, so an id this coach can SEE is not necessarily one they may write,
 * and an UPDATE matching no row comes back 204 with `error` null — the same
 * proof `deactivatePackage` below needs, for the same reason. A coach told
 * their new price is live when it is not sells at the old one indefinitely.
 */
export async function updatePackage(id: string, patch: PackagePatch): Promise<{ ok: boolean; error?: string }> {
  const blocker = packageEditBlocker(patch);
  if (blocker) return { ok: false, error: blocker };
  const row = packageUpdateRow(patch);
  // Unreachable while the blocker above is the same rule, and here so that a
  // future divergence between the two produces a refusal rather than an
  // unvalidated write to somebody's price list.
  if (!row) return { ok: false, error: PACKAGE_NOT_SAVED };
  try {
    const r = await supabase.from('trainer_packages').update(row, { count: 'exact' }).eq('id', id);
    if (r.error) reportError('connect.updatePackage', r.error);
    const failure = writeFailure('That package', r);
    return failure === null ? { ok: true } : { ok: false, error: PACKAGE_NOT_SAVED };
  } catch (e) {
    reportError('connect.updatePackage', e);
    return { ok: false, error: PACKAGE_NOT_SAVED };
  }
}

/**
 * How many people are currently being billed against one package.
 *
 * `null` means it could not be established, and that is a different answer from
 * zero in the one place it matters: the sentence a coach reads before they
 * reprice. "Nobody is on the old rate" is a fact about their income and must
 * come from a read that answered.
 *
 * `subState()` in src/lib/subscriptionScope.ts owns which Stripe statuses count
 * as live — 'trialing', 'active' and 'past_due' — so this does not re-decide
 * it. A past_due subscriber IS on the old rate: their card failed, the
 * subscription has not ended, and repricing the package does not touch them.
 */
export async function countActiveSubscribers(packageId: string): Promise<number | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase.from('client_subscriptions').select('status')
      .eq('package_id', packageId).eq('trainer_id', uid).limit(capLimit());
    if (error) { reportError('connect.countActiveSubscribers', error); return null; }
    const page = capped((data as { status: string | null }[]) ?? []);
    // A truncated read cannot produce a count. It would produce a floor, and a
    // floor reported as a count is how "4 people are on the old rate" becomes
    // the sentence for a package with two hundred.
    if (page.truncated) return null;
    return page.rows.filter((r) => subState(r.status) === 'live').length;
  } catch (e) { reportError('connect.countActiveSubscribers', e); return null; }
}

/**
 * Stop selling a package. Returns whether it actually stopped.
 *
 * Returned void and swallowed the error, so the screen refreshed and said
 * nothing either way — a trainer who "removed" a package that is still on sale
 * keeps selling something they believe they withdrew, and finds out when
 * somebody buys it.
 */
export async function deactivatePackage(id: string): Promise<boolean> {
  try {
    // `!error` was not "whether it actually stopped", which is what the line
    // above promises and what payments.tsx branches on. `pkg_write` is
    // `trainer_id = auth.uid()`, and `pkg_read` publishes every ACTIVE package
    // to everybody — so an id this trainer can see is not necessarily one they
    // may write, and an UPDATE matching no row comes back 204 with `error`
    // null. Proved live against phgfwzpkkwdysftlgkoq with a second seeded
    // coach: SELECT of the other coach's active package returned 1 row, the
    // UPDATE of it affected 0 and raised nothing.
    //
    // A stale id does the same thing, which is the version that reaches a
    // trainer with one account: the list is from before a refresh, the package
    // was already withdrawn elsewhere, and the screen confirms a second
    // withdrawal that changed nothing. The count is the only proof there is.
    const r = await supabase.from('trainer_packages').update({ active: false }, { count: 'exact' }).eq('id', id);
    return writeFailure('That package', r) === null;
  } catch { return false; }
}

/**
 * Active packages a client can buy from a given trainer.
 *
 * `[]` means this trainer sells none. **`null` means we could not read them** —
 * the same distinction fetchMyPackages already makes, and this twin did not.
 * A client shown "this coach sells nothing" because a read failed is a lost
 * sale explained as a fact about the coach.
 */
export async function fetchTrainerPackages(trainerId: string): Promise<TrainerPackage[] | null> {
  try {
    const { data, error } = await supabase.from('trainer_packages').select('*').eq('trainer_id', trainerId).eq('active', true).order('price_cents', { ascending: true });
    if (error) { reportError('connect.fetchTrainerPackages', error); return null; }
    return (data as TrainerPackage[]) ?? [];
  } catch { return null; }
}

/**
 * The currency each of a set of packages is priced in.
 *
 * `client_purchases` DOES carry its own `currency` (part 132, written at
 * checkout from the Stripe session), and this comment said the opposite for
 * long enough to be worth correcting rather than deleting: it read "records
 * `amount_cents` and no currency at all", which stopped being true the day the
 * webhook started writing the column and was still here afterwards. The
 * fallback below is what remains of it — the only rows that still need a
 * package to name their unit are the ones written BEFORE part 132 whose
 * package the backfill could not reach. That makes an amount unlabelled whenever the package row is
 * actually GONE — deleted, not merely withdrawn — and an unlabelled amount
 * renders as a dash rather than as a number in a currency we picked. A
 * withdrawn package used to land here too, because pkg_read was `active or
 * trainer_id = auth.uid()`; part 147 gives the buyer their own purchases back,
 * so a coach retiring a pack no longer un-labels the money somebody paid.
 *
 * Ids absent from the returned map are ids we could not label. A read that
 * fails returns an empty map, which lands in the same place: dashes, not
 * dollars.
 */
export async function packageCurrencies(ids: string[]): Promise<Map<string, string>> {
  const labelled = await packageLabels(ids);
  const out = new Map<string, string>();
  labelled.forEach((v, k) => { if (v.currency) out.set(k, v.currency); });
  return out;
}

/**
 * The name AND the currency of a set of packages, in one read.
 *
 * Both live on the same row and both are missing in the same circumstances, so
 * fetching them separately was two round trips that could disagree. What a
 * client can see of that row is decided by `pkg_read`. Since part 147 that is:
 * my own row, my current coach's rows that are still on sale, and — the arm
 * this function depends on — every package I have actually bought or subscribed
 * to, on sale or not, from a current coach or a former one. So a withdrawn pack
 * a client paid for still labels itself. A package actually DELETED is
 * unreadable to everybody, and that is the only case left that lands below.
 *
 * An id absent from the map is a package we could not read. That is not a
 * package with no name and no currency: the screen DESCRIBES such a pack by its
 * size (`packLabel` in packDraw.ts) rather than naming it, and prints a dash
 * where the amount would go rather than a figure in a currency we chose.
 */
export async function packageLabels(ids: string[]): Promise<Map<string, { name: string | null; currency: string | null }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  try {
    const { data, error } = await supabase.from('trainer_packages').select('id, name, currency').in('id', unique).limit(capLimit());
    if (error) { reportError('connect.packageLabels', error); return new Map(); }
    const out = new Map<string, { name: string | null; currency: string | null }>();
    ((data as { id: string; name: string | null; currency: string | null }[]) ?? []).forEach((p) => {
      if (p?.id) out.set(p.id, { name: (p.name || '').trim() || null, currency: (p.currency || '').trim() || null });
    });
    return out;
  } catch (e) { reportError('connect.packageLabels', e); return new Map(); }
}

/**
 * Client buys a package → Stripe Checkout (funds to the trainer, minus fee).
 *
 * `code` is the coach's own discount code, as the client typed it. It used not
 * to be here at all, and the reason it is now is `oneOffDiscount` in
 * src/lib/packagePromo.ts: Repple's cut on a one-off is an absolute figure
 * Stripe wants in the same call it works the discount out in, so a code can
 * only be honoured where the discounted total is knowable exactly beforehand —
 * which it is for an amount off in the package's own currency, and for a
 * percentage that divides the price without rounding.
 *
 * Sending one is not the same as it being accepted. connect-checkout resolves
 * the coupon on the coach's Stripe account and refuses every shape it cannot
 * state exactly, before anything is charged. Omitted means no code, which is
 * the ordinary case and takes the path it always did.
 */
export async function buyPackage(packageId: string, code?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const promo = String(code ?? '').trim();
    const { data, error } = await supabase.functions.invoke('connect-checkout', { body: { package_id: packageId, success_url: appLink('purchase/success'), cancel_url: appLink('purchase/cancel'), ...(promo ? { promo_code: promo } : {}) } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start checkout.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Open the Stripe billing portal for a ONE-OFF purchase.
 *
 * The twin of `openSubscriptionPortal` in src/lib/subscriptions.ts, for the
 * client who never subscribed to anything. That function takes a subscription
 * id and finds the Stripe Customer on the subscription row; a client who has
 * only ever bought session packs has no such row, which is why
 * app/(client)/packages.tsx could only draw the button inside its list of live
 * subscriptions — and why somebody with three packs and no subscription had no
 * invoice, no card management and no route to a refund at all.
 *
 * `client_purchases.stripe_customer_id` (part 282) is what this opens, and the
 * server opens it in the purchase's OWN account context: a Customer belongs to
 * one Stripe account, so a `cus_...` created on a coach's connected account is
 * not found on the platform and the other way round.
 *
 * NULL customer is the expected answer for every sale made before that column
 * existed, and the error says so in words. The caller must NOT render a button
 * that produces it: `canOpenPurchasePortal` below is what a screen asks first.
 */
export async function openPurchasePortal(purchaseId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', {
      body: { action: 'purchase_portal', purchase_id: purchaseId, return_url: appLink('packages') },
    });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not open billing.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** The purchase a billing portal can actually be opened for: the most recent
 *  one Stripe made a Customer for. Null when there is none, which is a sentence
 *  the screen prints rather than a button it draws. */
export function portalPurchase(rows: Purchase[] | null | undefined): Purchase | null {
  if (!rows || !rows.length) return null;
  const withCustomer = rows.filter((r) => typeof r.stripe_customer_id === 'string' && r.stripe_customer_id.trim());
  if (!withCustomer.length) return null;
  return [...withCustomer].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

/**
 * The signed-in client's purchases (session-pack balances).
 *
 * `[]` means they have bought nothing. **`null` means we could not read it** —
 * and the packages screen renders "No purchases yet" for an empty list, so a
 * refused read told a paying customer their money bought nothing. That is the
 * single worst sentence this app can show someone who has paid.
 */
export async function fetchMyPurchases(): Promise<Purchase[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    // Capped, and a truncated read answers `null` — the same answer as a
    // refusal, because to the caller it is the same fact.
    //
    // This was the only purchase read in the file with no `.limit()`, while
    // `packageLabels`, `sessionsRemaining` and `fetchClientPurchases` all carry
    // one. It matters more here than in any of them: these rows go straight
    // into `packBalance`, whose entire output is a FIGURE — how many sessions
    // the client has left — and rowCap.ts's rule for a figure over a partial
    // set is that it is not a smaller number, it is a wrong one. A client whose
    // history was cut off would be shown a balance short by whatever fell past
    // the cap, and would book against it.
    //
    // Null rather than a rows-plus-flag pair because every caller of this
    // function already renders null correctly, with a written sentence — "this
    // is our end, not a statement about what you have bought" — and that
    // sentence is true of a truncated read as well.
    const { data, error } = await supabase.from('client_purchases').select('*').eq('client_id', uid)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
    if (error) return null;
    const page = capped((data as Purchase[]) ?? []);
    if (page.truncated) {
      reportError('connect.fetchMyPurchases', new TruncatedRead('your purchase history', ROW_CAP));
      return null;
    }
    return page.rows;
  } catch { return null; }
}

/**
 * Sessions remaining across the client's active packs (optionally for one trainer).
 *
 * **`null` means we could not count them**, and is not the same as `0`.
 *
 * This returned `0` on a failed read, which is a number, and a wrong one. Two
 * things on the calendar screen are decided by it, and a fabricated zero got
 * both backwards for the one client it matters most to — somebody holding
 * credits whose read just failed:
 *
 *   - the "Pack credits" row silently disappears, so they cannot see the
 *     balance they paid for;
 *   - `hadCredits` goes false, which SUPPRESSES the warning that a booking was
 *     not drawn from their pack. They book, nothing is deducted, and the app
 *     says nothing at all, because it believes there was no pack to deduct from.
 *
 * The two functions on either side of this one — `fetchMyPurchases` above and
 * `redeemSession` below — were both fixed for exactly this. This one was
 * missed, and it feeds the screen the other two protect.
 */
export async function sessionsRemaining(trainerId?: string): Promise<number | null> {
  // One place does this arithmetic, and it is tested: `packBalance` returns
  // null for an unread history and a real 0 for an empty one, which is the
  // distinction this function exists to preserve. See src/lib/packDraw.ts.
  return (await sessionPacks(trainerId))?.left ?? null;
}

/**
 * The same read, keeping the PACKS as well as the number left on them.
 *
 * `sessionsRemaining` throws the lines away, and a caller holding only the
 * number cannot tell 0-because-you-used-them-all from 0-because-you-have-never-
 * bought-one. app/(client)/pt-sessions.tsx was showing the second as the first:
 * with `client_purchases` empty, every member read a hero of "0 · Nothing left
 * on a pack" and an amber flag telling them to "Buy another" — two sentences
 * asserting a pack that never existed, to somebody who may not even have a
 * coach. app/(client)/packages.tsx already guarded the identical warning with
 * `balance.lines.length > 0`; it simply had the lines to hand and this screen
 * did not.
 *
 * Null still means the read did not land, exactly as before.
 */
export async function sessionPacks(trainerId?: string): Promise<PackBalance | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    // The three expiry columns come back with the balance, because a pack that
    // ran out of time and a pack that was used up are the same two numbers by
    // the time part 612's pass has run — `sessions_total` is reduced to
    // `sessions_used` so that every draw site in the database stops at it — and
    // they are opposite sentences to say to somebody about their own money.
    // Without `expired_at` and `sessions_expired` here, six sessions somebody
    // paid for and did not take disappear off their screen with nothing said.
    let q = supabase.from('client_purchases').select('id, package_id, sessions_total, sessions_used, status, created_at, expires_on, expired_at, sessions_expired').eq('client_id', uid).eq('status', 'paid').not('sessions_total', 'is', null).limit(capLimit());
    if (trainerId) q = q.eq('trainer_id', trainerId);
    const { data, error } = await q;
    if (error) { reportError('connect.sessionsRemaining', error); return null; }
    if (!data) return null;
    return packBalance(data as PackPurchase[]);
  } catch (e) { reportError('connect.sessionsRemaining', e); return null; }
}

/**
 * One purchase as the COACH sees it: the row, plus the two labels that live in
 * other tables and the currency that lives in no table at all.
 */
export interface CoachPurchase extends Purchase {
  /** null when the name could not be read. The money beside it is still real. */
  client_name: string | null;
  /** null when the package has been deleted since the sale. */
  package_name: string | null;
  /**
   * The SALE's own currency, and the package's only where the sale has none.
   *
   * This said "`client_purchases` has no currency column — checked against the
   * live schema", thirty lines above the code that reads that very column. It
   * was true when it was written and part 132 made it false: the column exists,
   * the stripe-webhook writes `sess.currency` onto every sale at checkout, and
   * existing rows were backfilled from their package wherever one survived. A
   * comment that contradicts the line below it is worse than no comment,
   * because the next person trusts it and re-derives the fallback as the rule.
   *
   * Still null for one case, and it is unrecoverable rather than unread: a sale
   * made before part 132 whose package had already been deleted, so the unit
   * lived nowhere. An amount with a null currency is printed as a dash rather
   * than as a number in a unit we picked — see `sumTaken` in coachMoney.ts,
   * which counts those separately instead of quietly leaving them out of a
   * total.
   */
  currency: string | null;
}

/**
 * What the signed-in coach's clients have bought from them — one-off
 * memberships and session packs, newest first.
 *
 * The twin of `fetchMyPurchases` below, from the other side of the sale. Every
 * purchase function in this file filters on `client_id = uid`, so until now a
 * coach could not see who had bought a ten-pack, how many sessions were left on
 * it, or who had run out — the app took money on their behalf and then showed
 * them nothing about it.
 *
 * No new policy was needed for this: `cp_trainer_read` on `client_purchases`
 * already grants SELECT where `trainer_id = auth.uid()`, and `purch_read`
 * grants the same to the gym owner. Verified live before writing this.
 *
 * Returns the rows AND how far they can be trusted, because the three answers a
 * coach can get look identical as a list: 'ready' with nothing is a coach
 * nobody has bought from, 'error' with nothing is a coach who could not be
 * told, and 'partial' is more sales than one read returns — on which no total
 * may be quoted. This is somebody's income; "nothing" and "unknown" are not the
 * same sentence about it.
 */
export async function fetchClientPurchases(): Promise<{ rows: CoachPurchase[]; status: LoadStatus }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { rows: [], status: 'error' };
    const { data, error } = await supabase.from('client_purchases').select('*')
      .eq('trainer_id', uid).order('created_at', { ascending: false }).limit(capLimit());
    if (error) { reportError('connect.fetchClientPurchases', error); return { rows: [], status: 'error' }; }
    const page = capped((data as Purchase[]) ?? []);

    // The package carries the name AND the unit. A coach reads their own
    // packages whether or not they are still on sale (pkg_read is `active OR
    // trainer_id = uid`), so withdrawing a package does not un-label the sales
    // made from it — which is exactly what happens to the CLIENT, who can only
    // see active ones. A package actually DELETED still leaves an amount with
    // no unit, and that is unrecoverable rather than unread.
    const pkgIds = [...new Set(page.rows.map((r) => r.package_id).filter(Boolean))] as string[];
    const pkgs = new Map<string, { name: string | null; currency: string | null }>();
    if (pkgIds.length) {
      // no-error-ok: a package we cannot read leaves the sale unlabelled and unpriced-in-anything, which is the same outcome as a package that was deleted — and both are reported by sumTaken as amounts missing from the total, never as dollars
      const { data: rows } = await supabase.from('trainer_packages').select('id, name, currency').in('id', pkgIds).limit(capLimit());
      (rows ?? []).forEach((p: any) => { if (p?.id) pkgs.set(p.id, { name: (p.name || '').trim() || null, currency: (p.currency || '').trim() || null }); });
    }

    const clientIds = [...new Set(page.rows.map((r) => r.client_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (clientIds.length) {
      // Bounded by `clientIds`, which the cap above already holds at ROW_CAP or fewer.
      // no-error-ok: a name we cannot read stays null and renders as a dash; the purchase it labels is still real and still paid for
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', clientIds).limit(capLimit());
      (profs ?? []).forEach((p: any) => { if (p?.id) names.set(p.id, (p.full_name || '').trim()); });
    }

    const rows: CoachPurchase[] = page.rows.map((r) => ({
      ...r,
      client_name: (r.client_id && names.get(r.client_id)) || null,
      package_name: (r.package_id && pkgs.get(r.package_id)?.name) || null,
      // The SALE's own currency first, the package's only as a fallback.
      //
      // `client_purchases.currency` (part 132) is written at checkout from the
      // Stripe session's own currency — the unit the money actually moved in.
      // The package is a lookup that can change or be deleted underneath it,
      // and reading the package first is how a sale loses its unit the moment
      // somebody tidies their price list. Existing rows were backfilled from
      // their package where one survived, so the two agree wherever both exist.
      currency: (r.currency || '').trim() || (r.package_id && pkgs.get(r.package_id)?.currency) || null,
    }));
    return { rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) { reportError('connect.fetchClientPurchases', e); return { rows: [], status: 'error' }; }
}

/**
 * A chargeback as the coach's screen holds it (supabase/parts/611).
 *
 * Everything except the id and the status is nullable, and every one of those
 * nulls is a real state rather than a gap to be filled in. `evidence_due_by` is
 * the one that matters: Stripe states none on an inquiry and none on a case it
 * has already decided, and a screen that printed today's date or a dash into
 * that space would either send a coach running at nothing or make the row look
 * incomplete. `deadlineLine` in src/lib/disputes.ts is the sentence for it.
 */
export interface CoachDispute {
  id: string;
  stripe_dispute_id: string;
  stripe_charge_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  reason: string | null;
  status: string;
  evidence_due_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  client_id: string | null;
  purchase_id: string | null;
  renewal_id: string | null;
  /** null when the name could not be read, and null on the many disputes that
   *  carry no client at all — a chargeback can arrive against a payment this
   *  app never recorded, and that is the case with the least other warning. */
  client_name: string | null;
}

/**
 * Chargebacks on the signed-in coach's charges, soonest deadline first.
 *
 * ── Why the status matters more here than anywhere else on this screen ────
 *
 * Every other read on the Payments screen answers "how much". This one answers
 * "is there something with a deadline on it", and an empty list under 'error'
 * is an all-clear made out of our own failure — on the one question in this app
 * where being wrongly reassured costs the whole amount. `client_disputes` is
 * read-only to every signed-in user (no insert, update or delete policy at all)
 * and written only by the stripe-webhook, so a row here is Stripe's statement
 * and not anybody's claim.
 *
 * Ordered by `evidence_due_by` ascending, which is the order a person acts in.
 * Nulls last: a case with no stated deadline is either an inquiry or already
 * decided, and neither is the thing to do first.
 */
export async function fetchMyDisputes(): Promise<{ rows: CoachDispute[]; status: LoadStatus }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { rows: [], status: 'error' };
    const { data, error } = await supabase.from('client_disputes')
      .select('id, stripe_dispute_id, stripe_charge_id, amount_cents, currency, reason, status, evidence_due_by, opened_at, closed_at, client_id, purchase_id, renewal_id')
      .eq('trainer_id', uid)
      .order('evidence_due_by', { ascending: true, nullsFirst: false })
      .limit(capLimit());
    if (error) { reportError('connect.fetchMyDisputes', error); return { rows: [], status: 'error' }; }
    const page = capped((data as Omit<CoachDispute, 'client_name'>[]) ?? []);

    const clientIds = [...new Set(page.rows.map((r) => r.client_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (clientIds.length) {
      // Bounded by `clientIds`, which the cap above already holds at ROW_CAP or fewer.
      // no-error-ok: a name we cannot read stays null and renders as a dash; the dispute it labels is still live and still has a deadline on it
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', clientIds).limit(capLimit());
      (profs ?? []).forEach((pr: any) => { if (pr?.id) names.set(pr.id, (pr.full_name || '').trim()); });
    }

    const rows: CoachDispute[] = page.rows.map((r) => ({
      ...r,
      client_name: (r.client_id && names.get(r.client_id)) || null,
    }));
    return { rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) { reportError('connect.fetchMyDisputes', e); return { rows: [], status: 'error' }; }
}

/**
 * Draw down one credit from the client's oldest active pack for a trainer.
 *
 * ── Why this is one RPC and not the read-then-write it used to be ──────────
 *
 * It used to select the packs, pick one in JavaScript, and UPDATE the row it
 * had picked. Three things were wrong with that, and all three were confirmed
 * against the live database before this was changed (see
 * supabase/parts/123-a-credit-is-spent-once.sql):
 *
 *   · **The write could not report doing nothing.** PostgREST resolves an
 *     UPDATE that matched zero rows with `error: null` and an empty body. This
 *     function checked `error` — the only thing it had — and returned `ok:
 *     true` with a `remaining` it had worked out ITSELF, from the row it read
 *     a moment earlier. A balance the app printed and the database never
 *     agreed to. (An adversarial review said this meant packs never
 *     decremented at all; that half was wrong — `cp_self` is FOR ALL and the
 *     write does match its own row, proven live. The bug was that nothing
 *     could tell the difference.)
 *
 *   · **It was a lost update.** Two bookings in flight both read
 *     `sessions_used = 3`, both wrote 4, and two sessions came off one credit.
 *
 *   · **Nothing bounded the column.** `sessions_used = 500` on a ten-pack was
 *     accepted, live, as the client. Part 123 adds the CHECK constraint.
 *
 * `redeem_pack_session` does the pick and the write in one statement, holds the
 * chosen row with `for update`, and RAISES when its own `row_count` is not 1.
 * So the three answers below are the database's, not this file's:
 *
 *   ok: true            a credit came off. `remaining` is what the DATABASE
 *                       now holds — never a number computed here.
 *   ok: false + error   nothing came off, and `error` says why. It is a
 *                       lower-case clause: app/(client)/calendar.tsx renders
 *                       it inside parentheses mid-sentence.
 *   ok: false, no error the client has no pack with this coach at all. Nothing
 *                       was supposed to happen and nothing is explained.
 *
 * A thrown/refused call is `ok: false` with a reason — never silently the same
 * as "you have none left", which is what a paying client would otherwise be
 * told when the server simply could not be reached.
 */
export async function redeemSession(trainerId: string): Promise<{ ok: boolean; remaining?: number; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('redeem_pack_session', { p_trainer: trainerId });
    if (error) {
      reportError('connect.redeemSession', error);
      return { ok: false, error: 'the server did not confirm it — this is not the same as having none left' };
    }
    // Zero rows back is not a redemption. `readDraw` is the row count this
    // function never had: [] and [row, row] and a word from a newer schema are
    // all 'unknown', and 'unknown' never reads as success.
    const d = readDraw(data);
    if (drew(d)) return d.remaining == null ? { ok: true } : { ok: true, remaining: d.remaining };
    const why = drawReason(d);
    return why ? { ok: false, error: why } : { ok: false };
  } catch (e) {
    reportError('connect.redeemSession', e);
    return { ok: false, error: 'the server did not confirm it — this is not the same as having none left' };
  }
}

/** The trainer OTHER clients, to push a freed slot to. Server-side lookup so no
 *  other-client identity leaks to the caller beyond opaque ids. */
export async function reofferSlot(sessionId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('reoffer_client_ids', { p_session: sessionId });
    if (error) { reportError('connect.reofferSlot', error); return []; }
    return Array.isArray(data) ? data.map((r: any) => r.client_id).filter(Boolean) : [];
  } catch { return []; }
}

/**
 * Refund one credit — the client cancelled outside the window and it goes back
 * onto their pack. The exact inverse of `redeemSession`, through the same kind
 * of RPC and for the same reasons: the old version read, picked, and wrote,
 * and its final `return { ok: !error }` treated a write that matched nothing as
 * a credit successfully returned. A credit believed returned and not returned
 * is one the client has paid for twice.
 *
 * WHETHER a refund is owed is not decided here. `cancelBookedSession` in
 * src/ui/sessions.tsx applies the 24-hour rule and only calls this when a
 * credit is due; `refund_pack_session` decides which pack it lands on (the
 * newest with usage, the inverse of drawing from the oldest with room).
 *
 * `ok` is true only when the database says a credit moved. `reason` is why it
 * did not, when there is something worth saying — 'nothing had been drawn off
 * it', or the one that matters, 'we could not confirm the change'. Callers that
 * only read `.ok` (src/ui/sessions.tsx does) keep exactly their old behaviour.
 */
export async function refundSession(trainerId: string): Promise<{ ok: boolean; remaining?: number; reason?: string }> {
  try {
    const { data, error } = await supabase.rpc('refund_pack_session', { p_trainer: trainerId });
    if (error) {
      reportError('connect.refundSession', error);
      return { ok: false, reason: 'the server did not confirm it' };
    }
    const d = readDraw(data);
    if (drew(d)) return d.remaining == null ? { ok: true } : { ok: true, remaining: d.remaining };
    const why = drawReason(d);
    return why ? { ok: false, reason: why } : { ok: false };
  } catch (e) {
    reportError('connect.refundSession', e);
    return { ok: false, reason: 'the server did not confirm it' };
  }
}

/**
 * Move one session credit on a pack the signed-in COACH sold (part 661).
 *
 * ── Why `refundSession` above is not this ────────────────────────────────
 *
 * That one is scoped `client_id = auth.uid()`: the CLIENT calls it, when they
 * cancel outside the notice window, and it picks the pack for them. A coach
 * calling it would match nothing. It also chooses "the newest pack with usage",
 * which is right for a cancellation and wrong here — the coach is looking at
 * ONE sale they have just refunded and means that one.
 *
 * ── The gap this closes ─────────────────────────────────────────────────
 *
 * `REFUND_DOES_NOT` in src/lib/refunds.ts is shown to the coach immediately
 * before somebody's card is credited and says a refund "does not put a session
 * credit back on a pack". That was true and there was no way to act on it
 * anywhere in the product: a coach who refunded two sessions of a ten-pack gave
 * the money back and left the credits, so the client had both.
 *
 * ── It does not refund money, and nothing bundles the two ────────────────
 *
 * Deliberately separate acts. A coach may take a credit off without giving
 * money back (a session delivered off the books) and may give money back
 * without taking a credit (a goodwill refund on a pack the client is keeping),
 * and neither is rare. Bundling would make one of them impossible.
 *
 * `ok` is true only when the database says a credit moved — `readDraw` refuses
 * to call anything a success that did not come back as exactly one row naming
 * an outcome this build knows. `outcome` carries the answer for the sentence
 * the screen says, including 'expired', which part 661 returns rather than
 * putting a credit onto a pack no draw site will ever spend.
 */
export async function adjustPackCredit(purchaseId: string, delta: 1 | -1): Promise<{ ok: boolean; outcome: DrawOutcome; remaining: number | null }> {
  try {
    const { data, error } = await supabase.rpc('adjust_pack_credit', { p_purchase: purchaseId, p_delta: delta });
    if (error) {
      reportError('connect.adjustPackCredit', error);
      return { ok: false, outcome: 'unknown', remaining: null };
    }
    const d = readDraw(data);
    return { ok: drew(d), outcome: d.outcome, remaining: d.remaining };
  } catch (e) {
    reportError('connect.adjustPackCredit', e);
    return { ok: false, outcome: 'unknown', remaining: null };
  }
}

/* ── giving money back ────────────────────────────────────────────────────── */

/**
 * Refund a one-off sale, in whole or in part.
 *
 * `amountCents` omitted means the whole of WHAT IS LEFT — never the whole of
 * the original price, so a second partial refund cannot try to give back an
 * amount that has already gone.
 *
 * Everything that decides whether this is allowed lives in src/lib/refunds.ts
 * and runs on BOTH sides: the screen's copy is a convenience so a coach is not
 * sent to the server to be told no, and the server's copy is the rule. The
 * Stripe call itself is supabase/functions/connect-refund, which runs as the
 * service role, checks that this sale is the caller's own, calls Stripe FIRST
 * and writes the row only from Stripe's answer.
 *
 * `ok: false` means no money moved. That is the case where a screen must not
 * say "refunded", because the coach's next act is to tell their client it is on
 * the way.
 *
 * `mirrored: false` is the narrow, loud middle state: Stripe DID make the
 * refund and this app failed to write it down. The money has gone back and the
 * figure on the screen is stale, and the screen has to say both — a coach told
 * it failed would refund it a second time.
 */
export interface RefundResult {
  ok: boolean;
  /** Minor units Stripe actually returned. Stripe's figure, not the one asked
   *  for; they are the same today and a Stripe-side adjustment that made them
   *  differ would otherwise leave this app permanently out by it. */
  refundedCents?: number;
  /** The running total on the row after this refund. */
  totalRefundedCents?: number;
  currency?: string | null;
  /** False when the money went back and this app could not record it. */
  mirrored?: boolean;
  error?: string;
}

async function callRefund(kind: 'purchase' | 'renewal', id: string, amountCents?: number): Promise<RefundResult> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-refund', {
      body: { kind, id, amount_cents: amountCents ?? null },
    });
    if (error) { reportError('connect.refund', error); return { ok: false, error: error.message }; }
    if (data?.ok) {
      return {
        ok: true,
        refundedCents: Number(data.refunded_cents) || 0,
        totalRefundedCents: Number(data.refunded_total_cents) || 0,
        currency: data.currency ?? null,
        mirrored: data.mirrored !== false,
      };
    }
    return { ok: false, error: data?.error || 'No refund was made, so nothing has been given back.' };
  } catch (e) {
    reportError('connect.refund', e);
    // A thrown call is NOT a refund that failed cleanly — the request may have
    // reached Stripe and the answer may have been lost on the way back. The
    // sentence says so rather than telling a coach to try again, because trying
    // again is how somebody gets refunded twice.
    return { ok: false, error: 'The refund was not confirmed. Check your Stripe dashboard before trying it again — a second attempt could give the money back twice.' };
  }
}

/** Refund a pack or membership sale. See `callRefund` for what the three
 *  answers mean. */
export const refundPurchase = (purchaseId: string, amountCents?: number): Promise<RefundResult> =>
  callRefund('purchase', purchaseId, amountCents);

/**
 * Refund one paid renewal invoice. A DIFFERENT act from cancelling the
 * subscription: this returns money and stops nothing, and `endSubscriptionNow`
 * stops the next charge and returns nothing.
 *
 * Called from the Renewals Paid list on app/(trainer)/payments.tsx. It was
 * called from NOWHERE for as long as that list did not exist, and everything
 * behind it — connect-refund's `kind: 'renewal'` branch, part 192's
 * `refunded_cents` on `client_subscription_payments` — was reachable only
 * through this function, so none of it had ever run. What that hid is in part
 * 310: connect-refund selects `stripe_account_id` off the row, and the column
 * was on `client_purchases` and on `client_subscriptions` and not on this
 * table, so every renewal refund would have failed on the read with 42703.
 * A feature nothing calls is a feature nothing has tested.
 */
export const refundRenewal = (paymentId: string, amountCents?: number): Promise<RefundResult> =>
  callRefund('renewal', paymentId, amountCents);

/* ── discount codes, which live at Stripe ─────────────────────────────────── */

/**
 * The coach's own discount codes, read live from their Stripe account.
 *
 * There is no local table and no cache. Stripe holds the code, the percentage,
 * the expiry, the limit AND the redemption count, and it is the thing that
 * applies the discount at checkout — a mirror here would be a second copy of a
 * system this app does not control, and the first time they disagreed the coach
 * would be shown an offer that is not the one their clients are getting.
 * src/lib/packagePromo.ts carries the argument.
 *
 * `status` is what stops an empty list being read two ways. Under 'error' the
 * list is UNKNOWN — very possibly because Stripe was unreachable — and the
 * screen must not tell a coach they are running no offers when they are.
 */
export async function fetchMyPromoCodes(): Promise<{ codes: PromoCode[]; status: LoadStatus; reason: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-promo', { body: { action: 'list' } });
    if (error) {
      reportError('connect.promoList', error);
      return { codes: [], status: 'error', reason: error.message };
    }
    if (data?.ok && Array.isArray(data.codes)) return { codes: data.codes as PromoCode[], status: 'ready', reason: null };
    // A refusal with a reason — no connected account, or an account on the
    // wrong charge model — is 'error' with the sentence, never an empty list.
    // "You have no codes" and "codes are not available to you" send a coach to
    // two different places.
    return { codes: [], status: 'error', reason: data?.error || 'Your discount codes could not be read.' };
  } catch (e) {
    reportError('connect.promoList', e);
    return { codes: [], status: 'error', reason: 'Your discount codes could not be read.' };
  }
}

/**
 * Create one, on the coach's own Stripe account.
 *
 * Everything that decides whether it is allowed lives in
 * src/lib/packagePromo.ts and runs on BOTH sides: the screen's copy so a coach
 * is not sent to the server to be told no, and connect-promo's copy because
 * that is the rule.
 */
export async function createPromoCode(p: {
  code: string;
  percentOff: number;
  packageId: string;
  expiresOn?: string | null;
  maxRedemptions?: number | null;
}): Promise<{ ok: boolean; promo?: PromoCode; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-promo', {
      body: {
        action: 'create',
        code: p.code,
        percent_off: p.percentOff,
        package_id: p.packageId,
        expires_on: p.expiresOn ?? null,
        max_redemptions: p.maxRedemptions ?? null,
      },
    });
    if (error) { reportError('connect.promoCreate', error); return { ok: false, error: error.message }; }
    if (data?.ok) return { ok: true, promo: data as PromoCode };
    return { ok: false, error: data?.error || 'That code was not created.' };
  } catch (e) {
    reportError('connect.promoCreate', e);
    return { ok: false, error: 'That code was not created.' };
  }
}

/**
 * Withdraw one. Archived at Stripe rather than deleted.
 *
 * Stripe will not delete a promotion code that has been used, and it should
 * not: somebody already subscribed on it keeps the price they signed up at, and
 * a subscription discounted by a code that no longer exists anywhere would be
 * unexplainable a year later. `PROMO_WITHDRAW_IS_FORWARD_ONLY` is the sentence
 * the screen shows before the tap.
 */
export async function archivePromoCode(promotionCodeId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-promo', {
      body: { action: 'archive', promotion_code_id: promotionCodeId },
    });
    if (error) { reportError('connect.promoArchive', error); return { ok: false, error: error.message }; }
    if (data?.ok) return { ok: true };
    return { ok: false, error: data?.error || 'That code was not withdrawn, so it is still live.' };
  } catch (e) {
    reportError('connect.promoArchive', e);
    return { ok: false, error: 'That code was not withdrawn, so it is still live.' };
  }
}

/* ── what pays for a one-to-one ───────────────────────────────────────────── */

/**
 * The client's own gym passes that can pay for a one-to-one.
 *
 * `gym_passes_own_r` (part 31) shows a holder their own passes and nobody
 * else's, and `gym_pass_types_tenant_r` shows the price book to anyone in the
 * tenant — so both halves of this join are readable by the member without a new
 * policy. `covers` arrives from part 370 and is the whole point of the read: a
 * ten-CLASS pack must never pay for an hour of PT, so a pass whose type does
 * not say 'pt' is filtered out by `gymPtLines` rather than counted here.
 *
 * **Null is a read that did not land, and is not an empty pass list.** A member
 * holding six PT credits whose read failed must not be shown a zero.
 */
export async function myPtPasses(): Promise<PtPassRow[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase
      .from('gym_passes')
      .select('id, pass_type_id, expires_on, uses_total, uses_spent, gym_pass_types(name, covers)')
      .eq('holder_id', uid)
      .order('issued_on', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('connect.myPtPasses', error); return null; }
    if (!data) return null;
    const page = capped(data as unknown[]);
    // A figure over a partial set is not a smaller number, it is a wrong one —
    // the same rule `fetchMyPurchases` follows, and for the same reason: these
    // rows become a balance somebody books against.
    if (page.truncated) {
      reportError('connect.myPtPasses', new TruncatedRead('your gym passes', ROW_CAP));
      return null;
    }
    return page.rows.map((r: any) => {
      const ty = Array.isArray(r.gym_pass_types) ? r.gym_pass_types[0] : r.gym_pass_types;
      return {
        id: r.id as string,
        passTypeId: (r.pass_type_id ?? null) as string | null,
        passTypeName: (ty?.name ?? null) as string | null,
        covers: (ty?.covers ?? null) as string | null,
        expiresOn: (r.expires_on ?? null) as string | null,
        usesTotal: (r.uses_total ?? 0) as number,
        usesSpent: (r.uses_spent ?? 0) as number,
      };
    });
  } catch (e) { reportError('connect.myPtPasses', e); return null; }
}

/** One of the client's gym passes, narrowed to what a PT balance depends on. */
export interface PtPassRow {
  id: string;
  passTypeId: string | null;
  passTypeName: string | null;
  /** 'visit' or 'pt' (part 370). Null when the type could not be read, which is
   *  NOT the same as a type that covers visits — an unnamed coverage is never
   *  assumed to be the one that lets a credit be spent. */
  covers: string | null;
  expiresOn: string | null;
  usesTotal: number;
  usesSpent: number;
}

/**
 * The client's own sessions, with what paid for each one.
 *
 * `sessions_client_read` (part 22) already shows a client every session that is
 * theirs, so this needs no policy and no RPC — only the columns parts 193 and
 * 370 added, which no existing read selects.
 *
 * Null for a read that failed, because `buildLedger(null)` is null and an empty
 * ledger under a failed read tells somebody who has used nine sessions that
 * they have never used one.
 */
export async function mySessionCredits(): Promise<CreditSession[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase
      .from('sessions')
      .select('id, starts_at, status, outcome, series_id, pack_drawn_at, pack_drawn_kind, pack_drawn_purchase_id, pack_drawn_pass_id, pack_draw_shortfall_at, booking_drew_credit_at')
      .eq('client_id', uid)
      .order('starts_at', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('connect.mySessionCredits', error); return null; }
    if (!data) return null;
    const page = capped(data as unknown[]);
    if (page.truncated) {
      reportError('connect.mySessionCredits', new TruncatedRead('your session history', ROW_CAP));
      return null;
    }
    return page.rows.map((r: any): CreditSession => ({
      id: r.id,
      startsAt: r.starts_at,
      status: r.status,
      outcome: r.outcome ?? null,
      seriesId: r.series_id ?? null,
      packDrawnAt: r.pack_drawn_at ?? null,
      packDrawnKind: (r.pack_drawn_kind ?? null) as CreditSession['packDrawnKind'],
      packDrawnPurchaseId: r.pack_drawn_purchase_id ?? null,
      packDrawnPassId: r.pack_drawn_pass_id ?? null,
      shortfallAt: r.pack_draw_shortfall_at ?? null,
      bookingDrewCreditAt: r.booking_drew_credit_at ?? null,
    }));
  } catch (e) { reportError('connect.mySessionCredits', e); return null; }
}
