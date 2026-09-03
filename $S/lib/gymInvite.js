"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCEPT_NOTE = exports.LAPSED_NOTE = void 0;
exports.invitePlanLine = invitePlanLine;
exports.inviteWindowLine = inviteWindowLine;
exports.gymInviteCard = gymInviteCard;
exports.gymInviteCards = gymInviteCards;
exports.acceptedMessage = acceptedMessage;
exports.acceptFailedMessage = acceptFailedMessage;
// What a member is told about an invitation their GYM sent them, and what the
// Accept button is allowed to be.
//
// The record and the rules are in src/lib/memberInvites.ts — that module owns
// `inviteState`, `isRedeemable` and `daysUntilExpiry`, and 37-member-invites.sql
// applies the same two conditions server-side. This module owns only the
// sentences, for the same reason src/lib/memberRecord.ts owns the membership
// ones: the copy has to distinguish states that look identical in the data, and
// a screen that composes its own strings gets those distinctions wrong.
//
// ── The funnel this sits at the end of ────────────────────────────────────
//
// A gym invites two hundred people by email. `inviteMessage` in memberInvites.ts
// tells each of them: "sign up with this exact address… that is how the
// invitation finds you". They did. And then no screen in this app read
// `member_invites` for the signed-in person, so `fetchMyInvites` and
// `acceptInvite` sat unimported and the invitation — with the membership plan
// the gym attached to it — waited until somebody at reception typed them in
// again by hand.
//
// ── The three things this copy must never do ──────────────────────────────
//
//  1. NAME A GYM IT CANNOT READ. Until the invitation is accepted the invitee
//     is not in the tenant, and `tenants_client_r` scopes tenant rows to people
//     who already are — so `fetchMyInvites` comes back with a tenant id and no
//     name. "Your gym" is a description and is true whatever the name is; an
//     invented one is not. The same choice is made by `reminderMessage` in
//     src/lib/inviteDelivery.ts.
//  2. DESCRIBE A PLAN IT COULD NOT READ AS "NO PLAN". `planId` set with
//     `planName` null is a plan we were not allowed to read; `planId` null is a
//     gym that attached none. Rule 1 in src/lib/memberRecord.ts is the same
//     distinction on the same data, and part 125 is the live hole that made it
//     real.
//  3. INVENT A DEADLINE. No expiry recorded is not "expires today". It gets no
//     sentence at all rather than a made-up one.
const memberInvites_1 = require("./memberInvites");
const gymLabel = (inv, names) => {
    const n = names?.byTenant?.get(inv.tenantId);
    return n && n.trim() ? n.trim() : null;
};
/**
 * The plan sentence, or null when there is nothing honest to say.
 *
 * Three states, three answers, and the middle one is the whole reason this is a
 * function: a plan the invitation carries but whose name we could not read must
 * not be reported as no plan at all. The member would arrive at the desk
 * believing nothing had been agreed.
 */
function invitePlanLine(inv) {
    if (inv.planName && inv.planName.trim())
        return `The plan attached to it is ${inv.planName.trim()}.`;
    if (inv.planId)
        return 'A membership plan is attached to it, and its name could not be read here — the gym can tell you which.';
    return 'No plan is attached to it, so what you pay for is settled with the gym.';
}
/**
 * How long it stays open, or null when nobody recorded a date.
 *
 * `daysUntilExpiry` returns null for both "no expiry" and "an expiry we could
 * not parse", and both get silence here rather than a deadline this app made
 * up. Zero days left is not rendered either: at zero it has lapsed, and
 * `lapsedNote` is what the card says instead.
 */
function inviteWindowLine(inv, now = Date.now()) {
    const d = (0, memberInvites_1.daysUntilExpiry)(inv, now);
    if (d == null || d <= 0)
        return null;
    return d === 1 ? 'It stays open until tomorrow.' : `It stays open for another ${d} days.`;
}
/** What a member can do about an invitation that has run out, which is nothing
 *  in this app — so the sentence points at the only party who can reopen it. */
exports.LAPSED_NOTE = 'This invitation has passed its date, so it can no longer be accepted here. Ask the gym to send it again — nothing on this screen can reopen it.';
/** What accepting actually does. Written in the present tense of the record it
 *  makes, not as a promise about what the gym will then do for you. */
exports.ACCEPT_NOTE = 'Accepting adds you to their member list and opens your membership.';
/**
 * One invitation as the member's screen renders it.
 *
 * `now` is a parameter so the tests can stand at a date and so a screen never
 * has two different opinions about the same second.
 */
function gymInviteCard(inv, names, now = Date.now()) {
    const gym = gymLabel(inv, names);
    const state = (0, memberInvites_1.inviteState)(inv, now);
    const lapsed = state === 'expired';
    const canAccept = (0, memberInvites_1.isRedeemable)(inv, now);
    const title = gym ? `${gym} Invited You to Join` : 'A Gym Has Invited You to Join';
    const parts = [];
    if (lapsed) {
        parts.push(exports.LAPSED_NOTE);
        const plan = invitePlanLine(inv);
        if (plan)
            parts.push(plan);
    }
    else if (canAccept) {
        parts.push(exports.ACCEPT_NOTE);
        const plan = invitePlanLine(inv);
        if (plan)
            parts.push(plan);
        const window = inviteWindowLine(inv, now);
        if (window)
            parts.push(window);
    }
    else {
        // 'accepted' or 'revoked'. fetchMyInvites asks for pending rows only, so
        // this is reached when the row moved under us between the read and the
        // render — and it must not offer a button that would fail.
        parts.push('This invitation is no longer open. If you think that is wrong, the gym can send you another.');
    }
    return { id: inv.id, title, note: parts.join(' '), canAccept, lapsed };
}
/**
 * Every invitation the member should see, in the order they should see it.
 *
 * Redeemable first — those are the ones with a decision in them — and newest
 * first within each group, which is the order `fetchMyInvites` already asks the
 * server for. Nothing is dropped: a lapsed invitation is shown, because the
 * member was told by email that one exists and a screen that silently omits it
 * is the same dead end by a quieter route.
 */
function gymInviteCards(invites, names, now = Date.now()) {
    const open = invites.filter((i) => (0, memberInvites_1.isRedeemable)(i, now));
    const rest = invites.filter((i) => !(0, memberInvites_1.isRedeemable)(i, now));
    return [...open, ...rest].map((i) => gymInviteCard(i, names, now));
}
/**
 * What to say once the server has accepted one.
 *
 * Takes the gym name the card had, so the confirmation and the card agree, and
 * degrades to the same description rather than to a blank.
 */
function acceptedMessage(gymName) {
    const who = gymName && gymName.trim() ? gymName.trim() : 'your gym';
    return `You are on the member list at ${who}. Your membership, plan and classes are on the Membership screen.`;
}
/**
 * What to say when it did not work, which is never "it worked".
 *
 * `accept_member_invite` raises rather than returning null — an expired invite,
 * an invite for somebody else's address, a second attempt at one already
 * accepted — and supabase-js resolves a raised exception as `error`, so a
 * caller that ignores it reports success for every one of those. The reason
 * travels only when it is safe to show: anything unrecognised becomes the
 * general sentence rather than raw Postgres.
 */
function acceptFailedMessage(reason) {
    const r = (reason ?? '').toLowerCase();
    // Each branch mirrors one `raise exception` in accept_member_invite, in the
    // order the function raises them. The function distinguishes these on purpose
    // — its own comment says "you have already joined" is not "this has lapsed" —
    // and collapsing them back into one sentence here would throw that away.
    if (r.includes('not signed in'))
        return 'You are signed out, so nothing was accepted. Sign in with the address the gym invited and try again.';
    if (r.includes('not found'))
        return 'That invitation is no longer on the gym’s list, so nothing was accepted. Ask them to send it again.';
    if (r.includes('not addressed to you'))
        return 'That invitation was sent to a different email address, so nothing was accepted. It has to be accepted from an account signed up with the address the gym invited.';
    if (r.includes('already accepted'))
        return 'You had already accepted that invitation, so nothing changed just now. Your membership is on the Membership screen.';
    if (r.includes('withdrawn'))
        return 'The gym withdrew that invitation, so nothing was accepted. They can send you another.';
    if (r.includes('expired'))
        return 'That invitation has passed its date, so nothing was accepted. Ask the gym to send it again.';
    if (r.includes('owner cannot join'))
        return 'This account owns a gym, so it cannot join one as a member. Nothing was accepted.';
    if (r.includes('trainer cannot be moved'))
        return 'This account coaches at another gym, so a member invitation cannot move it. Nothing was accepted — the gym can add you at the desk instead.';
    return 'Nothing was accepted — this did not reach the gym. Your invitation is still waiting, so you can try again in a moment.';
}
