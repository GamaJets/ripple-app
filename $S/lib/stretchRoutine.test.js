"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for stretchRoutine — the routines, their timings, and the decision not
// to make Stretch a sixth workout kind.
//
// Five things can be wrong here and not one of them looks wrong on a
// screenshot:
//
//   · a unilateral stretch expanded to ONE stage. Half the routine, done on
//     one leg, rendering perfectly. Nothing on screen contradicts it, and the
//     member finds out days later that one hip is looser than the other.
//   · a total that counts each sided stretch once. Every routine on the list
//     then under-states itself, and the shortest one is under-stated most.
//   · the estimate written to the log instead of the measured clock, which
//     puts minutes in somebody's training history they did not spend.
//   · a static stretch labelled "Keep moving", or a flow labelled "Hold" —
//     the second one instructs somebody to freeze in the middle of Cat-Cow.
//   · "Stretching" quietly leaving MOBILITY_ACTIVITIES, which would re-colour
//     every mobility session ever logged. That is asserted here, in the file
//     whose feature would have caused it, rather than left to the reader of a
//     comment.
//
// Compile with tsc then run with node, like restTimer.test.ts.
const stretchRoutine_1 = require("./stretchRoutine");
const workoutKind_1 = require("./workoutKind");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** A routine built for one assertion, so an edge case does not depend on the
 *  shipped data staying exactly as it is today. */
const mk = (steps, id = 'fixture') => ({ id, title: 'Fixture', note: 'a routine that exists only in this test.', steps });
const st = (id, holdSec, sides, flow = false) => ({ id, name: id, holdSec, sides, flow });
/* ── THE KIND DECISION, WHICH IS THE LOAD-BEARING CLAIM ──────────────────── */
//
// Stretch is a MODE in Train's picker and not a WorkoutKind, so that a session
// logged before this feature existed reads the same afterwards. If either of
// these two lines ever fails, somebody has moved "Stretching" out of Mobility
// and every mobility dot on every past calendar has changed colour.
eq(workoutKind_1.WORKOUT_KINDS.length, 5, 'THERE ARE STILL FIVE KINDS — adding a sixth means re-deriving the kind of every session already logged, because there is no kind column and the name is all there is');
ok(!workoutKind_1.WORKOUT_KINDS.includes('stretch'), 'and "stretch" is not one of them: it is what you are about to do, not what a past session was');
ok(workoutKind_1.MOBILITY_ACTIVITIES.some((a) => a.name === 'Stretching'), 'STRETCHING IS STILL A MOBILITY ACTIVITY — the routines below log through it, and moving it would re-read every session that used it');
eq((0, workoutKind_1.workoutKind)({ exercise: 'Stretching', cardio: { mins: 8 } }), 'mobility', 'so a stretch routine, which commits as a Stretching session, comes back out of the classifier as mobility exactly as the Mobility chip always has');
eq((0, workoutKind_1.workoutKind)({ exercise: 'Yoga', cardio: { mins: 30 } }), 'mobility', 'and the rest of Mobility is untouched by this feature');
/* ── the routines themselves ─────────────────────────────────────────────── */
eq((0, stretchRoutine_1.routineProblems)().join('\n'), '', 'THE SHIPPED ROUTINES HOLD EVERY INVARIANT — unique ids, no repeated stretch inside one routine, every hold a whole number of seconds inside the bounds');
ok(stretchRoutine_1.STRETCH_ROUTINES.length >= 6, 'there is a starter set worth opening the screen for, not one example routine');
// Title Case, asserted here because scripts/check-caps.mjs reads literal JSX
// attributes and cannot see a <ListRow title> that arrives from an array.
const MINOR = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'for', 'and', 'or', 'with', 'per', 'at', 'by', 'from', 'as']);
for (const r of stretchRoutine_1.STRETCH_ROUTINES) {
    const words = r.title.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
    words.forEach((w, i) => {
        if (i > 0 && MINOR.has(w.toLowerCase()))
            return;
        ok(/^[A-Z]/.test(w), `"${r.title}" is drawn as a ListRow title and must be Title Case — "${w}" is not`);
    });
    ok(/^[A-Z]/.test(r.note) && /[.!]$/.test(r.note.trim()), `"${r.id}" note is prose under a title: sentence case, ending in a full stop — got "${r.note}"`);
}
// Every id must be a slug of its own name, because that is how the catalogue is
// keyed and how the runner will find the row. RepDB's own id is NOT that key —
// it calls Child's Pose 'childs-pose' and our row is 'child-s-pose'. A step
// keyed the RepDB way renders a name with no picture, which reads as media we
// are missing rather than as a key we typed wrong.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');
for (const r of stretchRoutine_1.STRETCH_ROUTINES) {
    for (const s of r.steps) {
        eq(s.id, slug(s.name), `${r.id}: "${s.name}" must be keyed by the slug of its own name — that is what exerciseSlug() will look up`);
    }
}
// The twelve stretches that are marked as flows are exactly the twelve RepDB
// rows whose force_type is 'dynamic', which are exactly the twelve that ship an
// animation. Named in full rather than counted, so marking a static hold as a
// flow to "get it an animation" fails here instead of putting "Keep moving"
// over a position somebody is supposed to sit still in.
const ANIMATED = new Set([
    'cat-cow', 'downward-dog-pedal', 'downward-dog-to-low-lunge',
    'half-kneeling-hip-flexor-rock', 'low-lunge-to-half-split', 'pilates-roll-down',
    'pilates-saw', 'pilates-spine-stretch-forward', 'pilates-spine-twist',
    'standing-forward-fold-to-half-lift', 'standing-side-bend-flow', 'thread-the-needle-flow',
]);
for (const r of stretchRoutine_1.STRETCH_ROUTINES) {
    for (const s of r.steps) {
        if (s.flow)
            ok(ANIMATED.has(s.id), `${r.id}: "${s.name}" is marked a flow, and only the twelve dynamic rows are flows`);
        else
            ok(!ANIMATED.has(s.id), `${r.id}: "${s.name}" IS one of the twelve moving sequences and must not be labelled a hold`);
    }
}
// WHICH STRETCHES ARE DONE ON BOTH SIDES, named in full.
//
// This list exists because scripts/mutate.mjs found it missing: eleven separate
// mutations flipped a shipped `sides: 2` to `sides: 1` and the whole suite
// stayed green. That is the exact defect named at the top of this file — half a
// routine, done on one leg, rendering perfectly — and the fixture-based
// expansion tests below could not see it, because they test the machinery and
// not the data it is fed.
//
// Every id here carries `is_unilateral: true` in the RepDB pack; every stretch
// used by a routine and absent from it carries false.
const UNILATERAL = new Set([
    'cross-body-shoulder-stretch', 'downward-dog-to-low-lunge',
    'half-kneeling-hip-flexor-rock', 'knee-to-chest-stretch',
    'kneeling-hip-flexor-stretch', 'low-lunge', 'low-lunge-to-half-split',
    'neck-side-stretch', 'overhead-triceps-stretch', 'pigeon-stretch',
    'seated-spinal-twist', 'standing-calf-stretch', 'standing-quad-stretch',
    'supine-spinal-twist', 'thread-the-needle-flow',
]);
for (const r of stretchRoutine_1.STRETCH_ROUTINES) {
    for (const s of r.steps) {
        if (UNILATERAL.has(s.id)) {
            eq(s.sides, 2, `${r.id}: "${s.name}" IS DONE ON EACH SIDE — as one stage it stretches one leg and the routine reads as finished`);
        }
        else {
            eq(s.sides, 1, `${r.id}: "${s.name}" is not a sided stretch, and running it twice doubles the routine for nothing`);
        }
    }
}
ok(stretchRoutine_1.STRETCH_ROUTINES.some((r) => r.steps.some((s) => s.sides === 2)), 'and at least one routine actually contains a sided stretch, so the expansion is exercised by the shipped data and not only by fixtures');
const full = (0, stretchRoutine_1.routineById)('full-body');
ok(!!full && full.steps.every((s) => s.flow), 'FULL BODY FLOW IS ENTIRELY FLOWS — its note promises every one of them is demonstrated as an animation, and that promise is data, not copy');
/* ── looking a routine up ────────────────────────────────────────────────── */
eq((0, stretchRoutine_1.routineById)('back')?.id, 'back', 'a known id opens its routine');
eq((0, stretchRoutine_1.routineById)(' back '), (0, stretchRoutine_1.routineById)('back'), 'a route parameter that arrived with whitespace still resolves');
eq((0, stretchRoutine_1.routineById)('nope'), null, 'AN UNKNOWN ID IS NULL, NOT THE FIRST ROUTINE — the id comes off a URL and a renamed routine must say so rather than silently open something else');
eq((0, stretchRoutine_1.routineById)(''), null, 'an empty parameter is not a routine');
eq((0, stretchRoutine_1.routineById)(null), null, 'nor is a missing one');
eq((0, stretchRoutine_1.routineById)(undefined), null, 'nor an undefined one');
/* ── stages: the expansion that decides whether both legs get stretched ──── */
const sided = mk([st('a', 30, 2), st('b', 40, 1), st('c', 20, 2)]);
const stages = (0, stretchRoutine_1.routineStages)(sided);
eq(stages.length, 5, 'THREE STRETCHES, TWO OF THEM SIDED, IS FIVE STAGES — not three, which would stretch one leg and move on');
eq(stages.map((s) => s.side).join(','), 'left,right,both,left,right', 'left before right, every time, and an unsided stretch is one stage marked "both"');
eq(stages.map((s) => s.step.id).join(','), 'a,a,b,c,c', 'the sides of one stretch are adjacent, not interleaved with the next');
eq(stages.map((s) => s.stepIndex).join(','), '0,0,1,2,2', 'both sides of a stretch report the same stretch number');
eq(stages[0].seconds, 30, 'A SIDED STRETCH IS HELD AS LONG ON EACH SIDE — halving it to keep the total down is a different, shorter stretch');
eq(stages[1].seconds, 30, 'and the second side is held exactly as long as the first');
eq((0, stretchRoutine_1.routineStages)(null).length, 0, 'no routine is no stages, rather than a throw');
eq((0, stretchRoutine_1.routineStages)(mk([])).length, 0, 'and an empty routine expands to nothing');
/* ── how long it takes ───────────────────────────────────────────────────── */
eq((0, stretchRoutine_1.routineHoldSec)(sided), 30 + 30 + 40 + 20 + 20, 'the holds add up with both sides counted');
eq((0, stretchRoutine_1.routineTotalSec)(sided), 140 + 4 * stretchRoutine_1.TRANSITION_SEC, 'FOUR TRANSITIONS FOR FIVE STAGES — there is no move into the first position and none out of the last');
eq(stretchRoutine_1.TRANSITION_SEC, 10, 'the allowance is ten seconds a change, stated as a number so a change to it has to be deliberate');
eq((0, stretchRoutine_1.routineTotalSec)(mk([st('a', 30, 1)])), 30, 'one stage has no transitions at all');
eq((0, stretchRoutine_1.routineTotalSec)(null), 0, 'and no routine takes no time, rather than throwing');
eq((0, stretchRoutine_1.routineHoldSec)(null), 0, 'the same for the holds');
// ceil, not round. 380 seconds is 6 minutes 20; rounding gives 6 and the last
// stretch falls off the end of the time somebody set aside.
eq((0, stretchRoutine_1.routineMinutes)(mk([st('a', 190, 2)])), 7, 'ROUNDED UP — 6:30 of stretching is seven minutes of somebody’s evening, and a routine that finishes early costs nobody anything');
eq((0, stretchRoutine_1.routineMinutes)(mk([st('a', 185, 2)])), 7, 'a routine of 6:20 is still seven, because rounding it to six loses the last stretch');
eq((0, stretchRoutine_1.routineMinutes)(mk([st('a', 60, 1)])), 1, 'exactly a minute is a minute, not two');
eq((0, stretchRoutine_1.routineMinutes)(null), 0, 'and nothing is nought minutes');
// The shipped figures, spelled out. Every other timing line here is computed
// from the same functions being tested, so all of them stay green if the
// arithmetic changes uniformly. These are the numbers a member reads.
eq((0, stretchRoutine_1.routineMinutes)((0, stretchRoutine_1.routineById)('lower-body')), 7, 'Lower Body Unwind is a seven-minute routine');
eq((0, stretchRoutine_1.routineMinutes)((0, stretchRoutine_1.routineById)('cool-down')), 6, 'and the cool-down is the shortest one on the list, as its note claims');
ok(stretchRoutine_1.STRETCH_ROUTINES.every((r) => (0, stretchRoutine_1.routineMinutes)(r) >= 5 && (0, stretchRoutine_1.routineMinutes)(r) <= 12), 'no routine is so short it is not worth opening, or so long that nobody finishes it');
eq((0, stretchRoutine_1.routineSummary)((0, stretchRoutine_1.routineById)('back')), '6 stretches · about 7 min', 'the row says how many and roughly how long');
eq((0, stretchRoutine_1.routineSummary)(mk([st('a', 30, 1)])), '1 stretch · about 1 min', 'ONE STRETCH IS SINGULAR — "1 stretches" is the kind of thing that makes a screen look unfinished');
eq((0, stretchRoutine_1.routineSummary)(null), '', 'and nothing summarises to nothing');
eq((0, stretchRoutine_1.routineSummary)(mk([])), '', 'as does an empty routine');
ok((0, stretchRoutine_1.routineSummary)((0, stretchRoutine_1.routineById)('back')).includes('about'), '"about" is load-bearing: the figure is an estimate built on a fixed transition allowance, and stating it flat would make it a promise');
/* ── what gets written to the log ────────────────────────────────────────── */
eq((0, stretchRoutine_1.loggableMinutes)(0), 0, 'a routine nobody started writes nothing');
eq((0, stretchRoutine_1.loggableMinutes)(29), 0, 'UNDER THIRTY SECONDS ROUNDS TO NOTHING — and the caller must not save it, because commitSession refuses a zero-minute session');
eq((0, stretchRoutine_1.loggableMinutes)(30), 1, 'thirty seconds is the first minute');
eq((0, stretchRoutine_1.loggableMinutes)(90), 2, 'ninety seconds rounds up to two, the way the runner’s finish screen has always rounded');
eq((0, stretchRoutine_1.loggableMinutes)(420), 7, 'seven minutes on the clock is seven minutes in the log');
eq((0, stretchRoutine_1.loggableMinutes)(-5), 0, 'a negative elapsed is damage, not a session');
eq((0, stretchRoutine_1.loggableMinutes)(Number.NaN), 0, 'NaN out of a clock that never started must not reach the log');
eq((0, stretchRoutine_1.loggableMinutes)(Number.POSITIVE_INFINITY), 0, 'nor Infinity, which would write a session lasting forever');
ok((0, stretchRoutine_1.loggableMinutes)((0, stretchRoutine_1.routineTotalSec)((0, stretchRoutine_1.routineById)('back')) + 200) !== (0, stretchRoutine_1.routineMinutes)((0, stretchRoutine_1.routineById)('back')), 'THE LOG TAKES THE MEASURED CLOCK, NOT THE ESTIMATE — somebody who took three minutes longer has three minutes longer in their history');
/* ── moving through a routine ────────────────────────────────────────────── */
eq((0, stretchRoutine_1.isLastStage)(stages, 4), true, 'the fifth of five stages is the last one');
eq((0, stretchRoutine_1.isLastStage)((0, stretchRoutine_1.routineStages)(mk([st('a', 30, 1)])), 0), true, 'A ONE-STAGE ROUTINE IS ON ITS LAST STAGE FROM THE START — otherwise its only button reads "Next Stretch" and there is no next stretch');
eq((0, stretchRoutine_1.isLastStage)([], -1), false, 'AND AN EMPTY ROUTINE IS NEVER ON ITS LAST STAGE, not even from the index a runner sits at before it begins — "length - 1" is -1 there, and matching it would send the runner straight to its finish screen');
eq((0, stretchRoutine_1.isLastStage)(stages, 3), false, 'the fourth is not — labelling it "Finish" would end the routine a stretch early');
eq((0, stretchRoutine_1.isLastStage)(stages, 0), false, 'nor is the first');
eq((0, stretchRoutine_1.isLastStage)([], 0), false, 'AN EMPTY ROUTINE HAS NO LAST STAGE — answering true would finish a routine that never began');
eq((0, stretchRoutine_1.nextStageIndex)(stages, 0), 1, 'the next stage follows the one before it');
eq((0, stretchRoutine_1.nextStageIndex)(stages, 3), 4, 'right up to the last');
eq((0, stretchRoutine_1.nextStageIndex)(stages, 4), null, 'AND THE LAST STAGE HAS NO NEXT — returning 5 would render stages[5].step.name, which is a crash');
eq((0, stretchRoutine_1.nextStageIndex)([], 0), null, 'an empty routine has nowhere to go');
eq((0, stretchRoutine_1.nextStageIndex)(stages, -1), 0, 'a runner that has not started yet begins at the first stage');
eq((0, stretchRoutine_1.nextStageIndex)([], -1), null, 'unless there is not one');
eq((0, stretchRoutine_1.stageProgress)(stages, 0, sided), 'Stretch 1 of 3', 'progress is counted in STRETCHES, not stages');
eq((0, stretchRoutine_1.stageProgress)(stages, 1, sided), 'Stretch 1 of 3', 'SO THE SECOND SIDE OF A STRETCH IS STILL THE SAME STRETCH — "2 of 3" here would tell somebody they were further along than they are');
eq((0, stretchRoutine_1.stageProgress)(stages, 4, sided), 'Stretch 3 of 3', 'and the last stage is the last stretch');
eq((0, stretchRoutine_1.stageProgress)(stages, 9, sided), '', 'an index past the end says nothing rather than throwing');
eq((0, stretchRoutine_1.stageProgress)(stages, 0, null), '', 'and with no routine there is no count to give');
/* ── what the screen says about a stage ──────────────────────────────────── */
eq((0, stretchRoutine_1.sideLabel)('left'), 'Left side', 'a sided stage says which side');
eq((0, stretchRoutine_1.sideLabel)('right'), 'Right side', 'and so does the other one');
eq((0, stretchRoutine_1.sideLabel)('both'), null, 'AN UNSIDED STRETCH SAYS NOTHING — null and not an empty string, so the screen renders no line at all rather than a blank one holding space');
eq((0, stretchRoutine_1.stageVerb)(st('cat-cow', 40, 1, true)), 'Keep moving', 'A FLOW IS NOT HELD — telling somebody to hold Cat-Cow is telling them to freeze in the middle of the one thing it is');
eq((0, stretchRoutine_1.stageVerb)(st('child-s-pose', 40, 1)), 'Hold', 'and a static stretch is held, which is the complete and correct way to do it');
ok((0, stretchRoutine_1.stageVerb)(st('a', 30, 1, true)) !== (0, stretchRoutine_1.stageVerb)(st('a', 30, 1)), 'the two are genuinely different words, not one string with a flag nobody reads');
/* ── the invariant checker itself has to be able to fail ─────────────────── */
const problem = (rs) => (0, stretchRoutine_1.routineProblems)(rs).join(' | ');
ok(problem([mk([st('a', 30, 1)], 'x'), mk([st('b', 30, 1)], 'x')]).includes('share the id'), 'two routines with one id is caught — routineById would only ever open the first');
ok(problem([mk([st('a', 30, 1), st('a', 40, 1)])]).includes('twice'), 'the same stretch twice in one routine is caught');
// The bounds asserted as NUMBERS, not only against themselves. Every line
// below compares to the constants, so all of them stay green if MIN_HOLD_SEC is
// lowered to 0 — which is a hold that ends the instant it opens, for every
// stretch in every routine, and is the same trap restTimer.test.ts documents
// about its own fallback. scripts/mutate.mjs made exactly that change twice and
// nothing here noticed.
eq(stretchRoutine_1.MIN_HOLD_SEC, 15, 'the floor is fifteen seconds — under that the tissue has not begun to lengthen and the countdown is over before anybody has settled');
eq(stretchRoutine_1.MAX_HOLD_SEC, 120, 'and the ceiling is two minutes, which is a limit on typing accidents rather than on training');
ok(problem([mk([st('a', 5, 1)])]).includes('floor'), 'A FIVE-SECOND HOLD IS REFUSED BY NUMBER — it reads as a broken timer, and stating the case in seconds is what stops the floor being quietly moved under it');
ok(problem([mk([st('a', 300, 1)])]).includes('ceiling'), 'and a five-minute one, which is how "30" becomes "300"');
ok(problem([mk([st('a', stretchRoutine_1.MIN_HOLD_SEC - 1, 1)])]).includes('floor'), 'a hold one second under the floor is caught, so the boundary is the boundary');
ok(problem([mk([st('a', stretchRoutine_1.MAX_HOLD_SEC + 1, 1)])]).includes('ceiling'), 'and one second over the ceiling');
eq(problem([mk([st('a', stretchRoutine_1.MIN_HOLD_SEC, 1)])]), '', 'A HOLD EXACTLY ON THE FLOOR IS ALLOWED — the bound is inclusive, and an off-by-one here rejects a routine that is fine');
eq(problem([mk([st('a', stretchRoutine_1.MAX_HOLD_SEC, 1)])]), '', 'and one exactly on the ceiling, for the same reason');
ok(problem([mk([st('a', 30.5, 1)])]).includes('whole second'), 'a fractional hold is caught, because the countdown shows whole seconds');
ok(problem([mk([st('Childs Pose', 30, 1)])]).includes('catalogue slug'), 'AN ID THAT IS NOT A SLUG IS CAUGHT — no exercises row would resolve for it and the stretch would render with no picture');
ok(problem([mk([])]).includes('no stretches'), 'an empty routine is caught');
ok(problem([{ ...mk([st('a', 30, 1)]), note: '' }]).includes('no note'), 'a routine with no note is caught');
ok(problem([{ ...mk([st('a', 30, 1)]), title: ' ' }]).includes('no title'), 'and one with no title');
eq((0, stretchRoutine_1.routineProblems)([]).length, 0, 'and nothing to check is no problems, rather than a complaint about there being nothing');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('stretchRoutine tests passed');
