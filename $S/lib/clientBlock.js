"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientWeek = clientWeek;
exports.clientWeekLine = clientWeekLine;
/**
 * The week of the block the client is on.
 *
 * `weeks` is the block's own length from `weekCount` in
 * src/lib/programBlock.ts, and must be the same number that was handed to
 * `blockPosition` to produce `pos`. Clamped rather than trusted: `pos.week`
 * comes from arithmetic on a date and a programme can be edited between the two
 * calls, and an index past the end of the block renders an empty training day
 * over a programme that is not empty.
 */
function clientWeek(pos, weeks) {
    const count = Number.isFinite(weeks) && weeks >= 1 ? Math.floor(weeks) : 1;
    // Asked first, so a one-week programme can never be given a week number by
    // any of the branches below. A start date on a one-week programme is a real
    // and ordinary thing for a coach to set, and it must not make the client's
    // screen start counting weeks that do not exist.
    if (count === 1)
        return { index: 0, count, reason: 'only-week' };
    switch (pos.phase) {
        case 'during':
            return { index: Math.min(Math.max(pos.week ?? 1, 1), count) - 1, count, reason: 'counted' };
        case 'before':
            return { index: 0, count, reason: 'not-started' };
        case 'after':
            return { index: count - 1, count, reason: 'ended' };
        case 'unreadable':
            return { index: 0, count, reason: 'unreadable' };
        case 'no-date':
            return { index: 0, count, reason: 'no-date' };
    }
}
/**
 * The line the CLIENT reads under the week strip, in sentence case.
 *
 * `viewing` is the week whose days are on screen, which is the resolved week
 * until the client taps another one. When the two differ this says so and says
 * nothing else: a client reading ahead is not being told anything about their
 * effort, their adherence or their coach, only which week they have opened.
 *
 * Null for a one-week programme, so a programme written before blocks existed
 * renders exactly as it did, with no week number anywhere on the screen.
 */
function clientWeekLine(w, viewing) {
    if (w.count <= 1)
        return null;
    const n = viewing + 1;
    if (viewing !== w.index) {
        return `You are looking at week ${n} of ${w.count}. Your coach has you on week ${w.index + 1}.`;
    }
    switch (w.reason) {
        case 'counted':
            return `Week ${n} of ${w.count}, counted from the day your coach set this block to start.`;
        case 'not-started':
            // The honest half of `CLIENT_STARTS_NOW`, said to the person it is about.
            // A coach who dates a block for next Monday and assigns it on a Thursday
            // has changed this week's training, and the client is the one standing in
            // the gym wondering why today's session is not the one they did on
            // Tuesday.
            return `Your coach wrote this block to start later. Week one of it is on your plan now, so there is nothing to wait for.`;
        case 'ended':
            return `The last week of this block has passed. Your plan stays on week ${n} of ${w.count} until your coach writes the next one.`;
        case 'no-date':
            return `Your coach set no start date on this block, so your plan stays on week one. Tap any week to read ahead.`;
        case 'unreadable':
            return `A start date is stored on this block and this app cannot read it, so your plan stays on week one rather than guessing a week number.`;
        case 'only-week':
            return null;
    }
}
