// Sessions somebody paid for, and whether there is time left to take them.
// Compile with tsc, run with node.
//
// src/lib/packExpiry.ts already says when a pack ends. What nothing said is
// whether the member is going to lose any of it — which needs their diary as
// well as the date, and which is the question they actually have when they read
// the deadline. A pack that lapses with sessions on it is money that
// evaporates, and packExpiry's own header calls it "a conversation, not a
// zero": the coach's half of that conversation exists (`strandedNote`), and the
// member's half told them the date and left them to do the arithmetic.
import { packDeadline, bookedBy } from './packDeadline';
import { EXPIRING_SOON_DAYS } from './packExpiry';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-03';
/** `d` days after TODAY, as the bare day a pack expires on. */
const inDays = (d: number): string => {
  const x = new Date(Date.UTC(2026, 8, 3 + d));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};

/* ── the states that belong to packExpiry, not here ────────────────────── */

// One pack, one narrator. Every state below is one `expiryLine` already says,
// and a second sentence about it is how two modules start disagreeing.
eq(packDeadline({ left: 4, expiresOn: null, today: TODAY, bookedByThen: 0 }).kind, 'silent',
  'a pack with no window has no deadline to miss');
eq(packDeadline({ left: 4, expiresOn: inDays(200), today: TODAY, bookedByThen: 0 }).kind, 'silent',
  'a window two hundred days out is not news');
eq(packDeadline({ left: 0, expiresOn: inDays(3), today: TODAY, bookedByThen: 0 }).kind, 'silent',
  'a spent pack running out costs nobody anything');
eq(packDeadline({ left: 4, expiresOn: inDays(-1), today: TODAY, bookedByThen: 0 }).kind, 'silent',
  'a window that has already closed belongs to expiryLine, which says what was lost');
eq(packDeadline({ left: 4, expiresOn: 'not a date', today: TODAY, bookedByThen: 0 }).kind, 'silent',
  'a date that will not read expires nothing');
// The boundary is packExpiry's, not a second copy of it.
eq(packDeadline({ left: 4, expiresOn: inDays(EXPIRING_SOON_DAYS - 1), today: TODAY, bookedByThen: 0 }).kind, 'toBook',
  'inside the shared soon-window this speaks');
eq(packDeadline({ left: 4, expiresOn: inDays(EXPIRING_SOON_DAYS + 1), today: TODAY, bookedByThen: 0 }).kind, 'silent',
  'outside it, it does not');

/* ── the answer somebody wanted ────────────────────────────────────────── */

const covered = packDeadline({ left: 3, expiresOn: inDays(9), today: TODAY, bookedByThen: 3 });
eq(covered.kind, 'covered', 'every session already booked is covered');
eq(covered.toBook, 0, 'and nothing is left to book');
ok(!covered.urgent, 'a member who has already booked everything is not warned about it');
ok(/Nothing here is going to be lost/.test(covered.text ?? ''), 'and is told so plainly');
// More booked than are on the pack — a member who booked ahead and will draw
// from something else. Still covered, never a negative.
const over = packDeadline({ left: 2, expiresOn: inDays(9), today: TODAY, bookedByThen: 5 });
eq(over.kind, 'covered', 'more bookings than sessions is still covered');
eq(over.toBook, 0, 'and never a negative number to book');

/* ── the nudge ─────────────────────────────────────────────────────────── */

const nudge = packDeadline({ left: 4, expiresOn: inDays(8), today: TODAY, bookedByThen: 1 });
eq(nudge.kind, 'toBook', 'three unbooked sessions in nine days is a nudge');
eq(nudge.toBook, 3, 'and it counts the ones still to book, not the ones on the pack');
ok(nudge.urgent, 'which is worth a mark');
ok(/11 Sep 2026/.test(nudge.text ?? ''), 'the day is named, because "9 days left" is a figure somebody has to convert');
ok(/about one every 3 days/.test(nudge.text ?? ''), 'and the cadence is worked out so nobody has to');
ok(/not refunded/.test(nudge.text ?? ''), 'and what happens if they do not is said out loud');

// One a day reads as a phrase, not as "one every 1 days".
ok(/about one a day/.test(packDeadline({ left: 4, expiresOn: inDays(3), today: TODAY, bookedByThen: 0 }).text ?? ''),
  'four in four days is about one a day');
// Comfortably spaced: the cadence clause is dropped rather than padded out.
const roomy = packDeadline({ left: 2, expiresOn: inDays(13), today: TODAY, bookedByThen: 0 });
eq(roomy.kind, 'toBook', 'two in a fortnight is still worth saying');
ok(!/about one every/.test(roomy.text ?? ''), 'but not with a cadence nobody needs');

/* ── the one that is not a nudge ───────────────────────────────────────── */

const tight = packDeadline({ left: 5, expiresOn: inDays(2), today: TODAY, bookedByThen: 0 });
eq(tight.kind, 'tight', 'five sessions and three days is not something a calendar solves');
ok(tight.urgent, 'and it is urgent');
ok(/more sessions than days/.test(tight.text ?? ''), 'it says why');
ok(/extends it|ask them/.test(tight.text ?? ''), 'and points at the coach rather than at the booking screen');
// The boundary between a nudge and a conversation, both directions.
eq(packDeadline({ left: 3, expiresOn: inDays(2), today: TODAY, bookedByThen: 0 }).kind, 'toBook',
  'three sessions in three days is still bookable');
eq(packDeadline({ left: 4, expiresOn: inDays(2), today: TODAY, bookedByThen: 0 }).kind, 'tight',
  'four in three days is not');

/* ── the last day ──────────────────────────────────────────────────────── */

const lastDay = packDeadline({ left: 1, expiresOn: TODAY, today: TODAY, bookedByThen: 0 });
eq(lastDay.daysLeft, 1, 'the last day counts as a day');
ok(/today is the last day/.test(lastDay.text ?? ''), 'and is said as that rather than as "1 days left"');

/* ── the unknowns, which are never zeroes ──────────────────────────────── */

const noBalance = packDeadline({ left: null, expiresOn: inDays(5), today: TODAY, bookedByThen: 2 });
eq(noBalance.kind, 'unknown', 'a balance nobody could read is not silence');
ok(noBalance.urgent, 'the window is closing whether or not we can see the balance');
ok(/could not read how many sessions/.test(noBalance.text ?? ''), 'and it says which half is missing');
eq(noBalance.toBook, null, 'and claims no figure');

// The two-pack case, and a diary that could not be read whole. Both arrive as
// null and both must produce a deadline WITHOUT a coverage claim — "all of them
// are booked" is the one sentence here that could talk somebody out of acting.
const noDiary = packDeadline({ left: 4, expiresOn: inDays(5), today: TODAY, bookedByThen: null });
eq(noDiary.kind, 'unknown', 'an unattributable diary is not a covered pack');
ok(/4 sessions left/.test(noDiary.text ?? ''), 'the balance is still stated, because that half was read');
ok(!/Nothing here is going to be lost/.test(noDiary.text ?? ''), 'and nothing is promised about coverage');
eq(packDeadline({ left: 4, expiresOn: inDays(5), today: TODAY, bookedByThen: Number.NaN }).kind, 'unknown',
  'an unreadable count is treated as no count, never as zero');

/* ── singulars, because these are read by people ───────────────────────── */

ok(/1 session on this pack is not booked/.test(
  packDeadline({ left: 1, expiresOn: inDays(5), today: TODAY, bookedByThen: 0 }).text ?? ''),
  'one session is singular all the way through the sentence');

/* ── bookedBy: the day, in the reader's own zone ───────────────────────── */

// A session at 7pm on the last day is INSIDE the window. Comparing against
// `new Date('2026-09-12')` — UTC midnight — would have put it outside for every
// member west of Greenwich, which is the trap src/lib/localDate.ts exists for.
const lastDayEvening = new Date(2026, 8, 12, 19, 0, 0).toISOString();
eq(bookedBy([{ startsAt: lastDayEvening }], '2026-09-12'), 1,
  'a session on the evening of the last day is inside the window');
const dayAfter = new Date(2026, 8, 13, 9, 0, 0).toISOString();
eq(bookedBy([{ startsAt: dayAfter }], '2026-09-12'), 0,
  'and one the next morning is not');
eq(bookedBy([], '2026-09-12'), 0, 'an empty diary is zero bookings, which is a real answer');
eq(bookedBy([{ startsAt: lastDayEvening }], null), null,
  'no window means no count — a caller must not read it as "nothing booked"');
eq(bookedBy([{ startsAt: lastDayEvening }], 'nonsense'), null, 'nor an unreadable one');
// A row that will not parse is not counted. Under-counting coverage is the safe
// direction: over-counting tells somebody they are covered when they are not.
eq(bookedBy([{ startsAt: 'nonsense' }, { startsAt: lastDayEvening }], '2026-09-12'), 1,
  'a booking whose date will not read is not counted as covering anything');

/* ── the two joined up, which is the whole feature ─────────────────────── */

{
  // Four sessions, four bookings, one of them after the pack ends. The naive
  // count says covered; the day-aware one says there is still one to book.
  const upcoming = [
    { startsAt: new Date(2026, 8, 5, 7, 0, 0).toISOString() },
    { startsAt: new Date(2026, 8, 8, 7, 0, 0).toISOString() },
    { startsAt: new Date(2026, 8, 11, 7, 0, 0).toISOString() },
    { startsAt: new Date(2026, 8, 20, 7, 0, 0).toISOString() },
  ];
  const n = bookedBy(upcoming, '2026-09-12');
  eq(n, 3, 'only the bookings before the pack ends count towards it');
  const d = packDeadline({ left: 4, expiresOn: '2026-09-12', today: TODAY, bookedByThen: n });
  eq(d.kind, 'toBook', 'so the fourth session still has to be booked');
  eq(d.toBook, 1, 'and it is one, not none');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('packDeadline: ok — a pack that is about to lapse says so, and says whether the diary covers it');
