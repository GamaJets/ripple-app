// Changing a package a coach already sells — and the two fields that must not
// change.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// src/lib/connect.ts had `createPackage` and `deactivatePackage` and nothing in
// between. A coach raising their rate had to deactivate the old package and
// create a new one, which orphans the price history — the old row survives with
// `active = false` and every sale still points at it — and leaves anybody
// already subscribed pointing at a package the coach considers withdrawn.
//
// ── What repricing actually does, established rather than assumed ──────────
//
// The dangerous version of this feature is the one where editing a number on a
// settings screen changes what somebody's card is charged next month. It does
// not, and here is why, because "probably fine" is not an acceptable standard
// for somebody else's money:
//
//   · supabase/functions/connect-checkout builds each Stripe Checkout Session
//     with an INLINE price — `line_items: [{ price_data: { currency,
//     unit_amount: pkg.price_cents, recurring: { interval }, … } }]` — rather
//     than referencing a stored Stripe Price. Stripe materialises that price
//     onto the subscription at checkout. From then on the subscription holds its
//     own price object and `trainer_packages.price_cents` is not consulted by
//     anything at renewal.
//
//   · `client_subscriptions` carries its own `amount_cents`, `currency` and
//     `billing_interval`, written from the Stripe session by the webhook, and
//     app/(trainer)/payments.tsx renders every subscriber row from THOSE
//     columns — `pkgPriceLine(s.amount_cents, s.currency, s.billing_interval)`
//     — not from a package lookup. So the coach's own screen keeps showing each
//     subscriber the figure they actually pay.
//
//   · `client_purchases.amount_cents` is likewise written at checkout, so a
//     one-off sale that has already happened is a fixed record.
//
// So a price edit is forward-looking, it is safe, and it is exactly what a coach
// raising their rate needs. What it must never do is happen QUIETLY: a coach who
// believes they have just put everybody up to the new rate, and has not, will
// find out a year later. `repriceNote` is that sentence, and it is not optional
// decoration — it is the whole reason this is safe to offer.
//
// ── The two fields this deliberately will not change ───────────────────────
//
// CURRENCY. `client_purchases` gained its own `currency` column in part 132 and
// rows written before that are null — src/lib/connect.ts says so on the type,
// and adds the warning this rule comes from: the package's currency "is a
// lookup that can change underneath a sale that already happened". Editing it
// would silently redenominate every one of those older sales in the coach's own
// history. A package is priced in one currency for its whole life; a coach who
// needs a different one sells a different package.
//
// SESSIONS and BILLING_INTERVAL. These are not a price, they are what the thing
// IS. Part 97 forbids both at once in the database, and a live subscription's
// cadence lives in Stripe — flipping a package from monthly to yearly would
// leave the app describing a billing schedule Stripe is not running. Changing
// the session count on a pack does not alter what anybody bought
// (`client_purchases.sessions_total` is written at checkout) but it does change
// what the coach believes they sold, which is the same defect one step removed.
//
// A coach who needs any of the three deactivates and creates, which is what they
// do today and is the correct shape for "this is a different product".

/** What may be changed on a package that is already on sale. Deliberately two
 *  fields — see the header on why currency, sessions and billing_interval are
 *  not among them. */
export interface PackagePatch {
  name?: string;
  price_cents?: number;
}

/** The most a package may cost, in minor units. Stripe's own limit on a single
 *  charge is far higher, but a coach who types an extra zero has produced a
 *  figure nobody meant and the refusal is cheaper than the refund. */
export const MAX_PRICE_CENTS = 99_999_99;

/**
 * Why this edit cannot be made, or null when it can.
 *
 * Refused rather than corrected, in every branch. A name silently trimmed to
 * something else, or a price silently rounded, is a coach being shown a number
 * they did not type — and this is the screen where the number they type is what
 * somebody else pays.
 */
export function packageEditBlocker(p: PackagePatch): string | null {
  if (p.name === undefined && p.price_cents === undefined) {
    return 'Nothing has been changed.';
  }
  if (p.name !== undefined) {
    const n = p.name.trim();
    if (!n) return 'A package needs a name — it is what your client sees on the payment page.';
    if (n.length > 120) return 'That name is too long for a payment page. Keep it under 120 characters.';
  }
  if (p.price_cents !== undefined) {
    const c = p.price_cents;
    if (!Number.isFinite(c) || !Number.isInteger(c)) {
      return 'A price has to be a whole number of minor units — pence, cents, fils.';
    }
    // Zero is refused rather than treated as free. A free package is a real
    // thing somebody might want and it is not what this control is for: Stripe
    // Checkout will not open a session for a zero amount, so a coach who set
    // one here would get a package nobody could buy and no explanation.
    if (c <= 0) return 'A price has to be more than nothing. To stop selling this, withdraw it instead.';
    if (c > MAX_PRICE_CENTS) return 'That price looks like a typing slip. Check the number of zeros.';
  }
  return null;
}

/** The patch as it should reach the database — trimmed, and carrying only what
 *  was actually asked for. Null when the edit is refused, so a caller cannot
 *  write an unvalidated one by forgetting to check the blocker. */
export function packageUpdateRow(p: PackagePatch): Record<string, unknown> | null {
  if (packageEditBlocker(p)) return null;
  const row: Record<string, unknown> = {};
  if (p.name !== undefined) row.name = p.name.trim();
  if (p.price_cents !== undefined) row.price_cents = p.price_cents;
  return row;
}

/** True when the patch changes the price at all. A name correction is not a
 *  reprice and must not be explained as one — a coach warned about their
 *  subscribers every time they fix a typo stops reading the warning. */
export function isReprice(p: PackagePatch, currentCents: number | null | undefined): boolean {
  if (p.price_cents === undefined) return false;
  return p.price_cents !== currentCents;
}

/**
 * What a coach has to be told before they reprice, or null when there is
 * nothing to say.
 *
 * `activeSubscribers` is how many people are currently being billed against
 * this package, or null when that could not be established. Null gets its own
 * sentence: "no subscribers" and "we could not find out" are the two answers
 * this warning must not collapse, because the first makes the edit trivial and
 * the second makes it something the coach should look at first.
 */
export function repriceNote(activeSubscribers: number | null): string {
  if (activeSubscribers == null) {
    return 'This changes the price for new sales only. Whether anybody is currently subscribed at the old price could not be read, so this is not a statement that nobody is — anybody who is stays on what they signed up to pay, and Stripe keeps billing them that until you move them yourself.';
  }
  if (activeSubscribers === 0) {
    return 'This changes the price for new sales only. Nobody is currently subscribed at the old price.';
  }
  const n = activeSubscribers;
  return `This changes the price for new sales only. ${n} ${n === 1 ? 'person is' : 'people are'} subscribed at the old price and ${n === 1 ? 'stays' : 'stay'} on it — Stripe charges what they signed up to pay, and nothing here moves them. Moving somebody to a new rate means cancelling and re-selling, which is their decision to make.`;
}

/** What a coach is told when a package edit did not land. `updatePackage`
 *  counts the rows it wrote, because `pkg_write` is `trainer_id = auth.uid()`
 *  and an UPDATE that RLS narrows to zero rows is a 204 with no error — the
 *  defect src/lib/wroteRows.ts was written about. A coach told their new price
 *  is live when it is not sells at the old one indefinitely. */
export const PACKAGE_NOT_SAVED =
  'That package was not changed, so it is still on sale at the price and name it had. Nothing has changed — try again.';
