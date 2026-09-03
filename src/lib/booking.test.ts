// The cancellation policy, the late fee, and the order of the waitlist.
// Compile with tsc, run with node.
//
// Three things are asserted here that the product got wrong before this file
// existed:
//
//   · a late fee of ZERO. `trainers.session_fee` was the whole policy, it is
//     null for a coach who has not set a rate, and `?? 0` turned that into "a
//     $0 late fee may apply" on the screen where somebody decides whether
//     cancelling costs them money. Five separate verdicts replace the number,
//     and four of them are not numbers.
//   · a currency that was never asked for. A fee is money and this product is
//     white-labelled; AED-by-default is a different number, not a formatting
//     slip, so an unknown currency prints the bare figure and the sentence
//     explains itself.
//   · the notice window. `insideNoticeWindow` counts a session that has ALREADY
//     STARTED as late and `isLateCancellation` does not, and the whole reason
//     both exist is that swapping them hands a refund to somebody cancelling a
//     session in progress. The assertions below pin both, against each other.
import {
  CANCEL_WINDOW_HOURS, DEFAULT_NOTICE_HOURS,
  isLateCancellation, insideNoticeWindow, noticeHoursOf, lateCancelFee,
  feeAmountLine, unstatedCurrency, unstatedCurrencyCoach, noticeLabel, cancelWarningLine, feeRecordedLine,
  waitlistOrder, nextWaitlistClaim, waitlistPosition, waitlistLine, ordinal,
  openSlotWindow, slotWindowLine, SLOT_WARN_DAYS,
  classClashes, classCheckCaveat, overlaps,
  type CancellationPolicy, type WaitlistEntry,
} from './booking';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-08-31T12:00:00Z');
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const policy = (p: Partial<CancellationPolicy>): CancellationPolicy => ({
  applies: true, noticeHours: 24, fee: 25, currency: 'GBP', ...p,
});

/* ── the notice window, and the session already in progress ─────────────── */

ok(!insideNoticeWindow(at(48), 24, NOW), 'two days out is outside a 24h window');
ok(!insideNoticeWindow(at(24.5), 24, NOW), 'and so is 24h30m');
ok(insideNoticeWindow(at(23.5), 24, NOW), '23h30m is inside it');
ok(insideNoticeWindow(at(0.5), 24, NOW), 'and so is half an hour before the session');

// The one that matters. A session that started ten minutes ago is late — the
// coach held the hour and stood in it.
ok(insideNoticeWindow(at(-0.17), 24, NOW), 'a session already under way is a late cancellation');
ok(insideNoticeWindow(at(-72), 24, NOW), 'and so is one three days gone');
ok(!isLateCancellation(at(-0.17), NOW), 'isLateCancellation says the opposite about the same session…');
ok(!isLateCancellation(at(-72), NOW), '…and about one three days gone');
ok(
  insideNoticeWindow(at(-1), 24, NOW) !== isLateCancellation(at(-1), NOW),
  'the two rules disagree on purpose: swapping them refunds a session the client missed',
);
// Where both are in the future they must agree, or the fee and the refund would
// be decided by different rules on the ordinary case.
for (const h of [0.5, 5, 23, 23.99]) {
  ok(insideNoticeWindow(at(h), 24, NOW) && isLateCancellation(at(h), NOW), `both call ${h}h out late`);
}
for (const h of [24.01, 30, 100]) {
  ok(!insideNoticeWindow(at(h), 24, NOW) && !isLateCancellation(at(h), NOW), `neither calls ${h}h out late`);
}

// The boundary itself. `<`, not `<=`: a cancellation with EXACTLY the notice
// the coach asked for is in time. Somebody who did precisely what they were
// told is not charged for it.
ok(!insideNoticeWindow(at(24), 24, NOW), 'exactly 24 hours of notice is in time, not late');
ok(!insideNoticeWindow(at(48), 48, NOW), 'and exactly 48 under a 48-hour policy');
ok(insideNoticeWindow(at(24 - 1 / 3600), 24, NOW), 'one second inside the window is inside it');
// The other end of `isLateCancellation`, which is the rule this one is NOT.
ok(!isLateCancellation(at(24), NOW), 'isLateCancellation agrees about the boundary…');
ok(!isLateCancellation(at(0), NOW), '…and treats the session start as not-late, which is the divergence');
ok(insideNoticeWindow(at(0), 24, NOW), 'while a session starting this instant is inside the notice window');

// A coach's own notice period, not a hardcoded day.
ok(insideNoticeWindow(at(40), 48, NOW), '40h out is inside a 48-hour policy');
ok(!insideNoticeWindow(at(40), 24, NOW), 'and outside a 24-hour one');
ok(!insideNoticeWindow(at(3), 2, NOW), '3h out is outside a 2-hour policy');

// Never charge on the strength of a string nobody can parse.
ok(!insideNoticeWindow('not a date', 24, NOW), 'an unparseable start is not evidence of lateness');

/* ── the notice period in force ─────────────────────────────────────────── */

eq(DEFAULT_NOTICE_HOURS, CANCEL_WINDOW_HOURS, 'the fallback is the window the app has always warned about');
eq(noticeHoursOf(null), 24, 'a policy that could not be read still holds the member to the standing 24 hours');
eq(noticeHoursOf(policy({ noticeHours: 48 })), 48, "the coach's own period is used when there is one");
eq(noticeHoursOf(policy({ noticeHours: 0 })), 24, 'a zero notice period is not a policy, it is a missing one');
eq(noticeHoursOf(policy({ noticeHours: 1 })), 1, 'but one hour is a policy a coach may genuinely run, and is kept');
eq(noticeHoursOf(policy({ noticeHours: Number.NaN })), 24, 'and NaN is not one');

/* ── what a cancellation costs ──────────────────────────────────────────── */

eq(lateCancelFee(policy({}), false).kind, 'in-time', 'outside the window nothing is owed, whatever the policy says');
eq(lateCancelFee(null, false).kind, 'in-time', 'and that holds even with no policy read');
eq(lateCancelFee(null, true).kind, 'unknown', 'a policy we could not read is UNKNOWN, never "no fee"');
eq(lateCancelFee(undefined, true).kind, 'unknown', 'undefined reads the same as null');
eq(lateCancelFee(policy({ applies: false }), true).kind, 'no-policy', 'a coach who does not charge, does not charge');
eq(lateCancelFee(policy({ fee: null }), true).kind, 'unpriced', 'a policy with no amount is unpriced, not free');
eq(lateCancelFee(policy({ fee: 0 }), true).kind, 'unpriced', 'and a zero amount is the bug this replaces, not a fee of nothing');

const charged = lateCancelFee(policy({ fee: 25, currency: 'GBP' }), true);
eq(charged.kind, 'fee', 'a stated policy inside the window is a fee');
eq(charged.kind === 'fee' ? charged.amount : null, 25, 'of the amount the coach set');
eq(charged.kind === 'fee' ? charged.currency : null, 'GBP', 'in the money the gym charges in');
const noCcy = lateCancelFee(policy({ currency: null }), true);
eq(noCcy.kind === 'fee' ? noCcy.currency : 'x', null, 'a gym that has not named its currency is carried as null, not filled in');
// The RPC hands this back as jsonb; a key that is simply absent arrives as
// undefined, and `undefined` printed into a sentence is worse than a dash.
const absentCcy = lateCancelFee({ applies: true, noticeHours: 24, fee: 25 } as unknown as CancellationPolicy, true);
eq(absentCcy.kind === 'fee' ? absentCcy.currency : 'x', null, 'a missing currency key normalises to null, never undefined');

// The smallest fee a coach can actually set. `<= 0` is the guard, not `< 1`:
// a one-unit fee is a fee, and rounding it away is the same class of mistake
// as printing a zero one.
const tiny = lateCancelFee(policy({ fee: 1 }), true);
eq(tiny.kind, 'fee', 'a fee of 1 is a fee');
eq(tiny.kind === 'fee' ? tiny.amount : null, 1, 'and is carried at its own value');
const fraction = lateCancelFee(policy({ fee: 0.5 }), true);
eq(fraction.kind, 'fee', 'and so is half a unit');

/* ── a fee as words ─────────────────────────────────────────────────────── */

eq(feeAmountLine(25, 'GBP'), 'GBP 25.00', 'the gym currency, not a dollar sign');
eq(feeAmountLine(25, 'AED'), 'AED 25.00', 'and for a Dubai gym, dirhams');
eq(feeAmountLine(25, null), '25', 'no currency means no symbol — the bare figure, never an assumed one');
ok(!/AED/.test(feeAmountLine(25, null)), 'and above all not AED, which is the operating record and not this coach');
eq(feeAmountLine(12.5, 'GBP'), 'GBP 12.50', 'minor units survive the trip through cents');

// The other half of the bare figure, and the half that was missing. The header
// of this file, and of feeAmountLine itself, both promised that where the
// currency is unknown "the sentence explains itself" — and no sentence did, so
// a member read "a late-cancellation fee of 25 applies" and had no way to know
// what 25 was. A bare figure in a slot is a slot with a heading over it; a bare
// figure in prose is an amount in whatever money the reader is thinking in.
eq(unstatedCurrency('GBP'), '', 'a stated currency needs no apology, so the clause is empty and can be appended blindly');
eq(unstatedCurrency(undefined), unstatedCurrency(null), 'an absent key reads the same as an explicit null');
ok(/currency/i.test(unstatedCurrency(null)), 'and an unset one says the word, so the reader knows what is missing');
ok(!/\d/.test(unstatedCurrency(null)), 'without inventing a second figure to explain the first');

eq(noticeLabel(1), '1 hour', 'one hour is singular');
eq(noticeLabel(24), '24 hours', 'and everything else is not');

/* ── the sentence shown before they confirm ─────────────────────────────── */

const warn = (p: CancellationPolicy | null, h: number, hours = 24) =>
  cancelWarningLine(lateCancelFee(p, insideNoticeWindow(at(h), hours, NOW)), hours);

ok(/doesn't apply/.test(warn(policy({}), 48)), 'outside the window the member is told the policy does not apply');
ok(/doesn't charge/.test(warn(policy({ applies: false }), 2)), 'a coach with no policy is described as having none');
ok(/couldn't read/.test(warn(null, 2)), 'an unread policy says so rather than quietly promising nothing');
ok(!/no fee|free/i.test(warn(null, 2)), 'and does not tell the member it is free');
ok(/ask them/.test(warn(policy({ fee: null }), 2)), 'a policy with no amount sends them to their coach');

const feeWarn = warn(policy({ fee: 25, currency: 'GBP' }), 2);
ok(/GBP 25\.00/.test(feeWarn), 'the fee is quoted in the gym’s money');
ok(/Repple doesn't take this payment/.test(feeWarn), 'and the app says plainly that it is not taking it');
ok(!/\$/.test(feeWarn), 'no dollar sign anywhere near a fee');
ok(/48 hours/.test(warn(policy({ noticeHours: 48 }), 30, 48)), "the coach's own notice period is the one quoted");

// The warning for a coach whose gym never named a currency. This is the
// assertion that fails if the explanation is ever dropped again and the
// sentence goes back to quoting a naked number at somebody about to be charged.
const bareWarn = warn(policy({ fee: 25, currency: null }), 2);
ok(/fee of 25\b/.test(bareWarn), 'the amount is still stated — the coach set it and the member is entitled to it');
ok(/currency/i.test(bareWarn), 'and the sentence says the currency is not on record, which is what "the bare figure" was always meant to come with');
ok(!/GBP|AED|\$|£|€/.test(bareWarn), 'no money is invented to fill the gap');
ok(bareWarn.endsWith(unstatedCurrency(null)), 'and it is the module’s own clause, verbatim, not a paraphrase that can drift from it');
ok(!/currency/i.test(feeWarn), 'while a fee in a stated currency carries no such clause — the explanation appears only where it is true');

// ── a coach in Tokyo, and the hundred-times error that was waiting there ───
// `feeAmountLine` used to multiply the typed fee by a hundred and hand it to a
// formatter that divided it straight back. The round trip is invisible in a
// currency with hundredths and wrong in one without: a ¥5,000 fee is 5,000 yen,
// not 500,000 of anything, and the yen has no subdivision to print two places
// of. Both halves are asserted, because either one alone would have passed
// while the pair was broken.
eq(feeAmountLine(5000, 'JPY'), 'JPY 5,000', 'a fee in a zero-decimal currency is neither scaled nor given decimals it has no unit for');
eq(feeAmountLine(25, 'GBP'), 'GBP 25.00', 'and a currency with hundredths is unchanged by that');
ok(/JPY 5,000/.test(warn(policy({ fee: 5000, currency: 'JPY' }), 2)),
  'and the sentence the member actually reads before confirming carries the same figure');

// Not one branch of the warning may claim Repple charges anything.
for (const [label, line] of [
  ['in time', warn(policy({}), 48)],
  ['no policy', warn(policy({ applies: false }), 2)],
  ['unknown', warn(null, 2)],
  ['unpriced', warn(policy({ fee: null }), 2)],
  ['fee', feeWarn],
] as const) {
  ok(!/we (will )?charge|charged to your card|payment taken/i.test(line), `${label}: nothing says Repple takes the money`);
}

/* ── the sentence shown afterwards, about a row that really exists ──────── */

eq(feeRecordedLine(false, 25, 'GBP'), null, 'no charge recorded, no sentence about one');
const rec = feeRecordedLine(true, 25, 'GBP');
ok(rec != null && /GBP 25\.00/.test(rec), 'a recorded fee is quoted with its amount');
ok(rec != null && /settle it with your coach/.test(rec), 'and named as theirs to settle, not ours to collect');
const recNoAmount = feeRecordedLine(true, null, 'GBP');
ok(recNoAmount != null && !/null|NaN|0\.00/.test(recNoAmount), 'a recorded fee whose amount did not come back prints no number at all');
ok(rec != null && !/currency/i.test(rec), 'a recorded fee in a stated currency explains nothing, because there is nothing to explain');
const recNoCcy = feeRecordedLine(true, 25, null);
ok(recNoCcy != null && /\b25\b/.test(recNoCcy) && /currency/i.test(recNoCcy),
  'and the record of a fee in no stated currency names the figure AND says the money behind it was never set');

/* ── the waitlist is an order, and the order is the product ─────────────── */

const w = (clientId: string, joinedAt: string, seq: number): WaitlistEntry => ({ clientId, joinedAt, seq });
const queue = [
  w('c-late', '2026-08-30T10:00:02Z', 3),
  w('c-first', '2026-08-30T10:00:00Z', 1),
  w('c-mid', '2026-08-30T10:00:01Z', 2),
];

eq(waitlistOrder(queue).map((e) => e.clientId).join(','), 'c-first,c-mid,c-late', 'the queue is served oldest first');
eq(nextWaitlistClaim(queue), 'c-first', 'and the head of it gets a freed slot');
eq(nextWaitlistClaim([]), null, 'an empty queue claims nothing');
eq(nextWaitlistClaim(queue, 'c-first'), 'c-mid', 'the person who just cancelled cannot be handed their own slot back');

// The tie is the reason `seq` exists at all: joined_at is the transaction
// timestamp, so two people joining in the same instant would otherwise be
// ordered by nothing.
const tied = [w('b', '2026-08-30T10:00:00Z', 7), w('a', '2026-08-30T10:00:00Z', 4)];
eq(nextWaitlistClaim(tied), 'a', 'a tie on joined_at is broken by seq, not by luck');
eq(nextWaitlistClaim([...tied].reverse()), 'a', 'and the answer does not depend on the order the rows arrived in');

// The input is not reordered under the caller.
const before = queue.map((e) => e.clientId).join(',');
waitlistOrder(queue);
eq(queue.map((e) => e.clientId).join(','), before, 'ordering the queue does not mutate the caller’s array');

eq(waitlistPosition(queue, 'c-first'), 1, 'positions are 1-based');
eq(waitlistPosition(queue, 'c-mid'), 2, 'and follow the serving order, not the array order');
eq(waitlistPosition(queue, 'c-late'), 3, 'to the back of the queue');
eq(waitlistPosition(queue, 'nobody'), 0, '0 means not on the list — which is not the same as first');

/* ── the queue, in words ────────────────────────────────────────────────── */

ok(/next in line/.test(waitlistLine(1, 1)), 'the head of the queue is told they are next');
ok(!/ahead of/.test(waitlistLine(1, 1)), 'a queue of one is not told it is ahead of nobody');
ok(/ahead of 2 others/.test(waitlistLine(1, 3)), 'and how many are behind them');
ok(/ahead of 1 other\b/.test(waitlistLine(1, 2)), 'one person behind is an "other", not "others"');
ok(!/next in line/.test(waitlistLine(2, 3)), 'second place is never told they are next');
ok(/2nd in line of 3/.test(waitlistLine(2, 3)), 'it is told where it actually is');
ok(/Nobody is waiting/.test(waitlistLine(0, 0)), 'an empty queue says so');
ok(/1 person is waiting/.test(waitlistLine(0, 1)), 'and one other person is a person, not people');
ok(/2 people are waiting/.test(waitlistLine(0, 2)), 'two are people');
// Nothing here may promise a booking to somebody who has not got one.
for (const p of [2, 3, 7]) {
  ok(!/it's yours/.test(waitlistLine(p, 9)), `position ${p} is not promised the slot`);
}

eq(ordinal(1), '1st', 'ordinals: 1st');
eq(ordinal(2), '2nd', '2nd');
eq(ordinal(3), '3rd', '3rd');
eq(ordinal(4), '4th', '4th');
eq(ordinal(11), '11th', '11th, not 11st');
eq(ordinal(12), '12th', '12th, not 12nd');
eq(ordinal(13), '13th', '13th, not 13rd');
eq(ordinal(21), '21st', '21st');
eq(ordinal(22), '22nd', '22nd');

/* ── how much bookable diary is left ────────────────────────────────────── */

{
  const NOW = Date.parse('2026-09-01T09:00:00.000Z');
  const DAY = 86_400_000;
  const slot = (offsetDays: number, status = 'available') =>
    ({ startsAt: new Date(NOW + offsetDays * DAY).toISOString(), status });

  // THE one that must not be got wrong. An empty list under a failed read is a
  // read that did not happen, and turning it into "you have no open slots"
  // sends a coach to regenerate a diary that is already full.
  const unread = openSlotWindow([], { known: false, hasWeekly: true, now: NOW });
  eq(unread.state, 'unknown', 'an unread calendar is unknown, never empty');
  eq(slotWindowLine(unread), null, 'and nothing is said about a diary nobody read');

  // ── the state the screen used to be silent in ────────────────────────────
  //
  // A coach with no weekly availability AND nobody on their book may simply not
  // take one-to-ones. Silence is right there.
  eq(openSlotWindow([], { known: true, hasWeekly: false, now: NOW }).state, 'idle',
    'a coach with no weekly slots and no clients is told nothing');
  eq(slotWindowLine(openSlotWindow([], { known: true, hasWeekly: false, now: NOW })), null,
    'and nothing is drawn for them');

  // A coach with clients waiting is a different case entirely, and it is the
  // one every coach on this platform has actually been in: their booking screen
  // is dead to every one of those clients and nothing said so.
  {
    const never = openSlotWindow([], { known: true, hasWeekly: false, clientsOnBook: 3, now: NOW });
    eq(never.state, 'never-set', 'no weekly hours plus clients on the book is never-set');
    const line = slotWindowLine(never, 3)!;
    ok(line.includes('Your 3 clients cannot book you'), 'which names how many people are waiting');
    // Says the consequence, not the omission. "You have not set availability" is
    // a note about a form; this has to be about the clients.
    ok(line.includes('their booking screen is empty'), 'and what those clients actually see');
    ok(!/you have not set/i.test(line.split('.')[0]), 'and does not open by telling them off');

    const one = slotWindowLine(openSlotWindow([], { known: true, hasWeekly: false, clientsOnBook: 1, now: NOW }), 1)!;
    ok(one.includes('Your client cannot book you'), 'one client reads as English, not "1 clients"');
  }

  // An unknown client count is NOT treated as zero and NOT treated as waiting.
  // Telling a coach their book is unbookable on the strength of a number we
  // could not read is the failure this whole module exists to refuse.
  eq(openSlotWindow([], { known: true, hasWeekly: false, clientsOnBook: null, now: NOW }).state, 'idle',
    'an unread client count stays silent rather than guessing either way');
  eq(openSlotWindow([], { known: true, hasWeekly: false, clientsOnBook: 0, now: NOW }).state, 'idle',
    'and nobody on the book is genuinely idle');

  // An unread diary still beats everything: never-set must not outrank unknown.
  eq(openSlotWindow([], { known: false, hasWeekly: false, clientsOnBook: 5, now: NOW }).state, 'unknown',
    'an unread calendar is unknown even with clients waiting');

  const empty = openSlotWindow([slot(-3)], { known: true, hasWeekly: true, now: NOW });
  eq(empty.state, 'empty', 'slots that have all been and gone are an empty window');
  eq(empty.open, 0, 'and a past slot is not counted as open');
  ok((slotWindowLine(empty) ?? '').includes('nobody can book you'), 'which says what it costs');

  // A booked session is not a bookable one. A coach whose four weeks are fully
  // booked has nothing left to sell and must be told so.
  eq(openSlotWindow([slot(20, 'booked'), slot(25, 'blocked')], { known: true, hasWeekly: true, now: NOW }).state, 'empty',
    'a full diary is an empty bookable window');

  const ending = openSlotWindow([slot(1), slot(3)], { known: true, hasWeekly: true, now: NOW });
  eq(ending.state, 'ending', 'a window inside the warning period is running out');
  eq(ending.daysLeft, 3, 'counted to the furthest slot, not the nearest');
  eq(ending.open, 2, 'and every future open slot is counted');
  ok((slotWindowLine(ending) ?? '').includes('in 3 days'), 'and the sentence says when');

  eq(openSlotWindow([slot(SLOT_WARN_DAYS + 1)], { known: true, hasWeekly: true, now: NOW }).state, 'healthy',
    'a window past the warning period says nothing');
  eq(slotWindowLine(openSlotWindow([slot(28)], { known: true, hasWeekly: true, now: NOW })), null,
    'and a healthy window has no line at all');

  // The boundary itself warns rather than staying silent: the day it is exactly
  // a week away is the last day the warning is any use.
  eq(openSlotWindow([slot(SLOT_WARN_DAYS)], { known: true, hasWeekly: true, now: NOW }).state, 'ending',
    'the boundary day warns');

  // Floored, so "runs out in 2 days" is never optimistic, and the two short
  // horizons read as words rather than as a number.
  const soon = openSlotWindow([{ startsAt: new Date(NOW + DAY + 20 * 3600_000).toISOString(), status: 'available' }],
    { known: true, hasWeekly: true, now: NOW });
  eq(soon.daysLeft, 1, 'a day and twenty hours is one whole day, not two');
  ok((slotWindowLine(soon) ?? '').includes('tomorrow'), 'and one day reads as tomorrow');
  const today = openSlotWindow([{ startsAt: new Date(NOW + 3600_000).toISOString(), status: 'available' }],
    { known: true, hasWeekly: true, now: NOW });
  ok((slotWindowLine(today) ?? '').includes('today'), 'and the last hour of the window reads as today');

  // An unparseable start is dropped rather than counted: it cannot be placed in
  // time, and counting it would hold the warning back on a diary that is empty.
  eq(openSlotWindow([{ startsAt: 'not a date', status: 'available' }], { known: true, hasWeekly: true, now: NOW }).state,
    'empty', 'an unreadable start is not a bookable slot');
}

/* ── classes and one-to-ones now know the other exists ──────────────────── */

{
  const ME = 'coach-1';
  const cls = (id: string, startsAt: string, durationMin: number, over: Partial<{ trainerId: string | null; status: string }> = {}) =>
    ({ id, title: id, startsAt, durationMin, trainerId: ME, status: 'scheduled', ...over });

  const SIX = '2026-09-08T18:00:00.000Z';
  const mine = cls('spin', SIX, 45);

  // THE defect: `generateSlots` opened a bookable PT hour on top of the class
  // the coach was running.
  const hit = classClashes(SIX, 60, [mine], ME);
  eq(hit.mine.length, 1, 'a class this coach teaches is in the way of a one-to-one');
  eq(hit.unattributed.length, 0, 'and it is not counted twice');

  // Touching is not overlapping. A class that ends at six and a session that
  // starts at six are two things one person can do.
  eq(classClashes('2026-09-08T18:45:00.000Z', 60, [mine], ME).mine.length, 0,
    'a session starting as the class ends is not a clash');
  eq(classClashes('2026-09-08T17:00:00.000Z', 60, [mine], ME).mine.length, 0,
    'nor is one that ends as it begins');

  // A cancelled class is not an obstacle. The room never opened, and treating
  // it as one would lose the coach an hour the gym handed back.
  eq(classClashes(SIX, 60, [cls('off', SIX, 45, { status: 'cancelled' })], ME).mine.length, 0,
    'a called-off class does not block the hour it was going to use');

  // Part 165: every class the console created has trainer_id NULL. Those can
  // neither block nor be dismissed.
  const nobody = classClashes(SIX, 60, [cls('board', SIX, 45, { trainerId: null })], ME);
  eq(nobody.mine.length, 0, 'a class with no coach recorded does not block');
  eq(nobody.unattributed.length, 1, 'but it is not silently ignored either');
  ok((classCheckCaveat(true, 1) ?? '').includes('could not be ruled'),
    'and the coach is told it could not be ruled out');

  // A colleague's class is their business and their room.
  const theirs = classClashes(SIX, 60, [cls('theirs', SIX, 45, { trainerId: 'coach-2' })], ME);
  eq(theirs.mine.length, 0, 'a colleague class is not this coach being double-booked');
  eq(theirs.unattributed.length, 0, 'and it is not an unknown either — somebody is recorded');

  // Signed out: nothing is anybody's, and the guard says so rather than
  // claiming the hour is free.
  eq(classClashes(SIX, 60, [mine], null).mine.length, 0, 'with no account, no class is "mine"');

  // The one sentence that must exist: an unread timetable is never silence.
  ok((classCheckCaveat(false, 0) ?? '').includes('could not be read'),
    'an unchecked timetable is said out loud');
  eq(classCheckCaveat(true, 0), null, 'and a clean, whole check says nothing extra');

  // `overlaps` now takes any busy span, which is what let a class be handed to
  // the guard the whole booking side already rested on.
  ok(overlaps(SIX, 60, [{ startsAt: SIX, durationMin: 45 }]), 'a bare span overlaps');
  ok(!overlaps(SIX, 60, []), 'and an empty diary never does');
}

/* ── the same clause, said to the coach ─────────────────────────────────── */
//
// The three waive/reinstate confirmations on the coach's calendar printed a
// bare figure in PROSE — "25 against Ana would be marked as forgiven" — on the
// one list in the app that says what clients owe. `unstatedCurrency` could not
// be used there: it tells the reader to ask their coach.

eq(unstatedCurrencyCoach('AED'), '', 'a stated currency needs no clause, so it can be appended blindly');
eq(unstatedCurrencyCoach(null).length > 0, true, 'an unset one gets a sentence');
ok(!/ask them|your coach/i.test(unstatedCurrencyCoach(null)),
  'and never tells the coach to go and ask their coach');
ok(/you have not set a currency/i.test(unstatedCurrencyCoach(null)),
  'it addresses the person who can fix it');
ok(/settings/i.test(unstatedCurrencyCoach(null)), 'and says where');
ok(unstatedCurrencyCoach(null).startsWith(' '),
  'it begins with a space, because it is appended to a finished sentence');

if (errors.length) {
  console.error(`booking.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('booking.test.ts — all assertions passed');
