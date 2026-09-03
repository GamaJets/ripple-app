"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressionOffer = progressionOffer;
exports.loadTapLabel = loadTapLabel;
exports.alreadyAt = alreadyAt;
const progression_1 = require("./progression");
function progressionOffer(i) {
    if (!i.clientPicked)
        return { kind: 'silent' };
    if (i.status === 'loading')
        return { kind: 'gap', note: 'Reading what they have lifted…' };
    if (i.status === 'error') {
        // The sentence this branch exists to refuse is "they have never logged
        // this". A coach who believes that writes a beginner's load for somebody
        // who has been pressing 80 for a year.
        return {
            kind: 'gap',
            note: 'Their training could not be read, so there is nothing here to base a load on. That is a read that failed rather than a client with no history — reopen the screen once you have signal.',
        };
    }
    // No read was issued at all — a hand-added client with no account, or a build
    // with no backend. Not a gap to explain on every exercise row of the week.
    if (i.log == null)
        return { kind: 'silent' };
    const s = (0, progression_1.suggestForExercise)(i.log, i.exercise, i.reps, 2.5, i.unit);
    if (s)
        return { kind: 'suggestion', weightKg: s.weight, reason: s.reason, up: s.up };
    // ── logged, with nothing on the bar ───────────────────────────────────
    //
    // `suggestNextWeight` returns null in exactly two situations: the movement
    // has no logged sets at all, and its last session's heaviest set carried no
    // load. The second is every bodyweight movement in the catalogue — press-ups,
    // pull-ups, dips, a plank — and both fell through to the sentence at the
    // bottom of this function, which told the coach the client had not logged the
    // movement. They had. A coach writing next week's programme was reading an
    // accusation of absence about somebody who did the work on Tuesday.
    //
    // ── and it came to disagree anyway ───────────────────────────────────────
    //
    // This used to read `lastSetsFor`, on the stated grounds that it is the same
    // reader `suggestNextWeight` is given its sets by, "so the two cannot come to
    // disagree about whether anything was logged". That stopped being true when
    // `lastSetsFor` gained a `liftedSets` filter so a session of planks would not
    // recommend a heavier plank — a correct change, which made it return
    // undefined for exactly the sessions THIS branch exists to recognise.
    //
    // The result was the original defect, restored: a client who did press-ups on
    // Tuesday was reported to their coach as never having logged the movement.
    //
    // So the question is asked directly, and it is a different question from the
    // one `suggestNextWeight` asks. That one wants sets it can read a LOAD from;
    // this one wants to know whether the person did the movement at all. Sharing
    // a reader between two different questions is what broke it.
    const loggedAtAll = i.log.some((e) => e.exercise === i.exercise && Array.isArray(e.sets) && e.sets.length > 0);
    if (loggedAtAll) {
        return {
            kind: 'gap',
            note: 'They have logged this movement with no weight on it, so there is no load of theirs to build from. That is bodyweight work they did, not a movement they have never done.',
        };
    }
    if (i.status === 'partial') {
        // THE distinction. The cap drops the oldest sessions, so a movement whose
        // last outing is older than what came back is silent here — and reporting
        // that silence as "they have never done this" is a claim about a person
        // made from a prefix of their record.
        return {
            kind: 'gap',
            note: 'Nothing logged for this movement in the sessions that came back. Their history was longer than one read returns, so this is not a statement that they have never done it.',
        };
    }
    return {
        kind: 'gap',
        note: 'They have not logged this movement, so there is no weight of their own to build from.',
    };
}
/**
 * The tap's own label — what pressing it will put in the box.
 *
 * Takes the already-rendered load rather than formatting one, because
 * `liftLabel` is the caller's and a second formatter here is a second rounding.
 * Null when the load could not be rendered, which is the caller's cue to offer
 * no tap at all: a button reading "Use —" is worse than no button.
 *
 * Deliberately NOT called `useLoadLabel`. It is a plain function called from
 * inside a render callback, and a `use` prefix on something that is not a hook
 * is how somebody later moves it, or the linter's rules-of-hooks check fires on
 * a call site that is perfectly correct.
 */
function loadTapLabel(rendered) {
    return rendered ? `Use ${rendered}` : null;
}
/** True when the suggestion is already what is in the box, in kilograms.
 *  Compared at one decimal place, which is the resolution the increment ladder
 *  works in (2.5 kg steps, rounded to the nearest half). Offering "Use 62.5"
 *  beside a box already reading 62.5 is a control that does nothing, and a
 *  coach who presses it once learns to distrust the row. */
function alreadyAt(suggestedKg, currentKg) {
    if (currentKg == null || !Number.isFinite(currentKg))
        return false;
    return Math.round(suggestedKg * 10) === Math.round(currentKg * 10);
}
