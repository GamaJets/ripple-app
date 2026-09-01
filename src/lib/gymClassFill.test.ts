// Tests for the class tally — the filter that never matched anything.
//
// `fetchClasses` counted a class's bookings like this:
//
//     if (b.status === 'cancelled') return;
//     booked.set(b.class_id, (booked.get(b.class_id) ?? 0) + 1);
//
// `class_bookings.status` is `check (status in ('booked','waitlist'))`
// (supabase/parts/02-domain-schema.sql). There is no 'cancelled' and there
// never has been: `cancel_class` DELETES the row and promotes the next person
// waiting. So the guard matched zero rows on every class in the product, and
// every waitlister was added to `booked` — the numerator of fill rate and the
// denominator of show rate.
//
// The damage is worst exactly where a gym is doing well. A class of 12 with 5
// waiting reported 17 booked: fill 142%, show attended ÷ 17. /classes then
// printed a banner over the top of it saying "it is a real over-sell, not a
// rounding artefact" — a sentence written to reassure an owner that an
// implausible number was real, on top of a number that was not.
//
// Nothing could catch it before: the filter lived inside a function that makes
// two paginated Supabase reads, so there was nothing to call. `tallyBookings`
// is that logic with the database taken out, which is the only reason these
// assertions can exist.
//
// Compile with tsc then run with node, like wroteRows.test.ts.
import { tallyBookings, summariseAttendance, type BookingRow, type GymClass } from './gymSchedule';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (status: string, attended = false): BookingRow =>
  ({ class_id: 'c1', status, attended_at: attended ? '2026-09-01T06:05:00.000Z' : null });

/* ── the bug itself ───────────────────────────────────────────────────────── */

// The exact shape that was wrong: an oversubscribed class. Twelve places sold,
// five people waiting. Anything that answers 17 here is the old behaviour.
{
  const t = tallyBookings([
    ...Array.from({ length: 12 }, () => row('booked')),
    ...Array.from({ length: 5 }, () => row('waitlist')),
  ]);
  eq(t.booked.get('c1'), 12, 'places SOLD is the booked rows alone — a waitlister has not been sold a place');
  eq(t.waitlisted.get('c1'), 5, 'and the people waiting are counted, not discarded: that is demand the gym did not sell');
}

// The filter that was there. A row with a status the constraint forbids must
// not become a place sold by default — the old code's failure mode was exactly
// "anything I do not recognise is a booking".
{
  const t = tallyBookings([row('booked'), row('cancelled'), row('no_show'), row('')]);
  eq(t.booked.get('c1'), 1, 'an unrecognised status is neither sold nor waiting — matched positively, so a widened constraint fails safe');
  eq(t.waitlisted.get('c1'), undefined, 'and it is certainly not a waitlister either');
}

/* ── attendance belongs to the status it was recorded against ─────────────── */

// The register lists every booking whatever its status and the tick is one
// button, so a waitlister let in at the door does get marked present. That
// person is real and must be counted — but not inside `attended`, which is the
// numerator of attended ÷ booked. A rate that can exceed its own denominator
// is not a rate.
{
  const t = tallyBookings([
    row('booked', true), row('booked', true), row('booked'),
    row('waitlist', true), row('waitlist'),
  ]);
  eq(t.booked.get('c1'), 3, 'three places sold');
  eq(t.attended.get('c1'), 2, 'two of the sold places turned up');
  eq(t.waitlistAttended.get('c1'), 1, 'the waitlister who was let in is counted, in her own column');
  ok((t.attended.get('c1') ?? 0) <= (t.booked.get('c1') ?? 0),
    'attended can never exceed booked — the property that makes show rate a rate');
}

/* ── the rates the screens draw ───────────────────────────────────────────── */

const cls = (o: Partial<GymClass> = {}): GymClass => ({
  id: 'c1', title: 'Spin', room: null, instructor: null, trainerId: null,
  startsAt: '2026-09-01T06:00:00.000Z', durationMin: 45, capacity: 12,
  booked: 12, attended: 9, waitlisted: 5, waitlistAttended: 0, ...o,
});

{
  const s = summariseAttendance([cls()]);
  eq(s.fillRate, 1, 'a full class is 100% full, not 142% — the number an owner was shown');
  eq(s.showRate, 0.75, 'show rate divides by the places sold, so it is 9 of 12 rather than 9 of 17');
  eq(s.waitlisted, 5, 'the waiting list is reported alongside rather than folded into fill');
}

// Two classes, one oversubscribed and one half empty, so the summary is not
// just the single-row case restated.
{
  const s = summariseAttendance([
    cls({ id: 'a', capacity: 10, booked: 10, attended: 8, waitlisted: 4, waitlistAttended: 2 }),
    cls({ id: 'b', capacity: 10, booked: 4, attended: 1, waitlisted: 0, waitlistAttended: 0 }),
  ]);
  eq(s.fillRate, 0.7, '14 places sold across 20 of capacity');
  eq(s.showRate, 9 / 14, 'nine of the fourteen sold places walked in');
  eq(s.waitlistAttended, 2, 'and the two waitlisters who got in are still on the record');
  ok(s.fillRate !== null && s.fillRate <= 1,
    'with waitlisters out of the numerator, a fill rate over 100% now means a genuine over-sell');
}

// The two silences the summary already refused to fill, re-asserted because
// this change touches the same maths: no bookings is not a 0% show rate, and no
// capacity recorded is not a 0% fill.
{
  const none = summariseAttendance([]);
  eq(none.showRate, null, 'no classes means no show rate, not 0%');
  eq(none.fillRate, null, 'and no fill rate either');
  eq(none.waitlisted, 0, 'but no waiting list is genuinely zero people waiting');

  const unsized = summariseAttendance([cls({ capacity: 0, booked: 3, attended: 3, waitlisted: 0 })]);
  eq(unsized.fillRate, null, 'a class with no capacity recorded has no fill rate — it does not get one from its bookings');
  eq(unsized.showRate, 1, 'its show rate is still perfectly well defined');
}

if (errors.length) {
  console.error(`gymClassFill.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('gymClassFill.test.ts — ok');
