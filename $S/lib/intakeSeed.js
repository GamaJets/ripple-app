"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.intakeSeedAction = intakeSeedAction;
exports.intakeSaveAllowed = intakeSaveAllowed;
exports.intakeBanner = intakeBanner;
/** Whether the seeding effect should run, given how the read went and what is
 *  already on screen. */
function intakeSeedAction(status, seededFrom) {
    if (status === 'loading')
        return 'wait';
    // Nothing on screen yet.
    if (seededFrom === null)
        return 'seed';
    // A stand-in for a document that could not be read, and now it can be.
    // 'partial' and 'ready' both mean the server answered; either is better than
    // a blank standing in for an unknown, and `draftDecision` still owns what
    // happens to anything typed in the meantime.
    if (seededFrom === 'local' && status !== 'error')
        return 'seed';
    return 'hold';
}
/**
 * May this screen write what is on it to the server?
 *
 * Both halves are required and they are not the same claim. The status says the
 * server answered. The source says the document on screen is what it answered
 * with. A 'local' document under a 'ready' status is precisely the state the
 * pull-to-refresh used to leave the screen in.
 *
 * 'partial' is refused for the reason src/lib/overwriteGuard.ts refuses it: a
 * document read in part is as unknown, for the purpose of replacing it, as one
 * not read at all.
 */
function intakeSaveAllowed(status, seededFrom) {
    return status === 'ready' && (seededFrom === 'server' || seededFrom === 'restored');
}
function intakeBanner(status, seededFrom) {
    if (status === 'loading')
        return 'loading';
    if (status !== 'error')
        return 'none';
    return seededFrom === 'server' || seededFrom === 'restored' ? 'stale' : 'unread';
}
