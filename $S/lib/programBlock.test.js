"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Multi-week programmes, and the invariant that keeps a client's phone and
// their coach's screen showing the same session. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: `Program.days` is what the SHIPPED
// client app renders. It knows nothing about weeks and cannot be taught
// anything tonight. So a block written without keeping `days` in step is a
// coach editing week four while their client trains week one, with nothing
// anywhere saying which is which — and a shallow copy of a week is a coach
// editing week five and silently rewriting week four as well.
const programBlock_1 = require("./programBlock");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const day = (name, exercise, sets = 3) => ({
    day: name, focus: 'Push',
    exercises: [{ key: 'k', name: exercise, group: 'Chest', sets, reps: '8-10', alternatives: [] }],
});
/** A programme exactly as every row in `program_templates` and
 *  `assigned_programs` holds one today: one week, no `weeks` key at all. */
const oneWeek = { title: 'Push Pull Legs', focus: [], note: '', days: [day('Mon', 'Bench Press')] };
/* ── absent means exactly what it meant before ──────────────────────────── */
// THE assertion of this file. Every programme in all three stores has no
// `weeks`, and each of them is a genuine one-week programme rather than a
// broken block. Nothing may render a week number for one.
eq((0, programBlock_1.weekCount)(oneWeek), 1, 'a programme with no weeks is one week long, which is what it is');
eq((0, programBlock_1.programWeeks)(oneWeek).length, 1, 'and resolves to a single week');
eq((0, programBlock_1.programWeeks)(oneWeek)[0].days, oneWeek.days, 'built from `days`, which is week one');
ok(!(0, programBlock_1.isBlock)(oneWeek), 'it is not a block, so no screen draws a week strip for it');
// A null programme has NO weeks rather than one empty one. Zero is the honest
// answer — there is no programme — and the screens that need a denominator
// (`blockPosition` in src/lib/programStart.ts) floor it at one themselves so a
// block cannot read as finished on the day it started.
eq((0, programBlock_1.weekCount)(null), 0, 'a null programme has no weeks rather than one imaginary one');
eq((0, programBlock_1.programWeeks)(null), [], 'though it has no weeks to list');
ok(!(0, programBlock_1.weeksDisagree)(oneWeek), 'and there is nothing for it to disagree with');
/* ── growing a block, and the copy that must be deep ────────────────────── */
const two = (0, programBlock_1.addWeek)(oneWeek);
eq((0, programBlock_1.weekCount)(two), 2, 'adding a week makes two');
ok((0, programBlock_1.isBlock)(two), 'and that is a block');
eq(two.days, oneWeek.days, 'week one is untouched — the client goes on training what they were training');
eq((0, programBlock_1.programWeeks)(two)[1].days[0].exercises[0].name, 'Bench Press', 'the new week is a COPY of the last one, not a blank week nobody would fill in');
// THE most damaging bug this feature can have, and the one that is invisible
// until a client reports that their whole block changed at once.
const edited = (0, programBlock_1.setWeekDays)(two, 1, [day('Mon', 'Incline Press')]);
eq(edited.days[0].exercises[0].name, 'Bench Press', 'editing week two does not reach week one — the copy is deep, not a shared reference');
eq((0, programBlock_1.programWeeks)(edited)[1].days[0].exercises[0].name, 'Incline Press', 'and week two is what was written');
// Editing week ONE moves `days`, because `days` IS week one and the client app
// renders it.
const w1 = (0, programBlock_1.setWeekDays)(two, 0, [day('Mon', 'Floor Press')]);
eq(w1.days[0].exercises[0].name, 'Floor Press', 'editing week one moves `days`');
eq((0, programBlock_1.programWeeks)(w1)[0].days[0].exercises[0].name, 'Floor Press', 'and the two agree');
ok(!(0, programBlock_1.weeksDisagree)(w1), 'which is the invariant, checked rather than assumed');
/* ── the ceiling, and a control that is hidden rather than dead ─────────── */
let long = oneWeek;
for (let i = 1; i < programBlock_1.MAX_WEEKS; i++)
    long = (0, programBlock_1.addWeek)(long);
eq((0, programBlock_1.weekCount)(long), programBlock_1.MAX_WEEKS, 'a block grows to the ceiling');
ok(!(0, programBlock_1.canAddWeek)(long), 'and then the control is hidden');
eq((0, programBlock_1.weekCount)((0, programBlock_1.addWeek)(long)), programBlock_1.MAX_WEEKS, 'a stray second tap is a no-op rather than a thirteenth week');
ok((0, programBlock_1.canAddWeek)(oneWeek), 'a one-week programme can always gain one');
// Belt behind that brace: a programme arriving from a future build with thirty
// weeks in it renders as twelve rather than as a screen that will not open.
const many = (0, programBlock_1.withWeeks)(oneWeek, Array.from({ length: 30 }, () => ({ days: [day('Mon', 'Row')] })));
eq((0, programBlock_1.weekCount)(many), programBlock_1.MAX_WEEKS, 'more weeks than the ceiling are truncated, not refused');
/* ── shrinking, and the two things that must not happen ─────────────────── */
const backToOne = (0, programBlock_1.removeWeek)(two, 1);
eq((0, programBlock_1.weekCount)(backToOne), 1, 'removing the second week leaves one');
eq('weeks' in backToOne, false, 'and drops the `weeks` key entirely, so the result is byte-identical to a programme that never had one');
eq(backToOne.days, two.days, 'with week one still week one');
eq((0, programBlock_1.weekCount)((0, programBlock_1.removeWeek)(oneWeek, 0)), 1, 'the last remaining week is not removable — a programme of no weeks is a Train tab with nothing on it');
eq((0, programBlock_1.weekCount)((0, programBlock_1.removeWeek)(two, 9)), 2, 'and an index off the end removes nothing');
// Removing week ONE is allowed and it moves what the client trains. That is a
// real change to somebody's next session, so the SCREEN confirms it; this
// function performs it faithfully rather than quietly refusing.
const dropFirst = (0, programBlock_1.removeWeek)(edited, 0);
eq(dropFirst.days[0].exercises[0].name, 'Incline Press', 'removing week one promotes week two, and `days` follows it');
/* ── an empty block is refused rather than written ──────────────────────── */
eq((0, programBlock_1.withWeeks)(two, []), two, 'a block of no weeks is not a lighter programme and is refused');
/* ── labels: the coach’s words, or the position, which is always true ───── */
eq((0, programBlock_1.weekLabel)({}, 3), 'Week 3', 'an unlabelled week is named by where it is');
eq((0, programBlock_1.weekLabel)({ label: 'Accumulation' }, 2), 'Accumulation', 'a labelled one keeps the coach’s word');
eq((0, programBlock_1.weekLabel)({ deload: true }, 4), 'Week 4 · Deload', 'a deload says so in WORDS — colour is never the only channel carrying meaning');
eq((0, programBlock_1.weekLabel)({ label: 'Deload week', deload: true }, 4), 'Deload week', 'and is not said twice when the coach already said it');
// A deload is a FLAG the coach sets, never inferred from volume: most blocks
// ramp volume and drop intensity, and a light week may be a client travelling.
const flagged = (0, programBlock_1.patchWeek)(two, 1, { deload: true });
ok((0, programBlock_1.programWeeks)(flagged)[1].deload === true, 'the coach marks a deload');
ok((0, programBlock_1.programWeeks)((0, programBlock_1.addWeek)(flagged))[2].deload !== true, 'and adding a week after one does not copy the flag — nobody deloads twice in a row by accident');
ok(!(0, programBlock_1.programWeeks)((0, programBlock_1.addWeek)((0, programBlock_1.patchWeek)(two, 1, { label: 'Peak' })))[2].label, 'nor does it copy the label, which would name a week something the coach never typed');
eq((0, programBlock_1.blockLine)(oneWeek), 'One week.', 'a one-week programme says so');
eq((0, programBlock_1.blockLine)(two), '2 weeks.', 'a block says how many');
eq((0, programBlock_1.blockLine)(flagged), '2 weeks, one of them a deload.', 'and names the deloads it carries');
/* ── the fingerprint, and the false-alarm it must not raise ─────────────── */
// Stands in for `daySignature` in src/lib/groupProgram.ts. It has to include
// the MOVEMENT, not just the shape of the week: two weeks with one exercise
// each are not the same week because they both have one exercise, and a
// fingerprint that thought so would report a coach's edit as no change at all.
const sig = (days) => days.map((d) => `${d.day}:${d.exercises.map((e) => e.name).join('+')}`).join(',');
// THE reason `weeksSignaturePart` returns null for a one-week programme. Every
// group's plan and every client's assignment is one week today; a signature
// that changed shape for all of them would have reported every member of every
// group as 'diverged' on the morning this shipped.
eq((0, programBlock_1.weeksSignaturePart)(oneWeek, sig), null, 'a one-week programme adds NOTHING to its fingerprint, so it fingerprints exactly as it did before this file existed');
ok((0, programBlock_1.weeksSignaturePart)(two, sig) != null, 'a block adds its later weeks');
ok((0, programBlock_1.weeksSignaturePart)(two, sig) !== (0, programBlock_1.weeksSignaturePart)(edited, sig), 'and two blocks that differ only in week two do not fingerprint the same');
ok((0, programBlock_1.weeksSignaturePart)(flagged, sig) !== (0, programBlock_1.weeksSignaturePart)(two, sig), 'a deload marked is a different block from the same weeks unmarked');
/* ── `days` wins where a stored block disagrees with it ─────────────────── */
// A jsonb column can hold anything any build ever wrote. Where the two differ,
// `days` is what the CLIENT is actually training, so a coach's screen showing
// them anything else would be describing a week nobody is doing.
const inconsistent = {
    ...oneWeek,
    weeks: [{ days: [day('Mon', 'Something Else')] }, { days: [day('Tue', 'Row')] }],
};
eq((0, programBlock_1.programWeeks)(inconsistent)[0].days[0].exercises[0].name, 'Bench Press', '`days` answers for week one whatever the stored block says');
ok((0, programBlock_1.weeksDisagree)(inconsistent), 'and the disagreement is reportable rather than silently preferred');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('programBlock: ok — `days` is week one, the copy is deep, and a one-week programme is unchanged in every respect');
