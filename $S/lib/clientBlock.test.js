"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Which week of a block the client is shown, and the promise that none of the
// five phases can withhold a programme. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: a start date that quietly becomes a
// gate. `blockPosition` has a phase for a block that has not begun and a phase
// for one that has run out, and the obvious reading of both is "show nothing".
// Either one empties a Train tab — the first for a client whose coach dated the
// block for Monday, the second for a client whose coach is a week late writing
// the next one — and an empty Train tab is indistinguishable from a client who
// has no coach.
const clientBlock_1 = require("./clientBlock");
const programStart_1 = require("./programStart");
const programBlock_1 = require("./programBlock");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** A block of `n` weeks, built the way the builder builds one: through the one
 *  writer, so `days` and `weeks[0].days` cannot drift apart in the fixture. */
const block = (n) => {
    const base = { title: 'A block', focus: [], note: '', days: [{ day: 'Mon', focus: 'Push', exercises: [] }] };
    return (0, programBlock_1.withWeeks)(base, Array.from({ length: n }, (_, i) => ({
        days: [{ day: 'Mon', focus: `Push ${i + 1}`, exercises: [] }],
    })));
};
const at = (start, today, weeks) => (0, clientBlock_1.clientWeek)((0, programStart_1.blockPosition)(start, today, weeks), weeks);
/* ── a one-week programme is untouched by all of this ───────────────────── */
eq(at(null, '2026-09-01', 1), { index: 0, count: 1, reason: 'only-week' }, 'every programme written before blocks existed is one week, and is answered as one week');
eq(at('2026-01-01', '2026-09-01', 1), { index: 0, count: 1, reason: 'only-week' }, 'a start date on a one-week programme does not start it counting weeks that do not exist');
eq((0, clientBlock_1.clientWeekLine)(at('2026-01-01', '2026-09-01', 1), 0), null, 'and no week number is printed anywhere on it');
/* ── the week the date counts to ────────────────────────────────────────── */
eq(at('2026-09-01', '2026-09-01', 8).index, 0, 'the first day of the block is week one');
eq(at('2026-09-01', '2026-09-07', 8).index, 0, 'and so is the seventh day');
eq(at('2026-09-01', '2026-09-08', 8).index, 1, 'the eighth day is week two');
eq(at('2026-09-01', '2026-10-15', 8).reason, 'counted', 'a block in progress counts from the date');
eq(at('2026-09-01', '2026-10-15', 8).index, 6, 'and the seventh week of an eight week block is index six');
/* ── NONE of the five phases withholds a programme ──────────────────────── */
//
// The whole point of this file. Each of these is a day on which a client opens
// Train, and every one of them has to resolve to a week of real training days.
const phases = [
    { name: 'no date at all', w: at(null, '2026-09-01', 8) },
    { name: 'a date this build cannot read', w: at('the 3rd', '2026-09-01', 8) },
    { name: 'a block dated to start next week', w: at('2026-09-08', '2026-09-01', 8) },
    { name: 'a block in progress', w: at('2026-09-01', '2026-09-15', 8) },
    { name: 'a block whose last week has passed', w: at('2026-01-01', '2026-09-01', 8) },
];
for (const p of phases) {
    ok(p.w.index >= 0 && p.w.index < p.w.count, `${p.name} lands on a real week of the block`);
    ok(p.w.count === 8, `${p.name} still knows the block is eight weeks`);
}
eq(at(null, '2026-09-01', 8), { index: 0, count: 8, reason: 'no-date' }, 'no start date is week one, which is what every assignment in this app has always shown');
eq(at('the 3rd', '2026-09-01', 8), { index: 0, count: 8, reason: 'unreadable' }, 'and an unreadable one is week one too, reported as its own reason rather than folded into the first');
eq(at('2026-09-08', '2026-09-01', 8), { index: 0, count: 8, reason: 'not-started' }, 'a block dated for next week is trainable NOW, on week one — the date does not hold it back');
eq(at('2026-01-01', '2026-09-01', 8), { index: 7, count: 8, reason: 'ended' }, 'and a block that has run out stays on its last week rather than emptying the tab');
/* ── the week index can never fall off the end of the block ─────────────── */
//
// `pos.week` is arithmetic on a date and the programme can be edited between
// the two calls. An index past the end renders an empty training day over a
// programme that is not empty, which reads exactly like a rest day nobody
// scheduled.
{
    // A position computed against a twelve week block, then handed a programme
    // that has since been cut to three.
    const stale = (0, programStart_1.blockPosition)('2026-09-01', '2026-11-10', 12);
    eq(stale.week, 11, 'the position itself says week eleven');
    const w = (0, clientBlock_1.clientWeek)(stale, 3);
    eq(w.index, 2, 'but against a three week block it is clamped to the last week that exists');
    ok(w.index < (0, programBlock_1.programWeeks)(block(3)).length, 'which is inside the block');
}
eq((0, clientBlock_1.clientWeek)((0, programStart_1.blockPosition)('2026-09-01', '2026-09-15', 8), 0).count, 1, 'a block claiming no weeks at all is one week, never zero');
/* ── the sentence ───────────────────────────────────────────────────────── */
{
    const w = at('2026-09-01', '2026-09-15', 8);
    const line = (0, clientBlock_1.clientWeekLine)(w, w.index) ?? '';
    ok(/week 3 of 8/i.test(line), 'the counted line names the week and the length of the block');
    ok(!/wait|locked|not yet/i.test(line), 'and nothing in it suggests anything is being withheld');
}
{
    const w = at('2026-09-08', '2026-09-01', 8);
    const line = (0, clientBlock_1.clientWeekLine)(w, w.index) ?? '';
    ok(/nothing to wait for/i.test(line), 'a block dated for later says out loud that week one is already theirs');
}
{
    const w = at('2026-01-01', '2026-09-01', 8);
    const line = (0, clientBlock_1.clientWeekLine)(w, w.index) ?? '';
    ok(/last week of this block has passed/i.test(line), 'a finished block says so');
    ok(/week 8 of 8/i.test(line), 'and names the week it is leaving on screen');
}
{
    const w = at('the 3rd', '2026-09-01', 8);
    const line = (0, clientBlock_1.clientWeekLine)(w, w.index) ?? '';
    ok(/cannot read/i.test(line) && /week one/i.test(line), 'an unreadable date says both what happened and what is on screen because of it');
}
{
    // Reading ahead. The client tapped week six while their coach has them on
    // week two, and the line must say which is which without implying either that
    // they have been moved on or that they are behind.
    const w = at('2026-09-01', '2026-09-08', 8);
    const line = (0, clientBlock_1.clientWeekLine)(w, 5) ?? '';
    ok(/looking at week 6 of 8/i.test(line), 'the line names the week being read');
    ok(/on week 2/i.test(line), 'and the week that is actually theirs');
}
/* ── the days that come back are the ones the coach wrote for that week ─── */
//
// The index is only worth anything if it selects the right week out of the one
// reader, so this walks the whole join rather than trusting the number.
{
    const p = block(4);
    const weeks = (0, programBlock_1.programWeeks)(p);
    eq(weeks.length, 4, 'the fixture is a four week block');
    const w = (0, clientBlock_1.clientWeek)((0, programStart_1.blockPosition)('2026-09-01', '2026-09-22', 4), weeks.length);
    eq(w.index, 3, 'the twenty-second of September is week four of a block started on the first');
    eq(weeks[w.index].days[0].focus, 'Push 4', 'and the days on screen are week four’s, not week one’s');
    eq(weeks[0].days[0].focus, p.days[0].focus, 'while week one is still `days`, which is what a phone that has not been updated renders');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('clientBlock: ok — five phases, five real weeks, no branch that empties a Train tab');
