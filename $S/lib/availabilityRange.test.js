"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// "Tuesdays 7am to 7pm", said once. See the header of availabilityRange.ts for
// why the availability table was empty before this existed.
const availabilityRange_1 = require("./availabilityRange");
const errors = [];
const ok = (c, msg) => { if (!c)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const H = (h, m = 0) => h * 60 + m;
const base = { days: [2], fromMin: H(7), toMin: H(19), durationMin: 15 };
/* ── the whole point ────────────────────────────────────────────────────── */
eq((0, availabilityRange_1.rangeSlotCount)(base), 48, 'seven to seven in quarters is forty-eight slots on one day');
{
    const s = (0, availabilityRange_1.expandRange)(base);
    eq(s.length, 48, 'and forty-eight is what comes out');
    eq(s[0].hour, 7, 'the first starts at seven');
    eq(s[0].minute, 0, 'on the hour');
    eq(s[47].hour, 18, 'and the last starts at 18:45');
    eq(s[47].minute, 45, 'so it ENDS at 19:00 and not after it');
    ok(s.every((x) => x.dow === 2 && x.dur === 15), 'every slot carries the day and the length asked for');
}
/* ── the last slot must END inside the range ────────────────────────────── */
// The off-by-one that would have a coach available until 09:30 when they said
// 08:00. Counting step boundaries gives 2; counting whole sessions gives 1.
eq((0, availabilityRange_1.rangeSlotCount)({ days: [1], fromMin: H(7), toMin: H(8), durationMin: 45 }), 1, 'an hour fits one 45-minute session, not two');
eq((0, availabilityRange_1.remainderNote)({ days: [1], fromMin: H(7), toMin: H(8), durationMin: 45 }).includes('07:45'), true, 'and the unused quarter-hour is named rather than left as a puzzle');
eq((0, availabilityRange_1.remainderNote)(base), null, 'a range that divides exactly says nothing');
/* ── several days at once ───────────────────────────────────────────────── */
{
    const wk = { days: [1, 3, 5], fromMin: H(9), toMin: H(12), durationMin: 60 };
    eq((0, availabilityRange_1.rangeSlotCount)(wk), 9, 'three hours on three days at an hour each is nine');
    const s = (0, availabilityRange_1.expandRange)(wk);
    eq(s.length, 9, 'and nine come out');
    // Ordered the way a person reads a week, so the confirmation list is scannable.
    ok(s[0].dow === 1 && s[3].dow === 3 && s[6].dow === 5, 'grouped by day, in day order');
    ok(s[0].hour === 9 && s[1].hour === 10 && s[2].hour === 11, 'and in time order inside each day');
}
// A day listed twice is one day. A chip a coach taps twice must not double
// their week.
eq((0, availabilityRange_1.rangeSlotCount)({ ...base, days: [2, 2, 2] }), 48, 'a repeated day is still one day');
/* ── gaps ───────────────────────────────────────────────────────────────── */
{
    const g = { days: [1], fromMin: H(9), toMin: H(12), durationMin: 50, gapMin: 10 };
    eq((0, availabilityRange_1.rangeSlotCount)(g), 3, 'fifty-minute sessions with ten-minute gaps fit three into three hours');
    const s = (0, availabilityRange_1.expandRange)(g);
    eq(s[1].hour, 10, 'the second starts an hour after the first');
    eq(s[1].minute, 0, 'on the hour, because 50 + 10 is 60');
}
/* ── the refusals, each naming its number ───────────────────────────────── */
eq((0, availabilityRange_1.rangeBlocker)(base), null, 'an ordinary range is allowed');
ok((0, availabilityRange_1.rangeBlocker)({ ...base, days: [] }).includes('at least one day'), 'no days is refused');
// Never silently swapped. A coach who typed 19:00→07:00 may have meant an
// overnight; reversing it would hand them twelve hours they did not offer.
{
    const back = (0, availabilityRange_1.rangeBlocker)({ ...base, fromMin: H(19), toMin: H(7) });
    ok(back.includes('07:00') && back.includes('19:00'), 'a backwards range names both times');
    ok(back.includes('past midnight'), 'and says why it is not simply reversed');
}
eq((0, availabilityRange_1.expandRange)({ ...base, fromMin: H(19), toMin: H(7) }).length, 0, 'and a refused range expands to nothing rather than to something wrong');
ok((0, availabilityRange_1.rangeBlocker)({ ...base, fromMin: H(7), toMin: H(7, 10), durationMin: 15 }).includes('10 minutes'), 'a range shorter than one session names how long it actually is');
ok((0, availabilityRange_1.rangeBlocker)({ ...base, durationMin: 0 }).includes('how long'), 'a zero-length session is refused');
ok((0, availabilityRange_1.rangeBlocker)({ ...base, durationMin: availabilityRange_1.MAX_DURATION_MIN + 1 }).includes('end time in the length box'), 'and an absurd length guesses at the mistake behind it');
ok((0, availabilityRange_1.rangeBlocker)({ ...base, toMin: H(24) + 1 }).includes('inside one day'), 'past midnight is refused');
ok((0, availabilityRange_1.rangeBlocker)({ ...base, gapMin: -5 }).includes('cannot be negative'), 'a negative gap is refused');
// The cap, which an earlier version of this file got wrong in the direction
// that matters: it refused seven days of 07:00-19:00 in quarter-hours, which is
// 336 slots and an entirely ordinary thing for a busy coach to offer.
{
    const huge = { days: [0, 1, 2, 3, 4, 5, 6], fromMin: H(7), toMin: H(19), durationMin: 15 };
    eq((0, availabilityRange_1.rangeSlotCount)(huge), 336, 'a full week of 07:00-19:00 quarters is 336 slots');
    eq((0, availabilityRange_1.rangeBlocker)(huge), null, 'and it is ALLOWED — this is a real week, not an abuse');
    eq((0, availabilityRange_1.expandRange)(huge).length, 336, 'and all 336 come out');
    // The true physical maximum, and the invariant that keeps the cap honest: if
    // anybody ever lowers MAX_WEEK_SLOTS below what a week can hold, this goes red
    // rather than a coach discovering it.
    eq(availabilityRange_1.LARGEST_POSSIBLE_WEEK, 672, 'seven days of 24h in quarters is 672 slots');
    ok(availabilityRange_1.LARGEST_POSSIBLE_WEEK < availabilityRange_1.MAX_WEEK_SLOTS, 'the largest week that can exist fits under the cap, so no legal combination is ever refused');
    const everything = { days: [0, 1, 2, 3, 4, 5, 6], fromMin: 0, toMin: H(24), durationMin: 15 };
    eq((0, availabilityRange_1.rangeSlotCount)(everything), availabilityRange_1.LARGEST_POSSIBLE_WEEK, 'and the widest possible range produces exactly that');
    eq((0, availabilityRange_1.rangeBlocker)(everything), null, 'which is still allowed');
    // The cap is on the WEEK, not on one gesture, so it counts what is held.
    ok((0, availabilityRange_1.rangeBlocker)(huge, 900).includes('1236'), 'a range on top of a nearly-full week names the total it would reach');
}
/* ── every combination a person can actually pick ───────────────────────────
 *
 * The bar is "any and every possible combination", so this sweeps the whole
 * control surface rather than sampling it: every day-set size, every quarter-
 * hour start, every quarter-hour end after it, and every session length the
 * sheet offers. Nothing in here may throw, and nothing that is a legal pick may
 * be refused for a reason other than not fitting one session.
 */
{
    const DURS = [15, 30, 45, 60, 90];
    const QUARTERS = [];
    for (let m = 0; m <= 24 * 60; m += 15)
        QUARTERS.push(m);
    let checked = 0;
    let refusedForFit = 0;
    const unexpected = [];
    for (const dayCount of [1, 3, 7]) {
        const days = [0, 1, 2, 3, 4, 5, 6].slice(0, dayCount);
        for (const from of QUARTERS) {
            for (const to of QUARTERS) {
                if (to <= from)
                    continue;
                for (const dur of DURS) {
                    checked++;
                    const r = { days, fromMin: from, toMin: to, durationMin: dur };
                    let b;
                    try {
                        b = (0, availabilityRange_1.rangeBlocker)(r);
                    }
                    catch (e) {
                        unexpected.push(`threw on ${HHMM_(from)}-${HHMM_(to)}/${dur}: ${String(e)}`);
                        continue;
                    }
                    if (b === null) {
                        // A permitted range must produce at least one slot, every slot must
                        // end inside the window, and the count must agree with the list.
                        const slots = (0, availabilityRange_1.expandRange)(r);
                        if (slots.length === 0) {
                            unexpected.push(`allowed but produced nothing: ${HHMM_(from)}-${HHMM_(to)}/${dur} x${dayCount}`);
                            continue;
                        }
                        if (slots.length !== (0, availabilityRange_1.rangeSlotCount)(r)) {
                            unexpected.push(`count disagreed with list: ${HHMM_(from)}-${HHMM_(to)}/${dur}`);
                            continue;
                        }
                        for (const sl of slots) {
                            const start = sl.hour * 60 + sl.minute;
                            if (start < from || start + dur > to) {
                                unexpected.push(`slot outside the window: ${HHMM_(from)}-${HHMM_(to)}/${dur} produced ${HHMM_(start)}`);
                                break;
                            }
                        }
                    }
                    else if (/not long enough for one/.test(b)) {
                        // The only legitimate refusal in this sweep: the window is shorter
                        // than one session. Everything else would be a bug.
                        refusedForFit++;
                        if (to - from >= dur)
                            unexpected.push(`refused for fit but ${to - from} >= ${dur}: ${HHMM_(from)}-${HHMM_(to)}`);
                    }
                    else {
                        unexpected.push(`refused for an unexpected reason (${HHMM_(from)}-${HHMM_(to)}/${dur} x${dayCount}): ${b}`);
                    }
                }
            }
        }
    }
    ok(checked > 60000, `the sweep is exhaustive — checked ${checked} combinations`);
    ok(refusedForFit > 0, 'and some windows really are too short for one session');
    eq(unexpected.slice(0, 3).join(' | '), '', `every day/time/length combination behaves — ${unexpected.length} did not`);
}
function HHMM_(min) {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
/* ── re-entering times you already offer ────────────────────────────────── */
{
    // Extending Tuesday from 07:00–12:00 to 07:00–19:00 re-enters the morning by
    // definition. Refusing the range for it would make the obvious gesture fail.
    const existing = (0, availabilityRange_1.expandRange)({ days: [2], fromMin: H(7), toMin: H(12), durationMin: 15 });
    const { fresh, duplicates } = (0, availabilityRange_1.splitAgainstExisting)((0, availabilityRange_1.expandRange)(base), existing);
    eq(duplicates, 20, 'the morning already offered is counted');
    eq(fresh.length, 28, 'and only the afternoon is added');
    ok(fresh.every((f) => f.hour >= 12), 'nothing before noon is re-added');
    const sum = (0, availabilityRange_1.rangeSummary)(base, fresh.length, duplicates);
    ok(sum.includes('20 of them you already offer'), 'and the summary says so before the coach presses anything');
    ok(sum.includes('left alone'), 'and that they are not touched');
}
{
    const all = (0, availabilityRange_1.expandRange)(base);
    const { fresh, duplicates } = (0, availabilityRange_1.splitAgainstExisting)(all, all);
    eq(fresh.length, 0, 'a range entirely already offered adds nothing');
    eq(duplicates, 48, 'and every one is counted as a duplicate');
    eq((0, availabilityRange_1.addButtonLabel)(0, 48), 'You already offer all of these', 'the button says so rather than "Add 0 slots"');
    ok((0, availabilityRange_1.rangeSummary)(base, 0, 48).includes('nothing would change'), 'and so does the summary');
}
/* ── the count is on the button ─────────────────────────────────────────── */
eq((0, availabilityRange_1.addButtonLabel)(48, 0), 'Add 48 slots', 'the number is a decision, not a surprise');
eq((0, availabilityRange_1.addButtonLabel)(1, 0), 'Add 1 slot', 'and one reads as English');
eq((0, availabilityRange_1.addButtonLabel)(0, 0), 'Nothing to add', 'and nothing reads as nothing');
/* ── what actually landed ───────────────────────────────────────────────── */
// The assertWrote rule: count what the server confirmed, never what was tried.
ok((0, availabilityRange_1.addOutcome)(48, 48, 0).includes('48 slots added'), 'a whole write says so');
ok((0, availabilityRange_1.addOutcome)(48, 48, 0).includes('Generate Open Slots'), 'and points at the step that makes them bookable');
{
    const partial = (0, availabilityRange_1.addOutcome)(12, 48, 0);
    ok(partial.includes('12 slots added'), 'a partial write counts what landed');
    ok(partial.includes('36 could not be saved'), 'and says how many did not');
    ok(!partial.includes('48 slots added'), 'and never reports the number attempted as the number saved');
}
{
    const none = (0, availabilityRange_1.addOutcome)(0, 48, 0);
    ok(none.includes('None of those 48'), 'a failed write says nothing was added');
    ok(none.includes('cannot book any of them'), 'and what that costs');
    ok(none.includes('not on this phone either'), 'and that it was not kept locally either');
}
ok((0, availabilityRange_1.addOutcome)(0, 0, 20).includes('nothing was changed'), 'an all-duplicate add is not reported as a failure');
ok((0, availabilityRange_1.addOutcome)(28, 28, 20).includes('20 you already offered'), 'and duplicates are mentioned beside a real add');
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`availabilityRange: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('availabilityRange: ok — one stretch becomes many slots, the last one ends inside the range, and nothing claims a write the server did not confirm');
