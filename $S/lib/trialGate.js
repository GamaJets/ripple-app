"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRIAL_NOT_YET_ENFORCED = exports.TRIAL_DAYS = void 0;
exports.trialFrom = trialFrom;
exports.readTrial = readTrial;
exports.trialDisagreement = trialDisagreement;
exports.trialCard = trialCard;
const weekStart_1 = require("./weekStart");
/** The length of the free trial, in days. One copy, and it is a constant rather
 *  than a column — see the header. Kept equal to `TRIAL_DAYS` in trial.ts by
 *  the test, so the local banner and the account-wide figure cannot drift. */
exports.TRIAL_DAYS = 14;
/**
 * Where the trial stands, or null when the account could not say.
 *
 * `now` is passed in rather than read from a clock inside this function, so the
 * arithmetic is testable and so a caller cannot get a different answer from the
 * one that was rendered a line earlier.
 *
 * Days are counted from the START INSTANT rather than between calendar days,
 * which matters at both ends: a coach who signed up at 11pm has a full first
 * day, not an hour of one, and a trial does not gain or lose a day when the
 * clocks change. `Math.floor` on the elapsed days is what trial.ts already
 * does, so the two agree about the number they show.
 */
function trialFrom(startedAt, now) {
    const t = Date.parse(String(startedAt ?? ''));
    if (!Number.isFinite(t))
        return null;
    if (!Number.isFinite(now))
        return null;
    const elapsed = Math.floor((now - t) / 86400000);
    // A start date in the FUTURE is not a trial with more than the full length
    // left. It is a clock disagreement — the device's, the server's, or a row
    // written by hand — and the honest reading is the whole trial rather than
    // sixteen days of one. Clamped rather than refused, because a coach whose
    // phone is a day fast should not be shown an error about their account.
    const daysLeft = Math.max(0, Math.min(exports.TRIAL_DAYS, exports.TRIAL_DAYS - elapsed));
    return {
        // The coach's own day, not UTC's. `daysLeft` above is counted from the
        // start INSTANT and is unaffected either way, but `startedOn` is the date
        // this is shown as — "your trial started on the 3rd" — and a coach who
        // signed up at 5pm in Los Angeles was told the 4th. They then read a
        // countdown that had already spent a day they could not account for, on the
        // one screen whose whole job is to say honestly how much time is left
        // before they are asked for money.
        startedOn: (0, weekStart_1.isoDay)(new Date(t)),
        daysLeft,
        expired: daysLeft <= 0,
    };
}
function readTrial(startedAt, status, now) {
    if (status === 'loading') {
        return {
            state: null,
            source: 'loading',
            // Present tense and no apology. Nothing has failed; a request is out.
            note: 'Checking your account for when your trial started…',
        };
    }
    if (status !== 'ready') {
        return {
            state: null,
            source: 'unread',
            // Never "your trial has ended". A read that failed is not a trial that
            // ran out, and a paywall raised on a refused query is the worst version
            // of this app's worst defect wearing a billing hat.
            note: 'When your trial started could not be read, so nothing here says how long is left. This is not a statement that it has ended, and nothing has been withdrawn.',
        };
    }
    const state = trialFrom(startedAt, now);
    if (!state) {
        return {
            state: null,
            source: 'none',
            note: 'Your account has no trial start date on it. That is not an expired trial — it is a record with nothing in that field, and nothing is gated on it.',
        };
    }
    return {
        state,
        source: 'account',
        note: state.expired
            ? `Your free trial started on ${state.startedOn} and the ${exports.TRIAL_DAYS} days are up. It is recorded on your account rather than on this phone, so reinstalling the app does not start it again.`
            : `${state.daysLeft} of your ${exports.TRIAL_DAYS} free days ${state.daysLeft === 1 ? 'is' : 'are'} left, counted from ${state.startedOn}. It is recorded on your account rather than on this phone.`,
    };
}
/**
 * The sentence for a coach whose phone and account disagree.
 *
 * ── The branch that switched it off where it was needed ────────────────────
 *
 * This took a `TrialState | null` and opened with `if (!account) return null`.
 * Two unrelated things arrive at this function as a null account, and only one
 * of them is an unknown:
 *
 *   'unread'  the account did not answer. Nothing is established, so nothing
 *             can be said to disagree with anything. Silence is right.
 *   'none'    the account ANSWERED, and it has no start date on it. That is a
 *             fact, and it is in flat contradiction with a phone counting down
 *             from twelve. It is the exact case this function exists for.
 *
 * Folding them together meant the one mechanism built to reconcile the two
 * figures was switched off in the state where they diverge hardest — the phone
 * asserting a countdown and the account holding nothing to count from. It now
 * takes the whole `TrialReading`, so the two nulls cannot be confused by a
 * caller and there is no way to pass a bare null and be answered with silence.
 *
 * Null when they agree, while either is still loading, while the account is
 * unread, when the phone has no figure, or when the difference is under a day.
 */
function trialDisagreement(reading, localDaysLeft) {
    if (localDaysLeft == null || !Number.isFinite(localDaysLeft))
        return null;
    // Nothing established yet, or nothing established at all. Neither is a
    // disagreement — a disagreement needs two answers.
    if (reading.source === 'loading' || reading.source === 'unread')
        return null;
    if (reading.source === 'none') {
        // The account answered and holds nothing. Said even at zero days on the
        // phone, because the point is not the size of the gap: it is that the
        // number on this screen is about an INSTALLATION and the account has no
        // opinion at all.
        return `This phone is counting from the day the app was first opened on it and has ${localDaysLeft} ${localDaysLeft === 1 ? 'day' : 'days'} left by that reckoning. Your account holds no trial start date, so that figure is about this installation and not about your account, and nothing is decided on it.`;
    }
    const account = reading.state;
    if (!account)
        return null;
    if (Math.abs(localDaysLeft - account.daysLeft) < 1)
        return null;
    return `This phone has ${localDaysLeft} ${localDaysLeft === 1 ? 'day' : 'days'} recorded and your account has ${account.daysLeft}. Your account is the one that counts — the figure on a phone starts again whenever the app is reinstalled, which is why it is no longer what anything is decided on.`;
}
function trialCard(reading, billingOpen) {
    const s = reading.state;
    if (reading.source !== 'account' || !s)
        return null;
    return {
        title: s.expired
            ? 'Your free trial has ended'
            : `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left in your free trial`,
        // Neither half claims a consequence. `PLANS` features ("Up to 3 clients")
        // are checked nowhere, and no screen refuses anything on an expired trial,
        // so "upgrade to keep coaching" would be a false statement about what the
        // money buys — the sort a store reviewer opens the paid screen to check.
        note: billingOpen
            ? (s.expired ? 'Nothing has been switched off. Subscribe when you are ready.' : 'Subscribe any time — see what each plan includes.')
            : 'Subscriptions are not open yet — keep coaching, and we will be in touch before anything changes.',
        expired: s.expired,
    };
}
/**
 * That nothing is gated on this yet, said where a coach can read it.
 *
 * Honest about the current state rather than implying a lock that does not
 * exist. The day prices are configured this sentence changes, and until then a
 * coach reading "your trial has ended" beside a fully working app would
 * reasonably conclude the app was lying to them about one or the other.
 */
exports.TRIAL_NOT_YET_ENFORCED = 'Nothing is switched off when a trial ends today. This is a record of when yours started, kept on your account so it survives a reinstall, and it will be what the paid plans are counted from once they can be bought.';
