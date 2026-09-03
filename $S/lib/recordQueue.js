"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asGoalIntent = asGoalIntent;
exports.asDayPlanIntent = asDayPlanIntent;
exports.planExpiry = planExpiry;
exports.asGlucoseIntent = asGlucoseIntent;
exports.asScanIntent = asScanIntent;
exports.asCoachDocAcceptIntent = asCoachDocAcceptIntent;
exports.asSessionRequestIntent = asSessionRequestIntent;
exports.sessionRequestExpiry = sessionRequestExpiry;
exports.keptOnPhoneNote = keptOnPhoneNote;
exports.notKeptNote = notKeptNote;
// What the member-record outbox kinds carry, and the one expiry among them.
//
// ── Why these three, and why they are not the exclusions ──────────────────
//
// `src/lib/outbox.ts` names four kinds of write that are deliberately left to
// fail immediately — a booking, a cancellation, spending money, and anything
// carrying a file — and closes with the rule that admits the rest:
//
//     "Everything left is a write about the member's own record that says the
//      same thing whenever it lands."
//
// A goal, a planned day and a typed blood sugar reading all pass it, and all
// three had no queue. None is scarce: nobody else can take the member's goal.
// None is priced. None carries a file. And none of the three means anything
// different for having waited — a goal set on Tuesday is the same goal on
// Thursday, and a reading carries the moment it was taken rather than the
// moment it was sent, exactly as a measurement does.
//
// A fourth has since joined them and the same paragraph admits it: accepting a
// coach's own paperwork (`CoachDocAcceptIntent` below). Not scarce — nobody can
// take a member's signature on their own coach's waiver. Not priced. It carries
// no file: the document is already on the server and this holds a reference to
// it. And it means the same thing whenever it lands. src/lib/outbox.ts sets out
// why it has no expiry when the planned day does.
//
// `src/lib/crashQueue.ts` is the other side of the same argument and worth
// reading beside this: a crash report is deliberately NOT an outbox kind
// because it is a write about US rather than about the member, so the member-
// facing sentences the outbox draws are wrong for it. These three are the
// opposite case in every particular — they are the member's own record, they
// belong in the member's own sentence, and "1 goal saved on this phone and not
// sent yet" is exactly the right thing to put in front of the person who typed
// it.
//
// ── The one that expires, and why it is the only one ──────────────────────
//
// `src/lib/dayPlan.ts` · `canPlan` refuses to mark a date that has already
// gone, and states why: "Marking last Tuesday as a rest day is not a plan, it
// is a claim about what happened, and this table is not the place a claim about
// the past gets to live." An intent to mark Tuesday that surfaces on Wednesday
// is exactly that claim, arriving through the back door. So a day-plan intent
// carries an expiry of its own day and `partitionLapsed` takes it out rather
// than sending it — and `lapsedNote('day-plan')` tells the member their planned
// day did not go, which is the one outcome they cannot see for themselves.
//
// A goal and a reading have no such moment. A goal is about a future the member
// still wants; a reading carries its own `taken_at` and is filed on the day it
// was taken however late it lands. Giving either an expiry would be discarding
// somebody's own record on a timer for no reason.
//
// Pure, so every shape here is assertable under `npm test` with no device and
// no network. The writes themselves are in src/ui/recordOutbox.ts, and each
// screen's enqueue is in the provider that owns its rows.
const dayPlan_1 = require("./dayPlan");
const localDate_1 = require("./localDate");
const asDate = (v) => typeof v === 'string' && (0, localDate_1.dateParts)(v.slice(0, 10)) ? v.slice(0, 10) : null;
/**
 * A stored goal intent, or null.
 *
 * Null is what makes the handler answer 'refused' and take the item OUT, rather
 * than retrying a payload nothing can ever send on every reconnect for the life
 * of the install. So the checks here are the difference between a queue that
 * drains and one that shows "1 goal waiting" for ever.
 */
function asGoalIntent(p) {
    if (!p || typeof p !== 'object')
        return null;
    const o = p;
    const kind = typeof o.kind === 'string' ? o.kind : '';
    if (!kind)
        return null;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : null;
    const value = typeof o.value === 'number' && Number.isFinite(o.value) && o.value > 0 ? o.value : null;
    // A custom goal is its words and a measured goal is its number. Neither can be
    // written without the half that makes it a goal, and an insert of the empty
    // one would be a row on the member's list saying nothing.
    if (kind === 'custom' ? !title : value == null)
        return null;
    return { kind, value, title, targetDate: asDate(o.targetDate) };
}
function asDayPlanIntent(p) {
    if (!p || typeof p !== 'object')
        return null;
    const o = p;
    const dateISO = asDate(o.dateISO);
    if (!dateISO)
        return null;
    const remove = o.remove === true;
    if (remove)
        return { dateISO, type: null, note: null, remove: true };
    // A type this build does not recognise is refused rather than defaulted.
    // Coercing it to 'off' would write a Standard day where the member marked
    // something else — the app inventing somebody's plan, which is the rule
    // src/lib/plannedDays.ts already keeps on the way in.
    if (!(0, dayPlan_1.isPlannedDayType)(o.type))
        return null;
    const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null;
    return { dateISO, type: o.type, note, remove: false };
}
/**
 * When a day-plan intent stops meaning anything: the end of the day it is about.
 *
 * Local, and built from the parts rather than from `Date.parse`, for the reason
 * src/lib/dayPlan.ts gives at length — a bare date parsed as UTC is the previous
 * day west of Greenwich and the next one in Auckland, and this value decides
 * whether somebody's plan is sent or discarded.
 *
 * The boundary is the END of the day rather than its start, so an intent queued
 * on Tuesday morning and flushed on Tuesday evening still lands: the plan is
 * about a day that is still running, and `canPlan` would still accept it.
 *
 * Null when the date will not parse. Null means "no expiry", which is
 * `partitionLapsed`'s tolerant reading — and it is the right one here too: the
 * intent will be refused by `asDayPlanIntent` on the way out and dropped
 * cleanly, rather than being quietly discarded on the strength of a string this
 * function failed to read.
 */
function planExpiry(dateISO) {
    const p = (0, localDate_1.dateParts)(dateISO);
    if (!p)
        return null;
    // 00:00 the following day, local. Constructing the next day by adding one to
    // the day-of-month is safe: Date normalises 32 January into 1 February, and
    // month ends and leap years come out of that for free.
    return new Date(p[0], p[1], p[2] + 1, 0, 0, 0, 0).toISOString();
}
function asGlucoseIntent(p) {
    if (!p || typeof p !== 'object')
        return null;
    const o = p;
    const mmol = typeof o.mmol === 'number' && Number.isFinite(o.mmol) && o.mmol > 0 ? o.mmol : null;
    const at = typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? o.at : null;
    if (mmol == null || at == null)
        return null;
    return { id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null, mmol, at };
}
function asScanIntent(p) {
    if (!p || typeof p !== 'object')
        return null;
    const o = p;
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
    const takenAt = typeof o.takenAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.takenAt) ? o.takenAt : null;
    // Both bounds checked, because these are the two columns the scan cannot be
    // filed without and a payload that lost one would be retried on every
    // reconnect for ever. The ranges are the ones `scans` itself will accept.
    const weightKg = typeof o.weightKg === 'number' && Number.isFinite(o.weightKg) && o.weightKg > 0 ? o.weightKg : null;
    const bodyFatPct = typeof o.bodyFatPct === 'number' && Number.isFinite(o.bodyFatPct) && o.bodyFatPct > 0 ? o.bodyFatPct : null;
    if (!id || !takenAt || weightKg == null || bodyFatPct == null)
        return null;
    const muscle = typeof o.skeletalMuscleKg === 'number' && Number.isFinite(o.skeletalMuscleKg) && o.skeletalMuscleKg > 0
        ? o.skeletalMuscleKg : null;
    const metrics = o.metrics && typeof o.metrics === 'object' && !Array.isArray(o.metrics)
        ? o.metrics : null;
    return {
        id,
        takenAt,
        weightKg,
        bodyFatPct,
        skeletalMuscleKg: muscle,
        source: typeof o.source === 'string' && o.source.trim() ? o.source.trim() : 'InBody (manual)',
        metrics,
    };
}
function asCoachDocAcceptIntent(p) {
    if (!p || typeof p !== 'object')
        return null;
    const o = p;
    // An id is the whole intent. Without one there is no row this could ever
    // become, so it is refused and taken out rather than retried for ever.
    const documentId = typeof o.documentId === 'string' && o.documentId.trim() ? o.documentId.trim() : null;
    if (!documentId)
        return null;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : null;
    return { documentId, title };
}
function asSessionRequestIntent(p) {
    if (!p || typeof p !== 'object')
        return null;
    const o = p;
    // An hour is the whole intent. Without one there is nothing a coach could be
    // asked, so it is refused and taken out rather than retried for ever.
    const startsAt = typeof o.startsAt === 'string' && !Number.isNaN(Date.parse(o.startsAt)) ? o.startsAt : null;
    if (!startsAt)
        return null;
    const durationMin = typeof o.durationMin === 'number' && Number.isFinite(o.durationMin)
        && o.durationMin > 0 && o.durationMin <= 480 ? Math.round(o.durationMin) : null;
    if (durationMin == null)
        return null;
    const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null;
    return { startsAt, durationMin, note };
}
/**
 * When a queued request stops being worth sending: the hour it asks for.
 *
 * The second expiry in this file and the second one that exists because
 * lateness changes the meaning rather than merely the timing. `planExpiry`
 * refuses to let a plan become a claim about the past; this refuses to let a
 * question become one nobody can answer — `answer_session_request` declines a
 * request whose `starts_at` has gone, so an intent surfacing after it would put
 * a row in a coach's queue that the server would then refuse them.
 *
 * The same boundary the server enforces and the same one the member's screen
 * states (`EXPIRY_RULE` in src/lib/sessionRequests.ts). Three places, one rule,
 * and none of them is told it by the others — which is why the test asserts it
 * here rather than trusting the coincidence.
 *
 * Null when the instant will not parse, which is `partitionLapsed`'s tolerant
 * reading: `asSessionRequestIntent` refuses the payload on the way out and drops
 * it cleanly rather than it being discarded on the strength of a bad string.
 */
function sessionRequestExpiry(startsAt) {
    const t = Date.parse(startsAt);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/* ── what the member is told when one of these is kept ─────────────────── */
/**
 * The line a screen says at the moment it queues one of these.
 *
 * Deliberately the same promise as `outboxNote` and `unsentNote`, in the same
 * shape, because a member should not have to learn a third vocabulary for the
 * same situation — and because the delicate part is identical: the work is NOT
 * lost, it has NOT been stored, and the screen it belongs on will not show it
 * until it has.
 */
function keptOnPhoneNote(noun) {
    return `Your ${noun} is saved on this phone and not sent yet — it goes up next time you have signal, and it won’t show up here until it has.`;
}
/**
 * The line for a write that could not even be kept.
 *
 * `enqueue` answers 'full' when the device is holding as much as it will hold
 * and 'unavailable' when there is no account to key an outbox by or this
 * device's outbox could not be read. Two different situations, one thing the
 * member needs to know: nothing was kept, so nothing is coming.
 */
function notKeptNote(noun, why) {
    return why === 'full'
        ? `Your ${noun} was not saved. This phone is already holding as much unsent work as it will hold — get some signal so what is waiting can go up, then try again.`
        : `Your ${noun} was not saved and is not waiting to send. Nothing was kept, so try again once you have signal.`;
}
