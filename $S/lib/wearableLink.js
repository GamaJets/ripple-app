"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyRefusal = classifyRefusal;
exports.describeLink = describeLink;
exports.isLinked = isLinked;
/** Reasons the edge function sends alongside `connected: false`. */
const DEAD_REASONS = {
    expired_no_refresh_token: 'expired-no-refresh',
    refresh_failed: 'refresh-failed',
};
/**
 * Read the server's refusal for what it is.
 *
 * The edge function collapses two different events into one `connected: false`:
 * a token it cannot use at all, and a vendor endpoint that said 401/403. It has
 * to — from inside a single request it cannot tell them apart either. But WE
 * can, because we know whether the SAME token has just served a different
 * request successfully.
 *
 *   no reason at all            there is no stored row. Never connected.
 *   expired_no_refresh_token    the grant ran out and nothing can renew it.
 *   refresh_failed              renewal was attempted and refused.
 *   <vendor>_unauthorized       ONE endpoint said no. If the account has been
 *                               proven alive since, this is a scope gap on that
 *                               endpoint and the account is untouched. If not,
 *                               we have no evidence the token works for
 *                               anything, and saying "connected" would be a
 *                               guess — so it counts as revoked.
 *
 * That last clause is the one that stops a missing `read:sleep` scope from
 * being reported as a disconnected WHOOP.
 */
function classifyRefusal(reason, accountProvenAlive) {
    const r = (reason ?? '').trim();
    if (!r)
        return { level: 'account', why: 'no-token' };
    const known = DEAD_REASONS[r];
    if (known)
        return { level: 'account', why: known };
    if (/_unauthorized$/.test(r)) {
        return accountProvenAlive
            ? { level: 'metric', why: 'revoked' }
            : { level: 'account', why: 'revoked' };
    }
    // An unrecognised reason is not evidence of a live connection, and inventing
    // one here is how the next version of this bug gets written. Treated as a
    // dead token, which at worst offers a reconnect that was not needed — the
    // cheap direction of the two.
    return { level: 'account', why: 'revoked' };
}
/** The re-authorisation sentence, which never claims the person is signed out. */
function deadSentence(name, why) {
    switch (why) {
        case 'expired-no-refresh':
            return `${name} is still set up here, but the sign-in expired and ${name} issued nothing to renew it with. Reconnect and it picks up where it left off — nothing you have recorded is lost.`;
        case 'refresh-failed':
            return `${name} is still set up here, but Repple could not renew its sign-in. Reconnect to fix it — nothing you have recorded is lost.`;
        default:
            return `${name} is still set up here, but ${name} is no longer accepting Repple's sign-in. Reconnect to fix it — nothing you have recorded is lost.`;
    }
}
/**
 * The one answer. Both screens call this; neither decides anything itself.
 *
 * The order of the tests below IS the fix, so it is worth reading as an order:
 * a dead token is checked BEFORE the remembered flag, so a row on its own can
 * never produce the word "Connected"; and the metric is checked LAST, after the
 * account has already been found sound, so it can only ever narrow the sentence
 * and never contradict it.
 */
function describeLink(f) {
    const name = f.providerName;
    if (f.remembered === 'connecting') {
        return { state: 'connecting', connected: false, label: 'Connecting…', detail: `Waiting for ${name} to finish signing you in.`, action: null, tone: 'muted' };
    }
    // Before the remembered flag, deliberately. "Never claim connected on the
    // strength of a row existing if the token behind it is known dead."
    if (f.token.kind === 'dead') {
        if (f.token.why === 'no-token') {
            return { state: 'never', connected: false, label: 'Connect', detail: `${name} is not connected. Sign in once and your days sync on their own.`, action: 'connect', tone: 'muted' };
        }
        return { state: 'expired', connected: false, label: 'Reconnect', detail: deadSentence(name, f.token.why), action: 'reconnect', tone: 'warn' };
    }
    if (f.remembered !== 'connected') {
        return { state: 'never', connected: false, label: 'Connect', detail: `${name} is not connected. Sign in once and your days sync on their own.`, action: 'connect', tone: 'muted' };
    }
    // From here the account is sound, and nothing below may take that away.
    const m = f.metric;
    if (m && m.proof.kind === 'refused') {
        return {
            state: 'metric-blocked',
            connected: true,
            label: 'Connected',
            // Says connected first, on purpose. The complaint was a working device
            // being described as a broken one because one endpoint was shut.
            detail: `${name} is connected and working. It will not give Repple your ${m.name} yet — Repple did not ask ${name} for permission to read it when you signed in. Reconnect ${name} to grant it; everything else keeps working either way.`,
            action: 'reconnect',
            tone: 'warn',
        };
    }
    if (m && m.proof.kind === 'absent') {
        return {
            state: 'metric-blocked',
            connected: true,
            label: 'Connected',
            // Muted, and no action: this is a gap in Repple, and offering a reconnect
            // would send somebody round a loop that cannot end — which is precisely
            // what this tester was sent round.
            detail: `${name} is connected and working. ${m.proof.why}`,
            action: null,
            tone: 'muted',
        };
    }
    return { state: 'live', connected: true, label: 'Connected', detail: `${name} is connected and Repple is reading it.`, action: null, tone: 'ok' };
}
/**
 * The account-level answer on its own, for callers that only need the flag.
 *
 * Kept as a call through `describeLink` rather than a second implementation:
 * two functions answering "is it connected" is the shape the bug had.
 */
function isLinked(f) {
    return describeLink(f).connected;
}
