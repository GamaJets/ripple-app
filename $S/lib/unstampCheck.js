"use strict";
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
// Refusing costs nothing. The settlement is still standing, the run is still
// recorded as paid, nothing has been stranded, and pressing the button again
// is safe — which is exactly the state the ordering argument above was written
// to preserve. Going ahead costs a coach money they are owed, silently, for
// ever. There is no version of this where guessing is better.
Object.defineProperty(exports, "__esModule", { value: true });
exports.unstampBlocker = unstampBlocker;
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
 * Pure, so the sentence an owner reads is assertable without a database.
 */
function unstampBlocker(claimed, unstamped) {
    if (unstamped == null) {
        return 'This run was not taken back. The sessions it paid for were unstamped without the '
            + 'server saying how many rows that changed, so there is no way to tell whether all of '
            + 'them came loose. The settlement is untouched and still stands.';
    }
    if (unstamped === claimed)
        return null;
    if (unstamped < claimed) {
        const short = claimed - unstamped;
        return `This run was not taken back. It was recorded as paying for ${sessions(claimed)}, and `
            + `only ${unstamped} of them could be unstamped — ${sessions(short)} did not come loose. `
            + `Going ahead would mark the run reversed while ${short === 1 ? 'that session stays' : 'those sessions stay'} `
            + `attached to it, which takes ${short === 1 ? 'it' : 'them'} out of what the coach is owed `
            + `permanently. Nothing has been changed.`;
    }
    const extra = unstamped - claimed;
    return `This run was not taken back. It was recorded as paying for ${sessions(claimed)}, and `
        + `${unstamped} came loose — ${sessions(extra)} more than the run says it covered. Two records `
        + `disagree about what was paid for, and reversing over that would settle the disagreement by `
        + `guessing. Nothing has been changed.`;
}
/** "1 session" / "4 sessions". Its own function because this sentence says the
 *  word three times and a mismatched plural in a refusal about somebody's pay
 *  reads as a machine that does not know what it is talking about. */
function sessions(n) {
    return `${n} session${n === 1 ? '' : 's'}`;
}
