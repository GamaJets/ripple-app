"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWhole = void 0;
exports.worstStatus = worstStatus;
/**
 * True when the provider has finished and what it holds is the whole set —
 * the one condition under which a screen may count, sum or average the rows.
 *
 * Written as a function rather than left to each screen's `=== 'ready'` because
 * the check that needs to be right is "is this all of it", and the two statuses
 * that fail it fail it for different reasons a reader has to hold in mind.
 */
const isWhole = (s) => s === 'ready';
exports.isWhole = isWhole;
/**
 * The status of several reads taken together: the least trustworthy of them.
 *
 * A screen fed by three providers is only as complete as its worst one. The
 * order is error, then loading, then partial, then ready — 'loading' outranks
 * 'partial' because a part still in flight is not yet known to be anything,
 * and calling the whole thing 'partial' while it lands would let a screen start
 * drawing a set that is about to change. Once everything has landed, 'loading'
 * is gone and any truncation left in the mix is what the screen hears.
 */
function worstStatus(...s) {
    if (s.includes('error'))
        return 'error';
    if (s.includes('loading'))
        return 'loading';
    if (s.includes('partial'))
        return 'partial';
    return 'ready';
}
