"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceSleepTrust = deviceSleepTrust;
exports.readinessBreakdown = readinessBreakdown;
const loadStatus_1 = require("../ui/loadStatus");
const sleepMerge_1 = require("./sleepMerge");
/**
 * The trust owed to the DEVICE half of the sleep read.
 *
 * `deviceSleep.status` describes the walk, not the devices: it is 'ready' the
 * moment every provider has been asked, whatever each of them answered. This is
 * the missing half — the per-provider outcome folded back into one word.
 *
 *   · No connected provider at all is 'ready'. Nothing was asked and nothing is
 *     missing; a member with no watch is not a member with a broken watch.
 *   · Every provider failing is 'error'. We know nothing about their devices.
 *   · Some failing while others answered is 'partial': the nights we have are
 *     real, and there may be nights we do not have.
 *   · 'unsupported' is never a failure. Health Connect not reporting sleep is a
 *     settled fact about this build, not a gap in what we know about tonight.
 */
function deviceSleepTrust(walk, sources) {
    if (walk === 'loading')
        return 'loading';
    if (walk === 'error')
        return 'error';
    const asked = sources.filter((s) => s.status !== 'unsupported');
    if (!asked.length)
        return 'ready';
    const failed = asked.filter((s) => s.status === 'error');
    if (!failed.length)
        return walk;
    return failed.length === asked.length ? 'error' : 'partial';
}
/** "WHOOP", "WHOOP and Oura Ring", "WHOOP, Oura Ring and Apple Health". */
function nameList(names) {
    if (names.length <= 1)
        return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
/** Where the nights in the window came from, as a clause. */
function sleepProvenance(s) {
    if (s.fromDevice && s.fromTyped) {
        return `${s.fromDevice} measured by a device, ${s.fromTyped} from the nights you logged`;
    }
    if (s.fromDevice)
        return s.fromDevice === 1 ? 'measured by a device' : 'all measured by a device';
    return s.fromTyped === 1 ? 'from a night you logged' : 'all from the nights you logged';
}
function sleepLine(i, trust) {
    const title = 'Sleep';
    const avg = i.sleep.avgHours;
    const used = i.sleep.nights.length;
    if (avg != null && Number.isFinite(avg) && avg > 0 && used > 0) {
        // "across 2 of the last 3 nights" rather than a bare average. A mean over
        // one night and a mean over three are different claims and the figure
        // cannot tell them apart, which is the whole reason this line exists.
        const span = used >= i.windowNights
            ? `over the last ${i.windowNights} nights`
            : `over ${used} of the last ${i.windowNights} nights`;
        return {
            key: 'sleep', title, state: 'scored',
            detail: `${(0, sleepMerge_1.formatSleepHours)(avg * 60)} a night ${span}, ${sleepProvenance(i.sleep)}`,
        };
    }
    // No hours. Which of the four absences it is decides what the member does
    // next, so they are never collapsed into one sentence.
    if (trust === 'loading' || i.typedStatus === 'loading') {
        return { key: 'sleep', title, state: 'unread', detail: 'still being read' };
    }
    if (trust === 'error') {
        return {
            key: 'sleep', title, state: 'unread',
            detail: 'we could not read your devices, so a night one of them measured may be missing',
        };
    }
    if (i.typedStatus === 'error') {
        return {
            key: 'sleep', title, state: 'unread',
            detail: 'we could not read your sleep log, so we do not know what you have logged',
        };
    }
    return {
        key: 'sleep', title, state: 'no-record',
        detail: `nothing recorded for the last ${i.windowNights} nights`,
    };
}
/**
 * The device's own verdict, or the reason there isn't one.
 *
 * Four outcomes and they are not interchangeable, which is the same discipline
 * `sleepLine` applies one function up. The one that matters most is the last:
 * a member with a WHOOP whose sync has not landed is told their device did not
 * report today, because that is something they can go and fix in the WHOOP app
 * — and the member with no device at all is told nothing of the kind, because
 * for them nothing is wrong.
 */
function recoveryLine(i) {
    // Title Case, and "Device Recovery" rather than "Recovery": this screen is
    // reached from a hero labelled Readiness and sits on a screen called
    // Recovery, so a bare "Recovery" row would be the third use of the word on
    // one screen for the third different thing.
    const title = 'Device Recovery';
    const pct = i.recoveryPct;
    if (pct != null && Number.isFinite(pct)) {
        const who = i.recoveryFrom ? `${i.recoveryFrom}'s ` : '';
        // The vendor's own word for its own figure. Oura ships this as readiness
        // and WHOOP as recovery, and printing one vendor's word over the other's
        // number is how a member concludes the app is showing them something else.
        const word = i.recoveryFrom === 'Oura Ring' ? 'readiness score' : 'recovery score';
        return { key: 'recovery', title, state: 'scored', detail: `${who}${word}, ${Math.round(pct)} out of 100` };
    }
    if (!i.recoveryDeviceConnected) {
        return {
            key: 'recovery', title, state: 'not-tracked',
            detail: 'not in the scale — no connected device scores recovery',
        };
    }
    return {
        key: 'recovery', title, state: 'unread',
        detail: 'not in the scale — your device has not reported a recovery score today',
    };
}
function hydrationLine(i) {
    const title = 'Hydration';
    const pct = i.hydrationPct;
    if (pct != null && Number.isFinite(pct)) {
        return { key: 'hydration', title, state: 'scored', detail: `${Math.round(pct * 100)}% of today's goal` };
    }
    // Untracked and unread land in the same null and are NOT the same sentence.
    // Neither is a deduction — readinessScore rescales rather than docking the
    // score — so both say so, because a member who reads "no hydration figure"
    // under a lower number will assume they were marked down for it.
    if (!i.hydrationGoal) {
        return { key: 'hydration', title, state: 'not-tracked', detail: 'not in the scale — you have not set a daily water goal' };
    }
    if (i.hydrationStatus !== 'ready') {
        return { key: 'hydration', title, state: 'unread', detail: "not in the scale — today's count could not be read" };
    }
    return { key: 'hydration', title, state: 'not-tracked', detail: 'not in the scale — nothing was scored against it' };
}
function loadLine(i) {
    // Title Case, and the member's words rather than ours: "load" is a coach's
    // term and this row is read by everybody.
    const title = 'Recent Sessions';
    const n = i.workoutsLast2Days;
    if (n == null || !Number.isFinite(n)) {
        return { key: 'load', title, state: 'unread', detail: 'we could not read your training log' };
    }
    return {
        key: 'load', title, state: 'scored',
        detail: n === 0 ? 'no sessions in the last two days' : `${n} session${n === 1 ? '' : 's'} in the last two days`,
    };
}
/**
 * Why there is no score. Ordered by what the member should do about it, which
 * is not the order the signals are scored in.
 *
 * The training log comes first because it is the only absence that is never the
 * member's: `workoutsLast2Days` is null for exactly one reason, a failed read,
 * and telling somebody to log a night of sleep when the real problem is our
 * read sends them to do work that will not help.
 */
function absenceFor(i, trust) {
    if (i.workoutsLast2Days == null || !Number.isFinite(i.workoutsLast2Days)) {
        return 'We could not read your training log, so there is no readiness to show — it does not mean you are rested.';
    }
    if (trust === 'loading')
        return 'Reading last night from your devices…';
    if (i.typedStatus === 'loading')
        return 'Reading the nights you have logged…';
    if (trust === 'error') {
        return 'We could not read your devices just now, so there is no readiness to show — it does not mean you slept badly.';
    }
    if (i.typedStatus === 'error') {
        // Live until now: an unreadable sleep log with an empty cache reached the
        // home screen as "log a night of sleep", which is a statement about what
        // the member has done, made out of a read that failed.
        return 'We could not read your sleep log just now, so there is no readiness to show — it does not mean you have not logged a night.';
    }
    if (i.sources.some((s) => s.status !== 'unsupported')) {
        return `No sleep on record for the last ${i.windowNights} nights yet.`;
    }
    return 'Log a night of sleep, or connect a watch, to see your readiness.';
}
function caveatsFor(i, trust) {
    const out = [];
    const failed = i.sources.filter((s) => s.status === 'error').map((s) => s.name);
    if (failed.length) {
        const one = failed.length === 1;
        out.push(`${nameList(failed)} could not be read, so a night ${one ? 'it' : 'they'} measured may be missing from this.`);
    }
    else if (trust === 'error') {
        // The walk itself failed, so there are no per-provider rows to name — the
        // same hole the Recovery screen had to grow its own sentence for.
        out.push('We could not reach your devices just now, so a night one of them measured may be missing from this.');
    }
    if (i.typedStatus === 'error') {
        out.push('Your sleep log could not be checked against your account, so a night logged on another device may be missing from this.');
    }
    if (i.hydrationGoal && i.hydrationStatus !== 'ready' && i.hydrationStatus !== 'loading') {
        out.push("Today's water count could not be read, so hydration is not in the scale.");
    }
    return out;
}
/**
 * The account of one readiness score: what went in, what did not, and how much
 * of what could have been read was.
 *
 * Describes; never recomputes. Everything it says about the scale it says from
 * the same values the caller handed `readinessScore`, so the breakdown and the
 * number cannot disagree — which is the failure mode of every second copy of a
 * derivation in this codebase.
 */
function readinessBreakdown(i) {
    const trust = deviceSleepTrust(i.deviceStatus, i.sources);
    const lines = [sleepLine(i, trust), recoveryLine(i), hydrationLine(i), loadLine(i)];
    const caveats = caveatsFor(i, trust);
    // With no score, the status is about the READ that failed to produce one —
    // and 'ready' when the absence is genuine, because "you have not logged a
    // night" is a complete answer rather than a broken one.
    if (i.readiness == null) {
        const stalled = (0, loadStatus_1.worstStatus)(trust === 'partial' ? 'ready' : trust, i.typedStatus === 'partial' ? 'ready' : i.typedStatus, i.workoutsLast2Days == null || !Number.isFinite(i.workoutsLast2Days) ? 'error' : 'ready');
        return { lines, status: stalled, caveats, absence: absenceFor(i, trust) };
    }
    // With a score, the only question left is whether anything went unread. A
    // signal that is merely absent — no water goal, two nights instead of three —
    // is not a short read, and calling it one would train the member to ignore
    // the word on the many days it means nothing.
    const short = caveats.length > 0 || lines.some((l) => l.state === 'unread');
    return { lines, status: short ? 'partial' : 'ready', caveats, absence: null };
}
