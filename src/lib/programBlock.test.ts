// Multi-week programmes, and the invariant that keeps a client's phone and
// their coach's screen showing the same session. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: `Program.days` is what the SHIPPED
// client app renders. It knows nothing about weeks and cannot be taught
// anything tonight. So a block written without keeping `days` in step is a
// coach editing week four while their client trains week one, with nothing
// anywhere saying which is which — and a shallow copy of a week is a coach
// editing week five and silently rewriting week four as well.
import {
  MAX_WEEKS, addWeek, blockLine, canAddWeek, isBlock, patchWeek, programWeeks,
  removeWeek, setWeekDays, weekCount, weekLabel, weeksDisagree, weeksSignaturePart, withWeeks,
} from './programBlock';
import type { Program, ProgramDay } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const day = (name: string, exercise: string, sets = 3): ProgramDay => ({
  day: name, focus: 'Push',
  exercises: [{ key: 'k', name: exercise, group: 'Chest', sets, reps: '8-10', alternatives: [] }],
});

/** A programme exactly as every row in `program_templates` and
 *  `assigned_programs` holds one today: one week, no `weeks` key at all. */
const oneWeek: Program = { title: 'Push Pull Legs', focus: [], note: '', days: [day('Mon', 'Bench Press')] };

/* ── absent means exactly what it meant before ──────────────────────────── */

// THE assertion of this file. Every programme in all three stores has no
// `weeks`, and each of them is a genuine one-week programme rather than a
// broken block. Nothing may render a week number for one.
eq(weekCount(oneWeek), 1, 'a programme with no weeks is one week long, which is what it is');
eq(programWeeks(oneWeek).length, 1, 'and resolves to a single week');
eq(programWeeks(oneWeek)[0].days, oneWeek.days, 'built from `days`, which is week one');
ok(!isBlock(oneWeek), 'it is not a block, so no screen draws a week strip for it');
// A null programme has NO weeks rather than one empty one. Zero is the honest
// answer — there is no programme — and the screens that need a denominator
// (`blockPosition` in src/lib/programStart.ts) floor it at one themselves so a
// block cannot read as finished on the day it started.
eq(weekCount(null), 0, 'a null programme has no weeks rather than one imaginary one');
eq(programWeeks(null), [], 'though it has no weeks to list');
ok(!weeksDisagree(oneWeek), 'and there is nothing for it to disagree with');

/* ── growing a block, and the copy that must be deep ────────────────────── */

const two = addWeek(oneWeek);
eq(weekCount(two), 2, 'adding a week makes two');
ok(isBlock(two), 'and that is a block');
eq(two.days, oneWeek.days, 'week one is untouched — the client goes on training what they were training');
eq(programWeeks(two)[1].days[0].exercises[0].name, 'Bench Press',
  'the new week is a COPY of the last one, not a blank week nobody would fill in');

// THE most damaging bug this feature can have, and the one that is invisible
// until a client reports that their whole block changed at once.
const edited = setWeekDays(two, 1, [day('Mon', 'Incline Press')]);
eq(edited.days[0].exercises[0].name, 'Bench Press',
  'editing week two does not reach week one — the copy is deep, not a shared reference');
eq(programWeeks(edited)[1].days[0].exercises[0].name, 'Incline Press', 'and week two is what was written');

// Editing week ONE moves `days`, because `days` IS week one and the client app
// renders it.
const w1 = setWeekDays(two, 0, [day('Mon', 'Floor Press')]);
eq(w1.days[0].exercises[0].name, 'Floor Press', 'editing week one moves `days`');
eq(programWeeks(w1)[0].days[0].exercises[0].name, 'Floor Press', 'and the two agree');
ok(!weeksDisagree(w1), 'which is the invariant, checked rather than assumed');

/* ── the ceiling, and a control that is hidden rather than dead ─────────── */

let long: Program = oneWeek;
for (let i = 1; i < MAX_WEEKS; i++) long = addWeek(long);
eq(weekCount(long), MAX_WEEKS, 'a block grows to the ceiling');
ok(!canAddWeek(long), 'and then the control is hidden');
eq(weekCount(addWeek(long)), MAX_WEEKS, 'a stray second tap is a no-op rather than a thirteenth week');
ok(canAddWeek(oneWeek), 'a one-week programme can always gain one');

// Belt behind that brace: a programme arriving from a future build with thirty
// weeks in it renders as twelve rather than as a screen that will not open.
const many = withWeeks(oneWeek, Array.from({ length: 30 }, () => ({ days: [day('Mon', 'Row')] })));
eq(weekCount(many), MAX_WEEKS, 'more weeks than the ceiling are truncated, not refused');

/* ── shrinking, and the two things that must not happen ─────────────────── */

const backToOne = removeWeek(two, 1);
eq(weekCount(backToOne), 1, 'removing the second week leaves one');
eq('weeks' in backToOne, false,
  'and drops the `weeks` key entirely, so the result is byte-identical to a programme that never had one');
eq(backToOne.days, two.days, 'with week one still week one');

eq(weekCount(removeWeek(oneWeek, 0)), 1,
  'the last remaining week is not removable — a programme of no weeks is a Train tab with nothing on it');
eq(weekCount(removeWeek(two, 9)), 2, 'and an index off the end removes nothing');

// Removing week ONE is allowed and it moves what the client trains. That is a
// real change to somebody's next session, so the SCREEN confirms it; this
// function performs it faithfully rather than quietly refusing.
const dropFirst = removeWeek(edited, 0);
eq(dropFirst.days[0].exercises[0].name, 'Incline Press',
  'removing week one promotes week two, and `days` follows it');

/* ── an empty block is refused rather than written ──────────────────────── */

eq(withWeeks(two, []), two, 'a block of no weeks is not a lighter programme and is refused');

/* ── labels: the coach’s words, or the position, which is always true ───── */

eq(weekLabel({}, 3), 'Week 3', 'an unlabelled week is named by where it is');
eq(weekLabel({ label: 'Accumulation' }, 2), 'Accumulation', 'a labelled one keeps the coach’s word');
eq(weekLabel({ deload: true }, 4), 'Week 4 · Deload',
  'a deload says so in WORDS — colour is never the only channel carrying meaning');
eq(weekLabel({ label: 'Deload week', deload: true }, 4), 'Deload week',
  'and is not said twice when the coach already said it');

// A deload is a FLAG the coach sets, never inferred from volume: most blocks
// ramp volume and drop intensity, and a light week may be a client travelling.
const flagged = patchWeek(two, 1, { deload: true });
ok(programWeeks(flagged)[1].deload === true, 'the coach marks a deload');
ok(programWeeks(addWeek(flagged))[2].deload !== true,
  'and adding a week after one does not copy the flag — nobody deloads twice in a row by accident');
ok(!programWeeks(addWeek(patchWeek(two, 1, { label: 'Peak' })))[2].label,
  'nor does it copy the label, which would name a week something the coach never typed');

eq(blockLine(oneWeek), 'One week.', 'a one-week programme says so');
eq(blockLine(two), '2 weeks.', 'a block says how many');
eq(blockLine(flagged), '2 weeks, one of them a deload.', 'and names the deloads it carries');

/* ── the fingerprint, and the false-alarm it must not raise ─────────────── */

// Stands in for `daySignature` in src/lib/groupProgram.ts. It has to include
// the MOVEMENT, not just the shape of the week: two weeks with one exercise
// each are not the same week because they both have one exercise, and a
// fingerprint that thought so would report a coach's edit as no change at all.
const sig = (days: ProgramDay[]) =>
  days.map((d) => `${d.day}:${d.exercises.map((e) => e.name).join('+')}`).join(',');

// THE reason `weeksSignaturePart` returns null for a one-week programme. Every
// group's plan and every client's assignment is one week today; a signature
// that changed shape for all of them would have reported every member of every
// group as 'diverged' on the morning this shipped.
eq(weeksSignaturePart(oneWeek, sig), null,
  'a one-week programme adds NOTHING to its fingerprint, so it fingerprints exactly as it did before this file existed');
ok(weeksSignaturePart(two, sig) != null, 'a block adds its later weeks');
ok(weeksSignaturePart(two, sig) !== weeksSignaturePart(edited, sig),
  'and two blocks that differ only in week two do not fingerprint the same');
ok(weeksSignaturePart(flagged, sig) !== weeksSignaturePart(two, sig),
  'a deload marked is a different block from the same weeks unmarked');

/* ── `days` wins where a stored block disagrees with it ─────────────────── */

// A jsonb column can hold anything any build ever wrote. Where the two differ,
// `days` is what the CLIENT is actually training, so a coach's screen showing
// them anything else would be describing a week nobody is doing.
const inconsistent: Program = {
  ...oneWeek,
  weeks: [{ days: [day('Mon', 'Something Else')] }, { days: [day('Tue', 'Row')] }],
};
eq(programWeeks(inconsistent)[0].days[0].exercises[0].name, 'Bench Press',
  '`days` answers for week one whatever the stored block says');
ok(weeksDisagree(inconsistent), 'and the disagreement is reportable rather than silently preferred');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('programBlock: ok — `days` is week one, the copy is deep, and a one-week programme is unchanged in every respect');
