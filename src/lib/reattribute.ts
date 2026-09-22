// Putting a payment against the right person, without a second row of money.
//
// ── what there was instead ────────────────────────────────────────────────
//
// A payment keyed against the wrong member — or against nobody, which
// `purposeOf` in src/lib/monthEnd.ts reports on its own line as "Not attributed
// to anybody" — had exactly one remedy in this product: reverse it and record
// it again. `reversePayment` is the right tool for money that went back to a
// human being and the wrong tool for a name that was mistyped, and using it
// here does three things that are all wrong:
//
//   · it puts a NEGATIVE payment in the ledger for money nobody refunded, so
//     the gym's own record now says a refund happened on a day it did not;
//   · it leaves three rows where there was one, and /accounting's 45-day match
//     on member, amount and currency now has a pair to reconcile that never
//     touched a bank;
//   · it MOVES the figures. The reversal is stamped today, the replacement is
//     stamped today, and the original stays where it was — so a mistake found
//     in September takes money out of August and puts it into September, in a
//     register an accountant reads by month. If August is closed,
//     supabase/parts/182 refuses the reversal outright and there is no remedy
//     at all.
//
// Re-attribution changes `member_id` and `membership_id` and nothing else. The
// amount, the currency, the method and `taken_at` are untouched, which is why
// the closed-month trigger does not fire on it: that trigger is declared
// `before insert or update of taken_at, amount_cents`, deliberately naming the
// money and the date, and a payment that stays in its month for its amount has
// not moved anything a close signed for.
//
// ── the corrections have to come with it ──────────────────────────────────
//
// `reversePayment` copies `member_id` and `membership_id` from the row it
// undoes onto the correction it writes. So a payment that has been partly
// refunded is TWO rows against one person, and moving only the positive one
// leaves a −40.00 filed against the member who never paid it and a +100.00
// against the one who did. Every screen that groups by member then shows one of
// them owing money back.
//
// So the ids move together, and `reattributeRows` is the list. It is a pure
// function rather than a query because the caller already holds the window, and
// because a correction can only be recorded at or after the payment it undoes —
// so any list reaching back far enough to show the original reaches far enough
// to show all of them.
//
// ── and the membership has to belong to the person ────────────────────────
//
// `gym_payments.membership_id` is the one hard link between a payment and what
// it was for. Moving a payment to a new member while leaving that link pointing
// at somebody else's membership would produce a row that contradicts itself and
// that /accounting reconciles from — so the membership is chosen alongside the
// member, exactly as the capture form on /money does it, and `reattributeBlocker`
// refuses any pair that does not hold together.
//
// Nothing here reads a database. The writer is `reattributePayment` in
// src/lib/gymRecord.ts, beside `reversePayment` and `matchPayment`.
import type { GymPayment, Membership } from './gymRecord';

/** Who a payment is being moved to, and what it is being said to settle. */
export interface Attribution {
  /**
   * The member, or null for deliberately nobody.
   *
   * Null is a legitimate destination and not a missing value. A payment filed
   * against the wrong person is worse than one filed against no one: the first
   * is a false statement about a member's account, the second is a known gap
   * that `purposeOf` already counts and reports.
   */
  memberId: string | null;
  /** The membership it settles, or null for none. Must be held by `memberId`. */
  membershipId: string | null;
}

/** '' and null are one answer — nobody — because a `<select>` with an empty
 *  option hands back the empty string and the column holds null. Comparing the
 *  two raw would make "leave it unattributed" look like a change. */
const who = (id: string | null | undefined): string | null => (id ?? '') || null;

/**
 * Why this payment cannot be re-attributed, or null when it can.
 *
 * `all` is the payments the screen has read — null when that read failed or has
 * not landed, which is a refusal rather than an empty list: the corrections
 * against this row are found in it, and a re-attribution that cannot see them
 * is the one that splits a refund away from its payment.
 *
 * `memberships` is the same for the membership half. Null refuses for the same
 * reason: "that membership is not held by this member" and "the membership list
 * did not load" are different facts and only one of them is about the data.
 */
export function reattributeBlocker(
  p: GymPayment,
  to: Attribution,
  all: GymPayment[] | null,
  memberships: Membership[] | null,
): string | null {
  // The same first rule `reversalBlocker` has, for the mirror-image reason. A
  // correction is not an independent row: it belongs to the payment it undoes,
  // it was written with that payment's member on it, and moving it alone is
  // precisely the split this module exists to prevent. The way to move it is to
  // move the payment, which brings it along.
  if (p.kind !== 'payment') {
    return 'That row is a correction, and it is filed against whoever the payment it corrects is filed against. Re-attribute that payment and this row moves with it.';
  }
  if (all == null) {
    return 'The payments could not be read, so there is no way to tell whether this one has been refunded or corrected. Moving it without the rows that correct it would leave a refund filed against somebody who never paid. Reload and try again.';
  }

  const target = who(to.memberId);
  const membership = who(to.membershipId);

  if (membership) {
    if (!target) {
      return 'A payment cannot settle a membership and belong to nobody. Choose the member who holds it, or clear the membership.';
    }
    if (memberships == null) {
      return 'The memberships could not be read, so there is no way to check that this membership is the chosen member’s. Reload and try again.';
    }
    const m = memberships.find((x) => x.id === membership);
    if (!m) {
      return 'That membership is not in the list this screen read, so nothing here can say whose it is.';
    }
    if (who(m.memberId) !== target) {
      return 'That membership belongs to somebody else. A payment may only be recorded against a membership held by the member it is attributed to.';
    }
  }

  if (who(p.memberId) === target && who(p.membershipId) === membership) {
    // Not an error, and it is still a refusal: a write that changes nothing
    // would come back having matched a row, and the screen would announce a
    // correction that did not happen.
    return target
      ? 'That payment is already attributed this way. Nothing would change.'
      : 'That payment is already unattributed, and no membership is named on it. Nothing would change.';
  }

  return null;
}

/**
 * Every row that has to move with this payment — the payment itself first, then
 * the corrections recorded against it.
 *
 * Returns the ids rather than the rows because the writer wants an `in` list,
 * and because handing back rows invites a caller to re-derive the set from them
 * and get a different answer.
 *
 * Deliberately not de-duplicated by hand: `all` is a list of distinct rows from
 * one read, and a defensive `Set` here would quietly hide a caller passing the
 * same window twice — which would then write once and be asserted against a
 * doubled expected count.
 */
export function reattributeRows(p: GymPayment, all: GymPayment[]): string[] {
  return [p.id, ...all.filter((x) => x.reversesPaymentId === p.id).map((x) => x.id)];
}

/**
 * What the screen says after the write landed, naming the corrections that came
 * with it.
 *
 * The count is the point. A refund silently moving with its payment is correct
 * and is also a change to a second row of somebody's money, and a confirmation
 * that mentions only the payment is a confirmation that under-reports what was
 * done. `rows` is what the WRITE said it changed, never what was asked for —
 * see `reattributePayment`, which refuses to return at all if those two differ.
 */
export function reattributedNote(rows: number, name: string | null): string {
  const to = name ? `to ${name}` : 'to nobody, which is where it now sits on the register';
  if (rows <= 1) return `That payment is now attributed ${to}.`;
  const extra = rows - 1;
  return `That payment is now attributed ${to}, along with the ${extra} correction${extra === 1 ? '' : 's'} recorded against it.`;
}
