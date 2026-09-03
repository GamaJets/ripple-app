"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keepOptimistic = keepOptimistic;
exports.settleOptimistic = settleOptimistic;
exports.settleRemoval = settleRemoval;
/** Whether a row drawn before the answer came back may stay on the screen. */
function keepOptimistic(outcome) {
    return outcome !== 'refused';
}
/**
 * The list, once the server has answered about the row that was added to it.
 *
 * By id, not by index: a re-read, a queue flush or a second entry may have
 * moved the row since it went in, and removing position zero would take
 * somebody else's measurement off the screen instead.
 *
 * Returns the same array reference when nothing changes, so a provider holding
 * it in state does not re-render every subscriber on a write that landed.
 */
function settleOptimistic(rows, id, outcome) {
    if (keepOptimistic(outcome))
        return rows;
    if (!rows.some((r) => r.id === id))
        return rows;
    return rows.filter((r) => r.id !== id);
}
/**
 * The list, once the server has answered about a row that was taken OFF it
 * before the answer came back.
 *
 * The mirror of `settleOptimistic`, and the same rule read from the other end:
 * count what the server confirmed. A screen that removes a row on the tap and
 * keeps it removed over a refused DELETE is not showing an optimistic row that
 * turned out to be false — it is HIDING a row that is still there, which is the
 * worse half of the pair, because there is nothing on the screen to be
 * suspicious of. `src/ui/availability.ts` is the worked example: a weekly slot
 * dropped from the phone over a delete the server declined leaves a coach whose
 * week no longer shows an hour the nightly generator is still opening sessions
 * at, and clients go on booking it.
 *
 * `confirmed` is what the SERVER said, never what was asked for — see
 * `writeFailure` in src/lib/wroteRows.ts for how a DELETE that matched nothing
 * arrives looking exactly like one that matched a row.
 *
 * Restored by value rather than by re-reading, because the row is in hand and a
 * re-read is a second thing that can fail. Position is not restored: the caller
 * sorts, and every list this is used on has an order of its own. Appending is
 * how the row gets back into that sort without this module inventing one.
 *
 * Returns the same array reference when nothing changes, and is idempotent — a
 * row already back in the list is not appended twice, so a retry that races a
 * re-read cannot double it.
 */
function settleRemoval(rows, removed, confirmed) {
    if (confirmed)
        return rows;
    if (!removed)
        return rows;
    if (rows.some((r) => r.id === removed.id))
        return rows;
    return [...rows, removed];
}
