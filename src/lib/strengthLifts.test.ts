// What src/lib/strengthLifts.ts must do: grade the five barbell lifts, and
// refuse everything in a 608-name catalogue that merely reads like one.
//
// Every name below is spelled the way the live `exercises` table spells it —
// pulled from the table rather than invented, because the whole failure this
// suite exists for was a pattern meeting a real name nobody had pictured.
// Compile with tsc, run with node.
//
// The false matches are named first and by name. They are the regression: the
// screen prices a bodyweight set at the member's FULL bodyweight and estimates
// a max off it with Epley, and takes a Math.max over the matches — so a wrong
// match can only ever push a grade UP, and can never be pulled back down by a
// real lift lower on the list. An 80 kg member logging twelve Bench Dips read
// "Bench Press · Intermediate · 112 kg · Next: Advanced @ 120 kg" having never
// lain on a bench.
import { STRENGTH_LIFTS, countsFor, isLift, normalise, type StrengthLift } from './strengthLifts';

// Reach success rather than defaulting to it.
process.exitCode = 1;

const errors: string[] = [];
function ok(cond: boolean, what: string): void { if (!cond) errors.push(what); }
function eq<T>(got: T, want: T, what: string): void {
  if (got !== want) errors.push(`${what} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

const lift = (name: string): StrengthLift => {
  const l = STRENGTH_LIFTS.find((x) => x.name === name);
  if (!l) throw new Error(`no standard called ${name}`);
  return l;
};
const SQUAT = lift('Squat');
const BENCH = lift('Bench Press');
const DEADLIFT = lift('Deadlift');
const PRESS = lift('Overhead Press');
const ROW = lift('Row');

/** Every standard this exercise name grades against, in table order. */
const gradesAs = (exercise: string): string[] =>
  STRENGTH_LIFTS.filter((l) => isLift(l, exercise)).map((l) => l.name);
/** Says the name grades against exactly these standards and no others. */
const matches = (exercise: string, want: string[], why: string): void =>
  eq(gradesAs(exercise).join(' + ') || '—', want.join(' + ') || '—', `${exercise}: ${why}`);

/* ── the five standards are the five standards ─────────────────────────── */

eq(STRENGTH_LIFTS.length, 5, 'five lifts are graded');
eq(STRENGTH_LIFTS.map((l) => l.name).join(', '), 'Squat, Bench Press, Deadlift, Overhead Press, Row',
  'and these are they, in the order the screen prints them');
for (const l of STRENGTH_LIFTS) {
  eq(l.mult.length, 5, `${l.name} has a multiple for each of the five levels`);
  ok(l.mult.every((m, i) => i === 0 || m > l.mult[i - 1]), `${l.name}'s levels climb`);
  // A `g` regex carries lastIndex between calls, and these are tested against
  // every record on a member's log — the second call would answer for the
  // first one's position rather than for the name it was handed.
  ok(!l.re.global && !l.not.global, `${l.name}'s patterns are stateless`);
}

/* ── the false matches, by name ────────────────────────────────────────── */

// `'bench'` as a substring. Dips are the member's own body on a bench, and a
// Bench Pull is a prone row — neither is a press and neither loads like one.
matches('Bench Dips', [], 'sitting on a bench is not a bench press');
matches('Bench Pull', [], 'a prone row named after the bench it lies on is not a press');
matches('Dumbbell Bench Pull', [], 'nor is the dumbbell version');
ok(!isLift(BENCH, 'Bench Dips'), 'Bench Dips is not a Bench Press — the reported bug');
// The rest of the bench-named catalogue, which is mostly stretching.
for (const stretch of ['Bench Adductor Stretch', 'Bench Hamstring Stretch', 'Bench Lat Stretch',
  "Bench Child's Pose", 'Bench Couch Stretch', 'Bench Leg Pull-In', 'Bench Figure-4 Glute Stretch']) {
  matches(stretch, [], 'a stretch done on a bench grades nothing');
}

// `'overhead'` as a substring. The Overhead Squat was the second reported
// false match: an 80 kg member's 80×3 graded Elite Overhead Press, and the
// press scale tops out at 1.1× bodyweight.
matches('Overhead Squat', [], 'shoulder-limited at half a back squat, and not a press at all');
ok(!isLift(PRESS, 'Overhead Squat'), 'Overhead Squat is not an Overhead Press — the reported bug');
ok(!isLift(SQUAT, 'Overhead Squat'), 'and it is not a Squat either');
// The carry family: a loaded walk, not a press, and the whole family reads the
// word `overhead` the old substring did.
for (const carry of ['Kettlebell Overhead Carry', 'Dumbbell Overhead Carry',
  'Double Dumbbell Overhead Carry', 'Double Kettlebell Overhead Carry']) {
  matches(carry, [], 'a carry is held, not pressed');
}
// Extensions and stretches wearing the same word.
matches('Overhead Tricep Extension', [], 'an isolation is not a press');
matches('Barbell Overhead Extension', [], 'nor with a barbell in it');
matches('Overhead Triceps Stretch', [], 'nor is a stretch');

// `'row'` as a substring — the `row` inside `c-row`.
matches('Crow Pose', [], 'the row inside c-row is not a row');
ok(!isLift(ROW, 'Crow Pose'), 'Crow Pose is not a Row — the reported bug');
// And the machine, which is cardio and whose name does not end at a boundary.
matches('Rowing Machine', [], 'rowing is not a row, and a machine is not a bar');

/* ── the lifts that must still grade ───────────────────────────────────── */

matches('Bench Press', ['Bench Press'], 'the lift itself');
matches('Close-Grip Bench Press', ['Bench Press'], 'a grip is still a bench press');
matches('Close-Grip Incline Bench Press', ['Bench Press'], 'two modifiers is still one');
matches('Incline Barbell Bench Press', ['Bench Press'], 'an angle is still a bench press');
matches('Decline Bench Press', ['Bench Press'], 'and the other angle');
matches('Paused Bench Press', ['Bench Press'], 'a pause makes it harder, never lighter');
matches('Dumbbell Bench Press', ['Bench Press'], 'dumbbells are real mass');
matches('Wide-Grip Bench Press', ['Bench Press'], 'and the wide grip');
matches('EZ-Bar Bench Press', ['Bench Press'], 'and the EZ bar');
// The Smith rack: a real bar with real plates, kept by normalising the word
// `machine` out of its name before the `not` pattern can refuse it.
matches('Smith Machine Bench Press', ['Bench Press'], 'a Smith rack is a bar with plates on it');
matches('Smith Machine Incline Bench Press', ['Bench Press'], 'and its incline');

matches('Back Squat', ['Squat'], 'the lift itself');
matches('Front Squat', ['Squat'], 'two legs, bar load, always at or below the back squat');
matches('Goblet Squat', ['Squat'], 'a held weight is still a weight');
matches('Box Squat', ['Squat'], 'a box under it is still a squat');
matches('Pause Squat', ['Squat'], 'and a pause in it');
matches('Dumbbell Front Squat', ['Squat'], 'and dumbbells');
matches('Smith Machine Squat', ['Squat'], 'a Smith squat reads a few per cent high and is kept anyway');
matches('Smith Machine Front Squat', ['Squat'], 'and its front-rack version');

matches('Deadlift', ['Deadlift'], 'the lift itself');
matches('Sumo Deadlift', ['Deadlift'], 'a competition deadlift, same lift, different stance');
matches('Hex Bar Deadlift', ['Deadlift'], 'a trap-bar-only lifter has still deadlifted');
matches('Deficit Deadlift', ['Deadlift'], 'a deficit only makes the pull longer');
matches('Pause Deadlift', ['Deadlift'], 'and a pause only makes it harder');
matches('Kettlebell Deadlift', ['Deadlift'], 'and a kettlebell is mass');
matches('Dumbbell Deadlift', ['Deadlift'], 'as are dumbbells');
matches('Kettlebell Sumo Deadlift', ['Deadlift'], 'and the sumo stance with them');

matches('Overhead Press', ['Overhead Press'], 'the lift itself');
matches('Shoulder Press', ['Overhead Press'], 'the other name for the same lift');
matches('Seated Barbell Overhead Press', ['Overhead Press'], 'seated presses the same bar');
matches('Seated Dumbbell Shoulder Press', ['Overhead Press'], 'and seated with dumbbells');
matches('Paused Overhead Press', ['Overhead Press'], 'and paused');
matches('Double Kettlebell Overhead Press', ['Overhead Press'], 'kettlebells overhead are mass overhead');
matches('One Arm Kettlebell Shoulder Press', ['Overhead Press'], 'and one of them');
matches('Smith Machine Shoulder Press', ['Overhead Press'], 'the Smith rack again');
matches('Seated Smith Machine Shoulder Press', ['Overhead Press'], 'and seated in it');
ok(isLift(PRESS, 'OHP'), 'the abbreviation a member types grades too');
ok(isLift(PRESS, 'Overhead Presses'), 'and the plural somebody logs');

matches('Bent-over Row', ['Row'], 'the lift itself');
matches('Pendlay Row', ['Row'], 'a bent-over row from a dead stop');
matches('Bent-Over Dumbbell Row', ['Row'], 'with dumbbells');
matches('Bent-Over EZ-Bar Row', ['Row'], 'and with an EZ bar');
matches('Chest-Supported Dumbbell Row', ['Row'], 'chest-supported takes the hinge out, not the load');
matches('Single-Arm Dumbbell Row', ['Row'], 'one arm at a time is still the same load in the hand');
matches('One-Arm Kettlebell Row', ['Row'], 'and one kettlebell');
matches('Reverse Grip Bent Over Row', ['Row'], 'and the underhand grip');
matches('Smith Machine Bent Over Row', ['Row'], 'the Smith rack once more');

/* ── the deliberate exclusions ─────────────────────────────────────────── */

// Hinge accessories. These UNDER-state rather than inflate, which is the safe
// direction — but a member who only ever RDLs has not tested a deadlift and
// must not be handed a level and a next target for one.
matches('Romanian Deadlift', [], 'a hinge accessory nobody tests a single at');
matches('Dumbbell Romanian Deadlift', [], 'nor with dumbbells');
matches('EZ-Bar Romanian Deadlift', [], 'nor with an EZ bar');
matches('Smith Machine Romanian Deadlift', [], 'the Smith rack does not rescue an RDL');
matches('Stiff Leg Deadlift', [], 'the same hinge under another name');
matches('Banded Romanian Deadlift', [], 'and a band is not kilograms of mass');
// One leg against a two-leg standard.
matches('Single Leg Romanian Deadlift', [], 'half the body against a whole-body standard');
matches('Kettlebell Single Leg Deadlift', [], 'and on one leg with a kettlebell');
matches('Dumbbell Kickstand Deadlift', [], 'a kickstand is one leg with a prop');
matches('One-Arm Single-Leg Dumbbell Romanian Deadlift', [], 'every objection at once');
matches('Split Squat', [], 'one leg against a two-leg squat standard');
matches('Bulgarian Split Squat', [], 'and the rear-foot-elevated version');
matches('Kettlebell Bulgarian Split Squat', [], 'loaded, and still one leg');
matches('Smith Machine Split Squat', [], 'the Smith rack does not make it two legs');
matches('Pistol Squat', [], 'one leg and the member is the load');
matches('TRX Pistol Squat', [], 'and on straps');
// Selectorized stacks, cables, sleds and the T-bar: a manufacturer's leverage
// ratio rather than the mass moved, and every one of them reads high.
matches('Hack Squat', [], 'a plate stack on rails is not the mass moved');
matches('Machine Shoulder Press', [], 'nor is a shoulder press machine');
matches('Single-Arm Machine Shoulder Press', [], 'nor one arm of it');
matches('Seated Row', [], 'a seated row is a cable stack');
matches('Wide Grip Seated Cable Row', [], 'and so is the wide-grip one');
matches('Kneeling Cable Row', [], 'cables read a leverage ratio');
matches('Sled Row', [], 'and a sled reads friction');
matches('T-Bar Row', [], 'the lever puts about two thirds of the plate at the hands');
// A different exercise wearing the name.
matches('Barbell Upright Row', [], 'an upright row is a shoulder accessory');
matches('Cable Upright Row', [], 'on a cable, twice over');
matches('Dumbbell Upright Row', [], 'and with dumbbells');
matches('Smith Machine Upright Row', [], 'and in the Smith rack');
matches('Barbell Rear Delt Row', [], 'a rear delt row is an isolation');
matches('Double Kettlebell Rear Delt Row', [], 'and with kettlebells');
matches('Inverted Row', [], 'the member hanging from a bar is the load');
matches('Rings Inverted Row', [], 'and on rings');
matches('Ring Row', [], 'as is a ring row');
matches('TRX Row', [], 'and a strap row');
// Bodyweight and band squats.
matches('Bodyweight Squat', [], 'an air squat prices at the whole member');
matches('Jump Squat', [], 'as does a jump squat');
matches('Stability Ball Wall Squat', [], 'and a wall sit against a ball');
matches('TRX Squat', [], 'and a strap-assisted squat');
matches('Cossack Squat', [], 'a mobility squat, one side at a time');
matches('Banded Squat', [], "a band's resistance is not kilograms of mass");
// The one that had the press scale beaten by a member's own body on rep one.
matches('Bodyweight Overhead Press', [], 'the press tops out at 1.1×, so a body cleared Elite');

/* ── the load, not just the name ───────────────────────────────────────── */

// The belt to the patterns' braces. None of the five lifts is a bodyweight
// movement, so a record whose load came from a weigh-in cannot be one of them
// whatever it is called — which is the half of the guard that covers the free
// text a trainer types, and the member who ticks Bodyweight by mistake.
ok(countsFor(BENCH, { exercise: 'Bench Press', bodyweight: false }),
  'a loaded bench press grades');
ok(!countsFor(BENCH, { exercise: 'Bench Press', bodyweight: true }),
  'a bench press ticked Bodyweight does not — the load is the member, not the bar');
ok(!countsFor(SQUAT, { exercise: 'Back Squat', bodyweight: true }),
  'nor does a bodyweight-priced back squat');
ok(!countsFor(DEADLIFT, { exercise: 'Deadlift', bodyweight: true }),
  'nor a bodyweight-priced deadlift');
ok(!countsFor(PRESS, { exercise: 'Overhead Press', bodyweight: true }),
  'nor a bodyweight-priced overhead press');
ok(!countsFor(ROW, { exercise: 'Bent-over Row', bodyweight: true }),
  'nor a bodyweight-priced row');
// Free text: a name that is in no catalogue at all still cannot get a body
// through, and a name that is in no catalogue and loaded still grades on the
// words in it — the table is not a whitelist of the 608.
ok(!countsFor(SQUAT, { exercise: 'Tim’s Special Squat Thing', bodyweight: true }),
  'a made-up name priced at bodyweight grades nothing');
ok(countsFor(SQUAT, { exercise: 'Tim’s Special Squat Thing', bodyweight: false }),
  'the same name with a real load on it still grades as a squat');
ok(countsFor(BENCH, { exercise: 'Bench Press' }), 'a record with no bodyweight flag at all grades');
ok(!countsFor(BENCH, { exercise: 'Bench Dips', bodyweight: true }),
  'and the reported case fails both halves of the test');

/* ── normalise, which is what keeps the Smith rack ─────────────────────── */

eq(normalise('Smith Machine Squat'), 'smith squat',
  'the Smith rack loses the word that would have it refused as a stack');
eq(normalise('Machine Shoulder Press'), 'machine shoulder press',
  'a real machine keeps it');
eq(normalise('SMITH   MACHINE   BENCH PRESS'), 'smith   bench press',
  'in any case and any spacing');
eq(normalise('Chest-Supported Smith Machine Row'), 'chest-supported smith row',
  'wherever in the name it sits');
// The catalogue has a bare "Smith Machine" in it — equipment, not an exercise.
matches('Smith Machine', [], 'the rack on its own is not a lift');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
process.exitCode = 0;
console.log(`strengthLifts: ok — Bench Dips, Bench Pull, Overhead Squat, the Overhead Carry family and Crow Pose grade nothing; the five lifts and their variants still do`);
