// Tests for stretchBuilder — the routine that gets assembled to fit the time
// somebody says they have.
//
// A builder fails differently from a screen. Nothing here throws and nothing
// renders wrong; it hands back a routine that looks completely ordinary and is
// quietly the wrong shape. Six ways, and every one of them is asserted below:
//
//   · IT RUNS OVER. Somebody says "I have ten minutes", the routine takes
//     thirteen, and they find out at minute eleven. This is the failure the
//     feature exists to avoid, so it is checked for every duration and every
//     focus the screen can ask for, not on one example.
//   · IT UNDER-FILLS AND SAYS NOTHING. Ten minutes asked for, seven delivered,
//     no explanation — which reads as the app being unable to count.
//   · IT FORGETS A UNILATERAL STRETCH COSTS DOUBLE. The budget arithmetic then
//     runs on half the real time and every routine overruns by roughly half,
//     invisibly, because the routine on the row looks fine.
//   · IT PICKS THE SAME MUSCLE OVER AND OVER. Twenty-four leg stretches, six of
//     them hamstrings, and a ten-minute leg routine that is six ways to fold
//     forward. Nothing is wrong on screen; it is just a bad routine.
//   · IT IS NOT DETERMINISTIC. The same taps give a different routine on every
//     render, which cannot be tested and reads as the app changing its mind.
//   · IT PADS RATHER THAN ADMITS. A focus with seven stretches in it asked to
//     fill twenty minutes either repeats a stretch, holds each for two minutes,
//     or says it cannot. Only the third is honest.
//
// Compile with tsc then run with node, like stretchRoutine.test.ts next door.
import {
  STRETCH_CATALOGUE, STRETCH_FOCUS, BUILD_MINUTES, focusById, buildRoutine, buildProblems,
  BUILD_HOLD_SEC, MAX_BUILT_HOLD_SEC, TOPUP_STEP_SEC, MIN_BUILD_MINUTES, MAX_BUILD_MINUTES,
  type StretchCandidate,
} from './stretchBuilder';
import {
  routineStages, routineTotalSec, routineMinutes, routineProblems, routineSummary,
  MIN_HOLD_SEC, MAX_HOLD_SEC, TRANSITION_SEC,
} from './stretchRoutine';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A catalogue built for one assertion, so an edge case does not depend on the
 *  shipped 51 staying exactly as they are today. */
const c = (id: string, area: StretchCandidate['area'], muscle: string, sides: 1 | 2, flow = false): StretchCandidate =>
  ({ id, name: id, area, muscle, sides, flow });

/* ── THE BOUNDS THIS FILE SETS ITSELF SIT INSIDE THE ONES EVERY ROUTINE HAS ─ */
//
// stretchRoutine.ts refuses a hold under 15s or over 120s for ANY routine, and
// prices a change of position at 10s. If the builder's own numbers drifted
// outside those, every routine it produced would be rejected by
// routineProblems — or worse, accepted while being measured by a different
// arithmetic from the one that prints "about 10 min" on the row.

eq(BUILD_HOLD_SEC, 30, 'a built stretch starts at thirty seconds — the median of the six written routines, and long enough to be a stretch rather than a touch');
eq(MAX_BUILT_HOLD_SEC, 60, 'and the top-up will take it to a minute and no further, because past that it is padding rather than a longer stretch');
ok(BUILD_HOLD_SEC >= MIN_HOLD_SEC, 'the starting hold is not under the floor every routine in the app is held to');
ok(MAX_BUILT_HOLD_SEC <= MAX_HOLD_SEC, 'and the ceiling is not over it');
ok(BUILD_HOLD_SEC < MAX_BUILT_HOLD_SEC, 'THE TOP-UP HAS SOMEWHERE TO GO — equal bounds is a builder that silently stops filling the time it was given');
eq(TRANSITION_SEC, 10, 'and the change of position costs the same ten seconds here as it does in the estimate printed on every row');
eq(MIN_BUILD_MINUTES, 2, 'two minutes is the shortest thing that is a routine: two stretches and the move between them');
eq(MAX_BUILD_MINUTES, 60, 'and an hour is the cap, which is a guard on typing rather than on training');

/* ── the catalogue ───────────────────────────────────────────────────────── */

eq(STRETCH_CATALOGUE.length, 51,
  'FIFTY-ONE STRETCHES — the 76 stretching rows in the pack, less the 21 that want a band or a bench, less the four Pilates flows that belong to a different Mobility activity');
ok(STRETCH_CATALOGUE.every((x) => !x.id.startsWith('pilates-')),
  'and no Pilates: somebody who chose Stretch over Pilates one screen earlier must not be handed Pilates Saw');

const slug = (str: string) => str.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');
const ids = new Set<string>();
for (const x of STRETCH_CATALOGUE) {
  eq(x.id, slug(x.name),
    `"${x.name}" must be keyed by the slug of its own name — that is what exerciseSlug() looks up, and RepDB's own id is not it`);
  ok(!ids.has(x.id), `${x.id} is in the catalogue twice, so a routine could hold it twice with no reason on screen`);
  ids.add(x.id);
  ok(x.muscle.trim() !== '', `${x.id} has no primary muscle, so it cannot be spread against the others in its area`);
}

// The eight flows, named in full. Marking a static hold as a flow puts "Keep
// moving" over a position somebody is meant to sit still in; marking a flow as
// static tells them to freeze in the middle of Cat-Cow. Both render perfectly.
const FLOWS = new Set([
  'cat-cow', 'downward-dog-pedal', 'downward-dog-to-low-lunge', 'half-kneeling-hip-flexor-rock',
  'low-lunge-to-half-split', 'standing-forward-fold-to-half-lift', 'standing-side-bend-flow',
  'thread-the-needle-flow',
]);
for (const x of STRETCH_CATALOGUE) {
  eq(x.flow, FLOWS.has(x.id), `${x.id} is on the wrong side of the flow/hold line, and the runner picks its verb from it`);
}

// WHICH STRETCHES ARE DONE ON BOTH SIDES, named in full — the same list
// stretchRoutine.test.ts keeps, for the same reason: a `sides: 2` flipped to 1
// is half a routine done on one leg, and it looks entirely normal.
const UNILATERAL = new Set([
  'cow-face-pose', 'cross-body-shoulder-stretch', 'downward-dog-to-low-lunge',
  'half-kneeling-hip-flexor-rock', 'head-to-knee-pose', 'knee-to-chest-stretch',
  'kneeling-hip-flexor-stretch', 'lizard-stretch', 'low-lunge', 'low-lunge-to-half-split',
  'neck-side-stretch', 'overhead-triceps-stretch', 'pigeon-stretch', 'pyramid-pose',
  'seated-spinal-twist', 'standing-calf-stretch', 'standing-quad-stretch', 'standing-side-bend',
  'standing-split', 'supine-spinal-twist', 'thread-the-needle', 'thread-the-needle-flow',
  'triangle-pose',
]);
for (const x of STRETCH_CATALOGUE) {
  eq(x.sides, UNILATERAL.has(x.id) ? 2 : 1,
    `${x.id}: whether it is done on each side decides whether it costs one hold or two, and the whole time budget is built on it`);
}
eq(STRETCH_CATALOGUE.filter((x) => x.sides === 2).length, 23, 'twenty-three of the fifty-one are two-sided, so nearly half the catalogue costs double');

/* ── the focus options ───────────────────────────────────────────────────── */

const MINOR = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'for', 'and', 'or', 'with', 'per', 'at', 'by', 'from', 'as']);
for (const f of STRETCH_FOCUS) {
  ok(f.areas.length > 0, `focus "${f.id}" covers no part of the body`);
  ok(STRETCH_CATALOGUE.some((x) => f.areas.includes(x.area)),
    `focus "${f.id}" has no stretches behind it at all, so its chip would build nothing`);
  f.label.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).forEach((w, i) => {
    if (i > 0 && MINOR.has(w.toLowerCase())) return;
    ok(/^[A-Z]/.test(w), `"${f.label}" is drawn as a chip beside "Program" and "Cardio" and must be Title Case — "${w}" is not`);
  });
  ok(/^[a-z]/.test(f.phrase),
    `"${f.phrase}" goes in the middle of a sentence, so it is lower case — a label dropped into prose is how a screen says "across your Legs & Hips"`);
  eq(new Set(f.areas).size, f.areas.length, `focus "${f.id}" names an area twice, which would deal it two turns in the round-robin`);
}
ok(STRETCH_FOCUS.some((f) => f.id === 'whole-body'), 'there is a whole-body option, which is the default and the one most people want');
eq(focusById('legs')?.label, 'Legs & Hips', 'a known focus id resolves');
eq(focusById(' legs ')?.id, 'legs', 'and one that arrived with whitespace still does');
eq(focusById('nope'), null, 'AN UNKNOWN FOCUS IS NULL, NOT THE FIRST ONE — a stored preference for an option we have since renamed must say so rather than silently stretch something else');
eq(focusById(''), null, 'an empty id is not a focus');
eq(focusById(null), null, 'nor is a missing one');

// The narrow focus is real and is meant to be. It is what makes the shortfall
// path below something the app actually does rather than something only a
// fixture reaches.
const upperPool = STRETCH_CATALOGUE.filter((x) => focusById('upper')!.areas.includes(x.area));
eq(upperPool.length, 7,
  'SHOULDERS, CHEST AND ARMS IS SEVEN STRETCHES — not enough to fill twenty minutes, which is the case the shortfall sentence exists for');

/* ── THE TIME RULE, ACROSS EVERYTHING THE SCREEN CAN ASK FOR ─────────────── */
//
// Not one example. Every duration on the picker against every focus on it, and
// then the same again for every whole minute from the floor to twice the
// longest the screen offers — because the constant a screen passes today is not
// the constant it passes next month.

for (const f of STRETCH_FOCUS) {
  for (const minutes of BUILD_MINUTES) {
    const built = buildRoutine({ minutes, focus: f.id });
    const r = built.routine;
    ok(!!r, `${f.id} at ${minutes} min built nothing — ${built.problem ?? 'and gave no reason'}`);
    if (!r) continue;
    eq(buildProblems(built, minutes).join(' | '), '', `${f.id} at ${minutes} min`);
    eq(routineProblems([r]).join(' | '), '',
      `${f.id} at ${minutes} min must satisfy every rule a written routine does — it is played by the same runner`);
    ok(routineTotalSec(r) <= minutes * 60,
      `${f.id} AT ${minutes} MIN RUNS OVER at ${routineTotalSec(r)}s — the one thing this feature exists to not do`);
  }
}

for (let minutes = MIN_BUILD_MINUTES; minutes <= 2 * BUILD_MINUTES[BUILD_MINUTES.length - 1]; minutes++) {
  for (const f of STRETCH_FOCUS) {
    const built = buildRoutine({ minutes, focus: f.id });
    eq(buildProblems(built, minutes).join(' | '), '', `${f.id} at ${minutes} min`);
  }
}

// The estimate on the row IS the budget. `routineTotalSec` is what prints
// "about 10 min" under a routine and it is what the builder counts against, so
// a ten-minute request comes back reading ten minutes — not nine, which would
// be three quarters of a stretch thrown away on every routine.
for (const minutes of BUILD_MINUTES) {
  const r = buildRoutine({ minutes, focus: 'whole-body' }).routine!;
  eq(routineMinutes(r), minutes,
    `A ${minutes}-MINUTE WHOLE-BODY ROUTINE READS AS ${minutes} MINUTES — the leftover after the last stretch that fits is spent lengthening the holds, so the time asked for is the time given`);
  ok(routineTotalSec(r) > minutes * 60 - 60,
    `and it is genuinely close to ${minutes * 60}s rather than rounding up to it from far below`);
}

// A unilateral stretch costs DOUBLE, and the budget has to be built on stages
// rather than on stretches. If it were not, a routine of ten stretches half of
// which are two-sided would be priced at ten holds and run for fifteen.
const sidedOnly = [c('a', 'back', 'm1', 2), c('b', 'back', 'm2', 2), c('d', 'back', 'm3', 2), c('e', 'back', 'm4', 2)];
const sidedBuilt = buildRoutine({ minutes: 3, focus: 'back', catalogue: sidedOnly });
ok(!!sidedBuilt.routine, 'a catalogue of nothing but two-sided stretches still builds');
ok(routineTotalSec(sidedBuilt.routine!) <= 180,
  'A CATALOGUE OF TWO-SIDED STRETCHES DOES NOT OVERRUN — each one is two holds and one extra change of position, and pricing it as one is how every routine ends up half again as long');
eq(routineStages(sidedBuilt.routine!).length, sidedBuilt.routine!.steps.length * 2,
  'and every one of them expands to two stages, which is what the runner will actually walk');

/* ── coverage: which stretches, and why not four of the same ─────────────── */

const legs10 = buildRoutine({ minutes: 10, focus: 'legs' }).routine!;
const legMuscles = legs10.steps.map((st) => STRETCH_CATALOGUE.find((x) => x.id === st.id)!.muscle);
ok(new Set(legMuscles).size >= 4,
  `A TEN-MINUTE LEG ROUTINE TOUCHES AT LEAST FOUR MUSCLE GROUPS — got ${new Set(legMuscles).size} from ${legMuscles.join(', ')}. Twenty-four leg stretches with six for the hamstrings is how it becomes six ways to fold forward`);
ok(legMuscles.filter((m) => m === legMuscles[0]).length <= Math.ceil(legMuscles.length / 2),
  'and no single muscle takes over half of it');

const whole15 = buildRoutine({ minutes: 15, focus: 'whole-body' }).routine!;
const wholeAreas = whole15.steps.map((st) => STRETCH_CATALOGUE.find((x) => x.id === st.id)!.area);
ok(new Set(wholeAreas).size >= 5,
  `A WHOLE-BODY ROUTINE COVERS THE WHOLE BODY — ${new Set(wholeAreas).size} areas in fifteen minutes. Selection deals round-robin across areas so a routine cut short by the budget is still spread out`);

// The SHORT one is where coverage is decided, because there is only room for a
// handful. Five minutes must not be five leg stretches.
const whole5 = buildRoutine({ minutes: 5, focus: 'whole-body' }).routine!;
const shortAreas = whole5.steps.map((st) => STRETCH_CATALOGUE.find((x) => x.id === st.id)!.area);
ok(new Set(shortAreas).size >= 3,
  `FIVE MINUTES STILL REACHES THREE AREAS — got ${[...new Set(shortAreas)].join(', ')}. A builder that fills from the biggest area first spends the whole five on legs`);
ok(!shortAreas.includes('full_body'),
  'and it does not open with Mountain Pose: full_body is last in the whole-body order because a stance and a lie-down belong at the end of a long routine, not the front of a short one');

// Presentation is a separate decision from selection: the stretches are chosen
// round-robin across areas and then GROUPED BACK into them, because a routine
// that goes legs → back → shoulders → legs has somebody off and on the floor
// four times for no reason.
const focusAreas = focusById('whole-body')!.areas;
const rank = wholeAreas.map((a) => focusAreas.indexOf(a));
ok(rank.every((n, i) => i === 0 || rank[i - 1] <= n),
  `THE ROUTINE READS IN BLOCKS — the areas came out as ${wholeAreas.join(', ')}, which jumps back and forth`);

// Nothing twice, ever. `routineProblems` says the same thing, and it is worth
// asserting here as well: the builder is the only thing in the app that could
// produce a routine holding the same position at stretch 2 and stretch 9.
for (const f of STRETCH_FOCUS) {
  for (const minutes of BUILD_MINUTES) {
    const r = buildRoutine({ minutes, focus: f.id }).routine!;
    eq(new Set(r.steps.map((st) => st.id)).size, r.steps.length,
      `${f.id} at ${minutes} min holds a stretch twice — the runner would ask for the same position two stages apart with no reason on screen`);
  }
}

/* ── DETERMINISM, AND THE SEED THAT IS THE ONLY WAY TO VARY IT ───────────── */

const twiceA = buildRoutine({ minutes: 12, focus: 'whole-body' });
const twiceB = buildRoutine({ minutes: 12, focus: 'whole-body' });
eq(JSON.stringify(twiceA.routine), JSON.stringify(twiceB.routine),
  'THE SAME REQUEST BUILDS THE SAME ROUTINE — a builder that shuffles gives a different answer on every render of one screen, cannot be tested, and reads as the app changing its mind');
eq(JSON.stringify(buildRoutine({ minutes: 12, focus: 'whole-body', seed: 0 }).routine), JSON.stringify(twiceA.routine),
  'and no seed means seed zero rather than some other starting point');

const seeded = buildRoutine({ minutes: 12, focus: 'whole-body', seed: 3 });
ok(JSON.stringify(seeded.routine) !== JSON.stringify(twiceA.routine),
  'A DIFFERENT SEED IS A DIFFERENT ROUTINE — otherwise the button offering another one does nothing, which is worse than not offering it');
eq(JSON.stringify(buildRoutine({ minutes: 12, focus: 'whole-body', seed: 3 }).routine), JSON.stringify(seeded.routine),
  'and the same seed is the same routine again, which is what makes the offer repeatable');
eq(buildProblems(seeded, 12).join(' | '), '', 'a seeded routine holds every rule an unseeded one does');
eq(buildProblems(buildRoutine({ minutes: 12, focus: 'whole-body', seed: 1000003 }), 12).join(' | '), '',
  'a seed far larger than the catalogue is a rotation, not an index — it must not run off the end');
eq(buildProblems(buildRoutine({ minutes: 12, focus: 'whole-body', seed: -4 }), 12).join(' | '), '',
  'and a negative seed rotates the other way rather than producing an empty routine');
eq(buildProblems(buildRoutine({ minutes: 12, focus: 'whole-body', seed: Number.NaN }), 12).join(' | '), '',
  'a seed that is not a number falls back to zero instead of poisoning every index');

// Offering to build another one is a promise, so it is only made when there is
// another one to build.
ok(buildRoutine({ minutes: 10, focus: 'whole-body' }).canVary,
  'ten minutes of the whole body leaves most of the fifty-one unused, so there is genuinely another routine to build');
eq(buildRoutine({ minutes: 20, focus: 'upper' }).canVary, false,
  'A ROUTINE THAT ALREADY HOLDS EVERY AVAILABLE STRETCH CANNOT VARY — offering to shuffle it is an offer we cannot keep');

/* ── THE SHORTFALL: SEVEN STRETCHES ASKED TO FILL TWENTY MINUTES ─────────── */

const thin = buildRoutine({ minutes: 20, focus: 'upper' });
ok(!!thin.routine, 'a focus we cannot fill still gives a routine — the answer to "we only have seven" is seven stretches, not nothing');
eq(thin.routine!.steps.length, 7, 'all seven of them');
ok(thin.shortfall != null,
  'AND IT SAYS SO. The alternatives are repeating a stretch or holding each one for two minutes, and both are the app pretending it had enough');
ok(routineMinutes(thin.routine!) < 20, 'the routine really is shorter than what was asked for');
ok(/^[A-Z]/.test(thin.shortfall!) && /\.$/.test(thin.shortfall!.trim()),
  'the shortfall is prose under a title: sentence case, ending in a full stop');
ok(thin.shortfall!.includes('7'), 'and it says how many stretches we actually have, rather than apologising in the abstract');
eq(thin.routine!.title, `${routineMinutes(thin.routine!)}-Minute Shoulders, Chest & Arms`,
  'THE TITLE IS THE LENGTH IT IS, NOT THE LENGTH ASKED FOR — "20-Minute" over a twelve-minute routine is the small lie somebody plans their evening around');
ok(thin.routine!.steps.every((st) => st.holdSec <= MAX_BUILT_HOLD_SEC),
  'and the holds stop at a minute rather than stretching to the two minutes that would fill the twenty');

const filled = buildRoutine({ minutes: 10, focus: 'whole-body' });
eq(filled.shortfall, null, 'a routine that fills the time does not apologise for not filling it');

// A focus of ONE stretch. lower_arms holds exactly one equipment-free row in
// the pack, and a routine of one position is a true answer to a request we
// cannot meet — with the sentence that says so.
const oneOnly = buildRoutine({ minutes: 10, focus: 'wrists', catalogue: [c('w', 'lower_arms', 'forearm_flexors', 1)] });
ok(oneOnly.routine == null && oneOnly.problem != null, 'a focus id nothing knows about builds nothing and says why');
const wrists = buildRoutine({ minutes: 10, focus: 'upper', catalogue: [c('w', 'lower_arms', 'forearm_flexors', 1)] });
eq(wrists.routine!.steps.length, 1, 'ONE STRETCH IS A ROUTINE OF ONE STRETCH — not a repeat of it four times to fill the time');
ok(wrists.shortfall!.includes('1 equipment-free stretch'),
  `and the sentence is singular — "1 stretches" is the kind of thing that makes a screen look unfinished. Got "${wrists.shortfall}"`);
eq(wrists.routine!.steps[0].holdSec, MAX_BUILT_HOLD_SEC,
  'its hold is topped up to the ceiling, because there is nothing else to spend the ten minutes on — and stops there rather than becoming a ten-minute hold');
eq(wrists.canVary, false, 'and there is no other routine to offer');

/* ── the requests we cannot build from ───────────────────────────────────── */

const refused = (r: ReturnType<typeof buildRoutine>, why: string) => {
  eq(r.routine, null, `${why} — a routine came back anyway`);
  ok(r.problem != null, `${why} — and no reason was given for there not being one, which reads as the screen having broken`);
  if (r.problem) {
    ok(/^[A-Z]/.test(r.problem) && /\.$/.test(r.problem.trim()),
      `${why} — the reason is rendered as prose and must be a sentence, capital to full stop. Got "${r.problem}"`);
    ok(!/\byou\b.*\bwrong\b/i.test(r.problem), `${why} — the reason blames the member for something we could not do`);
  }
  eq(r.shortfall, null, `${why} — there is no routine, so there is nothing for it to be short of`);
  eq(r.canVary, false, `${why} — and nothing to vary`);
};

refused(buildRoutine({ minutes: 1 }), 'A MINUTE IS ONE POSITION, WHICH IS A STRETCH AND NOT A ROUTINE');
refused(buildRoutine({ minutes: MIN_BUILD_MINUTES - 1 }), 'one under the floor is refused, so the boundary is the boundary');
ok(buildRoutine({ minutes: MIN_BUILD_MINUTES }).routine != null,
  'AND EXACTLY ON THE FLOOR IS BUILT — the bound is inclusive, and an off-by-one here refuses a routine that is fine');
ok(buildRoutine({ minutes: MAX_BUILD_MINUTES }).routine != null, 'as is exactly on the ceiling');
refused(buildRoutine({ minutes: MAX_BUILD_MINUTES + 1 }), 'and one over it is not');
refused(buildRoutine({ minutes: 0 }), 'no time at all is not a routine');
refused(buildRoutine({ minutes: -10 }), 'nor is a negative one');
refused(buildRoutine({ minutes: Number.NaN }), 'NaN OUT OF A NUMBER FIELD MUST NOT REACH THE BUILDER');
refused(buildRoutine({ minutes: Number.POSITIVE_INFINITY }), 'nor Infinity, which would ask for every stretch we have');
refused(buildRoutine({ minutes: 10, focus: 'shoulders' }), 'a focus id that is not one of ours — an area is not a focus, and a stored preference can be either');
refused(buildRoutine({ minutes: 10, focus: '' }), 'an empty focus is not the default one, because an empty string is a bug and the whole body is a choice');
refused(buildRoutine({ minutes: 10, catalogue: [] }), 'AN EMPTY CATALOGUE BUILDS NOTHING AND SAYS SO — it cannot happen in the app, where the catalogue is a constant, but an argument is an argument');
refused(buildRoutine({ minutes: 10, focus: 'legs', catalogue: [c('x', 'back', 'm', 1)] }),
  'and a catalogue with nothing for the area asked for says that instead, which is a different sentence from having no catalogue');

// A fractional request is a caller's arithmetic rather than a member's words,
// and 9.5 plainly means "fit it into nine".
const half = buildRoutine({ minutes: 9.5, focus: 'whole-body' });
ok(routineTotalSec(half.routine!) <= 9 * 60,
  'NINE AND A HALF MINUTES IS FLOORED TO NINE — rounding it up is thirty seconds of somebody else’s evening');
eq(JSON.stringify(half.routine!.steps), JSON.stringify(buildRoutine({ minutes: 9, focus: 'whole-body' }).routine!.steps),
  'and it builds exactly the routine nine minutes would have');

/* ── what the built routine says about itself ────────────────────────────── */

const shown = buildRoutine({ minutes: 10, focus: 'legs' }).routine!;
eq(shown.title, '10-Minute Legs & Hips', 'the title says how long it is and what it is for');
ok(/^[A-Z]/.test(shown.note) && /\.$/.test(shown.note.trim()),
  'the note is prose under a title: sentence case, ending in a full stop');
ok(shown.note.includes('legs and hips'),
  `the note uses the focus's sentence form, not its chip label — "across your Legs & Hips" is a label dropped into prose. Got "${shown.note}"`);
ok(routineSummary(shown).includes('about 10 min'),
  `the row under it reads the same ten minutes the member asked for. Got "${routineSummary(shown)}"`);
eq(shown.id, 'built-legs-10-0', 'the id is deterministic, so two routines built in one session cannot collide as React keys');
ok(/^[a-z0-9-]+$/.test(shown.id), 'and it is a slug, like every other routine id in the app');

const onlyOne = buildRoutine({ minutes: 2, focus: 'upper', catalogue: [c('w', 'chest', 'pec', 1)] }).routine!;
ok(onlyOne.note.includes('1 equipment-free stretch,'),
  `ONE STRETCH IS SINGULAR IN THE NOTE TOO. Got "${onlyOne.note}"`);

/* ── the checker itself has to be able to fail ───────────────────────────── */

const built10 = buildRoutine({ minutes: 10, focus: 'whole-body' });
eq(buildProblems(built10, 10).join(' | '), '', 'a good routine has no problems');
ok(buildProblems(built10, 5).join(' | ').includes('kept'),
  'A ROUTINE MEASURED AGAINST A SMALLER BUDGET IS CAUGHT — this is the assertion the whole sweep above rests on, and a checker that cannot fail turns all of it green for nothing');
ok(buildProblems(built10, 20).join(' | ').includes('nothing says so'),
  'and one that is short of its budget with no sentence explaining it');
ok(buildProblems({ ...built10, shortfall: 'padded.' }, 10).join(' | ').includes('apologising'),
  'as is a routine that fills its time and apologises anyway');
ok(buildProblems({ routine: null, problem: null, shortfall: null, canVary: false }, 10).join(' | ').includes('no reason'),
  'nothing built and nothing said is caught');
eq(buildProblems({ routine: null, problem: 'we could not.', shortfall: null, canVary: false }, 10).join(' | '), '',
  'and nothing built WITH a reason is a complete answer rather than a fault');
ok(buildProblems({ ...built10, problem: 'we could not.' }, 10).join(' | ').includes('only one of those can be true'),
  'a routine handed back alongside a reason there is none is caught');

const doubled = { ...built10, routine: { ...built10.routine!, steps: [built10.routine!.steps[0], built10.routine!.steps[0]] } };
ok(buildProblems(doubled, 10).join(' | ').includes('twice'), 'a repeated stretch is caught');
const shortHold = { ...built10, routine: { ...built10.routine!, steps: [{ ...built10.routine!.steps[0], holdSec: 20 }] } };
ok(buildProblems(shortHold, 10).join(' | ').includes('under'), 'a hold under the thirty a built stretch starts at is caught');
const longHold = { ...built10, routine: { ...built10.routine!, steps: [{ ...built10.routine!.steps[0], holdSec: 90 }] } };
ok(buildProblems(longHold, 10).join(' | ').includes('over'), 'and one over the minute the top-up stops at');
const oddHold = { ...built10, routine: { ...built10.routine!, steps: [{ ...built10.routine!.steps[0], holdSec: 37 }] } };
ok(buildProblems(oddHold, 10).join(' | ').includes('round number'),
  'a hold of 37 seconds is caught — every hold is a multiple of five, because a routine of 37s and 43s holds looks like a bug');
eq(TOPUP_STEP_SEC, 5, 'and the step it is a multiple of is five, stated as a number so moving it has to be deliberate');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('stretchBuilder tests passed');
