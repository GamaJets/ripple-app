"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currencyForModel = currencyForModel;
/** The clause every unknown ends with. One instruction, worded once. */
const SAY_NOTHING = 'state no amount';
/**
 * The value to put in a model's context for "what is this coach priced in".
 *
 * `null` is the read that has not come back — the same thing a screen shows as
 * a spinner — and it is deliberately not folded into 'unreadable', because a
 * read in flight is not a read that failed.
 */
function currencyForModel(cur) {
    const code = (cur?.currency || '').trim().toUpperCase();
    if (code)
        return code;
    return `unknown — ${reasonFor(cur ? cur.gap : 'reading')}, so ${SAY_NOTHING}`;
}
function reasonFor(gap) {
    switch (gap) {
        case 'reading':
            return 'their currency has not been read yet';
        case 'unreadable':
            // The distinction that matters most here. A model told "none is set"
            // will reason about a coach who has not set one; the truth is that we
            // could not look.
            return 'their currency could not be read, which is not the same as none being set';
        case 'unavailable':
            return 'setting a currency of their own is not switched on in this deployment yet';
        case 'nowhere':
            return 'there is no coach record on this account for a currency to live on';
        case 'gym-unset':
            return 'they are in a gym and its owner has not set one';
        case 'own-unset':
            return 'they are attached to no gym and have not chosen one yet';
        // A null gap alongside no code is a contradiction — `resolveMyCurrency`
        // returns a gap whenever it returns no currency. Answered as unknown
        // rather than as anything a model could price from.
        case null:
            return 'their currency is not known';
    }
}
