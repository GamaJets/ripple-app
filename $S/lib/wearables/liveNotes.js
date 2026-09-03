"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsMetric = reportsMetric;
exports.providersFor = providersFor;
exports.namesOf = namesOf;
exports.awaitingNote = awaitingNote;
exports.liveFootnote = liveFootnote;
exports.permissionsNote = permissionsNote;
/**
 * The metric labels, lowercased, that count as this metric.
 *
 * Matched as a substring against `meta.metrics` because those are human labels
 * written per device and they differ: Apple says 'Active calories', WHOOP says
 * 'Calories', Apple also says 'Resting HR' where everything else says
 * 'Heart rate'. A registry that starts saying 'Heart Rate' or 'Daily steps'
 * still matches.
 */
const WANTS = {
    heartRate: ['heart rate', 'resting hr'],
    steps: ['steps'],
    energy: ['calories', 'energy'],
};
/** What the metric is called inside a sentence. Lower case: it is prose. */
const NOUN = {
    heartRate: 'heart rate',
    steps: 'steps',
    energy: 'energy',
};
/** Whether this provider, as the catalogue describes it, reports this metric. */
function reportsMetric(meta, metric) {
    const want = WANTS[metric];
    return meta.metrics.some((m) => {
        const s = m.trim().toLowerCase();
        return want.some((w) => s.includes(w));
    });
}
/** The connected providers that report this metric, in the order given. */
function providersFor(connected, metric) {
    return connected.filter((m) => reportsMetric(m, metric));
}
/**
 * Device names as one phrase.
 *
 * No locale tag and no `Intl.ListFormat`: this is English UI copy sitting
 * inside English UI copy, and a list joined in one language inside a sentence
 * written in another is worse than either.
 */
function namesOf(list) {
    const names = list.map((m) => m.name);
    if (names.length === 0)
        return '';
    if (names.length === 1)
        return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
/**
 * The note under a Live Today row whose figure has not arrived.
 *
 * Three different situations, and the old copy collapsed them into one
 * instruction about a device the member may not own:
 *
 *   · Nothing connected. The panel is gated on something being connected, so
 *     this is only reachable if that gate ever changes, and it says the plain
 *     thing rather than naming a brand.
 *   · Connected, but nothing that reports this. A WHOOP member has no step
 *     count and never will, and telling them to wear it harder is a lie about
 *     their own device. Naming the device and the gap is the answer.
 *   · Connected and it does report this, just not yet today. Then the only
 *     honest thing is that it has not come in yet, named to the device that
 *     owes it.
 */
function awaitingNote(metric, connected) {
    if (connected.length === 0)
        return `Nothing is connected yet, so no ${NOUN[metric]} is coming in.`;
    const can = providersFor(connected, metric);
    if (can.length === 0) {
        return `${namesOf(connected)} ${connected.length === 1 ? 'does' : 'do'} not report ${NOUN[metric]}.`;
    }
    return `Nothing from ${namesOf(can)} yet today.`;
}
/**
 * The footnote under the panel.
 *
 * The sentence it replaces named an iPhone and an Apple Watch unconditionally.
 * This one names whatever is actually feeding the panel, and promises only what
 * is true of all of them: it arrives on its own, and a figure appears once the
 * device has reported one.
 */
function liveFootnote(connected) {
    if (connected.length === 0)
        return 'Nothing is connected yet, so this panel has nothing to show.';
    return `Updates on its own from ${namesOf(connected)}. Each figure appears once a device has reported it today.`;
}
/**
 * Where the member changes what this app is allowed to read.
 *
 * "Apple Health ▸ Sharing" is the right answer on iOS and no answer at all on
 * Android, where the same setting lives in Health Connect. A cloud account is a
 * third place again: nothing on the phone governs what WHOOP hands over, the
 * vendor's own account does.
 *
 * Null when nothing is connected, so a caller can render it unconditionally
 * without drawing an instruction about a permission nobody has granted.
 */
function permissionsNote(connected, brand) {
    if (connected.length === 0)
        return null;
    if (connected.some((m) => m.kind === 'healthkit')) {
        return `Manage what ${brand} can read in Apple Health ▸ Sharing ▸ ${brand}.`;
    }
    if (connected.some((m) => m.kind === 'health-connect')) {
        return `Manage what ${brand} can read in Health Connect ▸ App permissions ▸ ${brand}.`;
    }
    return `Manage what ${brand} can read in your ${namesOf(connected)} account settings.`;
}
