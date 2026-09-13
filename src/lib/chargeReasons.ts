/**
 * WHAT A CHARGE WAS FOR — the words a member reads beside a figure somebody
 * else recorded against their name.
 *
 * ── The defect this is half of ────────────────────────────────────────────
 *
 * `charges.reason` is free text (supabase/parts/01-schema.sql: `reason text not
 * null`, no CHECK), and the member's own list of what they owe filtered on one
 * literal string. src/ui/sessions.tsx read
 *
 *     .eq('reason', 'late_cancellation')
 *
 * and never selected `reason` at all, so a charge raised under any other word
 * was invisible to the person it was raised against — present in the database,
 * readable by them under `charges_client_r` (part 142, `client_id = auth.uid()`),
 * shown on the coach's screens, and absent from theirs.
 *
 * supabase/parts/243-a-session-you-can-move-instead-of-losing.sql had already
 * written the consequence down while declining to create it:
 *
 *     "'late_reschedule' would insert happily — and then be INVISIBLE. Both
 *      screens that read this table filter on the literal string […] A fee
 *      neither party can see is worse than no fee."
 *
 * That part chose not to add the string. It did not, and could not, stop the
 * next writer — `charges` takes an INSERT from anywhere the policy allows, and
 * part 189's whole subject is "a fee that outlives the coaching", which is a
 * charge that is not a late cancellation. So the member's read is widened and
 * this module is what makes the widening safe: a reason this build has never
 * heard of has to arrive on screen as itself rather than be dropped, renamed,
 * or folded into the one word the filter used to allow.
 *
 * ── Why an unknown reason is carried through and not called "Other" ───────
 *
 * Because the member's next act is to ask their coach about it, and "Other"
 * is not a thing anybody can be asked about. The row is the record; the
 * member holds the same string the coach does, and the two can have one
 * conversation about one word. The same decision `HistoryReason` makes in
 * src/lib/programHistory.ts, and `pastVerdict` in src/lib/sessionHistory.ts:
 * a value from a build ahead of this one is rendered generically, never
 * discarded.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 *
 * A total. `charges.currency` is per row (part 126 snapshots it at the moment
 * the fee is raised, for the reason src/lib/sumCurrency.ts sets out at length),
 * so a member with a fee in pounds and a fee in dirhams has two amounts and no
 * sum — there is no rate anywhere in this product to make one. The screen lists
 * and does not add up, and nothing in this module offers a way to.
 *
 * Pure and framework-free.
 */

/** The one reason this build writes, plus whatever else is on the row. Typed
 *  as the open union `HistoryReason` uses, so a caller gets the completion for
 *  the known string without the compiler pretending it is the only one. */
export type ChargeReason = 'late_cancellation' | (string & {});

/** A reason string as this module compares them. Trimmed and lower-cased,
 *  because `reason` has no CHECK on it and nothing stops a hand-written row
 *  from the SQL editor carrying 'Late_Cancellation'. */
const key = (reason: string | null | undefined): string =>
  (reason ?? '').trim().toLowerCase();

/**
 * What the charge was for, as a heading on its row.
 *
 * An unrecognised reason is title-cased off its own text — 'late_reschedule'
 * becomes 'Late reschedule' — which is a presentation of the record, not a
 * reinterpretation of it. An EMPTY reason is the one case that gets a sentence
 * instead of a label: `reason` is NOT NULL in the table, so a blank one means
 * the string is there and says nothing, and "Reason not recorded" is the true
 * statement about that. It is deliberately not "Charge", which would read as a
 * type of charge rather than as an absence.
 */
export function chargeReasonLabel(reason: string | null | undefined): string {
  const k = key(reason);
  if (!k) return 'Reason not recorded';
  if (k === 'late_cancellation') return 'Late cancellation';
  const words = k.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'Reason not recorded';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The sentence under a charge that says how it came to exist, or null when
 * this build cannot honestly say.
 *
 * Null rather than a generic "your coach recorded this": the late-cancellation
 * row is the only one whose origin this app actually knows — `cancel_my_session`
 * writes it, from the member's own tap, priced by the coach's policy — and
 * inventing a provenance for a reason that arrived from somewhere else would be
 * this screen asserting something it did not see. The caller prints the coach's
 * name and the date, which is what is on the row, and stops there.
 */
export function chargeReasonNote(reason: string | null | undefined): string | null {
  return key(reason) === 'late_cancellation'
    ? 'Recorded when you cancelled inside your coach’s notice period.'
    : null;
}

/**
 * True when the list holds a reason this build has never heard of.
 *
 * The screen says so once, under the list, rather than per row. It is worth
 * saying at all because the member is the one who has to ask about it: a label
 * derived from a raw string looks exactly like a label this app wrote, and a
 * member who knows the wording came off the record asks their coach a sharper
 * question than one who thinks the app chose it.
 */
export function hasUnknownReason(reasons: readonly (string | null | undefined)[]): boolean {
  return reasons.some((r) => {
    const k = key(r);
    return !!k && k !== 'late_cancellation';
  });
}

/** Said under a list containing a reason this build does not know. */
export const UNKNOWN_REASON_NOTE =
  'A charge above is filed under a reason this app has no wording for, so it is '
  + 'shown exactly as it was recorded. Ask your coach what it covers.';

/**
 * What the whole section says about itself, given how the read went.
 *
 * 'error' is its own sentence and is the reason this function exists rather
 * than a ternary at the call site: an empty charges list under a failed read is
 * the exact shape src/ui/loadStatus.ts was written about, and "you have no
 * charges" over a refusal is a sentence a member ACTS on — they stop expecting
 * a bill that is already standing. 'partial' is not 'ready' either: the list is
 * real and may be shown, and the claim that it is ALL of them may not.
 */
export function chargesLine(status: 'loading' | 'ready' | 'partial' | 'error'): string {
  if (status === 'loading') return 'Reading what has been charged to you…';
  if (status === 'error') {
    return 'We couldn’t read your charges. That is not a statement that you have none — anything already recorded still stands.';
  }
  if (status === 'partial') {
    return 'There are more charges on your record than we can read at once. Every one listed is real; this is not all of them.';
  }
  // Deliberately does not name the product or repeat who settles these. That
  // sentence carries `BRAND.label`, it is true under every one of these four
  // statuses, and the screen prints it once below the list — folding it in here
  // would put it on three of the four and leave it off the read that failed.
  return 'Everything your coach has recorded against you, whatever it was for.';
}
