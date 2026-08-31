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
  feeAmountLine, noticeLabel, cancelWarningLine, feeRecordedLine,
  waitlistOrder, nextWaitlistClaim, waitlistPosition, waitlistLine, ordinal,
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

if (errors.length) {
  console.error(`booking.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('booking.test.ts — all assertions passed');
