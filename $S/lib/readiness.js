"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readinessScore = readinessScore;
exports.readinessMadeOf = readinessMadeOf;
exports.readinessSleep = readinessSleep;
/**
 * The score, or **null when there is nothing to score from**.
 *
 * Sleep is half the scale. Without it there is no readiness, and the arithmetic
 * that treats its absence as zero produces a specific, wrong, and quite
 * alarming claim: a brand-new account scores 0 sleep + 0 hydration + 20 rest =
 * 20, which is 'Under-recovered', and the home screen tells somebody who has
 * logged nothing at all to take a rest day.
 *
 * That is what it did. The Readiness hero above the card already showed a dash
 * and said "Log a night of sleep to see your readiness" — but the card beside
 * it read the fabricated 20 and asserted a physiological state from it. Two
 * elements, one screen, opposite claims, and only one of them honest.
 *
 * Hydration is different: null there means "not tracked", so the remaining
 * signals are rescaled rather than being docked 30 points for a number nobody
 * asked the user for.
 *
 * ── Why an unknown training load withholds the score and an unknown hydration
 *    figure only shrinks the scale ────────────────────────────────────────────
 *
 * Both are missing inputs and they get opposite treatments, so the difference
 * has to be written down or somebody will make them consistent and reintroduce
 * a bug.
 *
 * Every signal here can only ever count AGAINST the member: sleep short of
 * eight hours, water short of the goal, sessions in the last two days. So
 * dropping any of them from the scale can only make the score go UP. That is
 * fine when it is honest and dangerous when it is not, and the two cases differ
 * in whether "missing" is a fact about the member or a fact about our read.
 *
 *   HYDRATION. `null` here is overwhelmingly "this person tracks no water" —
 *   they never set a goal, and part 70 forbids inventing one. That is a
 *   permanent, true state for a large share of members, and withholding their
 *   score forever because of it would delete the feature for them. Rescaling
 *   puts them on the same footing as everyone else on the signals they do have,
 *   which is exactly what this function already did and why. A hydration read
 *   that FAILED lands in the same null and is treated the same way: it joins a
 *   population that already exists rather than inventing a new claim, and it
 *   beats the alternative the callers used to pass — `water / goal` with water
 *   still at its initial 0, which scored a network blip as a day of drinking
 *   nothing and took thirty points off.
 *
 *   RECOVERY. Identical in shape to hydration and for a stronger reason: a
 *   member with no WHOOP and no Oura has no recovery score and never will, and
 *   they are most of the app. Withholding readiness from everybody without a
 *   strap would delete the feature for the majority in order to be strict about
 *   a minority's missing figure. A device that failed to sync joins the same
 *   null for the same reason hydration's failed read does — it joins a large
 *   population that already exists rather than inventing a new claim — and
 *   readinessBreakdown says in words which of the two happened, because the
 *   member's next action differs.
 *
 *   TRAINING LOAD. There is no equivalent. Every member has a training log, and
 *   `workoutsLast2Days` is never legitimately absent — a null there means one
 *   thing only: the read failed. Dropping it from the scale would raise the
 *   number of anybody who HAS trained hard for the last two days, and the tip
 *   attached to a raised number is "Great day to push". That is a green light
 *   computed from an absence, handed to the exact person it is most wrong for.
 *   So the score is withheld and the screen says it does not know, which is
 *   what app/(client)/coach.tsx had already worked out and was doing by hand.
 */
function readinessScore(i) {
    if (i.avgSleepHours == null || !(i.avgSleepHours > 0))
        return null;
    // See the header. An unread log is not a rested member.
    if (i.workoutsLast2Days == null || !Number.isFinite(i.workoutsLast2Days))
        return null;
    const sleep = Math.max(0, Math.min(1, i.avgSleepHours / 8)) * 50; // up to 50
    const rest = Math.max(0, 20 - Math.max(0, i.workoutsLast2Days - 1) * 10); // 0–1 sessions = 20, 2 = 10, 3+ = 0
    // Untracked hydration is not dehydration. Score the signals we have and
    // rescale to 100, rather than capping everyone who ignores the water tracker
    // at 70 and calling them under-recovered for it.
    const pct = i.hydrationPct;
    const tracked = pct != null && Number.isFinite(pct);
    const hydration = tracked ? Math.max(0, Math.min(1, pct)) * 30 : 0;
    // The device's verdict, worth 40 — more than hydration and less than sleep.
    //
    // The weight is a judgement and it is written down so it can be argued with:
    // WHOOP and Oura each compute their score from a night of HRV, resting heart
    // rate and sleep against that member's own baseline, which is more physiology
    // than anything else on this scale, and less than sleep only because sleep is
    // the one signal every member can supply. Nothing here re-derives it — a
    // vendor score is taken at face value or not at all.
    const rec = i.recoveryPct;
    const scored = rec != null && Number.isFinite(rec);
    const recovery = scored ? Math.max(0, Math.min(1, rec / 100)) * 40 : 0;
    const raw = sleep + rest + hydration + recovery;
    // Built up from the signals that were actually in the scale rather than
    // written as a literal, so adding a fifth signal cannot leave a stale
    // denominator behind — a mismatch here does not throw, it silently shifts
    // everybody's number.
    const outOf = 70 + (tracked ? 30 : 0) + (scored ? 40 : 0);
    const score = Math.round((raw / outOf) * 100);
    let tone, label, tip;
    if (score >= 75) {
        tone = 'good';
        label = 'Well Recovered';
        tip = 'Great day to push — aim for a PR or add a little load.';
    }
    else if (score >= 50) {
        tone = 'moderate';
        label = 'Moderately Recovered';
        tip = 'Train as planned, but listen to your body and don’t force it.';
    }
    else {
        tone = 'low';
        label = 'Under-recovered';
        tip = 'Prioritise sleep, water and a lighter session or rest today.';
    }
    const from = [
        'sleep',
        ...(scored ? ['recovery'] : []),
        ...(tracked ? ['hydration'] : []),
        'load',
    ];
    // 'full' means every signal in the scale was scored, which now takes a device
    // as well as a water goal — so it is rarer than it was, and that is the field
    // reporting the truth rather than the bar moving. Nothing in the app hides
    // behind it: `readinessMadeOf` is printed under the score on every screen and
    // on every day, precisely so that a member never has to infer completeness
    // from a word they cannot see.
    return { score, label, tip, tone, from, confidence: from.length === 4 ? 'full' : 'partial' };
}
/**
 * What the score is made of, as a sentence to print under it.
 *
 * Sentence case and no trailing full stop, because every caller appends it to a
 * tip that already ends in one. It never names what is MISSING: "no hydration
 * figure" invites the member to read the score as having been marked down for
 * it, and nothing was marked down — the signal simply is not in the scale.
 */
function readinessMadeOf(r) {
    const words = {
        sleep: 'your sleep',
        // "your device's recovery score" rather than "recovery": the member has to
        // be able to tell this apart from the app's own opinion, which is the whole
        // number it sits inside.
        recovery: 'your device’s recovery score',
        hydration: 'hydration',
        load: 'recent sessions',
    };
    const parts = r.from.map((s) => words[s]);
    const list = parts.length > 1
        ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
        : parts[0];
    return `Scored from ${list}`;
}
/**
 * The nights readiness may score, newest first, at most `count` of them.
 *
 * `deviceNights` are merged nights from src/lib/sleepMerge — only `measured`
 * ones carry a figure. `typed` are wellness-log entries, dated by the local day
 * they were logged for.
 */
function readinessSleep(deviceNights, typed, count = 3) {
    const byNight = new Map();
    for (const d of deviceNights) {
        if (d.outcome !== 'measured')
            continue;
        const m = d.minutesAsleep;
        if (m == null || !Number.isFinite(m) || m <= 0)
            continue;
        if (!byNight.has(d.night))
            byNight.set(d.night, { night: d.night, hours: m / 60, from: 'device' });
    }
    for (const e of typed) {
        const h = Number(e.hours);
        if (!Number.isFinite(h) || h <= 0)
            continue;
        // The wellness log stores an instant; the night it belongs to is the local
        // day of that instant. Slicing the ISO string would take the UTC day and
        // file a 9pm entry under tomorrow for anybody west of Greenwich.
        const night = localDay(e.at);
        if (!night)
            continue;
        // Only where no device measured it. A device figure already present is not
        // replaced — see the header.
        if (!byNight.has(night))
            byNight.set(night, { night, hours: h, from: 'typed' });
    }
    const nights = [...byNight.values()]
        .sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0))
        .slice(0, Math.max(0, count));
    if (!nights.length)
        return { avgHours: null, nights: [], fromDevice: 0, fromTyped: 0 };
    return {
        avgHours: nights.reduce((a, n) => a + n.hours, 0) / nights.length,
        nights,
        fromDevice: nights.filter((n) => n.from === 'device').length,
        fromTyped: nights.filter((n) => n.from === 'typed').length,
    };
}
/** The local calendar day of an instant, as YYYY-MM-DD, or null if unreadable. */
function localDay(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
