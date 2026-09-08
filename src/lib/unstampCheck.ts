// Taking a payroll run back: did every session it paid for actually come loose?
//
// ── The hole ──────────────────────────────────────────────────────────────
//
// `reverseSettlement` in src/lib/gymPay.ts is four writes in a fixed order, and
// its own header states the safety argument for that order in as many words:
//
//     "The other order would mark the run reversed while its sessions were
//      still stamped against it: they would be excluded from 'Owed now'
//      forever, so a coach would silently never be paid for them, and the run
//      that was supposed to have paid them says it did not."
//
// That argument protects against a write that THROWS. It does not protect
// against the failure this codebase exists to catch, which is a write that
// succeeds having touched nothing. The three unstamps each asked PostgREST for
// `{ count: 'exact' }` and then read only `.error`; the count came back and was
// dropped on the floor. The fourth write checked its count, and its comment
// even names the mechanism — "`settlements_owner` filters rather than refuses,
// so an update matching nothing returns 204 with a null error". The same
// sentence is true of the three above it and nothing acted on it.
//
// ── Why this is reachable, and not a theoretical worry ────────────────────
//
// Every policy on these four tables is a `USING` clause, and a `USING` clause
// FILTERS. A row it excludes is not refused, it is invisible: 204, null error,
// zero rows. Read off the live database, the four are
//
//     sessions_gym_owner_u        tenant_id IS NOT NULL AND is_owner_of(tenant_id)
//     gym_class_pay_owner         is_owner_of(tenant_id)
//     payroll_adjustments_owner   is_owner_of(tenant_id)
//     settlements_owner           is_owner_of(tenant_id)
//
// and only the first carries `tenant_id IS NOT NULL`. `sessions.tenant_id` is
// the only one of the three that is NULLABLE — `gym_class_pay.tenant_id` and
// `payroll_adjustments.tenant_id` are both NOT NULL — so `sessions` is the one
// table where a stamped row can exist that the owner's UPDATE cannot see.
//
// Worse, the owner CAN still read it: `sessions_owner_r` is
// `is_owner_of(staff_tenant_of(trainer_id))` with no tenant_id clause. So such
// a session shows on the payroll screen, is counted into the run, is paid for
// — and then cannot be unstamped. The reversal reports success, the settlement
// is marked reversed, and that session keeps a `settlement_id` pointing at a
// run that no longer paid for anything. `settleableSessions` excludes any
// session carrying a settlement id, so it never returns to "Owed now". The
// coach is not paid for it, and no screen in the product says so.
//
// ── The check that is exact ───────────────────────────────────────────────
//
// `payroll_settlements.sessions_count` is NOT NULL and is written by
// `recordSettlement` as `uniqueIds(run.sessionIds).length` — a count of ROWS
// stamped, deduplicated, measured against the stamp itself. So the settlement
// row carries the number of session rows that must come loose, and the row is
// readable by anybody who can reverse it (the reversal's own fourth write
// proves that).
//
// That makes the test exact and independent of any policy: unstamping a run
// must free exactly `sessions_count` sessions. Counting rows we could reach
// would only ever tell us about the rows we could reach.
//
// ── Why a refusal, and why before the settlement is touched ───────────────
//
// Refusing is the cheap side of the trade. The settlement is still standing,
// the run is still recorded as paid, and nothing has been stranded — which is
// exactly the state the ordering argument above was written to preserve. Going
// ahead costs a coach money they are owed, silently, for ever. There is no
// version of this where guessing is better.
//
// ── What the refusal must NOT say ─────────────────────────────────────────
//
// It must not say nothing has changed unless nothing has. This runs AFTER the
// sessions update, so on a shortfall of 3-out-of-5 the caller is holding the
// number 3 and three rows have already come loose; on a surplus every counted
// row has. The sentence used to end "Nothing has been changed" in both, and
// src/lib/reversalState.ts then prints a dated, MEASURED clause beside it —
// "Checked just now: 2 of the 31 sessions it paid for are still stamped against
// it; the other 29 are not." Two sentences on one screen, one of them false.
//
// It is not a wording slip either, because of what that module establishes:
// once sessions are loose the reversal is not retryable — the retry's unstamp
// matches zero rows and this function refuses on "only 0 of them", for ever. So
// the reader of this sentence is deciding whether to press a button that will
// never work again, and "nothing has been changed" is the one reading that
// makes pressing it look free. What is true, and what is said instead: the
// settlement is untouched and still reads as paid, and the rows that DID come
// loose are payable a second time until the run is put right on the record.
// Where the count is zero, nothing has changed and the sentence still says so.

/**
 * Why a reversal must not be completed, or null when it may be.
 *
 * `claimed` is the settlement's own `sessions_count`. `unstamped` is what
 * PostgREST said it changed — null when nobody asked for a count, which is
 * reported as a failure rather than a pass for the reason src/lib/wroteRows.ts
 * gives: treating a missing count as "fine" silently re-admits every call site
 * that forgot to ask for one, which is the entire population this exists to
 * close.
 *
 * `unstamped` is rows that HAVE already come loose, not rows that would. This
 * is called after the update, so the refusal describes a write that has already
 * landed in part — see "What the refusal must NOT say" above.
 *
 * Pure, so the sentence an owner reads is assertable without a database.
 */
export function unstampBlocker(claimed: number, unstamped: number | null | undefined): string | null {
  if (unstamped == null) {
    return 'This run was not taken back. The sessions it paid for were unstamped without the '
      + 'server saying how many rows that changed, so there is no way to tell whether all of '
      + 'them came loose. The settlement is untouched and still stands.';
  }
  if (unstamped === claimed) return null;
  if (unstamped < claimed) {
    const short = claimed - unstamped;
    return `This run was not taken back. It was recorded as paying for ${sessions(claimed)}, and `
      + `only ${unstamped} of them could be unstamped — ${sessions(short)} did not come loose. `
      + `Going ahead would mark the run reversed while ${short === 1 ? 'that session stays' : 'those sessions stay'} `
      + `attached to it, which takes ${short === 1 ? 'it' : 'them'} out of what the coach is owed `
      + `permanently. ${whatIsLoose(unstamped)}`;
  }
  const extra = unstamped - claimed;
  return `This run was not taken back. It was recorded as paying for ${sessions(claimed)}, and `
    + `${unstamped} came loose — ${sessions(extra)} more than the run says it covered. Two records `
    + `disagree about what was paid for, and reversing over that would settle the disagreement by `
    + `guessing. ${whatIsLoose(unstamped)}`;
}

/**
 * Where the run stands after this refusal, which is not the same sentence every
 * time.
 *
 * The settlement clause is true in both branches and at every count: this
 * refusal is thrown before the fourth write, so the run has not been marked
 * reversed. What varies is the sessions, and `unstamped` is the exact number of
 * them that have already come loose.
 *
 * Zero is genuinely nothing changed and says so — an owner who reads "some
 * sessions are loose" over a run nothing touched will go looking for a repair
 * that is not needed, and vagueness in the other direction is no safer than the
 * false claim it replaced. Anything above zero is the double-pay warning, in
 * the words src/lib/reversalState.ts uses for the same state, so the two
 * sentences on that screen say one thing.
 */
function whatIsLoose(unstamped: number): string {
  if (unstamped === 0) {
    return 'Nothing has been changed: no session came loose and the settlement is untouched.';
  }
  const one = unstamped === 1;
  return `The settlement is untouched and still reads as paid, but ${sessions(unstamped)} `
    + `${one ? 'has' : 'have'} already come loose from it and ${one ? 'is' : 'are'} back in what this `
    + `coach is owed, so recording another run now pays ${one ? 'that hour' : 'those hours'} a `
    + `second time. Pressing Reverse again will not finish the job — the unstamp would now match nothing `
    + `and be refused for that very reason — so put this run right on the record before paying this coach `
    + `anything else.`;
}

/** "1 session" / "4 sessions". Its own function because this sentence says the
 *  word three times and a mismatched plural in a refusal about somebody's pay
 *  reads as a machine that does not know what it is talking about. */
function sessions(n: number): string {
  return `${n} session${n === 1 ? '' : 's'}`;
}
