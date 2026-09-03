"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A hold is a hold, and it is never forty-five of anything.
// Compile with tsc, run with node.
//
// The defect this suite is written against is the app refusing its own
// prescription. `buildProgram` writes '45 sec' planks and '30 sec/side' side
// planks; the isometric set method's blurb says "the reps column is seconds";
// and both log paths refused anything that was not a positive whole number of
// reps. What people typed instead was 45 into a reps box, and from that moment
// the record says they performed forty-five plank repetitions.
//
// Every block below is one way that could come back:
//
//   THE FLAG        a hold is testimony, never inferred from a big number
//   READING ONE     what a prescription is asking for, and what a member typed
//   NOT REPS        holds are out of every rep count and every rep record
//   NOT TONNAGE     seconds × kilograms is not a mass moved
//   NOT A 1RM       Epley over a stopwatch is not a strength figure
//   THE HOLD BOARD  what a hold IS worth, stated in its own units
//   ROUND TRIP      the flag survives the trip to a database row
const timedSets_1 = require("./timedSets");
const bodyweightSets_1 = require("./bodyweightSets");
const streaks_1 = require("./streaks");
const workoutRow_1 = require("./workoutRow");
const exerciseHistory_1 = require("./exerciseHistory");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** Local midday, so every assertion means the same thing in the three
 *  timezones `npm run test:zones` runs this under. */
const at = (day, hour = 12) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
};
const HISTORY = [{ t: at('2026-01-10'), v: 80 }];
/* ── THE FLAG ─────────────────────────────────────────────────────────────
 *
 * A hold is said, not guessed. A big first number is not evidence: 'AMRAP 100'
 * is a hundred reps and a set of 45 push-ups is 45 push-ups.
 */
{
    const guessed = { t: at('2026-06-01'), exercise: 'Push-up', sets: [[45, 0]] };
    eq((0, timedSets_1.isTimedSet)(guessed, 0), false, 'a large rep count is not a hold — 45 push-ups are 45 push-ups');
    eq((0, timedSets_1.hasTimedSet)(guessed), false, 'and an entry with no flag has no holds in it');
    const said = { t: at('2026-06-01'), exercise: 'Plank', sets: [[45, 0]], timed: [true] };
    eq((0, timedSets_1.isTimedSet)(said, 0), true, 'a hold is a hold once the person has said so');
    eq((0, timedSets_1.hasTimedSet)(said), true, 'and the entry knows it holds one');
    const mixed = { t: at('2026-06-01'), exercise: 'Ab Circuit', sets: [[12, 0], [40, 0]], timed: [false, true] };
    eq((0, timedSets_1.isTimedSet)(mixed, 0), false, 'the flag is per set, not per exercise');
    eq((0, timedSets_1.isTimedSet)(mixed, 1), true, 'so twelve crunches and a forty-second hold are one entry');
    eq((0, timedSets_1.isTimedSet)(mixed, 5), false, 'a set past the end of the flags is not a hold');
}
/* ── READING ONE ──────────────────────────────────────────────────────────
 *
 * The prescription is prose, because that is what three years of stored
 * programmes are and what a coach types today.
 */
{
    eq((0, timedSets_1.prescribedSeconds)('45 sec'), 45, "the app's own plank prescription reads as forty-five seconds");
    eq((0, timedSets_1.prescribedSeconds)('30 sec/side'), 30, 'and its side plank as thirty');
    eq((0, timedSets_1.prescribedSeconds)('90s'), 90, 'the short spelling counts');
    eq((0, timedSets_1.prescribedSeconds)('1 min'), 60, 'so does a minute');
    eq((0, timedSets_1.prescribedSeconds)('1 min 30'), 90, 'and a minute with seconds after it is ninety, not thirty');
    eq((0, timedSets_1.prescribedSeconds)('2 min hold'), 120, 'words after the figure do not stop it being read');
    eq((0, timedSets_1.prescribedSeconds)('30-45 sec'), 30, 'a range takes the first figure — the one that has to be reached — because seeding the top of it asks somebody to fail');
    eq((0, timedSets_1.prescribedSeconds)('12'), null, 'a bare number is reps and stays reps');
    eq((0, timedSets_1.prescribedSeconds)('8-10'), null, 'and so is a bare rep range');
    eq((0, timedSets_1.prescribedSeconds)(''), null, 'nothing asks for nothing');
    eq((0, timedSets_1.prescribedSeconds)(undefined), null, 'and an absent prescription is not a hold');
    eq((0, timedSets_1.isTimedPrescription)('45 sec'), true, 'the predicate agrees with the parser');
    eq((0, timedSets_1.isTimedPrescription)('10'), false, 'in both directions');
    // What a member types, which is a different problem: it must be refused
    // rather than coerced, exactly as `readLift` refuses a mistyped load.
    const good = (0, timedSets_1.readHold)('45');
    ok(good.ok && good.secs === 45, 'a typed 45 is forty-five seconds');
    const clock = (0, timedSets_1.readHold)('1:30');
    ok(clock.ok && clock.secs === 90, 'and 1:30 is ninety, because that is how anybody reads a clock');
    ok(!(0, timedSets_1.readHold)('').ok, 'an empty box is refused rather than logged as a hold of nothing');
    ok(!(0, timedSets_1.readHold)('4 5').ok, 'a fumbled figure is refused rather than parsed to 4');
    ok(!(0, timedSets_1.readHold)('0').ok, 'a hold of no seconds is not a hold');
    ok(!(0, timedSets_1.readHold)(String(timedSets_1.MAX_HOLD_SECONDS + 1)).ok, 'and 4500 for 45 is refused with a reason rather than recorded');
    const refused = (0, timedSets_1.readHold)('abc');
    ok(!refused.ok && /seconds/i.test(refused.reason), 'and the refusal says what to type instead');
}
/* ── NOT REPS ─────────────────────────────────────────────────────────────
 *
 * The whole point. A hold is out of every rep total and every rep record,
 * because 45 seconds is not 45 of anything.
 */
{
    const plank = { t: at('2026-06-02'), exercise: 'Plank', sets: [[45, 0], [40, 0]], timed: [true, true], bw: [true, true] };
    const pullup = { t: at('2026-06-02'), exercise: 'Pull-up', sets: [[12, 0]], bw: [true] };
    const reps = (0, bodyweightSets_1.repRecords)([plank, pullup]);
    eq(reps.length, 1, 'a plank does not appear on the reps board at all');
    eq(reps[0].exercise, 'Pull-up', 'and the twelve pull-ups are not outranked by a forty-five second hold');
    const outing = (0, exerciseHistory_1.exerciseOutings)([plank], 'Plank', HISTORY)[0];
    eq(outing.reps, 0, 'the day has no reps in it, because none were done');
    eq(outing.holdSeconds, 85, 'and eighty-five seconds of holding, which is the record of it');
    eq(outing.setCount, 2, 'both sets happened and both are counted as sets');
    eq(outing.timedSets, 2, 'and the outing says how many of them were holds');
    eq(outing.sets.length, 0, 'no held set is in the repped list, where a screen would print "45 ×"');
    eq(outing.holds.length, 2, 'they are in the holds list instead');
}
/* ── NOT TONNAGE ──────────────────────────────────────────────────────────
 *
 * A plate held for forty-five seconds is not four hundred and fifty
 * kilograms, and no total in this product may say it is.
 */
{
    const weighted = { t: at('2026-06-03'), exercise: 'Plank', sets: [[45, 10]], timed: [true] };
    const tonn = (0, bodyweightSets_1.entryTonnage)(weighted, HISTORY);
    eq(tonn.kg, 0, '45 seconds under 10 kg contributes no tonnage — seconds times kilograms is not a mass');
    eq(tonn.unknownSets, 0, 'and it is not counted as work the total could not price either: it is work the total is not about');
    const squats = { t: at('2026-06-03'), exercise: 'Back Squat', sets: [[5, 100]] };
    const week = (0, streaks_1.weekStats)([weighted, squats], Date.parse(at('2026-06-04')), HISTORY);
    eq(week.volumeKg, 500, "the week's tonnage is the squats and nothing else");
    eq(week.unpricedSets, 0, 'with nothing reported as missing from it');
}
/* ── NOT A 1RM ────────────────────────────────────────────────────────────
 *
 * Epley takes reps. Handed seconds it returns a strength figure computed from
 * a stopwatch, which would put a plank at the top of a records board.
 */
{
    const held = { t: at('2026-06-04'), exercise: 'Plank', sets: [[120, 20]], timed: [true] };
    const bench = { t: at('2026-06-04'), exercise: 'Bench Press', sets: [[5, 80]] };
    const prs = (0, streaks_1.personalRecords)([held, bench], HISTORY);
    eq(prs.length, 1, 'a hold sets no estimated one-rep max');
    eq(prs[0].exercise, 'Bench Press', 'so the bench is the record and a two-minute plank is not an 100 kg lift');
    const trail = (0, exerciseHistory_1.exerciseOutings)([held], 'Plank', HISTORY)[0];
    eq(trail.best1RMKg, null, 'and the movement trail has no estimate for it either');
    eq(trail.volumeKg, null, 'nor a tonnage — null, never a well-formed 0');
    eq(trail.topLoadKg, null, 'and no top load, which would be a load nobody repped');
}
/* ── THE HOLD BOARD ───────────────────────────────────────────────────────
 *
 * What a hold IS worth. Reps at bodyweight got its own board for the same
 * reason: the honest record of work that cannot be priced is the work.
 */
{
    const log = [
        { t: at('2026-05-01'), exercise: 'Plank', sets: [[60, 0]], timed: [true], bw: [true] },
        { t: at('2026-05-08'), exercise: 'Plank', sets: [[60, 10]], timed: [true], bw: [true] },
        { t: at('2026-05-15'), exercise: 'Plank', sets: [[90, 0]], timed: [true], bw: [true] },
        { t: at('2026-05-15'), exercise: 'Wall Sit', sets: [[45, 0]], timed: [true], bw: [true] },
        { t: at('2026-05-15'), exercise: 'Pull-up', sets: [[12, 0]], bw: [true] },
    ];
    const board = (0, timedSets_1.holdRecords)(log);
    eq(board.length, 2, 'one row per movement that was held, and nothing that was not');
    eq(board[0].exercise, 'Plank', 'longest first');
    eq(board[0].secs, 90, 'and it is the longest hold, not the heaviest');
    eq(board[1].exercise, 'Wall Sit', 'with the shorter movement behind it');
    const tied = (0, timedSets_1.holdRecords)([
        { t: at('2026-05-01'), exercise: 'Plank', sets: [[60, 0]], timed: [true] },
        { t: at('2026-05-02'), exercise: 'Plank', sets: [[60, 10]], timed: [true] },
    ]);
    eq(tied[0].loadKg, 10, 'a tie on seconds is broken by the load, so a belted hold is not shown as the same achievement');
    eq(tied.length, 1, 'and one movement keeps one row');
    eq((0, timedSets_1.entryHoldSeconds)(log[0]), 60, 'an entry knows how long it was held for');
    eq((0, timedSets_1.entryHoldSeconds)(log[4]), 0, 'and a set of pull-ups was held for no time at all, which is not a measurement');
}
/* ── HOW IT READS ─────────────────────────────────────────────────────────── */
{
    eq((0, timedSets_1.holdLabel)(45), '45 s', 'under a minute stays in seconds, which is how a hold is prescribed');
    eq((0, timedSets_1.holdLabel)(90), '1:30', 'and over one reads as a clock');
    eq((0, timedSets_1.holdLabel)(725), '12:05', 'with the seconds padded, so 12:05 is not shown as 12:5');
    eq((0, timedSets_1.timedSetLabel)(45, null, false), '45 s hold', 'a plain hold says what it was');
    eq((0, timedSets_1.timedSetLabel)(45, null, true), '45 s hold at bodyweight', 'a bodyweight hold says whose weight it was');
    eq((0, timedSets_1.timedSetLabel)(45, '10 kg', true), '45 s hold at bodyweight +10 kg', 'and a belted one distinguishes the plate from the person, which is the whole of why both flags exist');
    eq((0, timedSets_1.timedSetLabel)(45, '10 kg', false), '45 s hold with 10 kg', 'while a held dumbbell is just held');
}
/* ── ROUND TRIP ───────────────────────────────────────────────────────────
 *
 * `feel` and `zones` were both read back on the way in and silently dropped on
 * the way out for months. A flag that changes what a stored number MEANS is
 * the worst possible field to lose that way: the row survives and says
 * forty-five reps.
 */
{
    ok(workoutRow_1.PERSISTED_FIELDS.includes('timed'), 'the flag is on the list of fields that must survive a trip to the database');
    const e = { t: at('2026-06-05'), exercise: 'Plank', sets: [[45, 10]], timed: [true], bw: [true] };
    const back = (0, workoutRow_1.rowToEntry)((0, workoutRow_1.entryToRow)('user-1', e));
    eq(JSON.stringify(back.timed), JSON.stringify([true]), 'and it survives one');
    const row = (0, workoutRow_1.entryToRow)('user-1', { t: at('2026-06-05'), exercise: 'Row', sets: [[10, 40]] });
    ok('timed' in row && row.timed === null, 'an absent flag is sent as null rather than omitted, so an edit can clear it');
    eq((0, workoutRow_1.rowToEntry)({ performed_at: at('2026-06-05'), exercise: 'Row', sets: [[10, 40]] }).timed, undefined, 'and a row from before the column reads back as nobody having been asked');
}
/* ── how a SAVED set reads back ────────────────────────────────────────────
 *
 * The draft chip knew. The saved row did not: a plank the app itself asked for
 * in seconds came back as "45×— kg", which is forty-five repetitions of nothing
 * on the member's own record — and on the coach's.
 */
{
    // The caller's own renderer: kilograms as written, and an em-dash for a
    // figure there is none of, which is this app's convention.
    const lbl = (kg) => (kg == null ? '—' : String(kg));
    const plank = { t: '2026-03-01T09:00:00.000Z', exercise: 'Plank', sets: [[45, 0]], timed: [true] };
    eq((0, timedSets_1.setChipLabel)(plank, 0, lbl, 'kg'), '45 s', 'a hold is a clock, not "45×—"');
    ok(!(0, timedSets_1.setChipLabel)(plank, 0, lbl, 'kg').includes('×'), 'and carries no multiplication sign at all');
    ok(!(0, timedSets_1.setChipLabel)(plank, 0, lbl, 'kg').includes('—'), 'nor a dash implying a missing weight');
    const longHold = { t: '2026-03-01T09:00:00.000Z', exercise: 'Plank', sets: [[90, 0]], timed: [true] };
    eq((0, timedSets_1.setChipLabel)(longHold, 0, lbl, 'kg'), '1:30', 'past a minute it reads as a clock');
    const weighted = { t: '2026-03-01T09:00:00.000Z', exercise: 'Plank', sets: [[45, 10]], timed: [true] };
    eq((0, timedSets_1.setChipLabel)(weighted, 0, lbl, 'kg'), '45 s × 10 kg', 'a load on a hold is what was held on top, stated beside the time');
    const lift = { t: '2026-03-01T09:00:00.000Z', exercise: 'Bench', sets: [[8, 60]] };
    eq((0, timedSets_1.setChipLabel)(lift, 0, lbl, 'kg'), '8×60 kg', 'a lift is unchanged');
    // This assertion used to read `'8×— kg'`, "a set with no load still shows the
    // dash it always did" — over a fixture named `bwLift`, of a PULL-UP, carrying
    // `bw: [true]`. The dash is the right answer to a set nobody described, and
    // this is not one: the member said the load was their own body, which is a
    // recorded load and not a missing one. The old line pinned the defect it was
    // describing, and the two functions below it had no `bw` to consult even had
    // they wanted to.
    const bwLift = { t: '2026-03-01T09:00:00.000Z', exercise: 'Pull-up', sets: [[8, 0]], bw: [true] };
    eq((0, timedSets_1.setChipLabel)(bwLift, 0, lbl, 'kg'), '8 reps at bodyweight', 'a pull-up is a pull-up, not a bar with a weight nobody wrote down');
    // The dash survives where it is still true: the same two numbers with nobody
    // having said what they mean.
    const unsaid = { t: '2026-03-01T09:00:00.000Z', exercise: 'Bench', sets: [[8, 0]] };
    eq((0, timedSets_1.setChipLabel)(unsaid, 0, lbl, 'kg'), '8×— kg', 'and a set with no load still shows the dash it always did');
    // The strip: unit once, and only when something on the line is a load.
    const mixed = {
        t: '2026-03-01T09:00:00.000Z', exercise: 'Circuit',
        sets: [[8, 60], [45, 0], [8, 60]], timed: [false, true, false],
    };
    eq((0, timedSets_1.setListLabel)(mixed, lbl, 'kg'), '8×60  45 s  8×60 kg', 'the hold sits in the line as a clock');
    const allHolds = {
        t: '2026-03-01T09:00:00.000Z', exercise: 'Plank', sets: [[45, 0], [60, 0]], timed: [true, true],
    };
    eq((0, timedSets_1.setListLabel)(allHolds, lbl, 'kg'), '45 s  1:00', 'an entry of nothing but holds does not end in a unit it never used');
    eq((0, timedSets_1.setListLabel)({ sets: [] }, lbl, 'kg'), '', 'no sets is no line');
    // The whole point, stated as the thing that must not come back.
    for (const e of [plank, weighted, allHolds]) {
        for (let i = 0; i < (e.sets?.length ?? 0); i++) {
            ok(!/^\d+×/.test((0, timedSets_1.setChipLabel)(e, i, lbl, 'kg')), 'no hold anywhere reads as a rep count times a weight');
        }
    }
}
/* ── a bodyweight set is never a bar figure ───────────────────────────────── */
{
    const lbl = (kg) => (kg == null ? '—' : String(kg));
    //
    // The same split this file already closed for holds, one flag over. The DRAFT
    // chips in app/(client)/workouts.tsx branch on `s.bw` and print "8 reps at
    // bodyweight"; the two functions above rendering a SAVED entry took only
    // `sets` and `timed`, so the moment a pull-up was saved it came back as
    // "8×— kg" — a bar that was not there, carrying a load nobody recorded, six
    // inches from the draft chip that had said it correctly. `lastTime` escapes it
    // by going through `bestSetLabel`, which has taken `bodyweight` all along.
    const pullUp = { sets: [[8, 0]], bw: [true] };
    const belted = { sets: [[8, 20]], bw: [true] };
    eq((0, timedSets_1.setChipLabel)(pullUp, 0, lbl, 'kg'), '8 reps at bodyweight', 'a set the person said was their own body is not a bar with a missing weight on it');
    ok(!(0, timedSets_1.setChipLabel)(pullUp, 0, lbl, 'kg').includes('—'), 'and carries no dash, which would claim nobody recorded the load');
    ok(!(0, timedSets_1.setChipLabel)(pullUp, 0, lbl, 'kg').includes('×'), 'nor a multiplication sign, which is what makes it read as a bar figure');
    ok(!(0, timedSets_1.setChipLabel)(pullUp, 0, lbl, 'kg').endsWith('kg'), 'and no trailing unit over a set with no kilograms in it');
    eq((0, timedSets_1.setChipLabel)(belted, 0, lbl, 'kg'), '8 reps at bodyweight +20 kg', 'a belt is what was ADDED to the body, never presented as the whole of the load');
    // The ordinary set with an empty load box is untouched, and must be: a stored
    // 0 with no `bw` beside it is genuinely ambiguous — the person hung off a bar,
    // or the box was left empty by accident — and the dash is the honest answer to
    // that. This is the line the fix must not cross.
    eq((0, timedSets_1.setChipLabel)({ sets: [[8, 0]] }, 0, lbl, 'kg'), '8×— kg', 'without the flag the dash stays, because an unrecorded load is not a claim about anybody’s body');
    // A hold the person said was at bodyweight, with a plate on their back.
    const weightedPlank = { sets: [[45, 10]], timed: [true], bw: [true] };
    eq((0, timedSets_1.setChipLabel)(weightedPlank, 0, lbl, 'kg'), '45 s at bodyweight +10 kg', 'ten kilos on somebody’s back is a clause, not the load — HoldRecord.bodyweight asks for exactly this');
    ok(!(0, timedSets_1.setChipLabel)(weightedPlank, 0, lbl, 'kg').includes('×'), 'and never "45 s × 10 kg", which prices the plate as the whole of it');
    // The strip, where the unit is stated once at the end.
    eq((0, timedSets_1.setListLabel)({ sets: [[8, 0], [8, 0]], bw: [true, true] }, lbl, 'kg'), '8 reps at bodyweight  8 reps at bodyweight', 'an all-bodyweight line carries no trailing unit — there are no kilograms on it to name');
    ok(!(0, timedSets_1.setListLabel)({ sets: [[8, 0]], bw: [true] }, lbl, 'kg').includes('—'), 'and no dash anywhere on it');
    eq((0, timedSets_1.setListLabel)({ sets: [[8, 60], [8, 0]], bw: [false, true] }, lbl, 'kg'), '8×60  8 reps at bodyweight kg', 'a mixed line still names the unit once, for the barbell set that has one');
    eq((0, timedSets_1.setListLabel)({ sets: [[8, 20]], bw: [true] }, lbl, 'kg'), '8 reps at bodyweight +20 kg', 'the added load brings its own unit with it rather than collecting one at the end');
    // The sweep at the bottom of this file checks no hold starts "45×". The same
    // sweep, for the other flag: no bodyweight set may start with a bar figure.
    for (const e of [pullUp, belted, weightedPlank]) {
        for (let i = 0; i < e.sets.length; i++) {
            ok(!/×—/.test((0, timedSets_1.setChipLabel)(e, i, lbl, 'kg')), 'no bodyweight set is ever printed with a bar and a missing weight');
        }
    }
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('timedSets.test.ts ok');
