"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outcomeOptions = exports.channelOptions = exports.canLogContact = void 0;
exports.contactScope = contactScope;
exports.contactScopeLine = contactScopeLine;
exports.contactGapLine = contactGapLine;
exports.draftBlocker = draftBlocker;
exports.contactInsert = contactInsert;
const interventions_1 = require("./interventions");
/**
 * The scope, from what has actually been established.
 *
 * Order matters and each step is a fact that makes the ones below it
 * unanswerable rather than false. A client with no account cannot be in any
 * tenant; a coach with no gym cannot satisfy `my_tenant()` whatever the client
 * is; and a read still in flight has established nothing at all.
 */
function contactScope(i) {
    if (!i.clientHasAccount)
        return 'no-account';
    if (i.coachTenantStatus === 'loading' || i.clientTenantStatus === 'loading')
        return 'reading';
    // 'partial' counts as unknown here on purpose. A tenant id is one value: a
    // read that came back cut off has not established it, and the alternative to
    // saying so is deciding somebody is not a member of a gym off a truncated
    // answer.
    if (i.coachTenantStatus !== 'ready' || i.clientTenantStatus !== 'ready')
        return 'unknown';
    if (!i.coachTenantId)
        return 'no-gym';
    if (!i.clientTenantId)
        return 'other-gym';
    return i.coachTenantId === i.clientTenantId ? 'ok' : 'other-gym';
}
/** Whether a coach may log a contact at all. Exactly the scope in which the
 *  insert policy can be satisfied — offered only when it can succeed, because
 *  a control that is always refused is worse than no control. */
const canLogContact = (s) => s === 'ok';
exports.canLogContact = canLogContact;
/**
 * Why this log has nothing to say, in the coach's words — or null when it does
 * apply and did come back, which is the caller's cue to render the rows.
 *
 * `who` is a first name the caller has already established.
 */
function contactScopeLine(s, who) {
    switch (s) {
        case 'ok': return null;
        case 'reading': return 'Checking whether this client is one of your gym’s members…';
        case 'unknown':
            return `Whether ${who} is one of your gym’s members could not be established, so this log is not being shown rather than being shown empty. An empty contact log is the one thing here that must never be guessed at.`;
        case 'no-account':
            return `${who} has no account, so there is nothing for a contact to be recorded against. This log records contacts with your gym’s members.`;
        case 'no-gym':
            return 'This log is a gym’s shared record of who has already contacted a member, and this account is not attached to a gym. Your own notes on this client are on their timeline.';
        case 'other-gym':
            return `This log is a gym’s shared record of who has already contacted a member, and ${who} is not a member of your gym. Your own notes on them are on their timeline.`;
    }
}
/**
 * Why there are no contacts to show, given the read — or null when there are
 * some, or when the scope has already answered.
 *
 * Only 'ready' may say nobody has tried. That sentence is the entire value of
 * this table and it is also the one that gets somebody rung twice if it is
 * produced by a failed read: a coach told nobody has called rings the member
 * who was called on Tuesday, which is the duplicate effort the table exists to
 * prevent. studio-web's own read refuses a TRUNCATED page for the same reason,
 * and 'partial' is treated the same way here.
 */
function contactGapLine(status, count, who) {
    if (count > 0)
        return null;
    switch (status) {
        case 'loading': return 'Reading who has already tried…';
        case 'error':
            return `Who has already contacted ${who} could not be read, so this is not a statement that nobody has. Check before you call — a second call from your gym in one week is what this record exists to prevent.`;
        case 'partial':
            return `Only part of the contact history came back, so whether anybody has already contacted ${who} is not established. Check before you call.`;
        case 'ready':
            return `Nobody at your gym has recorded contacting ${who}. Log yours here afterwards so the next person to look does not call them again.`;
    }
}
/** What is still missing from the draft, or null when it can be sent. */
function draftBlocker(d) {
    if (!d.channel)
        return 'Choose how you contacted them.';
    if (!d.outcome)
        return 'Choose what came of it.';
    return null;
}
/** The row to insert, with the note trimmed to null. Takes the ids and the name
 *  rather than reading them, so a test can hold both ends. `by_id` is the
 *  caller's own because the insert policy requires it: a coach must not be able
 *  to file a call under a colleague's name, since "who has already tried" is
 *  the one thing that stops the second call. */
function contactInsert(d, ctx) {
    if (draftBlocker(d))
        return null;
    const note = d.note.trim();
    return {
        tenant_id: ctx.tenantId,
        member_id: ctx.memberId,
        at: ctx.at,
        channel: d.channel,
        by_id: ctx.byId,
        // A blank name is not a name. `by_name` is denormalised so the answer
        // survives the coach leaving the gym, and an empty string stored there
        // would render as a contact made by nobody.
        by_name: ctx.byName && ctx.byName.trim() ? ctx.byName.trim() : null,
        outcome: d.outcome,
        note: note ? note : null,
    };
}
/** The channel picker's options, as label and value. Here so the screen does
 *  not re-derive an order: `CHANNELS` in interventions.ts is the order the
 *  Studio console shows and a coach who uses both should see one list. */
const channelOptions = (list) => list.map((c) => ({ value: c, label: interventions_1.CHANNEL_LABEL[c] }));
exports.channelOptions = channelOptions;
/** The same for outcomes. */
const outcomeOptions = (list) => list.map((o) => ({ value: o, label: interventions_1.OUTCOME_LABEL[o] }));
exports.outcomeOptions = outcomeOptions;
