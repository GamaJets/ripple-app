"use strict";
// What a screen holds, and whether the last attempt to refresh it worked.
//
// ── The regression pull-to-refresh introduced ──────────────────────────────
//
// Two owner screens catch a failed read and do this:
//
//   catch (e) { setRows(null); setFailed(true); }
//
// That was right when it was written and it is worth being precise about why,
// because the fix must not undo it. `setRows([])` renders as "Nobody on the
// register yet" and "this gym has sold nothing online" — specific claims about
// somebody's business, in the screen's own confident type, produced by a query
// that failed. Null is what makes "we could not ask" distinguishable from "we
// asked and it is empty".
//
// It was also, at the time, the only read that would ever run: the screen read
// once on mount and a failure there meant nothing had ever been on the page.
// Blanking a blank page costs nothing.
//
// Adding pull-to-refresh changed that and nothing downstream was changed with
// it. A refresh is a SECOND read over rows that already landed, and it fails for
// reasons that say nothing about the rows — a lift, a basement, a tunnel. So an
// owner looking at a correct register pulls down out of habit, the phone has no
// signal for two seconds, and the register empties in front of them. The screen
// then says the read failed, which is true, and shows nothing, which throws away
// a complete answer it is still holding.
//
// Both wrong answers come from squeezing two facts into one: WHAT THIS SCREEN
// HOLDS, and WHETHER THE LAST ATTEMPT LANDED. They are independent, and there
// are four combinations rather than three.
//
// ── Why 'stale' is not a fifth LoadStatus ──────────────────────────────────
//
// src/ui/loadStatus.ts is about ONE READ: 'partial' means the rows that came
// back are a prefix of the set, and `isWhole` is the gate on counting them.
// That question and this one are orthogonal — rows held under 'stale' here came
// back whole, they are simply older than the moment on screen. Adding 'stale'
// to `LoadStatus` would make `isWhole` answer two questions at once and quietly
// change what every existing `isWhole` call site means.
//
// So: a screen may count and sum rows it holds under 'stale'. Those figures were
// true at `fetchedAt`, `<Fetched at={...} />` is already on both screens saying
// when that was, and its own header records the rule this depends on — the stamp
// moves on a successful read and NOT on a failed one. What a screen may not do
// under 'stale' is imply the figures are current, which is what `staleNote`
// below is for.
//
// ── Where the rows may still be dropped ────────────────────────────────────
//
// Nowhere on these two screens, but the rule is not "never blank". A read whose
// rows are about to be acted on — a door list about to be evacuated, a balance
// about to be charged — is a different judgement, and this module deliberately
// does not make it. It answers the narrower question: given rows and a failed
// attempt, which of four things is true.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readState = readState;
exports.hasRows = hasRows;
exports.canSayEmpty = canSayEmpty;
exports.isCurrent = isCurrent;
exports.staleNote = staleNote;
exports.failedNote = failedNote;
/**
 * Which of the four, from the two facts a screen already holds.
 *
 * `held` is the rows themselves rather than a boolean so the call site cannot
 * drift from what it renders: `readState(rows, failed)` beside `rows ?? []` is
 * one variable, and `readState(everRead, failed)` beside `rows ?? []` is two
 * that have to be kept in step by hand.
 */
function readState(held, lastAttemptFailed) {
    if (held == null)
        return lastAttemptFailed ? 'failed' : 'loading';
    return lastAttemptFailed ? 'stale' : 'ready';
}
/** True when there are rows to draw — and therefore rows to count and sum. */
function hasRows(s) {
    return s === 'ready' || s === 'stale';
}
/**
 * True when this screen may state an EMPTINESS as a fact about the gym.
 *
 * 'stale' is included and 'failed' is not, and that is the whole distinction:
 * an empty list held under 'stale' was genuinely empty when it was read, so
 * "nothing has been bought online" is true as of the stamp above it. An empty
 * list under 'failed' is not a list at all.
 */
function canSayEmpty(s) {
    return hasRows(s);
}
/** True when what is on screen is confirmed current. */
function isCurrent(s) {
    return s === 'ready';
}
/**
 * The sentence for 'stale'.
 *
 * Three things, in this order, because that is the order an owner needs them:
 * the figures are still real, the refresh is what failed, and nothing in the
 * gym changed. The age is deliberately absent — `<Fetched>` sits directly above
 * both of these screens and says when, and a second, differently-worded age on
 * the same page is how the two come to disagree.
 *
 * `what` is a plain-English noun phrase for the set, lower case and without an
 * article: 'register', 'order book'.
 */
function staleNote(what, reason) {
    const why = (reason ?? '').trim();
    return `Refreshing the ${what} did not come back${why ? ` — ${why}` : ''}. `
        + `What is shown is the last read that DID land, so it is real but not confirmed current. `
        + `Nothing in your gym has changed because a refresh failed.`;
}
/**
 * The sentence for 'failed' — nothing has ever landed.
 *
 * Says what is not known rather than showing a zero, and says outright that it
 * is not an empty result, because that is the reading the screen's own layout
 * invites: a page of dashes under a heading looks like a quiet gym.
 */
function failedNote(what, reason) {
    const why = (reason ?? '').trim();
    return `Your ${what} could not be read${why ? ` — ${why}` : ''}. `
        + `This is a read that did not come back, not an empty ${what}. `
        + `Nothing has been cleared and nothing has lapsed.`;
}
