// "Tuesdays 7am to 7pm", said once. See the header of availabilityRange.ts for
// why the availability table was empty before this existed.
import {
  rangeSlotCount, rangeBlocker, expandRange, remainderNote,
  splitAgainstExisting, addButtonLabel, rangeSummary, addOutcome,
  MAX_RANGE_SLOTS, MAX_DURATION_MIN, type RangeInput,
} from './availabilityRange';

const errors: string[] = [];
const ok = (c: boolean, msg: string) => { if (!c) errors.push(msg); };
const eq = <T,>(a: T, b: T, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const H = (h: number, m = 0) => h * 60 + m;
const base: RangeInput = { days: [2], fromMin: H(7), toMin: H(19), durationMin: 15 };

/* ── the whole point ────────────────────────────────────────────────────── */

eq(rangeSlotCount(base), 48, 'seven to seven in quarters is forty-eight slots on one day');
{
  const s = expandRange(base);
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
eq(rangeSlotCount({ days: [1], fromMin: H(7), toMin: H(8), durationMin: 45 }), 1,
  'an hour fits one 45-minute session, not two');
eq(remainderNote({ days: [1], fromMin: H(7), toMin: H(8), durationMin: 45 })!.includes('07:45'),
  true, 'and the unused quarter-hour is named rather than left as a puzzle');
eq(remainderNote(base), null, 'a range that divides exactly says nothing');

/* ── several days at once ───────────────────────────────────────────────── */

{
  const wk: RangeInput = { days: [1, 3, 5], fromMin: H(9), toMin: H(12), durationMin: 60 };
  eq(rangeSlotCount(wk), 9, 'three hours on three days at an hour each is nine');
  const s = expandRange(wk);
  eq(s.length, 9, 'and nine come out');
  // Ordered the way a person reads a week, so the confirmation list is scannable.
  ok(s[0].dow === 1 && s[3].dow === 3 && s[6].dow === 5, 'grouped by day, in day order');
  ok(s[0].hour === 9 && s[1].hour === 10 && s[2].hour === 11, 'and in time order inside each day');
}

// A day listed twice is one day. A chip a coach taps twice must not double
// their week.
eq(rangeSlotCount({ ...base, days: [2, 2, 2] }), 48, 'a repeated day is still one day');

/* ── gaps ───────────────────────────────────────────────────────────────── */

{
  const g: RangeInput = { days: [1], fromMin: H(9), toMin: H(12), durationMin: 50, gapMin: 10 };
  eq(rangeSlotCount(g), 3, 'fifty-minute sessions with ten-minute gaps fit three into three hours');
  const s = expandRange(g);
  eq(s[1].hour, 10, 'the second starts an hour after the first');
  eq(s[1].minute, 0, 'on the hour, because 50 + 10 is 60');
}

/* ── the refusals, each naming its number ───────────────────────────────── */

eq(rangeBlocker(base), null, 'an ordinary range is allowed');
ok(rangeBlocker({ ...base, days: [] })!.includes('at least one day'), 'no days is refused');

// Never silently swapped. A coach who typed 19:00→07:00 may have meant an
// overnight; reversing it would hand them twelve hours they did not offer.
{
  const back = rangeBlocker({ ...base, fromMin: H(19), toMin: H(7) })!;
  ok(back.includes('07:00') && back.includes('19:00'), 'a backwards range names both times');
  ok(back.includes('past midnight'), 'and says why it is not simply reversed');
}
eq(expandRange({ ...base, fromMin: H(19), toMin: H(7) }).length, 0,
  'and a refused range expands to nothing rather than to something wrong');

ok(rangeBlocker({ ...base, fromMin: H(7), toMin: H(7, 10), durationMin: 15 })!.includes('10 minutes'),
  'a range shorter than one session names how long it actually is');
ok(rangeBlocker({ ...base, durationMin: 0 })!.includes('how long'), 'a zero-length session is refused');
ok(rangeBlocker({ ...base, durationMin: MAX_DURATION_MIN + 1 })!.includes('end time in the length box'),
  'and an absurd length guesses at the mistake behind it');
ok(rangeBlocker({ ...base, toMin: H(24) + 1 })!.includes('inside one day'), 'past midnight is refused');
ok(rangeBlocker({ ...base, gapMin: -5 })!.includes('cannot be negative'), 'a negative gap is refused');

// The cap. Seven days of 07:00–19:00 in quarters is 336, which is past it.
{
  const huge: RangeInput = { days: [0, 1, 2, 3, 4, 5, 6], fromMin: H(7), toMin: H(19), durationMin: 15 };
  eq(rangeSlotCount(huge), 336, 'a full week of quarters is 336 slots');
  const b = rangeBlocker(huge)!;
  ok(b.includes('336'), 'the refusal says how many it would have been');
  ok(b.includes(String(MAX_RANGE_SLOTS)), 'and what the limit is');
  // The same week at half-hours is 168 and is allowed — the cap is about the
  // read cap on the table, not a judgement about working hours.
  eq(rangeBlocker({ ...huge, durationMin: 30 }), null, 'the same week at 30 minutes is fine');
}

/* ── re-entering times you already offer ────────────────────────────────── */

{
  // Extending Tuesday from 07:00–12:00 to 07:00–19:00 re-enters the morning by
  // definition. Refusing the range for it would make the obvious gesture fail.
  const existing = expandRange({ days: [2], fromMin: H(7), toMin: H(12), durationMin: 15 });
  const { fresh, duplicates } = splitAgainstExisting(expandRange(base), existing);
  eq(duplicates, 20, 'the morning already offered is counted');
  eq(fresh.length, 28, 'and only the afternoon is added');
  ok(fresh.every((f) => f.hour >= 12), 'nothing before noon is re-added');

  const sum = rangeSummary(base, fresh.length, duplicates)!;
  ok(sum.includes('20 of them you already offer'), 'and the summary says so before the coach presses anything');
  ok(sum.includes('left alone'), 'and that they are not touched');
}

{
  const all = expandRange(base);
  const { fresh, duplicates } = splitAgainstExisting(all, all);
  eq(fresh.length, 0, 'a range entirely already offered adds nothing');
  eq(duplicates, 48, 'and every one is counted as a duplicate');
  eq(addButtonLabel(0, 48), 'You already offer all of these', 'the button says so rather than "Add 0 slots"');
  ok(rangeSummary(base, 0, 48)!.includes('nothing would change'), 'and so does the summary');
}

/* ── the count is on the button ─────────────────────────────────────────── */

eq(addButtonLabel(48, 0), 'Add 48 slots', 'the number is a decision, not a surprise');
eq(addButtonLabel(1, 0), 'Add 1 slot', 'and one reads as English');
eq(addButtonLabel(0, 0), 'Nothing to add', 'and nothing reads as nothing');

/* ── what actually landed ───────────────────────────────────────────────── */

// The assertWrote rule: count what the server confirmed, never what was tried.
ok(addOutcome(48, 48, 0).includes('48 slots added'), 'a whole write says so');
ok(addOutcome(48, 48, 0).includes('Generate Open Slots'), 'and points at the step that makes them bookable');
{
  const partial = addOutcome(12, 48, 0);
  ok(partial.includes('12 slots added'), 'a partial write counts what landed');
  ok(partial.includes('36 could not be saved'), 'and says how many did not');
  ok(!partial.includes('48 slots added'), 'and never reports the number attempted as the number saved');
}
{
  const none = addOutcome(0, 48, 0);
  ok(none.includes('None of those 48'), 'a failed write says nothing was added');
  ok(none.includes('cannot book any of them'), 'and what that costs');
  ok(none.includes('not on this phone either'), 'and that it was not kept locally either');
}
ok(addOutcome(0, 0, 20).includes('nothing was changed'), 'an all-duplicate add is not reported as a failure');
ok(addOutcome(28, 28, 20).includes('20 you already offered'), 'and duplicates are mentioned beside a real add');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`availabilityRange: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('availabilityRange: ok — one stretch becomes many slots, the last one ends inside the range, and nothing claims a write the server did not confirm');
