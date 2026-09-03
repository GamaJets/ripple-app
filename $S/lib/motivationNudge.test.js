"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Motivational nudges: what may be said, and what must never be said off a
// failed read.
//
// The assertion that matters most is the first one. Under 'error' the workout
// log is EMPTY — not because nothing was logged but because nothing was read —
// so a nudge computed from it would tell a member with a live forty-day streak
// that they have nothing to protect, or tell somebody who trained this morning
// that they have not trained in a week. That banner cannot be taken back and
// the member has no way to know it was wrong.
//
// `ok`/`eq` into an errors array and process.exit(1) — never node:assert.
const motivationNudge_1 = require("./motivationNudge");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
// Midday, so an evening hour of 19 is still ahead of "now".
const NOW = new Date(2026, 2, 14, 12, 0, 0, 0).getTime();
const base = { now: NOW, streak: 5, trainedToday: false, daysSinceLastSession: 1, eveningHour: 19 };
const n = (over = {}) => (0, motivationNudge_1.motivationNudges)({ ...base, ...over });
// ── an unread log says nothing ───────────────────────────────────────────
{
    eq(n({ streak: null }).length, 0, 'AN UNREAD TRAINING LOG PRODUCES NO NUDGE — a banner computed from a failed read cannot be taken back');
    eq(n({ trainedToday: null }).length, 0, 'and neither does an unknown "did they train today"');
    eq(n({ daysSinceLastSession: null }).length, 0, 'nor an unknown last session');
    // All three together, which is what an 'error' status actually produces.
    eq(n({ streak: null, trainedToday: null, daysSinceLastSession: null }).length, 0, 'a wholly unread log is silent, which is the state a refused read leaves behind');
}
// ── the streak nudge ─────────────────────────────────────────────────────
{
    const out = n();
    eq(out.length, 1, 'a live streak with nothing logged today is worth one nudge');
    eq(out[0].kind, 'streak-risk', 'and it is the streak one');
    ok(out[0].body.includes('5'), 'which names the streak it is protecting');
    ok(out[0].route.includes('workouts'), 'and opens the screen that would save it');
    ok(out[0].at.getTime() > NOW, 'ALWAYS IN THE FUTURE — scheduleLocal silently refuses a past date');
    eq(out[0].at.getHours(), 19, 'at the evening hour asked for');
    eq(out[0].at.getDate(), 14, 'today, because the streak breaks at midnight tonight');
    eq(n({ trainedToday: true }).length, 0, 'nothing to protect once today is already logged');
    eq(n({ streak: 1 }).length, 0, `a streak of one is a session, not a pattern (threshold ${motivationNudge_1.STREAK_WORTH_PROTECTING})`);
    eq(n({ streak: motivationNudge_1.STREAK_WORTH_PROTECTING })[0].kind, 'streak-risk', 'and the threshold itself qualifies');
    eq(n({ streak: 0 }).length, 0, 'a streak of zero has nothing to lose');
}
// ── the evening that has already gone ────────────────────────────────────
//
// A reminder scheduled for TOMORROW evening is a reminder about a streak that
// broke at midnight. An hour from now still lands on the day it is about.
{
    const late = new Date(2026, 2, 14, 22, 0, 0, 0).getTime();
    const out = (0, motivationNudge_1.motivationNudges)({ ...base, now: late });
    eq(out.length, 1, 'a streak at 10pm is still worth a nudge');
    ok(out[0].at.getTime() > late, 'and it is still in the future');
    ok(out[0].at.getTime() - late <= 61 * 60 * 1000, 'AN HOUR FROM NOW, NOT TOMORROW EVENING — the streak breaks at midnight, so tomorrow is too late to be a reminder');
}
// ── the quiet week ───────────────────────────────────────────────────────
{
    const quiet = n({ streak: 0, daysSinceLastSession: motivationNudge_1.QUIET_AFTER_DAYS });
    eq(quiet.length, 1, 'a week with nothing logged is worth a nudge');
    eq(quiet[0].kind, 'quiet-week', 'and it is the quiet-week one');
    ok(quiet[0].body.includes(String(motivationNudge_1.QUIET_AFTER_DAYS)), 'which says how long it has been');
    // The rule src/lib/nudge.ts makes mechanical on the coach's side: a nudge
    // describes the RECORD and never the person. The same shape is produced by an
    // injury, a fortnight in Greece, a change of gym, and somebody who has
    // quietly decided they are finished.
    ok(/logged/.test(quiet[0].body), 'stated as a fact about the log');
    ok(!/motivat|lazy|slipp|giving up|falling off/i.test(quiet[0].body), `AND NEVER AS A DIAGNOSIS OF THE PERSON — got "${quiet[0].body}"`);
    eq(n({ streak: 0, daysSinceLastSession: motivationNudge_1.QUIET_AFTER_DAYS - 1 }).length, 0, 'six days is a rest, not a quiet week');
    // Somebody who has never logged anything. "You have not trained in 7 days"
    // said to them is a reproach for something they never started; the home
    // screen's Getting Started is their path.
    eq(n({ streak: 0, daysSinceLastSession: Infinity }).length, 0, 'A MEMBER WHO HAS NEVER LOGGED ANYTHING IS NOT NUDGED about a week they never had');
}
// ── at most one ──────────────────────────────────────────────────────────
//
// Two motivational banners in one evening is how a member turns motivational
// banners off.
{
    for (const streak of [0, 1, 2, 5, 40]) {
        for (const since of [0, 1, 6, 7, 30, Infinity]) {
            for (const today of [true, false]) {
                const out = (0, motivationNudge_1.motivationNudges)({ ...base, streak, trainedToday: today, daysSinceLastSession: since });
                ok(out.length <= 1, `at most one nudge (streak ${streak}, since ${since}, trained ${today}) — got ${out.length}`);
                for (const x of out)
                    ok(x.at.getTime() > NOW, `and it is in the future (streak ${streak}, since ${since})`);
            }
        }
    }
}
// ── the horizon is the honest limit ──────────────────────────────────────
{
    eq(motivationNudge_1.HORIZON_DAYS, 1, 'NOTHING IS ARMED BEYOND TODAY — a local notification a week out fires after the member stopped opening the app, computed from a log that was current a week ago, and would tell somebody who trained on Tuesday that they had not trained in a week');
}
if (errors.length) {
    console.error(`motivationNudge.test.ts — ${errors.length} failures:`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('motivationNudge.test.ts — ok');
