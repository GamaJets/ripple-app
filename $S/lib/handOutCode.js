"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOW_THEY_USE_IT = exports.UNREAD_NOTE = void 0;
exports.spokenCode = spokenCode;
exports.handOut = handOut;
exports.keptReason = keptReason;
exports.codeToGive = codeToGive;
exports.codesToHandOut = codesToHandOut;
exports.namedCodesLine = namedCodesLine;
exports.copyBlockedNote = copyBlockedNote;
exports.copiedNote = copiedNote;
exports.copyFailedNote = copyFailedNote;
// The code a coach hands to somebody standing in front of them.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// A coach's join code is the single thing that turns a conversation at the
// squat rack into a client. Until now the only place in the coach app that
// showed it was inside a modal sheet on the Clients tab — Add a Client — and
// nothing on any screen said the sheet held it. `/(trainer)/money` and
// `/(trainer)/ad-spend` read the same codes and show what each one RETURNED,
// which is a different question asked at a desk, not on a gym floor. Asked
// where their code was, a coach had to remember a button on one tab that opens
// a sheet whose title is about adding a client.
//
// So the code now has a screen of its own and this module is its rules. The
// screen is thin on purpose: everything below is pure, so the sentences a coach
// reads can be asserted under `npm test` with no device and no network.
//
// ── The one rule this file exists to hold ──────────────────────────────────
//
// AN UNREAD CODE IS NOT A MISSING ONE.
//
// This is the same danger src/lib/joinCodes.ts describes about counts, moved
// one step earlier and made worse. There, a failed read printed "0 joined" and
// a coach concluded their flyer had failed. Here, a failed read printing
// "you have no code yet" would send a coach to press New Code — which ROTATES,
// invalidating the string already printed on their cards and given to everybody
// they met last week, to solve a problem that was a dropped request. The old
// code is destroyed and nothing on the screen ever said the read had failed.
//
// `my_join_code()` allocates on first ask and is stable after, so a signed-in
// coach with a trainer profile always HAS a code. A screen that cannot show one
// is therefore describing itself, not the coach, and every sentence below says
// so in those words.
//
// The React half is app/(trainer)/join-code.tsx. Nothing here imports
// react-native, expo or the network.
const joinCode_1 = require("./joinCode");
/**
 * The characters, one at a time, for VoiceOver.
 *
 * "AB4K7M" is read out as a word — something between "abfortkaysevenem" and
 * silence, depending on the engine — and this is a string whose whole purpose
 * is being transcribed correctly by somebody who cannot see it. Spacing them
 * makes each one its own utterance.
 *
 * The dashboard already did this inline in three places with
 * `code.split('').join(' ')`. It is here so the fourth place cannot forget.
 */
function spokenCode(code) {
    return (0, joinCode_1.normaliseCode)(code).split('').join(' ');
}
/** Everything the screen needs to hand ONE code over. */
function handOut(code) {
    const c = (0, joinCode_1.normaliseCode)(code);
    return { code: c, spoken: spokenCode(c), link: (0, joinCode_1.joinLink)(c), message: (0, joinCode_1.inviteMessage)(c) };
}
/**
 * The sentence under a code that could not be read.
 *
 * Deliberately two clauses, and the second is the load-bearing one: it names
 * what is NOT true, because the wrong conclusion is the expensive one. Whatever
 * the provider's own reason was is kept in front of it — it may say something
 * actionable, like being signed out — but it is never allowed to be the last
 * word, because none of the provider's reasons say "you still have a code".
 */
exports.UNREAD_NOTE = 'This is about the read, not about your code. You still have one, it has not changed, and every card and link you have already given out still works. Try again when you have a connection rather than issuing a new code — issuing one stops the old one working for everybody you have handed it to.';
/**
 * The provider's own reason, minus any part of it that claims there is no code.
 *
 * `fetchMyJoinCode` returns three reasons and two of them end "…so there is
 * nothing to give out yet". That sentence was written for a screen that had one
 * job — decide whether to draw a code — and on THIS screen it is the exact
 * false conclusion the whole file exists to stop: printed first, in the app's
 * own voice, immediately above UNREAD_NOTE contradicting it. A coach reads the
 * first sentence, believes they have no code, and presses New Code.
 *
 * What is left is worth keeping. The third reason is "Sign in to Repple to get
 * your coaching code", which is a thing the coach can act on and is not a claim
 * about whether a code exists. Sentence by sentence rather than all-or-nothing,
 * so a future reason that pairs something actionable with a claim of absence
 * still shows its useful half.
 *
 * Nothing is lost when everything is dropped: `codeToGive` has already put "Your
 * code could not be read" at the top, which is the same fact without the false
 * clause on the end of it.
 */
const CLAIMS_NO_CODE = /nothing to give out|no code|have not got|haven’t got|haven't got|do not have one|don’t have one|don't have one/i;
function keptReason(raw) {
    const kept = String(raw || '')
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s && !CLAIMS_NO_CODE.test(s));
    return kept.length ? kept.join(' ') : null;
}
/**
 * What the person the code is handed to actually does with it.
 *
 * On the screen because a coach reading their code out is asked "and then
 * what?" by the person in front of them, and because the answer contains the
 * part nobody expects: the client is not on the roster when they type it. A
 * coach who does not know that does not go looking for the request, and
 * somebody who joined sits waiting.
 *
 * The same sentence the Add a Client sheet has always carried, held here so the
 * two cannot drift into telling a client two different things.
 */
exports.HOW_THEY_USE_IT = 'They enter it in the app under Find a trainer, at the top. It works whoever they are and whatever address they signed up with. You still approve them before they are on your roster, so check your notifications afterwards.';
/**
 * What the screen draws where the code goes.
 *
 * An empty string under 'ready' is treated as unread rather than rendered.
 * `fetchMyJoinCode` already refuses to return one, and this is the second lock
 * on the same door: a blank under the words "your code" is a thing a coach
 * reads out to somebody who is waiting.
 */
function codeToGive(read) {
    if (read.status === 'loading') {
        return {
            give: false,
            why: 'reading',
            head: 'Reading your code…',
            note: 'It will be here in a moment.',
        };
    }
    if (read.status === 'error') {
        // Through keptReason, never raw: two of the three reasons the provider can
        // return end by saying there is nothing to give out, which is the sentence
        // this file exists to keep off the screen.
        const why = keptReason(read.reason);
        return {
            give: false,
            why: 'unread',
            head: 'Your code could not be read',
            note: why ? `${why} ${exports.UNREAD_NOTE}` : exports.UNREAD_NOTE,
        };
    }
    const c = (0, joinCode_1.normaliseCode)(read.code);
    if (!c) {
        return {
            give: false,
            why: 'unread',
            head: 'Your code came back empty',
            note: exports.UNREAD_NOTE,
        };
    }
    return { give: true, hand: handOut(c) };
}
/**
 * The named codes worth putting on this screen, in the order to read them.
 *
 * LIVE ONES ONLY, and that is the difference between this list and the one on
 * the Clients sheet. That sheet is a record: it keeps revoked codes visible
 * because their counts are the history of what worked. This screen is an act —
 * a coach is about to give one of these to a person — and a revoked code handed
 * over is a client who downloads the app, types six characters and is told the
 * code has been turned off. The history has a screen; this is not it.
 *
 * The default code is excluded because the screen shows it above, on its own,
 * as the one to reach for by default.
 *
 * `shapeJoinCodes` has already ordered the rows — default first, then live
 * newest first — so this preserves that order rather than imposing another.
 */
function codesToHandOut(rows) {
    return (rows || []).filter((r) => r.isLive && !r.isDefault);
}
/**
 * The line under the named-codes heading.
 *
 * Four sentences for four states, and the three that are not "here they are"
 * are three different facts. Loading is not failed, failed is not empty, and
 * empty is the only one of them that is a claim about the coach.
 *
 * 'partial' cannot arise from my_join_codes() today — at most twenty-one rows,
 * counted server-side, well inside PostgREST's cap — and it is handled anyway,
 * for the reason src/lib/joinCodes.ts gives: the status is the provider's claim
 * about whether it holds all of it, and this screen is a list of things to hand
 * to a human being.
 */
function namedCodesLine(status, rows) {
    if (status === 'loading')
        return 'Looking for the other codes you have made…';
    if (status === 'error')
        return 'Your named codes could not be read, so this is not the list of them. The one above is unaffected.';
    if (status === 'partial')
        return 'Not all of your codes could be read, so this is not all of them.';
    if (codesToHandOut(rows).length === 0) {
        return 'None yet. A named code tells you which of the things you did brought somebody in — one for the gym flyer, one for your Instagram bio, both live at once.';
    }
    return 'Each of these works exactly like the one above, and counts separately, so you can tell later which one brought somebody.';
}
/**
 * How the code gets to the person, when the phone will not copy.
 *
 * expo-clipboard is a native module and this file ships over the air, so an OTA
 * landing on an older binary has no clipboard at all. Sharing is core React
 * Native and is always there. Neither of those is a reason to show a coach a
 * button that does nothing, and neither is a reason to hide the address — so
 * when there is no clipboard the link goes on the screen as selectable text,
 * which is what the Clients sheet already does.
 *
 * Returns the sentence to draw under the buttons, or null when there is nothing
 * a coach needs to be told.
 */
function copyBlockedNote(hasClipboard) {
    if (hasClipboard)
        return null;
    return 'This build cannot copy to the clipboard, so the link is written out above — press and hold to select it. Sharing still works.';
}
/**
 * What a coach is told after the bare link lands on the clipboard.
 *
 * The destination sentence is not a nicety and the Clients sheet already says
 * why: a paid ad pointed at a profile instead of at this link arrives with no
 * code on it, so the money that produced the click can never be tied to the
 * client it produced, and no work afterwards recovers it. The moment of copying
 * is the last moment that is still free to get right.
 */
function copiedNote(label) {
    return `Paste it into your bio, a caption or a description. Anybody who joins through it is attributed to ${label}, so you can see which post brought them.\n\n`
        + 'Running an ad? Use this as the ad’s destination — not your profile. It is what lets what you spent be matched to the clients it actually brought.';
}
/** What a coach is told when the copy did not land. The address is in it, so
 *  the sentence is still useful to somebody holding a pen. */
function copyFailedNote(link) {
    return `The link could not be copied. It is ${link} — write it down, or share it instead.`;
}
