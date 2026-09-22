// Timetable slots, and the clock they are bucketed on.
//
// ── What these assertions are guarding ────────────────────────────────────
//
//   · the bucket is the GYM's hour, not the reader's — the same defect
//     `gymWeekday`'s own header describes, where a Gulf gym's 06:00 class lands
//     in a London owner's 02:00 bucket and the fill rate is then taken over the
//     wrong set of classes;
//   · a class that cannot be placed on that clock is COUNTED and reported,
//     never dropped into a bucket and never dropped silently — at a gym with no
//     timezone set that is every class, and "no slots" must not read as "no
//     classes";
//   · a fill rate is over the same rows on both sides, which is the scar
//     `summariseClassRows` carries and is how "Avg Fill 117%" reached an owner;
//   · a slot nothing is known about sorts LAST, not first, because a list
//     headed by its emptiest entries would otherwise open with a verdict about
//     a slot that has no fill rate at all;
//   · and a class with nothing ticked is reported as "booked and none marked
//     present", which is what the table says — not as "nobody came", which it
//     cannot tell apart from a register the coach did not take.
//
// The zones are chosen so the assertions cannot pass by accident: every run of
// `npm test` goes through six of them (`test:zones`), including Kiritimati at
// +14 and Midway at −11, so anything that quietly read the reader's clock would
// fail in at least one.
import {
  classSlots, rankSlots, slotLabelFor, unplacedNote,
  type ClassSlot, type SlotBreakdown,
} from './classSlots';
import type { ClassSummaryRow } from './classRates';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(a === b, `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

let n = 0;
function row(startsAt: string, o: Partial<ClassSummaryRow> = {}): ClassSummaryRow {
  n += 1;
  return {
    classId: `c${n}`, title: 'Spin', kind: 'spin', branch: 'Main',
    trainerId: 't1', trainerName: 'Sam', startsAt,
    capacity: 20, booked: 10, attended: 8,
    ...o,
  } as ClassSummaryRow;
}

const DUBAI = 'Asia/Dubai';     // UTC+4, no DST
const LONDON = 'Europe/London'; // UTC+0/+1

/* ── the bucket is the gym's hour, not the reader's ──────────────────────── */
{
  // 02:00 UTC on Tuesday 2 September 2025 is 06:00 Tuesday in Dubai and
  // 03:00 Tuesday in London (BST). Same instant, two different slots.
  const at = '2025-09-02T02:00:00.000Z';
  const dubai = classSlots([row(at)], DUBAI);
  eq(dubai.slots.length, 1, 'one class makes one slot');
  eq(dubai.slots[0].hour, 6, "the Dubai gym's 06:00 class is in the 06:00 bucket");
  eq(dubai.slots[0].label, 'Tue 06:00', 'and is labelled with the gym’s own weekday and hour');
  eq(dubai.unplaced, 0, 'and nothing is unplaced');

  const london = classSlots([row(at)], LONDON);
  eq(london.slots[0].hour, 3, 'the same instant at a London gym is a different hour');
  ok(dubai.slots[0].hour !== london.slots[0].hour,
    'which is the whole point: the bucket follows the GYM, not the instant and not the reader');

  // Across midnight AT THE GYM the weekday moves too. 21:00 UTC Monday is
  // 01:00 TUESDAY in Dubai.
  const late = classSlots([row('2025-09-01T21:00:00.000Z')], DUBAI);
  eq(late.slots[0].label, 'Tue 01:00',
    'a class after midnight at the gym is on the gym’s next day, not the reader’s same day');
}

/* ── the same wall-clock slot folds together across the range ────────────── */
{
  // Three Tuesday 18:00 classes in Dubai, three weeks running.
  const rows = [
    row('2025-09-02T14:00:00.000Z'),
    row('2025-09-09T14:00:00.000Z'),
    row('2025-09-16T14:00:00.000Z'),
    // and one Thursday 07:00, which must not join them
    row('2025-09-04T03:00:00.000Z', { booked: 4, attended: 4 }),
  ];
  const b = classSlots(rows, DUBAI);
  eq(b.slots.length, 2, 'two distinct slots');
  const tue = b.slots.find((s) => s.label === 'Tue 18:00')!;
  ok(!!tue, 'the recurring Tuesday evening is one slot, not three');
  eq(tue.classes, 3, 'with all three weeks folded into it');
  eq(tue.booked, 30, 'bookings add up across the weeks');
  eq(tue.attended, 24, 'and so does attendance');
  eq(b.classes, 4, 'every row was considered');
}

/* ── an 18:00 and an 18:15 are one slot; 18:00 and 19:00 are two ────────── */
{
  const b = classSlots([
    row('2025-09-02T14:00:00.000Z'),   // 18:00 Dubai
    row('2025-09-02T14:15:00.000Z'),   // 18:15 Dubai
    row('2025-09-02T15:00:00.000Z'),   // 19:00 Dubai
  ], DUBAI);
  eq(b.slots.length, 2, 'the bucket is the hour — 18:00 and 18:15 are one evening slot');
  eq(b.slots.find((s) => s.label === 'Tue 18:00')!.classes, 2, 'both of them in it');
  eq(b.slots.find((s) => s.label === 'Tue 19:00')!.classes, 1, 'and the 19:00 on its own');
}

/* ── the fill rate is over the same rows on both sides ───────────────────── */
{
  // Twelve of twelve, nine of twelve, and seven bookings on a class that never
  // recorded a capacity. This is the exact set that produced "Avg Fill 117%".
  const b = classSlots([
    row('2025-09-02T14:00:00.000Z', { capacity: 12, booked: 12 }),
    row('2025-09-09T14:00:00.000Z', { capacity: 12, booked: 9 }),
    row('2025-09-16T14:00:00.000Z', { capacity: 0, booked: 7 }),
  ], DUBAI);
  const s = b.slots[0];
  eq(s.classes, 3, 'all three classes are in the slot');
  eq(s.capacity, 24, 'the denominator is only the rows that recorded a capacity');
  eq(s.bookedOfPriced, 21, 'and so is its numerator');
  eq(s.booked, 28, 'while total bookings still counts every class');
  eq(s.fill, 21 / 24, 'so the fill rate is 87.5%…');
  ok(s.fill! <= 1, '…and cannot exceed 100%, which is what the bug did');
}

/* ── no capacity recorded anywhere is null, and null is not zero ─────────── */
{
  const b = classSlots([
    row('2025-09-02T14:00:00.000Z', { capacity: 0, booked: 8 }),
  ], DUBAI);
  eq(b.slots[0].fill, null,
    'a slot where nothing recorded what it could hold has NO fill rate — a 0 here '
    + 'would read as a class nobody booked, and eight people booked it');
  eq(b.slots[0].booked, 8, 'the bookings are still true and are still stated');
}

/* ── a class that cannot be placed is counted, never bucketed ────────────── */
{
  const rows = [row('2025-09-02T14:00:00.000Z'), row('2025-09-09T14:00:00.000Z')];

  const noZone = classSlots(rows, null);
  eq(noZone.slots.length, 0, 'with no zone there are no slots…');
  eq(noZone.unplaced, 2, '…and every class is reported as unplaced, not as absent');
  eq(noZone.classes, 2, 'the classes are still counted');

  eq(classSlots(rows, '').unplaced, 2, 'a blank zone is not a zone');
  eq(classSlots(rows, '   ').unplaced, 2, 'nor is whitespace');
  eq(classSlots(rows, 'Not/AZone').unplaced, 2,
    'nor is a stored string this runtime cannot resolve — which must never fall back to the device');

  const mixed = classSlots([
    row('2025-09-02T14:00:00.000Z'),
    row('not a date'),
  ], DUBAI);
  eq(mixed.slots.length, 1, 'a good row is still placed');
  eq(mixed.unplaced, 1, 'and an unreadable start time is counted rather than dropped');
  eq(mixed.slots[0].classes, 1, 'the unplaceable one is NOT in the bucket');
  eq(mixed.slots.reduce((a, s) => a + s.classes, 0), mixed.classes - mixed.unplaced,
    'the slots always sum to the classes that could be placed');
}

/* ── booked with nothing ticked ──────────────────────────────────────────── */
{
  const b = classSlots([
    row('2025-09-02T14:00:00.000Z', { booked: 10, attended: 0 }),
    row('2025-09-09T14:00:00.000Z', { booked: 10, attended: 9 }),
    // Nobody booked it either. That is not "booked and none present" — there
    // was nothing to be present for, and counting it would inflate the figure
    // with classes that simply did not sell.
    row('2025-09-16T14:00:00.000Z', { booked: 0, attended: 0 }),
  ], DUBAI);
  eq(b.noPresent, 1, 'one class had bookings and nobody marked present');
  eq(b.slots[0].noPresent, 1, 'and the slot says which slot it was in');

  // Counted over EVERY row, placed or not: whether a register was taken has
  // nothing to do with whether the clock could be read.
  const unread = classSlots([row('2025-09-02T14:00:00.000Z', { booked: 10, attended: 0 })], null);
  eq(unread.unplaced, 1, 'the class could not be placed…');
  eq(unread.noPresent, 1, '…and the untaken register is still reported');
}

/* ── the order an owner reads them in ────────────────────────────────────── */
{
  const mk = (label: string, fill: number | null, booked: number): ClassSlot => ({
    weekday: 2, hour: 18, label, classes: 1, capacity: 10,
    bookedOfPriced: booked, booked, attended: 0, fill, noPresent: 0,
  });
  const out = rankSlots([
    mk('full', 1, 20),
    mk('unknown', null, 5),
    mk('empty', 0.2, 4),
    mk('empty-busier', 0.2, 30),
  ]);
  eq(out[0].label, 'empty-busier',
    'emptiest first, and of two equally empty slots the one with more people to move');
  eq(out[1].label, 'empty', 'then the quieter one at the same fill');
  eq(out[2].label, 'full', 'then the full slot, which needs no decision');
  eq(out[3].label, 'unknown',
    'and a slot with NO fill rate sorts last — it is not the emptiest, it is the '
    + 'one nothing is known about, and heading the list with it would read as a verdict');

  // Stable: the same input in a different order comes out the same way.
  const again = rankSlots([mk('unknown', null, 5), mk('empty', 0.2, 4), mk('empty-busier', 0.2, 30), mk('full', 1, 20)]);
  eq(again.map((s) => s.label).join(','), out.map((s) => s.label).join(','),
    'the order does not depend on the order the Map happened to hold');
}

/* ── the label is keyed by getDay() value, not by column ─────────────────── */
{
  // 2025-09-02 is a Tuesday; getUTCDay() === 2.
  eq(slotLabelFor(2, 18), 'Tue 18:00', 'a getDay value of 2 is Tuesday');
  eq(slotLabelFor(0, 9), 'Sun 09:00', 'and 0 is Sunday');
  eq(slotLabelFor(6, 7), 'Sat 07:00', 'and 6 is Saturday');
  ok(slotLabelFor(2, 6).startsWith(
    classSlots([row('2025-09-02T02:00:00.000Z')], DUBAI).slots[0].label.slice(0, 3)),
    'and the label the aggregator builds agrees with the one built by hand');
  eq(slotLabelFor(3, 0), 'Wed 00:00', 'midnight is 00:00, not 0:00 or 24:00');
}

/* ── the three silences behind an unplaced count ─────────────────────────── */
{
  const none: SlotBreakdown = { slots: [], unplaced: 0, noPresent: 0, classes: 0 };
  eq(unplacedNote(none, DUBAI, false), null, 'nothing unplaced says nothing');

  const two: SlotBreakdown = { slots: [], unplaced: 2, noPresent: 0, classes: 2 };

  const unread = unplacedNote(two, null, true)!;
  ok(unread.includes('could not be read'), 'a refused zone read says the read failed');
  ok(!unread.includes('has not set'),
    'and does NOT send the owner to change a setting that may already be right');

  const unset = unplacedNote(two, null, false)!;
  ok(unset.includes('has not set a timezone'), 'a gym that has not set one is told so');
  ok(unset.includes('Operations'), 'and told where to set it');

  const bad = unplacedNote(two, DUBAI, false)!;
  ok(!bad.includes('timezone'),
    'a gym whose clock IS known is not told about its timezone — the problem is in those rows');
  ok(bad.includes('start times'), 'and is told what it actually is');

  const one: SlotBreakdown = { slots: [], unplaced: 1, noPresent: 0, classes: 1 };
  ok(unplacedNote(one, DUBAI, false)!.includes('1 class '),
    'one is "1 class", singular, not "1 classes"');
  ok(unplacedNote(two, DUBAI, false)!.includes('2 classes'), 'and two is plural');
}

/* ── nothing in, nothing claimed ─────────────────────────────────────────── */
{
  const b = classSlots([], DUBAI);
  eq(b.slots.length, 0, 'no rows make no slots');
  eq(b.unplaced, 0, 'and nothing is unplaced');
  eq(b.classes, 0, 'and no classes are claimed');
  eq(classSlots(null, DUBAI).classes, 0, 'a null list is the same as an empty one here — '
    + 'the CALLER is what keeps "not read yet" apart from "nothing ran"');
  eq(classSlots(undefined, DUBAI).unplaced, 0, 'and so is undefined');
}

if (errors.length) {
  console.error(`classSlots.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('classSlots.test.ts — ok');
