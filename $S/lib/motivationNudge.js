"use strict";
// The nudges the app sends about training, rather than about admin.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// All eighteen known push kinds in this repository are bookings, messages,
// notices, invoices or injuries — see KNOWN_PUSHES in src/lib/notifyInbox.ts.
// Not one is about the member's own training. Nothing fires for a streak about
// to break, a week with no session, or a badge unlocked. The single exception
// was a "remind me tonight" button on the home screen, which the member had to
// be inside the app to press, on the day it mattered, having already noticed
// the thing it was about to remind them of.
//
// ── WHAT THIS CAN AND CANNOT DO, STATED PLAINLY ───────────────────────────
//
// These are LOCAL notifications. They are armed while the app is open and fire
// later on this phone, so they reach somebody who opened the app this morning
// and forgot by evening — which is the common case and most of the value. They
// do NOT reach somebody who has not opened the app for a week, and that is the
// case a "you have not trained in a week" nudge most wants to reach.
//
// Closing that needs a server: a scheduled function that reads the training log
// and sends through send-push, which is a database job with a cron and an edge
// function deploy. Nothing here pretends otherwise, and nothing here is
// scheduled far enough out to look like it does — see `HORIZON_DAYS`.
//
// Pure: it decides WHAT to arm and WHEN, from figures a caller supplies. The
// arming itself is src/ui/motivationNudges.tsx.
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUIET_AFTER_DAYS = exports.STREAK_WORTH_PROTECTING = exports.HORIZON_DAYS = void 0;
exports.motivationNudges = motivationNudges;
/**
 * How far ahead anything here is scheduled.
 *
 * One day, and not more, and this is the honest limit rather than a tuning
 * knob. A local notification armed a week out would still fire after the member
 * has stopped opening the app — which looks exactly like the server-side
 * re-engagement push this cannot do, except that it is computed from a training
 * log that was current a week ago. So it would tell somebody who trained on
 * Tuesday that they had not trained in a week, and it would keep doing it.
 *
 * Everything here is armed for today, from figures read today, and re-armed the
 * next time the app is opened.
 */
exports.HORIZON_DAYS = 1;
/** Below this a streak is not worth protecting with a notification. Two days is
 *  a pattern beginning; one day is a session. */
exports.STREAK_WORTH_PROTECTING = 2;
/** After this many days with nothing logged, the week is quiet. Seven, so it
 *  fires on a genuinely missed week rather than on a planned rest day. */
exports.QUIET_AFTER_DAYS = 7;
/** The evening instant on the day of `now`, or the next one if it has gone. */
function eveningOf(now, hour) {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    // Already past. An hour from now rather than tomorrow evening: the thing
    // being protected is TODAY's session, and a reminder tomorrow evening is a
    // reminder about a streak that has already broken.
    if (d.getTime() <= now)
        return new Date(now + 60 * 60 * 1000);
    return d;
}
/**
 * What to arm right now, or an empty list.
 *
 * At most ONE nudge. The two conditions are mutually exclusive in practice — a
 * live streak and a quiet week cannot both be true — but the cap is explicit
 * rather than incidental, because two motivational banners in one evening is
 * how a member turns motivational banners off.
 *
 * Nothing is produced from an unread log. Every field that can be null is
 * checked, and a null in any of them means the caller could not read the
 * training log, which is a fact about our read and not about the member's week.
 */
function motivationNudges(i) {
    // An unread log produces nothing at all. This is the whole of the safety
    // here: the alternative is a nudge telling somebody they have not trained in
    // a week because a network call failed.
    if (i.streak == null || i.trainedToday == null || i.daysSinceLastSession == null)
        return [];
    // A streak that is alive, worth protecting, and not already safe today.
    if (!i.trainedToday && i.streak >= exports.STREAK_WORTH_PROTECTING) {
        return [{
                kind: 'streak-risk',
                title: 'Keep your streak alive',
                body: `One session today keeps your ${i.streak}-day streak going.`,
                route: '/(client)/workouts',
                at: eveningOf(i.now, i.eveningHour),
            }];
    }
    // Nothing logged for a week. Deliberately checked AFTER the streak, because
    // the two cannot both be true and the streak is the more urgent of the pair.
    //
    // A member who has NEVER logged anything is excluded: `daysSinceLastSession`
    // is Infinity for them, and "you have not trained in 7 days" said to somebody
    // who has never trained is a reproach for something they never started.
    // Getting Started on the home screen is that person's path, not this.
    if (Number.isFinite(i.daysSinceLastSession) && i.daysSinceLastSession >= exports.QUIET_AFTER_DAYS) {
        const days = Math.floor(i.daysSinceLastSession);
        return [{
                kind: 'quiet-week',
                title: 'It has been a week',
                // States the record, never the person. The rule src/lib/nudge.ts makes
                // mechanical for the coach's side: "nothing logged for eleven days" is
                // about the log, "losing motivation" is a diagnosis we cannot make.
                body: `Nothing logged for ${days} days. A short session counts — it is the coming back that matters.`,
                route: '/(client)/workouts',
                at: eveningOf(i.now, i.eveningHour),
            }];
    }
    return [];
}
