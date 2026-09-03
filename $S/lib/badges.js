"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BADGE_COUNT = exports.BADGES = void 0;
exports.badgeFigures = badgeFigures;
exports.badgeMet = badgeMet;
exports.badgeState = badgeState;
exports.earnedKeys = earnedKeys;
exports.newlyEarned = newlyEarned;
exports.badgeByKey = badgeByKey;
exports.badgeAnnouncement = badgeAnnouncement;
const streaks_1 = require("./streaks");
const bodyweightSets_1 = require("./bodyweightSets");
/**
 * The set, in the order the screen lists them, which is roughly the order they
 * are earned in.
 *
 * The `icon` field this list used to carry is gone and stays gone: it held an
 * empty string for every badge after the emoji were stripped, so each tile drew
 * a blank 28px circle.
 */
exports.BADGES = [
    { key: 'first-rep', title: 'First Rep', desc: 'Log your first workout', cheer: 'Your first session is on the record. Everything else is built on this one.' },
    { key: 'on-a-roll', title: 'On a Roll', desc: '3-day streak', cheer: 'Three days in a row. That is the hardest part of a habit.' },
    { key: 'week-warrior', title: 'Week Warrior', desc: '7-day streak', cheer: 'Seven days in a row.' },
    { key: 'two-weeks', title: 'Two Weeks Strong', desc: '14-day streak', cheer: 'Two straight weeks of training.' },
    { key: 'unstoppable', title: 'Unstoppable', desc: '30-day streak', cheer: 'Thirty days in a row. Very few people get here.' },
    { key: 'ten-sessions', title: 'Ten Sessions', desc: 'Log 10 workouts', cheer: 'Ten sessions logged.' },
    { key: 'fifty-club', title: 'Fifty Club', desc: 'Log 50 workouts', cheer: 'Fifty sessions logged.' },
    { key: 'record-breaker', title: 'Record Breaker', desc: 'Set a personal record', cheer: 'Your first personal record is on the board.' },
    { key: 'pr-machine', title: 'PR Machine', desc: '5 personal records', cheer: 'Five personal records.' },
    { key: 'cardio-kick', title: 'Cardio Kick', desc: 'Log a cardio session', cheer: 'Cardio is on your record too.' },
    { key: 'one-tonne', title: 'One Tonne', desc: (vol) => `Lift ${vol(1000)} total volume`, cheer: 'You have moved a tonne of total volume.' },
    { key: 'ten-tonnes', title: 'Ten Tonnes', desc: (vol) => `Lift ${vol(10000)} total volume`, cheer: 'Ten tonnes of total volume moved.' },
];
exports.BADGE_COUNT = exports.BADGES.length;
/**
 * The figures out of a log.
 *
 * `history` is the member's weight over time and it is not optional in spirit,
 * only in signature: without it every bodyweight set contributes NOTHING to
 * volume and can never set a PR, so a calisthenics member's whole log reads
 * back as an empty one and the two volume badges and both PR badges stay locked
 * forever. `setLoadKg` is what resolves a bodyweight set to a real load, and
 * this is the second place in the app that has to remember to pass the history
 * to it.
 */
function badgeFigures(log, history = []) {
    // `tonnage`, not a fourth copy of the set loop. This one was the copy that
    // never learned about holds: it resolved a load through `setLoadKg` and then
    // multiplied it by the SECONDS of a plank, so one 45-second hold by an 80 kg
    // member scored 3,600 kg and unlocked One Tonne on its own. The badges meant
    // to mark a year of lifting were given away in a week, and every badge on the
    // screen — including the earned ones — was worth less afterwards.
    //
    // src/lib/bodyweightSets.ts is where that arithmetic lives and where it is
    // right: holds skipped outright, bodyweight sets priced at what the member
    // weighed on the day, and the ones it could not price counted separately
    // rather than folded into the total as zeros.
    //
    // `unknownSets` is exactly `unpricedBodyweightSets` was: a set that IS
    // bodyweight and came back unpriced is the app failing to read, not the
    // member failing to lift, so the screen can say "unknown" rather than
    // "locked" about the badges it holds back.
    const t = (0, bodyweightSets_1.tonnage)(log, history);
    const totalVolumeKg = t.kg;
    const unpricedBodyweightSets = t.unknownSets;
    return {
        totalWorkouts: log.length,
        longestStreak: (0, streaks_1.longestStreak)(log),
        prCount: (0, streaks_1.personalRecords)(log, history).length,
        hasCardio: log.some((e) => e.cardio),
        totalVolumeKg,
        unpricedBodyweightSets,
    };
}
/**
 * The badges whose thresholds are computed from set LOADS rather than from set
 * COUNTS, and which a bodyweight set nobody could price therefore holds back.
 *
 * Volume is an obvious one. The two PR badges belong here for the same reason:
 * `personalRecords` prices a bodyweight set through the same history, so
 * without it a member's pull-up sessions never set a record at all.
 */
const BODYWEIGHT_SENSITIVE = new Set([
    'one-tonne', 'ten-tonnes', 'record-breaker', 'pr-machine',
]);
/** Whether one badge's threshold is met by these figures. Monotone in every
 *  input — see the header, which is why 'earned' survives a partial read. */
function badgeMet(key, f) {
    switch (key) {
        case 'first-rep': return f.totalWorkouts >= 1;
        case 'on-a-roll': return f.longestStreak >= 3;
        case 'week-warrior': return f.longestStreak >= 7;
        case 'two-weeks': return f.longestStreak >= 14;
        case 'unstoppable': return f.longestStreak >= 30;
        case 'ten-sessions': return f.totalWorkouts >= 10;
        case 'fifty-club': return f.totalWorkouts >= 50;
        case 'record-breaker': return f.prCount >= 1;
        case 'pr-machine': return f.prCount >= 5;
        case 'cardio-kick': return f.hasCardio;
        case 'one-tonne': return f.totalVolumeKg >= 1000;
        case 'ten-tonnes': return f.totalVolumeKg >= 10000;
    }
}
/**
 * One badge's state, given how much of the log was actually read.
 *
 * `whole` is `isWhole(logStatus)` from src/ui/loadStatus — true only when the
 * read succeeded AND was not truncated. Passing `true` for a failed read is the
 * bug this signature exists to make visible: under 'error' the log is empty,
 * every threshold evaluates false, and twelve badges render "Locked" to
 * somebody with a year of training.
 *
 * `bodyWhole` is the SECOND read this screen depends on and the one it forgot.
 * Four of these badges are priced from the weight history, which comes from the
 * scans; when that read fails the caller passes an empty history, every
 * bodyweight set contributes nothing, and One Tonne, Ten Tonnes, Record Breaker
 * and PR Machine all fall back under their thresholds. A whole log made
 * `whole` true, so they printed as "Locked" — our failed read stated as the
 * member's shortfall, which is exactly what the three-valued return exists to
 * prevent.
 *
 * It only applies where it is true: a member with no bodyweight sets in the log
 * loses nothing to a failed scans read, `unpricedBodyweightSets` is 0, and
 * "Locked" stays an honest statement about them. It defaults to `true` because
 * a caller that has no second read has nothing to be missing.
 */
function badgeState(key, f, whole, bodyWhole = true) {
    if (badgeMet(key, f))
        return 'earned';
    if (!whole)
        return 'unknown';
    if (!bodyWhole && f.unpricedBodyweightSets > 0 && BODYWEIGHT_SENSITIVE.has(key))
        return 'unknown';
    return 'locked';
}
/**
 * Which badges are earned, as keys.
 *
 * Safe on a partial read for the reason in the header, and NOT safe on a failed
 * one — a failed read gives an empty log, an empty log earns nothing, and
 * announcing "you lost eleven badges" is not a thing this app may do. Callers
 * that watch for changes must gate on the read having produced something at
 * all; `src/ui/badgeWatch.tsx` is where that gate lives and why.
 */
function earnedKeys(f) {
    return exports.BADGES.filter((b) => badgeMet(b.key, f)).map((b) => b.key);
}
/**
 * Badges in `now` that are not in `seen`, in list order.
 *
 * Order matters because it decides which one a single celebration names when
 * several land at once — the last in list order is the furthest along, so
 * `newlyEarned` returns them in list order and the caller takes the last as the
 * headline. Somebody who logs their fiftieth session unlocking both Ten
 * Sessions and Fifty Club should be congratulated on Fifty Club.
 *
 * A badge in `seen` and NOT in `now` is ignored entirely. That can only happen
 * when the log shrank — a deleted session, a truncated read — and revoking a
 * badge somebody was already told about is worse than letting a stale one
 * stand. Nothing here ever un-announces.
 */
function newlyEarned(now, seen) {
    const had = new Set(seen);
    return exports.BADGES.filter((b) => now.includes(b.key) && !had.has(b.key)).map((b) => b.key);
}
/** A badge by key, or null. */
function badgeByKey(key) {
    return exports.BADGES.find((b) => b.key === key) ?? null;
}
/**
 * The notification a newly-earned badge produces.
 *
 * `extra` is how many OTHER badges landed at the same moment. It is stated
 * rather than swallowed, because a member who unlocked three and was told about
 * one has been under-told; and it is not a second notification, because three
 * banners for one session is the fastest way to have notifications turned off.
 */
function badgeAnnouncement(key, extra) {
    const b = badgeByKey(key);
    if (!b)
        return null;
    return {
        // Title Case: this is a name, and it is the badge's own.
        title: `Badge unlocked · ${b.title}`,
        body: extra > 0
            ? `${b.cheer} ${extra === 1 ? 'One more badge' : `${extra} more badges`} unlocked at the same time.`
            : b.cheer,
    };
}
